# 公開の手順

ローカルで動いている状態から、インターネットに公開するまで。
所要時間は、詰まらなければ合計2〜3時間ほど。

---

## 事前に用意するもの

| | 費用 | 用途 |
|---|---|---|
| GitHubアカウント | 無料 | コードの置き場。デプロイの起点になる |
| Git for Windows | 無料 | コードをGitHubに送る道具 |
| Renderアカウント | 無料 | サーバー。GitHubでログインできる |
| Neonアカウント | 無料 | データベース。カード登録不要 |
| ドメイン | 年1,000〜2,000円 | 任意。無くても `〜.onrender.com` で公開できる |

Gitは https://git-scm.com/download/win から入れます。
インストール時の選択肢はすべて既定のままで問題ありません。

---

## 手順1 — 公開してはいけないものを確認する

**これが最重要です。** APIキーが1度でもGitHubに載ると、
履歴から消しても流出したものとして扱う必要があります。

送ってはいけないもの:

- `TMDB_API_KEY` / `YOUTUBE_API_KEY` の実際の値
- `IP_SALT` の値
- `data/` フォルダ（利用者のIPハッシュを含む）

`.gitignore` に `data/` を書いてあるので、後者は自動で除外されます。
キーは**コードに一切書かず、環境変数だけで渡す**設計になっているので、
そのまま守ってください。

---

## 手順2 — GitHubにコードを置く

GitHubで新しいリポジトリを作ります（Publicで構いません。
むしろポートフォリオにするならPublicにしてください）。
READMEやライセンスの自動生成は**チェックを外して**空のまま作ります。

PowerShellで `nine-server` フォルダに移動して、順に実行します。

```
git init
git add .
git status
```

`git status` の一覧に `data/` が出ていないことを必ず確認してください。
出ていたら `.gitignore` が正しく置かれていません。

確認できたら続けます。

```
git commit -m "MY NINE 初回公開"
git branch -M main
git remote add origin https://github.com/ユーザー名/リポジトリ名.git
git push -u origin main
```

初回はブラウザが開いてGitHubへのログインを求められます。

---

## 手順3 — Renderにデプロイする

1. https://render.com で GitHubアカウントでサインアップ
2. New → Web Service → 作ったリポジトリを選ぶ
3. 設定はほぼ自動で埋まります。確認する項目は3つだけ

| 項目 | 値 |
|---|---|
| Runtime | Node |
| Build Command | （空でよい。依存パッケージが無いため） |
| Start Command | `node server.js` |

4. Environment（環境変数）に登録する

| キー | 値 |
|---|---|
| `IP_SALT` | あなたが決めた長い文字列。ローカルと同じものを使う |
| `TMDB_API_KEY` | TMDBで取得したキー |
| `YOUTUBE_API_KEY` | 使う場合のみ |

5. Create Web Service を押す

数分で `https://なんとか.onrender.com` が発行されます。

---

## 手順4 — Neonで無料のPostgreSQLを作る

Renderの無料枠はファイルシステムが揮発性で、再起動のたびにデータが消えます。
そこで保存先だけを外部の無料DBに逃がします。**Renderは無料のままです。**

1. https://neon.com にGitHubアカウントでサインアップ
2. プロジェクトを作る。リージョンは `Asia Pacific (Tokyo)` を選ぶと速い
3. ダッシュボードの Connection string をコピーする

`postgresql://ユーザー名:パスワード@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
のような文字列です。**これはパスワードそのものなので、絶対にGitHubに載せないでください。**

Neonの無料プランはクレジットカード不要で、期限切れもありません。
しばらくアクセスが無いとDBが休止しますが、次のアクセスで自動的に復帰し、
データは保持されます。

### Renderに登録する

Render の Environment に、次の環境変数を追加します。

| キー | 値 |
|---|---|
| `DATABASE_URL` | Neonからコピーした接続文字列 |
| `IP_SALT` | あなたが決めた長い文字列 |
| `TMDB_API_KEY` | TMDBのキー |
| `YOUTUBE_API_KEY` | 使う場合のみ |

`DATABASE_URL` があれば自動的にPostgreSQLが使われ、
無ければSQLite、それも駄目ならJSONに落ちます。
**ローカルでは `DATABASE_URL` を設定しなければ、今までどおりSQLiteで動きます。**
本番と手元で別々のデータになるので、テストのつもりで本番の数字を汚す心配もありません。

### Build Command を設定する

PostgreSQLへの接続には `pg` パッケージが必要です。
Renderの設定で Build Command を `npm install` にしてください。
`package.json` に依存として書いてあるので、これだけで入ります。

| 項目 | 値 |
|---|---|
| Build Command | `npm install` |
| Start Command | `node server.js` |

### 起動ログで確認する

Renderのログに `保存先: PostgreSQL (DATABASE_URL)` と出れば成功です。
`保存先: SQLite` と出ていたら、`DATABASE_URL` が設定されていないか、
`npm install` が走っていません。

---

## 手順5 — スリープ対策（無料枠の場合のみ）

無料枠は15分アクセスが無いとスリープし、次のアクセスで復帰に30〜60秒かかります。
訪問者から見ると「重いサイト」になるので、対策しておくと印象が変わります。

UptimeRobot などの無料監視サービスに登録し、
10分おきにサイトへアクセスさせるとスリープしません。
月750時間の無料枠は1サービスの常時起動でぎりぎり収まります。

---

## 手順6 — ドメインを繋ぐ（任意）

お名前.comやCloudflare Registrarでドメインを取り、
Renderの Settings → Custom Domain に登録します。
指示されたDNSレコードをドメイン側に設定すれば、
HTTPSの証明書は自動で発行されます。

---

## 手順7 — 公開前の最終確認

- [ ] Aboutページのフッターに自分の名前とリンクを入れた
- [ ] `/contact` の問い合わせ先を用意した（Googleフォームでも可）
- [ ] 利用規約とプライバシーポリシーを置いた
- [ ] GitHubのリポジトリにキーが含まれていないか、もう一度確認した
- [ ] スマホの実機で開いて、9マスの選択と共有ができるか試した

問い合わせ窓口は、権利者から連絡が来たときの受け皿です。
**これが無い状態で他人の著作物を扱うサービスを公開しないでください。**

---

## 更新のしかた

コードを直したら、以下の3行だけです。
GitHubにpushすると、Renderが自動で検知して再デプロイします。

```
git add .
git commit -m "何を直したかを書く"
git push
```
