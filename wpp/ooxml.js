/* ============================================================
 * WPS 工具助手 · OOXML 生成引擎（纯 JS，无第三方依赖）
 *   OOXML.zip(files)          极简 ZIP（store 存储，不压缩）
 *   OOXML.docx(blocks, opts)  Word：标题 / 正文 / 项目符号 / 分页
 *   OOXML.xlsx(rows, opts)    Excel：自动列宽、数字识别
 *   OOXML.pptx(slides, opts)  PPT：一页多文本框（16:9）
 * 输出 Uint8Array，调用方自行包 Blob 保存
 * ============================================================ */
(function () {
  'use strict';

  var enc = (function () {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder();
    // 老内核兜底
    return {
      encode: function (str) {
        var utf8 = unescape(encodeURIComponent(str));
        var arr = new Uint8Array(utf8.length);
        for (var i = 0; i < utf8.length; i++) arr[i] = utf8.charCodeAt(i);
        return arr;
      }
    };
  })();

  function utf8(str) { return enc.encode(String(str)); }

  /* ==================== ZIP ==================== */
  var CRC_TABLE = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = -1;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function dosTime(d) {
    var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
    var date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
    return { time: time, date: date };
  }

  function zip(files) {
    var now = dosTime(new Date());
    var chunks = [];
    var central = [];
    var offset = 0;

    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + name.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);          // version needed
      dv.setUint16(6, 0x0800, true);      // UTF-8 flag
      dv.setUint16(8, 0, true);           // store
      dv.setUint16(10, now.time, true);
      dv.setUint16(12, now.date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      local.set(name, 30);

      chunks.push(local, data);

      var cen = new Uint8Array(46 + name.length);
      var cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, now.time, true);
      cv.setUint16(14, now.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cen.set(name, 46);
      central.push(cen);

      offset += local.length + data.length;
    });

    var cenSize = 0;
    central.forEach(function (c) { cenSize += c.length; });
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, cenSize, true);
    ev.setUint32(16, offset, true);

    var total = offset + cenSize + 22;
    var out = new Uint8Array(total);
    var p = 0;
    chunks.concat(central).concat([end]).forEach(function (c) {
      out.set(c, p); p += c.length;
    });
    return out;
  }

  /* ==================== XML 工具 ==================== */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  var DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

  function rels(items) {
    return DECL + '<Relationships xmlns="' + REL + '">' +
      items.map(function (r) {
        return '<Relationship Id="' + r.id + '" Type="' + r.type + '" Target="' + r.target + '"/>';
      }).join('') + '</Relationships>';
  }

  /* ==================== DOCX ==================== */
  var STYLES_XML = DECL +
    '<w:styles xmlns:w="' + NS_W + '">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>' +
    '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLine="420"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr>' +
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="黑体"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr>' +
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="黑体"/><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:spacing w:before="180" w:after="60" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="2"/></w:pPr>' +
    '<w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="WtaBullet"><w:name w:val="WTA Bullet"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:ind w:left="420" w:hanging="240" w:firstLine="0"/></w:pPr></w:style>' +
    '</w:styles>';

  function docxParagraph(b) {
    var type = b.type || 'p';
    if (type === 'pagebreak') {
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }
    var style = type === 'h1' ? 'Heading1' : type === 'h2' ? 'Heading2' : type === 'h3' ? 'Heading3'
      : type === 'li' ? 'WtaBullet' : 'Normal';
    var text = b.text === undefined ? '' : String(b.text);
    var prefix = type === 'li' ? '• ' : '';
    // 手动换行保留
    var runs = text.split(/\n/).map(function (line, i) {
      var body = (i === 0 ? prefix : '') + line;
      return (i ? '<w:r><w:br/></w:r>' : '') +
        '<w:r>' + (b.bold ? '<w:rPr><w:b/></w:rPr>' : '') +
        '<w:t xml:space="preserve">' + esc(body) + '</w:t></w:r>';
    }).join('');
    var pPr = '<w:pPr><w:pStyle w:val="' + style + '"/>' +
      (b.align ? '<w:jc w:val="' + b.align + '"/>' : '') + '</w:pPr>';
    if (type === 'h1' || type === 'h2' || type === 'h3') pPr = '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>';
    return '<w:p>' + pPr + runs + '</w:p>';
  }

  function docx(blocks) {
    var body = (blocks || []).map(docxParagraph).join('');
    if (!body) body = '<w:p/>';
    var xml = DECL +
      '<w:document xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1418" w:bottom="1440" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/>' +
      '<w:cols w:space="425"/><w:docGrid w:linePitch="312"/></w:sectPr>' +
      '</w:body></w:document>';

    return zip([
      {
        name: '[Content_Types].xml', data: DECL + '<Types xmlns="' + CT + '">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '</Types>'
      },
      {
        name: '_rels/.rels', data: rels([
          { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', target: 'word/document.xml' }
        ])
      },
      {
        name: 'word/_rels/document.xml.rels', data: rels([
          { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', target: 'styles.xml' }
        ])
      },
      { name: 'word/document.xml', data: xml },
      { name: 'word/styles.xml', data: STYLES_XML }
    ]);
  }

  /* ==================== XLSX ==================== */
  function colName(n) { // 0 → A
    var s = '';
    n = n + 1;
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function xlsx(rows, opts) {
    opts = opts || {};
    var sheetName = String(opts.sheet || 'Sheet1').replace(/[\[\]:*?\/\\]/g, '').slice(0, 30) || 'Sheet1';
    rows = rows || [];
    var maxCols = 0;
    rows.forEach(function (r) { if (r.length > maxCols) maxCols = r.length; });
    if (!maxCols) { rows = [['']]; maxCols = 1; }

    var sheetRows = rows.map(function (row, ri) {
      var cells = '';
      for (var ci = 0; ci < maxCols; ci++) {
        var v = row[ci];
        var ref = colName(ci) + (ri + 1);
        if (v === undefined || v === null || v === '') { continue; }
        if (typeof v === 'number' && isFinite(v)) {
          cells += '<c r="' + ref + '"><v>' + v + '</v></c>';
        } else {
          cells += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
        }
      }
      return '<row r="' + (ri + 1) + '">' + cells + '</row>';
    }).join('');

    // 列宽：按最长内容估算
    var cols = '';
    var widths = [];
    for (var i = 0; i < maxCols; i++) {
      var mx = 6;
      rows.slice(0, 400).forEach(function (r) {
        var s = r[i] === undefined || r[i] === null ? '' : String(r[i]);
        var len = 0;
        for (var k = 0; k < s.length; k++) len += s.charCodeAt(k) > 255 ? 2 : 1;
        if (len > mx) mx = len;
      });
      widths.push(Math.min(60, mx + 2));
    }
    widths.forEach(function (w, idx) {
      cols += '<col min="' + (idx + 1) + '" max="' + (idx + 1) + '" width="' + w + '" customWidth="1"/>';
    });

    var sheet = DECL +
      '<worksheet xmlns="' + NS_S + '" xmlns:r="' + NS_R + '">' +
      '<dimension ref="A1:' + colName(maxCols - 1) + rows.length + '"/>' +
      '<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      '<cols>' + cols + '</cols>' +
      '<sheetData>' + sheetRows + '</sheetData>' +
      '</worksheet>';

    var workbook = DECL +
      '<workbook xmlns="' + NS_S + '" xmlns:r="' + NS_R + '">' +
      '<sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    return zip([
      {
        name: '[Content_Types].xml', data: DECL + '<Types xmlns="' + CT + '">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>'
      },
      {
        name: '_rels/.rels', data: rels([
          { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', target: 'xl/workbook.xml' }
        ])
      },
      {
        name: 'xl/_rels/workbook.xml.rels', data: rels([
          { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', target: 'worksheets/sheet1.xml' },
          { id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', target: 'styles.xml' }
        ])
      },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
      {
        name: 'xl/styles.xml', data: DECL + '<styleSheet xmlns="' + NS_S + '">' +
          '<fonts count="1"><font><sz val="11"/><name val="宋体"/><charset val="134"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
          '</styleSheet>'
      }
    ]);
  }

  /* ==================== PPTX ==================== */
  var THEME_XML = DECL +
    '<a:theme xmlns:a="' + NS_A + '" name="WTA"><a:themeElements>' +
    '<a:clrScheme name="WTA">' +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
    '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="2F3B4C"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>' +
    '<a:accent1><a:srgbClr val="C0392B"/></a:accent1><a:accent2><a:srgbClr val="E67E22"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="7F8C8D"/></a:accent3><a:accent4><a:srgbClr val="F1C40F"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="2980B9"/></a:accent5><a:accent6><a:srgbClr val="27AE60"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
    '</a:clrScheme>' +
    '<a:fontScheme name="WTA">' +
    '<a:majorFont><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:minorFont>' +
    '</a:fontScheme>' +
    '<a:fmtScheme name="WTA">' +
    '<a:fillStyleLst>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '</a:fillStyleLst>' +
    '<a:lnStyleLst>' +
    '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
    '</a:lnStyleLst>' +
    '<a:effectStyleLst>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '</a:effectStyleLst>' +
    '<a:bgFillStyleLst>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '</a:bgFillStyleLst>' +
    '</a:fmtScheme>' +
    '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';

  function pptxTextBox(id, opt) {
    var runs = (opt.paras || []).map(function (t) {
      return '<a:p><a:pPr algn="' + (opt.align || 'l') + '"/>' +
        '<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="' + Math.round((opt.size || 16) * 100) + '"' +
        (opt.bold ? ' b="1"' : ' b="0"') + ' dirty="0">' +
        '<a:solidFill><a:srgbClr val="' + (opt.color || '333333') + '"/></a:solidFill>' +
        '<a:latin typeface="' + (opt.font || '微软雅黑') + '"/><a:ea typeface="' + (opt.font || '微软雅黑') + '"/>' +
        '</a:rPr><a:t>' + esc(t) + '</a:t></a:r></a:p>';
    }).join('');
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="TextBox ' + id + '"/>' +
      '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + opt.x + '" y="' + opt.y + '"/><a:ext cx="' + opt.cx + '" cy="' + opt.cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>' +
      (runs || '<a:p><a:endParaRPr lang="zh-CN"/></a:p>') +
      '</p:txBody></p:sp>';
  }

  function pptx(slides) {
    var EMU_W = 12192000, EMU_H = 6858000;
    var M = 609600;               // 0.67 inch 边距
    var contentW = EMU_W - M * 2;

    var slideFiles = [], slideRels = [], ctSlides = '', presSlides = '', presRels = '';

    (slides || []).forEach(function (s, i) {
      var n = i + 1;
      var shapes = '';
      var id = 2;
      var bodyY = M;

      if (s.title) {
        shapes += pptxTextBox(id++, {
          paras: [s.title], size: 30, bold: true, color: '1F2A37',
          x: M, y: bodyY, cx: contentW, cy: 900000, align: 'l'
        });
        bodyY += 1100000;
      }
      if (s.lines && s.lines.length) {
        var boxH = EMU_H - bodyY - M;
        shapes += pptxTextBox(id++, {
          paras: s.lines, size: s.fontSize || 16, color: '333333',
          x: M, y: bodyY, cx: contentW, cy: boxH > 400000 ? boxH : 400000, align: 'l'
        });
      }
      if (!shapes) shapes = pptxTextBox(id++, { paras: [''], size: 16, x: M, y: M, cx: contentW, cy: 900000 });

      var slideXml = DECL +
        '<p:sld xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '">' +
        '<p:cSld><p:spTree>' +
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
        shapes +
        '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';

      slideFiles.push({ name: 'ppt/slides/slide' + n + '.xml', data: slideXml });
      slideRels.push({
        name: 'ppt/slides/_rels/slide' + n + '.xml.rels',
        data: rels([{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' }])
      });
      ctSlides += '<Override PartName="/ppt/slides/slide' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
      presSlides += '<p:sldId id="' + (255 + n) + '" r:id="rId' + (n + 1) + '"/>';
      presRels += '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + n + '.xml"/>';
    });

    if (!slides || !slides.length) throw new Error('没有可生成的幻灯片');

    var presentation = DECL +
      '<p:presentation xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '" saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + presSlides + '</p:sldIdLst>' +
      '<p:sldSz cx="' + EMU_W + '" cy="' + EMU_H + '"/><p:notesSz cx="6858000" cy="9144000"/>' +
      '</p:presentation>';

    var master = DECL +
      '<p:sldMaster xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '">' +
      '<p:cSld><p:spTree>' +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      '</p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '</p:sldMaster>';

    var layout = DECL +
      '<p:sldLayout xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '" type="blank" preserve="1">' +
      '<p:cSld name="空白"><p:spTree>' +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

    var files = [
      {
        name: '[Content_Types].xml', data: DECL + '<Types xmlns="' + CT + '">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
          '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
          '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
          '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
          ctSlides +
          '</Types>'
      },
      {
        name: '_rels/.rels', data: rels([
          { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', target: 'ppt/presentation.xml' }
        ])
      },
      {
        name: 'ppt/_rels/presentation.xml.rels', data: DECL + '<Relationships xmlns="' + REL + '">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
          presRels + '</Relationships>'
      },
      { name: 'ppt/presentation.xml', data: presentation },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: master },
      {
        name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([
          { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' },
          { id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', target: '../theme/theme1.xml' }
        ])
      },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout },
      {
        name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([
          { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', target: '../slideMasters/slideMaster1.xml' }
        ])
      },
      { name: 'ppt/theme/theme1.xml', data: THEME_XML }
    ];

    return zip(files.concat(slideFiles).concat(slideRels));
  }

  window.OOXML = { zip: zip, docx: docx, xlsx: xlsx, pptx: pptx, esc: esc, colName: colName };
})();
