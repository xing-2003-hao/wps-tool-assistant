/* ============================================================
 * WPS 工具助手 · PDF 转换工具（依赖 pdftext.js + ooxml.js）
 *   pdf-to-word           提取文字 → .docx（自动识别标题/项目符号）
 *   pdf-to-excel          按坐标还原表格 → .xlsx
 *   pdf-to-ppt            每页一张幻灯片 → .pptx
 *   pdf-to-md             标题层级 + 列表 → .md
 *   pdf-watermark-remove  文字水印剔除（内容流删除 / 白色遮盖）
 * ============================================================ */
(function () {
  'use strict';

  function lib() {
    if (!window.PDFLib) throw new Error('PDF 引擎未加载（vendor/pdf-lib.min.js 缺失）');
    if (!window.PDFTEXT) throw new Error('PDF 文本引擎未加载（pdftext.js 缺失）');
    if (!window.OOXML) throw new Error('文档生成引擎未加载（ooxml.js 缺失）');
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

  function readPdf(path) {
    return TK.readFile(path).then(blobToArrayBuffer).then(function (buf) {
      var head = new Uint8Array(buf, 0, Math.min(5, buf.byteLength));
      var sig = String.fromCharCode.apply(null, head);
      if (sig.indexOf('%PDF') !== 0) throw new Error('不是有效的 PDF：' + TK.baseName(path));
      return buf;
    });
  }

  function pickOne(title) {
    return TK.pickFiles({ filter: TK.FILTER_PDF, multi: false, title: title || '选择 PDF' })
      .then(function (files) {
        if (!files.length) throw new Error('__cancel__');
        return files[0];
      });
  }

  function stamp() {
    var d = new Date();
    function p2(n) { return n < 10 ? '0' + n : '' + n; }
    return p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  }

  function saveBytes(bytes, name, mime) {
    return TK.save(new Blob([bytes], { type: mime }), name);
  }

  function progress(i, n) { TK.msg('正在解析 PDF：第 ' + i + ' / ' + n + ' 页'); }

  function guardCancel(e) {
    if (String(e && e.message) === '__cancel__') { TK.msg('已取消'); return true; }
    return false;
  }

  /* ==================== 排版启发式 ==================== */
  function medianSize(pages) {
    var sizes = [];
    pages.forEach(function (p) {
      p.lines.forEach(function (l) {
        for (var i = 0; i < Math.min(30, l.text.length); i++) sizes.push(l.size);
      });
    });
    if (!sizes.length) return 10;
    sizes.sort(function (a, b) { return a - b; });
    return sizes[Math.floor(sizes.length / 2)] || 10;
  }

  var BULLET_RE = /^[\u00b7\u2022\u25aa\u25cf\u25cb\u25a0\u25a1\u25c6\u25c7\-–—*·]\s*|^\d{1,2}[、.．)]\s*|^[（(]\d{1,2}[）)]\s*/;

  function classify(line, base, prevSize) {
    var size = line.size || base;
    var ratio = size / (base || 10);
    if (ratio >= 1.45 && line.text.length <= 40) return 'h1';
    if (ratio >= 1.18 && line.text.length <= 60) return 'h2';
    if (BULLET_RE.test(line.text)) return 'li';
    return 'p';
  }

  function cleanLine(text) {
    return String(text).replace(/\s+/g, ' ').trim();
  }

  /* ==================== 1. PDF → Word ==================== */
  function toWord() {
    TK.modal({
      title: '📝 PDF 转 Word',
      hint: '按原文的行结构还原成 .docx：字号大的自动识别为标题，带符号的行识别为项目符号。扫描件（纯图片）无法提取文字。',
      runLabel: '开始转换',
      body:
        '<label class="tk-row tk-inline"><input id="pw-pagebreak" type="checkbox" checked><span>PDF 每页之间插入分页符</span></label>' +
        '<label class="tk-row tk-inline"><input id="pw-heading" type="checkbox" checked><span>按字号自动识别标题层级</span></label>' +
        '<p class="tk-hint">提示：复杂排版（多栏、表格、图片）只能尽量还原文字顺序，表格请用「PDF 转 Excel」。</p>',
      onRun: function () {
        lib();
        var outName = '';
        return pickOne('选择要转换的 PDF').then(function (path) {
          outName = TK.stripExt(TK.baseName(path)) + '.docx';
          return readPdf(path);
        }).then(function (buf) {
          return PDFTEXT.extract(buf, progress);
        }).then(function (res) {
          if (!res.pages.length) throw new Error('PDF 没有页面');
          var total = res.pages.reduce(function (n, p) { return n + p.lines.length; }, 0);
          if (!total) throw new Error('没有提取到文字（可能是扫描件/图片型 PDF），请先用 OCR 工具处理');
          var base = medianSize(res.pages);
          var useHeading = TK.checked('#pw-heading');
          var pageBreak = TK.checked('#pw-pagebreak');
          var blocks = [];
          res.pages.forEach(function (p, pi) {
            if (pi > 0 && pageBreak) blocks.push({ type: 'pagebreak' });
            p.lines.forEach(function (l) {
              var text = cleanLine(l.text);
              if (!text) return;
              var type = useHeading ? classify(l, base) : 'p';
              if (type === 'li') text = text.replace(BULLET_RE, '');
              blocks.push({ type: type, text: text });
            });
          });
          var bytes = OOXML.docx(blocks);
          return saveBytes(bytes, outName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            .then(function (p) {
              TK.resultBox([p], res.pages.length + ' 页 → ' + blocks.length + ' 个段落' +
                (res.warnings.length ? '（' + res.warnings.join('；') + '）' : ''));
            });
        }).catch(function (e) { if (!guardCancel(e)) throw e; });
      }
    });
  }

  /* ==================== 2. PDF → Markdown ==================== */
  function toMd() {
    TK.modal({
      title: '📋 PDF 转 Markdown',
      hint: '输出带标题层级与列表的 .md，适合导入知识库 / 笔记软件。',
      runLabel: '开始转换',
      body:
        '<label class="tk-row tk-inline"><input id="pm-addpage" type="checkbox"><span>保留分页标记（&lt;!-- page N --&gt;）</span></label>' +
        '<label class="tk-row tk-inline"><input id="pm-title" type="text" placeholder="（可选）文档一级标题"></label>',
      onRun: function () {
        lib();
        var outName = '';
        return pickOne('选择要转换的 PDF').then(function (path) {
          outName = TK.stripExt(TK.baseName(path)) + '.md';
          return readPdf(path);
        }).then(function (buf) {
          return PDFTEXT.extract(buf, progress);
        }).then(function (res) {
          var base = medianSize(res.pages);
          var keepPage = TK.checked('#pm-addpage');
          var title = TK.val('#pm-title');
          var md = [];
          if (title && title.trim()) md.push('# ' + title.trim(), '');

          res.pages.forEach(function (p, pi) {
            if (keepPage) md.push('<!-- page ' + (pi + 1) + ' -->', '');
            var para = '';

            function flush() {
              if (para) { md.push(para, ''); para = ''; }
            }

            p.lines.forEach(function (l) {
              var text = cleanLine(l.text);
              if (!text) return;
              var type = classify(l, base);
              if (type === 'h1') { flush(); md.push('## ' + text, ''); }
              else if (type === 'h2') { flush(); md.push('### ' + text, ''); }
              else if (type === 'li') { flush(); md.push('- ' + text.replace(BULLET_RE, '')); }
              else {
                if (!para) para = text;
                else if (/[。！？；：.!?;:]$/.test(para)) { flush(); para = text; }
                else {
                  var cjk = /[\u4e00-\u9fff\uff00-\uffef]$/.test(para) && /^[\u4e00-\u9fff\uff00-\uffef]/.test(text);
                  para += (cjk ? '' : ' ') + text;
                }
              }
            });
            flush();
            md.push('');
          });
          var text = md.join('\n').replace(/\n{4,}/g, '\n\n\n');
          return TK.save(new Blob([text], { type: 'text/markdown;charset=utf-8' }), outName)
            .then(function (p) {
              TK.resultBox([p], '共 ' + res.pages.length + ' 页，' + text.length + ' 字符');
            });
        }).catch(function (e) { if (!guardCancel(e)) throw e; });
      }
    });
  }

  /* ==================== 3. PDF → Excel ==================== */
  // 用文字片段的 x/y 聚类还原行列
  function pageToRows(page) {
    var items = page.items.filter(function (it) { return it.text && it.text.trim(); });
    if (!items.length) return [];
    var heights = items.map(function (i) { return i.size; }).sort(function (a, b) { return a - b; });
    var h = heights[Math.floor(heights.length / 2)] || 10;

    // 1) 按 y 聚成行
    var sorted = items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var rows = [];
    var cur = null;
    var rowTol = Math.max(2.5, h * 0.55);
    sorted.forEach(function (it) {
      if (!cur || Math.abs(cur.y - it.y) > rowTol) {
        cur = { y: it.y, items: [it] };
        rows.push(cur);
      } else cur.items.push(it);
    });

    // 2) 行内把相邻字符合并成"单元格文本"（PDF 常按单字绘制，不合并会变成「A I A g e n t」）
    rows.forEach(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      var runs = [];
      var run = null;
      r.items.forEach(function (it) {
        if (!run) { run = { x: it.x, text: it.text, end: it.x + (it.w || 0), size: it.size }; return; }
        var gap = it.x - run.end;
        var cjk = /[\u3000-\u9fff\uff00-\uffef]$/.test(run.text) || /^[\u3000-\u9fff\uff00-\uffef]/.test(it.text);
        if (gap > Math.max(2.2, run.size * (cjk ? 1.1 : 0.45))) {
          runs.push(run);
          run = { x: it.x, text: it.text, end: it.x + (it.w || 0), size: it.size };
        } else {
          run.text += (gap > run.size * 0.28 && !cjk ? ' ' : '') + it.text;
          run.end = it.x + (it.w || 0);
          run.size = Math.max(run.size, it.size);
        }
      });
      if (run) runs.push(run);
      r.runs = runs;
      r.y = r.items[0].y;
    });
    rows.sort(function (a, b) { return b.y - a.y; });

    // 3) 列聚类：用 run 的起始 x，只保留在多行里反复出现的位置
    function singleColumn() {
      return rows.map(function (r) {
        return [r.runs.map(function (run) { return run.text; }).join('  ')];
      });
    }
    var totalRuns = 0;
    rows.forEach(function (r) { totalRuns += r.runs.length; });
    // 平均每行不到 2 段 → 更像普通段落，不是表格
    if (rows.length < 2 || totalRuns / rows.length < 2) return singleColumn();

    var xs = [];
    rows.forEach(function (r) { r.runs.forEach(function (run) { xs.push(run.x); }); });
    xs.sort(function (a, b) { return a - b; });
    var tol = Math.max(7, h * 1.2);
    var groups = [];
    xs.forEach(function (x) {
      var g = groups[groups.length - 1];
      if (!g || x - g.last > tol) groups.push({ x: x, last: x, n: 1 });
      else { g.x = (g.x * g.n + x) / (g.n + 1); g.n++; g.last = x; }
    });
    // 只保留「每 4 行至少出现 1 次」的列位置，过滤居中标题之类的孤立 x
    var minCount = Math.max(2, Math.round(rows.length * 0.25));
    var cols = groups.filter(function (g) { return g.n >= minCount; }).map(function (g) { return g.x; });
    if (cols.length < 2) return singleColumn();
    if (cols.length > 30) return singleColumn();

    return rows.map(function (r) {
      var cells = new Array(cols.length);
      r.runs.forEach(function (run) {
        var best = 0, bestD = Infinity;
        for (var i = 0; i < cols.length; i++) {
          var d = Math.abs(run.x - cols[i]);
          if (d < bestD) { bestD = d; best = i; }
        }
        cells[best] = cells[best] ? (cells[best] + '  ' + run.text) : run.text;
      });
      for (var i2 = 0; i2 < cells.length; i2++) if (!cells[i2]) cells[i2] = '';
      return cells;
    });
  }

  function toExcel() {
    TK.modal({
      title: '📊 PDF 转 Excel',
      hint: '按文字在页面上的坐标还原成行列（适合有表格线/对齐整齐的 PDF）。多栏排版的 PDF 效果会差一些。',
      runLabel: '开始转换',
      body:
        '<label class="tk-row tk-inline"><input id="pe-csv" type="checkbox"><span>同时导出一份 CSV（便于检查）</span></label>' +
        '<label class="tk-row tk-inline"><input id="pe-sep" type="checkbox" checked><span>不同页之间插入分隔行</span></label>',
      onRun: function () {
        lib();
        var outName = '';
        return pickOne('选择要转换的 PDF').then(function (path) {
          outName = TK.stripExt(TK.baseName(path)) + '.xlsx';
          return readPdf(path);
        }).then(function (buf) {
          return PDFTEXT.extract(buf, progress);
        }).then(function (res) {
          var sep = TK.checked('#pe-sep');
          var all = [];
          var total = 0;
          res.pages.forEach(function (p, pi) {
            var rows = pageToRows(p);
            if (!rows.length) return;
            total += rows.length;
            if (sep && all.length) all.push(['— 第 ' + (pi + 1) + ' 页 —']);
            all = all.concat(rows);
          });
          if (!all.length) throw new Error('没有提取到表格内容（可能是扫描件，或文字是曲线/图片）');
          // 列数对齐
          var maxCols = 0;
          all.forEach(function (r) { maxCols = Math.max(maxCols, r.length); });
          all.forEach(function (r) { while (r.length < maxCols) r.push(''); });
          var bytes = OOXML.xlsx(all, { sheet: 'PDF 转换' });
          return saveBytes(bytes, outName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .then(function (p) {
              if (!TK.checked('#pe-csv')) { TK.resultBox([p], total + ' 行 × ' + maxCols + ' 列'); return; }
              var csv = all.map(function (r) {
                return r.map(function (c) {
                  var s = String(c === undefined ? '' : c);
                  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
                }).join(',');
              }).join('\r\n');
              return TK.save(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }),
                TK.stripExt(TK.baseName(outName)) + '.csv').then(function (p2) {
                  TK.resultBox([p, p2], total + ' 行 × ' + maxCols + ' 列');
                });
            });
        }).catch(function (e) { if (!guardCancel(e)) throw e; });
      }
    });
  }

  /* ==================== 4. PDF → PPT ==================== */
  function toPpt() {
    TK.modal({
      title: '📽️ PDF 转 PPT',
      hint: '把每一页的文字转成一页幻灯片（16:9），字号按原文行数自动适配。适合把 PDF 报告快速变成可编辑大纲。',
      runLabel: '开始转换',
      body:
        '<label class="tk-row"><span>每页最多几行</span><input id="pp-max" type="number" value="12" min="3" max="30"></label>' +
        '<label class="tk-row"><span>正文字号(pt)</span><input id="pp-size" type="number" value="16" min="10" max="28"></label>' +
        '<label class="tk-row tk-inline"><input id="pp-title" type="checkbox" checked><span>用每页第一行作为标题</span></label>' +
        '<p class="tk-hint">说明：PDF→PPT 为「文字版」，不保留原图的图片与排版；如需完全一致，请把 PDF 每页截图后插入。</p>',
      onRun: function () {
        lib();
        var outName = '';
        return pickOne('选择要转换的 PDF').then(function (path) {
          outName = TK.stripExt(TK.baseName(path)) + '.pptx';
          return readPdf(path);
        }).then(function (buf) {
          return PDFTEXT.extract(buf, progress);
        }).then(function (res) {
          var maxLines = Math.max(3, TK.num('#pp-max', 12));
          var fontSize = TK.num('#pp-size', 16);
          var useTitle = TK.checked('#pp-title');
          var slides = res.pages.map(function (p, i) {
            var lines = p.lines.map(function (l) { return cleanLine(l.text); }).filter(Boolean);
            var title = '第 ' + (i + 1) + ' 页';
            if (useTitle && lines.length) {
              title = lines[0].slice(0, 60);
              lines = lines.slice(1);
            }
            if (lines.length > maxLines) {
              lines = lines.slice(0, maxLines);
              lines.push('…（本页还有更多内容，已省略）');
            }
            return { title: title, lines: lines, fontSize: lines.length > 10 ? Math.max(11, fontSize - 3) : fontSize };
          });
          var bytes = OOXML.pptx(slides);
          return saveBytes(bytes, outName, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
            .then(function (p) {
              TK.resultBox([p], '生成 ' + slides.length + ' 页幻灯片');
            });
        }).catch(function (e) { if (!guardCancel(e)) throw e; });
      }
    });
  }

  /* ==================== 5. PDF 去水印 ==================== */
  // 自动猜水印文字：跨页重复出现的短行
  function guessWatermark(res) {
    var counter = {};
    res.pages.forEach(function (p) {
      var seen = {};
      p.lines.forEach(function (l) {
        var t = cleanLine(l.text);
        if (t.length < 3 || t.length > 40) return;
        if (seen[t]) return;
        seen[t] = 1;
        counter[t] = (counter[t] || 0) + 1;
      });
    });
    var best = '', bestN = 0;
    var pages = res.pages.length || 1;
    for (var t in counter) {
      // 只出现一两次的不算
      if (counter[t] > bestN && counter[t] >= Math.max(2, Math.ceil(pages * 0.5))) { best = t; bestN = counter[t]; }
    }
    return { text: best, count: bestN, pages: pages };
  }

  function wmRemove() {
    TK.modal({
      title: '🧽 移除 PDF 水印',
      hint: '两种方式：① 内容流剔除——把水印文字的绘制指令从页面里删掉（推荐，正文不受影响）；② 白色遮盖——在水印位置盖白块（水印压在正文上时会挡字）。',
      runLabel: '开始处理',
      body:
        '<label class="tk-row"><span>水印文字</span><input id="pr-text" type="text" placeholder="留空 = 自动检测"></label>' +
        '<label class="tk-row"><span>处理方式</span><select id="pr-mode">' +
        '<option value="strip">内容流剔除（推荐）</option>' +
        '<option value="cover">白色遮盖</option>' +
        '</select></label>' +
        '<p class="tk-hint">图片型水印（比如 logo、印章）无法用内容流剔除，只能遮盖。加密 PDF 请先解除密码。</p>',
      onMount: function () {
        // 自动检测：让用户先选文件有点打断流程，这里只做提示
      },
      onRun: function () {
        lib();
        var L = lib();
        var kwInput = (TK.val('#pr-text') || '').trim();
        var mode = TK.val('#pr-mode');
        var outName = '', srcPath = '';
        return pickOne('选择要去水印的 PDF').then(function (path) {
          srcPath = path;
          outName = TK.stripExt(TK.baseName(path)) + '_去水印.pdf';
          return readPdf(path);
        }).then(function (buf) {
          return PDFTEXT.extract(buf, progress).then(function (res) {
            var kw = kwInput;
            var auto = null;
            if (!kw) {
              auto = guessWatermark(res);
              kw = auto.text;
              if (!kw) throw new Error('没能自动识别水印文字，请手动填写水印内容（比如「仅供内部使用」）');
              TK.msg('自动识别到水印：「' + kw + '」（' + auto.count + '/' + auto.pages + ' 页重复出现），正在处理…');
            }
            return L.PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false }).then(function (doc) {
              if (mode === 'strip') {
                return PDFTEXT.removeWatermark(doc, kw, function (i, n) {
                  TK.msg('正在剔除水印：第 ' + i + ' / ' + n + ' 页');
                }).then(function (stat) {
                  if (!stat.removedBlocks && !stat.blanked) {
                    throw new Error('没有找到可删除的水印绘制指令（水印可能是图片）。建议改用「白色遮盖」');
                  }
                  return doc.save({ useObjectStreams: false }).then(function (bytes) {
                    return saveBytes(bytes, outName, 'application/pdf').then(function (p) {
                      TK.resultBox([p], '剔除 ' + stat.removedBlocks + ' 个水印文本块' +
                        (stat.blanked ? '、清空 ' + stat.blanked + ' 处水印文字' : ''));
                    });
                  });
                });
              }
              // 遮盖模式
              var n = 0;
              doc.getPages().forEach(function (pg, pi) {
                var page = res.pages[pi];
                if (!page) return;
                page.lines.forEach(function (ln) {
                  if (cleanLine(ln.text).indexOf(kw) < 0) return;
                  var x0 = Math.min.apply(null, ln.items.map(function (i) { return i.x; }));
                  var x1 = Math.max.apply(null, ln.items.map(function (i) { return i.x + (i.w || 0); }));
                  var h = ln.size;
                  pg.drawRectangle({
                    x: x0 - 2, y: ln.y - h * 0.25,
                    width: (x1 - x0) + 4, height: h * 1.25,
                    color: L.rgb(1, 1, 1), opacity: 1, borderWidth: 0
                  });
                  n++;
                });
              });
              if (!n) throw new Error('这些页面上没有匹配到「' + kw + '」的文字，无法遮盖');
              return doc.save({ useObjectStreams: false }).then(function (bytes) {
                return saveBytes(bytes, outName, 'application/pdf').then(function (p) {
                  TK.resultBox([p], '遮盖 ' + n + ' 处水印（白色方块）');
                });
              });
            });
          });
        }).catch(function (e) { if (!guardCancel(e)) throw e; });
      }
    });
  }

  /* ==================== Word 转 PDF（WPS 原生导出，版式无损） ==================== */
  // 思路：不自己排版，直接把导出交给 WPS 自己的 PDF 引擎（ExportAsFixedFormat），
  // 字体、页眉页脚、目录、图文混排都和原文档一致；产物落到「下载\WPS工具助手\」。
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function writerApp() {
    var h = window.WTA_HOST ? window.WTA_HOST() : null;
    return (h && h.type === 'wps' && h.app) ? h.app : null;
  }

  // 尝试多种导出写法，兼容不同 WPS 版本
  function exportPdf(doc, outPath) {
    var tries = [
      function () { doc.ExportAsFixedFormat(outPath, 17); },              // wdExportFormatPDF
      function () { doc.ExportAsFixedFormat(outPath, 17, false); },
      function () { doc.ExportAsFixedFormat2(outPath, 17); },
      function () { doc.ExportAsFixedFormat(outPath, 'PDF'); }
    ];
    var lastErr = null;
    for (var i = 0; i < tries.length; i++) {
      try {
        tries[i]();
        return Promise.resolve(true);
      } catch (e) { lastErr = e; }
    }
    // 都不行就退回「另存为 PDF」，但会把文档关联到新文件，所以要立刻还原
    try {
      var before = doc.FullName;
      doc.SaveAs2(outPath, 17);
      try { doc.SaveAs2(before); } catch (e2) {}
      return Promise.resolve(true);
    } catch (e3) { lastErr = e3; }
    return Promise.reject(new Error('当前 WPS 版本不支持脚本导出 PDF：' + ((lastErr && lastErr.message) || lastErr)));
  }

  function verifyPdf(path) {
    return TK.readFile(path).then(function (b) {
      if (!b || b.size < 512) throw new Error('导出的 PDF 是空文件，请改用「文件 → 输出为 PDF」');
      return path;
    });
  }

  function convertOne(doc, outName) {
    return TK.target(outName).then(function (out) {
      return exportPdf(doc, out).then(function () {
        return verifyPdf(out);
      });
    });
  }

  function toPdf() {
    var app = writerApp();
    if (!app) {
      TK.modal({
        title: 'Word 转 PDF', runLabel: '', noRun: true,
        hint: '这个工具在 WPS 表格 / 演示里用不了 —— Word 转 PDF 需要 WPS 文字的排版引擎，请切到 WPS 文字后再点。',
        body: ''
      });
      return;
    }
    var curName = '文档';
    try { curName = app.ActiveDocument.Name || curName; } catch (e) {}

    TK.modal({
      title: 'Word 转 PDF',
      hint: '调用 WPS 自带排版引擎导出，字体 / 页眉页脚 / 图文位置与原文一致，不压缩、不重排。产物存到「下载\\WPS工具助手\\」。',
      body:
        '<div class="tk-row"><label>转换对象</label>' +
        '  <select id="wp-src">' +
        '    <option value="current">当前文档（' + esc(TK.stripExt(curName)) + '）</option>' +
        '    <option value="files">选择文件（可多选 .docx / .doc）</option>' +
        '  </select>' +
        '</div>' +
        '<p class="tk-hint">导出不会修改原文档。</p>',
      runLabel: '开始转换',
      onRun: function () {
        var mode = TK.val('#wp-src') || 'current';
        if (mode === 'current') {
          var doc = app.ActiveDocument;
          var n = TK.stripExt(String(doc.Name || '文档')) + '.pdf';
          return convertOne(doc, n).then(function (p) {
            TK.resultBox([p], '已导出当前文档');
          });
        }
        return TK.pickFiles({ filter: TK.FILTER_DOC, multi: true, title: '选择要转 PDF 的 Word 文档' })
          .then(function (files) {
            if (!files.length) throw new Error('没有选择文件');
            var out = [], failed = [];
            var chain = Promise.resolve();
            files.forEach(function (f) {
              chain = chain.then(function () {
                var base = TK.stripExt(TK.baseName(f)) + '.pdf';
                var d = null;
                try {
                  d = app.Documents.Open(f, false, true); // ConfirmConversions=false, ReadOnly=true
                } catch (e) {
                  failed.push(TK.baseName(f) + '：打开失败');
                  return;
                }
                return convertOne(d, base).then(function (p) {
                  out.push(p);
                  try { d.Close(0); } catch (e) {}
                }, function (e) {
                  failed.push(TK.baseName(f) + '：' + ((e && e.message) || e));
                  try { d.Close(0); } catch (x) {}
                });
              });
            });
            return chain.then(function () {
              if (!out.length) throw new Error(failed.join('；') || '全部转换失败');
              TK.resultBox(out, '成功 ' + out.length + ' 个' + (failed.length ? '，失败 ' + failed.length + ' 个（' + failed.join('；') + '）' : ''));
            });
          });
      }
    });
  }

  window.WTA_PDFX = {
    'word-to-pdf': toPdf,
    'pdf-to-word': toWord,
    'pdf-to-excel': toExcel,
    'pdf-to-ppt': toPpt,
    'pdf-to-md': toMd,
    'pdf-watermark-remove': wmRemove
  };

  // 供自测脚本使用（不影响面板）
  window.WTA_PDFX_INTERNAL = {
    pageToRows: pageToRows,
    classify: classify,
    medianSize: medianSize,
    guessWatermark: guessWatermark,
    cleanLine: cleanLine
  };
})();
