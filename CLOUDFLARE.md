# 無料でできる負荷対策

やることは2つです。**どちらも費用ゼロ、合計30分。**

1. UptimeRobotの監視先を `/healthz` に変える（5分）
2. 前段にCloudflareを置く（20分）

課金（Render Starter $7、Neon Launch 月8〜19ドル）を検討するのは、
この2つを終えてアクセスが伸びてからで間に合います。

---

# 1. 監視先を /healthz に変える

## なぜ

いまUptimeRobotはトップページを5分間隔で叩いています。
`index.html` は**82KB**あるので、監視だけで次の量が流れます。

| 監視先 | 30日の転送量 | Render無料枠(5GB)に占める割合 |
|---|---|---|
| トップページ | **676MB** | 13% |
| `/healthz` | 17KB | ほぼ0 |

**Renderは無料アカウントでも帯域超過を実際に課金します**（$0.15/GB）。
拡散したときに、覚えのない請求が来る経路がここです。
監視は「生きているか」を見るだけなので、82KBを送る必要はありません。

`/healthz` は `ok` の2バイトを返すだけで、**DBにも一切触れません。**

## 手順

1. UptimeRobotにログイン
2. 対象のモニターを開く → Edit
3. URL を `https://mynineloves.com/healthz` に変更
4. 間隔は5分のままでよい（Renderは15分で眠るため）
5. Save

`https://mynineloves.com/healthz` をブラウザで開いて `ok` と出れば成功です。

## 補足（正確を期すため）

「トップを叩くとNeonが起きてCU時間を食う」と説明しましたが、
**これは誤りでした。** UptimeRobotはJavaScriptを実行しないため、
トップを叩いても `/x/stats` は呼ばれず、DBは起きません。
監視先の変更で減るのは**帯域だけ**です。ただし676MBは無視できない量なので、
変更する価値は変わりません。

---

# 2. Cloudflareを前に置く

所要時間20分。**コードは1行も変えません。** DNSの向き先を変えるだけです。

拡散したときに最初に壊れるのは画像の配信です。表紙もOGP画像も、いまは
本体と同じRenderの無料枠（0.1CPU・512MB）から出ています。前にCloudflareを
置くと、2回目以降の画像がRenderまで届かなくなります。

無料プランで足ります。クレジットカードも不要です。

---

## なぜ効くのか

`/img` と `/og` は既に `Cache-Control: public, max-age=86400` を返しています。
つまり「1日は使い回してよい」と宣言済みなので、Cloudflareは何も設定しなくても
それを読んで勝手にキャッシュします。

1枚のカードがSNSで100回表示されたとき、いまはRenderが100回画像を返します。
Cloudflareを置くと1回で済みます。**残り99回はRenderに届きません。**

同時に、次の3つがついてきます。

| | |
|---|---|
| 本当のIPが分かる | `CF-Connecting-IP`。レート制限が正しく効く（対応済み） |
| 国が分かる | `CF-IPCountry`。国別ランキングに使える |
| 攻撃を弾く | botや過剰アクセスがRenderに届く前に止まる |

---

## 手順

### 1. Cloudflareにドメインを移す

「移す」といっても、**お名前.comからドメインを手放すわけではありません。**
DNSの管理だけをCloudflareに任せる形です。

1. https://dash.cloudflare.com でアカウントを作る
2. Add a site → `mynineloves.com` を入力
3. プランは **Free** を選ぶ
4. 現在のDNSレコードが自動で読み込まれる。**Renderを指すレコードがあることを確認**
5. Cloudflareが2つのネームサーバー（`xxx.ns.cloudflare.com` の形）を表示する

### 2. お名前.comでネームサーバーを変える

1. お名前.comにログイン → ドメイン → ネームサーバーの設定
2. 「その他のネームサーバーを使う」を選ぶ
3. Cloudflareが表示した2つを入力して保存

反映に数分〜数時間かかります。Cloudflareのダッシュボードが
**Active** に変われば完了です。

### 3. プロキシを有効にする（ここが本体）

Cloudflareの DNS 画面で、`mynineloves.com` のレコードの
**雲のマークをオレンジ色**にします。

- **灰色の雲** … DNSを引くだけ。Cloudflareは通らない（効果なし）
- **オレンジの雲** … Cloudflareを経由する（これにする）

オレンジでないと、以降の設定は何ひとつ効きません。

### 4. SSL/TLS の設定

SSL/TLS → Overview → **Full** を選びます。

`Flexible` にすると、CloudflareとRenderの間が暗号化されないうえ、
リダイレクトが無限ループすることがあります。**Fullにしてください。**

### 5. /healthz は通す

Cloudflareのキャッシュ設定で `/healthz` をキャッシュ**しない**ようにしてください。
キャッシュされると、Renderが落ちていてもCloudflareが `ok` を返し続け、
監視が障害に気づけなくなります。既定ではキャッシュされませんが、
Cache Rulesを作るときに `/img` と `/og` だけを対象にしてください。

### 6. 確認する

```
curl -I https://mynineloves.com/img?u=https://...
```

`cf-cache-status: HIT` が出れば、Renderまで届かずCloudflareが返しています。
1回目は `MISS`、2回目以降が `HIT` になります。

---

## 追加でやると効くもの（任意）

### キャッシュルール

Caching → Cache Rules で、`/img` と `/og` を明示的に長く持たせられます。

| 項目 | 値 |
|---|---|
| 条件 | URI Path starts with `/img` または `/og` |
| Cache eligibility | Eligible for cache |
| Edge TTL | 7日 |

既定でも `max-age=86400` は効きますが、明示するとCloudflare側で
1日より長く持てます。画像のURLは変わらないので、長くして問題ありません。

### HTMLはキャッシュしない

既定でHTMLはキャッシュされません。**この既定のままにしてください。**
`/` や `/trends` をキャッシュすると、作成数のカウンタや
ランキングが古いまま固定されます。

### 国別ランキング

`CF-IPCountry` ヘッダーが自動で付きます。保存時にこれを読んで
`cards.country` に入れれば、`HANDOVER.md` に保留と書かれていた
国別ランキングがそのまま作れます。有料の機能ではありません。

---

## やってはいけないこと

**Rocket Loader を有効にしない。** JavaScriptの読み込み順を勝手に変えるため、
`index.html` のcanvas書き出しが壊れることがあります。

**Auto Minify でHTMLを縮めない。** `server.js` が `</head>` を目印に
GAとLinkSwitchのスクリプトを差し込んでいるため、
HTMLを書き換えられると注入に失敗する可能性があります。

**Always Online を過信しない。** Renderが落ちているとき古いページを
返す機能ですが、`/x/` のAPIは返せないので検索は動きません。

---

## 元に戻したいとき

雲のマークをオレンジから灰色に戻せば、Cloudflareを通らなくなります。
それでも駄目なら、お名前.comのネームサーバーを元に戻してください。
どちらもコードには影響しません。
