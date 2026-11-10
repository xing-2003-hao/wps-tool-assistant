/* 排版指令引擎自测：node scripts/selftest-docops.js
 * 重点验证：执行格式指令后，选区必须还原（否则文档里出现「自己选中一大片」）。
 */
const path = require('path');

const sel = { Start: 10, End: 20, Text: '选中的十个字' };
let contentAccess = 0;
const deleted = [];      // 记录谁被删了：'sel' / 'para' / 'doc'

// 模拟一个可被设格式的 Range（applyOps 会写 Font / ParagraphFormat）
function makeFormattable() {
  return {
    Font: {
      Color: 0, Bold: 0, Italic: 0, Underline: 0, StrikeThrough: 0,
      Size: 12, Name: '宋体', HighlightColorIndex: 0
    },
    ParagraphFormat: {
      Alignment: 0, LineSpacingRule: 0, LineSpacing: 12,
      SpaceBefore: 0, SpaceAfter: 0, CharacterUnitFirstLineIndent: 0, FirstLineIndent: 0
    }
  };
}

const contentRange = makeFormattable();
contentRange.Font = {
  set Color(v) { sel.Start = 0; sel.End = 9999; },   // 模拟 WPS：改 doc.Content 会牵动选区
  Bold: 0, Italic: 0, Underline: 0, StrikeThrough: 0, Size: 12, Name: '宋体', HighlightColorIndex: 0
};
contentRange.Find = {
  ClearFormatting() { }, Execute() { sel.Start = 0; sel.End = 5; return false; }
};
contentRange.Delete = function () { deleted.push('doc'); };

// 选区自身也支持设格式
Object.assign(sel, makeFormattable());
sel.Delete = function () { deleted.push('sel'); };
const paraRange = makeFormattable();
paraRange.Text = '选中的十个字。';          // 与选区文字不同 → 走「删选中文字」
paraRange.Delete = function () { deleted.push('para'); };
sel.Paragraphs = { Item: () => ({ Range: paraRange }) };

// doc.Paragraphs：给「删除空段落」用
const docParas = ['第一段', '', '第三段'];
const doc = {
  Range(s, e) {
    return { Select() { sel.Start = s; sel.End = e; } };
  },
  Paragraphs: {
    get Count() { return docParas.length; },
    Item(i) {
      return {
        Range: {
          get Text() { return (docParas[i - 1] || '') + '\r'; },
          Delete() { deleted.push('blank#' + i); }
        }
      };
    }
  }
};
Object.defineProperty(doc, 'Content', {
  get() { contentAccess++; sel.Start = 0; sel.End = 9999; return contentRange; }
});

const app = {
  ActiveDocument: doc,
  get Selection() { return sel; }
};

global.window = {
  WTA_HOST: () => ({ type: 'wps', app: app })
};
require(path.join(__dirname, '..', 'common', 'docops.js'));
const DOC = global.window.WTA_DOC_OPS;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' → ' + extra : '')); }
}

console.log('== 全文指令后选区还原 ==');
sel.Start = 10; sel.End = 20;
{
  const r = DOC.run('全文改成红色字体');
  check('识别为全文范围', r.ok && /全文/.test(r.scope || ''), JSON.stringify(r));
  check('选区已还原（不是全选）', sel.Start === 10 && sel.End === 20, sel.Start + '-' + sel.End);
}

console.log('== 段落指令后选区还原 ==');
sel.Start = 33; sel.End = 33;   // 光标（无选区）
sel.Text = '';                  // 光标状态下 Selection.Text 为空
{
  const r = DOC.run('加粗');
  check('无选区时作用于当前段落', r.ok && /段落/.test(r.scope || ''), JSON.stringify(r));
  check('光标位置保持不变', sel.Start === 33 && sel.End === 33, sel.Start + '-' + sel.End);
}
sel.Text = '选中的十个字';

console.log('== 选区指令后选区还原 ==');
sel.Start = 5; sel.End = 8;
{
  const r = DOC.run('居中对齐');
  check('识别为选中内容', r.ok && /选中/.test(r.scope || ''), JSON.stringify(r));
  check('选区保持不变', sel.Start === 5 && sel.End === 8, sel.Start + '-' + sel.End);
}

console.log('== 查找类指令后选区还原 ==');
sel.Start = 3; sel.End = 3;
{
  DOC.run('把「个人优势」改成红色');
  check('查找后选区仍在原处', sel.Start === 3 && sel.End === 3, sel.Start + '-' + sel.End);
}

console.log('== 解析覆盖 ==');
[
  ['改成红色字体', '红'],
  ['高亮成黄色', '高亮'],
  ['1.5 倍行距', '行距'],
  ['首行缩进 2 字符', '缩进'],
  ['段前 6 磅', '段前'],
  ['字体改成微软雅黑', '字体'],
  ['字号 12 磅', '字号']
].forEach(([txt, kw]) => {
  const r = DOC.run(txt);
  const hit = r.ok && JSON.stringify(r).indexOf(kw) >= 0;
  check('解析：' + txt, !!hit, JSON.stringify(r));
});

console.log('== 删除类指令（本地执行，不走模型） ==');
sel.Text = '选中的十个字'; sel.Start = 5; sel.End = 15;
{
  const p = DOC.parse('删除这段话');
  check('识别成删除指令', p.ops.length === 1 && p.ops[0].type === 'delete', JSON.stringify(p));
  check('不会被当成普通提问放给模型', DOC.looksLikeFormat('删除这段话') === true);
}
{
  deleted.length = 0;
  const r = DOC.run('删除这段话');
  check('删掉选中内容', r.ok && r.kind === 'delete' && deleted.indexOf('sel') >= 0,
    JSON.stringify(r) + ' / ' + deleted);
}
{
  deleted.length = 0;
  const bak = paraRange.Text;
  paraRange.Text = '整段文字'; sel.Text = '整段文字';
  const r = DOC.run('删除本段');
  check('选中的正好是整段 → 连段落标记一起删（不留空行）',
    r.ok && deleted.indexOf('para') >= 0, JSON.stringify(r) + ' / ' + deleted);
  paraRange.Text = bak;
}
{
  deleted.length = 0;
  sel.Text = '';
  const r = DOC.run('删除这一段');
  check('没选字 → 删光标所在段落', r.ok && deleted.indexOf('para') >= 0,
    JSON.stringify(r) + ' / ' + deleted);
  sel.Text = '选中的十个字';
}
{
  const p1 = DOC.parse('去掉高亮');
  check('「去掉高亮」仍走排版，不删内容', p1.ops.length > 0 && p1.ops[0].type !== 'delete', JSON.stringify(p1));
  const p2 = DOC.parse('删除所有加粗');
  check('「删除所有加粗」不按删段处理', !(p2.ops[0] && p2.ops[0].type === 'delete'), JSON.stringify(p2));
}
{
  deleted.length = 0;
  const r = DOC.run('删除空行');
  check('删除空段落', r.ok && deleted.filter(function (d) { return d.indexOf('blank#') === 0; }).length === 1,
    JSON.stringify(r) + ' / ' + deleted);
}

console.log('\n' + (fail ? 'FAILED ' + fail : 'ALL PASS') + ' (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
