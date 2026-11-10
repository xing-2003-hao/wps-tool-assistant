/* ============================================================
 * WPS 工具助手 · 文档操作引擎（docops）
 * 作用：把「改成红色字体」这类自然语言排版指令，直接翻译成
 *       WPS JSAPI 调用，在本地改文档 —— 不经过大模型，
 *       所以不会出现「我无法修改你的文档」这种回答。
 *
 * 支持：字体颜色 / 高亮底色 / 字号 / 字体 / 加粗 / 斜体 /
 *       下划线 / 删除线 / 对齐 / 行距 / 段前段后 / 首行缩进 / 清除格式
 * 作用域：选中文字 → 选区；没选中 → 当前段落；
 *       说「全文 / 整篇」→ 整个文档；带引号的目标 → 全文查找后改
 * ============================================================ */
(function () {
  'use strict';

  // 颜色：Word/WPS 的 Font.Color 是 BGR 整数（红色 = 255），这里存 RGB 再转
  var COLORS = {
    '红': { rgb: 0xFF0000, name: '红色' },
    '大红': { rgb: 0xFF0000, name: '红色' },
    '深红': { rgb: 0xC00000, name: '深红色' },
    '绿': { rgb: 0x00B050, name: '绿色' },
    '蓝': { rgb: 0x0070C0, name: '蓝色' },
    '深蓝': { rgb: 0x002060, name: '深蓝色' },
    '黄': { rgb: 0xFFFF00, name: '黄色' },
    '橙': { rgb: 0xED7D31, name: '橙色' },
    '紫': { rgb: 0x7030A0, name: '紫色' },
    '黑': { rgb: 0x000000, name: '黑色' },
    '白': { rgb: 0xFFFFFF, name: '白色' },
    '灰': { rgb: 0x808080, name: '灰色' },
    '粉': { rgb: 0xFF99CC, name: '粉色' },
    '金': { rgb: 0xBF9000, name: '金色' },
    '青': { rgb: 0x00B0F0, name: '青色' }
  };
  // 「黑体」是字体名，不能当颜色词
  var COLOR_PAT = '(?:深红|大红|深蓝|红|绿|蓝|黄|橙|紫|黑(?!体)|白|灰|粉|金|青)';

  // 中文字号 → 磅值
  var SIZES = {
    '初号': 42, '小初': 36, '一号': 26, '小一': 24, '二号': 22, '小二': 18,
    '三号': 16, '小三': 15, '四号': 14, '小四': 12, '五号': 10.5, '小五': 9,
    '六号': 7.5, '小六': 6.5, '七号': 5.5, '八号': 5
  };

  // 高亮色 → wdColorIndex
  var HL = {
    '黄': 7, '黄绿': 4, '亮绿': 4, '绿': 11, '青': 10, '蓝': 2, '深蓝': 9,
    '红': 6, '深红': 13, '粉': 5, '紫': 12, '灰': 15, '深灰': 16, '黑': 1, '白': 8
  };

  var FONTS = ['微软雅黑', '雅黑', '宋体', '仿宋_GB2312', '仿宋', '黑体', '楷体_GB2312',
    '楷体', '等线', '华文中宋', '华文楷体', '华文细黑', '思源黑体', '方正小标宋'];

  function rgbToBgr(rgb) {
    var r = (rgb >> 16) & 0xFF, g = (rgb >> 8) & 0xFF, b = rgb & 0xFF;
    return b * 65536 + g * 256 + r;
  }
  function hexToBgr(hex) { return rgbToBgr(parseInt(hex.replace('#', ''), 16)); }

  /* ---------- 删除类指令识别 ----------
   * 「删除这段话 / 删掉这段 / 删除选中 / 去掉这一句 / 删除空行 / 把「合同」删掉」
   * 这类要求本质是改文档，不是让模型产出文字，所以必须本地执行。
   * 注意：带「格式/高亮/加粗…」的是排版调整，不能当删除。
   */
  function detectDelete(t, hasFind) {
    if (!/(删除|删掉|删去|移除|去掉)/.test(t)) return null;
    // 删空行 / 删空段落：优先识别，否则会落到「没有目标对象」的分支
    if (/(删除|删掉|去掉|清除|移除)[^，。]{0,6}空(行|段)/.test(t)) {
      return { op: { type: 'delete', sub: 'blank', name: '删除空行' }, scope: 'auto' };
    }
    // 排版类目标交给排版逻辑处理（「去掉高亮」「删除所有加粗」）
    if (/(格式|高亮|底纹|底色|背景色|颜色|加粗|斜体|下划线|删除线|缩进|编号|样式|页眉|页脚|批注|水印|空格)/.test(t)) {
      return null;
    }
    var isDoc = /全(文|部)|整篇|整份|整个文档/.test(t);
    var hitTarget = /(这段|这段话|这一段|此段|本段|当前段|这句|这一句|这行|该段|这里|段落|整段|内容|文字|文本|选中|它|空白|多余)/.test(t);
    if (!hitTarget && !isDoc && !hasFind) return null;
    var scope = isDoc ? 'document' : 'auto';
    return {
      op: { type: 'delete', sub: 'auto', name: isDoc ? '删除全文' : '删除' },
      scope: scope
    };
  }

  /* ---------- 指令解析 ---------- */
  function parse(text) {
    var t = String(text || '').trim();
    if (!t) return { ops: [], scope: 'auto', find: '' };
    var ops = [];
    var scope = 'auto';
    var find = '';

    if (/全文|整篇|整份|所有文字|全部文字|整个文档/.test(t)) scope = 'document';
    if (/本段|当前段|这一段|此段/.test(t)) scope = 'paragraph';

    // 引号里的目标文字（先切片，避免「红色」被当成目标）
    var q = t.match(/[“"「『【]([^”"」』】]{1,40})[”"」』】]/);
    if (q) { find = q[1]; t = t.replace(q[0], ''); }

    // ---- 删除类指令：本地直接删，绝不交给模型（模型会回「请把内容发给我」）----
    var del = detectDelete(t, !!find);
    if (del) return { ops: [del.op], scope: del.scope, find: find };

    // ---- 清除格式 ----
    if (/清除格式|取消所有格式|恢复默认格式|去除格式/.test(t)) ops.push({ type: 'clear', name: '清除格式' });

    // ---- 高亮 / 底色 ----（先处理，避免「用蓝色高亮」被当成字体颜色）
    var HL_WORDS = Object.keys(HL).sort(function (a, b) { return b.length - a.length; }).join('|');
    if (/(取消|去掉|清除)[^，。]{0,4}(高亮|底纹|底色|背景色)/.test(t)) {
      ops.push({ type: 'highlight', value: 0, name: '取消高亮' });
      t = t.replace(/(取消|去掉|清除)[^，。]{0,4}(高亮|底纹|底色|背景色)/, '');
    } else {
      // 颜色可能在「高亮」前面（蓝色高亮），也可能在后面（高亮成蓝色）
      var hlm = t.match(new RegExp('(' + COLOR_PAT + ')?色?\\s*(高亮|荧光|底纹|底色|背景色)\\s*(?:标成|标|设为|设成|成|为)?\\s*(' + COLOR_PAT + ')?'));
      if (hlm) {
        var hlColor = (hlm[1] || hlm[3] || '').replace(/色$/, '');
        ops.push({ type: 'highlight', value: HL[hlColor] || 7, name: '高亮 ' + (hlColor || '黄') + '色' });
        t = t.replace(hlm[0], '');
      }
    }

    // ---- 字体颜色 ----
    var negColor = /(取消|去掉|清除|不要)[^，。]{0,4}颜色/.test(t);
    var cm = t.match(new RegExp('(?:(?:改成|改为|换成|变成|设为|设置为|调成|涂成|标成|染成|用)\\s*)(' + COLOR_PAT + ')色?(?:字体|字|文字|正文|标题)?|(' + COLOR_PAT + ')色(?:的)?(?:字体|字|文字|正文|标题)|(?:字体)?颜色[^，。]{0,6}?(' + COLOR_PAT + ')|(?:标|涂|染)(' + COLOR_PAT + ')'));
    if (!negColor && cm) {
      var cw = cm[1] || cm[2] || cm[3] || cm[4];
      if (COLORS[cw]) ops.push({ type: 'color', bgr: rgbToBgr(COLORS[cw].rgb), name: '字体颜色 ' + COLORS[cw].name });
    } else if (!negColor) {
      var hexOnly = t.match(/#([0-9a-fA-F]{6})/);
      if (hexOnly && /颜色|字体|字色|着色/.test(t)) ops.push({ type: 'color', bgr: hexToBgr(hexOnly[0]), name: '字体颜色 #' + hexOnly[1].toUpperCase() });
    }

    // ---- 字号 ----
    var sz = t.match(new RegExp('(' + Object.keys(SIZES).join('|') + ')(?:字|号字)?'));
    if (sz) ops.push({ type: 'size', value: SIZES[sz[1]], name: '字号 ' + sz[1] + '（' + SIZES[sz[1]] + ' 磅）' });
    else {
      var sz2 = t.match(/(?:字号|字体大小|字的大小|大小)[^0-9]{0,4}(\d+(?:\.\d+)?)/);
      if (!sz2) {
        var m2 = t.match(/(\d+(?:\.\d+)?)\s*(?:磅|pt|号字)/i);
        // 「段前 6 磅」「行距 18 磅」里的数字不是字号
        if (m2 && !/(段前|段后|行距|间距)[^0-9]{0,3}$/.test(t.slice(0, m2.index))) sz2 = m2;
      }
      if (sz2) ops.push({ type: 'size', value: parseFloat(sz2[1]), name: '字号 ' + sz2[1] + ' 磅' });
    }

    // ---- 字体 ----
    for (var i = 0; i < FONTS.length; i++) {
      if (t.indexOf(FONTS[i]) >= 0) {
        var fname = FONTS[i] === '雅黑' ? '微软雅黑' : FONTS[i];
        ops.push({ type: 'font', value: fname, name: '字体 ' + fname });
        break;
      }
    }

    // ---- 加粗 / 斜体 / 下划线 / 删除线 ----
    if (/(取消|去掉|不用|不要)[^，。]{0,3}(加粗|粗体)/.test(t)) ops.push({ type: 'bold', value: false, name: '取消加粗' });
    else if (/(加粗|粗体|变粗|加黑|加黑加粗|bold)/i.test(t)) ops.push({ type: 'bold', value: true, name: '加粗' });

    if (/(取消|去掉)[^，。]{0,3}(斜体|倾斜)/.test(t)) ops.push({ type: 'italic', value: false, name: '取消斜体' });
    else if (/(斜体|倾斜)/.test(t)) ops.push({ type: 'italic', value: true, name: '斜体' });

    if (/(取消|去掉)[^，。]{0,3}下划线/.test(t)) ops.push({ type: 'underline', value: 0, name: '取消下划线' });
    else if (/下划线/.test(t)) ops.push({ type: 'underline', value: 1, name: '下划线' });

    if (/(取消|去掉)[^，。]{0,3}删除线/.test(t)) ops.push({ type: 'strike', value: false, name: '取消删除线' });
    else if (/删除线/.test(t)) ops.push({ type: 'strike', value: true, name: '删除线' });

    // ---- 对齐 ----
    if (/居中/.test(t)) ops.push({ type: 'align', value: 1, name: '居中' });
    else if (/右对齐|靠右/.test(t)) ops.push({ type: 'align', value: 2, name: '右对齐' });
    else if (/左对齐|靠左/.test(t)) ops.push({ type: 'align', value: 0, name: '左对齐' });
    else if (/两端对齐|分散对齐/.test(t)) ops.push({ type: 'align', value: 3, name: '两端对齐' });

    // ---- 行距 ----
    if (/(1\.5|１\.５|一点五)\s*倍?行距/.test(t)) ops.push({ type: 'linespace', rule: 1, name: '1.5 倍行距' });
    else if (/(双倍|两倍|2\s*倍|2\.0\s*倍)\s*行距/.test(t)) ops.push({ type: 'linespace', rule: 2, name: '2 倍行距' });
    else if (/单倍行距/.test(t)) ops.push({ type: 'linespace', rule: 0, name: '单倍行距' });
    else {
      var ls = t.match(/行距[^0-9]{0,4}(\d+(?:\.\d+)?)\s*(磅|pt)?/i) || t.match(/固定值\s*(\d+(?:\.\d+)?)\s*磅/);
      if (ls) ops.push({ type: 'linespace', rule: 4, value: parseFloat(ls[1]), name: '固定行距 ' + ls[1] + ' 磅' });
    }

    // ---- 段前段后 / 首行缩进 ----
    var sb = t.match(/段前[^0-9]{0,4}(\d+(?:\.\d+)?)\s*(磅|行)?/);
    if (sb) ops.push({ type: 'spaceBefore', value: parseFloat(sb[1]) * (sb[2] === '行' ? 12 : 1), name: '段前 ' + sb[1] + ' 磅' });
    var sa = t.match(/段后[^0-9]{0,4}(\d+(?:\.\d+)?)\s*(磅|行)?/);
    if (sa) ops.push({ type: 'spaceAfter', value: parseFloat(sa[1]) * (sa[2] === '行' ? 12 : 1), name: '段后 ' + sa[1] + ' 磅' });
    var fi = t.match(/首行缩进[^0-9]{0,4}(\d+)?\s*字符/);
    if (fi) ops.push({ type: 'firstIndent', value: parseInt(fi[1] || '2', 10), name: '首行缩进 ' + (fi[1] || 2) + ' 字符' });

    return { ops: ops, scope: scope, find: find };
  }

  // 是不是「在说排版」——用于把指令从模型手里抢回来
  function looksLikeFormat(text) {
    var t = String(text || '').trim();
    if (!t || t.length > 60) return false;
    // 内容生成类请求不抢（除非同时明确提到字体/字号/颜色等版式词）
    if (/(写|生成|创作|翻译|总结|润色|续写|扩写|缩写)/.test(t) && !/字体|字号|颜色|加粗|斜体|下划线|行距|对齐|高亮/.test(t)) return false;
    return parse(t).ops.length > 0;
  }

  function host() { return window.WTA_HOST ? window.WTA_HOST() : null; }

  /* ---------- 应用到 Range ---------- */
  function applyOps(rng, ops) {
    var done = [], fail = [];
    ops.forEach(function (op) {
      try {
        switch (op.type) {
          case 'clear':
            rng.ClearFormatting(); done.push(op.name); break;
          case 'color':
            rng.Font.Color = op.bgr; done.push(op.name); break;
          case 'highlight':
            rng.Font.HighlightColorIndex = op.value; done.push(op.name); break;
          case 'size':
            rng.Font.Size = op.value; done.push(op.name); break;
          case 'font':
            rng.Font.Name = op.value;
            try { rng.Font.NameFarEast = op.value; } catch (e) {}
            try { rng.Font.NameAscii = op.value; } catch (e) {}
            done.push(op.name); break;
          case 'bold':
            rng.Font.Bold = !!op.value; done.push(op.name); break;
          case 'italic':
            rng.Font.Italic = !!op.value; done.push(op.name); break;
          case 'underline':
            rng.Font.Underline = op.value; done.push(op.name); break;
          case 'strike':
            rng.Font.StrikeThrough = !!op.value; done.push(op.name); break;
          case 'align':
            rng.ParagraphFormat.Alignment = op.value; done.push(op.name); break;
          case 'linespace':
            if (op.rule === 4) {
              rng.ParagraphFormat.LineSpacingRule = 4;
              rng.ParagraphFormat.LineSpacing = op.value;
            } else {
              rng.ParagraphFormat.LineSpacingRule = op.rule;
            }
            done.push(op.name); break;
          case 'spaceBefore':
            rng.ParagraphFormat.SpaceBefore = op.value; done.push(op.name); break;
          case 'spaceAfter':
            rng.ParagraphFormat.SpaceAfter = op.value; done.push(op.name); break;
          case 'firstIndent':
            try { rng.ParagraphFormat.CharacterUnitFirstLineIndent = op.value; }
            catch (e) { rng.ParagraphFormat.FirstLineIndent = op.value * rng.Font.Size; }
            done.push(op.name); break;
          default: break;
        }
      } catch (e) { fail.push(op.name); }
    });
    return { done: done, fail: fail };
  }

  /* ---------- 查找目标文字并格式化 ---------- */
  function applyByFind(doc, find, ops) {
    var count = 0;
    try {
      var rng = doc.Content;
      var f = rng.Find;
      f.ClearFormatting();
      f.Text = find;
      f.Forward = true;
      f.Wrap = 1;               // wdFindContinue
      f.MatchCase = false;
      while (f.Execute()) {
        applyOps(rng, ops);
        count++;
        if (count > 500) break; // 保险
      }
    } catch (e) {
      return { count: 0, error: e && e.message };
    }
    return { count: count };
  }

  /* ---------- 删除空的段落（从后往前删，避免索引错位） ---------- */
  function deleteBlankParagraphs(doc) {
    var n = 0;
    try {
      var cnt = doc.Paragraphs.Count;
      for (var i = cnt; i >= 1; i--) {
        var p = doc.Paragraphs.Item(i);
        var txt = '';
        try { txt = String(p.Range.Text || ''); } catch (e) { txt = ''; }
        if (txt.replace(/[\s\r\n\u0007]/g, '') === '') { p.Range.Delete(); n++; }
      }
    } catch (e) { }
    return n;
  }

  /* ---------- 执行删除 ---------- */
  function runDelete(app, doc, p, op) {
    var sel = app.Selection;
    var selText = '';
    try { selText = String(sel.Text || '').replace(/[\s\r\n\u0007]/g, ''); } catch (e) { }
    try {
      // 删除空行
      if (op.sub === 'blank') {
        var n = deleteBlankParagraphs(doc);
        if (!n) return { ok: false, reason: 'notfound', parsed: p, message: '文档里没有空段落' };
        return { ok: true, kind: 'delete', scope: '全文', names: '删除空段落 ' + n + ' 处', failed: [] };
      }

      // 指定了要找的文字：全文删掉所有命中
      if (p.find) {
        var hit = 0;
        var rng = doc.Content, f = rng.Find;
        f.ClearFormatting();
        f.Text = p.find;
        f.Forward = true;
        f.Wrap = 1;
        f.MatchCase = false;
        while (f.Execute()) {
          rng.Delete();
          hit++;
          if (hit > 200) break;
        }
        if (!hit) return { ok: false, reason: 'notfound', parsed: p, message: '文档里没有找到「' + p.find + '」' };
        return { ok: true, kind: 'delete', scope: '查找「' + p.find + '」共 ' + hit + ' 处', names: '删除「' + p.find + '」', failed: [] };
      }

      // 全文
      if (p.scope === 'document') {
        doc.Content.Delete();
        return { ok: true, kind: 'delete', scope: '全文', names: '删除全文内容', failed: [] };
      }

      // 有选中：只删选中的文字（不动段落标记）
      if (selText) {
        // 选中的正好是整段文字时，连段落标记一起删，避免留一行空行
        var paraTxt = '';
        try { paraTxt = String(sel.Paragraphs.Item(1).Range.Text || '').replace(/[\s\r\n\u0007]/g, ''); } catch (e) { paraTxt = ''; }
        if (paraTxt && paraTxt === selText) {
          sel.Paragraphs.Item(1).Range.Delete();
          return {
            ok: true, kind: 'delete', scope: '选中内容（整段）',
            names: '删除该段落（含段落标记，不留空行）', failed: []
          };
        }
        sel.Delete();
        return {
          ok: true, kind: 'delete', scope: '选中内容',
          names: '删除选中内容（' + selText.length + ' 字）', failed: []
        };
      }

      // 没选中：删掉光标所在的一整段（连段落标记一起，不留空行）
      var para = sel.Paragraphs.Item(1);
      var ptxt = '';
      try { ptxt = String(para.Range.Text || '').replace(/[\s\r\n\u0007]/g, ''); } catch (e) { ptxt = ''; }
      para.Range.Delete();
      return {
        ok: true, kind: 'delete', scope: '当前段落',
        names: '删除该段落' + (ptxt ? '（' + ptxt.slice(0, 14) + (ptxt.length > 14 ? '…' : '') + '）' : ''),
        failed: []
      };
    } catch (e) {
      return { ok: false, reason: 'apply', parsed: p, message: '删除失败：' + (e && e.message) };
    }
  }

  /* ---------- 执行 ---------- */
  function run(instruction) {
    var h = host();
    var p = parse(instruction);
    if (!p.ops.length) return { ok: false, reason: 'noparse', parsed: p };
    if (!h || h.type !== 'wps') {
      return { ok: false, reason: 'host', parsed: p, message: '排版指令只在 WPS 文字里生效（当前宿主：' + ((h && h.type) || '未知') + '）' };
    }
    var app = h.app, doc = app.ActiveDocument;
    if (!doc) return { ok: false, reason: 'host', parsed: p, message: '没有打开的文档' };

    var names = p.ops.map(function (o) { return o.name; }).join('、');

    // 删除类：直接删内容（选区 / 本段 / 查找命中 / 全文），不走格式逻辑
    var delOp = null;
    p.ops.forEach(function (o) { if (o.type === 'delete') delOp = o; });
    if (delOp) return runDelete(app, doc, p, delOp);

    // 快照当前选区：改格式（尤其是 doc.Content / 段落 Range）时 WPS 会把选区
    // 挪到被改的范围上，用户会看到「我没选字，文档里却自己选了一大片」。
    // 所以执行完必须还原，否则下次取正文会误捡这段残留选区。
    var snap = null;
    try { snap = { s: app.Selection.Start, e: app.Selection.End }; } catch (e) { snap = null; }
    function restoreSelection() {
      if (!snap) return;
      try { doc.Range(snap.s, snap.e).Select(); } catch (e) { }
    }

    try {
      // 1) 指定了要改的文字
      if (p.find) {
        var r = applyByFind(doc, p.find, p.ops);
        if (r.error) return { ok: false, reason: 'find', parsed: p, message: '查找「' + p.find + '」失败：' + r.error };
        if (!r.count) return { ok: false, reason: 'notfound', parsed: p, message: '文档里没有找到「' + p.find + '」' };
        return { ok: true, scope: '查找「' + p.find + '」共 ' + r.count + ' 处', names: names, failed: [] };
      }

      // 2) 选区 / 段落 / 全文
      var sel = app.Selection;
      var selText = '';
      try { selText = String(sel.Text || '').replace(/[\s\r\n\u0007]/g, ''); } catch (e) { }
      var target, scopeLabel;

      if (p.scope === 'document') {
        target = doc.Content;
        scopeLabel = '全文';
      } else if (p.scope === 'paragraph' || !selText) {
        var para = sel.Paragraphs.Item(1);
        target = para.Range;
        scopeLabel = p.scope === 'paragraph' ? '当前段落' : '当前段落（未选中文字）';
      } else {
        target = sel;
        scopeLabel = '选中内容';
      }

      var res = applyOps(target, p.ops);
      if (!res.done.length) {
        return { ok: false, reason: 'apply', parsed: p, message: '应用失败：' + (res.fail.join('、') || '当前对象不支持该格式') };
      }
      return { ok: true, scope: scopeLabel, names: res.done.join('、'), failed: res.fail };
    } finally {
      restoreSelection();
    }
  }

  /* 指令语法提示（解析不出时给用户看，而不是让模型自由发挥） */
  var HELP = [
    '颜色：改成红色字体 / 设为蓝色 / #FF6600',
    '字号字体：小四号 / 字号 12 磅 / 字体改成微软雅黑',
    '样式：加粗 / 取消加粗 / 斜体 / 下划线 / 删除线',
    '段落：居中 / 1.5 倍行距 / 首行缩进 2 字符 / 段前 6 磅',
    '范围：选中文字 → 只改选区；没说范围 → 改当前段落；加「全文」→ 改整篇',
    '删除：删除选中 / 删除这段话 / 删掉本段（没选中就删光标所在段落）',
    '指定词：把「合同」改成红色（全文查找后统一改）'
  ].join('\n');

  window.WTA_DOC_OPS = {
    parse: parse,
    run: run,
    applyOps: applyOps,
    looksLikeFormat: looksLikeFormat,
    HELP: HELP,
    COLOR_OF: function (name) { return COLORS[name]; }
  };
})();
