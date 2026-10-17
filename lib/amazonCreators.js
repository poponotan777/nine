// ============================================================
// Amazon Creators API(検索画面のその場検索用)v19
//   Xツール(amazon_x_tool v5)で動作確認できた方式に合わせた:
//   ・認証情報のバージョン(日本は3.3)でトークン取得先を切り替える
//   ・resources は公式に載っているものだけ(customerReviews は無効なので使わない)
//
// Vercel の環境変数:
//   AMAZON_ENABLED=true
//   AMAZON_CLIENT_ID / AMAZON_CLIENT_SECRET(Creators API の Credential)
//   AMAZON_CREDENTIAL_VERSION=3.3
//   AMAZON_PARTNER_TAG=popo-kaiteki-22
// ============================================================

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
  "images.primary.medium",
  "itemInfo.title",
  "itemInfo.byLineInfo",
  "itemInfo.externalIds",
  "browseNodeInfo.websiteSalesRank",
  "offersV2.listings.price",
  "offersV2.listings.dealDetails",
  "offersV2.listings.loyaltyPoints",
  "offersV2.listings.isBuyBoxWinner",
  "offersV2.listings.merchantInfo",
  "offersV2.listings.type",
];

export const AMAZON_PARTNER_TAG = process.env.AMAZON_PARTNER_TAG || "popo-kaiteki-22";

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 60000) return cachedToken;
  const version = process.env.AMAZON_CREDENTIAL_VERSION || "3.3";
  const ep = TOKEN_ENDPOINTS[version];
  if (!ep) return null;
  const [kind, url] = ep;
  const id = process.env.AMAZON_CLIENT_ID;
  const secret = process.env.AMAZON_CLIENT_SECRET;
  let res;
  try {
    if (kind === "lwa") {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_id: id, client_secret: secret, scope: "creatorsapi::default" }),
        cache: "no-store",
      });
    } else {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "creatorsapi/default" }),
        cache: "no-store",
      });
    }
  } catch {
    return null;
  }
  if (!res.ok) {
    console.error("Amazon token error:", res.status);
    return null;
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

export function amazonEnabled() {
  return process.env.AMAZON_ENABLED === "true" && !!process.env.AMAZON_CLIENT_ID && !!process.env.AMAZON_CLIENT_SECRET;
}

const dig = (o, ...ks) => ks.reduce((a, k) => (a == null ? a : a[k]), o);

function withTag(url) {
  try { const u = new URL(url); u.searchParams.set("tag", AMAZON_PARTNER_TAG); return u.toString(); } catch { return url; }
}

export function parseAmazonItem(it) {
  const listings = dig(it, "offersV2", "listings") || [];
  const lst = listings.find((l) => l.isBuyBoxWinner) || listings[0] || {};
  const eans = dig(it, "itemInfo", "externalIds", "eans", "displayValues") || [];
  const jan = eans.find((e) => /^\d{8,13}$/.test(String(e))) || null;
  const price = dig(lst, "price", "money", "amount");
  const pts = Number(dig(lst, "loyaltyPoints", "points")) || 0;
  const deal = lst.dealDetails;
  return {
    store: "amazon",
    name: dig(it, "itemInfo", "title", "displayValue") || "",
    price: price != null ? Number(price) : null,
    shipping: null,
    url: withTag(it.detailPageURL || `https://www.amazon.co.jp/dp/${it.asin}`),
    image: dig(it, "images", "primary", "medium", "url") || null,
    rating: 0,
    reviews: 0,
    shop: dig(lst, "merchantInfo", "name") || "Amazon",
    jan,
    code: it.asin || null,
    point_rate: pts > 0 && price ? Math.round((pts / Number(price)) * 1000) / 10 : null,
    sale_label: deal ? (lst.type === "LIGHTNING_DEAL" ? "タイムセール" : "セール") : null,
    sale_until: deal?.endTime || null,
  };
}

export async function searchAmazon(keyword, hits = 10) {
  if (!amazonEnabled()) return { items: [], status: "disabled" };
  try {
    const token = await getAccessToken();
    if (!token) return { items: [], status: "auth_error" };
    const version = process.env.AMAZON_CREDENTIAL_VERSION || "3.3";
    const res = await fetch(`${API}/searchItems`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: version.startsWith("3") ? `Bearer ${token}` : `Bearer ${token}, Version ${version}`,
        "x-marketplace": MARKETPLACE,
      },
      body: JSON.stringify({
        keywords: keyword,
        partnerTag: AMAZON_PARTNER_TAG,
        marketplace: MARKETPLACE,
        itemCount: Math.min(10, hits),
        resources: RESOURCES,
      }),
      next: { revalidate: 3600 },
    });
    if (res.status === 429) return { items: [], status: "busy" };
    if (res.status === 401 || res.status === 403) return { items: [], status: "not_eligible" };
    if (!res.ok) {
      console.error("Amazon API error:", res.status);
      return { items: [], status: "error" };
    }
    const data = await res.json();
    const rawItems = dig(data, "searchResult", "items") || [];
    const items = rawItems.map(parseAmazonItem).filter((i) => i.price != null && i.name);
    return { items, status: "ok" };
  } catch (e) {
    console.error("Amazon fetch failed:", e);
    return { items: [], status: "error" };
  }
}
