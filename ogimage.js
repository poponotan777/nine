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
  // 丸ゴシック。サイト側と同じ書体にして、カード画像だけ硬い印象になるのを避ける。
  // 読めなければ Noto に落ちる（どちらも同梱してある）。
  try {
    GlobalFonts.registerFromPath(path.join(FONT_DIR, 'MPLUSRounded1c-Bold.ttf'), 'NineBold');
    GlobalFonts.registerFromPath(path.join(FONT_DIR, 'MPLUSRounded1c-Regular.ttf'), 'NineText');
  } catch (e) {
    console.warn('丸ゴシックを読めないので Noto を使います:', e.message);
    GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansJP-Bold.otf'), 'NineBold');
    GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansJP-Regular.otf'), 'NineText');
  }
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
  const OBI = 52;
  x.fillStyle = COLOR.obi;
  x.fillRect(0, 0, OBI, H);
  x.save();
  x.translate(OBI / 2, H - 32);
  x.rotate(-Math.PI / 2);
  x.fillStyle = COLOR.ink;
  x.font = `22px ${BOLD}`;
  x.textAlign = 'left';
  x.fillText('MY NINE LOVES', 0, 8);
  x.restore();

  /* 上段にタイトルと4マス、下段に5マス。
     3×3だと縦長の表紙が小さくなるが、2段5列なら高さに余裕ができ、
     本来の縦横比のまま大きく見せられる。 */
  const PAD = 40, gap = 10;
  const ratio = RATIO[card.type] || 1;

  /* 並べ方は上4＋下5で統一する。文字の置き場所だけ絵柄で変える。
     縦長（漫画・映画）… 左に文字、右にグリッド
     正方形（CD）    … 上に文字、下にグリッドを横幅いっぱい
     正方形を左右分割にすると横幅で頭打ちになり、上下に余白が残るため。 */
  const wideCover = ratio >= 0.9;
  let cellW, cellH, gx, gy, textTop = false;

  if (wideCover) {
    textTop = true;
    const titleH = 132;
    const maxW = W - OBI - PAD * 2;
    const maxH = H - PAD - titleH - PAD;
    cellH = Math.floor((maxH - gap) / 2);
    cellW = Math.round(cellH * ratio);
    if (cellW * 5 + gap * 4 > maxW) {
      cellW = Math.floor((maxW - gap * 4) / 5);
      cellH = Math.round(cellW / ratio);
    }
    gx = OBI + (W - OBI - (cellW * 5 + gap * 4)) / 2;
    gy = titleH + (H - titleH - PAD - (cellH * 2 + gap)) / 2;
  } else {
    const textMin = 290;
    const maxW = W - OBI - PAD - textMin - 26;
    const maxH = H - PAD * 2;
    cellH = Math.floor((maxH - gap) / 2);
    cellW = Math.round(cellH * ratio);
    if (cellW * 5 + gap * 4 > maxW) {
      cellW = Math.floor((maxW - gap * 4) / 5);
      cellH = Math.round(cellW / ratio);
    }
    gx = W - PAD - (cellW * 5 + gap * 4);
    gy = (H - (cellH * 2 + gap)) / 2;
  }

  const rowsW = [4, 5];
  const gridW = cellW * 5 + gap * 4;

  const items = card.items || [];
  async function drawCell(i, cx, cy) {
    x.fillStyle = COLOR.cell;
    x.fillRect(cx, cy, cellW, cellH);
    x.strokeStyle = COLOR.line;
    x.lineWidth = 1;
    x.strokeRect(cx + .5, cy + .5, cellW - 1, cellH - 1);

    const it = items.find(v => v && v.position === i);
    if (!it || !it.image_url) return;
    try {
      const buf = await fetchImage(it.image_url);
      if (!buf) return;
      const im = await loadImage(buf);
      const s = Math.min(cellW / im.width, cellH / im.height);   // 見切れないように収める
      const w = im.width * s, h = im.height * s;
      x.save();
      x.beginPath();
      x.rect(cx, cy, cellW, cellH);
      x.clip();
      x.drawImage(im, cx + (cellW - w) / 2, cy + (cellH - h) / 2, w, h);
      x.restore();
      // 枠線を画像の上に引き直す。先に引いた線は画像で覆われてしまい、
      // 白地の表紙だと背景と溶けて「はみ出している」ように見えるため。
      x.strokeStyle = COLOR.line;
      x.lineWidth = 1;
      x.strokeRect(cx + .5, cy + .5, cellW - 1, cellH - 1);
    } catch (e) { /* 1枚失敗しても全体は出す */ }
  }

  // 各行は右端を揃える（上段が4つでも右にきれいに並ぶ）
  let idx = 0;
  let topStart = gx;
  for (let r = 0; r < rowsW.length; r++) {
    const n = rowsW[r];
    const rowW = cellW * n + gap * (n - 1);
    const rx = gx + gridW - rowW;
    if (r === 0) topStart = rx;
    const ry = gy + r * (cellH + gap);
    for (let i = 0; i < n; i++) {
      await drawCell(idx, rx + i * (cellW + gap), ry);
      idx++;
    }
  }

  /* 左上の文字。名前で改行し、残りを2行目以降に置く。
     「太郎を構成する9冊」なら「太郎」／「を構成する9冊」に分ける。 */
  const tx = OBI + PAD;
  const textW = textTop ? (W - OBI - PAD * 2 - 300) : (topStart - tx - 30);
  const title = card.title || '私を構成する9つ';
  const nm = (card.name || '').trim() || null;
  let head = '', rest = title;
  if (nm && title.startsWith(nm)) { head = nm; rest = title.slice(nm.length); }
  else if (title.startsWith('私')) { head = '私'; rest = title.slice(1); }

  x.textAlign = 'left';
  let ty = textTop ? 76 : gy + 62;

  if (head) {
    // 名前は主役なので、省略せず入るまで縮める
    x.fillStyle = COLOR.ink;
    let hs = 50;
    x.font = `${hs}px ${BOLD}`;
    while (hs > 26 && x.measureText(head).width > textW) {
      hs -= 2;
      x.font = `${hs}px ${BOLD}`;
    }
    x.fillText(clip(x, head, textW), tx, ty);
    ty += hs + 12;
  }

  // 残りは1行で見せたいので、幅に収まるまで文字を少しずつ縮める
  x.fillStyle = COLOR.ink;
  let size = head ? 34 : 44;
  x.font = `${size}px ${BOLD}`;
  while (size > 20 && x.measureText(rest).width > textW) {
    size -= 2;
    x.font = `${size}px ${BOLD}`;
  }
  if (x.measureText(rest).width <= textW) {
    x.fillText(rest, tx, ty);
    ty += size + 10;
  } else {
    // それでも入らない長いタイトルだけ2行に折り返す
    const lines = [];
    let line = '';
    for (const ch of rest) {
      if (x.measureText(line + ch).width > textW && line) { lines.push(line); line = ''; }
      line += ch;
      if (lines.length >= 2) break;
    }
    if (line) lines.push(line);
    lines.slice(0, 2).forEach(l => { x.fillText(clip(x, l, textW), tx, ty); ty += size + 8; });
  }

  if (card.handle) {
    x.fillStyle = COLOR.muted;
    x.font = `23px ${TEXT}`;
    if (textTop) {
      const hw = x.measureText('@' + card.handle).width;
      x.fillText('@' + card.handle, W - PAD - hw, 76);
    } else {
      x.fillText('@' + card.handle, tx, ty + 8);
    }
  }

  x.fillStyle = COLOR.pop;
  x.font = `22px ${BOLD}`;
  if (textTop) {
    const sw = x.measureText('mynineloves.com').width;
    x.fillText('mynineloves.com', W - PAD - sw, 112);
  } else {
    x.fillText('mynineloves.com', tx, H - PAD - 4);
  }

  return c.toBuffer('image/png');
}

module.exports = { render, W, H };
