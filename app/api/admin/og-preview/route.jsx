// まとめのOGP画像を、保存前にプレビューする(v21・運営のみ)
import { ImageResponse } from "next/og";
import { adminOk } from "../../../../lib/adminAuth";
import { CollectionOG, ogFonts, imageData, OG_SIZE, jstStamp } from "../../../../lib/og";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return new Response("bad request", { status: 400 }); }
  if (!adminOk(body?.key)) return new Response("forbidden", { status: 403 });
  const d = body.data || {};
  const items = await Promise.all((d.items || []).slice(0, 6).map(async (it) => ({ name: it.name, prices: it.prices, image: await imageData(it.image) })));
  const data = { title: d.title || "タイトル", subtitle: d.subtitle || "", template: d.template || "ranking", date: jstStamp(), items };
  const fonts = await ogFonts([data.title, data.subtitle, ...items.map((i) => i.name)].join(""));
  return new ImageResponse(<CollectionOG data={data} />, { ...OG_SIZE, fonts });
}
