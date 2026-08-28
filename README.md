# MY NINE LOVES

好きなCD・漫画・書籍・アニメ・映画・有名人・キャラクターを9つ選ぶと、
1枚のカード画像になるツール。登録不要・無料。

本番: https://mynineloves.com

---

## 動かす

Node 22.5 以上（`node:sqlite` を使うため）。ビルド作業はありません。

```
cd nine-server
npm install          # pg だけが入る
node server.js       # → http://localhost:3000
```

`DATABASE_URL` を設定しなければローカルはSQLiteで動くので、
`npm install` を省いても起動はします（その場合PostgreSQLへは繋がりません）。

キーは任意です。設定すると使えるものが増えます。

| 環境変数 | 無いとどうなる | 取得先 |
|---|---|---|
| `TMDB_API_KEY` | 映画モードが無効。有名人の俳優・監督の精度が下がる | themoviedb.org（無料） |
| `RAKUTEN_APP_ID` + `RAKUTEN_ACCESS_KEY` | 書籍モードが無効（英語のみGoogle Booksで動く） | 楽天ウェブサービス（無料） |
| `YOUTUBE_API_KEY` | 有名人モードで配信者・クリエイターが出にくい | Google Cloud Console（無料） |
| `IP_SALT` | IPハッシュの塩が固定値になる。**公開前に必ず設定** | 自分で決める |

```
# Mac / Linux
TMDB_API_KEY=xxx IP_SALT=yyy node server.js

# Windows PowerShell
$env:TMDB_API_KEY="xxx"; $env:IP_SALT="yyy"; node server.js
```

キーが無いモードのタブは自動で無効表示になります（`/x/config` で判定）。

### 環境変数の一覧

| キー | 用途 |
|---|---|
| `DATABASE_URL` | PostgreSQL接続文字列。あればこれが保存先になる |
| `IP_SALT` | IPアドレスのハッシュ化 |
| `DATA_DIR` | SQLite/JSONの置き場（既定 `data/`） |
| `KEEP_DAYS` | 未閲覧データの保持日数（既定90） |
| `PORT` | 待ち受けポート（既定3000） |
| `TMDB_API_KEY` | 映画・人物 |
| `RAKUTEN_APP_ID` / `RAKUTEN_ACCESS_KEY` | 書籍。2026年2月のAPI刷新でaccessKeyが必須化 |
| `RAKUTEN_AFFILIATE_ID` | 楽天リンクのアフィリエイト化 |
| `AMAZON_ASSOCIATE_TAG` | Amazon検索リンク |
| `VC_LINKSWITCH` / `VC_LINKSWITCH_ID` | バリューコマースのLinkSwitch |
| `VOD_LINKS` | 映画・アニメの配信サービス導線（JSON） |
| `YOUTUBE_API_KEY` / `YOUTUBE_DAILY_SEARCHES` | 配信者検索と、その1日あたりの予算（既定80） |
| `CONTACT_URL` | 楽天APIのRefererとUserAgentに入れる自サイトURL |
| `CONTACT_MAIL` | Wikimedia向けUserAgentの連絡先 |
| `GA_ID` | Googleアナリティクス。あればHTMLに自動で差し込まれる |
| `ADS_JSON` | 広告バナー。書き方は `ADS-SETUP.md` |

キーはコードに一切書かず、環境変数だけで渡す設計です。

---

## 構成

```
nine-server/
├── server.js          ルーティング / キャッシュ / レート制限 / 画像プロキシ / GA・LinkSwitch注入
├── providers.js       外部APIのアダプタ（検索・サジェスト・関連・作者・購入リンク）
├── db.js              保存と集計（PostgreSQL / SQLite / JSON の3段フォールバック）
├── ads.js             広告の出し分け
├── package.json       依存は pg のみ
├── public/
│   ├── index.html     エディタ本体（UI・i18n・canvas書き出し）
│   ├── trends.html    みんなの9つ / ランキング
│   ├── about.html     このサイトについて
│   ├── terms.html     利用規約
│   ├── privacy.html   プライバシーポリシー
│   └── contact.html   お問い合わせ
└── data/              保存データ（自動生成。Gitに入れないこと）
```

---

## エンドポイント

