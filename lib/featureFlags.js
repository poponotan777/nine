// ============================================================
// 機能の公開スイッチ(v16)
//
// 各モールの規約確認が済むまで、規約リスクのある機能をここで止めておく。
// 確認が取れたものから true に変えれば再び有効になる。
// ============================================================

// Amazonアソシエイト(紹介料)のタグをオウダンで使うか。
//  false の理由:
//   ・Amazonの参加要件で、別途合意がない限り「価格トラッキング/価格アラート
//     機能を備えたサイト」はアソシエイトリンクを置けない。
//     オウダンは価格推移・買い時・値下がり通知・指値アラートを持つため。
//   ・Creators APIは、APIを持つアカウント(hukasei04-22)以外のタグを
//     使うことが禁止されている。現設定は別タグ(popo-kaiteki-22)のため。
//  false の間は、Amazonへは「タグなしの普通のリンク」で案内し、
//  Creators APIからの価格取得(=アマゾン商品データの表示)も行わない。
//  v19(2026/10/17):運営者の判断で ON。価格推移(中央値・順位)を表示するサイトに
//   アソシエイトリンクを置くことは、規約上「別途合意」が必要とされる点は引き続き注意。
export const AMAZON_AFFILIATE_ON = true;

// 商品まとめ(/collections, /c/{slug})機能。
//  false の理由:
//   ・楽天の「グループと競合しうるサービス(楽天ROOM等)」条項の解釈が未確認
//   ・作成者アフィIDの利用・リンク差し替えは各モールの規約で原則禁止
//  各社への問い合わせで可否が確認できるまで非公開にする。
//  v21(2026/10/17):運営者の判断で ON。作れるのは運営だけ・リンクはすべて運営のID。
//   楽天の「競合サービス」条項は問い合わせ中(回答で変更が必要なら OFF に戻す)。
export const COLLECTIONS_ON = true;

// Amazonのタグ(AMAZON_AFFILIATE_ON が true のときだけ付与)
export const AMAZON_TAG = "popo-kaiteki-22";

// AmazonのURLに、フラグに応じてタグを付ける/付けない
export function amazonUrl(url) {
  if (!AMAZON_AFFILIATE_ON) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("tag", AMAZON_TAG);
    return u.toString();
  } catch {
    return url;
  }
}
