import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminOk } from "../../../../lib/adminAuth";

// Googleスプレッドシートからセール情報を取り込む
// シート列(1行目ヘッダー):
//   A:ステータス B:対象サイト C:セール名 D:期間 E:概要 F:URL

// 取得候補URLを列挙(先頭から順に試す)
// このシートのように先頭タブのgidが0でない場合、gid=0指定は HTTP 400 になる。
// そのため「gid指定なし(=先頭タブ)」を第一候補にする
function toCsvUrls(sheetUrl) {
  const idM = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idM) return [];
  const id = idM[1];
  const gidM = sheetUrl.match(/[#&?]gid=(\d+)/);
  const urls = [];
  if (gidM) urls.push({ url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gidM[1]}`, label: "gid指定" });
  urls.push({ url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, label: "先頭タブ" });
  // gvizはheaders=1を明示(自動ヘッダー検出が行を飲み込む事故を防ぐ)
  urls.push({ url: `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1`, label: "gviz" });
  return urls;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cell += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* skip */ }
      else cell += c;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function toStore(raw) {
  const s = (raw || "").toLowerCase();
  if (s.includes("楽天") || s.includes("rakuten")) return "rakuten";
  if (s.includes("yahoo") || s.includes("ヤフー") || s.includes("paypay")) return "yahoo";
  if (s.includes("amazon") || s.includes("アマゾン")) return "amazon";
  return null;
}

function extractDates(period) {
  if (!period) return { start: null, end: null };
  // 「2026年7月20日 〜 7月23日」のように後半の年が省略される形に対応するため、
  // 年付き・年なしの両方を1つの正規表現で走査し、年が無い日付は直前に出た年
  // (無ければ今年)を引き継ぐ。これを怠ると終了日に開始日が入る不具合になる。
  const re = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g;
  const dates = [];
  let lastYear = new Date().getFullYear();
  let m;
  while ((m = re.exec(period)) !== null) {
    const y = m[1] ? parseInt(m[1], 10) : lastYear;
    if (m[1]) lastYear = y;
    dates.push(`${y}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`);
  }
  if (dates.length === 0) return { start: null, end: null };
  // 「開始日〜」のように区切りの後ろに日付が無い=無期限 → 終了日は持たせない
  const SEP = /[〜～\-–—]/g;
  let lastSepIdx = -1, sm;
  while ((sm = SEP.exec(period)) !== null) lastSepIdx = sm.index;
  const openEnded = lastSepIdx >= 0 && !/(\d{1,2})月(\d{1,2})日/.test(period.slice(lastSepIdx + 1));
  // 日付が1つだけなら開始=終了(単日開催として終了日を持たせる)
  return { start: dates[0], end: openEnded ? null : dates[dates.length - 1] };
}

export async function POST(request) {
  try {
    const { key, sheetUrl } = await request.json();
    // v23: 合言葉はサーバー専用の ADMIN_KEY で確認(未設定なら旧 NEXT_PUBLIC_CRAWL_KEY)
    if (!adminOk(key)) {
      return NextResponse.json({ error: "合言葉が違います" }, { status: 403 });
    }
    const urls = toCsvUrls(sheetUrl || "");
    if (urls.length === 0) {
      return NextResponse.json({ error: "スプレッドシートのURLが正しくありません" }, { status: 400 });
    }

    const tryFetch = async (url) => {
      const r = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      const t = await r.text();
      return { ok: r.ok, status: r.status, text: t };
    };

    // 候補URLを順に試し、CSVらしきものが取れた時点で採用
    let rows = null;
    let lastStatus = 0;
    let usedRoute = "?";
    for (const cand of urls) {
      try {
        const got = await tryFetch(cand.url);
        lastStatus = got.status;
        if (!got.ok) continue;
        if (got.text.trimStart().startsWith("<")) continue; // ログインページHTML
        const parsed = parseCsv(got.text).filter((r) => r.some((c) => c && c.trim()));
        if (parsed.length >= 2) {
          rows = parsed;
          usedRoute = cand.label;
          break;
        }
      } catch {}
    }
    if (!rows) {
      return NextResponse.json(
        { error: `シートを読めませんでした(最後の応答: HTTP ${lastStatus})。共有が「リンクを知っている全員(閲覧者)」になっているか確認し、数分待ってから再試行してください` },
        { status: 400 }
      );
    }
    // ヘッダー行を検出(「ステータス」または「対象サイト」を含む行)。
    // gviz形式などで先頭に余計な行が入っても正しくデータ開始位置を見つける
    let headerIdx = rows.findIndex((r) =>
      r.some((c) => c && (c.includes("ステータス") || c.includes("対象サイト") || c.includes("セール名")))
    );
    if (headerIdx < 0) headerIdx = 0;

    const events = [];
    const skipped = [];
    const skippedDetail = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const [status, siteRaw, name, period, summary, url] = rows[i];
      const store = toStore(siteRaw);
      if (!name || !store) {
        skipped.push(i + 1);
        skippedDetail.push({ row: i + 1, status: status || "", site: siteRaw || "", name: name || "", reason: !name ? "セール名が空" : "対象サイト未判定" });
        continue;
      }
      const { start, end } = extractDates(period);
      events.push({
        name: (name || "").trim().slice(0, 80),
        store,
        start_date: start || new Date().toISOString().slice(0, 10),
        end_date: end,
        url: url && url.trim() ? url.trim().slice(0, 300) : null,
        status: (status || "").trim() || null,
        period_text: (period || "").trim().slice(0, 60) || null,
        summary: (summary || "").trim().slice(0, 200) || null,
      });
    }

    if (events.length === 0) {
      return NextResponse.json({ error: "有効な行がありませんでした。対象サイト列をご確認ください", skipped }, { status: 400 });
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY
    );
    await admin.from("sale_events").delete().neq("id", 0);
    const { error } = await admin.from("sale_events").insert(events);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      imported: events.length,
      skipped,
      skippedDetail,
      debug: { totalRows: rows.length, headerRow: headerIdx + 1, dataRows: rows.length - headerIdx - 1, route: usedRoute },
      breakdown: {
        live: events.filter((e) => (e.status || "").replace(/\s/g, "").includes("開催中")).length,
        upcoming: events.filter((e) => !(e.status || "").replace(/\s/g, "").includes("開催中")).length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "取り込みに失敗しました" }, { status: 400 });
  }
}
