// ============================================================
// 商品名から容量・数量を抽出して単価を計算する
// 例: 「シャンプー 480ml」→ 1mlあたり◯円
//     「トイレットペーパー 12ロール×4パック」→ 1ロールあたり◯円
// ============================================================

const UNIT_DEFS = [
  { re: /(\d+(?:\.\d+)?)\s*(?:ml|mL|ML|ミリリットル)/, unit: "ml", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:l|L|リットル)(?![a-zA-Z])/, unit: "ml", factor: 1000 },
  { re: /(\d+(?:\.\d+)?)\s*(?:kg|KG|キログラム)/, unit: "g", factor: 1000 },
  { re: /(\d+(?:\.\d+)?)\s*(?:g|G|グラム)(?![a-zA-Z])/, unit: "g", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:枚)/, unit: "枚", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:ロール)/, unit: "ロール", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:錠|粒)/, unit: "錠", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:包|袋)/, unit: "包", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:回分)/, unit: "回分", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:本)/, unit: "本", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:個)/, unit: "個", factor: 1 },
];

// 「×3」「x2個セット」「3個セット」などの倍数を検出。
// さらに「1L 15本」「500ml 24本入」のように、単位容量のあとに
// 本数だけが書かれている形も倍数として拾う(容量違いの誤判定を防ぐため)。
// ※ 最初にマッチした1つだけを使う。同じ数字を二重に掛けないため。
function detectMultiplier(name) {
  const m =
    name.match(/[×x✕]\s*(\d+)/) ||
    name.match(/(\d+)\s*(?:個セット|本セット|袋セット|パック|セット)/) ||
    name.match(/(\d+)\s*(?:本|個|袋|箱|缶|ロール|枚|包|パック|ケース)\s*(?:入り|入)?/);
  return m ? parseInt(m[1], 10) : 1;
}

// 商品名から {amount, unit} を抽出。見つからなければ null
export function parseQuantity(name) {
  if (!name) return null;
  for (const def of UNIT_DEFS) {
    const m = name.match(def.re);
    if (m) {
      const base = parseFloat(m[1]) * def.factor;
      // 二重カウント防止: 「2本セット」の「2本」が数量と倍数の両方に
      // マッチしてしまうため、数量にマッチした部分を除いた残りから倍数を探す
      const rest = name.replace(m[0], " ");
      const mult = detectMultiplier(rest);
      return { amount: base * mult, unit: def.unit };
    }
  }
  return null;
}

// 価格と商品名から単価文字列を返す(例: "1mlあたり1.3円")
export function unitPriceLabel(price, name) {
  const q = parseQuantity(name);
  if (!q || q.amount <= 0) return null;
  const per = price / q.amount;
  const shown =
    per >= 10 ? Math.round(per) : Math.round(per * 100) / 100;
  return { label: `1${q.unit}あたり ${shown}円`, per, unit: q.unit, amount: q.amount };
}
