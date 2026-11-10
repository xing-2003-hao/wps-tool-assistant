/* ============================================================
 * WPS 工具助手 · 模板中心（服务端下发，按套餐解锁）
 *   面板「模板」页：拉列表 → 点「生成文档」→ 在 WPS 文字新建排版好的文档
 *   模板正文用轻量 Markdown：# 标题 / ## 小标题 / - 列表 / | 表格 |
 *   依赖：window.WTA_HOST()（宿主 app）、window.WTA_LICENSE（地址/token/机器码）
 * ============================================================ */
(function () {
  'use strict';

  var list = [];
  var loading = false;
  var CAT_ORDER = ['', '行政', '汇报', '人事', '项目', '合同'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function status(t, err) {
    var el = $('tpl-status');
    if (!el) return;
    el.textContent = t || '';
    el.className = 'status' + (err ? ' error' : '');
  }

  /* ---------------- 与服务端通信 ---------------- */
  function lic() { return window.WTA_LICENSE || null; }
  function apiBase() {
    var L = lic();
    if (!L) return '';
    var c = L.cfg() || {};
    return String(c.api || L.defaultApi() || '').replace(/\/+$/, '');
  }
  function query() {
    var L = lic();
    if (!L) return '';
    var c = L.cfg() || {};
    return '?token=' + encodeURIComponent(c.token || '') +
      '&machine=' + encodeURIComponent(L.machineId() || '');
  }
  function getJson(path) {
    var L = lic();
    var base = apiBase();
    if (!base) return Promise.reject(new Error('没配置服务器地址'));
    /* 优先用 license.js 的 apiUrl（自动带发布平台 sharecode） */
    var url = (L && L.apiUrl) ? L.apiUrl(path) : base + path;
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, j: j }; });
    });
  }

  /* ---------------- 列表 ---------------- */
  function load(force) {
    if (loading) return Promise.resolve();
    if (list.length && !force) { render(); return Promise.resolve(); }
    loading = true;
    if (!list.length) status('加载模板…');   // 已有列表时静默刷新，不闪
    return getJson('/api/templates' + query()).then(function (r) {
      loading = false;
      var j = r.j || {};
      if (!j.templates) { status(j.error || '模板加载失败', true); render(); return; }
      list = j.templates;
      render();
      var locked = list.filter(function (t) { return t.locked; }).length;
      status(list.length
        ? ('共 ' + list.length + ' 个模板' + (locked ? '，其中 ' + locked + ' 个需要订阅' : ''))
        : '服务器上还没有模板');
    }).catch(function (e) {
      loading = false;
      status('连不上模板服务器：' + (e.message || '网络错误'), true);
      render();
    });
  }

  function filtered() {
    var q = ($('tpl-search') && $('tpl-search').value || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(function (t) {
      return (t.name || '').toLowerCase().indexOf(q) >= 0
        || (t.summary || '').toLowerCase().indexOf(q) >= 0
        || (t.category || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function planLabel(p) {
    return p === 'enterprise' ? '企业版' : (p === 'free' ? '免费' : '订阅版');
  }

  function render() {
    var grid = $('tpl-grid');
    if (!grid) return;
    var items = filtered();
    if (!items.length) {
      grid.innerHTML = '<div class="tpl-empty">' + (list.length ? '没有匹配的模板' : '暂无模板') + '</div>';
      return;
    }
    grid.innerHTML = items.map(function (t) {
      return '<div class="tpl-item' + (t.locked ? ' locked' : '') + '" data-id="' + t.id + '">'
        + '<div class="tpl-top"><span class="tpl-name">' + esc(t.name) + '</span>'
        + (t.category ? '<span class="tpl-cat">' + esc(t.category) + '</span>' : '')
        + '</div>'
        + '<div class="tpl-sum">' + esc(t.summary || '') + '</div>'
        + (t.locked
          ? '<button class="tpl-btn lock" data-id="' + t.id + '">' + planLabel(t.plan) + ' · 未解锁</button>'
          : '<button class="tpl-btn" data-id="' + t.id + '">生成文档</button>')
        + '</div>';
    }).join('');
  }

  /* ---------------- Markdown 解析 ---------------- */
  function splitRow(line) {
    var s = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (x) { return strip(x.trim()); });
  }
  function strip(s) {
    return String(s == null ? '' : s)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\s+$/, '');
  }
  function isSep(line) { return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.indexOf('-') >= 0; }

  function parse(md) {
    var lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    var blocks = [];
    var i = 0;
    while (i < lines.length) {
      var raw = lines[i];
      var s = raw.trim();
      if (!s) { i++; continue; }

      /* 表格：| a | b | 紧跟 | --- | --- | */
      if (s.charAt(0) === '|' && i + 1 < lines.length && isSep(lines[i + 1])) {
        var head = splitRow(s);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].trim().charAt(0) === '|') {
          rows.push(splitRow(lines[i].trim()));
          i++;
        }
        blocks.push({ type: 'table', head: head, rows: rows });
        continue;
      }
      if (/^###\s+/.test(s)) { blocks.push({ type: 'h3', text: strip(s.replace(/^###\s+/, '')) }); i++; continue; }
      if (/^##\s+/.test(s)) { blocks.push({ type: 'h2', text: strip(s.replace(/^##\s+/, '')) }); i++; continue; }
      if (/^#\s+/.test(s)) { blocks.push({ type: 'h1', text: strip(s.replace(/^#\s+/, '')) }); i++; continue; }
      if (/^[-*·]\s+/.test(s)) { blocks.push({ type: 'li', text: strip(s.replace(/^[-*·]\s+/, '')) }); i++; continue; }
      blocks.push({ type: 'p', text: strip(s) });
      i++;
    }
    return blocks;
  }

  /* ---------------- 写入 WPS 文字 ---------------- */
  function setFont(p, name, size, bold) {
    try { p.Range.Font.Name = name; } catch (e) { }
    try { p.Range.Font.Size = size; } catch (e) { }
    try { if (bold) p.Range.Font.Bold = true; } catch (e) { }
  }

  function stylePara(p, type) {
    try { p.LineSpacing = 16; } catch (e) { }
    if (type === 'h1') {
      setFont(p, '黑体', 16, true);
      try { p.Alignment = 1; } catch (e) { }          // 居中
      try { p.SpaceBefore = 10; p.SpaceAfter = 12; } catch (e) { }
      try { p.LineSpacing = 20; } catch (e) { }
    } else if (type === 'h2') {
      setFont(p, '黑体', 13, true);
      try { p.SpaceBefore = 10; p.SpaceAfter = 4; } catch (e) { }
    } else if (type === 'h3') {
      setFont(p, '黑体', 11.5, true);
      try { p.SpaceBefore = 6; p.SpaceAfter = 2; } catch (e) { }
    } else if (type === 'li') {
      setFont(p, '宋体', 10.5, false);
      try { p.LeftIndent = 12; } catch (e) { }
    } else {
      setFont(p, '宋体', 10.5, false);
      try { p.CharacterUnitFirstLineIndent = 2; } catch (e) { }
    }
  }

  function writeTable(doc, b) {
    var cols = Math.max(b.head.length, 1);
    var rows = 1 + b.rows.length;
    var rng = null;
    try {
      var end = doc.Content.End - 1;
      rng = doc.Range(end, end);
    } catch (e) { }
    if (!rng) return false;
    var tbl;
    try { tbl = doc.Tables.Add(rng, rows, cols); } catch (e) { return false; }
    for (var c = 0; c < cols; c++) {
      try { tbl.Cell(1, c + 1).Range.Text = b.head[c] || ''; } catch (e) { }
    }
    for (var r = 0; r < b.rows.length; r++) {
      for (var c2 = 0; c2 < cols; c2++) {
        try { tbl.Cell(r + 2, c2 + 1).Range.Text = b.rows[r][c2] || ''; } catch (e) { }
      }
    }
    try { tbl.Rows.Item(1).Range.Font.Bold = true; } catch (e) { }
    try { tbl.Range.Font.Name = '宋体'; tbl.Range.Font.Size = 9.5; } catch (e) { }
    try { tbl.Rows.Item(1).Range.Font.Size = 10; } catch (e) { }
    return true;
  }

  function writeDoc(doc, blocks) {
    var first = true;
    blocks.forEach(function (b) {
      if (b.type === 'table') {
        if (!first) { try { doc.Content.InsertParagraphAfter(); } catch (e) { } }
        first = false;
        if (!writeTable(doc, b)) {
          /* 表格失败 → 降级为文本行，至少内容不丢 */
          var line = b.head.join('　|　');
          var p0 = doc.Paragraphs.Item(doc.Paragraphs.Count);
          p0.Range.Text = line;
          setFont(p0, '宋体', 9.5, false);
          b.rows.forEach(function (r) {
            try { doc.Content.InsertParagraphAfter(); } catch (e) { }
            var p1 = doc.Paragraphs.Item(doc.Paragraphs.Count);
            p1.Range.Text = r.join('　|　');
            setFont(p1, '宋体', 9.5, false);
          });
        }
        return;
      }
      if (!first) { try { doc.Content.InsertParagraphAfter(); } catch (e) { } }
      first = false;
      var p = doc.Paragraphs.Item(doc.Paragraphs.Count);
      p.Range.Text = (b.type === 'li' ? '· ' : '') + (b.text || '');
      stylePara(p, b.type);
    });
  }

  function generate(id) {
    var t = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) t = list[i];
    if (!t) return;
    if (t.locked) { status('该模板需要「' + planLabel(t.plan) + '」，请先激活卡密', true); return; }

    var H = window.WTA_HOST ? window.WTA_HOST() : null;
    if (!H || !H.app) { status('请在 WPS 里打开这个面板', true); return; }
    if (H.type !== 'wps') { status('模板只能生成到 WPS 文字，请切到文字文档再试', true); return; }

    status('正在获取「' + t.name + '」…');
    getJson('/api/templates/' + t.id + query()).then(function (r) {
      if (r.status === 403) { status((r.j && r.j.error) || '没有权限使用该模板', true); return; }
      if (!r.j || !r.j.template) { status((r.j && r.j.error) || '模板不存在', true); return; }
      var body = r.j.template.body || '';
      var blocks = parse(body);
      if (!blocks.length) { status('模板内容为空', true); return; }

      var doc;
      try { doc = H.app.Documents.Add(); } catch (e) { status('新建文档失败，请先在 WPS 文字里打开一个文档', true); return; }
      try {
        writeDoc(doc, blocks);
        try { doc.Application.Selection.HomeKey(6); } catch (e) { }
        status('已生成「' + t.name + '」，Ctrl+S 保存到本地');
      } catch (e) {
        status('写入文档失败：' + (e.message || e), true);
      }
    }).catch(function (e) {
      status('获取模板失败：' + (e.message || '网络错误'), true);
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    var grid = $('tpl-grid');
    if (grid && !grid.__bound) {
      grid.__bound = true;
      grid.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.tpl-btn') : null;
        if (!btn) return;
        generate(Number(btn.getAttribute('data-id')));
      });
    }
    var s = $('tpl-search');
    if (s && !s.__bound) { s.__bound = true; s.addEventListener('input', render); }
    var rf = $('tpl-refresh');
    if (rf && !rf.__bound) { rf.__bound = true; rf.onclick = function () { load(true); }; }
  }

  window.WTA_TPL = {
    init: function () { bind(); load(true); },   // 每次进页签都重新拉，激活/续费后立刻解锁
    reload: function () { return load(true); },
    parse: parse        // 供自测
  };
})();