**`/api/` は使えません。** Renderが予約パスとして横取りするため、すべて `/x/` にしてあります。
ここを戻すと本番で全部404になります。

| | |
|---|---|
| `GET /x/search?type=&q=&lang=` | 作品名で検索。購入リンク付き |
| `GET /x/suggest?type=&q=` | 入力補完（軽いエンドポイントのみ） |
| `GET /x/creators?type=&q=` | 作者・アーティストの候補 |
| `GET /x/works?type=&id=&author=` | その人の作品一覧 |
| `GET /x/related?type=&id=` | 続編・シリーズ・同アーティスト |
| `GET /x/config` | 各モードが有効かどうか |
| `GET /x/stats` | 累計・24時間・種類別の作成数 |
| `POST /x/cards` | カードを1件保存 |
| `GET /x/cards?type=&sort=&handle=&q=` | 一覧（最新順 / 人気順） |
| `GET /x/top?type=&lang=&decade=&age=` | 作品ランキング |
| `POST /x/like` | いいね（IP単位で1日1回） |
| `GET /x/ads?kind=&lang=` | 種類ごとの広告HTML |
| `GET /img?u=` | 許可ホストの画像だけを同一オリジンで中継 |

ページのルートは `/` `/trends` `/about` `/terms` `/privacy-policy` `/contact` `/u/ユーザー名`。
`/c/:id`（共有ページ）は**未実装**です。`db.js` の `store.get` / `store.view` は
そのために用意してあり、現在どこからも呼ばれていません。

---

## 保存

書き出し・共有のときに `POST /x/cards` で1件記録し、ヘッダーの数字が増えます。
保存先は環境変数で自動的に切り替わります。

| 条件 | 保存先 |
|---|---|
| `DATABASE_URL` がある | PostgreSQL（Neon等）。公開環境はこれ |
| 無い場合 | `node:sqlite`（`data/nine.db`）。ローカル開発はこれ |
| SQLiteも使えない | JSON（`data/nine.json`） |

起動ログに `保存先: PostgreSQL (DATABASE_URL)` と出れば本番構成です。

テーブルは `cards` と `card_items` の2つで、`card_items` を
`source + external_id` でGROUP BYするとそのままランキングになります。
`store.top()` がこれを実装しています。

閲覧もいいねもされないまま `KEEP_DAYS`（既定90日）が過ぎたデータは自動削除されます。
一度でも見られたカードは、共有リンクが生きている可能性があるため残します。

ローカルで `table cards has no column` が出たら、古い `data/nine.db` が残っています。
`data` フォルダごと消せば直ります。

---

## データソース

| モード | API | キー | 関連作品 |
|---|---|---|---|
| CD | iTunes Search | 不要 | 同じアーティストの他アルバム |
| 漫画 | AniList (MANGA) | 不要 | 続編・前日譚・外伝・スピンオフ |
| アニメ | AniList (ANIME) | 不要 | 同上 |
| 書籍 | 楽天ブックス → 楽天Kobo → Google Books | **必要** | 同じ著者の他の本 |
| 映画 | TMDB | **必要** | 同じシリーズ、無ければ関連作 |
| 有名人 | Wikidata + TMDB人物 + YouTube + Wikipedia | 後ろ2つは任意 | なし |
| キャラクター | AniList (CHARACTER) | 不要 | なし |

書籍は日本語では楽天を主軸に、紙→電子（Kobo）→Google Books の順で足りない分を補います。
同じ作品の版違いは `foldEditions()` でまとめます。
英語では楽天が使えない（日本の書籍のみ）ため、Google Books だけを引きます。

TMDBのキーは https://www.themoviedb.org/settings/api で無料で取れます（要アカウント）。

---

## 有名人モードについて

4つのソースを引き、同じ人物は名前で1つにまとめています（先に来たソースを優先）。

- **Wikidata** — 主軸。分類（P31）がヒト（Q5）の項目に限定しているので、団体名や作品名が混ざらない
- **TMDB `/search/person`** — 俳優・監督・声優。画像の質が最も安定している
- **YouTube `search.list`** — 配信者・クリエイター。結果が5件未満のときだけ呼ぶ
- **Wikipedia全文検索** — どれも薄いときの最後の受け皿

### Twitter/X を使わない理由

