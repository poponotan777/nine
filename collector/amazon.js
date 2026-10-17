// ============================================================
// Amazon(Creators API)の自動取得
//   午前:ブランド全件の1ページ目 / 午後:ブランド全件の2ページ目
//   どちらも最後に他サイト補完(ASINが分かっている商品は10件まとめて取り直し)
//   間隔:1.2秒に1回。1回の実行で AMAZON_MAX_PER_RUN 回まで(初期900回)
//
//   ※ Amazon の上限は「1日8,640回」で、Xツール(PC)と同じ認証情報なら合算されます。
//      Xツールの価格更新(track)と合わせて 8,000回を超えないようにしてください。
//   ※ 売れ筋ランキングの一覧APIは無いため、取得した商品の「売れ筋順位」を記録します。
// ============================================================

import { isSameProduct, normalizeName } from "../lib/merge.js";
import { BRANDS } from "./brands.js";
import { Pacer, Writer, log, rpc, cleanText, cleanName, enrich, NOISE, isJan, shortQuery, pickSame } from "./core.js";

const API = "https://creatorsapi.amazon/catalog/v1";
const MARKETPLACE = "www.amazon.co.jp";
const TOKEN_ENDPOINTS = {
  "3.1": ["lwa", "https://api.amazon.com/auth/o2/token"],
  "3.2": ["lwa", "https://api.amazon.co.uk/auth/o2/token"],
  "3.3": ["lwa", "https://api.amazon.co.jp/auth/o2/token"],
  "2.1": ["cognito", "https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token"],
  "2.2": ["cognito", "https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token"],
  "2.3": ["cognito", "https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token"],
};
const RESOURCES = [
  "images.primary.large",
  "itemInfo.title",
  "itemInfo.features",
  "itemInfo.byLineInfo",
  "itemInfo.externalIds",
  "browseNodeInfo.websiteSalesRank",
  "offersV2.listings.price",
  "offersV2.listings.dealDetails",
  "offersV2.listings.loyaltyPoints",
  "offersV2.listings.isBuyBoxWinner",
  "offersV2.listings.availability",
  "offersV2.listings.type",
  "offersV2.listings.merchantInfo",
];

const cfg = () => ({
  id: process.env.AMAZON_CLIENT_ID || "",
  secret: process.env.AMAZON_CLIENT_SECRET || "",
  version: process.env.AMAZON_CREDENTIAL_VERSION || "3.3",
  tag: process.env.AMAZON_PARTNER_TAG || "popo-kaiteki-22",
});
export const amazonReady = () => !!(cfg().id && cfg().secret);

let token = null;
let tokenExp = 0;
async function getToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  const c = cfg();
  const ep = TOKEN_ENDPOINTS[c.version];
  if (!ep) throw new Error(`AMAZON_CREDENTIAL_VERSION「${c.version}」は未対応です(日本は通常3.3)`);
  const [kind, url] = ep;
  let res;
  if (kind === "lwa") {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: c.id, client_secret: c.secret, scope: "creatorsapi::default" }),
    });
  } else {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${c.id}:${c.secret}`).toString("base64"),
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "creatorsapi/default" }),
    });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Amazonの認証に失敗(${res.status}) ${JSON.stringify(j).slice(0, 200)}`);
  token = j.access_token;
  tokenExp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return token;
}

