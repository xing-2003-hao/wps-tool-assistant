/* 验证 pdf-lib API：合并 / 拆分 / 页面管理 / 尺寸调整 / PNG 水印 */
const fs = require('fs');
const path = require('path');
const PDFLib = require('../common/vendor/pdf-lib.min.js');

(async () => {
  const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;

  // 造两份 3 页 PDF
  async function make(n, label) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= n; i++) {
      const p = doc.addPage([595.28, 841.89]);
      p.drawText(label + ' page ' + i, { x: 60, y: 700, size: 24, font });
    }
    return Buffer.from(await doc.save());
  }

  const a = await make(3, 'A');
  const b = await make(2, 'B');

  // 1) 合并
  const out = await PDFDocument.create();
  for (const buf of [a, b]) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  const merged = await out.save();
  console.log('merge pages =', out.getPageCount(), 'bytes =', merged.length);

  // 2) 拆分（每页一份）
  const srcM = await PDFDocument.load(merged);
  const one = await PDFDocument.create();
  const [pg] = await one.copyPages(srcM, [2]);
  one.addPage(pg);
  console.log('split ok, pages =', one.getPageCount());

  // 3) 页面管理 + 旋转
  const pm = await PDFDocument.create();
  const picked = await pm.copyPages(srcM, [2, 0]);
  picked.forEach((p, i) => {
    p.setRotation(degrees((p.getRotation().angle + 90) % 360));
    pm.addPage(p);
  });
  console.log('page-manage ok, pages =', pm.getPageCount(), 'rot =', pm.getPage(0).getRotation().angle);

  // 4) 尺寸调整（scaleContent / translateContent / setSize）
  const rs = await PDFDocument.load(a);
  const target = [595.28, 841.89];
  rs.getPages().forEach((p) => {
    const w = p.getWidth(), h = p.getHeight();
    const s = Math.min(target[0] / w, target[1] / h);
    p.scaleContent(s, s);
    p.translateContent((target[0] - w * s) / 2, (target[1] - h * s) / 2);
    p.setSize(target[0], target[1]);
  });
  const rsBytes = await rs.save();
  console.log('resize ok, bytes =', rsBytes.length, 'size =', rs.getPage(0).getWidth().toFixed(1));

  // 5) PNG 水印叠加（圆点图替代 canvas 产物）
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+g5l3AAAAAElFTkSuQmCC',
    'base64'
  );
  const wmDoc = await PDFDocument.load(a);
  const img = await wmDoc.embedPng(png);
  wmDoc.getPages().forEach((p) => {
    p.drawImage(img, {
      x: p.getWidth() / 2, y: p.getHeight() / 2,
      width: 100, height: 100, opacity: 0.2, rotate: degrees(45)
    });
  });
  const wmBytes = await wmDoc.save();
  console.log('watermark ok, bytes =', wmBytes.length);

  // 6) JPEG 嵌入（图片转 PDF 路径）
  const jpgB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmAA/9k=';
  const jpg = Buffer.from(jpgB64, 'base64');
  const ip = await PDFDocument.create();
  const ji = await ip.embedJpg(jpg);
  const page = ip.addPage([ji.width + 20, ji.height + 20]);
  page.drawImage(ji, { x: 10, y: 10, width: ji.width, height: ji.height });
  console.log('jpg->pdf ok, size =', ji.width, 'x', ji.height);

  fs.writeFileSync(path.join(__dirname, '..', 'dist', 'selftest.pdf'), Buffer.from(merged));
  console.log('SELFTEST PASS');
})().catch((e) => {
  console.error('SELFTEST FAIL:', e && e.message);
  process.exit(1);
});
