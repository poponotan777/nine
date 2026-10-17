// ============================================================
// ユーザープロフィール(v12)
// ★重要な設計方針★
//   住所(都道府県)・年代・性別・カード種別は「端末内(localStorage)」
//   にのみ保存し、サーバーには一切送信しません。
//   これにより個人データの保管責任を負わず、ユーザーは端末を消せば
//   いつでも完全に削除できます。
// ============================================================

export const PREFS = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

// 送料の地域傾向。モールAPIは配送先別の送料を返さないため、
// 一般的な追加送料の「目安」を示すだけに留める(正確な額は各店舗で確認)。
export function shippingHint(pref) {
  if (!pref) return null;
  if (pref === "沖縄県") return { extra: "高い", note: "沖縄は送料無料の対象外になる店舗が多く、追加送料(目安 +500〜1,500円)がかかることがあります" };
  if (pref === "北海道") return { extra: "やや高い", note: "北海道は追加送料(目安 +300〜800円)がかかる店舗があります" };
  if (["青森県", "秋田県", "岩手県", "鹿児島県", "長崎県"].includes(pref)) {
    return { extra: "やや高い", note: "離島・遠隔地は追加送料がかかる場合があります" };
  }
  return { extra: "標準", note: "多くの店舗で標準送料の地域です" };
}

// カードの「券種」だけを扱う。カード番号・有効期限は一切入力させない/保存しない。
// rate は各モールでの一般的な還元率の目安(ユーザーが自分で調整可能)
export const CARD_PRESETS = [
  { id: "rakuten", label: "楽天カード", rates: { rakuten: 3, yahoo: 1, amazon: 1 } },
  { id: "paypay", label: "PayPayカード", rates: { rakuten: 1, yahoo: 5, amazon: 1 } },
  { id: "amazon_master", label: "Amazon Mastercard", rates: { rakuten: 1, yahoo: 1, amazon: 2 } },
  { id: "amazon_prime", label: "Amazon Mastercard(プライム)", rates: { rakuten: 1, yahoo: 1, amazon: 2.5 } },
  { id: "generic", label: "その他一般カード(1%)", rates: { rakuten: 1, yahoo: 1, amazon: 1 } },
];

export const AGE_BANDS = ["10代", "20代", "30代", "40代", "50代", "60代以上"];
export const GENDERS = ["女性", "男性", "回答しない"];

const KEY = "oudanProfile";

export function loadProfile() {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

export function saveProfile(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
  return p;
}