async function call(pacer, op, body, label) {
  const c = cfg();
  const t = await getToken();
  const auth = c.version.startsWith("3") ? `Bearer ${t}` : `Bearer ${t}, Version ${c.version}`;
  return pacer.fetchJson(`${API}/${op}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", "x-marketplace": MARKETPLACE },
    body: JSON.stringify({ marketplace: MARKETPLACE, partnerTag: c.tag, resources: RESOURCES, ...body }),
  }, { label, retries: 3 });
}

const dig = (o, ...ks) => ks.reduce((a, k) => (a == null ? a : a[k]), o);

// タグを確実に付ける(APIは partnerTag 付きのURLを返すが、念のため)
function withTag(url, tag) {
  try { const u = new URL(url); u.searchParams.set("tag", tag); return u.toString(); } catch { return url; }
}

export function amazonRow(it, extra = {}) {
  const asin = it.asin || it.ASIN;
  const listings = dig(it, "offersV2", "listings") || [];
  const lst = listings.find((l) => l.dealDetails && l.isBuyBoxWinner) || listings.find((l) => l.dealDetails)
    || listings.find((l) => l.isBuyBoxWinner) || listings[0] || {};
  const price = Number(dig(lst, "price", "money", "amount"));
  const rawName = cleanText(dig(it, "itemInfo", "title", "displayValue"), 300);
  const name = cleanName(rawName);
  if (!asin || !name || !(price > 0) || NOISE.test(rawName)) return null;
  const eans = dig(it, "itemInfo", "externalIds", "eans", "displayValues") || [];
  const jan = eans.find((e) => isJan(String(e))) || null;
  const deal = lst.dealDetails || null;
  const rankNode = dig(it, "browseNodeInfo", "websiteSalesRank") || {};
  const pts = Number(dig(lst, "loyaltyPoints", "points")) || 0;
  const was = Number(dig(lst, "price", "savingBasis", "money", "amount")) || null;
  const brand = cleanText(dig(it, "itemInfo", "byLineInfo", "brand", "displayValue"), 60) || null;
  const features = dig(it, "itemInfo", "features", "displayValues") || [];
  let label = null;
  if (deal) {
    label = lst.type === "LIGHTNING_DEAL" ? "タイムセール"
      : /PRIME/.test(deal.accessType || "") ? "プライム限定" : "セール";
  }
  const row = {
    pkey: extra.pkey || (jan || `a:${asin}`),
    store: "amazon",
    code: asin,
    name,
    jan,
    brand,
    image: dig(it, "images", "primary", "large", "url") || dig(it, "images", "primary", "medium", "url") || null,
    price,
    list_price: was && was > price ? was : null,
    url: withTag(it.detailPageURL || `https://www.amazon.co.jp/dp/${asin}`, cfg().tag),
    shop: dig(lst, "merchantInfo", "name") || null,
    point_rate: pts > 0 ? Math.round((pts / price) * 1000) / 10 : null,
    sale_until: deal?.endTime || null,
    sale_label: label,
    catch: cleanText(features[0], 120) || null,
  };
  if (rankNode.salesRank) {
    row.rank = Number(rankNode.salesRank);
    row.rank_genre = rankNode.contextFreeName || rankNode.displayName || null;
    row.genre = row.rank_genre;
  }
  if (extra.aliases && extra.aliases.length) row.aliases = extra.aliases;
  if (extra.merge_from) row.merge_from = extra.merge_from;
  return enrich(row, { name: rawName, brandField: brand, catchcopy: features[0], text: features.join(" ") });
}

const searchItems = (j) => dig(j, "searchResult", "items") || dig(j, "SearchResult", "Items") || [];
const getItems = (j) => dig(j, "itemsResult", "items") || dig(j, "ItemsResult", "Items") || [];

async function brandSearch(pacer, writer, page) {
  let items = 0;
  for (const b of BRANDS.slice(0, Number(process.env.BRAND_LIMIT || BRANDS.length))) {
    if (!pacer.canGo()) break;
    const r = await call(pacer, "searchItems", { keywords: b.q, itemCount: 10, itemPage: page }, `ブランド ${b.q} p${page}`);
    if (r.status === 401 || r.status === 403) {
      pacer.stop("認証・権限エラー(タグやアカウントを確認してください)");
      break;
    }
    for (const it of r.ok ? searchItems(r.json) : []) {
      const row = amazonRow(it);
      if (row && row.is_brand) { writer.add(row); items++; }
    }
    await writer.flushIfFull();
  }
  return items;
}

