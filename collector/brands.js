// ============================================================
// 有名ブランド表(500ブランド)
//   書き方:"検索に使う名前|別の表記|別の表記"
//   ・検索は先頭の名前で行い、商品名にどれかの表記が含まれれば「有名ブランド」扱い
//   ・追加・削除は自由。行を足すだけでOK(500を超えても動きます)
// ============================================================

const RAW = `
# --- ガジェット・PC・スマホ周辺 ---
Anker|アンカー|Soundcore|eufy
Apple|アップル|iPhone|iPad|AirPods|MacBook
ソニー|SONY
Bose|ボーズ
JBL
Beats
ゼンハイザー|Sennheiser
オーディオテクニカ|audio-technica
ロジクール|Logicool|Logitech
エレコム|ELECOM
バッファロー|BUFFALO
サンディスク|SanDisk
Western Digital|WD
シーゲイト|Seagate
Crucial|クルーシャル
サムスン|Samsung|Galaxy
キングストン|Kingston
TP-Link|ティーピーリンク
SwitchBot|スイッチボット
CIO
UGREEN|ユーグリーン
Belkin|ベルキン
Google|グーグル|Pixel
Nintendo|任天堂
PlayStation|プレイステーション|PS5
Xiaomi|シャオミ
Fitbit
Garmin|ガーミン
HUAWEI|ファーウェイ
BenQ|ベンキュー
Dell|デル
LG
IODATA|アイ・オー・データ|アイオーデータ
ASUS|エイスース
Lenovo|レノボ
Microsoft|マイクロソフト
Amazon Echo|Echo
Fire TV
Kindle|キンドル
Ring
NEC
富士通|FUJITSU
dynabook|ダイナブック
Canon|キヤノン
Nikon|ニコン
FUJIFILM|富士フイルム
OLYMPUS|オリンパス|OM SYSTEM
GoPro|ゴープロ
DJI
Insta360
EPSON|エプソン
brother|ブラザー
SHARP|シャープ
Panasonic|パナソニック
JVC|ケンウッド|KENWOOD
Victor|ビクター
SHURE|シュア
final|ファイナル
Nothing
OPPO
motorola|モトローラ
Razer|レイザー
SteelSeries
HyperX
Corsair|コルセア
MSI
Acer|エイサー
HP|ヒューレット・パッカード
Philips|フィリップス
AUKEY
RAVPower
Spigen|シュピゲン
ESR
Nimaso
PITAKA
Satechi
Nintendo Switch|ニンテンドースイッチ
カシオ|CASIO|G-SHOCK
セイコー|SEIKO
シチズン|CITIZEN
# --- 生活家電・キッチン家電 ---
日立|HITACHI
東芝|TOSHIBA
三菱電機|MITSUBISHI
象印|ZOJIRUSHI
タイガー|TIGER
アイリスオーヤマ|IRIS OHYAMA
山善|YAMAZEN
ダイソン|Dyson
ブラウン|BRAUN
ティファール|T-fal
デロンギ|De'Longhi|DeLonghi
バルミューダ|BALMUDA
アイロボット|iRobot|ルンバ
ロボロック|Roborock
エコバックス|ECOVACS
シャーク|Shark
マキタ|Makita
ツインバード|TWINBIRD
COSORI|コソリ
レコルト|recolte
ブルーノ|BRUNO
ビタントニオ|Vitantonio
ダイキン|DAIKIN
コロナ|CORONA
ドウシシャ|DOSHISHA
レボイト|Levoit
ジャクリ|Jackery
エコフロー|EcoFlow
オムロン|OMRON
タニタ|TANITA
ヤーマン|YA-MAN
リファ|ReFa
MTG
ドクターエア|DOCTORAIR
シックスパッド|SIXPAD
オーラルB|Oral-B
ソニッケアー|Sonicare
アラジン|Aladdin
ホットクック
ヘルシオ
ネスプレッソ|Nespresso
ネスカフェ|ネスカフェ ドルチェ グスト|Dolce Gusto
カリタ|Kalita
ハリオ|HARIO
メリタ|Melitta
siroca|シロカ
ラドンナ|LADONNA
パロマ|Paloma
リンナイ|Rinnai
クイジナート|Cuisinart
バーミキュラ|VERMICULAR
ル・クルーゼ|Le Creuset
ストウブ|staub
WMF
ツヴィリング|ZWILLING|ヘンケルス
貝印|KAI
京セラ|KYOCERA
サーモス|THERMOS
スタンレー|Stanley
タイガー魔法瓶
象印マホービン
ピーコック|Peacock
ドリテック|dretec
エー・アンド・デイ|A&D
テスコム|TESCOM
コイズミ|KOIZUMI
ヴィダルサスーン|VIDAL SASSOON
サロニア|SALONIA
パナソニック ナノケア|ナノケア
クレイツ|CREATE ION
ホリスティックキュア|Holistic Cure
アイコス|IQOS
プルーム|Ploom
グロー|glo
ハイアール|Haier
ハイセンス|Hisense
TCL
アクア|AQUA
マクセル|maxell
パイオニア|Pioneer
DENON|デノン
YAMAHA|ヤマハ
ONKYO|オンキヨー
BOSCH|ボッシュ
HiKOKI|ハイコーキ
RYOBI|リョービ
京セラインダストリアル
ケルヒャー|KARCHER
# --- 日用品・洗剤・紙 ---
花王|Kao
P&G
ライオン|LION
ユニ・チャーム|ユニチャーム|unicharm
エリエール|大王製紙
スコッティ|SCOTTIE
クリネックス|Kleenex
日本製紙クレシア|クレシア
ネピア|王子ネピア|nepia
アタック|Attack
アリエール|ARIEL
ボールド|Bold
ジョイ|JOY
キュキュット
レノア|Lenor
ハミング
ソフラン
ナノックス|NANOX
トップ スーパーNANOX
ファーファ|FaFa
さらさ
ワイドハイター
ブライト
キッチンハイター
マジックリン
バスマジックリン
トイレマジックリン
カビキラー
スクラビングバブル|Scrubbing Bubbles
ジョンソン|Johnson
ルック|LOOK
ウタマロ
激落ちくん|レック|LEC
クイックルワイパー|クイックル
ファブリーズ|Febreze
リセッシュ
消臭力|エステー|ST
シャルダン
アース製薬|アース
キンチョウ|KINCHO|金鳥
フマキラー|FUMAKILLA
バルサン
ムシューダ
防虫剤 ゴン
ミヨシ石鹸|ミヨシ
シャボン玉石けん|シャボン玉
サラヤ|SARAYA|ヤシノミ
アルフレッサ
小林製薬
白元アース|白元
ニトムズ|nitoms
サンコー|SANKO
マーナ|marna
山崎実業|tower|タワー
ライクイット|like-it
天馬|Fits|フィッツ
ニトリ|NITORI
無印良品|MUJI
カインズ|CAINZ
アイリスプラザ
# --- 美容・化粧品・ヘアケア ---
資生堂|SHISEIDO
コーセー|KOSE
カネボウ|Kanebo
ポーラ|POLA
アルビオン|ALBION
SK-II|SK2
ランコム|LANCOME
エスティローダー|Estee Lauder
クリニーク|CLINIQUE
ディオール|Dior
シャネル|CHANEL
イヴ・サンローラン|YSL
ロレアル パリ|L'OREAL
メイベリン|MAYBELLINE
キャンメイク|CANMAKE
セザンヌ|CEZANNE
ちふれ
インテグレート|INTEGRATE
マキアージュ|MAQuillAGE
エリクシール|ELIXIR
アネッサ|ANESSA
ビオレ|Biore
キュレル|Curel
ニベア|NIVEA
肌ラボ|ハダラボ
メラノCC
ロート製薬|ROHTO
オバジ|Obagi
ナチュリエ|ハトムギ化粧水

ミノン|MINON
d プログラム|dプログラム
アベンヌ|Avene
ラロッシュポゼ|La Roche-Posay
ビオデルマ|BIODERMA
セタフィル|Cetaphil
イプサ|IPSA
ファンケル|FANCL
DHC
オルビス|ORBIS
ドクターシーラボ|Dr.Ci:Labo
アテニア|Attenir
HABA|ハーバー
雪肌精
エトヴォス|ETVOS
ミシャ|MISSHA
イニスフリー|innisfree
ANUA|アヌア
メディキューブ|medicube
VT COSMETICS|VT
CNP
ラネージュ|LANEIGE
TIRTIR|ティルティル
rom&nd|ロムアンド
クリオ|CLIO
エチュード|ETUDE
パンテーン|PANTENE
ラックス|LUX
ダヴ|Dove
いち髪
TSUBAKI|ツバキ
ボタニスト|BOTANIST
ミルボン|MILBON
ケラスターゼ|KERASTASE
オージュア|Aujua
ルベル|Lebel
ナプラ|napla
ハホニコ|HAHONICO
&honey|アンドハニー
YOLU|ヨル
アハロバター|Ahalo Butter
ジュレーム|Je l'aime
エッセンシャル|essential
メリット|merit
h&s|エイチアンドエス
スカルプD|SCALP-D
サクセス|Success
ルシード|LUCIDO
ギャツビー|GATSBY
ウーノ|uno
マンダム|mandom
バルクオム|BULK HOMME
シーブリーズ|SEA BREEZE
8x4|エイトフォー
デオナチュレ|DEONATULE
Ban|バン
リステリン|LISTERINE
クリニカ|Clinica
シュミテクト|Shumitect
システマ|SYSTEMA
クリアクリーン
GUM|ガム|サンスター
ピュオーラ|PUREORA
ディープクリーン
フィリップス ソニッケアー
ジレット|Gillette
シック|Schick
貝印 カミソリ
パナソニック ラムダッシュ|ラムダッシュ
ブラウン シリーズ|シリーズ9
# --- ベビー・ペット ---
メリーズ|Merries
パンパース|Pampers
ムーニー|moony
グーン|GOO.N
マミーポコ|MamyPoko
ピジョン|Pigeon
コンビ|Combi
アップリカ|Aprica
エルゴベビー|ERGObaby
和光堂|WAKODO
明治ほほえみ|ほほえみ
はいはい|すこやか
ムーミー
ロイヤルカナン|ROYAL CANIN
ヒルズ|Hill's|サイエンス・ダイエット
ピュリナ|Purina|ワン|ONE
いなば|CIAO|チャオ
ちゅ〜る|ちゅーる
カルカン|KALKAN
シーバ|Sheba
銀のスプーン|ユニ・チャーム ペット
アイシア|AIXIA
ペティオ|Petio
アイリスオーヤマ ペット
デオトイレ
ニャンとも清潔トイレ
# --- 食品・飲料 ---
サントリー|SUNTORY
伊藤園|ITOEN
キリン|KIRIN
アサヒ|Asahi
コカ・コーラ|Coca-Cola|コカコーラ
ネスレ|Nestle
UCC
AGF|味の素AGF
キーコーヒー|KEY COFFEE
スターバックス|Starbucks
タリーズ|TULLY'S
ドトール|DOUTOR
味の素|AJINOMOTO
日清食品|日清
東洋水産|マルちゃん
サンヨー食品|サッポロ一番
明治|meiji
森永製菓|森永
森永乳業
雪印メグミルク|雪印
江崎グリコ|グリコ
ロッテ|LOTTE
カルビー|Calbee
湖池屋
ブルボン|BOURBON
不二家
ハウス食品|ハウス
エスビー食品|S&B
キッコーマン|Kikkoman
ヤマサ
ミツカン|mizkan
キユーピー|QP|キューピー
カゴメ|KAGOME
伊藤ハム
日本ハム|ニッポンハム
丸大食品
プリマハム
ニチレイ|Nichirei
マルハニチロ
はごろもフーズ|シーチキン
いなば食品
ヤマキ
にんべん
ミツウロコ
サトウ食品|サトウのごはん
テーブルマーク|TableMark
アイリスフーズ
ザバス|SAVAS
マイプロテイン|MYPROTEIN
ゴールドスタンダード|Optimum Nutrition|オプチマム
ビーレジェンド|be LEGEND
エクスプロージョン|X-PLOSION
ウイダー|inゼリー
大塚製薬|ポカリスエット|カロリーメイト
大塚食品
ネイチャーメイド|Nature Made
ディアナチュラ|Dear-Natura
小林製薬 サプリ
ファンケル サプリ
アサヒ ディアナチュラ
ヤクルト|Yakult
ダノン|Danone
ポッカサッポロ|POKKA
カルピス|CALPIS
ダイドー|DyDo
アサヒ飲料
クリスタルガイザー|Crystal Geyser
いろはす|い・ろ・は・す
天然水|南アルプスの天然水
エビアン|evian
ボルヴィック|Volvic
ウィルキンソン|WILKINSON
サッポロ|SAPPORO
ヱビス|エビス
ザ・プレミアム・モルツ|プレモル
キリン一番搾り|一番搾り
スーパードライ
金麦
こだわり酒場
角瓶|角ハイボール
ジムビーム|JIM BEAM
獺祭
久保田
永谷園
桃屋
エバラ食品|エバラ
日清オイリオ
J-オイルミルズ|AJINOMOTO オイル
はくばく
ケロッグ|Kellogg's
カルビー フルグラ|フルグラ
日清シスコ|シスコーン
# --- ファッション・スポーツ・アウトドア ---
アディダス|adidas
ナイキ|NIKE
ニューバランス|New Balance
プーマ|PUMA
アシックス|ASICS
ミズノ|MIZUNO
ザ・ノース・フェイス|THE NORTH FACE|ノースフェイス
コロンビア|Columbia
チャンピオン|Champion
クロックス|Crocs
コールマン|Coleman
スノーピーク|snow peak
ロゴス|LOGOS
キャプテンスタッグ|CAPTAIN STAG
DOD
モンベル|mont-bell
パタゴニア|Patagonia
アークテリクス|ARC'TERYX
ミレー|MILLET
ヘリーハンセン|HELLY HANSEN
ノースフェイス パープルレーベル
チャムス|CHUMS
カリマー|karrimor
グレゴリー|GREGORY
オスプレー|OSPREY
ポーター|PORTER|吉田カバン
マンハッタンポーテージ|Manhattan Portage
アネロ|anello
レスポートサック|LeSportsac
サマンサタバサ|Samantha Thavasa
コーチ|COACH
マイケルコース|MICHAEL KORS
ケイトスペード|kate spade
ユニクロ|UNIQLO
GU|ジーユー
グンゼ|GUNZE
ワコール|Wacoal
トリンプ|Triumph
BVD
ヘインズ|Hanes
リーバイス|Levi's
エドウイン|EDWIN
ラコステ|LACOSTE
ポロ ラルフローレン|Ralph Lauren
トミーヒルフィガー|TOMMY HILFIGER
カルバンクライン|Calvin Klein
ディッキーズ|Dickies
カーハート|Carhartt
ヴァンズ|VANS
コンバース|CONVERSE
リーボック|Reebok
アンダーアーマー|UNDER ARMOUR
デサント|DESCENTE
ルコックスポルティフ|le coq sportif
ヨネックス|YONEX
ダンロップ|DUNLOP
ブリヂストン|BRIDGESTONE
キャロウェイ|Callaway
テーラーメイド|TaylorMade
ガーミン ゴルフ
ショップジャパン|Shop Japan
ワークマン|WORKMAN
ジーショック
テンピュール|TEMPUR
西川|nishikawa
エアウィーヴ|airweave
ブレインスリープ|BRAIN SLEEP
NERUSIA|ネルシア
コアラマットレス|Koala
フランスベッド|FRANCEBED
シモンズ|SIMMONS
ヨギボー|Yogibo
無印良品 体にフィットするソファ
カリモク|karimoku
LOWYA|ロウヤ
タンスのゲン
山善 家具
アイリスオーヤマ 家具
レゴ|LEGO
バンダイ|BANDAI
タカラトミー|TAKARA TOMY|トミカ|プラレール
エポック社|EPOCH
メガハウス
ハズブロ|Hasbro
マテル|Mattel
くもん|KUMON
学研|Gakken
ピープル|People
ボーネルンド|BorneLund
アンパンマン
サンリオ|Sanrio
ディズニー|Disney
ポケモン|Pokemon|ポケットモンスター
スヌーピー|SNOOPY
すみっコぐらし
ちいかわ
# --- 医薬品・健康 ---
大正製薬|リポビタン
第一三共ヘルスケア
武田薬品|タケダ|アリナミン
エスエス製薬
興和|コーワ|キューピーコーワ
久光製薬|サロンパス
ロキソニン
バファリン
イブ|EVE
龍角散
ヴイックス|VICKS
ピップ|PIP|ピップエレキバン
ドクターショール|Dr.Scholl
バンテリン
ハクキンカイロ
ホッカイロ|貼るカイロ
めぐりズム
アイボン
サンテ|参天製薬
ロート Vロート|Vロート
メニコン|Menicon
ジョンソン・エンド・ジョンソン|アキュビュー|ACUVUE
ボシュロム|Bausch
シード|SEED
クーパービジョン
オムロン 体温計
テルモ|TERUMO
アイリスオーヤマ マスク
超快適マスク
`;

export const BRANDS = RAW.split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const names = l.split("|").map((s) => s.trim()).filter(Boolean);
    return { q: names[0], names };
  });

// 表記ゆれを吸収して比べるための正規化
export function normBrand(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[ａ-ｚＡ-Ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s・\-_'’.&!！]/g, "");
}

const ALL = BRANDS.flatMap((b) => b.names.map((n) => ({ n: normBrand(n), b }))).filter((x) => x.n.length >= 2);

// 商品名(とブランド名)が有名ブランド表に当たるか。当たればブランドの代表名を返す
export function matchBrand(name, brandField) {
  const t = normBrand(name);
  const bf = normBrand(brandField);
  for (const x of ALL) {
    // 2文字のブランド(LG・HP など)は誤爆しやすいので、ブランド欄の完全一致だけ
    if (x.n.length <= 2) {
      if (bf && bf === x.n) return x.b.q;
      continue;
    }
    if ((bf && (bf === x.n || bf.startsWith(x.n))) || t.includes(x.n)) return x.b.q;
  }
  return null;
}
