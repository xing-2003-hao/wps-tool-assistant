/* ============================================================
 * WPS 工具助手 · 文档类工具（直接操作 WPS 宿主对象）
 *   sheet-merge   表格合并：当前工作簿多表纵向合并
 *   sheet-split   表格拆分：按某列的唯一值拆成多张表
 *   doc-seatcard  座位牌生成：名单 → 每页一个超大姓名
 * ============================================================ */
(function () {
  'use strict';

  function host() { return window.WTA_HOST ? window.WTA_HOST() : null; }
  function status(t, e) { if (window.WTA_setStatus) window.WTA_setStatus(t, e); }

  /* ---------------- 兼容取址 ----------------
   * WPS JSAPI 里 Worksheet.Cells 是 Range 对象，不是方法，直接 sheet.Cells(r,c)
   * 会报 "sheet.Cells is not a function"。这里按桥接能力逐级降级：
   *   1) Cells.Item(r,c)       —— Range 集合的标准取法
   *   2) Range('A1').Offset()  —— 只支持 A1 锚点也能work
   *   3) Range('B7')           —— 拼 A1 地址
   */
  function colLetter(n) {
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s || 'A';
  }

  function cellRef(sheet, r, c) {
    try { var x = sheet.Cells.Item(r, c); if (x) return x; } catch (e) { }
    try { var y = sheet.Range('A1').Offset(r - 1, c - 1); if (y) return y; } catch (e) { }
    try { var z = sheet.Range(colLetter(c) + r); if (z) return z; } catch (e) { }
    try { var w = sheet.Cells(r, c); if (w) return w; } catch (e) { }
    throw new Error('无法定位单元格 R' + r + 'C' + c + '（当前 WPS 版本不支持该取址方式）');
  }

  function rangeOf(sheet, r1, c1, r2, c2) {
    try { var a = sheet.Range(cellRef(sheet, r1, c1), cellRef(sheet, r2, c2)); if (a) return a; } catch (e) { }
    try { var b = sheet.Range(colLetter(c1) + r1 + ':' + colLetter(c2) + r2); if (b) return b; } catch (e) { }
    try { var c = sheet.Range(colLetter(c1) + r1).Resize(r2 - r1 + 1, c2 - c1 + 1); if (c) return c; } catch (e) { }
    throw new Error('无法定位区域 ' + colLetter(c1) + r1 + ':' + colLetter(c2) + r2);
  }

  // 新建工作表：各桥接对 Add(Before, After) 的参数容忍度不同，逐级降级
  function addSheet(wb) {
    var sheets = wb.Worksheets;
    try { var a = sheets.Add(); if (a) return a; } catch (e) { }
    try { var b = sheets.Add(null, sheets.Item(sheets.Count)); if (b) return b; } catch (e) { }
    try { var c = sheets.Add(sheets.Item(sheets.Count)); if (c) return c; } catch (e) { }
    throw new Error('无法新建工作表');
  }

  /* ---------------- 通用：把区域读成二维数组 ---------------- */
  function readSheet(sheet) {
    var ur = sheet.UsedRange;
    var rows = ur.Rows.Count, cols = ur.Columns.Count;
    if (!rows || !cols || rows < 1 || cols < 1) return [];
    var raw;
    try { raw = ur.Value2; } catch (e) { raw = null; }

    var matrix = [];
    if (raw && typeof raw === 'object' && raw.length !== undefined) {
      // 判定下标基：WPS 有时返回 1 基数组
      var oneBased = (raw[0] === undefined && raw[1] !== undefined);
      for (var r = 1; r <= rows; r++) {
        var line = [];
        var srcRow = oneBased ? raw[r] : raw[r - 1];
        for (var c = 1; c <= cols; c++) {
          var v = srcRow ? (oneBased ? srcRow[c] : srcRow[c - 1]) : '';
          line.push(v === undefined || v === null ? '' : v);
        }
        matrix.push(line);
      }
      return matrix;
    }
    if (raw !== undefined && raw !== null && rows === 1 && cols === 1) return [[raw]];
    // 兜底：逐行读（每行一次 Range 调用，比逐格快一个数量级）
    for (var i = 1; i <= rows; i++) {
      var ln = null;
      try {
        var rowVals = rangeOf(sheet, i, 1, i, cols).Value2;
        ln = normRow(rowVals, cols);
      } catch (e3) { ln = null; }
      if (!ln) {
        ln = [];
        for (var j2 = 1; j2 <= cols; j2++) {
          var cv;
          try { cv = cellRef(sheet, i, j2).Value2; } catch (e2) { cv = ''; }
          ln.push(cv === undefined || cv === null ? '' : cv);
        }
      }
      matrix.push(ln);
    }
    return matrix;
  }

  // 行数据归一化：兼容一维 / 二维 / 1 基 / 0 基 / 单值
  function normRow(vals, cols) {
    if (vals === undefined || vals === null) return null;
    if (typeof vals === 'string' || typeof vals === 'number' || typeof vals === 'boolean') {
      return cols === 1 ? [vals] : null;
    }
    if (typeof vals !== 'object' || vals.length === undefined) return null;
    // 取第一行：0 基时 vals[0]，1 基时 vals[1]
    var first = (vals[0] !== undefined) ? vals[0] : vals[1];
    var out = [];
    if (first && typeof first === 'object' && first.length !== undefined) {
      // 二维 [[...]]
      var ob2 = (first[0] === undefined && first[1] !== undefined);
      for (var j = 1; j <= cols; j++) {
        var a = ob2 ? first[j] : first[j - 1];
        out.push(a === undefined || a === null ? '' : a);
      }
      return out;
    }
    // 一维 [...]
    var ob1 = (vals[0] === undefined && vals[1] !== undefined);
    for (var k = 1; k <= cols; k++) {
      var b = ob1 ? vals[k] : vals[k - 1];
      out.push(b === undefined || b === null ? '' : b);
    }
    return out;
  }

  // 批量写入，失败时退化为逐格（大表会慢）
  function writeMatrix(sheet, row0, col0, matrix) {
    if (!matrix.length || !matrix[0].length) return;
    var rows = matrix.length, cols = matrix[0].length;
    try {
      var rng = rangeOf(sheet, row0, col0, row0 + rows - 1, col0 + cols - 1);
      rng.Value2 = matrix;
      return;
    } catch (e) { }
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        cellRef(sheet, row0 + r, col0 + c).Value2 = matrix[r][c];
      }
    }
  }

  /* ==================== 表格合并 ==================== */
  // 纯函数：把多张工作表（[{name, rows:[[...]]}]）纵向合并成一张二维表
  function mergeMatrices(tables, opts) {
    opts = opts || {};
    var hasHeader = opts.hasHeader !== false;
    var addSource = !!opts.addSource;
    var all = [];
    var widths = 0;

    (tables || []).forEach(function (t) {
      if (!t || !t.rows || !t.rows.length) return;
      var isFirstTable = (all.length === 0);
      widths = Math.max(widths, t.rows[0].length);
      // 第一张表整表保留（含表头），其余表去掉表头行
      var start = (hasHeader && !isFirstTable) ? 1 : 0;
      for (var r = start; r < t.rows.length; r++) {
        var line = t.rows[r].slice();
        if (addSource) {
          // 表头行的首格写列名，数据行写来源表名，避免表头错位/多一行
          var isHeaderRow = (hasHeader && isFirstTable && r === 0);
          line.unshift(isHeaderRow ? '来源表名' : t.name);
        }
        all.push(line);
      }
    });
    if (!all.length) return [];

    var cols = widths + (addSource ? 1 : 0);
    for (var k = 0; k < all.length; k++) {
      while (all[k].length < cols) all[k].push('');
    }
    return all;
  }

  function sheetMerge() {
    var h = host();
    if (!h || h.type !== 'et') { status('这个工具要在 WPS 表格里用：请打开一个表格（.xlsx/.et）文件，在表格右侧的本助手面板里再点它' + (h && h.type !== 'unknown' ? '（当前面板开在' + (h.type === 'wps' ? '文字' : '演示') + '文档上）' : ''), true); return; }

    TK.modal({
      title: '🧩 表格合并',
      hint: '把当前工作簿里的所有工作表纵向合并到一张新表。适合结构相同的多张月表 / 部门表。',
      runLabel: '开始合并',
      body:
        '<label class="tk-row tk-inline"><input id="sm-header" type="checkbox" checked><span>每张表首行是表头（只保留第一张的）</span></label>' +
        '<label class="tk-row tk-inline"><input id="sm-source" type="checkbox"><span>在结果里加一列「来源表名」</span></label>' +
        '<label class="tk-row"><span>结果表名</span><input id="sm-name" type="text" value="合并结果"></label>',
      onRun: function () {
        var hasHeader = TK.checked('#sm-header');
        var addSource = TK.checked('#sm-source');
        var outName = (TK.val('#sm-name') || '合并结果').replace(/[\[\]:*?\/\\]/g, '_');
        var wb = h.app.ActiveWorkbook;
        var sheets = wb.Worksheets;
        var count = sheets.Count;
        var tables = [];

        for (var i = 1; i <= count; i++) {
          var sh = sheets.Item(i);
          var name = sh.Name;
          if (name === outName) continue;
          var m = readSheet(sh);
          if (!m.length) continue;
          tables.push({ name: name, rows: m });
          TK.msg('已读取 ' + name + '（' + m.length + ' 行）');
        }

        var all = mergeMatrices(tables, { hasHeader: hasHeader, addSource: addSource });
        if (!all.length) throw new Error('没有读到任何数据');
        var cols = all[0].length;

        // 删掉同名旧结果表，避免重复
        try { wb.Worksheets.Item(outName).Delete(); } catch (e) {}
        var target = addSheet(wb);
        target.Name = outName;
        writeMatrix(target, 1, 1, all);
        try { target.Rows.Item(1).Font.Bold = true; } catch (e) {}
        status('合并完成：' + all.length + ' 行 × ' + cols + ' 列 →「' + outName + '」');
        TK.resultBox([], '已写入工作表「' + outName + '」，共 ' + all.length + ' 行');
        try { target.Activate(); } catch (e) {}
      }
    });
  }

  /* ==================== 表格拆分 ==================== */
  function sheetSplit() {
    var h = host();
    if (!h || h.type !== 'et') { status('这个工具要在 WPS 表格里用：请打开一个表格（.xlsx/.et）文件，在表格右侧的本助手面板里再点它' + (h && h.type !== 'unknown' ? '（当前面板开在' + (h.type === 'wps' ? '文字' : '演示') + '文档上）' : ''), true); return; }

    var wb = h.app.ActiveWorkbook;
    var sh = wb.ActiveSheet;
    var sample = [];
    try { sample = readSheet(sh).slice(0, 3); } catch (e) {}
    var headCells = (sample[0] || []).map(function (v, i) {
      return '<option value="' + (i + 1) + '">' + (i + 1) + ' - ' + String(v || '').slice(0, 12) + '</option>';
    }).join('');

    TK.modal({
      title: '🔪 表格拆分',
      hint: '按某一列的唯一值，把当前表拆成多张工作表（如按「部门」「地区」拆）。',
      runLabel: '开始拆分',
      body:
        '<label class="tk-row"><span>按哪一列拆</span><select id="ss-col">' + (headCells || '<option value="1">1</option>') + '</select></label>' +
        '<label class="tk-row tk-inline"><input id="ss-header" type="checkbox" checked><span>首行是表头（每张表都带上）</span></label>' +
        '<label class="tk-row"><span>表名前缀</span><input id="ss-prefix" type="text" value="拆_" placeholder="如：拆_"></label>',
      onRun: function () {
        var col = parseInt(TK.val('#ss-col'), 10) || 1;
        var hasHeader = TK.checked('#ss-header');
        var prefix = TK.val('#ss-prefix') || '拆_';
        var m = readSheet(sh);
        if (m.length < 2) throw new Error('当前表没有数据');
        var header = hasHeader ? m[0] : null;
        var startRow = hasHeader ? 1 : 0;

        var groups = {}, order = [];
        for (var r = startRow; r < m.length; r++) {
          var key = String(m[r][col - 1] === '' ? '（空）' : m[r][col - 1]);
          if (!groups[key]) { groups[key] = []; order.push(key); }
          groups[key].push(m[r]);
        }
        if (order.length > 60) throw new Error('唯一值过多（' + order.length + ' 个），请先筛选或改用透视表');

        var made = 0;
        order.forEach(function (key) {
          var rows = groups[key];
          if (header) rows = [header].concat(rows);
          var nm = (prefix + key).replace(/[\[\]:*?\/\\]/g, '_').slice(0, 28);
          try { wb.Worksheets.Item(nm).Delete(); } catch (e) {}
          var t = addSheet(wb);
          t.Name = nm;
          writeMatrix(t, 1, 1, rows);
          made++;
          TK.msg('已生成 ' + made + ' / ' + order.length + ' 张：' + nm);
        });
        status('拆分完成：' + made + ' 张表');
        TK.resultBox([], '已按第 ' + col + ' 列拆成 ' + made + ' 张工作表');
      }
    });
  }

  /* ==================== 座位牌 ==================== */
  function seatcard() {
    var h = host();
    if (!h || h.type !== 'wps') { status('请在 WPS 文字中使用（当前宿主：' + (h ? h.type : '未知') + '）', true); return; }

    TK.modal({
      title: '💳 座位牌生成',
      hint: '每行一个姓名，生成「每页一个超大姓名」的新文档，直接打印即可。',
      runLabel: '生成文档',
      body:
        '<label class="tk-row tk-col"><span>姓名列表（每行一个）</span><textarea id="sc-names" rows="7" placeholder="张三&#10;李四&#10;王五"></textarea></label>' +
        '<label class="tk-row"><span>字号(pt)</span><input id="sc-size" type="number" value="72" min="20" max="200"></label>' +
        '<label class="tk-row"><span>字体</span><input id="sc-font" type="text" value="微软雅黑"></label>' +
        '<label class="tk-row tk-inline"><input id="sc-mirror" type="checkbox"><span>对折双面（同一姓名连续两页，方便折叠摆放）</span></label>',
      onRun: function () {
        var raw = TK.val('#sc-names') || '';
        var names = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (!names.length) throw new Error('没有解析到姓名');
        var size = TK.num('#sc-size', 72);
        var font = TK.val('#sc-font') || '微软雅黑';
        var mirror = TK.checked('#sc-mirror');

        var app = h.app;
        var doc = app.Documents.Add();
        var content = doc.Content;
        var list = [];
        names.forEach(function (n) { list.push(n); if (mirror) list.push(n); });

        for (var i = 0; i < list.length; i++) {
          var pIndex = doc.Paragraphs.Count;
          var para = doc.Paragraphs.Item(pIndex);
          para.Range.Text = list[i];
          para.Alignment = 1;                  // 居中
          para.Range.Font.Size = size;
          para.Range.Font.Name = font;
          para.Range.Font.Bold = true;
          try { para.SpaceBefore = 180; } catch (e) {}
          try { para.SpaceAfter = 180; } catch (e) {}
          if (i < list.length - 1) {
            try { content.InsertParagraphAfter(); } catch (e) {}
            try { doc.Content.InsertBreak(7); } catch (e) {}   // 7 = 分页符
          }
        }
        status('座位牌已生成：' + names.length + ' 个姓名' + (mirror ? '（双面 ' + list.length + ' 页）' : ''));
        TK.resultBox([], '已生成新文档，直接 Ctrl+P 打印');
      }
    });
  }

  window.WTA_OFFICE = {
    'sheet-merge': sheetMerge,
    'sheet-split': sheetSplit,
    'doc-seatcard': seatcard
  };

  // 供自测脚本使用：不同 WPS 桥接的取址/建表降级路径
  window.WTA_OFFICE_INTERNAL = {
    readSheet: readSheet, writeMatrix: writeMatrix, mergeMatrices: mergeMatrices,
    cellRef: cellRef, rangeOf: rangeOf, addSheet: addSheet, colLetter: colLetter
  };
})();
