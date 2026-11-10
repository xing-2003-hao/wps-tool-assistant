/* ============================================================
 * WPS 工具助手 · 工具 UI 框架
 * 提供：弹窗表单（TK.modal）、原生文件选择（走 exe 的 /pick）、
 *      读取本地文件（/file）、保存产物（/save）、定位文件（/reveal）
 * 不依赖浏览器 <input type=file>，避免 WPS webview 的限制
 * ============================================================ */
(function () {
  'use strict';

  function origin() {
    try {
      if (location.protocol === 'http:' && location.host) return location.origin;
    } catch (e) {}
    return 'http://127.0.0.1:3889';
  }

  // 所有请求都有两种失败：服务没起（fetch 直接抛 Failed to fetch）、服务起了但报错。
  // 前者是最常见的（exe 没运行 / 被关掉 / 刚重启），统一翻译成人话。
  function svcErr(e) {
    var m = String((e && e.message) || e || '');
    if (/Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed/i.test(m)) {
      return new Error('连不上本地服务（127.0.0.1:3889）—— 请双击「WPS工具助手-安装启动.exe」启动它，托盘出现图标后再重试');
    }
    return e;
  }

  function post(url, body, ctype) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': ctype || 'application/octet-stream' },
      body: body
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) {}
        if (!r.ok) throw new Error('本地服务返回 HTTP ' + r.status + (j && j.error ? '：' + j.error : ''));
        return j || {};
      });
    }).catch(function (e) { throw svcErr(e); });
  }

  /* ---------------- 服务健康检查 / 目标路径 ---------------- */
  function ping() {
    return fetch(origin() + '/ping?t=' + Date.now(), { method: 'GET', cache: 'no-store' })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  // 只算输出路径（不建文件），给 WPS 原生导出用
  function target(name) {
    return fetch(origin() + '/target?name=' + encodeURIComponent(name || 'output.pdf'), { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok || !j.path) throw new Error('无法定位输出目录');
        return j.path;
      })
      .catch(function (e) { throw svcErr(e); });
  }

  /* ---------------- 文件选择 ---------------- */
  var FILTER_IMG = '图片文件|*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.gif|所有文件|*.*';
  var FILTER_PDF = 'PDF 文件|*.pdf|所有文件|*.*';

  function pick(opts) {
    opts = opts || {};
    var q = '/pick?mode=' + (opts.mode || 'file')
      + '&multi=' + (opts.multi ? '1' : '0')
      + '&filter=' + encodeURIComponent(opts.filter || '所有文件|*.*')
      + '&title=' + encodeURIComponent(opts.title || '选择文件');
    return fetch(origin() + q, { method: 'POST' }).then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.files) || []; })
      .catch(function (e) { throw svcErr(e); });
  }

  function readFile(path) {
    return fetch(origin() + '/file?path=' + encodeURIComponent(path)).then(function (r) {
      if (!r.ok) throw new Error('读取文件失败：' + path);
      return r.blob();
    }).catch(function (e) { throw svcErr(e); });
  }

  function baseName(p) {
    var s = String(p).replace(/\\/g, '/');
    var i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function stripExt(name) {
    var i = String(name).lastIndexOf('.');
    return i > 0 ? String(name).slice(0, i) : String(name);
  }

  function save(blob, name) {
    var q = '/save?name=' + encodeURIComponent(name || 'output.bin');
    return fetch(origin() + q, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error('保存失败');
      return j.path;
    }).catch(function (e) { throw svcErr(e); });
  }

  function reveal(path) {
    return fetch(origin() + '/reveal?path=' + encodeURIComponent(path), { method: 'POST' }).catch(function () {});
  }

  /* ---------------- 图片工具 ---------------- */
  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败（可能是不支持的格式）')); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('导出图片失败')); }, type, quality);
        return;
      }
      // 旧内核兜底
      try {
        var d = canvas.toDataURL(type, quality);
        var base = d.split(',')[1];
        var bin = atob(base);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: type }));
      } catch (e) { reject(e); }
    });
  }

  /* ---------------- 弹窗 ---------------- */
  var state = { mask: null, runHandler: null, busy: false };

  function ensureModal() {
    if (state.mask) return state.mask;
    var mask = document.createElement('div');
    mask.className = 'tk-mask';
    mask.innerHTML =
      '<div class="tk-dialog">' +
      '  <div class="tk-head"><span class="tk-title"></span><button class="tk-x" type="button">×</button></div>' +
      '  <div class="tk-body"></div>' +
      '  <div class="tk-foot">' +
      '    <span class="tk-msg"></span>' +
      '    <button class="tk-cancel" type="button">关闭</button>' +
      '    <button class="tk-run primary" type="button">执行</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(mask);
    state.mask = mask;

    mask.querySelector('.tk-x').onclick = close;
    mask.querySelector('.tk-cancel').onclick = close;
    mask.querySelector('.tk-run').onclick = function () {
      if (state.busy || !state.runHandler) return;
      var btn = mask.querySelector('.tk-run');
      state.busy = true;
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = '处理中…';
      msg('正在处理，请稍候…');
      var done = function () {
        state.busy = false;
        btn.disabled = false;
        btn.textContent = old;
      };
      try {
        var ret = state.runHandler();
        if (ret && ret.then) ret.then(done, function (e) { done(); err(e); });
        else done();
      } catch (e) { done(); err(e); }
    };
    return mask;
  }

  function msg(text, isErr) {
    var el = state.mask && state.mask.querySelector('.tk-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'tk-msg' + (isErr ? ' bad' : '');
  }
  function err(e) { msg('失败：' + String((e && e.message) || e), true); }

  function close() {
    if (!state.mask) return;
    state.mask.classList.remove('show');
    state.busy = false;
    state.runHandler = null;
  }

  /**
   * TK.modal({ title, hint, body, runLabel, onRun, width })
   * body 为 HTML 字符串；onRun 返回 Promise 时自动 loading
   */
  function modal(cfg) {
    var mask = ensureModal();
    mask.querySelector('.tk-title').textContent = cfg.title || '工具';
    mask.querySelector('.tk-run').textContent = cfg.runLabel || '执行';
    mask.querySelector('.tk-run').style.display = cfg.noRun ? 'none' : '';
    var body = mask.querySelector('.tk-body');
    body.innerHTML = (cfg.hint ? '<p class="tk-hint">' + cfg.hint + '</p>' : '') + (cfg.body || '');
    msg('');
    state.runHandler = cfg.onRun || null;
    mask.classList.add('show');
    if (cfg.onMount) { try { cfg.onMount(body); } catch (e) { err(e); } }
    return mask;
  }

  /* ---------------- 表单取值 ---------------- */
  function val(sel, root) {
    var el = (root || document).querySelector(sel);
    return el ? el.value : '';
  }
  function num(sel, def, root) {
    var v = parseFloat(val(sel, root));
    return isNaN(v) ? def : v;
  }
  function checked(sel, root) {
    var el = (root || document).querySelector(sel);
    return !!(el && el.checked);
  }

  /* ---------------- 结果展示 ---------------- */
  function resultBox(paths, note) {
    var arr = [].concat(paths || []);
    var html = '<div class="tk-done">✓ 完成' + (note ? '：' + note : '') + '</div>';
    if (!arr.length) { msg('完成'); return; }
    html += '<div class="tk-paths">';
    arr.slice(0, 12).forEach(function (p) {
      html += '<div class="tk-path" data-path="' + p.replace(/"/g, '&quot;') + '">' + p + '</div>';
    });
    if (arr.length > 12) html += '<div class="tk-path">… 共 ' + arr.length + ' 个文件</div>';
    html += '</div>';
    html += '<div class="tk-acts"><button class="tk-open" type="button">打开所在文件夹</button></div>';
    var mask = ensureModal();
    mask.querySelector('.tk-body').innerHTML = html;
    mask.querySelector('.tk-run').style.display = 'none';
    mask.querySelector('.tk-open').onclick = function () { reveal(arr[0]); };
    msg('已保存 ' + arr.length + ' 个文件');
  }

  window.TK = {
    origin: origin, post: post, ping: ping, target: target,
    pick: pick, pickFiles: function (o) { o = o || {}; o.mode = 'file'; return pick(o); },
    pickFolder: function (title) { return pick({ mode: 'dir', title: title || '选择文件夹' }); },
    readFile: readFile, save: save, reveal: reveal,
    loadImage: loadImage, canvasToBlob: canvasToBlob,
    modal: modal, close: close, msg: msg, resultBox: resultBox,
    val: val, num: num, checked: checked,
    baseName: baseName, stripExt: stripExt,
    FILTER_IMG: FILTER_IMG, FILTER_PDF: FILTER_PDF,
    FILTER_DOC: 'Word 文档|*.docx;*.doc;*.docm|所有文件|*.*'
  };
})();