async function fill(pacer, writer, n) {
  if (!pacer.canGo()) return { tried: 0, found: 0 };
  let list = [];
  try { list = (await rpc("take_fill", { _store: "amazon", _n: n })) || []; } catch (e) { log("[Amazon] 補完の予約を読めません", String(e).slice(0, 120)); return { tried: 0, found: 0 }; }
  const results = [];
  let found = 0;
  // 1) ASINが分かっている商品は10件ずつまとめて取り直す
  const withCode = list.filter((q) => q.code);
  for (let i = 0; i < withCode.length; i += 10) {
    if (!pacer.canGo()) break;
    const chunk = withCode.slice(i, i + 10);
    const r = await call(pacer, "getItems", { itemIds: chunk.map((q) => q.code), itemIdType: "ASIN" }, "取り直し");
    const got = new Map((r.ok ? getItems(r.json) : []).map((it) => [it.asin || it.ASIN, it]));
    for (const q of chunk) {
      const it = got.get(q.code);
      const row = it ? amazonRow(it, { pkey: q.pkey }) : null;
      if (row) { writer.add(row); found++; }
      results.push({ pkey: q.pkey, store: "amazon", found: !!row });
    }
    await writer.flushIfFull();
  }
  // 2) まだAmazonに無い商品は、JANか商品名で探す
  for (const q of list.filter((x) => !x.code)) {
    if (!pacer.canGo()) break;
    const keywords = q.jan || shortQuery(q.name, normalizeName);
    if (!keywords || keywords.length < 2) { results.push({ pkey: q.pkey, store: "amazon", found: false }); continue; }
    const r = await call(pacer, "searchItems", { keywords, itemCount: 10 }, `補完 ${keywords}`);
    const cands = (r.ok ? searchItems(r.json) : []).map((it) => {
      const row = amazonRow(it);
      return row ? { it, name: row.name, price: row.price, jan: row.jan } : null;
    }).filter(Boolean);
    const best = pickSame(cands, q.name, isSameProduct, { jan: q.jan });
    if (best) {
      const target = !isJan(q.pkey) && best.jan ? best.jan : q.pkey;
      const asinKey = `a:${best.it.asin || best.it.ASIN}`;
      const row = amazonRow(best.it, {
        pkey: target,
        merge_from: target !== q.pkey ? [q.pkey] : undefined,
        aliases: [best.jan, asinKey].filter((k, i, arr) => k && k !== target && arr.indexOf(k) === i),
      });
      if (row) { writer.add(row); found++; }
    }
    results.push({ pkey: q.pkey, store: "amazon", found: !!best });
    await writer.flushIfFull();
  }
  await writer.flush();
  try { await rpc("fill_done", { _items: results }); } catch {}
  return { tried: results.length, found };
}

export async function runAmazon({ clock, slot, day, noNew, dryRun }) {
  const stat = { store: "amazon", requests: 0, items: 0, errors: 0, note: "" };
  if (!amazonReady()) { stat.note = "Amazonのキーが未設定のためスキップ"; log("[Amazon]", stat.note); return stat; }
  const max = slot === "fill" ? Number(process.env.AMAZON_MAX_PER_FILL_RUN || 900) : Number(process.env.AMAZON_MAX_PER_RUN || 900);
  const pacer = new Pacer("Amazon", Math.max(process.env.TEST_FAST ? 0 : 1050, Number(process.env.AMAZON_INTERVAL_MS || 1200)), clock, { maxRequests: max });
  const writer = new Writer("amazon", { day, noNew, dryRun });
  try {
    await getToken();
    if (slot === "fill") {
      // 補完だけの回(v24):回数と残り時間の両方で上限
      const byTime = Math.floor((clock.left() - 30000) / pacer.interval);
      const f = await fill(pacer, writer, Math.max(0, Math.min(Number(process.env.AMAZON_FILL_ONLY || 2000), byTime)));
      stat.note = `補完だけの回 ${f.found}/${f.tried}件`;
      throw { done: true };
    }
    // 補完に回す分を残して、ブランド検索に使う
    const fillShare = Math.round(max * 0.3);
    pacer.maxRequests = max - fillShare;
    stat.items += await brandSearch(pacer, writer, slot === "am" ? 1 : 2);
    await writer.flush();
    pacer.maxRequests = max;
    if (pacer.stopReason === "1日の上限回数に達した") { pacer.stopped = false; pacer.stopReason = ""; }
    const f = await fill(pacer, writer, Number(process.env.AMAZON_FILL || 400));
    stat.note = `補完 ${f.found}/${f.tried}件`;
  } catch (e) {
    if (!e || !e.done) {
      stat.note = "エラー: " + String(e).slice(0, 200);
      log("[Amazon]", stat.note);
    }
  }
  await writer.flush();
  stat.requests = pacer.requests;
  stat.errors = pacer.errors;
  stat.written = writer.written;
  if (pacer.stopReason) stat.note += ` / ${pacer.stopReason}`;
  log(`[Amazon] 完了 リクエスト${stat.requests}回 書き込み${writer.written}件 ${stat.note}`);
  return stat;
}
