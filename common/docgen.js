/* ============================================================
 * WPS 工具助手 · 图形生成工具（canvas 绘制，离线）
 *   doc-outline   组织架构图：缩进/编号/路径文本 → 层级框图
 *   doc-mindmap   思维导图：同一份层级文本 → 右侧发散结构
 *   doc-thousand  千字模板：文字 → 田字格 / 横线稿纸手写体图片
 * 产物：PNG 保存到本地，可一键插入当前 WPS 文档
 * ============================================================ */
(function () {
  'use strict';

  function host() { return window.WTA_HOST ? window.WTA_HOST() : null; }
  function status(t, e) { if (window.WTA_setStatus) window.WTA_setStatus(t, e); }

  var FONT = '"Microsoft YaHei", "微软雅黑", sans-serif';
  var HAND_FONT = 'KaiTi, "楷体", "STKaiti", serif';

  /* ==================== 层级文本解析 ==================== */
  // 支持四种写法：
  //   1) 缩进（空格/制表符）         总经理 > 技术部 > 前端组
  //   2) 编号 1 / 1.1 / 1.1.1
  //   3) 路径 市场部 > 华东区 > 上海
  //   4) 两列（制表符分隔）上级 \t 下级
  function cleanNodeText(s) {
    return String(s)
      .replace(/^[\s\-–—*·•]+/, '')
      .replace(/^\d+(\.\d+)*[.、)．]?\s*/, '')
      .replace(/^[（(]\d+[）)]\s*/, '')
      .replace(/^[①-⑳]\s*/, '')
      .trim();
  }

  function parseTree(text) {
    var raw = String(text || '').replace(/\r\n/g, '\n').split('\n');
    var lines = raw.filter(function (l) { return l.trim(); });
    if (!lines.length) throw new Error('请先填写层级内容');

    // 4) 两列：上级 \t 下级
    var tabPairs = lines.filter(function (l) { return l.indexOf('\t') > 0; });
    if (tabPairs.length === lines.length) {
      var nodes = {}, order = [];
      function node(k) {
        if (!nodes[k]) { nodes[k] = { text: k, children: [], parent: null }; order.push(nodes[k]); }
        return nodes[k];
      }
      lines.forEach(function (l) {
        var f = l.split('\t');
        var p = cleanNodeText(f[0]), c = cleanNodeText(f[1]);
        if (!p || !c) return;
        var pn = node(p), cn = node(c);
        if (cn.parent) return;
        cn.parent = pn; pn.children.push(cn);
      });
      var roots = order.filter(function (n) { return !n.parent; });
      if (roots.length === 1) return roots[0];
      var virtualRoot = { text: '总览', children: roots, parent: null };
      roots.forEach(function (r) { r.parent = virtualRoot; });
      return virtualRoot;
    }

    // 3) 路径：全部行都含 > 或 →
    var pathSep = /[>＞→\/]/;
    var allPath = lines.every(function (l) { return pathSep.test(l); });
    if (allPath) {
      var rootP = { text: '总览', children: [], parent: null };
      var index = { '': rootP };
      lines.forEach(function (line) {
        var parts = line.split(pathSep).map(cleanNodeText).filter(Boolean);
        var key = '';
        var parent = rootP;
        parts.forEach(function (p) {
          key += '/' + p;
          if (!index[key]) {
            var n = { text: p, children: [], parent: parent };
            parent.children.push(n);
            index[key] = n;
          }
          parent = index[key];
        });
      });
      if (rootP.children.length === 1) return rootP.children[0];
      return rootP;
    }

    // 1) 缩进 / 2) 编号
    var root = { text: '', children: [], parent: null, level: -1 };
    var stack = [root];
    lines.forEach(function (line) {
      var indentRaw = line.match(/^[ \t]*/)[0];
      var indent = indentRaw.replace(/\t/g, '  ').length;
      var numMatch = line.match(/^\s*(\d+(?:\.\d+)*)[.、)．]?\s+/);
      var level;
      if (numMatch) level = numMatch[1].split('.').length - 1;
      else level = Math.round(indent / 2);

      var node = { text: cleanNodeText(line), children: [], parent: null, level: level };
      if (!node.text) return;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      var parent = stack[stack.length - 1];
      node.parent = parent;
      parent.children.push(node);
      stack.push(node);
    });
    var kids = root.children;
    if (!kids.length) throw new Error('没有解析出层级，请每行一项，用缩进表示下级');
    if (kids.length === 1) return kids[0];
    var vr = { text: '总览', children: kids, parent: null };
    kids.forEach(function (k) { k.parent = vr; });
    return vr;
  }

  /* ==================== 通用绘制工具 ==================== */
  function measure(ctx, text, font) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }
  function roundRect(ctx, x, y, w, h, r, fill, stroke, lw) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.2; ctx.stroke(); }
  }
  function fitText(ctx, text, maxW, font) {
    ctx.font = font;
    if (ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  /* ==================== 组织架构图 ==================== */
  var ORG_COLORS = [
    { fill: '#C0392B', text: '#FFFFFF', stroke: '#8E2A20' },
    { fill: '#FDF1EE', text: '#7A2A1F', stroke: '#E0A79B' },
    { fill: '#FFF8EC', text: '#7A5320', stroke: '#E8C98F' },
    { fill: '#FFFFFF', text: '#4A4A4A', stroke: '#DDD6CC' }
  ];

  function renderOrg(tree, opts) {
    opts = opts || {};
    var PAD = 40, VGAP = 66, HGAP = 26;
    var BOX_H = 54, FONT_SZ = 15;
    var scale = 2;                       // 高清

    // 1) 计算尺寸
    function measureNode(n, depth) {
      var probe = document.createElement('canvas').getContext('2d');
      var w = measure(probe, n.text, '600 ' + FONT_SZ + 'px ' + FONT) + 34;
      n._w = Math.max(96, Math.min(230, w));
      n._h = BOX_H;
      n._depth = depth;
      n.children.forEach(function (c) { measureNode(c, depth + 1); });
    }
    measureNode(tree, 0);

    var leafX = 0, maxDepth = 0;
    function layout(n) {
      maxDepth = Math.max(maxDepth, n._depth);
      if (!n.children.length) {
        n._x = leafX + n._w / 2;
        leafX += n._w + HGAP;
      } else {
        n.children.forEach(layout);
        var first = n.children[0], last = n.children[n.children.length - 1];
        n._x = (first._x + last._x) / 2;
      }
    }
    layout(tree);

    var allNodes = [];
    function collect(n) { allNodes.push(n); n.children.forEach(collect); }
    collect(tree);
    var minX = Infinity, maxX = -Infinity;
    allNodes.forEach(function (n) {
      minX = Math.min(minX, n._x - n._w / 2);
      maxX = Math.max(maxX, n._x + n._w / 2);
    });

    var width = maxX - minX + PAD * 2;
    var height = (maxDepth + 1) * (BOX_H + VGAP) - VGAP + PAD * 2;
    var W = Math.max(640, Math.ceil(width));
    var H = Math.max(360, Math.ceil(height));

    var cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    var ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    function pos(n) {
      return { x: n._x - minX + PAD, y: PAD + n._depth * (BOX_H + VGAP) };
    }

    // 2) 连线（肘形）
    ctx.strokeStyle = '#D9CFC4';
    ctx.lineWidth = 1.6;
    function drawLinks(n) {
      var p = pos(n);
      n.children.forEach(function (c) {
        var q = pos(c);
        var y1 = p.y + BOX_H, y2 = q.y, midY = (y1 + y2) / 2;
        ctx.beginPath();
        ctx.moveTo(p.x, y1);
        ctx.lineTo(p.x, midY);
        ctx.lineTo(q.x, midY);
        ctx.lineTo(q.x, y2);
        ctx.stroke();
        drawLinks(c);
      });
    }
    drawLinks(tree);

    // 3) 节点
    allNodes.forEach(function (n) {
      var p = pos(n);
      var c = ORG_COLORS[Math.min(n._depth, ORG_COLORS.length - 1)];
      var x = p.x - n._w / 2;
      roundRect(ctx, x, p.y, n._w, BOX_H, 8, c.fill, c.stroke, 1.4);
      var label = fitText(ctx, n.text, n._w - 20, (n._depth === 0 ? '700 ' : '600 ') + FONT_SZ + 'px ' + FONT);
      ctx.fillStyle = c.text;
      ctx.font = (n._depth === 0 ? '700 ' : '600 ') + FONT_SZ + 'px ' + FONT;
      ctx.fillText(label, p.x, p.y + BOX_H / 2 + 1);
    });

    // 4) 标题
    if (opts.title) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8E2A20';
      ctx.font = '700 20px ' + FONT;
      ctx.fillText(opts.title, PAD, 22);
    }
    return cv;
  }

  /* ==================== 思维导图 ==================== */
  var MIND_COLORS = ['#C0392B', '#D35400', '#C79A2B', '#2E7D5B', '#2C6E9B', '#7B4B94'];

  function renderMind(tree, opts) {
    opts = opts || {};
    var scale = 2, PAD = 48, VGAP = 18, HGAP = 56, BOX_H = 40, FONT_SZ = 15;

    function countLeaves(n) {
      if (!n.children.length) return 1;
      return n.children.reduce(function (s, c) { return s + countLeaves(c); }, 0);
    }
    var probe = document.createElement('canvas').getContext('2d');
    var leaves = countLeaves(tree);
    var H = Math.max(420, leaves * (BOX_H + VGAP) + PAD * 2);

    // 先算宽度（每层最深节点宽）
    var levelW = {};
    function depthWidth(n, d) {
      var w = measure(probe, n.text, '600 ' + FONT_SZ + 'px ' + FONT) + 34;
      w = Math.max(104, Math.min(240, w));
      n._w = w; n._d = d;
      levelW[d] = Math.max(levelW[d] || 0, w);
      n.children.forEach(function (c) { depthWidth(c, d + 1); });
    }
    depthWidth(tree, 0);

    var levelX = {};
    var x = PAD;
    var maxD = 0;
    for (var d in levelW) maxD = Math.max(maxD, Number(d));
    for (var i = 0; i <= maxD; i++) {
      levelX[i] = x + (levelW[i] || 120) / 2;
      x += (levelW[i] || 120) + HGAP;
    }
    var W = Math.max(680, x + PAD - HGAP);

    var cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    var ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

    // 垂直布局
    var cursor = PAD;
    function place(n) {
      if (!n.children.length) {
        n._cy = cursor + BOX_H / 2;
        cursor += BOX_H + VGAP;
      } else {
        n.children.forEach(place);
        n._cy = (n.children[0]._cy + n.children[n.children.length - 1]._cy) / 2;
      }
      n._cx = levelX[n._d];
    }
    place(tree);

    // 连线：三次贝塞尔
    function link(parent, child, color) {
      var x1 = parent._cx + parent._w / 2, y1 = parent._cy;
      var x2 = child._cx - child._w / 2, y2 = child._cy;
      var mx = (x1 + x2) / 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
      ctx.strokeStyle = color;
      ctx.lineWidth = parent._d === 0 ? 2.6 : 1.8;
      ctx.stroke();
    }

    function draw(n, color) {
      n.children.forEach(function (c, i) {
        var cc = n._d === 0 ? MIND_COLORS[i % MIND_COLORS.length] : color;
        link(n, c, cc);
        draw(c, cc);
      });
    }
    draw(tree, MIND_COLORS[0]);

    function drawNode(n, color, root) {
      var x = n._cx - n._w / 2, y = n._cy - BOX_H / 2;
      if (root) {
        roundRect(ctx, x, y, n._w, BOX_H, 10, color, color, 1);
        ctx.fillStyle = '#fff';
      } else {
        roundRect(ctx, x, y, n._w, BOX_H, 8, '#FFFFFF', color, 1.6);
        ctx.fillStyle = '#333';
      }
      ctx.textAlign = 'center';
      ctx.font = (root ? '700 ' : '600 ') + FONT_SZ + 'px ' + FONT;
      ctx.fillText(fitText(ctx, n.text, n._w - 18, (root ? '700 ' : '600 ') + FONT_SZ + 'px ' + FONT),
        n._cx, n._cy + 1);
    }
    // 先画子节点再画父节点，保证父节点在上层
    (function order(n, color, i) {
      n.children.forEach(function (c, ci) {
        var cc = n._d === 0 ? MIND_COLORS[ci % MIND_COLORS.length] : color;
        order(c, cc, ci);
      });
      drawNode(n, n._d === 0 ? MIND_COLORS[0] : color, n._d === 0);
    })(tree, MIND_COLORS[0], 0);

    if (opts.title) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8E2A20';
      ctx.font = '700 20px ' + FONT;
      ctx.fillText(opts.title, PAD, 26);
    }
    return cv;
  }

  /* ==================== 千字模板（稿纸） ==================== */
  function renderGrid(text, opts) {
    opts = opts || {};
    var cols = Math.max(6, Math.min(30, opts.cols || 20));
    var dpi = 150;
    var PW = Math.round(8.27 * dpi), PH = Math.round(11.69 * dpi);
    var margin = 90;
    var cell = Math.floor((PW - margin * 2) / cols);
    var rows = Math.floor((PH - margin * 2 - 60) / cell);
    var perPage = cols * rows;
    var chars = String(text).replace(/\r\n/g, '\n').split('');
    var pages = Math.max(1, Math.ceil(chars.length / perPage));
    var canvases = [];

    for (var p = 0; p < pages; p++) {
      var cv = document.createElement('canvas');
      cv.width = PW; cv.height = PH;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#FFFDF8';
      ctx.fillRect(0, 0, PW, PH);

      // 标题行
      ctx.fillStyle = '#3A3A3A';
      ctx.font = '600 22px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText(opts.title || '', PW / 2, margin - 34);
      ctx.textAlign = 'left';

      // 格子
      ctx.strokeStyle = opts.style === 'line' ? '#C9C2B4' : '#D9B8AE';
      ctx.lineWidth = 1;
      for (var r = 0; r < rows; r++) {
        if (opts.style === 'line') {
          ctx.beginPath();
          ctx.moveTo(margin, margin + (r + 1) * cell);
          ctx.lineTo(margin + cols * cell, margin + (r + 1) * cell);
          ctx.stroke();
        } else {
          for (var c = 0; c < cols; c++) {
            var x = margin + c * cell, y = margin + r * cell;
            ctx.strokeRect(x, y, cell, cell);
            // 田字格虚线十字
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#E8D3CC';
            ctx.beginPath();
            ctx.moveTo(x + cell / 2, y); ctx.lineTo(x + cell / 2, y + cell);
            ctx.moveTo(x, y + cell / 2); ctx.lineTo(x + cell, y + cell / 2);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 文字
      ctx.fillStyle = '#1F2A37';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (var k = 0; k < perPage; k++) {
        var ch = chars[p * perPage + k];
        if (ch === undefined) break;
        if (ch === '\n' || ch === ' ') continue;
        var rr = Math.floor(k / cols), cc = k % cols;
        var cx = margin + cc * cell + cell / 2;
        var cy = margin + rr * cell + cell / 2;
        var fs = Math.floor(cell * 0.66);
        ctx.font = fs + 'px ' + (opts.font || HAND_FONT);
        ctx.fillText(ch, cx, cy + 2);
      }
      // 页码
      ctx.fillStyle = '#9A9A9A';
      ctx.font = '400 14px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText((p + 1) + ' / ' + pages, PW / 2, PH - 40);
      canvases.push(cv);
    }
    return canvases;
  }

  /* ==================== 插入到 WPS 文档 ==================== */
  function insertImage(path, maxWidthPt) {
    var h = host();
    if (!h || h.type !== 'wps' || !h.app) return false;
    var doc = h.app.ActiveDocument;
    var maxW = maxWidthPt || 460;   // A4 正文宽度约 460pt
    function fit(shape) {
      try {
        if (!shape) return;
        var w = shape.Width;
        if (w > maxW) {
          try { shape.LockAspectRatio = -1; } catch (e) { }
          shape.Width = maxW;
        }
      } catch (e) { }
    }
    var tries = [
      function () { return fit(doc.InlineShapes.AddPicture(path, false, true)); },
      function () { return fit(doc.Shapes.AddPicture(path, false, true)); },
      function () { return fit(h.app.Selection.InlineShapes.AddPicture(path, false, true)); },
      function () { return fit(doc.Content.InlineShapes.AddPicture(path, false, true)); }
    ];
    for (var i = 0; i < tries.length; i++) {
      try { if (tries[i]() !== false) return true; } catch (e) { }
    }
    return false;
  }

  function saveCanvas(cv, name) {
    return TK.canvasToBlob(cv, 'image/png').then(function (blob) {
      return TK.save(blob, name);
    });
  }

  function insertNote(paths, inserted) {
    TK.resultBox(paths, inserted ? '已插入当前文档（也可用下面的 PNG 文件）' : '已生成 PNG 图片');
  }

  /* ==================== 工具 1：组织架构图 ==================== */
  function outline() {
    var pre = '';
    try {
      var h = host();
      if (h && h.type === 'wps') pre = String(h.app.Selection.Text || '');
    } catch (e) { }

    TK.modal({
      title: '🏢 组织架构图',
      hint: '每行一个部门/岗位，用缩进（空格/制表符）表示层级；也可以用「总经理 > 技术部 > 前端组」这种路径写法，或从表格复制「上级\\t下级」两列。',
      runLabel: '生成架构图',
      body:
        '<label class="tk-row tk-col"><span>层级内容</span><textarea id="ol-text" rows="8" placeholder="总经理&#10;  技术部&#10;    前端组&#10;    后端组&#10;  市场部&#10;    华东区"></textarea></label>' +
        '<label class="tk-row"><span>图标题</span><input id="ol-title" type="text" placeholder="（可选）公司组织架构"></label>' +
        '<label class="tk-row tk-inline"><input id="ol-insert" type="checkbox" checked><span>生成后插入当前 WPS 文档</span></label>',
      onMount: function () {
        if (pre) document.getElementById('ol-text').value = pre;
      },
      onRun: function () {
        var text = TK.val('#ol-text');
        var tree = parseTree(text);
        var cv = renderOrg(tree, { title: TK.val('#ol-title') });
        var name = '组织架构图_' + (TK.val('#ol-title') || 'org').replace(/[\\/:*?"<>|]/g, '') + '.png';
        return saveCanvas(cv, name).then(function (p) {
          var inserted = false;
          if (TK.checked('#ol-insert')) inserted = insertImage(p);
          status('组织架构图已生成');
          insertNote([p], inserted);
        });
      }
    });
  }

  /* ==================== 工具 2：思维导图 ==================== */
  function mindmap() {
    var pre = '';
    try {
      var h = host();
      if (h && h.type === 'wps') pre = String(h.app.Selection.Text || '');
    } catch (e) { }

    TK.modal({
      title: '🧠 思维导图',
      hint: '与组织架构图用同一套层级文本，但画成向右侧发散的思维导图，适合梳理文章结构、会议要点。',
      runLabel: '生成思维导图',
      body:
        '<label class="tk-row tk-col"><span>层级内容</span><textarea id="mm-text" rows="8" placeholder="产品规划&#10;  用户调研&#10;    访谈 20 位客户&#10;    竞品分析&#10;  功能设计&#10;    核心流程&#10;    异常处理"></textarea></label>' +
        '<label class="tk-row"><span>图标题</span><input id="mm-title" type="text" placeholder="（可选）"></label>' +
        '<label class="tk-row tk-inline"><input id="mm-insert" type="checkbox" checked><span>生成后插入当前 WPS 文档</span></label>',
      onMount: function () {
        if (pre) document.getElementById('mm-text').value = pre;
      },
      onRun: function () {
        var tree = parseTree(TK.val('#mm-text'));
        var cv = renderMind(tree, { title: TK.val('#mm-title') });
        var name = '思维导图.png';
        return saveCanvas(cv, name).then(function (p) {
          var inserted = false;
          if (TK.checked('#mm-insert')) inserted = insertImage(p);
          status('思维导图已生成');
          insertNote([p], inserted);
        });
      }
    });
  }

  /* ==================== 工具 3：千字模板 ==================== */
  function thousand() {
    TK.modal({
      title: '📃 千字模板',
      hint: '把文字排进田字格 / 横线稿纸，输出 A4 高清图片（手写体风格）。适合练字帖、抄写作业、通知誊写。',
      runLabel: '生成稿纸',
      body:
        '<label class="tk-row tk-col"><span>文字内容</span><textarea id="kt-text" rows="7" placeholder="在这里粘贴要誊写的文字，会自动分页…"></textarea></label>' +
        '<label class="tk-row"><span>格子样式</span><select id="kt-style">' +
        '<option value="grid">田字格（练字）</option><option value="line">横线稿纸</option></select></label>' +
        '<label class="tk-row"><span>每行格数</span><input id="kt-cols" type="number" value="20" min="8" max="30"></label>' +
        '<label class="tk-row"><span>字体</span><select id="kt-font">' +
        '<option value="KaiTi, 楷体, STKaiti, serif">楷体（推荐）</option>' +
        '<option value="STXingkai, 华文行楷, KaiTi, serif">行楷</option>' +
        '<option value="FangSong, 仿宋, serif">仿宋</option></select></label>' +
        '<label class="tk-row"><span>页眉标题</span><input id="kt-title" type="text" placeholder="（可选）"></label>' +
        '<label class="tk-row tk-inline"><input id="kt-insert" type="checkbox"><span>生成后插入当前 WPS 文档</span></label>',
      onRun: function () {
        var text = TK.val('#kt-text');
        if (!text.trim()) throw new Error('请先填写要誊写的文字');
        var canvases = renderGrid(text, {
          cols: TK.num('#kt-cols', 20),
          style: TK.val('#kt-style'),
          font: TK.val('#kt-font'),
          title: TK.val('#kt-title')
        });
        var paths = [];
        var seq = Promise.resolve();
        canvases.forEach(function (cv, i) {
          seq = seq.then(function () {
            TK.msg('正在导出第 ' + (i + 1) + ' / ' + canvases.length + ' 页');
            return saveCanvas(cv, '千字模板_' + (i + 1) + '.png').then(function (p) { paths.push(p); });
          });
        });
        return seq.then(function () {
          var inserted = false;
          if (TK.checked('#kt-insert')) {
            paths.forEach(function (p) { if (insertImage(p)) inserted = true; });
          }
          status('千字模板已生成 ' + paths.length + ' 页');
          insertNote(paths, inserted);
        });
      }
    });
  }

  window.WTA_DOC = {
    'doc-outline': outline,
    'doc-mindmap': mindmap,
    'doc-thousand': thousand
  };

  // 自测
  window.WTA_DOC_INTERNAL = { parseTree: parseTree, renderOrg: renderOrg, renderMind: renderMind, renderGrid: renderGrid };
})();
