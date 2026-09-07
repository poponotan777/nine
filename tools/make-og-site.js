/**
 * トップページ用のOGP画像を作る（1200×630）
 *
 * SNSに `mynineloves.com` を貼ったときに出る1枚。
 * アイコン（正方形）を使うと左右が切れて小さく出るため、専用に作る。
 *
 *   node tools/make-og-site.js
 *
 * 出力: public/og-site.png
 * 中身を変えたくなったら、この scriptを直して作り直す。
 */
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const W = 1200, H = 630, OBI = 74;
const C = {
  ink: '#EFF2E8', panel: '#FFFFFF', line: '#C8D0BB',
  text: '#1B1F19', muted: '#5F6858', obi: '#FFC61A', pop: '#E03A5F',
};

const fontDir = path.join(__dirname, '..', 'fonts');
GlobalFonts.registerFromPath(path.join(fontDir, 'NotoSansJP-Bold.otf'), 'NineBold');
GlobalFonts.registerFromPath(path.join(fontDir, 'NotoSansJP-Regular.otf'), 'NineRegular');

const canvas = createCanvas(W, H);
const x = canvas.getContext('2d');

// 背景と、左の黄色い帯（カード画像と同じ体裁にそろえる）
x.fillStyle = C.ink;
x.fillRect(0, 0, W, H);
x.fillStyle = C.obi;
x.fillRect(0, 0, OBI, H);

x.save();
x.translate(OBI / 2, H - 40);
x.rotate(-Math.PI / 2);
x.fillStyle = '#2A2622';
x.font = '18px NineRegular';
x.fillText('MY NINE LOVES', 0, 6);
x.restore();

// 見出し
x.fillStyle = C.text;
x.font = '50px NineBold';
x.fillText('9つ選んで、', OBI + 58, 236);
x.fillText('1枚の画像に。', OBI + 58, 300);

x.fillStyle = C.muted;
x.font = '22px NineRegular';
x.fillText('CD・漫画・書籍・アニメ・映画', OBI + 60, 356);
x.fillText('キャラクター　登録不要・無料', OBI + 60, 392);

// 3×3のマスを右側に置く（何を作るツールかが一目で分かる）
const cell = 112, gap = 12;
const gridW = cell * 3 + gap * 2;
const gx = W - 96 - gridW;
const gy = (H - (cell * 3 + gap * 2)) / 2;   // 縦は中央にそろえる
for (let i = 0; i < 9; i++) {
  const cx = gx + (i % 3) * (cell + gap);
  const cy = gy + Math.floor(i / 3) * (cell + gap);
  x.fillStyle = C.panel;
  x.fillRect(cx, cy, cell, cell);
  x.strokeStyle = C.line;
  x.lineWidth = 1;
  x.strokeRect(cx + .5, cy + .5, cell - 1, cell - 1);
  x.fillStyle = C.pop;
  x.font = '15px NineRegular';
  x.fillText(String(i + 1).padStart(2, '0'), cx + 8, cy + 26);
}

// 下部にドメイン
x.fillStyle = C.muted;
x.font = '24px NineRegular';
x.fillText('mynineloves.com', OBI + 60, H - 70);

const out = path.join(__dirname, '..', 'public', 'og-site.png');
fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log('できました:', out);
