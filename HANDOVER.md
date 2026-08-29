# MY NINE LOVES 引き継ぎ資料

最終更新: 2026年8月28日
本番: https://mynineloves.com
リポジトリ: https://github.com/poponotan777/nine

---

## 1. これは何か

好きなCD・漫画・書籍・アニメ・映画・有名人・キャラクターを9つ選ぶと、
1枚のカード画像になるツール。登録不要・無料。
`my9games.com`（私を構成する9つのゲーム）の構造を参考にしている。

収益はアフィリエイト。アドセンスは審査待ち。

---

## 2. 構成

```
nine-server/
├── server.js          ルーティング / キャッシュ / レート制限 / 画像プロキシ / GA・LinkSwitch注入
├── providers.js       外部APIのアダプタ（検索・関連・購入リンク）
├── db.js              保存と集計（PostgreSQL / SQLite / JSON の3段フォールバック）
├── ads.js             広告の出し分け
├── package.json       依存は pg のみ
└── public/
    ├── index.html     エディタ本体（72KB。UI・i18n・canvas書き出しを含む）
    ├── trends.html    みんなの9つ / ランキング
    ├── about.html     このサイトについて
    ├── terms.html     利用規約
    ├── privacy.html   プライバシーポリシー
    └── contact.html   お問い合わせ
```

Node 22 以上。ビルド不要。`npm install` で `pg` だけ入る。

### インフラ

| | |
|---|---|
| ホスティング | Render（無料枠） |
| DB | Neon PostgreSQL（無料枠・シンガポール） |
| ドメイン | お名前.com（mynineloves.com） |
| 死活監視 | UptimeRobot（5分間隔・スリープ防止） |
| 解析 | Googleアナリティクス |

---

## 3. 完了していること

### 機能

- 7モードの検索・選択・画像書き出し
- 作品名検索と作者検索の2系統。作者→作品一覧への遷移
- 関連作品（続編・シリーズ・同アーティスト・別の版）
- 表記ゆれ吸収（全角半角・ひらがなカタカナ・中黒・長音記号）
- 検索サジェスト（デバウンス420ms・前方一致キャッシュ）
- 種類ごとの選択保持（切り替えても消えない）
- 画像の書き出し（帯付きレイアウト・種類ごとの縦横比）
- SNS共有（OSの共有シート / X / Bluesky / Threads / Misskey）
- 日英の言語切替（UIと外部APIの両方）
- 作成数カウンタ、いいね、閲覧数
- `/trends` ランキング（すべて / 日本語 / 英語 / 同年代 × 作品の年代別）
- `/u/ユーザー名` で個人ページ
- 90日で未閲覧データを自動削除

### 設定済みの環境変数（13個）

すべてRenderのEnvironmentに登録済み。値はGitHubには載っていない。

```
DATABASE_URL          Neon接続文字列
IP_SALT               IPハッシュ化用
CONTACT_URL           https://mynineloves.com（楽天APIのReferer）
CONTACT_MAIL          Wikimedia用のUA連絡先
TMDB_API_KEY          映画・人物
RAKUTEN_APP_ID        書籍
RAKUTEN_ACCESS_KEY    書籍（2026年2月の刷新で必須化）
RAKUTEN_AFFILIATE_ID  楽天リンクのアフィリエイト化
AMAZON_ASSOCIATE_TAG  Amazon検索リンク
VC_LINKSWITCH         on
VC_LINKSWITCH_ID      バリューコマース
GA_ID                 Googleアナリティクス
ADS_JSON              アフィリエイトのバナー（ページごと）
ADSENSE_JSON          アドセンス（全ページ共通・審査通過後に設定）
```

### 広告（設定済み）

| 枠 | 案件 |
|---|---|
| `book_inflow` | DMMブックス 300×250 |
| `book_rail` | audiobook.jp 160×600 |
| `manga_inflow` | 漫画全巻ドットコム 300×250 |
| `manga_rail` | DMMブックス 120×600 |
| `cd_inflow` | Audible 300×250 |
| `movie_rail` | TSUTAYA DISCAS 160×600 |

作品詳細には楽天・Amazon・Yahoo!ショッピングの検索リンクが出る。
Yahoo!ショッピングはLinkSwitch経由でアフィリエイト化されることを確認済み。

### 確認済みの連携

- LinkSwitchによるYahoo!ショッピングリンクの自動変換（動作確認済み）
- Googleアナリティクスでのアクセス計測（動作確認済み）
- 楽天ウェブサービスの Allowed websites に `mynineloves.com` を登録済み
  （旧 `nine-1jsh.onrender.com` も残してある。**消すと旧URL経由の書籍検索が止まる**）

---

## 4. 未完のこと

### すぐ着手できるもの

| 項目 | 状況 |
|---|---|
| **Xでの初投稿** | アカウント作成済み・未投稿。**最優先** |
| **アドセンス** | 申請済み・審査待ち。通ったら `ADS_JSON` を配列にして半々表示に |
| 広告枠の残り | `book_rail2` `cd_rail` `anime_*` `character_*` `person_rail` `trends_*` `common_bar` が空 |
| 英語版の規約類 | about / terms / privacy / contact が日本語のみ |

### 設計判断が必要なもの

