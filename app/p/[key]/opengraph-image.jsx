// 商品ページのOGP画像:3サイトの価格を大きく並べ、最安を強調する
import { ImageResponse } from "next/og";
import { publicDb } from "../../../lib/supabaseServer";
import { loadProduct } from "../../../lib/catalog";
import { STORE_ORDER, statsFor, statsLabel } from "../../../lib/priceView";
import { ProductOG, ogFonts, imageData, OG_SIZE, jstStamp } from "../../../lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;
export const alt = "3サイトの価格比較";

export default async function Image({ params }) {
  const { key } = await params;
  let k = key;
  try { k = decodeURIComponent(key); } catch {}
  let d = await loadProduct(publicDb(), k).catch(() => null);
  if (d?.redirectTo) d = await loadProduct(publicDb(), d.redirectTo).catch(() => null);
  const prices = {};
  let newest = null, best = null;
  for (const s of STORE_ORDER) {
    const o = d?.offers?.[s];
    prices[s] = o?.price ?? null;
    if (o?.updated_at && (!newest || o.updated_at > newest)) newest = o.updated_at;
    if (o && (!best || o.price < best.price)) best = o;
  }
  const lab = best ? statsLabel(statsFor(best.price, best)) : null;
  const data = {
    name: d?.product?.name || "商品",
    image: await imageData(d?.product?.image),
    prices,
    date: newest ? jstStamp(newest) : jstStamp(),
    statLine: lab && lab.tone !== "none" ? `${lab.main}・${lab.sub}` : "",
  };
  const fonts = await ogFonts(data.name + data.statLine);
  return new ImageResponse(<ProductOG data={data} />, { ...OG_SIZE, fonts });
}
