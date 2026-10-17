"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { searchRakutenClient } from "../lib/rakutenClient";
import { mergeOffers } from "../lib/merge";
import { unitPriceLabel } from "../lib/unitPrice";
import { loadStatus, saveStatus, ratesForPrice } from "../lib/status";
import { TodayStrip, SaleCalendarList, StatusForm } from "./components/SaleStatus";
import { PREFS, shippingHint, CARD_PRESETS, loadProfile, saveProfile } from "../lib/profile";
import { RECORD_ON_SEARCH, RECORD_LIMIT, canRecordNow } from "../lib/writePolicy";
import { AMAZON_AFFILIATE_ON, COLLECTIONS_ON } from "../lib/featureFlags";
import { loadCatalog, augmentProduct } from "../lib/catalog";
import { statsFor, statsLabel, productPath } from "../lib/priceView";
import { PAIN_BY_KEY } from "../lib/pains";
import PriceCompare, { MiniCompare } from "./components/PriceCompare";
import TopPicks from "./components/TopPicks";

const STORES = {
  rakuten: { name: "楽天市場", short: "楽天", color: "#BF0000" },
  yahoo: { name: "Yahoo!ショッピング", short: "Yahoo!", color: "#FF0033" },
  amazon: { name: "Amazon", short: "Amazon", color: "#232F3E" },
};

// AmazonのタグはlibのfeatureFlagsで管理(規約確認まで無効)
// 楽天のsort値: standard(標準)/+itemPrice(安い)/-itemPrice(高い)/-reviewCount/-reviewAverage
const RAKUTEN_SORT = { cheap: "+itemPrice", high: "-itemPrice", rating: "-reviewAverage", reviews: "-reviewCount", popular: "standard" };
const yen = (n) => "¥" + Math.round(Number(n)).toLocaleString("ja-JP");

// カテゴリ別の妥当な最低価格(これ未満は無関係な小物・部品とみなす)。
// 検索APIに直接渡してジャンクを取得段階で除外する
function getJunkFloor(kw) {
  if (/シャンプー|トリートメント|コンディショナー|化粧水|乳液|美容液|洗剤|柔軟剤|プロテイン|サプリ|家電|ドライヤー|時計|バッグ|靴/.test(kw)) return 200;
  if (/電池|文具|ペン|ノート|靴下|マスク|ティッシュ/.test(kw)) return 30;
  return 50;
}
// 高い順のときの上限(誤登録の4700万円等を除外)。宿泊券等は別途NGワードで除外
const HIGH_SORT_MAX = 300000;

// カテゴリ辞書(タイル・候補チップのパーソナライズに使用)
const CATEGORY_ICONS = {
  "シャンプー": "🧴", "洗剤": "🧼", "歯磨き粉": "🪥", "化粧水": "💧",
  "米": "🍚", "コーヒー": "☕", "トイレットペーパー": "🧻", "サプリメント": "💊",
  "プロテイン": "🥤", "柔軟剤": "🌸", "ボディソープ": "🛁", "マスク": "😷",
  "ティッシュ": "🤧", "おむつ": "👶", "ドッグフード": "🐶", "キャットフード": "🐱",
  "電池": "🔋", "水": "🚰", "紅茶": "🫖", "トリートメント": "✨",
};
const DEFAULT_CATS = ["シャンプー", "洗剤", "歯磨き粉", "化粧水", "米", "コーヒー", "トイレットペーパー", "サプリメント"];

// 閲覧履歴・検索履歴からユーザーの興味カテゴリを推定して並べる
function personalCategories(viewHistory, searchHistory, count) {
  const score = {};
  const texts = [
    ...(searchHistory || []),
    ...(viewHistory || []).map((v) => v.name || ""),
  ];
  for (const t of texts) {
    for (const cat of Object.keys(CATEGORY_ICONS)) {
      if (t.includes(cat)) score[cat] = (score[cat] || 0) + 1;
    }
  }
  const ranked = Object.keys(score).sort((a, b) => score[b] - score[a]);
  const rest = DEFAULT_CATS.filter((c) => !ranked.includes(c));
  return [...ranked, ...rest].slice(0, count);
}
// 検索キーワードと無関係に混入しがちなノイズ(高額系)
const NOISE_WORDS = /ふるさと納税|宿泊券|宿泊|旅行券|チケット|粘度計|業務用.*(浄水器|機器)/;

// ---- ポイント設定(実質価格) ----
const DEFAULT_RATES = { rakuten: 1, yahoo: 1, amazon: 1 };
function loadRates() {
  try {
    const s = localStorage.getItem("pointRates");
    return s ? { ...DEFAULT_RATES, ...JSON.parse(s) } : DEFAULT_RATES;
  } catch {
    return DEFAULT_RATES;
  }
}
function effectivePrice(offer, rates) {
  const rate = (rates[offer.store] ?? 0) / 100;
  return offer.price * (1 - rate);
}

