/* 表格读写取址降级自测：node scripts/selftest-office.js
 * 复现 WPS 里 Worksheet.Cells 不能当函数调用的情况，验证 readSheet / writeMatrix /
 * addSheet 在三种桥接形态下都能正确取到数据。
 */
const path = require('path');

global.window = {};
require(path.join(__dirname, '..', 'common', 'officetools.js'));
const IO = global.window.WTA_OFFICE_INTERNAL;

const DATA = [
  ['姓名', '部门', '金额'],
  ['张三', '销售', 1200],
  ['李四', '技术', 980],
  ['王五', '销售', 1500]
];

function colIdx(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function makeSheet(data, mode) {
  const written = [];
  const sheet = { __written: written, Name: '测试表' };

  const cellObj = (r, c) => {
    const o = {
      __rc: [r, c],
      get Value2() { return (data[r - 1] || [])[c - 1] === undefined ? '' : data[r - 1][c - 1]; },
      set Value2(v) { written.push([r, c, v]); }
    };
    return o;
  };

  const block = (r1, c1, r2, c2) => {
    const m = [];
    for (let r = r1; r <= r2; r++) {
      const line = [];
      for (let c = c1; c <= c2; c++) {
        const v = (data[r - 1] || [])[c - 1];
        line.push(v === undefined ? '' : v);
      }
      m.push(line);
    }
    const o = { get Value2() { return m; }, set Value2(v) { written.push([r1, c1, 'BLOCK', v]); } };
    o.Offset = () => block(r1 + 1, c1 + 1, r2 + 1, c2 + 1);
    o.Resize = (dr, dc) => block(r1, c1, r1 + dr - 1, c1 + dc - 1);
    return o;
  };

  // Worksheet.Cells：真实 WPS 里是 Range 对象，函数调用会抛 TypeError
  const cells = {};
  if (mode !== 'noCellsItem') {
    cells.Item = (r, c) => cellObj(r, c);
  } else {
    cells.Item = () => { throw new TypeError('Item 不可用'); };
  }
  // 故意让它不可调用：模拟 "sheet.Cells is not a function"
  cells.apply = undefined;
  cells.call = undefined;
  sheet.Cells = cells;

  sheet.Range = function (a, b) {
    if (mode === 'onlyCellsItem') throw new TypeError('Range 不可用');
    if (mode === 'onlyA1String') {
      if (typeof a === 'string' && a === 'A1') throw new TypeError('Range(A1) 不可用');
      if (typeof a === 'string' && a.indexOf(':') > 0) {
        const [s, e] = a.split(':');
        const p1 = s.match(/^([A-Z]+)(\d+)$/), p2 = e.match(/^([A-Z]+)(\d+)$/);
        return block(+p1[2], colIdx(p1[1]), +p2[2], colIdx(p2[1]));
      }
      if (typeof a === 'string') {
        const p = a.match(/^([A-Z]+)(\d+)$/);
        return cellObj(+p[2], colIdx(p[1]));
      }
      throw new TypeError('Range 参数不支持');
    }
    if (typeof a === 'string' && a.indexOf(':') > 0) {
      const [s, e] = a.split(':');
      const p1 = s.match(/^([A-Z]+)(\d+)$/), p2 = e.match(/^([A-Z]+)(\d+)$/);
      return block(+p1[2], colIdx(p1[1]), +p2[2], colIdx(p2[1]));
    }
    if (b && b.__rc) return block(a.__rc[0], a.__rc[1], b.__rc[0], b.__rc[1]);
    if (b) {
      const rc1 = a.__rc, rc2 = b.__rc;
      if (rc1 && rc2) return block(rc1[0], rc1[1], rc2[0], rc2[1]);
    }
    // Range('A1') → 单格并支持 Offset
    if (typeof a === 'string') {
      const p = a.match(/^([A-Z]+)(\d+)$/);
      if (p) {
        const base = block(+p[2], colIdx(p[1]), +p[2], colIdx(p[1]));
        return {
          Offset: (dr, dc) => cellObj(+p[2] + dr, colIdx(p[1]) + dc),
          Resize: (dr, dc) => block(+p[2], colIdx(p[1]), +p[2] + dr - 1, colIdx(p[1]) + dc - 1)
        };
      }
    }
    throw new TypeError('Range 参数不支持');
  };

  // 让 cellObj 带上坐标，供 Range(cell1, cell2) 识别
  const wrap = (fn) => fn;
  sheet.UsedRange = {
    Rows: { Count: data.length },
    Columns: { Count: data[0].length },
    // 返回无 length 的对象，强制走逐行/逐格兜底路径
    Value2: {}
  };
  return sheet;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' → ' + extra : '')); }
}

console.log('== readSheet 三种桥接形态 ==');
['cellsItem', 'noCellsItem', 'onlyA1String'].forEach((mode) => {
  let m;
  try { m = IO.readSheet(makeSheet(DATA, mode)); }
  catch (e) { m = 'THROW ' + e.message; }
  console.log(' [' + mode + '] ' + (typeof m === 'string' ? m : m.length + ' 行'));
  check(mode + ' 读取行数', Array.isArray(m) && m.length === DATA.length, typeof m === 'string' ? m : '');
  check(mode + ' 内容一致', Array.isArray(m) && deepEqual(m, DATA));
});

