/* 把 common/ 下的面板文件同步到 wps / et / wpp 三个加载项目录
 * 用法：npm run sync   （或 node scripts/sync.js）
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const common = path.join(root, 'common');

const FILES = [
  'panel.html', 'panel.js', 'panel.css',
  'rag.js', 'tools.js', 'toolui.js',
  'imagetools.js', 'pdftools.js', 'officetools.js',
  'pdftext.js', 'ooxml.js', 'pdfconvert.js', 'docgen.js', 'webtools.js', 'docops.js',
  'license.js', 'templates.js'
];
const VENDOR = ['pdf-lib.min.js'];

let n = 0;
for (const host of ['wps', 'et', 'wpp']) {
  for (const f of FILES) {
    const src = path.join(common, f);
    if (!fs.existsSync(src)) throw new Error('缺少文件：common/' + f);
    fs.copyFileSync(src, path.join(root, host, f));
    n++;
  }
  // 图标
  const imgSrc = path.join(common, 'images');
  const imgDst = path.join(root, host, 'images');
  if (fs.existsSync(imgSrc)) {
    fs.rmSync(imgDst, { recursive: true, force: true });
    fs.mkdirSync(imgDst, { recursive: true });
    for (const f of fs.readdirSync(imgSrc)) {
      if (!f.toLowerCase().endsWith('.png')) continue;
      fs.copyFileSync(path.join(imgSrc, f), path.join(imgDst, f));
      n++;
    }
  }

  fs.mkdirSync(path.join(root, host, 'vendor'), { recursive: true });
  for (const v of VENDOR) {
    fs.copyFileSync(path.join(common, 'vendor', v), path.join(root, host, 'vendor', v));
    n++;
  }
}
console.log(`[OK] 已同步 ${n} 个文件到 wps / et / wpp`);
