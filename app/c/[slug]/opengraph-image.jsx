// まとめのOGP画像(1200×630)— Xなどに貼ったときのリンクカード
//   価格は「作成時の3サイト価格」と、その日時を表示する(カードはXに長く残るため)
import { ImageResponse } from "next/og";
import { loadCollection } from "../../../lib/collectionData";
import { CollectionOG, ogFonts, imageData, OG_SIZE, jstStamp } from "../../../lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;
export const alt = "オウダンの商品まとめ";

export default async function Image({ params }) {
  const { slug } = await params;
  const d = await loadCollection(slug).catch(() => null);
  const items = d ? await Promise.all(d.items.slice(0, 6).map(async (it) => {
    const now = {};
    for (const s of ["rakuten", "yahoo", "amazon"]) now[s] = it.offers[s]?.price ?? null;
    const snap = it.snap && Object.values(it.snap).some((v) => v != null) ? it.snap : now;
    return { name: it.name, prices: snap, image: await imageData(it.image) };
  })) : [];
  const data = {
    title: d?.col.title || "オウダン",
    subtitle: d?.col.subtitle || "",
    template: d?.col.template || "ranking",
    date: d?.items?.[0]?.snapshot_at ? jstStamp(d.items[0].snapshot_at) : jstStamp(),
    items,
  };
  const fonts = await ogFonts([data.title, data.subtitle, ...items.map((i) => i.name)].join(""));
  return new ImageResponse(<CollectionOG data={data} />, { ...OG_SIZE, fonts });
}
