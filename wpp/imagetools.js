/* ============================================================
 * WPS 工具助手 · 图片工具（纯前端 canvas，离线可用）
 *   img-convert        格式转换 / 批量压缩
 *   img-to-pdf         多图合并成 PDF（pdf-lib）
 *   img-watermark-add  文字水印（居中 / 右下 / 平铺）
 *   img-grid           九宫格拼贴 / 切图
 * ============================================================ */
(function () {
  'use strict';

  function blobToArrayBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('读取图片数据失败')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  // 统一转成 JPEG（PDF 里用 DCTDecode，体积小、兼容好）
  function toJpeg(blob, quality, maxEdge) {
    return TK.loadImage(blob).then(function (o) {
      var img = o.img;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (maxEdge && Math.max(w, h) > maxEdge) {
        var s = maxEdge / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';       // 透明区域铺白，避免 PDF 里发黑
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(o.url);
      return TK.canvasToBlob(cv, 'image/jpeg', quality).then(function (b) {
        return { blob: b, w: w, h: h };
      });
    });
  }

  function redraw(blob, draw, opts) {
    opts = opts || {};
    return TK.loadImage(blob).then(function (o) {
      var img = o.img;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      if (opts.whiteBg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      draw(ctx, w, h);
      URL.revokeObjectURL(o.url);
      return TK.canvasToBlob(cv, opts.type || 'image/jpeg', opts.quality || 0.92);
    });
  }

  /* ==================== 1. 转换 / 压缩 ==================== */
  function convert() {
    TK.modal({
      title: '🖼️ 图片转换 / 压缩',
      hint: '选择图片后可统一转格式、压缩体积、限制最大边长。产物保存到「下载\\WPS工具助手」。',
      runLabel: '开始转换',
      body:
        '<label class="tk-row"><span>输出格式</span><select id="cv-fmt">' +
        '<option value="image/jpeg">JPG（体积小，推荐）</option>' +
        '<option value="image/webp">WebP（更小，新版 WPS 支持）</option>' +
        '<option value="image/png">PNG（无损，体积大）</option>' +
        '</select></label>' +
        '<label class="tk-row"><span>压缩质量</span><input id="cv-q" type="range" min="30" max="100" value="82"><b id="cv-qv">82</b></label>' +
        '<label class="tk-row"><span>最大边长(px)</span><input id="cv-max" type="number" value="1920" min="0" step="100"><em>0 = 保持原始尺寸</em></label>',
      onMount: function () {
        var q = document.getElementById('cv-q');
        q.oninput = function () { document.getElementById('cv-qv').textContent = q.value; };
      },
      onRun: function () {
        var fmt = TK.val('#cv-fmt');
        var q = TK.num('#cv-q', 82) / 100;
        var maxEdge = TK.num('#cv-max', 0);
        return TK.pickFiles({ filter: TK.FILTER_IMG, multi: true, title: '选择要转换的图片（可多选）' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            var out = [];
            var seq = files.reduce(function (p, f) {
              return p.then(function () {
                return TK.readFile(f).then(function (blob) {
                  return TK.loadImage(blob).then(function (o) {
                    var w = o.img.naturalWidth || o.img.width;
                    var h = o.img.naturalHeight || o.img.height;
                    var sc = (maxEdge && Math.max(w, h) > maxEdge) ? maxEdge / Math.max(w, h) : 1;
                    var cv = document.createElement('canvas');
                    cv.width = Math.max(1, Math.round(w * sc));
                    cv.height = Math.max(1, Math.round(h * sc));
                    var ctx = cv.getContext('2d');
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, cv.width, cv.height);
                    ctx.drawImage(o.img, 0, 0, cv.width, cv.height);
                    URL.revokeObjectURL(o.url);
                    return TK.canvasToBlob(cv, fmt, q);
                  }).then(function (b) {
                    var ext = fmt === 'image/png' ? '.png' : fmt === 'image/webp' ? '.webp' : '.jpg';
                    var name = TK.stripExt(TK.baseName(f)) + '_' + Math.round(b.size / 1024) + 'k' + ext;
                    return TK.save(b, name);
                  }).then(function (p) { out.push(p); TK.msg('已处理 ' + out.length + ' / ' + files.length); });
                });
              });
            }, Promise.resolve());
            return seq.then(function () { TK.resultBox(out, '共 ' + out.length + ' 张'); });
          });
      }
    });
  }

  /* ==================== 2. 图片转 PDF ==================== */
  function toPdf() {
    if (!window.PDFLib) { TK.modal({ title: '图片转 PDF', noRun: true, body: '<p class="tk-hint">PDF 引擎未加载，请确认加载项文件完整。</p>' }); return; }
    TK.modal({
      title: '📄 图片转 PDF',
      hint: '按选择顺序（可用文件名前缀 01- 02- 控制）合并为一份 PDF。',
      runLabel: '生成 PDF',
      body:
        '<label class="tk-row"><span>页面尺寸</span><select id="pd-size">' +
        '<option value="a4">A4 纵向</option>' +
        '<option value="a4l">A4 横向</option>' +
        '<option value="auto">跟随图片（无边）</option>' +
        '</select></label>' +
        '<label class="tk-row"><span>页边距(mm)</span><input id="pd-margin" type="number" value="10" min="0" max="50"></label>' +
        '<label class="tk-row"><span>图片质量</span><input id="pd-q" type="range" min="50" max="100" value="88"><b id="pd-qv">88</b></label>' +
        '<label class="tk-row tk-inline"><input id="pd-fit" type="checkbox" checked><span>等比缩放，完整显示（不裁切）</span></label>',
      onMount: function () {
        var q = document.getElementById('pd-q');
        q.oninput = function () { document.getElementById('pd-qv').textContent = q.value; };
      },
      onRun: function () {
        var size = TK.val('#pd-size');
        var margin = TK.num('#pd-margin', 10) * 2.8346;
        var q = TK.num('#pd-q', 88) / 100;
        return TK.pickFiles({ filter: TK.FILTER_IMG, multi: true, title: '选择图片（可多选，按顺序合并）' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            var PDFDocument = window.PDFLib.PDFDocument;
            return PDFDocument.create().then(function (doc) {
              var seq = files.reduce(function (p, f) {
                return p.then(function () {
                  return TK.readFile(f)
                    .then(function (b) { return toJpeg(b, q, 2400); })
                    .then(function (j) {
                      return blobToArrayBuffer(j.blob).then(function (buf) {
                        return doc.embedJpg(buf).then(function (img) {
                          var pw, ph;
                          if (size === 'a4') { pw = 595.28; ph = 841.89; }
                          else if (size === 'a4l') { pw = 841.89; ph = 595.28; }
                          else { pw = img.width + margin * 2; ph = img.height + margin * 2; margin = 0; }
                          var page = doc.addPage([pw, ph]);
                          var bw = pw - margin * 2, bh = ph - margin * 2;
                          var s = Math.min(bw / img.width, bh / img.height);
                          var dw = img.width * s, dh = img.height * s;
                          page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
                          TK.msg('已排版 ' + doc.getPageCount() + ' / ' + files.length + ' 页');
                        });
                      });
                    });
                });
              }, Promise.resolve());
              return seq.then(function () {
                return doc.save().then(function (bytes) {
                  var blob = new Blob([bytes], { type: 'application/pdf' });
                  var name = '图片转PDF_' + stamp() + '.pdf';
                  return TK.save(blob, name).then(function (p) { TK.resultBox([p], '共 ' + doc.getPageCount() + ' 页'); });
                });
              });
            });
          });
      }
    });
  }

  /* ==================== 3. 加水印 ==================== */
  function watermark() {
    TK.modal({
      title: '💧 图片加水印',
      hint: '文字水印，支持居中、右下角、全图平铺三种排布。',
      runLabel: '添加水印',
      body:
        '<label class="tk-row"><span>水印文字</span><input id="wm-text" type="text" value="仅供内部使用" maxlength="40"></label>' +
        '<label class="tk-row"><span>位置</span><select id="wm-pos">' +
        '<option value="tile">全图平铺</option>' +
        '<option value="center">居中</option>' +
        '<option value="br">右下角</option>' +
        '</select></label>' +
        '<label class="tk-row"><span>不透明度</span><input id="wm-op" type="range" min="5" max="100" value="22"><b id="wm-opv">22%</b></label>' +
        '<label class="tk-row"><span>字号(占宽%)</span><input id="wm-size" type="number" value="6" min="1" max="30"><em>按图片宽度百分比</em></label>' +
        '<label class="tk-row"><span>颜色</span><input id="wm-color" type="color" value="#9e9e9e"></label>',
      onMount: function () {
        var op = document.getElementById('wm-op');
        op.oninput = function () { document.getElementById('wm-opv').textContent = op.value + '%'; };
      },
      onRun: function () {
        var text = TK.val('#wm-text') || '水印';
        var pos = TK.val('#wm-pos');
        var alpha = TK.num('#wm-op', 22) / 100;
        var pct = TK.num('#wm-size', 6) / 100;
        var color = TK.val('#wm-color') || '#9e9e9e';
        var fmt = 'image/jpeg';
        return TK.pickFiles({ filter: TK.FILTER_IMG, multi: true, title: '选择要加水印的图片（可多选）' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            var out = [];
            var seq = files.reduce(function (p, f) {
              return p.then(function () {
                return TK.readFile(f).then(function (blob) {
                  return redraw(blob, function (ctx, w, h) {
                    var fs = Math.max(10, Math.round(w * pct));
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = color;
                    ctx.font = 'bold ' + fs + 'px "Microsoft YaHei", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    if (pos === 'center') {
                      ctx.translate(w / 2, h / 2);
                      ctx.rotate(-Math.PI / 9);
                      ctx.fillText(text, 0, 0);
                    } else if (pos === 'br') {
                      ctx.textAlign = 'right';
                      ctx.textBaseline = 'bottom';
                      ctx.fillText(text, w - fs * 0.6, h - fs * 0.6);
                    } else {
                      ctx.rotate(-Math.PI / 9);
                      var stepX = fs * (text.length + 3), stepY = fs * 3.2;
                      var diag = Math.sqrt(w * w + h * h);
                      for (var y = -diag; y < diag; y += stepY) {
                        for (var x = -diag; x < diag; x += stepX) ctx.fillText(text, x, y);
                      }
                    }
                    ctx.restore();
                  }, { type: fmt, quality: 0.92, whiteBg: true });
                }).then(function (b) {
                  return TK.save(b, TK.stripExt(TK.baseName(f)) + '_水印.jpg');
                }).then(function (p) { out.push(p); TK.msg('已处理 ' + out.length + ' / ' + files.length); });
              });
            }, Promise.resolve());
            return seq.then(function () { TK.resultBox(out, '共 ' + out.length + ' 张'); });
          });
      }
    });
  }

  /* ==================== 4. 九宫格 ==================== */
  function grid() {
    TK.modal({
      title: '🔲 图片九宫格',
      hint: '拼接：多张图拼成网格；切图：一张图等分成 N×N 小块（发朋友圈常用）。',
      runLabel: '开始处理',
      body:
        '<label class="tk-row"><span>处理方式</span><select id="gd-mode">' +
        '<option value="join">拼接（多图 → 一张）</option>' +
        '<option value="split">切图（一张 → N 份）</option>' +
        '</select></label>' +
        '<label class="tk-row"><span>每行张数</span><input id="gd-cols" type="number" value="3" min="1" max="12"></label>' +
        '<label class="tk-row"><span>间隔(px)</span><input id="gd-gap" type="number" value="8" min="0" max="100"></label>' +
        '<label class="tk-row"><span>背景色</span><input id="gd-bg" type="color" value="#ffffff"></label>',
      onRun: function () {
        var mode = TK.val('#gd-mode');
        var cols = Math.max(1, TK.num('#gd-cols', 3));
        var gap = Math.max(0, TK.num('#gd-gap', 8));
        var bg = TK.val('#gd-bg') || '#ffffff';

        if (mode === 'split') {
          return TK.pickFiles({ filter: TK.FILTER_IMG, multi: false, title: '选择要切图的图片' })
            .then(function (files) {
              if (!files.length) { TK.msg('已取消'); return; }
              return TK.readFile(files[0]).then(function (blob) {
                return TK.loadImage(blob).then(function (o) {
                  var img = o.img;
                  var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
                  // 先按最大正方形居中裁切，保证切出来的每块都是正方形
                  var side = Math.min(W, H);
                  var sx = (W - side) / 2, sy = (H - side) / 2;
                  var cell = Math.floor(side / cols);
                  var out = [];
                  var seq = Promise.resolve();
                  for (var r = 0; r < cols; r++) {
                    for (var c = 0; c < cols; c++) {
                      (function (r, c) {
                        seq = seq.then(function () {
                          var cv = document.createElement('canvas');
                          cv.width = cell; cv.height = cell;
                          cv.getContext('2d').drawImage(img, sx + c * cell, sy + r * cell, cell, cell, 0, 0, cell, cell);
                          return TK.canvasToBlob(cv, 'image/jpeg', 0.95).then(function (b) {
                            return TK.save(b, TK.stripExt(TK.baseName(files[0])) + '_' + (r + 1) + '-' + (c + 1) + '.jpg');
                          }).then(function (p) {
                            out.push(p);
                            TK.msg('已切出 ' + out.length + ' / ' + (cols * cols) + ' 块');
                          });
                        });
                      })(r, c);
                    }
                  }
                  return seq.then(function () {
                    URL.revokeObjectURL(o.url);
                    TK.resultBox(out, '按 ' + cols + '×' + cols + ' 等分');
                  });
                });
              });
            });
        }

        return TK.pickFiles({ filter: TK.FILTER_IMG, multi: true, title: '选择要拼接的图片（可多选）' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            return Promise.all(files.map(function (f) {
              return TK.readFile(f).then(function (b) { return TK.loadImage(b); });
            })).then(function (list) {
              // 统一单格边长 = 图片中的最大边长，避免拉伸变形
              var cell = 600;
              list.forEach(function (o) {
                cell = Math.max(cell, Math.min(o.img.naturalWidth || o.img.width, o.img.naturalHeight || o.img.height));
              });
              cell = Math.min(cell, 1200);
              var rows = Math.ceil(list.length / cols);
              var cv = document.createElement('canvas');
              cv.width = cols * cell + (cols + 1) * gap;
              cv.height = rows * cell + (rows + 1) * gap;
              var ctx = cv.getContext('2d');
              ctx.fillStyle = bg;
              ctx.fillRect(0, 0, cv.width, cv.height);
              list.forEach(function (o, i) {
                var r = Math.floor(i / cols), c = i % cols;
                var w = o.img.naturalWidth || o.img.width, h = o.img.naturalHeight || o.img.height;
                var s = Math.min(cell / w, cell / h);
                var dw = w * s, dh = h * s;
                var x = gap + c * (cell + gap) + (cell - dw) / 2;
                var y = gap + r * (cell + gap) + (cell - dh) / 2;
                ctx.drawImage(o.img, x, y, dw, dh);
                URL.revokeObjectURL(o.url);
              });
              return TK.canvasToBlob(cv, 'image/jpeg', 0.95).then(function (b) {
                return TK.save(b, '九宫格_' + stamp() + '.jpg');
              }).then(function (p) { TK.resultBox([p], list.length + ' 张拼成 ' + cols + ' 列'); });
            });
          });
      }
    });
  }

  /* ==================== 5. 图片去水印 ==================== */
  // 本地修复：拉普拉斯扩散（平滑背景）/ 邻域纹理克隆（有纹理背景）
  function repairRegion(data, W, H, rect, mode, iterations) {
    var x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
    var x1 = Math.min(W - 1, Math.round(rect.x + rect.w)), y1 = Math.min(H - 1, Math.round(rect.y + rect.h));
    if (x1 - x0 < 2 || y1 - y0 < 2) throw new Error('框选区域太小');

    var pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.4) + 10;
    var bx0 = Math.max(0, x0 - pad), by0 = Math.max(0, y0 - pad);
    var bx1 = Math.min(W - 1, x1 + pad), by1 = Math.min(H - 1, y1 + pad);
    var bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, N = bw * bh;

    var mask = new Uint8Array(N);
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) mask[(y - by0) * bw + (x - bx0)] = 1;
    }

    // 取三个通道
    var chans = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
    for (var yy = 0; yy < bh; yy++) {
      for (var xx = 0; xx < bw; xx++) {
        var si = ((by0 + yy) * W + (bx0 + xx)) * 4;
        var di = yy * bw + xx;
        chans[0][di] = data[si]; chans[1][di] = data[si + 1]; chans[2][di] = data[si + 2];
      }
    }

    // 周边已知像素的均值 / 方差
    var cnt = 0, sum = [0, 0, 0], sum2 = [0, 0, 0];
    for (var i2 = 0; i2 < N; i2++) {
      if (mask[i2]) continue;
      // 只统计紧邻修复区的环带
      for (var c = 0; c < 3; c++) { sum[c] += chans[c][i2]; sum2[c] += chans[c][i2] * chans[c][i2]; }
      cnt++;
    }
    if (!cnt) throw new Error('框选区域覆盖了整张图，请留出周边背景');
    var mean = [sum[0] / cnt, sum[1] / cnt, sum[2] / cnt];
    var sd = [0, 1, 2].map(function (c) {
      var v = sum2[c] / cnt - mean[c] * mean[c];
      return v > 0 ? Math.sqrt(v) : 0;
    });

    if (mode === 'texture') {
      // 找一个与环带最匹配的平移量，把附近的纹理克隆过来
      var best = null, bestScore = Infinity;
      var cands = [];
      var rw = x1 - x0, rh = y1 - y0;
      for (var k = 1; k <= 8; k++) {
        cands.push([0, -(rh + 8) * k], [0, (rh + 8) * k], [-(rw + 8) * k, 0], [(rw + 8) * k, 0]);
      }
      cands.forEach(function (d) {
        var ox = Math.round(d[0]), oy = Math.round(d[1]);
        if (x0 + ox < bx0 || x1 + ox > bx1 || y0 + oy < by0 || y1 + oy > by1) return;
        var score = 0, n = 0;
        // 用修复区外一圈做匹配
        for (var y2 = -3; y2 <= rh + 3; y2 += 2) {
          for (var x2 = -3; x2 <= rw + 3; x2 += 2) {
            var px = x0 + x2, py = y0 + y2;
            if (px < bx0 || py < by0 || px > bx1 || py > by1) continue;
            var sx = px + ox, sy = py + oy;
            if (sx < bx0 || sy < by0 || sx > bx1 || sy > by1) continue;
            var mi = (py - by0) * bw + (px - bx0);
            if (mask[mi]) continue;
            var a = ((py - by0) * bw + (px - bx0)), b = ((sy - by0) * bw + (sx - bx0));
            for (var c2 = 0; c2 < 3; c2++) score += Math.abs(chans[c2][a] - chans[c2][b]);
            n++;
          }
        }
        if (n > 10 && score / n < bestScore) { bestScore = score / n; best = [ox, oy]; }
      });
      if (best) {
        for (var y3 = y0; y3 <= y1; y3++) {
          for (var x3 = x0; x3 <= x1; x3++) {
            var di3 = (y3 - by0) * bw + (x3 - bx0);
            var sx3 = Math.min(bx1, Math.max(bx0, x3 + best[0]));
            var sy3 = Math.min(by1, Math.max(by0, y3 + best[1]));
            var si3 = (sy3 - by0) * bw + (sx3 - bx0);
            for (var c3 = 0; c3 < 3; c3++) chans[c3][di3] = chans[c3][si3];
          }
        }
      }
    } else {
      // 扩散填充：先铺均值，再迭代平滑（等价于求解拉普拉斯方程）
      for (var i4 = 0; i4 < N; i4++) {
        if (!mask[i4]) continue;
        chans[0][i4] = mean[0]; chans[1][i4] = mean[1]; chans[2][i4] = mean[2];
      }
      var iters = iterations || 80;
      var buf = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
      for (var it = 0; it < iters; it++) {
        for (var c4 = 0; c4 < 3; c4++) buf[c4].set(chans[c4]);
        for (var y4 = 1; y4 < bh - 1; y4++) {
          for (var x4 = 1; x4 < bw - 1; x4++) {
            var idx = y4 * bw + x4;
            if (!mask[idx]) continue;
            var l = idx - 1, r = idx + 1, u = idx - bw, d = idx + bw;
            for (var c5 = 0; c5 < 3; c5++) {
              var arr = buf[c5];
              chans[c5][idx] = (arr[l] + arr[r] + arr[u] + arr[d]) / 4;
            }
          }
        }
      }
      // 补一点噪点，避免大片死平
      for (var c6 = 0; c6 < 3; c6++) {
        var sg = sd[c6] * 0.35;
        if (sg < 0.6) continue;
        for (var i5 = 0; i5 < N; i5++) {
          if (!mask[i5]) continue;
          chans[c6][i5] += (Math.random() - 0.5) * sg;
        }
      }
    }

    // 回写（边缘 2px 做羽化，避免生硬接缝）
    for (var y5 = 0; y5 < bh; y5++) {
      for (var x5 = 0; x5 < bw; x5++) {
        var di5 = y5 * bw + x5;
        if (!mask[di5]) continue;
        var edge = Math.min(
          (x5 - (x0 - bx0)), ((x1 - bx0) - x5),
          (y5 - (y0 - by0)), ((y1 - by0) - y5)
        );
        var w = edge >= 2 ? 1 : (0.55 + edge * 0.2);
        var si5 = ((by0 + y5) * W + (bx0 + x5)) * 4;
        for (var c7 = 0; c7 < 3; c7++) {
          var v = chans[c7][di5] * w + data[si5 + c7] * (1 - w);
          data[si5 + c7] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function wmRemove() {
    var cfg = { mode: 'smooth', iters: 90 };
    TK.modal({
      title: '🧽 图片去水印',
      hint: '选图后会打开框选界面：按住鼠标（或手指）在水印上拖一个框，点「执行」即可本地修复。适合位置固定、背景较干净的水印。',
      runLabel: '选择图片',
      body:
        '<label class="tk-row"><span>修复方式</span><select id="wm-mode">' +
        '<option value="smooth">平滑修复（纯色 / 渐变背景）</option>' +
        '<option value="texture">纹理克隆（照片 / 复杂背景）</option>' +
        '</select></label>' +
        '<label class="tk-row"><span>强度</span><input id="wm-iters" type="number" value="90" min="20" max="300"></label>' +
        '<p class="tk-hint">提示：一次框不住可以多次执行；输出为 PNG（无损），保存在「下载\\WPS工具助手」。</p>',
      onRun: function () {
        cfg.mode = TK.val('#wm-mode') || 'smooth';
        cfg.iters = Math.max(20, TK.num('#wm-iters', 90));
        return TK.pickFiles({ filter: TK.FILTER_IMG, multi: false, title: '选择要去水印的图片' })
          .then(function (files) {
            if (!files.length) { TK.msg('已取消'); return; }
            return TK.readFile(files[0]).then(function (blob) {
              return TK.loadImage(blob).then(function (o) {
                URL.revokeObjectURL(o.url);
                openEditor(o.img, files[0], cfg);
              });
            });
          });
      }
    });
  }

  function openEditor(img, srcPath, cfg) {
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    var viewCv = document.createElement('canvas');
    var sel = null, dragging = false, startPt = null;

    TK.modal({
      title: '🧽 框选水印区域',
      hint: '在图片上拖出要修复的矩形（覆盖水印并略大一点），然后点「执行修复」。可以连续执行多次。',
      runLabel: '执行修复',
      body:
        '<div class="wm-wrap"><canvas id="wm-cv"></canvas></div>' +
        '<div class="wm-tools">' +
        '  <span id="wm-info" class="tk-hint">未选择区域</span>' +
        '  <button type="button" id="wm-clear">重新框选</button>' +
        '</div>',
      onMount: function (body) {
        var cv = body.querySelector('#wm-cv');
        var maxW = Math.max(240, body.clientWidth - 24);
        var scale = Math.min(1, maxW / W);
        cv.width = Math.round(W * scale);
        cv.height = Math.round(H * scale);
        cv.style.width = '100%';
        cv.style.touchAction = 'none';
        var ctx = cv.getContext('2d');

        function redraw() {
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          if (sel && sel.w > 0) {
            ctx.save();
            ctx.strokeStyle = '#C0392B';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
            ctx.fillStyle = 'rgba(192,57,43,0.12)';
            ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
            ctx.restore();
          }
        }
        redraw();

        function pt(e) {
          var r = cv.getBoundingClientRect();
          var cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
          var cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
          return { x: cx * (cv.width / r.width), y: cy * (cv.height / r.height) };
        }
        function down(e) {
          e.preventDefault();
          dragging = true;
          startPt = pt(e);
          sel = { x: startPt.x, y: startPt.y, w: 0, h: 0 };
        }
        function move(e) {
          if (!dragging) return;
          e.preventDefault();
          var p = pt(e);
          sel = {
            x: Math.min(startPt.x, p.x), y: Math.min(startPt.y, p.y),
            w: Math.abs(p.x - startPt.x), h: Math.abs(p.y - startPt.y)
          };
          redraw();
          document.getElementById('wm-info').textContent =
            '已选 ' + Math.round(sel.w / scale) + ' × ' + Math.round(sel.h / scale) + ' px';
        }
        function up(e) {
          if (!dragging) return;
          dragging = false;
          if (sel && (sel.w < 4 || sel.h < 4)) sel = null;
          redraw();
        }
        cv.addEventListener('mousedown', down);
        cv.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        cv.addEventListener('touchstart', down, { passive: false });
        cv.addEventListener('touchmove', move, { passive: false });
        cv.addEventListener('touchend', up);

        body.querySelector('#wm-clear').onclick = function () {
          sel = null; redraw();
          document.getElementById('wm-info').textContent = '未选择区域';
        };

        // 把选区换算回原图坐标
        viewCv._getSel = function () {
          if (!sel) return null;
          return { x: sel.x / scale, y: sel.y / scale, w: sel.w / scale, h: sel.h / scale };
        };
      },
      onRun: function () {
        var s = viewCv._getSel ? viewCv._getSel() : null;
        if (!s) throw new Error('请先在图片上拖一个框，圈住水印区域');
        var cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var imgData = ctx.getImageData(0, 0, W, H);
        repairRegion(imgData.data, W, H, s, cfg.mode, cfg.iters);
        ctx.putImageData(imgData, 0, 0);
        return TK.canvasToBlob(cv, 'image/png').then(function (b) {
          return TK.save(b, TK.stripExt(TK.baseName(srcPath)) + '_去水印.png').then(function (p) {
            TK.resultBox([p], '修复区域 ' + Math.round(s.w) + '×' + Math.round(s.h) + ' px（可继续修下一处）');
            // 用修复后的结果替换预览，方便接着修下一处
            var url = URL.createObjectURL(b);
            var preview = new Image();
            preview.onload = function () { URL.revokeObjectURL(url); openEditor(preview, srcPath, cfg); };
            preview.src = url;
          });
        });
      }
    });
  }

  function stamp() {
    var d = new Date();
    function p2(n) { return n < 10 ? '0' + n : '' + n; }
    return '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  }

  window.WTA_IMAGE = {
    'img-convert': convert,
    'img-to-pdf': toPdf,
    'img-watermark-add': watermark,
    'img-watermark-remove': wmRemove,
    'img-grid': grid
  };
})();
