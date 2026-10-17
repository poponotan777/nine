// ============================================================
// 楽天市場APIのエンドポイント(サーバー・クライアント共用)
//
// 経緯:
//  ・IchibaItem/Search/20220601 は 2026-08-17 に完全廃止
//  ・移行先として 20260401 が提供されたが、これも 2027-01-18 に廃止予定
//  ・2026-07-07 公開の 20260701 が最新のため、直接こちらへ移行する
//
// 変更点(20220601 → 20260701):
//  ・タグ情報(tagIds/TagInformation)は廃止。代わりに属性(attributeIds)が返る
//  ・ジャンル情報の階層構造が拡張(ancestors/siblings/children)
//  ・検索・ソート・価格帯などのリクエストパラメータは従来どおり
//  ・itemName/itemPrice/itemUrl/affiliateUrl/reviewCount/reviewAverage/
//    shopName/itemCode/postageFlag/mediumImageUrls は従来どおり
// ============================================================
export const RAKUTEN_ITEM_SEARCH_URL =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";