| 項目 | 論点 |
|---|---|
| **`/c/:id` 共有ページ** | SNS拡散の生命線。OGP画像のサーバー生成が必要（`satori`+`resvg` か `@napi-rs/canvas`）。DBに `image_url` を保存済みなので描画自体は可能 |
| **なりすまし対策** | Xのハンドルを誰でも入力できる状態。「未検証は `/u/` ページを作らない」方針まで決めて保留中 |
| **Blueskyのリアルタイム表示** | APIが無料。`#MyNineLoves` の投稿を `/trends` に流し込める。X APIでは費用面で不可能だったもの |
| 地下アイドル等の網羅 | 公開APIでは不可能。ユーザー投稿型DBにするかの判断が保留 |
| 国別ランキング | 現状は言語別で代用。Cloudflareを前段に置けば `CF-IPCountry` が無料で使える |

---

## 5. 重要な設計判断とその理由

引き継ぐ人が「なぜこうなっているか」で迷わないための記録。

### 外部APIをブラウザから直接叩かない

APIキーが露出し、外部画像を描画したcanvasが汚染されて画像を書き出せなくなる。
すべてサーバー経由にすることで、この2つとレート制限を同時に解決している。

### 画像は保存せずURLだけを持つ

保存すると複製・再配布にあたり、多くのAPIの規約に触れる。
`card_items.image_url` に**URL文字列**だけを記録している。

### アップロード画像はサーバーに送らない

利用者が自分で追加した画像は端末内のみで処理。
SNS共有（画像ファイルを直接送る）には含まれるが、
共有ページ（URL）には出さない方針。権利リスクの遮断が目的。

### 年齢ではなく生まれ年を保存

年齢のまま持つと毎年ずれ、一斉更新の運用が必要になる。
入力は年齢のまま、保存時に `今年 - 年齢` で変換している。

### 広告を置く場所を限定

作る流れと共有の導線には出さない。
理由は、共有されなければアクセスが伸びず、結果として収益も伸びないため。
置くのは「作品の詳細」「本文の下部」「左右のレール」「/trends」のみ。
書き出し後の画面と共有ページには置かない。

### スマホ広告はポップアップにしない

Googleがインタースティシャル広告をペナルティ対象にしているため。
下部固定バー（閉じるボタン付き）にしている。

### APIの節約

YouTubeは1日100回で枯れるため、予算制（既定80回）を設け、
Wikidata/TMDBで5件以上取れたら呼ばない。
検索結果は24時間、サジェストは7日間キャッシュ。

---

## 6. ハマりどころ（実際に踏んだもの）

| 症状 | 原因 |
|---|---|
| `/api/*` が404 | **Renderが `/api/` を予約パスとして横取りする**。`/x/` に変更済み |
| 楽天が400 `specify valid applicationId` | 2026年2月にAPI刷新。`openapi.rakuten.co.jp` + accessKey が必須 |
| Wikipediaが429 | Wikimedia系のキューを共有していた。1200ms間隔＋連絡先入りUAで解決 |
| 有名人検索に別人が混ざる | Wikipedia全文検索は人物判定をしない。Wikidataの `P31=Q5` で解決 |
| 表紙が見切れる | AniListの表紙は2:3ではなく **460:654**。実寸に合わせ `contain` に |
| ローカルで `table cards has no column` | 古い `data/nine.db` が残っている。**`data` フォルダを消せば直る** |
| ADS_JSONが反映されない | HTMLの `"` と**改行**。`'` に置換して1行にする |

---

## 7. 日常の運用

### コードを更新する

```
git add .
git commit -m "何を直したか"
git push
```

pushするとRenderが自動で再デプロイ（3〜5分）。

### 環境変数を変える

Renderのダッシュボード → Environment → 編集 → Save Changes。
保存すると自動で再デプロイ。pushは不要。

### 広告を足す

1. A8で広告リンクを作成しHTMLをコピー
2. メモ帳で改行を削除し、`"` を `'` に置換
3. `ADS_JSON` に `"キー名": "HTML"` の形で追加（カンマ区切り、最後にカンマ不要）
4. `https://jsonlint.com` で検証してから貼る

キーの形は `{種類}_{場所}_{言語}`。詳細は `ADS-SETUP.md`。

### 確認用URL

| | |
|---|---|
| `/x/config` | APIキーの設定状況 |
| `/x/stats` | 作成数 |
| `/x/ads?kind=book&lang=ja` | その種類で返る広告 |
| `/x/top?type=manga` | ランキングの生データ |

---

## 8. 次にやるべきことの優先順位

1. **Xで初投稿**（アカウント作成済み・未投稿）
   自分で9つ選んだ画像を添えて固定ポストにする。
   これをやらないと誰にも知られない。

2. **アドセンス通過後の設定**
   `ADS_JSON` の値を配列にして半々表示に。
   英語版はアドセンスのみ（`_en` キーで指定）。

3. **`/c/:id` 共有ページとOGP画像**
   SNSに貼ったときサムネイルが出るようにする。
   拡散しなければランキングもトレンドも育たない。

4. **`/trends` にデータを溜める**
   まず自分で各モード9つずつ作る。空のランキングは印象が悪い。

5. **技術記事を書く**
   `about.html` に書いた設計判断を軸に、ZennかQiitaへ。
   「日本語の書影APIが軒並み死んだ2026年に」という切り口が刺さる。