console.log('== 原写法必须复现报错 ==');
const bad = makeSheet(DATA, 'cellsItem');
let oldErr = '';
try { bad.Cells(1, 1); } catch (e) { oldErr = e.message; }
check('sheet.Cells(r,c) 确实不可调用', /not a function/.test(oldErr), oldErr);

console.log('== writeMatrix 批量 / 逐格 ==');
{
  const sh = makeSheet(DATA, 'cellsItem');
  IO.writeMatrix(sh, 1, 1, [['A', 'B'], ['C', 'D']]);
  check('写入被记录', sh.__written.length > 0, JSON.stringify(sh.__written.slice(0, 2)));
}
{
  // Range 双参不可用 → 逐格写
  const sh = makeSheet(DATA, 'onlyCellsItem');
  let err = '';
  try { IO.writeMatrix(sh, 2, 2, [['X']]); } catch (e) { err = e.message; }
  check('逐格写入不报错', !err, err);
  check('逐格写入命中 (2,2)', sh.__written.some((w) => w[0] === 2 && w[1] === 2 && w[2] === 'X'), JSON.stringify(sh.__written));
}

console.log('== addSheet 降级 ==');
{
  let calls = [];
  const wb = {
    Worksheets: {
      Count: 2,
      Item: (i) => ({ delete: () => { } }),
      Add: function () {
        calls.push(arguments.length);
        if (arguments.length === 0) return { Name: 'Sheet3', __via: 'noarg' };
        throw new TypeError('Add 参数不支持');
      }
    }
  };
  const s = IO.addSheet(wb);
  check('Add() 无参可用', s && s.__via === 'noarg');
}
{
  const wb = {
    Worksheets: {
      Count: 2,
      Item: () => ({}),
      Add: function () {
        if (arguments.length === 0) throw new TypeError('必须给位置');
        return { Name: 'Sheet3' };
      }
    }
  };
  let s = null, err = '';
  try { s = IO.addSheet(wb); } catch (e) { err = e.message; }
  check('Add(null, last) 降级可用', !!s, err);
}

console.log('== 列字母换算 ==');
check('1→A', IO.colLetter(1) === 'A');
check('27→AA', IO.colLetter(27) === 'AA');
check('52→AZ', IO.colLetter(52) === 'AZ');

console.log('== 合并算法 mergeMatrices ==');
{
  const t1 = { name: '一月', rows: [['姓名', '部门'], ['张三', '销售'], ['李四', '技术']] };
  const t2 = { name: '二月', rows: [['姓名', '部门'], ['王五', '销售']] };

  // 1) 有表头、不加来源列
  const r1 = IO.mergeMatrices([t1, t2], { hasHeader: true, addSource: false });
  check('有表头：行数 = 1 + 2 + 1', r1.length === 4, JSON.stringify(r1));
  check('有表头：只保留一份表头', JSON.stringify(r1[0]) === JSON.stringify(['姓名', '部门']), JSON.stringify(r1[0]));
  check('有表头：第二张表头被去掉', JSON.stringify(r1[3]) === JSON.stringify(['王五', '销售']), JSON.stringify(r1[3]));

  // 2) 有表头 + 来源列：表头只能有一行
  const r2 = IO.mergeMatrices([t1, t2], { hasHeader: true, addSource: true });
  check('来源列：表头行数不翻倍', r2.length === 4, JSON.stringify(r2));
  check('来源列：表头首格是「来源表名」', r2[0][0] === '来源表名', JSON.stringify(r2[0]));
  check('来源列：表头保留原列名', r2[0][1] === '姓名' && r2[0][2] === '部门', JSON.stringify(r2[0]));
  check('来源列：数据行首格是表名', r2[1][0] === '一月' && r2[3][0] === '二月', JSON.stringify([r2[1], r2[3]]));
  check('来源列：列数一致', r2.every((row) => row.length === 3), JSON.stringify(r2));

  // 3) 无表头 + 来源列：全部行保留
  const r3 = IO.mergeMatrices([t1, t2], { hasHeader: false, addSource: true });
  check('无表头：行数 = 3 + 2', r3.length === 5, JSON.stringify(r3));

  // 4) 列宽不一致 → 补齐空串
  const t3 = { name: '三月', rows: [['姓名'], ['赵六']] };
  const r4 = IO.mergeMatrices([t1, t3], { hasHeader: true, addSource: false });
  check('列宽不一：按最宽补空', r4.every((row) => row.length === 2) && r4[3][1] === '', JSON.stringify(r4));

  // 5) 空输入
  check('空输入返回 []', IO.mergeMatrices([], {}).length === 0);
  check('空表被跳过', IO.mergeMatrices([{ name: '空', rows: [] }, t1], { hasHeader: true }).length === 3);
}

console.log('\n' + (fail ? 'FAILED ' + fail : 'ALL PASS') + ' (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
