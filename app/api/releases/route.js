// v23で廃止しました(自動取得 v18 と、DBから選ぶトップ表示 v22 に置き換え)。
// GitHub 上でこのフォルダごと削除しても問題ありません。
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "このAPIは廃止しました" }, { status: 410 });
}
export async function POST() {
  return NextResponse.json({ error: "このAPIは廃止しました" }, { status: 410 });
}
