/* ============================================================
 * WPS 工具助手 · PDF 文本抽取引擎（离线，纯 JS）
 *   - 内容流解码（复用 pdf-lib 的 decodePDFRawStream）
 *   - 内容流词法分析（字符串 / 十六进制串 / 数组 / 字典 / 操作符）
 *   - 字体：ToUnicode CMap（Type0 / Identity-H 中文）、Widths / W 字宽
 *   - 文本定位：Tm / Td / TD / T* / cm / q / Q，输出设备坐标
 *   - Form XObject 递归（很多 PDF 的正文放在 Form 里）
 *   - 顺带提供「文字水印剔除」（按内容流 BT…ET 块删除）
 * 对外：window.PDFTEXT
 * ============================================================ */
(function () {
  'use strict';

  function lib() {
    var L = window.PDFLib;
    if (!L) throw new Error('PDF 引擎未加载（vendor/pdf-lib.min.js 缺失）');
    return L;
  }

  /* ==================== 字节工具 ==================== */
  function isWS(c) { return c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32; }
  function isDelim(c) {
    return c === 0x28 || c === 0x29 || c === 0x3C || c === 0x3E || c === 0x5B ||
      c === 0x5D || c === 0x7B || c === 0x7D || c === 0x2F || c === 0x25;
  }
  function latin1(bytes, from, to) {
    var s = '';
    for (var i = from; i < to; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  var WIN_ANSI = (function () {
    var m = {};
    for (var i = 32; i < 127; i++) m[i] = String.fromCharCode(i);
    var hi = {
      128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡',
      136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž', 145: '‘',
      146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜',
      153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ', 160: ' ',
      173: '-', 176: '°', 177: '±', 178: '²', 179: '³', 180: '´', 181: 'µ',
      183: '·', 185: '¹', 186: 'º', 187: '»', 188: '¼', 189: '½', 190: '¾',
      215: '×', 247: '÷'
    };
    for (var k in hi) m[k] = hi[k];
    return m;
  })();

  /* ==================== 流解码 ==================== */
  function streamBytes(stream) {
    var L = lib();
    if (!stream) return null;
    try {
      if (L.PDFRawStream && stream instanceof L.PDFRawStream) {
        var d = L.decodePDFRawStream(stream);
        // decodePDFRawStream 返回 PDFDecodedStream；取其字节
        if (d && typeof d.getContents === 'function') return d.getContents();
        if (d && d.contents) return d.contents;
        if (d && d.decode) return d.decode();
      }
      if (typeof stream.getContents === 'function') return stream.getContents();
      if (stream.contents) return stream.contents;
    } catch (e) { /* 未知滤镜 */ }
    return null;
  }

  /* ==================== 内容流词法分析 ==================== */
  // 返回 token 列表：{ t:'num'|'str'|'name'|'arr'|'dict'|'op', v, s, e }
  //   s/e = 在源字节中的起止偏移（用于局部删除）
  function tokenize(bytes) {
    var toks = [];
    var i = 0, n = bytes.length;

    function skipWS() {
      while (i < n) {
        var c = bytes[i];
        if (isWS(c)) { i++; continue; }
        if (c === 0x25) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; continue; }
        break;
      }
    }
    function readName() {
      var st = i; i++; // '/'
      var out = '';
      while (i < n && !isWS(bytes[i]) && !isDelim(bytes[i])) {
        var c = bytes[i];
        if (c === 0x23 && i + 2 < n) { // #xx 转义
          out += String.fromCharCode(parseInt(latin1(bytes, i + 1, i + 3), 16));
          i += 3;
        } else { out += String.fromCharCode(c); i++; }
      }
      return { t: 'name', v: out, s: st, e: i };
    }
    function readLiteral() {
      var st = i; i++; // '('
      var depth = 1, out = [];
      while (i < n) {
        var c = bytes[i++];
        if (c === 0x5C) { // 反斜杠
          if (i >= n) break;
          var e = bytes[i++];
          if (e === 0x6E) out.push(10);
          else if (e === 0x72) out.push(13);
          else if (e === 0x74) out.push(9);
          else if (e === 0x62) out.push(8);
          else if (e === 0x66) out.push(12);
          else if (e === 0x28 || e === 0x29 || e === 0x5C) out.push(e);
          else if (e >= 0x30 && e <= 0x37) {
            var oct = e - 0x30;
            for (var k = 0; k < 2 && i < n; k++) {
              var d = bytes[i];
              if (d < 0x30 || d > 0x37) break;
              oct = oct * 8 + (d - 0x30); i++;
            }
            out.push(oct & 0xFF);
          } else if (e === 10) { /* 续行 */ }
          else if (e === 13) { if (bytes[i] === 10) i++; }
          else out.push(e);
        } else if (c === 0x28) { depth++; out.push(c); }
        else if (c === 0x29) { depth--; if (depth === 0) break; out.push(c); }
        else out.push(c);
      }
      return { t: 'str', v: new Uint8Array(out), s: st, e: i };
    }
    function readHex() {
      var st = i; i++; // '<'
      var buf = [], hi = -1;
      while (i < n && bytes[i] !== 0x3E) {
        var c = bytes[i++];
        var v = -1;
        if (c >= 0x30 && c <= 0x39) v = c - 0x30;
        else if (c >= 0x41 && c <= 0x46) v = c - 0x37;
        else if (c >= 0x61 && c <= 0x66) v = c - 0x57;
        if (v < 0) continue;
        if (hi < 0) hi = v; else { buf.push((hi << 4) | v); hi = -1; }
      }
      if (hi >= 0) buf.push(hi << 4);
      if (i < n) i++; // '>'
      return { t: 'str', v: new Uint8Array(buf), s: st, e: i };
    }
    function readNumber() {
      var st = i;
      while (i < n && !isWS(bytes[i]) && !isDelim(bytes[i])) i++;
      var txt = latin1(bytes, st, i);
      var num = parseFloat(txt);
      return { t: 'num', v: isNaN(num) ? 0 : num, s: st, e: i };
    }
    function readKeyword() {
      var st = i;
      while (i < n && !isWS(bytes[i]) && !isDelim(bytes[i])) i++;
      return { t: 'op', v: latin1(bytes, st, i), s: st, e: i };
    }

    while (true) {
      skipWS();
      if (i >= n) break;
      var c = bytes[i];
      if (c === 0x2F) { toks.push(readName()); continue; }
      if (c === 0x28) { toks.push(readLiteral()); continue; }
      if (c === 0x3C) {
        if (bytes[i + 1] === 0x3C) { var ds = i; i += 2; toks.push({ t: 'dict', v: null, s: ds, e: i }); continue; }
        toks.push(readHex()); continue;
      }
      if (c === 0x3E && bytes[i + 1] === 0x3E) { var de = i; i += 2; toks.push({ t: 'dictend', v: null, s: de, e: i }); continue; }
      if (c === 0x5B) { var as = i; i++; toks.push({ t: 'arr', v: null, s: as, e: i }); continue; }
      if (c === 0x5D) { var ae = i; i++; toks.push({ t: 'arrend', v: null, s: ae, e: i }); continue; }
      if (c === 0x7B || c === 0x7D) { i++; continue; }
      if (c === 0x2B || c === 0x2D || c === 0x2E || (c >= 0x30 && c <= 0x39)) { toks.push(readNumber()); continue; }
      var kw = readKeyword();
      if (!kw.v) { i++; continue; }
      // 内联图片：跳过二进制直到 EI
      if (kw.v === 'BI') {
        var p = i;
        while (p + 1 < n) {
          if (bytes[p] === 0x45 && bytes[p + 1] === 0x49 &&
            (p === 0 || isWS(bytes[p - 1])) && (p + 2 >= n || isWS(bytes[p + 2]))) { p += 2; break; }
          p++;
        }
        i = p;
        toks.push({ t: 'op', v: 'BI', s: kw.s, e: i });
        continue;
      }
      toks.push(kw);
    }
    return toks;
  }

  /* ==================== 字体 ==================== */
  function parseToUnicode(bytes) {
    var txt = latin1(bytes, 0, bytes.length);
    var map = {}, codeLen = 0;
    var re;

    // codespacerange：推断每码字节数
    re = /begincodespacerange([\s\S]*?)endcodespacerange/g;
    var m;
    while ((m = re.exec(txt))) {
      var hexes = m[1].match(/<([0-9A-Fa-f]+)>/g) || [];
      if (hexes.length) {
        var len = hexes[0].replace(/[<>]/g, '').length / 2;
        if (len >= 1 && len <= 4) codeLen = Math.max(codeLen, len);
      }
    }

    var hexToStr = function (h) {
      // UTF-16BE → JS 字符串
      var s = '';
      for (var i = 0; i + 3 < h.length + 1; i += 4) {
        var cu = parseInt(h.substr(i, 4), 16);
        if (isNaN(cu)) break;
        s += String.fromCharCode(cu);
      }
      return s;
    };

    re = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = re.exec(txt))) {
      var pr = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || [];
      pr.forEach(function (pair) {
        var g = pair.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
        if (!g) return;
        map[parseInt(g[1], 16)] = hexToStr(g[2]);
        if (!codeLen) codeLen = g[1].length / 2;
      });
    }

    re = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = re.exec(txt))) {
      var body = m[1];
      var r2 = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
      var g2;
      while ((g2 = r2.exec(body))) {
        var lo = parseInt(g2[1], 16), hi = parseInt(g2[2], 16);
        if (!codeLen) codeLen = g2[1].length / 2;
        if (hi - lo > 65535) continue;
        if (g2[4] !== undefined) {
          var base = g2[4], baseNum = parseInt(base, 16);
          var keepHigh = base.length > 4 ? base.slice(0, base.length - 4) : '';
          for (var c = lo; c <= hi; c++) {
            var tail = (baseNum + (c - lo)).toString(16).toUpperCase();
            while (tail.length < 4) tail = '0' + tail;
            map[c] = hexToStr(keepHigh + tail);
          }
        } else if (g2[5] !== undefined) {
          var items = g2[5].match(/<([0-9A-Fa-f]+)>/g) || [];
          for (var j = 0; j < items.length && lo + j <= hi; j++) {
            map[lo + j] = hexToStr(items[j].replace(/[<>]/g, ''));
          }
        }
      }
    }
    return { map: map, codeLen: codeLen || 1 };
  }

  function numOf(o) {
    try { return o && typeof o.asNumber === 'function' ? o.asNumber() : Number(o); } catch (e) { return 0; }
  }
  function nameOf(o) {
    try { return o && typeof o.asString === 'function' ? o.asString().replace(/^\//, '') : ''; } catch (e) { return ''; }
  }

  function buildFont(dict, L) {
    var N = L.PDFName;
    var subtype = nameOf(dict.lookup(N.of('Subtype')));
    var info = { name: '', subtype: subtype, twoByte: subtype === 'Type0', codeLen: subtype === 'Type0' ? 2 : 1, map: null, widths: null, firstChar: 0, defaultWidth: 0 };

    // 宽度
    try {
      if (subtype === 'Type0') {
        var W = dict.lookup(N.of('W'));
        if (W && typeof W.size === 'function') {
          var arr = [];
          for (var i = 0; i < W.size(); i++) {
            var el = W.lookup(i);
            if (el && typeof el.size === 'function') { // [w1 w2 ...]
              var ws = [];
              for (var k = 0; k < el.size(); k++) ws.push(numOf(el.lookup(k)));
              arr.push(ws);
            } else {
              arr.push(numOf(el));
            }
          }
          var wmap = {};
          var p = 0;
          while (p < arr.length) {
            if (Array.isArray(arr[p])) {
              // 上一项是起始 code
              var start = arr[p - 1];
              if (typeof start === 'number') {
                for (var q = 0; q < arr[p].length; q++) wmap[start + q] = arr[p][q];
              }
              p++;
            } else if (typeof arr[p] === 'number' && typeof arr[p + 1] === 'number' && typeof arr[p + 2] === 'number') {
              for (var c = arr[p]; c <= arr[p + 1] && c - arr[p] < 65536; c++) wmap[c] = arr[p + 2];
              p += 3;
            } else p++;
          }
          info.widths = wmap;
        }
      } else {
        var fc = dict.lookup(N.of('FirstChar'));
        info.firstChar = fc ? numOf(fc) : 0;
        var WA = dict.lookup(N.of('Widths'));
        if (WA && typeof WA.size === 'function') {
          var wm = {};
          for (var x = 0; x < WA.size(); x++) wm[info.firstChar + x] = numOf(WA.lookup(x));
          info.widths = wm;
        }
      }
      var fd = dict.lookup(N.of('FontDescriptor'));
      if (fd && typeof fd.lookup === 'function') {
        var mw = fd.lookup(N.of('MissingWidth'));
        if (mw) info.defaultWidth = numOf(mw);
      }
    } catch (e) { /* 忽略宽度 */ }

    // ToUnicode
    try {
      var tu = dict.lookup(N.of('ToUnicode'));
      if (tu) {
        var b = streamBytes(tu);
        if (b && b.length) {
          var parsed = parseToUnicode(b);
          info.map = parsed.map;
          if (!info.twoByte && parsed.codeLen > 1) info.codeLen = parsed.codeLen;
        }
      }
    } catch (e) { /* 无编码表 */ }
    if (!info.map && info.twoByte) {
      // 无 ToUnicode：尝试 DescendantFonts 判断是否 2 字节
      info.codeLen = 2;
    }
    return info;
  }

  function fontCache() { return { dict: {}, refs: {} }; }

  function getFont(cache, resources, name, L) {
    if (cache.dict[name]) return cache.dict[name];
    var info = null;
    try {
      var fonts = resources.lookup(L.PDFName.of('Font'));
      if (fonts) {
        var fd = fonts.lookup(L.PDFName.of(name));
        if (fd && typeof fd.lookup === 'function') info = buildFont(fd, L);
      }
    } catch (e) { info = null; }
    if (!info) info = { twoByte: false, codeLen: 1, map: null, widths: null, firstChar: 0, name: name };
    info.name = name;
    cache.dict[name] = info;
    return info;
  }

  function decodeWith(font, bytes) {
    var cl = font.codeLen || 1;
    var out = '';
    if (cl === 1) {
      for (var i = 0; i < bytes.length; i++) {
        var code = bytes[i];
        if (font.map && font.map[code] !== undefined) out += font.map[code];
        else out += WIN_ANSI[code] !== undefined ? WIN_ANSI[code] : '';
      }
      return out;
    }
    for (var p = 0; p + cl <= bytes.length; p += cl) {
      var c = 0;
      for (var k = 0; k < cl; k++) c = (c << 8) | bytes[p + k];
      if (font.map && font.map[c] !== undefined) out += font.map[c];
    }
    return out;
  }

  function advanceOf(font, bytes) {
    var cl = font.codeLen || 1;
    var total = 0;
    if (cl === 1) {
      for (var i = 0; i < bytes.length; i++) {
        var w = font.widths && font.widths[bytes[i]];
        total += (w === undefined || w === null ? (font.defaultWidth || 500) : w);
      }
      return total / 1000;
    }
    for (var p = 0; p + cl <= bytes.length; p += cl) {
      var c = 0;
      for (var k = 0; k < cl; k++) c = (c << 8) | bytes[p + k];
      var w2 = font.widths && font.widths[c];
      total += (w2 === undefined || w2 === null ? 1000 : w2);
    }
    return total / 1000;
  }

  /* ==================== 矩阵 ==================== */
  var IDENT = [1, 0, 0, 1, 0, 0];
  function mul(m, n) {
    return [
      m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
      m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
    ];
  }
  function scaleOf(m) { return Math.sqrt(m[0] * m[0] + m[1] * m[1]) || 1; }

  /* ==================== 内容流解释 ==================== */
  function Run(opt) {
    this.pages = [];
    this.cache = fontCache();
    this.warnings = {};
    this.opt = opt || {};
  }

  Run.prototype.warn = function (msg) { this.warnings[msg] = true; };

  // 处理一段内容流，把文字片段压进 items
  Run.prototype.exec = function (bytes, resources, ctm0, items, depth, visited) {
    var L = lib();
    if (depth > 3) return;
    var toks = tokenize(bytes);
    var gs = { ctm: ctm0 || IDENT.slice() };
    var stack = [];
    var ts = { font: null, size: 0, tc: 0, tw: 0, tz: 100, tl: 0, rise: 0, tm: IDENT.slice(), tlm: IDENT.slice() };
    var args = [];
    var cur = null; // 当前 BT..ET 块记录（给水印剔除用）

    function show(bytes2) {
      if (!ts.font) return;
      var text = decodeWith(ts.font, bytes2);
      if (text === '') return;
      // 起点 = 文本矩阵平移量经 CTM
      var origin = [ts.tm[4] * gs.ctm[0] + ts.tm[5] * gs.ctm[2] + gs.ctm[4],
      ts.tm[4] * gs.ctm[1] + ts.tm[5] * gs.ctm[3] + gs.ctm[5]];
      var size = Math.abs(ts.size) * scaleOf(ts.tm) * scaleOf(gs.ctm);
      var adv = advanceOf(ts.font, bytes2) * Math.abs(ts.size) * (ts.tz / 100);
      items.push({ text: text, x: origin[0], y: origin[1], size: size || 1, w: Math.abs(adv * scaleOf(ts.tm) * scaleOf(gs.ctm)), raw: bytes2, font: ts.font.name });
      // 推进文本矩阵
      ts.tm = mul([1, 0, 0, 1, adv, 0], ts.tm);
      return text;
    }
    function newline(tx, ty) {
      ts.tlm = mul([1, 0, 0, 1, tx, ty], ts.tlm);
      ts.tm = ts.tlm.slice();
    }

    for (var ti = 0; ti < toks.length; ti++) {
      var t = toks[ti];
      if (t.t !== 'op') { args.push(t); continue; }
      var op = t.v;

      if (op === 'BI') { args = []; continue; }

      if (op === 'BT') {
        ts.tm = IDENT.slice(); ts.tlm = IDENT.slice();
        cur = { start: t.s, end: -1, text: '', shows: [] };
      } else if (op === 'ET') {
        if (cur) { cur.end = t.e; this.blocks && this.blocks.push(cur); }
        cur = null;
      } else if (op === 'q') {
        stack.push({ ctm: gs.ctm.slice(), font: ts.font, size: ts.size, tc: ts.tc, tw: ts.tw, tz: ts.tz, tl: ts.tl, rise: ts.rise });
      } else if (op === 'Q') {
        var s = stack.pop();
        if (s) {
          gs.ctm = s.ctm; ts.font = s.font; ts.size = s.size; ts.tc = s.tc; ts.tw = s.tw;
          ts.tz = s.tz; ts.tl = s.tl; ts.rise = s.rise;
        }
      } else if (op === 'cm') {
        if (args.length >= 6) {
          var m6 = args.slice(-6).map(function (a) { return a.v; });
          gs.ctm = mul(m6, gs.ctm);
        }
      } else if (op === 'Tf') {
        var fname = args.length >= 2 ? (args[args.length - 2].t === 'name' ? args[args.length - 2].v : '') : '';
        ts.size = args.length >= 1 ? args[args.length - 1].v : 0;
        if (fname && resources) ts.font = getFont(this.cache, resources, fname, L);
      } else if (op === 'Tm') {
        if (args.length >= 6) {
          var mm = args.slice(-6).map(function (a) { return a.v; });
          ts.tm = mm; ts.tlm = mm.slice();
        }
      } else if (op === 'Td') {
        if (args.length >= 2) newline(args[args.length - 2].v, args[args.length - 1].v);
      } else if (op === 'TD') {
        if (args.length >= 2) {
          ts.tl = -args[args.length - 1].v;
          newline(args[args.length - 2].v, args[args.length - 1].v);
        }
      } else if (op === 'TL') {
        if (args.length) ts.tl = args[args.length - 1].v;
      } else if (op === 'Tc') {
        if (args.length) ts.tc = args[args.length - 1].v;
      } else if (op === 'Tw') {
        if (args.length) ts.tw = args[args.length - 1].v;
      } else if (op === 'Tz') {
        if (args.length) ts.tz = args[args.length - 1].v;
      } else if (op === 'Ts') {
        if (args.length) ts.rise = args[args.length - 1].v;
      } else if (op === 'T*') {
        newline(0, -ts.tl);
      } else if (op === 'Tj' || op === "'" || op === '"') {
        if (op !== 'Tj') newline(0, -ts.tl);
        var last = args[args.length - 1];
        if (last && last.t === 'str') {
          var txt = show(last.v);
          if (cur && txt) { cur.text += txt; cur.shows.push({ s: last.s, e: last.e, text: txt }); }
        }
      } else if (op === 'TJ') {
        // 数组：从 args 里找出所有 str（中间可能夹数字）
        for (var ai = 0; ai < args.length; ai++) {
          var a = args[ai];
          if (a.t === 'str') {
            var txt2 = show(a.v);
            if (cur && txt2) { cur.text += txt2; cur.shows.push({ s: a.s, e: a.e, text: txt2 }); }
          } else if (a.t === 'num') {
            ts.tm = mul([1, 0, 0, 1, -a.v / 1000 * Math.abs(ts.size) * (ts.tz / 100), 0], ts.tm);
          }
        }
      } else if (op === 'Do') {
        // Form XObject 递归
        var nm = args.length ? args[args.length - 1] : null;
        if (nm && nm.t === 'name' && resources) {
          try {
            var xo = resources.lookup(L.PDFName.of('XObject'));
            var form = xo && xo.lookup(L.PDFName.of(nm.v));
            if (form) {
              var st = nameOf(form.dict ? form.dict.lookup(L.PDFName.of('Subtype')) : null);
              if (!st || st === 'Form') {
                var key = nm.v + '@' + depth;
                if (!visited[key]) {
                  visited[key] = true;
                  var fb = streamBytes(form);
                  if (fb && fb.length) {
                    var fres = null;
                    try { fres = form.dict.lookup(L.PDFName.of('Resources')); } catch (e) { fres = null; }
                    var fmat = IDENT.slice();
                    try {
                      var mx = form.dict.lookup(L.PDFName.of('Matrix'));
                      if (mx && typeof mx.size === 'function' && mx.size() >= 6) {
                        fmat = [];
                        for (var mi = 0; mi < 6; mi++) fmat.push(numOf(mx.lookup(mi)));
                      }
                    } catch (e) { }
                    this.exec(fb, fres || resources, mul(fmat, gs.ctm), items, depth + 1, visited);
                  }
                }
              }
            }
          } catch (e) { }
        }
      }
      args = [];
    }
  };

  /* ==================== 页面 → 文字行 ==================== */
  function groupLines(items) {
    var list = items.filter(function (it) { return it.text && it.text.trim() !== ''; });
    list.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    var curLine = null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var tol = Math.max(2.2, it.size * 0.55);
      if (!curLine || Math.abs(curLine.y - it.y) > tol) {
        curLine = { y: it.y, size: it.size, items: [it] };
        lines.push(curLine);
      } else {
        curLine.items.push(it);
        curLine.size = Math.max(curLine.size, it.size);
      }
    }
    lines.forEach(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var txt = '';
      var prevEnd = null;
      var prevChar = '';
      ln.items.forEach(function (it) {
        if (prevEnd !== null) {
          var gap = it.x - prevEnd;
          var first = it.text.charAt(0);
          // 中文之间常有字距，不轻易补空格；西文间隙大时才补
          var cjk = /[\u3000-\u9fff\uff00-\uffef]/.test(prevChar) || /[\u3000-\u9fff\uff00-\uffef]/.test(first);
          var need = gap > Math.max(1.6, it.size * (cjk ? 0.9 : 0.3));
          if (need && !/\s$/.test(txt) && !/^\s/.test(it.text)) txt += ' ';
        }
        txt += it.text;
        prevEnd = it.x + (it.w || 0);
        prevChar = it.text.charAt(it.text.length - 1);
      });
      ln.text = txt.replace(/[ \t]+/g, ' ').trim();
      ln.x = ln.items[0].x;
    });
    return lines.filter(function (l) { return l.text; });
  }

  /* ==================== 对外：抽取整份 PDF ==================== */
  function extractBytes(buf, onProgress) {
    var L = lib();
    return Promise.resolve()
      .then(function () {
        return L.PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
      })
      .then(function (doc) {
        var pages = doc.getPages();
        var out = [];
        var warnings = {};

        function step(i) {
          if (i >= pages.length) {
            return { pages: out, warnings: Object.keys(warnings) };
          }
          if (onProgress) { try { onProgress(i + 1, pages.length); } catch (e) { } }
          var page = pages[i];
          var items = [];
          try {
            var resources = null;
            try { resources = page.node.Resources(); } catch (e) { resources = null; }
            var contents = page.node.Contents();
            var streams = [];
            if (contents) {
              if (contents instanceof L.PDFArray) {
                for (var k = 0; k < contents.size(); k++) {
                  var el = contents.lookup(k);
                  if (el) streams.push(el);
                }
              } else streams.push(contents);
            }
            if (!streams.length) warnings['部分页面没有内容流'] = true;
            var run = new Run();
            var visited = {};
            streams.forEach(function (st) {
              var b = streamBytes(st);
              if (!b || !b.length) { warnings['有内容流无法解码（可能是特殊滤镜）'] = true; return; }
              try { run.exec(b, resources, IDENT.slice(), items, 0, visited); }
              catch (e) { warnings['有页面的内容流解析失败'] = true; }
            });
          } catch (e) {
            warnings['有页面读取失败'] = true;
          }
          var lines = groupLines(items);
          var text = lines.map(function (l) { return l.text; }).join('\n');
          if (!text) warnings['部分页面没有可提取文字（可能是扫描件）'] = true;
          out.push({
            index: i,
            width: page.getWidth(),
            height: page.getHeight(),
            items: items,
            lines: lines,
            text: text
          });
          return step(i + 1);
        }
        return step(0);
      });
  }

  /* ==================== 水印剔除（内容流） ==================== */
  // 逐页扫描 BT…ET 块，把文字与关键词匹配的块整块删掉
  function analyzePageBlocks(doc, pageIndex) {
    var L = lib();
    var page = doc.getPage(pageIndex);
    var resources = null;
    try { resources = page.node.Resources(); } catch (e) { }
    var contents = page.node.Contents();
    var streams = [];
    if (contents) {
      if (contents instanceof L.PDFArray) {
        for (var k = 0; k < contents.size(); k++) {
          var el = contents.lookup(k);
          if (el) streams.push(el);
        }
      } else streams.push(contents);
    }
    var res = [];
    streams.forEach(function (st) {
      var b = streamBytes(st);
      if (!b || !b.length) return;
      var items = [];
      var run = new Run();
      run.blocks = [];
      try { run.exec(b, resources, IDENT.slice(), items, 0, {}); } catch (e) { return; }
      res.push({ stream: st, bytes: b, blocks: run.blocks });
    });
    return res;
  }

  function removeWatermark(doc, keyword, onProgress) {
    var L = lib();
    var kw = String(keyword || '').replace(/\s+/g, '');
    var pages = doc.getPages();
    var removedBlocks = 0, blanked = 0;

    function processPage(i) {
      if (i >= pages.length) return { removedBlocks: removedBlocks, blanked: blanked };
      if (onProgress) { try { onProgress(i + 1, pages.length); } catch (e) { } }
      var groups = analyzePageBlocks(doc, i);
      var newParts = [];
      var changed = false;

      groups.forEach(function (g) {
        var bytes = g.bytes.slice();
        var dead = [];   // [start,end] 整块删除
        g.blocks.forEach(function (blk) {
          if (blk.end < 0) return;
          var txt = String(blk.text || '').replace(/\s+/g, '');
          if (!txt) return;
          var match = kw ? (txt === kw || txt.indexOf(kw) >= 0) : false;
          if (match) {
            // 若块内文字基本全是水印 → 整块删；否则只清掉命中的 show 操作
            var hitLen = 0;
            blk.shows.forEach(function (sh) {
              if (String(sh.text).replace(/\s+/g, '').indexOf(kw) >= 0) hitLen += sh.text.length;
            });
            if (hitLen >= blk.text.length * 0.8) { dead.push([blk.start, blk.end]); removedBlocks++; }
            else {
              blk.shows.forEach(function (sh) {
                if (String(sh.text).replace(/\s+/g, '').indexOf(kw) >= 0) {
                  for (var p = sh.s; p < sh.e && p < bytes.length; p++) bytes[p] = 0x20;
                  blanked++;
                }
              });
            }
            changed = true;
          }
        });
        if (!dead.length) { newParts.push(bytes); return; }
        dead.sort(function (a, b) { return a[0] - b[0]; });
        var out = [];
        var pos = 0;
        dead.forEach(function (d) {
          if (d[0] > pos) out.push(bytes.subarray(pos, d[0]));
          pos = Math.max(pos, d[1]);
        });
        if (pos < bytes.length) out.push(bytes.subarray(pos));
        newParts.push(concat(out));
      });

      if (changed && newParts.length) {
        try {
          var total = concat(newParts);
          var newStream = doc.context.flateStream(total);
          var ref = doc.context.register(newStream);
          var page = doc.getPage(i);
          if (typeof page.node.set === 'function') page.node.set(L.PDFName.of('Contents'), ref);
          else page.node.dict.set(L.PDFName.of('Contents'), ref);
        } catch (e) { /* 单页失败不影响其他页 */ }
      }
      return processPage(i + 1);
    }

    return processPage(0);
  }

  function concat(parts) {
    var total = 0;
    parts.forEach(function (p) { total += p.length + 1; });
    var out = new Uint8Array(total);
    var pos = 0;
    parts.forEach(function (p) {
      out.set(p, pos); pos += p.length;
      out[pos++] = 10;
    });
    return out;
  }

  /* ==================== 对外接口 ==================== */
  window.PDFTEXT = {
    extract: function (arrayBuffer, onProgress) { return extractBytes(arrayBuffer, onProgress); },
    groupLines: groupLines,
    tokenize: tokenize,
    decodeStream: streamBytes,
    analyzePageBlocks: analyzePageBlocks,
    removeWatermark: removeWatermark,
    toPlainText: function (result) {
      return result.pages.map(function (p) { return p.text; }).join('\n\n');
    }
  };
})();