2026年2月にXは従量課金へ移行し、新規開発者向けの無料枠が廃止されました。
プロフィール取得は1件あたり約$0.010で、検索のたびに課金が発生します。
加えてプロフィール画像は本人や撮影者に権利があり、第三者サービスでの再利用は
規約上も想定されていません。費用と権利の両面で見送るのが妥当です。

### 注意点

- **YouTubeの無料枠は薄い** — `search.list` は1回100ユニット、1日10,000ユニットなので
  **1日約100回**しか叩けません。`YOUTUBE_DAILY_SEARCHES`（既定80）で予算制にし、
  他のソースで5件以上取れたら呼ばないようにしてあります
- **Wikimedia Commonsの画像はCC BY-SA** — 撮影者名とライセンス名を画面と書き出し画像に表示しています
- **Wikimediaは429を返しやすい** — Wikimedia系はキューを共有しているため、
  1200ms間隔＋連絡先入りUserAgent（`CONTACT_MAIL`）で通しています

---

## 表記ゆれへの対応

日本語検索でよくある失敗は4種類あり、`providers.js` の上部でまとめて吸収しています。

| ゆれ | 例 | 対応 |
|---|---|---|
| 全角・半角 | ＮＡＲＵＴＯ / NARUTO | 半角に統一 |
| ひらがな・カタカナ | すらむだんく / スラムダンク | 相互変換して再検索 |
| 中黒・空白 | ワン・ピース / ワンピース | 比較時に除去 |
| 長音記号 | ハンター / ハンタ― | 1種類に統一 |

仕組みは2段構えです。

1. **追撃検索（`fanout`）** — まず入力そのままで検索し、結果が5件未満なら
   カタカナ変換・ひらがな変換した語で再検索して結果を合流させます。
   毎回すべて投げるとレート制限に当たるので、足りないときだけ動きます。
2. **並べ替え（`rank`）** — 2文字ずつの重なり具合（Dice係数）で入力との近さを採点し、
   近い順に並べます。前方一致は強い手がかりとして加点。
   採点対象はタイトルだけでなく、ローマ字表記・英題・別表記（AniListの`synonyms`）も含みます。
   これで「slam dunk」でも「すらむだんく」でも同じ作品が先頭に来ます。

**できないこと**: 「よみがな→漢字」の変換だけは形態素辞書が必要なため対象外です。
ただしWikipediaやWikidataは読みからでも記事に当たるため、人物検索では実用上ほぼ問題ありません。
作品名でこれが必要なら、kuromoji.js などの辞書を組み込むことになります。

サジェスト側のフロント実装:

- 2文字未満は投げない
- 打鍵が止まってから投げる（デバウンス）
- 連番で古いレスポンスを破棄
- ↑↓で移動、Enterで確定、Escで閉じる
- 結果は7日キャッシュ。同じ入力の途中経過は2回目以降サーバーに出ません

---

## 本番に出す前に

- **キャッシュ** — 今はプロセス内メモリ（TTL付きLRU・最大4000件）。
  複数インスタンスなら Redis / KV に差し替える。`cacheGet` / `cacheSet` の2関数だけで済みます
- **画像プロキシ** — `providers.js` の `IMG_HOSTS` 許可リストは必ず維持。
  外すとオープンプロキシになります
- **レート制限** — AniListは約90req/分。送信キューで700ms間隔にしてあります。
  IP単位の制限も `server.js` に入っています（`/x/search` 系は90req/分、サジェストは40req/分）
- **CDN** — `/img` は `max-age=86400` を返すので、前段にCDNを置くだけで負荷がほぼ消えます
- **クレジット表記** — TMDBは「TMDBの公認ではない」旨、楽天は「Supported by 楽天ウェブサービス」の
  明記が規約上必要です
- **`.gitignore` に `data/`** — 利用者のIPハッシュを含むため

---

## 関連ドキュメント

| | |
|---|---|
| `HANDOVER.md` | 現状・未完のこと・設計判断の理由・ハマりどころ |
| `DEPLOY.md` | 公開の手順（GitHub / Render / Neon / ドメイン） |
| `ADS-SETUP.md` | `ADS_JSON` の書き方と広告の配置 |

---

## ライセンス

MIT（コードのみ）。表示される書影・ジャケット・ポスター・写真の権利は各権利者に帰属します。
