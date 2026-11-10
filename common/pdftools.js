/* ============================================================
 * WPS 工具助手 · PDF 工具（本地 pdf-lib，离线可用）
 *   pdf-merge            多份合并
 *   pdf-split            按页 / 每 N 页 / 自定义范围拆分
 *   pdf-page-manage      重排 / 删除 / 旋转
 *   pdf-watermark-add    文字水印（PNG 叠加，支持中文）
 *   pdf-resize           统一页面尺寸
 * ============================================================ */
(function () {
  'use strict';

  var SIZES = {
    a4: [595.28, 841.89],
    a4l: [841.89, 595.28],
    a3: [841.89, 1190.55],
    letter: [612, 792]
  };

  function lib() {
    if (!window.PDFLib) throw new Error('PDF 引擎未加载（vendor/pdf-lib.min.js 缺失）');
    return window.PDFLib;
  }

  function blobToArrayBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function loadDoc(path) {
    var PDFLib = lib();
    return TK.readFile(path).then(blobToArrayBuffer).then(function (buf) {
      // %PDF- 头校验，避免把别的文件当 PDF 读
      var head = new Uint8Array(buf, 0, Math.min(5, buf.byteLength));
      var sig = String.fromCharCode.apply(null, head);
      if (sig.indexOf('%PDF') !== 0) throw new Error('不是有效的 PDF 文件：' + TK.baseName(path));
      return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
    }).catch(function (e) {
      if (/encrypt/i.test(String(e && e.message))) throw new Error('PDF 已加密，请先去除密码后再处理');
      throw e;
    });
  }

  function savePdf(bytes, name) {
    return TK.save(new Blob([bytes], { type: 'application/pdf' }), name);
  }

  // "1-3,5,7-9" → [0,1,2,4,6,7,8]（0 基），非法项忽略
  function parseRanges(spec, total) {
    var out = [];
    String(spec).split(/[,，;；\s]+/).forEach(function (part) {
      if (!part) return;
      var m = part.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a > b) { var t = a; a = b; b = t; }
        for (var i = a; i <= b; i++) if (i >= 1 && i <= total) out.push(i - 1);
      } else if (/^\d+$/.test(part)) {
        var n = parseInt(part, 10);
        if (n >= 1 && n <= total) out.push(n - 1);
      }
    });
    return out;
  }

  function stamp() {
    var d = new Date();
    function p2(n) { return n < 10 ? '0' + n : '' + n; }
    return '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  }

  /* ==================== 合并 ==================== */
  function merge() {
    TK.modal({
      title: '🔗 PDF 合并',
      hint: '按选择顺序合并为一份 PDF。可在 Windows 对话框中用 Ctrl 多选，选择顺序即合并顺序（建议先给文件改好 01- 02- 前缀）。',
      runLabel: '合并并保存',
      body:
        '<label class="tk-row"><span>输出文件名</span><input id="mg-name" type="text" value="合并结果.pdf"></label>' +
        '<p class="tk-hint">提示：合并顺序 = 你在选择框中的多选顺序，建议先给文件加 01- 02- 前缀再按名称排序选择。</p>',
      onRun: function () {
        var PDFLib = lib();
        var name = TK.val('#mg-name') || '合并结果.pdf';
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        return TK.pickFiles({ filter: TK.FILTER_PDF, multi: true, title: '选择要合并的 PDF（可多选）' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            return PDFLib.PDFDocument.create().then(function (doc) {
              var seq = files.reduce(function (p, f) {
                return p.then(function () {
                  return loadDoc(f).then(function (src) {
                    return doc.copyPages(src, src.getPageIndices()).then(function (pages) {
                      pages.forEach(function (pg) { doc.addPage(pg); });
                      TK.msg('已合并 ' + TK.baseName(f) + '，累计 ' + doc.getPageCount() + ' 页');
                    });
                  });
                });
              }, Promise.resolve());
              return seq.then(function () {
                return doc.save().then(function (bytes) {
                  return savePdf(bytes, name);
                }).then(function (p) {
                  TK.resultBox([p], '共 ' + doc.getPageCount() + ' 页');
                });
              });
            });
          });
      }
    });
  }

  /* ==================== 拆分 ==================== */
  function split() {
    TK.modal({
      title: '✂️ PDF 拆分',
      hint: '支持三种拆法：每页一份、每 N 页一份、按指定范围拆。产物保存到「下载\\WPS工具助手」。',
      runLabel: '开始拆分',
      body:
        '<label class="tk-row"><span>拆分方式</span><select id="sp-mode">' +
        '<option value="page">每页拆成一份</option>' +
        '<option value="each">每 N 页一份</option>' +
        '<option value="range">按指定范围拆</option>' +
        '</select></label>' +
        '<label class="tk-row"><span>每 N 页</span><input id="sp-n" type="number" value="2" min="1" max="100"></label>' +
        '<label class="tk-row"><span>页范围</span><input id="sp-range" type="text" placeholder="如：1-3,4-6,7"><em>逗号分隔，每段生成一份</em></label>',
      onMount: function () {
        var m = document.getElementById('sp-mode');
        var n = document.getElementById('sp-n');
        var r = document.getElementById('sp-range');
        function sync() {
          n.parentNode.style.display = m.value === 'each' ? '' : 'none';
          r.parentNode.style.display = m.value === 'range' ? '' : 'none';
        }
        m.onchange = sync; sync();
      },
      onRun: function () {
        var PDFLib = lib();
        var mode = TK.val('#sp-mode');
        var n = Math.max(1, TK.num('#sp-n', 2));
        var rangeSpec = TK.val('#sp-range');
        return TK.pickFiles({ filter: TK.FILTER_PDF, multi: false, title: '选择要拆分的 PDF' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            var src0 = files[0];
            return loadDoc(src0).then(function (src) {
              var total = src.getPageCount();
              var groups = [];
              if (mode === 'page') {
                for (var i = 0; i < total; i++) groups.push([i]);
              } else if (mode === 'each') {
                for (var j = 0; j < total; j += n) {
                  var g = [];
                  for (var k = j; k < Math.min(j + n, total); k++) g.push(k);
                  groups.push(g);
                }
              } else {
                String(rangeSpec).split(/[,，;；]+/).forEach(function (seg) {
                  var idx = parseRanges(seg, total);
                  if (idx.length) groups.push(idx);
                });
                if (!groups.length) throw new Error('页范围为空或不合法，示例：1-3,4-6');
              }
              if (!groups.length) throw new Error('没有可拆分的页');
              var base = TK.stripExt(TK.baseName(src0));
              var out = [];
              var seq = Promise.resolve();
              groups.forEach(function (idxs, gi) {
                seq = seq.then(function () {
                  return PDFLib.PDFDocument.create().then(function (doc) {
                    return doc.copyPages(src, idxs).then(function (pages) {
                      pages.forEach(function (p) { doc.addPage(p); });
                      return doc.save();
                    });
                  }).then(function (bytes) {
                    var label = idxs.length === 1 ? ('p' + (idxs[0] + 1)) : ('p' + (idxs[0] + 1) + '-' + (idxs[idxs.length - 1] + 1));
                    return savePdf(bytes, base + '_' + label + '.pdf');
                  }).then(function (p) {
                    out.push(p);
                    TK.msg('已拆分 ' + out.length + ' / ' + groups.length + ' 份');
                  });
                });
              });
              return seq.then(function () {
                TK.resultBox(out, '原 ' + total + ' 页 → ' + out.length + ' 份');
              });
            });
          });
      }
    });
  }

  /* ==================== 页面管理 ==================== */
  function pageManage() {
    TK.modal({
      title: '🗂️ PDF 页面管理',
      hint: '按你写的顺序重排页面，不写到的页会被删除；可同时统一旋转。',
      runLabel: '生成新 PDF',
      body:
        '<p class="tk-hint">示例：<code>3,1,2,5-7</code> → 第3页、第1页、第2页、第5~7页，其余页丢弃。</p>' +
        '<label class="tk-row"><span>页序</span><input id="pm-order" type="text" placeholder="留空表示保持原顺序"></label>' +
        '<label class="tk-row"><span>旋转</span><select id="pm-rot">' +
        '<option value="0">不旋转</option><option value="90">顺时针 90°</option>' +
        '<option value="180">180°</option><option value="270">顺时针 270°</option>' +
        '</select></label>',
      onRun: function () {
        var PDFLib = lib();
        var order = TK.val('#pm-order');
        var rot = TK.num('#pm-rot', 0);
        return TK.pickFiles({ filter: TK.FILTER_PDF, multi: false, title: '选择 PDF' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            return loadDoc(files[0]).then(function (src) {
              var total = src.getPageCount();
              var idx = order && order.trim() ? parseRanges(order, total) : src.getPageIndices();
              if (!idx.length) throw new Error('页序为空或不合法');
              return PDFLib.PDFDocument.create().then(function (doc) {
                return doc.copyPages(src, idx).then(function (pages) {
                  pages.forEach(function (p, i) {
                    if (rot) p.setRotation(PDFLib.degrees((p.getRotation().angle + rot) % 360));
                    doc.addPage(p);
                  });
                  return doc.save();
                });
              }).then(function (bytes) {
                var base = TK.stripExt(TK.baseName(files[0]));
                return savePdf(bytes, base + '_页面整理.pdf');
              }).then(function (p) {
                TK.resultBox([p], '输出 ' + idx.length + ' 页（原 ' + total + ' 页）');
              });
            });
          });
      }
    });
  }

  /* ==================== 加 PDF 水印 ==================== */
  // 中文水印靠 canvas 画成 PNG 再叠加，避免标准字体不支持中文
  function watermarkPng(text, opts) {
    var fs = 42;
    var cv = document.createElement('canvas');
    var ctx = cv.getContext('2d');
    ctx.font = 'bold ' + fs + 'px "Microsoft YaHei", sans-serif';
    var tw = Math.ceil(ctx.measureText(text).width) + 24;
    var th = fs + 24;
    cv.width = tw; cv.height = th;
    ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, tw, th);
    ctx.font = 'bold ' + fs + 'px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = opts.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tw / 2, th / 2);
    return TK.canvasToBlob(cv, 'image/png');
  }

  function watermark() {
    TK.modal({
      title: '💧 添加 PDF 水印',
      hint: '在每一页叠加文字水印，支持中文。',
      runLabel: '添加水印',
      body:
        '<label class="tk-row"><span>水印文字</span><input id="pw-text" type="text" value="仅供内部使用"></label>' +
        '<label class="tk-row"><span>不透明度</span><input id="pw-op" type="range" min="5" max="100" value="18"><b id="pw-opv">18%</b></label>' +
        '<label class="tk-row"><span>字号(px)</span><input id="pw-size" type="number" value="42" min="8" max="200"></label>' +
        '<label class="tk-row"><span>角度</span><select id="pw-deg">' +
        '<option value="45">45° 斜向（推荐）</option><option value="0">水平</option><option value="90">垂直</option>' +
        '</select></label>' +
        '<label class="tk-row"><span>颜色</span><input id="pw-color" type="color" value="#909090"></label>',
      onMount: function () {
        var op = document.getElementById('pw-op');
        op.oninput = function () { document.getElementById('pw-opv').textContent = op.value + '%'; };
      },
      onRun: function () {
        var PDFLib = lib();
        var text = TK.val('#pw-text') || '水印';
        var alpha = TK.num('#pw-op', 18) / 100;
        var deg = TK.num('#pw-deg', 45);
        var color = TK.val('#pw-color') || '#909090';
        return TK.pickFiles({ filter: TK.FILTER_PDF, multi: false, title: '选择 PDF' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            return watermarkPng(text, { color: color }).then(function (pngBlob) {
              return blobToArrayBuffer(pngBlob).then(function (pngBuf) {
                return loadDoc(files[0]).then(function (doc) {
                  return doc.embedPng(pngBuf).then(function (png) {
                    var pages = doc.getPages();
                    pages.forEach(function (pg, i) {
                      var w = pg.getWidth(), h = pg.getHeight();
                      var scale = Math.min(w * 0.55 / png.width, 1.6);
                      var dw = png.width * scale, dh = png.height * scale;
                      pg.drawImage(png, {
                        x: w / 2 - dw / 2,
                        y: h / 2 - dh / 2,
                        width: dw,
                        height: dh,
                        opacity: alpha,
                        rotate: PDFLib.degrees(deg)
                      });
                      if ((i + 1) % 10 === 0) TK.msg('已处理 ' + (i + 1) + ' / ' + pages.length + ' 页');
                    });
                    return doc.save();
                  });
                }).then(function (bytes) {
                  return savePdf(bytes, TK.stripExt(TK.baseName(files[0])) + '_水印.pdf');
                }).then(function (p) { TK.resultBox([p], '已叠加到每一页'); });
              });
            });
          });
      }
    });
  }

  /* ==================== 尺寸调整 ==================== */
  function resize() {
    TK.modal({
      title: '📐 PDF 尺寸调整',
      hint: '把整份 PDF 统一到同一页面尺寸（缩放内容，不变形、不裁切）。',
      runLabel: '调整并保存',
      body:
        '<label class="tk-row"><span>目标尺寸</span><select id="rs-size">' +
        '<option value="a4">A4 纵向</option><option value="a4l">A4 横向</option>' +
        '<option value="a3">A3 纵向</option><option value="letter">Letter</option>' +
        '</select></label>' +
        '<label class="tk-row tk-inline"><input id="rs-rotate" type="checkbox"><span>横版页面自动转成横版 A4</span></label>',
      onRun: function () {
        var PDFLib = lib();
        var key = TK.val('#rs-size');
        var autoRotate = TK.checked('#rs-rotate');
        return TK.pickFiles({ filter: TK.FILTER_PDF, multi: false, title: '选择 PDF' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            return loadDoc(files[0]).then(function (doc) {
              var base = SIZES[key] || SIZES.a4;
              var pages = doc.getPages();
              pages.forEach(function (pg) {
                var w = pg.getWidth(), h = pg.getHeight();
                var target = base.slice();
                if (autoRotate && w > h) target = [base[1], base[0]];
                var s = Math.min(target[0] / w, target[1] / h);
                pg.scaleContent(s, s);
                pg.translateContent((target[0] - w * s) / 2, (target[1] - h * s) / 2);
                pg.setSize(target[0], target[1]);
              });
              return doc.save();
            }).then(function (bytes) {
              return savePdf(bytes, TK.stripExt(TK.baseName(files[0])) + '_' + key.toUpperCase() + '.pdf');
            }).then(function (p) { TK.resultBox([p], '已统一为 ' + key.toUpperCase()); });
          });
      }
    });
  }

  window.WTA_PDF = {
    'pdf-merge': merge,
    'pdf-split': split,
    'pdf-page-manage': pageManage,
    'pdf-watermark-add': watermark,
    'pdf-resize': resize
  };
})();