// ------------------------------------------------------------
// 商品詳細
// ------------------------------------------------------------
// v23: ログイン・リスト・指値・レビュー・購入履歴・ポイントは廃止(端末内の設定だけで使う形に)
function Detail({ product, rates, viewHistory, onOpenRelated, backLabel, profile }) {
  const [shareMsg, setShareMsg] = useState("");
  const [related, setRelated] = useState([]);
  const pkey = product.key || product.jan;
  // v19: 3サイトの90日記録(DBの offers)を読む。検索結果から開いた場合は読み込み済み
  const [db, setDb] = useState(product.db || null);

  // いちばん安いサイトの統計(共有文に使う)
  const bestOfferNow = [...product.offers].sort((a, b) => a.price - b.price)[0] || null;
  const bestStats = bestOfferNow ? statsFor(bestOfferNow.price, db?.offers?.[bestOfferNow.store]) : null;
  const shareUrl = typeof window !== "undefined" && pkey ? window.location.origin + productPath(db?.pkey || pkey) : "";

  useEffect(() => {
    if (product.db) { setDb(product.db); return; }
    if (!pkey) return;
    let alive = true;
    loadCatalog(supabase, [pkey]).then((m) => { if (alive) setDb(m.get(pkey) || null); }).catch(() => {});
    return () => { alive = false; };
  }, [pkey, product.db]);
  // 関連商品(この商品に関連する商品): 商品名から代表カテゴリ語を抜き、同カテゴリの人気商品を取得
  useEffect(() => {
    const CATS = ["シャンプー","コンディショナー","トリートメント","洗剤","柔軟剤","ボディソープ","ハンドソープ","歯磨き","歯ブラシ","化粧水","乳液","美容液","日焼け止め","プロテイン","サプリ","おむつ","おしりふき","猫","犬","コーヒー","紅茶","マスク","ティッシュ","トイレットペーパー","オイル","米","水","洗顔"];
    const name = product?.name || "";
    const cat = CATS.find((c) => name.includes(c));
    const kw = cat || name.split(/[\s　]/)[0];
    if (!kw) return;
    let alive = true;
    searchRakutenClient(kw, 12, 1, "standard")
      .then((items) => {
        if (!alive) return;
        const pk = product.key || product.jan;
        const list = (items || [])
          .filter((it) => it.image && (it.code ? "r:" + it.code : "") !== pk)
          .map((it) => ({ key: it.code ? "r:" + it.code : null, jan: it.jan, name: it.name, image: it.image, price: it.price }))
          .slice(0, 10);
        setRelated(list);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [pkey]);


  return (
    <div>
      <button onClick={() => window.history.back()} style={{ ...btnGhost, fontSize: 13, fontWeight: 700, padding: "8px 0" }}>← {backLabel || "検索結果に戻る"}</button>
      <div style={card}>
        <div style={{ display: "flex", gap: 14 }}>
          {product.image && (
            <img src={product.image} alt="" style={{ width: 120, height: 120, objectFit: "contain", borderRadius: 12, background: "#EAF3F0" }} />
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.45, margin: 0 }}>{product.name}</h2>
            {product.reviews > 0 && (
              <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 4 }}>
                ★{product.rating}({product.reviews.toLocaleString()}件)
              </div>
            )}
            {product.jan && <div style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 2 }}>JAN: {product.jan}</div>}
          </div>
        </div>

        {/* 3モール統合レビュー(各モールの評価をレビュー数で加重平均) */}
        {(() => {
          const rated = product.offers.filter((o) => o.rating > 0 && o.reviews > 0);
          if (rated.length === 0) return null;
          const totalReviews = rated.reduce((s, o) => s + o.reviews, 0);
          const weightedAvg = rated.reduce((s, o) => s + o.rating * o.reviews, 0) / totalReviews;
          const full = Math.round(weightedAvg);
          return (
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 14, marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#16324F", marginBottom: 8 }}>横断レビュー(各モール統合)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: "#16324F", lineHeight: 1 }}>{weightedAvg.toFixed(2)}</span>
                <div>
                  <div style={{ fontSize: 16, color: "#F59E0B", letterSpacing: -1 }}>
                    {"★".repeat(full)}{"☆".repeat(Math.max(0, 5 - full))}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B" }}>{totalReviews.toLocaleString()}件の総合評価</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rated.sort((a, b) => b.reviews - a.reviews).map((o, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: STORES[o.store]?.color || "#64748B", borderRadius: 4, padding: "1px 6px", minWidth: 44, textAlign: "center" }}>
                      {STORES[o.store]?.short || o.store}
                    </span>
                    <span style={{ color: "#F59E0B", letterSpacing: -1.5, fontSize: 12 }}>
                      {"★".repeat(Math.round(o.rating))}{"☆".repeat(Math.max(0, 5 - Math.round(o.rating)))}
                    </span>
                    <span style={{ fontWeight: 700, color: "#334155" }}>{o.rating.toFixed(1)}</span>
                    <span style={{ color: "#94A3B8" }}>({o.reviews.toLocaleString()}件)</span>
                    {o.url && (
                      <a href={o.url} target="_blank" rel="noopener noreferrer sponsored"
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: "#2563EB", textDecoration: "none", whiteSpace: "nowrap" }}>
                        レビューを読む ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 8, lineHeight: 1.5 }}>
                ※ 各モールの評価をレビュー件数で加重平均した独自の総合スコアです。
                レビュー本文は「レビューを読む」から各モールのページでご覧いただけます
                (モールのAPIはレビュー本文を提供していないため)。
              </div>
            </div>
          );
        })()}

        {(() => {
          const rated = product.offers.filter((o) => o.rating > 0 && o.reviews >= 3);
          if (rated.length >= 2) {
            const rs = rated.map((o) => o.rating);
            const gap = Math.max(...rs) - Math.min(...rs);
            if (gap >= 1.0) {
              return (
                <div style={{ background: "#FCF3E3", border: "1px solid #F59E0B", borderRadius: 10, padding: "9px 12px", marginBottom: 10, fontSize: 11.5, color: "#92670C", lineHeight: 1.6 }}>
                  ⚠ この商品はモールによって評価に差があります(
                  {rated.map((o) => `${STORES[o.store]?.short}★${o.rating}`).join(" / ")}
                  )。レビューは参考程度にご覧ください。
                </div>
              );
            }
          }
          return null;
        })()}
        <PriceCompare
          name={product.name}
          offers={product.offers}
          dbOffers={db?.offers}
          rates={rates}
          title="3サイトの価格比較(実質価格順)"
        />
        {pkey && (
          <a href={productPath(db?.pkey || pkey)} style={{ display: "inline-block", fontSize: 11.5, color: "#2563EB", fontWeight: 700, marginTop: 8, textDecoration: "none" }}>
            🔗 この商品のページを開く(URLで共有できます)
          </a>
        )}

        {/* こんな悩みに(商品説明から自動で判定) */}
        {(db?.product?.tags || []).length > 0 && (
          <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "11px 13px", marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#16324F", marginBottom: 6 }}>こんな悩みに</div>
            {(db.product.tags || []).map((t) => PAIN_BY_KEY[t]).filter(Boolean).map((pn) => (
              <div key={pn.key} style={{ fontSize: 12, color: "#334155", lineHeight: 1.7 }}>
                ✅ <b>{pn.label}</b> — {pn.benefit}
              </div>
            ))}
          </div>
        )}

        {/* お住まいの地域による送料の目安(端末内の設定のみを使用) */}
        {(() => {
          const hint = shippingHint(profile?.pref);
          if (!hint || hint.extra === "標準") return null;
          return (
            <div style={{ fontSize: 11.5, color: "#92670C", background: "#FCF3E3", border: "1px solid #F59E0B", borderRadius: 10, padding: "8px 12px", marginTop: 10, lineHeight: 1.6 }}>
              🚚 {profile.pref}への配送: 送料が{hint.extra}傾向です。{hint.note}
            </div>
          );
        })()}

        {/* SNS共有: 事実(最安・値下がり)を軸にした文言。ステマ規制に配慮しPR表記を含める */}
        <div style={{ marginTop: 10 }}>
          <button
            onClick={async () => {
              const best = bestOfferNow;
              const lab = statsLabel(bestStats);
              const lines = [
                `【${product.name.slice(0, 40)}】`,
                best ? `いま最安 ${yen(best.price)}(${STORES[best.store]?.short})` : "",
                bestStats && bestStats.days >= 7 ? `📊 ${lab.main}・${lab.sub}` : "",
                "楽天・Yahoo!・Amazonをポイント込みの実質価格で比較 → オウダン",
                shareUrl || (typeof window !== "undefined" ? window.location.origin : ""),
                "#オウダン #節約 #PR",
              ].filter(Boolean);
              const text = lines.join("\n");
              try {
                if (navigator.share) {
                  await navigator.share({ title: "オウダン", text });
                } else {
                  await navigator.clipboard.writeText(text);
                  setShareMsg("共有用のテキストをコピーしました");
                  setTimeout(() => setShareMsg(""), 3000);
                }
              } catch {}
            }}
            style={{ ...btnGhost, border: "1px solid #CBD5E1", borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 700 }}
          >
            📣 この価格を共有する
          </button>
          {shareMsg && <span style={{ fontSize: 11.5, color: "#059669", fontWeight: 700, marginLeft: 8 }}>{shareMsg}</span>}
        </div>

        <p style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 14, lineHeight: 1.6 }}>
          【PR】購入リンクにはアフィリエイトリンクが含まれます。価格・実質価格は取得時点の概算です。
          還元率・ステータスは「設定」タブで変更できます(この端末にだけ保存)。実際の価格・送料・付与ポイントは各ストアでご確認ください。
        </p>

        <ProductStrip
          title="この商品に関連する商品"
          subtitle="同じカテゴリの人気商品"
          items={related}
          onOpen={onOpenRelated}
        />
        {viewHistory && viewHistory.length > 1 && (
          <ProductStrip
            title="最近見た商品"
            items={viewHistory.filter((v) => v.key !== pkey)}
            onOpen={onOpenRelated}
          />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// メイン
// ------------------------------------------------------------
// 横スクロールの商品帯(閲覧履歴・これも見てます・関連商品で共用)
function ProductStrip({ title, items, onOpen, subtitle }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#16324F", marginBottom: 2 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 8 }}>{subtitle}</div>}
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, WebkitOverflowScrolling: "touch" }}>
        {items.map((it, i) => (
          <button
            key={(it.key || it.jan || i) + "_" + i}
            onClick={() => onOpen(it)}
            style={{ flex: "0 0 auto", width: 116, background: "#fff", border: "1px solid #DDE9E4", borderRadius: 12, padding: 8, cursor: "pointer", textAlign: "left" }}
          >
            {it.image ? (
              <img src={it.image} alt="" style={{ width: "100%", height: 96, objectFit: "contain", borderRadius: 8, background: "#EAF3F0" }} />
            ) : (
              <div style={{ width: "100%", height: 96, borderRadius: 8, background: "#EAF3F0" }} />
            )}
            <div style={{ fontSize: 11, lineHeight: 1.35, color: "#334155", marginTop: 6, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", height: 30 }}>
              {it.name}
            </div>
            {it.price != null && (
              <div style={{ fontSize: 13, fontWeight: 800, color: "#16324F", marginTop: 3 }}>¥{Math.round(it.price).toLocaleString("ja-JP")}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [rawOffers, setRawOffers] = useState([]);
  const [searchPage, setSearchPage] = useState(1);
  const [lastQuery, setLastQuery] = useState("");
  const [mallFilter, setMallFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState(null);
  const [viewHistory, setViewHistory] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [sort, setSort] = useState("popular");
  // 検索結果の商品キー → DBの3サイト価格(v19)
  const [catalog, setCatalog] = useState(() => new Map());
  // 詳細を開けなかった商品のキー(取り扱い終了など)。リストでグレー表示に使う
  const [unopenable, setUnopenable] = useState([]);
  const [view, setView] = useState("home"); // home | search | list | history | mypage
  const [saleEvents, setSaleEvents] = useState([]);
  const [saleLoaded, setSaleLoaded] = useState(false);
  const [saleModal, setSaleModal] = useState(null);
  const [upcomingModal, setUpcomingModal] = useState(null);
  const [rates, setRates] = useState(DEFAULT_RATES);
  // v20: あなたのステータス(端末内のみ)と、今日のセールを足した還元率
  const [status, setStatus] = useState(null);
  const [statusOpen, setStatusOpen] = useState(false);
  // プロフィール(都道府県/年代/性別/カード券種)は端末内のみに保存
  const [profile, setProfile] = useState({});
  const [amazonStatus, setAmazonStatus] = useState("disabled");

  // ブラウザの戻るで、詳細→一覧、一覧→ホーム を段階的に戻す(サイト外に出ない)
  useEffect(() => {
    const onPop = () => {
      setSelected((cur) => {
        if (cur) return null; // 詳細を開いていたら閉じるだけ
        return cur;
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    try {
      const vh = localStorage.getItem("viewHistory");
      if (vh) setViewHistory(JSON.parse(vh).slice(0, 30));
      const sh = localStorage.getItem("searchHistory");
      if (sh) setSearchHistory(JSON.parse(sh).slice(0, 20));
      const uo = localStorage.getItem("unopenableKeys");
      if (uo) setUnopenable(JSON.parse(uo));
    } catch {}
    setRates(loadRates());
    setStatus(loadStatus());
    setProfile(loadProfile());
    // 商品ページなどから「/?q=キーワード」で来たら、そのまま検索する
    try {
      const q0 = new URLSearchParams(window.location.search).get("q");
      if (q0) { setQuery(q0); setTimeout(() => doSearch(q0), 0); }
    } catch {}
    // セール確定日程とピックアップを読み込み
    supabase.from("sale_events").select("name, store, start_date, end_date, status, period_text, summary, url")
      .then(({ data }) => { setSaleEvents(data || []); setSaleLoaded(true); })
      .catch(() => setSaleLoaded(true));
  }, []);

  // プロフィールの1項目を更新(端末内にのみ保存)
  const setProfileField = (key, value) => {
    setProfile((prev) => saveProfile({ ...prev, [key]: value }));
  };

  // カード券種を選ぶと、その券種の一般的な還元率を還元率設定に反映する
  const applyCardPreset = (id) => {
    const preset = CARD_PRESETS.find((c) => c.id === id);
    setProfileField("card", id);
    if (preset) saveRates({ ...rates, ...preset.rates });
  };

  const saveRates = (next) => {
    setRates(next);
    try { localStorage.setItem("pointRates", JSON.stringify(next)); } catch {}
  };

  // 検索結果の商品の14日価格統計を取得(買い時/今は高めバッジ用)。
  // 履歴が無い商品はバッジ無し。キーは最大200件・100件ずつに分けて取得
  // v19: 検索結果の商品に、DBにある3サイトの価格と90日記録を付ける
  useEffect(() => {
    const products = results?.products || [];
    const keys = [...new Set(products.map((p) => p.key || p.jan).filter(Boolean))].slice(0, 300);
    if (keys.length === 0) { setCatalog(new Map()); return; }
    let alive = true;
    loadCatalog(supabase, keys).then((m) => { if (alive) setCatalog(m); }).catch(() => {});
    return () => { alive = false; };
  }, [results]);

  const doSearch = async (q, sortOverride) => {
    const kw = (q ?? query).trim();
    if (!kw) return;
    // サーバー(各モールAPI)に並べ替えを渡し、カタログ全体からの並びを取得する。
    // これにより「安い順=全体の安い順の1ページ目から」が実現する。
    const useSort = sortOverride || sort || "popular";
    setLoading(true);
    setSelected(null);
    setView("search");
    setSearchPage(1);
    // 検索履歴に記録(候補チップ・カテゴリタイルのパーソナライズに使用)
    setSearchHistory((prev) => {
      const next = [kw, ...prev.filter((x) => x !== kw)].slice(0, 20);
      try { localStorage.setItem("searchHistory", JSON.stringify(next)); } catch {}
      return next;
    });
    try {
      const floor = getJunkFloor(kw);
      const ceil = useSort === "high" ? HIGH_SORT_MAX : null;
      const [yahooRes, rakutenOffers, amazonRes] = await Promise.all([
        fetch(`/api/search?q=${encodeURIComponent(kw)}&sort=${useSort}&min=${floor}${ceil ? `&max=${ceil}` : ""}`).then((r) => r.json()).catch(() => ({ offers: [] })),
        searchRakutenClient(kw, 30, 1, RAKUTEN_SORT[useSort] || "standard", floor, ceil),
        // Amazonの商品データ(Creators API)はアソシエイト規約の確認が済むまで取得しない
        AMAZON_AFFILIATE_ON
          ? fetch(`/api/amazon/search?q=${encodeURIComponent(kw)}`).then((r) => r.json()).catch(() => ({ items: [], status: "error" }))
          : Promise.resolve({ items: [], status: "disabled" }),
      ]);
      setLastQuery(kw);
      setAmazonStatus(amazonRes.status || "disabled");
      // 取得順を保持するseqを付与(Yahoo偶数・楽天奇数で1件ずつ交互に混ざる)
      const yOffers = (yahooRes.offers || []).map((o, i) => ({ ...o, seq: i * 2 }));
      const rOffers = rakutenOffers.map((o, i) => ({ ...o, seq: i * 2 + 1 }));
      const aOffers = (amazonRes.items || []).map((o, i) => ({ ...o, seq: 100000 + i }));
      const all = [...yOffers, ...rOffers, ...aOffers];
      setRawOffers(all);
      // モール横断で名寄せ(表示順はseq/価格で後段が決める)
      const products = mergeOffers(all).slice(0, 500);
      setResults({ query: kw, products, sortKey: useSort });
      // 検索便乗記録: DBのI/O消費が大きいため既定では無効(lib/writePolicy.js)。
      // 有効時も上位RECORD_LIMIT件・30分に1回までに制限する
      try {
        if (RECORD_ON_SEARCH && canRecordNow()) {
          const items = products.slice(0, RECORD_LIMIT).flatMap((p) =>
            (p.key || p.jan) ? p.offers.map((o) => ({ jan: p.key || p.jan, store: o.store, price: o.price })) : []
          );
          if (items.length) {
            fetch("/api/record-prices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items }),
            });
          }
        }
      } catch {}
    } catch {
      setResults({ error: true, products: [] });
    }
    setLoading(false);
  };

  // さらに読み込む: 次ページを楽天+Yahoo!から取得して累積マージ
  const loadMore = async () => {
    if (!results?.query || loadingMore) return;
    setLoadingMore(true);
    const next = searchPage + 1;
    try {
      const floor2 = getJunkFloor(results.query);
      const ceil2 = sort === "high" ? HIGH_SORT_MAX : null;
      const [yahooRes, rakutenOffers] = await Promise.all([
        fetch(`/api/search?q=${encodeURIComponent(results.query)}&page=${next}&sort=${sort}&min=${floor2}${ceil2 ? `&max=${ceil2}` : ""}`).then((r) => r.json()).catch(() => ({ offers: [] })),
        searchRakutenClient(results.query, 30, next, RAKUTEN_SORT[sort] || "standard", floor2, ceil2).catch(() => []),
      ]);
      // 追加ページは既存より必ず後ろのseq(=先頭が入れ替わらない)
      const base = next * 100000;
      const yNew = (yahooRes.offers || []).map((o, i) => ({ ...o, seq: base + i * 2 }));
      const rNew = rakutenOffers.map((o, i) => ({ ...o, seq: base + i * 2 + 1 }));
      const all = [...rawOffers, ...yNew, ...rNew];
      setRawOffers(all);
      setSearchPage(next);
      // サーバーが返した順序を維持(再ソートしない)
      const products = mergeOffers(all).slice(0, 500);
      setResults({ query: results.query, products, sortKey: sort });
      // 検索便乗記録: DBのI/O消費が大きいため既定では無効(lib/writePolicy.js)。
      // 有効時も上位RECORD_LIMIT件・30分に1回までに制限する
      try {
        if (RECORD_ON_SEARCH && canRecordNow()) {
          const items = products.slice(0, RECORD_LIMIT).flatMap((p) =>
            (p.key || p.jan) ? p.offers.map((o) => ({ jan: p.key || p.jan, store: o.store, price: o.price })) : []
          );
          if (items.length) {
            fetch("/api/record-prices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items }),
            });
          }
        }
      } catch {}
    } catch {}
    setLoadingMore(false);
  };

  // 商品詳細を開く共通処理(閲覧履歴に記録)
  const openProduct = (p) => {
    if (!p) return;
    const pk0 = p.pkey || p.key || p.jan;
    window.history.pushState({ detail: true }, "", pk0 ? productPath(pk0) : undefined);
    setSelected(p);
    window.scrollTo(0, 0);
    const key = p.key || p.jan;
    if (!key) return;
    setViewHistory((prev) => {
      const entry = { key, name: p.name, image: p.image, price: p.offers ? Math.min(...p.offers.map((o) => o.price)) : null, store: p.offers?.[0]?.store, at: Date.now() };
      const next = [entry, ...prev.filter((x) => x.key !== key)].slice(0, 30);
      try { localStorage.setItem("viewHistory", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // 最近見た商品・関連商品から詳細を開く(その商品だけ再取得)。
  // どのモールにも見つからない商品は開けないため、そのキーを端末内に記録する。
  const openFromList = async (w) => {
    setLoading(true);
    const key = w.jan;
    try {
      const q = /^\d{8,13}$/.test(w.jan) ? w.jan : w.name;
      const [yahooRes, rakutenOffers] = await Promise.all([
        fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => ({ offers: [] })),
        searchRakutenClient(q).catch(() => []),
      ]);
      const products = mergeOffers([...(yahooRes.offers || []), ...rakutenOffers]);
      // JAN/キーが一致する商品を優先、無ければ先頭
      const match = products.find((p) => (p.key || p.jan) === w.jan) || products[0];
      if (match) {
        setResults({ query: w.name, products });
        openProduct(match);
        if (key) {
          markOpenable(key, true); // 開けたのでグレー解除
        }
      } else {
        setResults({ query: q, products });
        setSelected(null);
        if (key) markOpenable(key, false);
        alert("この商品は現在どのモールでも見つからないため、詳細を開けません。\n(取り扱い終了・商品名の変更などが考えられます)");
      }
    } catch {
      alert("商品の取得に失敗しました。時間をおいて試してください。");
    }
    setLoading(false);
  };

  // 開ける/開けないの記録(localStorageに保存し、次回起動時も維持)
  const markOpenable = (key, ok) => {
    setUnopenable((prev) => {
      const next = ok ? prev.filter((k) => k !== key) : (prev.includes(key) ? prev : [...prev, key]);
      try { localStorage.setItem("unopenableKeys", JSON.stringify(next.slice(-300))); } catch {}
      return next;
    });
  };

  // 異常値の除外: 全商品の最安値の中央値を基準に、極端に安い/高いものを弾く
  //   - 中央値の20%未満 = セット売りの1個単価や誤登録・部品などの可能性
  //   - 中央値の5倍超 = まとめ買い・業務用ロット・別物の可能性
  const filteredProducts = (() => {
    if (!results?.products) return [];
    const floor = getJunkFloor(results.query || "");
    const queryHasNoise = NOISE_WORDS.test(results.query || "");
    return results.products.map((p) => augmentProduct(p, catalog.get(p.key || p.jan))).filter((p) => {
      const min = Math.min(...p.offers.map((o) => o.price));
      if (!Number.isFinite(min) || min < floor) return false;
      // 検索語自体がノイズ語でない限り、宿泊券・ふるさと納税等の混入を除外
      if (!queryHasNoise && NOISE_WORDS.test(p.name || "")) return false;
      return true;
    });
  })();

  // モール絞り込み・評価絞り込みを適用
  const chipFiltered = filteredProducts.filter((p) => {
    if (mallFilter !== "all" && !p.offers.some((o) => o.store === mallFilter)) return false;
    if (ratingFilter && !(p.rating >= 4)) return false;
    return true;
  });

  // 並び順: サーバーが各モールをソート済みだが、名寄せでモール順に固まるため、
  // 名寄せ後のグループを選択中のソートキーで並べ直す(全体からの正しい並び)。
  // 価格系はグループ最安値、評価系はグループ代表値を使う。単価は別途下で処理。
  const applySort = (list, key) => {
    const arr = [...list];
    const minP = (p) => Math.min(...p.offers.map((o) => o.price));
    // 価格系: 各モールがソート済みの列を価格でマージ(=正しい全体順。追加読込でも先頭は不変)
    if (key === "cheap") return arr.sort((a, b) => minP(a) - minP(b));
    if (key === "high") return arr.sort((a, b) => minP(b) - minP(a));
    // 人気・評価・レビュー系: サーバーが返した順序(seq)をそのまま維持する。
    // クライアントで独自に再計算すると、追加読み込みのたびに先頭が入れ替わるため
    return arr.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
  };

  // 並び順はサーバー取得+名寄せ後にソートキーで全体を並べ替える。
  // 「単価が安い順」のみ専用計算。
  const sorted = results?.products
    ? (sort === "unit"
        ? [...chipFiltered].sort((a, b) => {
            const ua = unitPriceLabel(Math.min(...a.offers.map((o) => o.price)), a.name)?.per ?? Infinity;
            const ub = unitPriceLabel(Math.min(...b.offers.map((o) => o.price)), b.name)?.per ?? Infinity;
            return ua - ub;
          })
        : applySort(chipFiltered, sort))
    : [];

  // 実質価格に使う還元率:ステータスを設定していれば、今日のセール分を足したもの
  const effRates = status ? ratesForPrice(status, rates, new Date(), saleEvents) : rates;

  return (
    <div style={{ minHeight: "100vh", background: "#F0F6F4", fontFamily: "'Hiragino Sans','Noto Sans JP',-apple-system,sans-serif", color: "#16324F" }}>
      <header style={{ background: "#16324F", padding: "14px 16px 0", position: "sticky", top: 0, zIndex: 10 }}>
        <div className="oud-wrap">
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <span style={{ color: "#fff", fontWeight: 800, fontSize: 17 }}>オウダン</span>
            <span style={{ color: "#A8C3D9", fontSize: 10.5, fontWeight: 600 }}>
              実質価格で比べる横断検索
              {amazonStatus === "ok" && " ・ Amazon対応中"}
            </span>
          </div>
          <div className="oud-search" style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="商品名・キーワード(例:シャンプー)"
              style={{ flex: 1, border: "none", borderRadius: 10, padding: "11px 14px", fontSize: 16, outline: "none" }}
            />
            <button onClick={() => doSearch()} style={{ background: "#10B981", color: "#fff", border: "none", borderRadius: 10, padding: "0 18px", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>
              検索
            </button>
          </div>
          {/* タブ */}
          <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
            {[
              ["home", "ホーム"],
              ["search", "検索"],
              ["mypage", "設定"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setView(key); setSelected(null); }}
                style={{
                  flex: 1, background: "none", border: "none", cursor: "pointer",
                  padding: "8px 0", fontSize: 12, fontWeight: 700,
                  color: view === key ? "#34D399" : "#A8C3D9",
                  borderBottom: view === key ? "2.5px solid #34D399" : "2.5px solid transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="oud-wrap" style={{ padding: "16px 16px 48px" }}>
        {/* ===== ホームタブ ===== */}
        {view === "home" && !selected && (
          <div>
            {/* カテゴリから探す(購買導線) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 18 }}>
              {personalCategories(viewHistory, searchHistory, 8).map((kw) => [CATEGORY_ICONS[kw] || "🛒", kw]).map(([icon, kw]) => (
                <button key={kw} onClick={() => { setQuery(kw); doSearch(kw); }}
                  style={{ background: "#fff", border: "1px solid #DDE9E4", borderRadius: 12, padding: "12px 4px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 22 }}>{icon}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#334155", textAlign: "center", lineHeight: 1.2 }}>{kw}</span>
                </button>
              ))}
            </div>

            {/* v20: 今日の還元率(あなたのステータス)と、セールカレンダー */}
            <TodayStrip status={status} baseRates={rates} sheetEvents={saleEvents}
              onEdit={() => { setView("mypage"); setStatusOpen(true); setTimeout(() => document.getElementById("oud-status")?.scrollIntoView({ behavior: "smooth" }), 50); }} />
            <SaleCalendarList sheetEvents={saleEvents} loaded={saleLoaded} />

            {/* v22: おすすめ・お得・急上昇(自動取得のDBから。3サイトの価格つき) */}
            <TopPicks rates={effRates} />
            <p style={{ fontSize: 10, color: "#94A3B8", marginTop: 10 }}>【PR】商品ページの購入リンクにはアフィリエイトリンクが含まれます。</p>
          </div>
        )}

        {/* ===== あなたのステータス(v20) ===== */}
        {view === "mypage" && !selected && status && (
          <div id="oud-status" style={{ ...card, marginBottom: 14, border: statusOpen ? "2px solid #10B981" : card.border }}>
            <StatusForm status={status} onSave={(st) => { setStatus(saveStatus(st)); setStatusOpen(false); }} />
          </div>
        )}

        {/* ===== マイページタブ ===== */}
        {view === "mypage" && !selected && (
          <div>
            {/* モール別ショートカット */}
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: "18px 0 4px" }}>各モールのよく使うページ</h2>
            <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 10px" }}>
              「注文どこ?」「返品したい」に迷ったらここから。各モールのページが開きます(ログインは各モールで)。
            </p>
            {[
              {
                store: "rakuten",
                links: [
                  ["注文履歴", "https://order.my.rakuten.co.jp/"],
                  ["ポイント残高", "https://point.rakuten.co.jp/"],
                  ["返品・キャンセル/ヘルプ", "https://ichiba.faq.rakuten.net/"],
                ],
              },
              {
                store: "yahoo",
                links: [
                  ["注文履歴", "https://odhistory.shopping.yahoo.co.jp/order-history/list"],
                  ["PayPayポイント残高", "https://points.yahoo.co.jp/"],
                  ["返品・キャンセル/ヘルプ", "https://support.yahoo-net.jp/PccShopping/s/"],
                ],
              },
              {
                store: "amazon",
                links: [
                  ["注文履歴", "https://www.amazon.co.jp/gp/css/order-history"],
                  ["ポイント残高", "https://www.amazon.co.jp/mypoints"],
                  ["返品・交換", "https://www.amazon.co.jp/gp/css/returns/homepage.html"],
                  ["ヘルプ", "https://www.amazon.co.jp/gp/help/customer/display.html"],
                ],
              },
            ].map(({ store, links }) => (
              <div key={store} style={{ ...card, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: (STORES[store]?.color || "#64748B"), marginBottom: 8 }}>
                  {STORES[store].name}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {links.map(([label, url]) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, fontWeight: 700, color: "#16324F", background: "#EAF3F0", border: "1px solid #CBD5E1", borderRadius: 999, padding: "7px 13px", textDecoration: "none" }}>
                      {label} ↗
                    </a>
                  ))}
                </div>
              </div>
            ))}

            {/* クーポン・キャンペーン */}
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: "18px 0 4px" }}>クーポン・エントリー必須キャンペーン</h2>
            <p style={{ fontSize: 11.5, color: "#64748B", margin: "0 0 10px" }}>
              エントリーやクーポン取得を忘れるとポイントが付きません。買う前にここでチェック。
            </p>
            {[
              {
                store: "rakuten",
                links: [
                  ["クーポン一覧", "https://coupon.rakuten.co.jp/"],
                  ["5と0のつく日エントリー", "https://event.rakuten.co.jp/campaign/point/50days/"],
                  ["開催中キャンペーン", "https://event.rakuten.co.jp/campaign/point/"],
                ],
              },
              {
                store: "yahoo",
                links: [
                  ["クーポン一覧", "https://shopping.yahoo.co.jp/coupon/"],
                  ["5のつく日キャンペーン", "https://shopping.yahoo.co.jp/campaign/5day/"],
                  ["ズバトク(開催中特典)", "https://toku.yahoo.co.jp/"],
                ],
              },
              {
                store: "amazon",
                links: [
                  ["クーポン", "https://www.amazon.co.jp/coupons"],
                  ["タイムセール", "https://www.amazon.co.jp/deals"],
                  ["ポイントアップキャンペーン", "https://www.amazon.co.jp/events"],
                ],
              },
            ].map(({ store, links }) => (
              <div key={"c-" + store} style={{ ...card, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: (STORES[store]?.color || "#64748B"), marginBottom: 8 }}>
                  {STORES[store].name}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {links.map(([label, url]) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, fontWeight: 700, color: "#065F46", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 999, padding: "7px 13px", textDecoration: "none" }}>
                      🎫 {label} ↗
                    </a>
                  ))}
                </div>
              </div>
            ))}

          </div>
        )}

        {/* ===== プロフィール設定(端末内にのみ保存) ===== */}
        {view === "mypage" && !selected && (
          <div style={{ ...card, marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginTop: 0 }}>あなたの条件(この端末にのみ保存)</h2>
            <p style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.7, margin: "0 0 12px" }}>
              ここで設定した内容は<b>この端末の中だけに保存</b>され、オウダンのサーバーには送信されません。
              ブラウザのデータを消せばいつでも削除できます。
            </p>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 5 }}>お住まいの都道府県</div>
              <div style={{ fontSize: 11, color: "#64748B", marginBottom: 5 }}>送料が高くなりやすい地域の注意を出します。</div>
              <select
                value={profile.pref || ""}
                onChange={(e) => setProfileField("pref", e.target.value)}
                style={{ border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 10px", fontSize: 16, background: "#fff", maxWidth: 200 }}
              >
                <option value="">未設定</option>
                {PREFS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {profile.pref && shippingHint(profile.pref) && (
                <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 6 }}>
                  送料の傾向: <b>{shippingHint(profile.pref).extra}</b> — {shippingHint(profile.pref).note}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 5 }}>お持ちのカード(券種のみ)</div>
              <div style={{ fontSize: 11, color: "#B0483C", fontWeight: 700, marginBottom: 5 }}>
                ⚠ カード番号は入力しないでください。オウダンは番号を扱いません。
              </div>
              <select
                value={profile.card || ""}
                onChange={(e) => applyCardPreset(e.target.value)}
                style={{ border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 10px", fontSize: 16, background: "#fff", maxWidth: 280 }}
              >
                <option value="">未設定</option>
                {CARD_PRESETS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 5 }}>
                選ぶと下の還元率が目安の値に切り替わります。実際の条件に合わせて手動で調整できます。
              </div>
            </div>

            <a href="/privacy" style={{ display: "inline-block", fontSize: 11.5, fontWeight: 700, color: "#16324F", marginTop: 10 }}>
              プライバシーポリシーを読む ↗
            </a>
          </div>
        )}

        {/* ===== 設定セクション(マイページ内) ===== */}
        {view === "mypage" && !selected && (
          <div style={card}>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginTop: 0 }}>ポイント還元率の設定</h2>
            {status?.set && (
              <p style={{ fontSize: 11.5, color: "#065F46", background: "#ECFDF5", borderRadius: 8, padding: "7px 10px" }}>
                上の「あなたのステータス」を保存済みのため、実質価格はステータスの値(+今日のセール分)で計算しています。
              </p>
            )}
            <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
              あなたの各モールのポイント還元率(%)を入力すると、全商品の比較が
              「実質価格(価格−ポイント分)」で並び替わります。
              例: 楽天SPUが7倍なら「7」、PayPayステップ合計5%なら「5」。
            </p>
            {Object.keys(STORES).map((s) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ width: 90, fontSize: 13, fontWeight: 700, color: (STORES[s]?.color || "#64748B") }}>{STORES[s].name}</span>
                <input
                  type="number" min="0" max="50" step="0.5"
                  value={rates[s] ?? 0}
                  onChange={(e) => saveRates({ ...rates, [s]: parseFloat(e.target.value) || 0 })}
                  style={{ width: 80, border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 10px", fontSize: 16 }}
                />
                <span style={{ fontSize: 12.5, color: "#64748B" }}>%</span>
              </div>
            ))}
            <p style={{ fontSize: 10.5, color: "#94A3B8", lineHeight: 1.6 }}>
              設定はこの端末に保存されます。SPUやキャンペーンの実際の付与率・上限は各モールでご確認ください。
            </p>

          </div>
        )}

        {/* ===== 検索タブ ===== */}
        {/* 商品詳細はどのタブからでも開ける。閉じると開いた元のタブ(検索/リスト/履歴)に戻る */}
        {selected && (
          <Detail
            product={selected}
            backLabel={view === "home" ? "ホームに戻る" : view === "mypage" ? "設定に戻る" : "検索結果に戻る"}
            profile={profile}
            rates={effRates}
            viewHistory={viewHistory}
            onOpenRelated={(it) => openFromList({ jan: it.key || it.jan, name: it.name, image: it.image })}
          />
        )}

        {view === "search" && !selected && (
          loading ? (
            <p style={{ textAlign: "center", color: "#64748B", fontSize: 13, padding: 40 }}>各モールを検索中…</p>
          ) : results ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 12.5, color: "#64748B" }}>「{results.query}」 {sorted.length}件</span>
                <select
                  value={sort}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSort(v);
                    // 単価順以外はサーバーに並べ替えを投げ、カタログ全体からの並びを取り直す
                    if (v !== "unit" && results?.query) {
                      doSearch(results.query, v);
                    }
                  }}
                  style={{ fontSize: 12, border: "1px solid #CBD5E1", borderRadius: 8, padding: "6px 8px", background: "#fff", maxWidth: 180 }}
                >
                  <optgroup label="価格で並べる">
                    <option value="cheap">安い順(実質価格)</option>
                    <option value="high">高い順</option>
                    <option value="unit">単価が安い順(1mlあたり)</option>
                  </optgroup>
                  <optgroup label="人気・評価で並べる">
                    <option value="popular">人気順(売れ筋)</option>
                    <option value="reviews">レビュー件数が多い順</option>
                    <option value="rating">評価が高い順</option>
                  </optgroup>
                </select>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
                {[["all", "すべて"], ["rakuten", "楽天"], ["yahoo", "Yahoo!"], ["amazon", "Amazon"]].map(([k, label]) => (
                  <button key={k} onClick={() => setMallFilter(k)}
                    style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 16, padding: "5px 13px", cursor: "pointer",
                      background: mallFilter === k ? "#16324F" : "#fff",
                      color: mallFilter === k ? "#fff" : "#475569",
                      border: `1px solid ${mallFilter === k ? "#16324F" : "#CBD5E1"}` }}>
                    {label}
                  </button>
                ))}
                <button onClick={() => setRatingFilter((v) => !v)}
                  style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 16, padding: "5px 13px", cursor: "pointer",
                    background: ratingFilter ? "#F59E0B" : "#fff",
                    color: ratingFilter ? "#fff" : "#475569",
                    border: `1px solid ${ratingFilter ? "#F59E0B" : "#CBD5E1"}` }}>
                  ★4以上
                </button>
              </div>
              <div className="oud-grid">
              {sorted.map((p, i) => {
                const bestOffer = [...p.offers].sort((a, b) => effectivePrice(a, effRates) - effectivePrice(b, effRates))[0];
                const s = STORES[bestOffer.store];
                const eff = effectivePrice(bestOffer, effRates);
                const unit = unitPriceLabel(bestOffer.price, p.name);
                // v19: いちばん安いサイトの「90日中央値との差・3か月で何番目」
                const st = statsFor(bestOffer.price, p.db?.offers?.[bestOffer.store]);
                const lab = statsLabel(st);
                return (
                  <button key={p.key || p.jan || i} onClick={() => openProduct(p)} style={{ ...card, position: "relative", display: "flex", gap: 12, width: "100%", textAlign: "left", cursor: "pointer", marginBottom: 10 }}>
                    {p.image ? (
                      <img src={p.image} alt="" style={{ width: 96, height: 96, objectFit: "contain", borderRadius: 10, background: "#EAF3F0", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 96, height: 96, borderRadius: 10, background: "#EAF3F0", flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {p.name}
                      </div>
                      {p.reviews > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                          <span style={{ fontSize: 12, color: "#F59E0B", letterSpacing: -1 }}>
                            {"★".repeat(Math.round(p.rating))}{"☆".repeat(Math.max(0, 5 - Math.round(p.rating)))}
                          </span>
                          <span style={{ fontSize: 10.5, color: "#64748B" }}>{p.rating.toFixed(1)}({p.reviews.toLocaleString()})</span>
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.5 }}>{yen(bestOffer.price)}</span>
                        <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>実質 {yen(eff)}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: s.color, border: `1px solid ${s.color}`, borderRadius: 4, padding: "1px 5px" }}>
                          {s.short}
                        </span>
                      </div>
                      <MiniCompare offers={p.offers} dbOffers={p.db?.offers} rates={effRates} />
                      <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                        {st && st.days >= 7 && lab.tone === "good" && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#065F46", background: "#D1FAE5", border: "1px solid #10B981", borderRadius: 4, padding: "2px 6px" }}>
                            📉 {lab.main}
                          </span>
                        )}
                        {st && st.days >= 7 && st.isLowest && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#155E75", background: "#CFFAFE", border: "1px solid #06B6D4", borderRadius: 4, padding: "2px 6px" }}>
                            🏆 3か月で最安値
                          </span>
                        )}
                        {st && st.days >= 7 && lab.tone === "bad" && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#92400E", background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 4, padding: "2px 6px" }}>
                            🟡 {lab.main}
                          </span>
                        )}
                        {p.offers.length > 1 && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#0F766E", background: "#CCFBF1", borderRadius: 4, padding: "2px 6px" }}>
                            {new Set(p.offers.map((o) => o.store)).size}サイトで比較
                          </span>
                        )}
                        {unit && (
                          <span style={{ fontSize: 10, color: "#64748B", background: "#F1F5F9", borderRadius: 4, padding: "2px 6px" }}>{unit.label}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
              </div>
              {searchPage < 9 && sorted.length >= 15 && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{ width: "100%", marginTop: 12, background: "#fff", color: "#16324F", border: "1.5px solid #16324F", borderRadius: 12, padding: "13px 0", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}
                >
                  {loadingMore ? "読み込み中…" : `さらに商品を読み込む(現在${sorted.length}件・最大500件)`}
                </button>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "48px 16px" }}>
              <p style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>
                キーワード検索で、各モールの
                <br />
                「ポイント込みの実質価格」を比較できます
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
                {[...new Set([...searchHistory.slice(0, 3), ...personalCategories(viewHistory, searchHistory, 6)])].slice(0, 6).map((w) => (
                  <button key={w} onClick={() => { setQuery(w); doSearch(w); }} style={{ fontSize: 12.5, fontWeight: 600, background: "#fff", border: "1px solid #CBD5E1", borderRadius: 999, padding: "7px 14px", cursor: "pointer" }}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
          )
        )}

        {/* 最近見た商品(ホーム・検索・リストの下部に共通表示。詳細表示中は出さない) */}
        {!selected && ["home", "list", "search"].includes(view) && viewHistory.length > 0 && (
          <ProductStrip
            title="最近見た商品"
            subtitle="タップでもう一度チェック"
            items={viewHistory}
            onOpen={(it) => openFromList({ jan: it.key, name: it.name, image: it.image })}
          />
        )}
      </main>

      {/* セール詳細ポップアップ */}
      {saleModal && (
        <div
          onClick={() => setSaleModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 420, width: "100%", maxHeight: "80vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: STORES[saleModal.store]?.color || "#64748B", borderRadius: 4, padding: "2px 8px" }}>
                {STORES[saleModal.store]?.short || saleModal.store}
              </span>
              {saleModal.status && (
                <span style={{ fontSize: 11, fontWeight: 800, color: "#1D4ED8", background: "#DBEAFE", borderRadius: 4, padding: "2px 8px" }}>{saleModal.status}</span>
              )}
              <button onClick={() => setSaleModal(null)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 22, color: "#94A3B8", cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 10px", color: "#16324F" }}>{saleModal.name}</h3>
            {saleModal.period_text && (
              <div style={{ fontSize: 13, color: "#334155", marginBottom: 8 }}>🗓 開催期間: {saleModal.period_text}</div>
            )}
            {saleModal.summary && (
              <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.7, marginBottom: 14 }}>{saleModal.summary}</p>
            )}
            {saleModal.url ? (
              <a href={saleModal.url} target="_blank" rel="noopener noreferrer sponsored"
                style={{ display: "block", textAlign: "center", background: "#10B981", color: "#fff", borderRadius: 10, padding: "12px 0", fontSize: 14, fontWeight: 800, textDecoration: "none" }}>
                セール会場を見る ↗
              </a>
            ) : (
              <div style={{ fontSize: 12, color: "#94A3B8", textAlign: "center" }}>会場URLは登録されていません</div>
            )}
          </div>
        </div>
      )}

      {/* 今後のセール一覧ポップアップ */}
      {upcomingModal && (
        <div
          onClick={() => setUpcomingModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 460, width: "100%", maxHeight: "82vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: "#16324F" }}>📅 今後のセール({upcomingModal.length}件)</h3>
              <button onClick={() => setUpcomingModal(null)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 24, color: "#94A3B8", cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {upcomingModal.map((ev, i) => (
                <div key={i} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "12px 13px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: STORES[ev.store]?.color || "#64748B", borderRadius: 4, padding: "2px 7px" }}>
                      {STORES[ev.store]?.short || ev.store}
                    </span>
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: "#1D4ED8", background: "#DBEAFE", borderRadius: 4, padding: "2px 7px" }}>今後開催</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#1E3A8A", marginBottom: 4 }}>{ev.name}</div>
                  {ev.period_text && <div style={{ fontSize: 12, color: "#475569", marginBottom: 3 }}>🗓 {ev.period_text}</div>}
                  {ev.summary && <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6 }}>{ev.summary}</div>}
                  {ev.url && (
                    <a href={ev.url} target="_blank" rel="noopener noreferrer sponsored"
                      style={{ display: "inline-block", marginTop: 8, fontSize: 12, fontWeight: 700, color: "#10B981", textDecoration: "none" }}>
                      セール会場を見る ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* フッター: プライバシーポリシーへの導線(公開前に必須) */}
      <footer style={{ marginTop: 28, paddingTop: 14, borderTop: "1px solid #DDE9E4", textAlign: "center" }}>
        {COLLECTIONS_ON && <a href="/c" style={{ fontSize: 11.5, color: "#64748B", textDecoration: "none", marginRight: 14 }}>商品まとめ</a>}
        <a href="/privacy" style={{ fontSize: 11.5, color: "#64748B", textDecoration: "none" }}>プライバシーポリシー</a>
        <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 6, lineHeight: 1.6 }}>
          【PR】本サイトは楽天アフィリエイト・バリューコマース・Amazonアソシエイトを利用しています。
        </div>
      </footer>
    </div>
  );
}
const card = { background: "#fff", border: "1px solid #DDE9E4", borderRadius: 14, padding: 16 };
const btnGhost = { background: "none", border: "none", color: "#64748B", fontSize: 12, cursor: "pointer", padding: "4px 0" };
const sectionTitle = { fontSize: 12, fontWeight: 700, color: "#64748B", letterSpacing: 1.5, margin: "20px 0 10px" };
