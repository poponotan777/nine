import { NextResponse } from "next/server";
import { searchAmazon, amazonEnabled } from "../../../../lib/amazonCreators";
import { AMAZON_AFFILIATE_ON } from "../../../../lib/featureFlags";

// 同じキーワードは1時間まとめて返す(Amazonの上限 1秒1回・1日8,640回 を守るため)
export const revalidate = 3600;

export async function GET(request) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ items: [], status: "no_query" });
  if (!AMAZON_AFFILIATE_ON || !amazonEnabled()) return NextResponse.json({ items: [], status: "disabled" });
  const result = await searchAmazon(q.slice(0, 80));
  return NextResponse.json(result, { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=600" } });
}
