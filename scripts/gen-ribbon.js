/* 生成三端 ribbon.xml（功能区按钮）
 * 注意：按钮必须包在 <group> 里，直接挂 tab 下 WPS 不渲染
 * 用法：node scripts/gen-ribbon.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const groups = [
  ['gPanel', '助手', [['wtaBtnPanel', '助手面板', true, 'OnShowPanel']]],
  ['gAi', '智能 AI', [['wtaToolAiAssistant', 'AI 助手', true], ['wtaToolAiWriter', 'AI 写作', true]]],
  ['gImg', '图片工具', [
    ['wtaToolImgPdf', '图片转 PDF', true],
    ['wtaToolImgConvert', '图片压缩', true],
    ['wtaToolImgWm', '加水印', false],
    ['wtaToolImgDewm', '去水印', false],
    ['wtaToolImgGrid', '九宫格', false]
  ]],
  ['gPdf', 'PDF 工具', [
    ['wtaToolPdfMerge', 'PDF 合并', true],
    ['wtaToolPdfSplit', 'PDF 拆分', true],
    ['wtaToolPdfPage', '页面管理', false],
    ['wtaToolPdfWm', '加水印', false],
    ['wtaToolPdfSize', '尺寸调整', false]
  ]],
  ['gPdfConv', 'PDF 转换', [
    ['wtaToolWordPdf', 'Word 转 PDF', true],
    ['wtaToolPdfToWord', '转 Word', true],
    ['wtaToolPdfToExcel', '转 Excel', true],
    ['wtaToolPdfToPpt', '转 PPT', false],
    ['wtaToolPdfToMd', '转 Markdown', false],
    ['wtaToolPdfDewm', '去水印', false]
  ]],
  ['gDoc', '文档 · 表格', [
    ['wtaToolWordReplace', '批量替换', true],
    ['wtaToolSheetMerge', '表格合并', true],
    ['wtaToolSheetSplit', '表格拆分', false],
    ['wtaToolSeatcard', '座位牌', false]
  ]],
  ['gGraph', '图形生成', [
    ['wtaToolDocOutline', '组织架构图', true],
    ['wtaToolDocMind', '思维导图', true],
    ['wtaToolDocGrid', '千字稿纸', false]
  ]],
  ['gNet', '网络', [['wtaToolVideoNowm', '短视频去水印', false]]],
  ['gAbout', '关于', [['wtaBtnAbout', '关于', false, 'OnAbout']]]
];

let body = '';
for (const [id, label, items] of groups) {
  body += `        <group id="${id}" label="${label}">\n`;
  for (const it of items) {
    const action = it[3] || 'OnTool';
    // getImage：由 main.js 的 OnGetImage 按按钮 id 返回 images/xxx.png（相对加载项根目录）
    body += `          <button id="${it[0]}" label="${it[1]}"${it[2] ? ' size="large"' : ''} onAction="${action}" getImage="OnGetImage"/>\n`;
  }
  body += '        </group>\n';
}

const ribbon = `<?xml version="1.0" encoding="UTF-8"?>
<customUI xmlns="http://schemas.kingsoft/wpsdesigner/customUI/1.0" onload="OnAddinLoad">
  <ribbon>
    <tabs>
      <tab id="wtaTab" label="工具助手">
${body}      </tab>
    </tabs>
  </ribbon>
</customUI>
`;

for (const d of ['wps', 'et', 'wpp']) {
  fs.writeFileSync(path.join(root, d, 'ribbon.xml'), ribbon, 'utf8');
  console.log('written', d + '/ribbon.xml');
}
