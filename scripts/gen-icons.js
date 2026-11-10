/* ============================================================
 * 生成功能区 / 面板卡片用的图标（PNG，透明底）
 * 思路：用 SVG 画 27 枚图标 → 无头 Edge 渲染成一张雪碧图 →
 *       用 Pillow 按格子裁切并缩放到 64×64 → 输出到 common/images
 * 用法：node scripts/gen-icons.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'common', 'images');
const tmp = path.join(root, '.tmp');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });

const RED = '#D93025', RED_L = '#F28B82';
const AMBER = '#F29900', AMBER_L = '#FFC46B';
const GREEN = '#1E8E3E', GREEN_L = '#A8D5B5';
const BLUE = '#1A73E8', PURPLE = '#7C4DFF', PURPLE_L = '#B39DFF';
const TEAL = '#0E9AA7', TEAL_L = '#5FC6CF', GRAY = '#5F6368', PINK = '#E0457B';
const ORANGE = '#D24726';

// 文件卡片：圆角矩形 + 白色字母
function doc(x, y, w, h, color, letter, fs) {
  const r = Math.min(2.4, w * 0.22);
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`;
  if (letter) {
    s += `<text x="${x + w / 2}" y="${y + h / 2 + (fs || 7) * 0.36}" text-anchor="middle" `
      + `font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${fs || 7}" fill="#fff">${letter}</text>`;
  }
  return s;
}
// 文档上的白色横线
function lines(x, y, w, n, gap) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += `<rect x="${x}" y="${y + i * gap}" width="${i === n - 1 ? w * 0.55 : w}" height="1.5" rx="0.75" fill="#fff" opacity="${0.9 - i * 0.16}"/>`;
  }
  return s;
}
// 右向箭头
function arrow(x, y, w) {
  return `<path d="M${x} ${y}h${w}" stroke="${GRAY}" stroke-width="2" stroke-linecap="round" fill="none"/>`
    + `<path d="M${x + w - 2.6} ${y - 2.4}l2.8 2.4-2.8 2.4" stroke="${GRAY}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}
// 照片：圆角矩形 + 太阳 + 山
function photo(x, y, w, h, color) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.2" fill="${color}"/>`
    + `<circle cx="${x + w * 0.28}" cy="${y + h * 0.3}" r="${Math.min(2, w * 0.1)}" fill="#fff"/>`
    + `<path d="M${x + 1.2} ${y + h - 1.4}l${w * 0.28} -${h * 0.34} ${w * 0.2} ${h * 0.22} ${w * 0.16} -${h * 0.2} ${w * 0.3} ${h * 0.32}z" fill="#fff" opacity=".92"/>`;
}
function pdfDoc(x, y, w, h, color) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.2" fill="${color}"/>` + lines(x + w * 0.2, y + h * 0.28, w * 0.6, 3, h * 0.19);
}

const ICONS = [
  { id: 'wtaBtnPanel', file: 'ic-panel',
    svg: `<rect x="3" y="6" width="26" height="20" rx="3.5" fill="${BLUE}"/>
          <rect x="5.6" y="8.6" width="7" height="14.8" rx="1.6" fill="#fff"/>
          <rect x="14.8" y="10" width="10.6" height="2.3" rx="1.15" fill="#fff" opacity=".9"/>
          <rect x="14.8" y="14.4" width="10.6" height="2.3" rx="1.15" fill="#fff" opacity=".72"/>
          <rect x="14.8" y="18.8" width="6.4" height="2.3" rx="1.15" fill="#fff" opacity=".55"/>` },

  { id: 'wtaToolAiAssistant', file: 'ic-ai',
    svg: `<path d="M13 4.5l2.4 7.6 7.6 2.4-7.6 2.4L13 24.5l-2.4-7.6L3 14.5l7.6-2.4z" fill="${PURPLE}"/>
          <path d="M24.4 5l1.2 3.4 3.4 1.2-3.4 1.2-1.2 3.4-1.2-3.4-3.4-1.2 3.4-1.2z" fill="${PURPLE_L}"/>` },

  { id: 'wtaToolAiWriter', file: 'ic-ai-write',
    svg: `<path d="M4 27.6l1.3-5L18.6 9.3a2.8 2.8 0 014 0l1.9 1.9a2.8 2.8 0 010 4L11.2 28.4 4 27.6z" fill="${PURPLE}"/>
          <path d="M16.8 11.1l6.1 6.1" stroke="#fff" stroke-width="1.6" opacity=".85"/>
          <path d="M25.2 2.6l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="${PURPLE_L}"/>` },

  { id: 'wtaToolImgPdf', file: 'ic-img-pdf',
    svg: photo(2.5, 6, 19, 15.5, AMBER)
      + `<rect x="17" y="14.5" width="12.5" height="14.5" rx="2.4" fill="${RED}" stroke="#fff" stroke-width="1.6"/>`
      + `<text x="23.2" y="24" text-anchor="middle" font-family="Arial" font-weight="700" font-size="5.6" fill="#fff">PDF</text>` },

  { id: 'wtaToolImgConvert', file: 'ic-img-convert',
    svg: photo(2.5, 6.5, 18, 14.5, AMBER)
      + `<path d="M25.4 10v12.4" stroke="${GRAY}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
         <path d="M22 19.4l3.4 3.6 3.4-3.6" stroke="${GRAY}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` },

  { id: 'wtaToolImgWm', file: 'ic-img-wm',
    svg: `<rect x="2.5" y="5" width="17" height="12.5" rx="2.2" fill="${AMBER_L}"/>`
      + `<circle cx="7" cy="9" r="1.7" fill="#fff"/>`
      + `<path d="M3.6 16.2l4.6-4.4 3 3 2-2 2.6 2.8z" fill="#fff" opacity=".95"/>`
      + `<path d="M23.4 12.4c3.2 4.2 4.8 6.4 4.8 8.4a4.8 4.8 0 11-9.6 0c0-2 1.6-4.2 4.8-8.4z" fill="${AMBER}"/>
         <text x="23.4" y="23" text-anchor="middle" font-family="Arial" font-weight="700" font-size="6.4" fill="#fff">T</text>` },

  { id: 'wtaToolImgDewm', file: 'ic-img-dewm',
    svg: `<rect x="2.5" y="5" width="17" height="12.5" rx="2.2" fill="${AMBER_L}"/>`
      + `<circle cx="7" cy="9" r="1.7" fill="#fff"/>`
      + `<path d="M3.6 16.2l4.6-4.4 3 3 2-2 2.6 2.8z" fill="#fff" opacity=".95"/>`
      + `<path d="M23.4 12.4c3.2 4.2 4.8 6.4 4.8 8.4a4.8 4.8 0 11-9.6 0c0-2 1.6-4.2 4.8-8.4z" fill="${AMBER}"/>`
      + `<path d="M19.8 26.4l7.4-9.8" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>` },

  { id: 'wtaToolImgGrid', file: 'ic-img-grid',
    svg: `<rect x="3.5" y="3.5" width="11" height="11" rx="2.2" fill="${AMBER}"/>
          <rect x="17.5" y="3.5" width="11" height="11" rx="2.2" fill="${AMBER_L}"/>
          <rect x="3.5" y="17.5" width="11" height="11" rx="2.2" fill="${AMBER_L}"/>
          <rect x="17.5" y="17.5" width="11" height="11" rx="2.2" fill="${AMBER}" opacity=".45"/>` },

  { id: 'wtaToolPdfMerge', file: 'ic-pdf-merge',
    svg: `<rect x="1.5" y="12" width="9" height="12" rx="1.8" fill="${RED_L}"/>`
      + pdfDoc(4.5, 7, 9, 12, RED)
      + arrow(14.5, 16, 5.5)
      + pdfDoc(21, 5.5, 10, 21, RED) },

  { id: 'wtaToolPdfSplit', file: 'ic-pdf-split',
    svg: pdfDoc(2, 5.5, 10, 21, RED)
      + arrow(13.5, 16, 5.5)
      + `<rect x="21" y="4.5" width="9.5" height="11" rx="1.8" fill="${RED_L}"/>`
      + `<rect x="21" y="16.5" width="9.5" height="11" rx="1.8" fill="${RED}"/>` },

  { id: 'wtaToolPdfPage', file: 'ic-pdf-page',
    svg: `<rect x="1.5" y="10" width="13" height="17" rx="2" fill="#FADBD8"/>`
      + `<rect x="5.5" y="6.6" width="15" height="19" rx="2.2" fill="${RED_L}"/>`
      + `<rect x="9.5" y="3.2" width="16.5" height="21" rx="2.4" fill="${RED}"/>`
      + lines(12.5, 7.4, 10, 3, 3.6)
      + `<path d="M20.5 20.4h3.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>` },

  { id: 'wtaToolPdfWm', file: 'ic-pdf-wm',
    svg: pdfDoc(3, 3.5, 18, 25, RED)
      + `<path d="M23.4 15.6c2.9 3.8 4.3 5.8 4.3 7.6a4.3 4.3 0 11-8.6 0c0-1.8 1.4-3.8 4.3-7.6z" fill="${AMBER}" stroke="#fff" stroke-width="1.4"/>` },

  { id: 'wtaToolPdfSize', file: 'ic-pdf-size',
    svg: `<rect x="4.5" y="4.5" width="23" height="23" rx="3.2" fill="none" stroke="${RED}" stroke-width="2.6"/>
          <path d="M11 21l10-10" stroke="${RED}" stroke-width="2.4" stroke-linecap="round"/>
          <path d="M11 21v-4.2M11 21h4.2M21 11V6.8M21 11h-4.2" stroke="${RED}" stroke-width="2.2" stroke-linecap="round"/>` },

  { id: 'wtaToolWordPdf', file: 'ic-word-pdf',
    svg: doc(1.5, 4.5, 11.5, 23, BLUE, 'W', 9) + arrow(14, 16, 5.5) + pdfDoc(20.5, 9, 10, 14, RED) },

  { id: 'wtaToolPdfToWord', file: 'ic-pdf-word',
    svg: pdfDoc(1.5, 9, 10, 14, RED) + arrow(12.5, 16, 5.5) + doc(19.5, 4.5, 11.5, 23, BLUE, 'W', 9) },

  { id: 'wtaToolPdfToExcel', file: 'ic-pdf-excel',
    svg: pdfDoc(1.5, 9, 10, 14, RED) + arrow(12.5, 16, 5.5) + doc(19.5, 4.5, 11.5, 23, GREEN, 'X', 9) },

  { id: 'wtaToolPdfToPpt', file: 'ic-pdf-ppt',
    svg: pdfDoc(1.5, 9, 10, 14, RED) + arrow(12.5, 16, 5.5) + doc(19.5, 4.5, 11.5, 23, ORANGE, 'P', 9) },

  { id: 'wtaToolPdfToMd', file: 'ic-pdf-md',
    svg: pdfDoc(1.5, 9, 10, 14, RED) + arrow(12.5, 16, 5.5) + doc(19.5, 4.5, 11.5, 23, GRAY, '#', 10) },

  { id: 'wtaToolPdfDewm', file: 'ic-pdf-dewm',
    svg: pdfDoc(2, 3.5, 17, 25, RED)
      + `<g transform="rotate(-42 22 22)">
           <rect x="14" y="18.4" width="15" height="7" rx="2" fill="#fff" stroke="${RED}" stroke-width="1.6"/>
           <rect x="14" y="18.4" width="6" height="7" rx="2" fill="${RED_L}"/>
         </g>` },

  { id: 'wtaToolWordReplace', file: 'ic-word-replace',
    svg: doc(1.5, 5.5, 9.5, 21, BLUE, 'A', 8)
      + `<path d="M13 13.6h4M16.4 11.4l2.2 2.2-2.2 2.2" stroke="${GRAY}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
      + `<path d="M13 19.6h4M16.4 17.4l2.2 2.2-2.2 2.2" stroke="${GRAY}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
      + doc(21, 5.5, 9.5, 21, GREEN, 'B', 8) },

  { id: 'wtaToolSheetMerge', file: 'ic-sheet-merge',
    svg: `<rect x="1.5" y="7" width="9" height="6.5" rx="1.2" fill="${GREEN_L}"/>
          <rect x="1.5" y="16.5" width="9" height="6.5" rx="1.2" fill="${GREEN}"/>`
      + arrow(12.5, 16, 5)
      + `<rect x="19" y="5" width="11.5" height="22" rx="2.2" fill="${GREEN}"/>
         <path d="M19 11.5h11.5M19 18h11.5M25 5v22" stroke="#fff" stroke-width="1.3" opacity=".9"/>` },

  { id: 'wtaToolSheetSplit', file: 'ic-sheet-split',
    svg: `<rect x="2" y="5" width="11.5" height="22" rx="2.2" fill="${GREEN}"/>
          <path d="M2 11.5h11.5M2 18h11.5M7.8 5v22" stroke="#fff" stroke-width="1.3" opacity=".9"/>`
      + arrow(15.5, 16, 5)
      + `<rect x="22" y="6.5" width="8.5" height="6.5" rx="1.2" fill="${GREEN_L}"/>
         <rect x="22" y="16.5" width="8.5" height="6.5" rx="1.2" fill="${GREEN}"/>` },

  { id: 'wtaToolSeatcard', file: 'ic-seatcard',
    svg: `<path d="M3.5 22.5L8 8.5h16l4.5 14z" fill="${GREEN}"/>
          <rect x="10.5" y="12.4" width="11" height="2.1" rx="1.05" fill="#fff"/>
          <rect x="9" y="16.6" width="14" height="2.1" rx="1.05" fill="#fff" opacity=".7"/>
          <rect x="6" y="25" width="20" height="2.6" rx="1.3" fill="${GREEN_L}"/>` },

  { id: 'wtaToolDocOutline', file: 'ic-doc-outline',
    svg: `<rect x="11" y="3.4" width="10" height="6.4" rx="1.8" fill="${TEAL}"/>
          <path d="M16 9.8v4.2M5.4 14h21.2M5.4 14v4M26.6 14v4" stroke="${TEAL}" stroke-width="1.8" fill="none"/>
          <rect x="2.6" y="18" width="9.6" height="6.8" rx="1.8" fill="${TEAL_L}"/>
          <rect x="19.8" y="18" width="9.6" height="6.8" rx="1.8" fill="${TEAL_L}"/>` },

  { id: 'wtaToolDocMind', file: 'ic-doc-mind',
    svg: `<rect x="6.5" y="12.6" width="12" height="6.8" rx="3.4" fill="${TEAL}"/>
          <path d="M18.5 16c2.6 0 2.2-8.4 4.4-8.4M18.5 16c2.6 0 2.2 8.4 4.4 8.4M18.5 16h4.4" stroke="${TEAL}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
          <rect x="23.2" y="5.2" width="6.4" height="4.6" rx="1.4" fill="${TEAL_L}"/>
          <rect x="23.2" y="13.7" width="6.4" height="4.6" rx="1.4" fill="${TEAL_L}"/>
          <rect x="23.2" y="22.2" width="6.4" height="4.6" rx="1.4" fill="${TEAL_L}"/>` },

  { id: 'wtaToolDocGrid', file: 'ic-doc-grid',
    svg: `<rect x="3.5" y="3.5" width="25" height="25" rx="2.6" fill="#E8F7F8" stroke="${TEAL}" stroke-width="1.8"/>
          <path d="M11.8 3.5v25M20.2 3.5v25M3.5 11.8h25M3.5 20.2h25" stroke="${TEAL}" stroke-width="1.1" opacity=".45"/>
          <rect x="11.8" y="11.8" width="8.4" height="8.4" fill="${TEAL}"/>` },

  { id: 'wtaToolVideoNowm', file: 'ic-video-dewm',
    svg: `<rect x="2.5" y="6" width="19" height="14" rx="3.2" fill="${PINK}"/>
          <path d="M9.6 10l6.4 3-6.4 3z" fill="#fff"/>
          <g transform="rotate(-42 23 23)">
            <rect x="14.5" y="19.6" width="15" height="6.6" rx="2" fill="#fff" stroke="${PINK}" stroke-width="1.5"/>
            <rect x="14.5" y="19.6" width="5.6" height="6.6" rx="2" fill="#F7A8C2"/>
          </g>` },

  { id: 'wtaBtnAbout', file: 'ic-about',
    svg: `<circle cx="16" cy="16" r="12.6" fill="${GRAY}"/>
          <circle cx="16" cy="9.8" r="1.9" fill="#fff"/>
          <rect x="14.2" y="13.4" width="3.6" height="9.6" rx="1.8" fill="#fff"/>` },

  /* ---- 以下仅在面板卡片中使用 ---- */
  { id: '', file: 'ic-kb',
    svg: `<rect x="2.6" y="6" width="12.4" height="20" rx="2.2" fill="#1A73E8"/>
          <rect x="17" y="6" width="12.4" height="20" rx="2.2" fill="#6FA8F5"/>
          <path d="M7 12h4M7 16h4M22 12h4M22 16h4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".9"/>` },

  { id: '', file: 'ic-format',
    svg: `<rect x="3.5" y="6" width="25" height="3.4" rx="1.7" fill="#1A73E8"/>
          <rect x="3.5" y="12.5" width="18" height="3" rx="1.5" fill="#6FA8F5"/>
          <rect x="3.5" y="18.5" width="25" height="3" rx="1.5" fill="#6FA8F5"/>
          <rect x="3.5" y="24.5" width="12" height="3" rx="1.5" fill="#1A73E8" opacity=".55"/>` },

  { id: '', file: 'ic-minutes',
    svg: `<rect x="5.5" y="5" width="21" height="24" rx="3" fill="#1A73E8"/>
          <rect x="11" y="2.6" width="10" height="5" rx="2" fill="#6FA8F5"/>
          <path d="M9.5 13h13M9.5 17.6h13M9.5 22.2h8" stroke="#fff" stroke-width="1.9" stroke-linecap="round" opacity=".92"/>` },

  { id: '', file: 'ic-quotes',
    svg: `<text x="4" y="23" font-family="Georgia,Arial" font-weight="700" font-size="24" fill="${PURPLE}">“</text>
          <path d="M21 22.6c4.6-.6 7.6-3.4 7.6-8.2 0-3-1.8-5-4.4-5-2.4 0-4.2 1.8-4.2 4.2 0 2.3 1.6 3.9 3.8 3.9.4 0 .8 0 1.1-.1-.5 1.7-2 3-4.4 3.4z" fill="${PURPLE}" opacity=".55"/>` },

  { id: '', file: 'ic-hotnews',
    svg: `<path d="M16.2 2.8c3.6 4.6 8.4 7.4 8.4 13a8.6 8.6 0 11-17.2 0c0-2.6 1.2-4.6 3-6.6.4 2 1.4 3.2 2.8 3.8.4-3.8.8-6.6 3-10.2z" fill="#F4511E"/>
          <path d="M16 15c2 2.4 3.6 4 3.6 6.2a3.7 3.7 0 11-7.4 0c0-2.2 1.6-3.8 3.8-6.2z" fill="#FFD9C7"/>` },

  { id: '', file: 'ic-writer',
    svg: `<path d="M28.2 3.4C20 4.6 12.4 8.6 9 16.2l-2.6 8 8-2.6C22 18 26 10.4 28.2 3.4z" fill="${PURPLE}"/>
          <path d="M9.6 22.6L23 8.4" stroke="#fff" stroke-width="1.5" opacity=".8"/>` },

  { id: '', file: 'ic-toolbox',
    svg: `<rect x="2.6" y="12" width="26.8" height="15.4" rx="3" fill="${GRAY}"/>
          <path d="M11.4 11.6V8.4a2.6 2.6 0 012.6-2.6h4a2.6 2.6 0 012.6 2.6v3.2" stroke="${GRAY}" stroke-width="2.6" fill="none"/>
          <rect x="2.6" y="12" width="26.8" height="4.4" fill="#7B8085"/>
          <rect x="13" y="17.2" width="6" height="3" rx="1.4" fill="#fff"/>` },

  { id: '', file: 'ic-music',
    svg: `<path d="M13.4 25V8.6l12.4-3v16.2" stroke="${PINK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
          <circle cx="9.8" cy="25" r="4.2" fill="${PINK}"/>
          <circle cx="22.2" cy="22" r="4.2" fill="${PINK}"/>` },

  { id: '', file: 'ic-movie',
    svg: `<rect x="2.6" y="8" width="26.8" height="18.4" rx="3" fill="${PINK}"/>
          <path d="M9 8v18.4M23 8v18.4" stroke="#fff" stroke-width="1.5" opacity=".55"/>
          <rect x="3.5" y="9" width="3.6" height="3.2" fill="#fff" opacity=".85"/>
          <rect x="3.5" y="22.2" width="3.6" height="3.2" fill="#fff" opacity=".85"/>
          <rect x="24.9" y="9" width="3.6" height="3.2" fill="#fff" opacity=".85"/>
          <rect x="24.9" y="22.2" width="3.6" height="3.2" fill="#fff" opacity=".85"/>
          <path d="M13.4 12.4l6 4.6-6 4.6z" fill="#fff"/>` },

  { id: '', file: 'ic-audio',
    svg: `<path d="M6.6 20.4v-3.6a9.4 9.4 0 0118.8 0v3.6" stroke="${PINK}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
          <rect x="2.6" y="18.4" width="6.6" height="10" rx="3.3" fill="${PINK}"/>
          <rect x="22.8" y="18.4" width="6.6" height="10" rx="3.3" fill="${PINK}"/>` },

  { id: '', file: 'ic-anime',
    svg: `<rect x="2.6" y="9.4" width="26.8" height="17.6" rx="3" fill="${PINK}"/>
          <path d="M10.6 4.2l5.4 5.2 5.4-5.2" stroke="${PINK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <circle cx="16" cy="18.2" r="4.6" fill="#fff"/>
          <circle cx="14.6" cy="17.4" r="1.1" fill="${PINK}"/>
          <circle cx="17.6" cy="17.4" r="1.1" fill="${PINK}"/>
          <path d="M13.8 20.4c1.4 1.2 3 1.2 4.4 0" stroke="${PINK}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` }
];

