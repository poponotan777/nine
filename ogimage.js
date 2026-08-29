/**
 * ogimage.js — 共有ページ用のOGP画像を作る
 *
 * SNSのクローラーはJavaScriptを実行しないため、
 * ブラウザのcanvasで作っている書き出し画像はそのままでは使えない。
 * ここでサーバー側の同じ絵柄を生成する。
 *
 * 出力は 1200×630（X・Facebook・LINEの推奨比率）。
 * 画面の書き出し画像（縦長）とは別物で、リンクのサムネイル専用。
 */

const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// 同梱した日本語フォントを登録する（Renderの環境には日本語フォントが無いため）
const FONT_DIR = path.join(__dirname, 'fonts');
let fontsReady = false;
try {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansJP-Bold.otf'), 'NineBold');
  GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansJP-Regular.otf'), 'NineText');
  fontsReady = true;
} catch (e) {
  console.warn('フォントを読み込めませんでした:', e.message);
}
const BOLD = fontsReady ? 'NineBold' : 'sans-serif';
const TEXT = fontsReady ? 'NineText' : 'sans-serif';

const W = 1200, H = 630;
const COLOR = {
  bg: '#EFF2E8', obi: '#FFC61A', ink: '#1B1F19',
  muted: '#5F6858', line: '#C8D0BB', cell: '#FFFFFF', pop: '#E03A5F',
};

/** 種類ごとの縦横比（画面側と揃える） */
const RATIO = {
  album: 1, manga: 460 / 654, book: 2 / 3, anime: 460 / 654,
  movie: 2 / 3, person: 3 / 4, character: 460 / 654,
};

function clip(ctx, s, max) {
  if (ctx.measureText(s).width <= max) return s;
  let r = s;
  while (r.length > 1 && ctx.measureText(r + '…').width > max) r = r.slice(0, -1);
  return r + '…';
}

/**
 * @param {object} card  store.get() が返すカード
 * @param {function} fetchImage  画像URLからBufferを得る関数（サーバーの画像プロキシを再利用）
 */
async function render(card, fetchImage) {
  const c = createCanvas(W, H);
  const x = c.getContext('2d');

  x.fillStyle = COLOR.bg;
  x.fillRect(0, 0, W, H);

  // 左の帯
  const OBI = 64;
  x.fillStyle = COLOR.obi;
  x.fillRect(0, 0, OBI, H);
  x.save();
  x.translate(OBI / 2, H - 40);
  x.rotate(-Math.PI / 2);
  x.fillStyle = COLOR.ink;
  x.font = `26px ${BOLD}`;
  x.textAlign = 'left';
  x.fillText('MY NINE LOVES', 0, 9);
  x.restore();

  // 右側に3×3、左側に文字を置く
  const ratio = RATIO[card.type] || 1;
  const gap = 10;
  const gridH = H - 120;
  const cellH = Math.floor((gridH - gap * 2) / 3);
  const cellW = Math.round(cellH * ratio);
  const gridW = cellW * 3 + gap * 2;
  const gx = W - gridW - 60;
  const gy = (H - (cellH * 3 + gap * 2)) / 2;

  // 見出し
  const textW = gx - OBI - 100;
  x.textAlign = 'left';
  x.fillStyle = COLOR.ink;
  x.font = `52px ${BOLD}`;
  const title = card.title || '私を構成する9つ';
  const lines = [];
  let line = '';
  for (const ch of title) {
    if (x.measureText(line + ch).width > textW && line) { lines.push(line); line = ''; }
    line += ch;
    if (lines.length >= 2) break;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => x.fillText(l, OBI + 50, 210 + i * 62));

  if (card.handle) {
    x.fillStyle = COLOR.muted;
    x.font = `28px ${TEXT}`;
    x.fillText('@' + card.handle, OBI + 50, 210 + lines.length * 62 + 20);
  }

  // 中身の作品名を数点だけ添える
  const titles = (card.items || []).map(i => i && i.title).filter(Boolean);
  if (titles.length) {
    x.fillStyle = COLOR.muted;
    x.font = `22px ${TEXT}`;
    const label = clip(x, titles.slice(0, 3).join(' ・ '), textW);
    x.fillText(label, OBI + 50, H - 110);
  }

  x.fillStyle = COLOR.pop;
  x.font = `24px ${BOLD}`;
  x.fillText('mynineloves.com', OBI + 50, H - 60);

  // 3×3
  const items = card.items || [];
  for (let i = 0; i < 9; i++) {
    const col = i % 3, row = (i / 3) | 0;
    const cx = gx + col * (cellW + gap);
    const cy = gy + row * (cellH + gap);
    x.fillStyle = COLOR.cell;
    x.fillRect(cx, cy, cellW, cellH);
    x.strokeStyle = COLOR.line;
    x.lineWidth = 1;
    x.strokeRect(cx + .5, cy + .5, cellW - 1, cellH - 1);

    const it = items.find(v => v && v.position === i);
    if (!it || !it.image_url) continue;
    try {
      const buf = await fetchImage(it.image_url);
      if (!buf) continue;
      const im = await loadImage(buf);
      const s = Math.min(cellW / im.width, cellH / im.height);  // 見切れないように収める
      const w = im.width * s, h = im.height * s;
      x.save();
      x.beginPath();
      x.rect(cx, cy, cellW, cellH);
      x.clip();
      x.drawImage(im, cx + (cellW - w) / 2, cy + (cellH - h) / 2, w, h);
      x.restore();
    } catch (e) { /* 1枚失敗しても全体は出す */ }
  }

  return c.toBuffer('image/png');
}

module.exports = { render, W, H };