// ---- 生成雪碧图页面 ----
const COLS = 7;
const CELL = 128;
const rows = Math.ceil(ICONS.length / COLS);
const cells = ICONS.map(function (ic) {
  return `<div class="cell"><svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}" viewBox="0 0 32 32">${ic.svg}</svg></div>`;
}).join('\n');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;}
  .cell{width:${CELL}px;height:${CELL}px;float:left;}
  svg{display:block;}
</style></head><body>${cells}</body></html>`;

const htmlPath = path.join(tmp, 'icons.html');
fs.writeFileSync(htmlPath, html, 'utf8');

// ---- 无头 Edge 截图（透明底）----
const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
if (!edge) throw new Error('未找到 msedge.exe');

const shot = path.join(tmp, 'icons.png');
execFileSync(edge, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--default-background-color=00000000',
  `--window-size=${COLS * CELL},${rows * CELL}`,
  '--virtual-time-budget=3000',
  '--screenshot=' + shot,
  'file:///' + htmlPath.replace(/\\/g, '/')
], { timeout: 90000 });

// ---- Pillow 裁切 ----
const manifest = ICONS.map((ic, i) => ({ file: ic.file, row: Math.floor(i / COLS), col: i % COLS }));
const py = `
import json, sys
from PIL import Image
shot, out, cell = sys.argv[1], sys.argv[2], int(sys.argv[3])
items = json.loads(sys.argv[4])
im = Image.open(shot).convert('RGBA')
n = 0
for it in items:
    box = (it['col']*cell, it['row']*cell, (it['col']+1)*cell, (it['row']+1)*cell)
    ic = im.crop(box).resize((64, 64), Image.LANCZOS)
    ic.save(out + '/' + it['file'] + '.png', optimize=True)
    n += 1
print('cropped', n)
`;
execFileSync('python', ['-c', py, shot, outDir, String(CELL), JSON.stringify(manifest)], { stdio: 'inherit' });

console.log('[OK] 生成 ' + ICONS.length + ' 枚图标 → common/images');
console.log('[OK] 尺寸 ' + COLS * CELL + 'x' + rows * CELL + ' → ' + shot);
