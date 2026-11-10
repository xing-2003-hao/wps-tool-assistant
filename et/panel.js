/* ============================================================
 * WPS 工具助手 · 侧边栏逻辑（wps / et / wpp 三端共用）
 * v0.2.0 新增：
 *   1. 流式输出（stream: true，SSE 解析）
 *   2. 表格选区数据 → LLM 分析 → 结果表回写
 *   3. Writer 全文分块润色（结果生成到新文档）
 *   4. RAG 知识库检索注入（依赖 window.RAG，见 rag.js）
 * LLM 适配层：任何 OpenAI-compatible 接口均可
 *   Ollama(本机) / vLLM / DeepSeek / 通义 / OpenAI ...
 * ============================================================ */
(function () {
  'use strict';

  // 任何未捕获的脚本错误都直接显示到状态行，方便在 WPS 里定位（不必开 devtools）
  window.onerror = function (msg, file, line) {
    try {
      var f = String(file || '').split('/').pop();
      var s = document.getElementById('status');
      if (s) { s.textContent = '脚本错误：' + msg + '（' + f + ':' + line + '）'; s.className = 'status error'; }
      var c = document.getElementById('cfg-status');
      if (c) { c.textContent = '脚本错误：' + msg + '（' + f + ':' + line + '）'; c.className = 'status error'; }
    } catch (e) {}
    return false;
  };

  /* ==================== 本地代理（绕过 WPS webview 跨域） ==================== */
  // 面板本身就是本地助手服务（exe）供应的页面，同源，所以这里请求代理不会有跨域问题；
  // 代理再把请求转发到 Ollama / vLLM / 云端 API，从而绕开 webview 的 CORS 限制。
  var PROXY_ENABLED = true;

  function serviceOrigin() {
    try {
      if (location.protocol === 'http:' && location.host) return location.origin;
    } catch (e) {}
    return 'http://127.0.0.1:3889';
  }

  function proxyUrl(target) {
    return serviceOrigin() + '/proxy?target=' + encodeURIComponent(target);
  }

  // 把底层网络错误翻译成能照着做的提示
  function netHint(e, cfg) {
    var m = String((e && e.message) || e);
    if ((e && e.name === 'TypeError') || /Failed to fetch|NetworkError|Load failed|Network request failed/i.test(m)) {
      return new Error(
        '连不上模型服务 ' + cfg.baseUrl + '\n' +
        '· 本地模型：确认 Ollama / vLLM 已启动，模型名正确\n' +
        '· 云端模型：确认 API Key 已填、网络可达\n' +
        '· 可到「设置」点「测试连接」定位具体原因'
      );
    }
    return e;
  }

  // HTTP 层的错误，附带人话提示
  function httpError(status, text) {
    var hint = (status === 401 || status === 403) ? '（API Key 无效或未填写）'
      : status === 404 ? '（接口地址或模型名不对）'
      : status === 429 ? '（请求过频或额度不足）'
      : status >= 500 ? '（模型服务内部错误）' : '';
    return new Error('请求失败 HTTP ' + status + hint + '：' + String(text).slice(0, 200));
  }

  /* ==================== 卡密闸门 ==================== */
  // AI 功能走激活校验（见 license.js）；离线工具不经过这里，永远免费。
  // 未配置激活服务器 / 用户自带 API Key / 已激活有效 → 直接放行。
  function gateAI() {
    try {
      if (window.WTA_LICENSE) return WTA_LICENSE.ensureUnlock();
    } catch (e) { /* 模块异常时放行，不能把 AI 全弄死 */ }
    return Promise.resolve(true);
  }

  /* ==================== LLM 适配层 ==================== */
  var LLM = {
    defaults: {
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5:7b',
      temperature: 0.7
    },
    PRESETS: [
      { name: 'Ollama 本机', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', apiKey: '' },
      { name: 'vLLM 本机', baseUrl: 'http://localhost:8000/v1', model: 'Qwen2.5-7B-Instruct', apiKey: '' },
      { name: 'DeepSeek 云端', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' },
      { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', apiKey: '' },
      { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' }
    ],
    load: function () {
      try {
        return Object.assign({}, this.defaults, JSON.parse(localStorage.getItem('wta.llm') || '{}'));
      } catch (e) { return Object.assign({}, this.defaults); }
    },
    save: function (cfg) { localStorage.setItem('wta.llm', JSON.stringify(cfg)); },
    _cfg: function (opts) {
      var cfg = Object.assign(this.load(), opts || {});
      if (!cfg.baseUrl) throw new Error('请先在「设置」中填写服务地址');
      return cfg;
    },
    _headers: function (cfg) {
      return Object.assign(
        { 'Content-Type': 'application/json' },
        cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}
      );
    },
    /* 统一请求：优先走本地助手服务代理（规避 WPS webview 的跨域限制），失败自动回退直连 */
    _post: function (cfg, body) {
      var url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
      var payload = JSON.stringify(body);
      var headers = this._headers(cfg);
      var direct = function () {
        return fetch(url, { method: 'POST', headers: headers, body: payload })
          .catch(function (e) { throw netHint(e, cfg); });
      };
      if (!PROXY_ENABLED) return direct();
      return fetch(proxyUrl(url), {
        method: 'POST',
        headers: headers,   // 必须带上 Authorization，否则云端一律 401
        body: payload
      }).then(function (r) {
        if (r.status === 502) throw new Error('__retry_direct__');
        return r;
      }).catch(function () { return direct(); });
    },
    /* 非流式（测试连接 / 分块后台调用）—— 走卡密闸门 */
    chat: function (messages, opts) {
      var self = this;
      return gateAI().then(function (ok) {
        if (!ok) throw new Error('AI 功能需要激活：请输入卡密（离线工具不受影响）');
        return self._chatRaw(messages, opts);
      });
    },
    _chatRaw: function (messages, opts) {
      var cfg = this._cfg(opts);
      return this._post(cfg, { model: cfg.model, messages: messages, temperature: cfg.temperature, stream: false })
        .then(function (resp) {
          if (!resp.ok) {
            return resp.text().then(function (t) {
              throw httpError(resp.status, t);
            });
          }
          return resp.json();
        }).then(function (data) {
          var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (!text) throw new Error('模型返回内容为空');
          return String(text).trim();
        });
    },
    /* 流式：onDelta(chunk, fullText) 逐段回调，resolve 完整文本 —— 走卡密闸门 */
    chatStream: function (messages, onDelta, opts) {
      var self = this;
      return gateAI().then(function (ok) {
        if (!ok) throw new Error('AI 功能需要激活：请输入卡密（离线工具不受影响）');
        return self._chatStreamRaw(messages, onDelta, opts);
      });
    },
    _chatStreamRaw: function (messages, onDelta, opts) {
      var cfg = this._cfg(opts);
      return this._post(cfg, { model: cfg.model, messages: messages, temperature: cfg.temperature, stream: true })
        .then(function (resp) {
          if (!resp.ok) {
            return resp.text().then(function (t) {
              throw httpError(resp.status, t);
            });
          }
          if (!resp.body || !resp.body.getReader) {
            // 内核不支持流式 → 降级非流式
            return LLM.chat(messages, opts);
          }
          return new Promise(function (resolve, reject) {
            var reader = resp.body.getReader();
            var decoder = new TextDecoder('utf-8');
            var buffer = '', full = '';
            function pump() {
              reader.read().then(function (r) {
                if (r.done) { resolve(full); return; }
                buffer += decoder.decode(r.value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop();
                lines.forEach(function (line) {
                  line = line.trim();
                  if (line.indexOf('data:') !== 0) return;
                  var payload = line.slice(5).trim();
                  if (payload === '[DONE]') return;
                  try {
                    var j = JSON.parse(payload);
                    var c0 = j.choices && j.choices[0];
                    var delta = c0 && c0.delta && c0.delta.content;
                    if (!delta && c0 && c0.message) delta = c0.message.content;
                    if (delta) { full += delta; if (onDelta) onDelta(delta, full); }
                  } catch (e) { /* 忽略心跳/半包 */ }
                });
                pump();
              }).catch(reject);
            }
            pump();
          });
        });
    }
  };

  /* ==================== 宿主探测 ==================== */
  // WPS 的 Office 全局对象叫 wps（三端都有），通过 wps.WpsApplication() / EtApplication() /
  // WppApplication() 取对应进程的 Application；部分版本另有 VBA 风格的全局 Application。
  // 顶层 `et` / `wpp` 大多数版本并不存在，所以这里按“谁能返回 Application”来判定，不认名字。
  function typeOfApp(app) {
    if (!app) return '';
    try { if (app.ActiveSheet || app.ActiveWorkbook || app.Worksheets) return 'et'; } catch (e) {}
    try { if (app.ActivePresentation || app.Presentations) return 'wpp'; } catch (e) {}
    try { if (app.ActiveDocument) return 'wps'; } catch (e) {}
    return '';
  }

  function detectHost() {
    var names = ['wps', 'WPS', 'et', 'ET', 'wpp', 'WPP'];
    var getters = ['WpsApplication', 'EtApplication', 'WppApplication'];
    var cands = [];
    function add(bridge, app) {
      if (!app) return;
      for (var i = 0; i < cands.length; i++) if (cands[i].app === app) return;
      cands.push({ bridge: bridge, app: app });
    }
    function scan(b) {
      if (!b) return;
      for (var j = 0; j < getters.length; j++) {
        try { if (typeof b[getters[j]] === 'function') add(b, b[getters[j]]()); } catch (e) {}
      }
      try { add(b, b.Application); } catch (e) {}
      // 对象本身就是 Application（VBA 风格）
      try { if (b.ActiveDocument || b.ActiveSheet || b.Presentations) add(b, b); } catch (e) {}
    }
    for (var i = 0; i < names.length; i++) {
      var b = null;
      try { b = window[names[i]]; } catch (e) { b = null; }
      scan(b);
    }
    try { if (window.Application) add(window, window.Application); } catch (e) {}
    try { if (window.external && window.external.Application) add(window.external, window.external.Application); } catch (e) {}
    try {
      if (window.parent && window.parent !== window) {
        for (var p = 0; p < names.length; p++) { try { scan(window.parent[names[p]]); } catch (e) {} }
      }
    } catch (e) {}

    for (var m = 0; m < cands.length; m++) {
      var t = typeOfApp(cands[m].app);
      if (t) return { type: t, bridge: cands[m].bridge, app: cands[m].app };
    }
    return { type: 'unknown', bridge: null, app: null, probed: cands.length };
  }
  var HOST = detectHost();
  // 供 toolui / imagetools / pdftools / officetools 等模块使用
  window.WTA_HOST = function () { return HOST; };
  window.WTA_setStatus = setStatus;
  // 暴露 LLM 适配层：便于自测替换成假模型，也方便高级用户在控制台调试
  window.WTA_LLM = LLM;

  /**
   * 独立窗口判定：PDF 组件不加载 JS 加载项，PDF 里出不来面板，
   * 所以给一个「独立窗口」入口（托盘 / Ctrl+Alt+W），此时没有文档对象，
   * 文字类动作改为从系统剪贴板取内容。
   */
  function isStandalone() { return HOST.type === 'unknown'; }

  // 剪贴板文本由本地服务读（webview 里读剪贴板会被拦）
  function readClipboard() {
    return fetch(serviceOrigin() + '/clipboard?t=' + Date.now(), { method: 'GET', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.text) || ''; })
      .catch(function () {
        try { if (navigator.clipboard && navigator.clipboard.readText) return navigator.clipboard.readText(); } catch (e) {}
        return '';
      });
  }

  function withText(act, t) {
    var c = {};
    for (var k in act) c[k] = act[k];
    c.gather = function () { return t; };
    c.gatherWrap = null;
    return c;
  }

  function hasText(t) { return !!t && !!String(t).replace(/[\s\r\n]/g, ''); }

  /* ==================== 文档读写原语 ==================== */
  function getWriterSelection() {
    try { var s = HOST.app.Selection; return s ? String(s.Text || '') : ''; } catch (e) { return ''; }
  }
  function setWriterSelection(text) { HOST.app.Selection.Text = text; }

  function getActiveFormula() {
    try { var c = HOST.app.ActiveCell; return c ? String(c.Formula || '') : ''; } catch (e) { return ''; }
  }
  function getUsedRangeSample(maxRow, maxCol) {
    var ws = HOST.app.ActiveSheet, ur = ws.UsedRange;
    var rows = Math.min(ur.Rows.Count, maxRow || 20);
    var cols = Math.min(ur.Columns.Count, maxCol || 8);
    var lines = [];
    for (var r = 1; r <= rows; r++) {
      var row = [];
      for (var c = 1; c <= cols; c++) {
        var v = ws.Cells.Item(ur.Row + r - 1, ur.Column + c - 1).Value2;
        row.push(csvCell(v));
      }
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }
  /* 选区 → CSV（分析回写用） */
  function getSelectionCsv() {
    var sel = HOST.app.Selection;
    if (!sel || sel.Cells.Count === 0) return '';
    var out = [];
    for (var a = 1; a <= sel.Areas.Count; a++) {
      var area = sel.Areas.Item(a);
      for (var r = 1; r <= area.Rows.Count; r++) {
        var row = [];
        for (var c = 1; c <= area.Columns.Count; c++) {
          var v = area.Cells.Item(r, c).Value2;
          row.push(csvCell(v));
        }
        out.push(row.join(','));
      }
    }
    return out.join('\n');
  }
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/[\r\n]+/g, ' ');
    return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /* 解析 LLM 输出的 CSV 表格 → 二维数组 */
  function parseCsvTable(text) {
    var rows = [];
    String(text).replace(/```[a-zA-Z]*|```/g, '').trim().split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || /^[-:| ]+$/.test(line)) return; // 跳过 markdown 分隔行
      var cells = [], cur = '', inQ = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (inQ) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') inQ = false;
          else cur += ch;
        } else if (ch === '"') { inQ = true; }
        else if (ch === ',' || ch === '\t') { cells.push(cur); cur = ''; }
        else cur += ch;
      }
      cells.push(cur);
      rows.push(cells);
    });
    return rows;
  }
  /* 结果表写入选区下方 */
  function writeTableBelow(rows, ctx) {
    var ws = ctx.ws || HOST.app.ActiveSheet;
    var startRow = ctx.row + ctx.rowCount + 1; // 空一行
    var startCol = ctx.col;
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        ws.Cells.Item(startRow + r, startCol + c).Value2 = rows[r][c];
      }
    }
    return rows.length;
  }

  function getSlideText() {
    try {
      var slide = HOST.app.ActiveWindow.View.Slide;
      var text = '';
      for (var i = 1; i <= slide.Shapes.Count; i++) {
        var sh = slide.Shapes.Item(i);
        if (sh.TextFrame && sh.TextFrame.HasText) text += sh.TextFrame.TextRange.Text + '\n';
      }
      return text;
    } catch (e) { return ''; }
  }
  function cleanOutput(s) {
    return s.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim();
  }

  /* ==================== 全文分块（Writer） ==================== */
  var CHUNK_SIZE = 1500; // 每块字符上限（按段落边界切）
  function splitParagraphs(text) {
    return String(text).replace(/\r\n/g, '\r').split('\r').filter(function (p) { return p.trim(); });
  }
  function buildChunks(paras) {
    var chunks = [], cur = [];
    var len = 0;
    paras.forEach(function (p) {
      if (len + p.length > CHUNK_SIZE && cur.length) {
        chunks.push(cur.join('\r'));
        cur = []; len = 0;
      }
      cur.push(p); len += p.length;
    });
    if (cur.length) chunks.push(cur.join('\r'));
    return chunks;
  }
  /* 全文润色：分块依次送模型 → 结果生成到新文档（原文档不动） */
  function runFullPolish() {
    var doc = HOST.app.ActiveDocument;
    if (!doc) { setStatus('没有打开的文档', true); return; }
    var text = String(doc.Content.Text || '');
    if (!text.trim()) { setStatus('文档内容为空', true); return; }
    var chunks = buildChunks(splitParagraphs(text));
    if (!confirm('全文共 ' + text.length + ' 字，将分 ' + chunks.length + ' 块依次润色（每块 ' + CHUNK_SIZE + ' 字上限）。耗时较长，继续？')) return;
    var results = [];
    var i = 0;
    function next() {
      if (i >= chunks.length) { finishFullPolish(results); return; }
      var idx = i + 1;
      setStatus('润色中… 第 ' + idx + ' / ' + chunks.length + ' 块');
      var messages = [
        { role: 'system', content: '你是中文文档润色专家。对给定文本逐段润色：修正错别字与语病、使表达更流畅，但不得改变原意、不得增删段落。只输出润色后的文本，保持原有分段（用换行分隔）。' },
        { role: 'user', content: chunks[i] }
      ];
      var caller = i;
      var p = window.RAG && RAG.isEnabled()
        ? RAG.search(chunks[i]).then(function (ctx) { return injectRag(messages, ctx); }).then(function (m) { return LLM.chat(m); })
        : LLM.chat(messages);
      p.then(function (out) {
        results[caller] = cleanOutput(out);
        i++;
        next();
      }).catch(function (err) {
        if (confirm('第 ' + idx + ' 块处理失败：' + err.message + '\n\n保留原文继续后面的块？')) {
          results[caller] = chunks[caller]; // 失败块保留原文
          i++;
          next();
        } else {
          setStatus('全文润色已中止（已完成 ' + caller + ' / ' + chunks.length + ' 块）', true);
        }
      });
    }
    next();
  }
  function finishFullPolish(results) {
    var text = results.filter(function (r) { return r !== undefined; }).join('\r');
    try {
      var newDoc = HOST.app.Documents.Add();
      newDoc.Content.Text = text;
      setStatus('全文润色完成 ✓ 已生成到新文档');
      showResult(text);
    } catch (e) {
      setStatus('生成新文档失败：' + e.message + '（结果已在下方文本框，可手动复制）', true);
      showResult(text);
    }
  }

  /* ==================== RAG 注入 ==================== */
  function injectRag(messages, ragContext) {
    if (!ragContext) return messages;
    var m = messages.slice();
    m[0] = Object.assign({}, m[0], {
      content: m[0].content + '\n\n[知识库参考资料]\n' + ragContext + '\n[/知识库参考资料]\n回答时优先依据以上资料；资料无关时按常识回答并说明。'
    });
    return m;
  }

  /* ==================== 动作注册表 ==================== */
  var WRITER_ACTIONS = [
    { id: 'polish',   label: '✨ 润色',    mode: 'replace', build: function (t) { return [{ role: 'system', content: '你是中文文档润色专家。只输出润色后的文本，不要任何解释或前后缀。' }, { role: 'user', content: '润色以下文字，保持原意：\n\n' + t }]; } },
    { id: 'proof',    label: '🔍 纠错',    mode: 'replace', build: function (t) { return [{ role: 'system', content: '你是校对专家。修正错别字和语病，只输出修正后的全文。' }, { role: 'user', content: t }]; } },
    { id: 'expand',   label: '📖 扩写',    mode: 'replace', build: function (t) { return [{ role: 'system', content: '你是写作助手。只输出扩写后的文本。' }, { role: 'user', content: '将以下内容扩写约一倍，保持风格：\n\n' + t }]; } },
    { id: 'shorten',  label: '✂️ 缩写',    mode: 'replace', build: function (t) { return [{ role: 'system', content: '你是写作助手。只输出缩写后的文本。' }, { role: 'user', content: '将以下内容压缩到一半篇幅，保留要点：\n\n' + t }]; } },
    { id: 't2e',      label: '🀄→EN',      mode: 'replace', build: function (t) { return [{ role: 'system', content: 'You are a translator. Output only the translation.' }, { role: 'user', content: 'Translate to English:\n\n' + t }]; } },
    { id: 't2z',      label: 'EN→🀄',      mode: 'replace', build: function (t) { return [{ role: 'system', content: '你只输出翻译结果。' }, { role: 'user', content: '翻译成中文：\n\n' + t }]; } },
    { id: 'continue', label: '✍️ 续写',    mode: 'result',  build: function (t) { return [{ role: 'system', content: '你是写作助手，只输出续写的内容。' }, { role: 'user', content: '以下面文字为开头继续写 200 字左右：\n\n' + t }]; } },
    { id: 'fullpolish', label: '📄 全文润色(分块)', mode: 'custom', run: runFullPolish }
  ];

  var ET_ACTIONS = [
    { id: 'fgen',     label: '🧮 生成公式', mode: 'formula', input: '描述你要的公式，如：A列大于100时显示"达标"，否则"未达标"', build: function (desc) { return [{ role: 'system', content: '你是 Excel/WPS 公式专家。只输出一个公式（以 = 开头），不要解释、不要代码块。使用中文文本时用双引号。' }, { role: 'user', content: '生成公式：' + desc }]; } },
    { id: 'fexplain', label: '💬 解释公式', mode: 'result',  build: function (t) { return [{ role: 'system', content: '用简洁中文解释这个公式的作用，逐段说明。' }, { role: 'user', content: '公式：' + t }]; }, gather: function () { return getActiveFormula(); } },
    { id: 'analyze',  label: '📊 分析选区→回写', mode: 'write-table',
      input: '想怎么分析？如：按销售额排序 / 汇总各部门数量 / 标出异常值', inputIsInstruction: true,
      gather: function () {
        var csv = getSelectionCsv();
        if (csv) {
          var sel = HOST.app.Selection;
          this._ctx = { ws: HOST.app.ActiveSheet, row: sel.Row, col: sel.Column, rowCount: sel.Areas.Count === 1 ? sel.Rows.Count : sel.Rows.Count };
          if (sel.Areas.Count > 1) this._ctx = { ws: HOST.app.ActiveSheet, row: sel.Areas.Item(1).Row, col: sel.Areas.Item(1).Column, rowCount: sel.Areas.Item(1).Rows.Count };
        }
        return csv;
      },
      build: function (payload) {
        var parts = payload.split('\n===INSTRUCTION===\n');
        return [
          { role: 'system', content: '你是数据分析专家。根据用户的数据和指令输出结果表：只输出纯 CSV 文本（英文逗号分隔，含表头，第一行为结果表头），不要代码块、不要解释。' },
          { role: 'user', content: '数据（CSV）：\n' + parts[0] + '\n\n分析指令：' + (parts[1] || '总结数据要点，输出统计结果表') }
        ];
      },
      gatherWrap: function (csv) {
        var desc = document.getElementById('user-input').value.trim();
        return csv + '\n===INSTRUCTION===\n' + desc;
      }
    },
    { id: 'csuggest', label: '🧹 数据清洗建议', mode: 'result', build: function (t) { return [{ role: 'system', content: '你是数据清洗专家。指出数据中的问题并给出具体处理建议（含公式或步骤）。' }, { role: 'user', content: '这是表格前 20 行的 CSV 样本：\n\n' + t }]; }, gather: function () { return getUsedRangeSample(20, 8); } }
  ];

  var WPP_ACTIONS = [
    { id: 'outline',  label: '📋 生成大纲', mode: 'result', input: '输入 PPT 主题，如：新产品发布汇报', build: function (t) { return [{ role: 'system', content: '你是 PPT 策划专家。输出每页一行的大纲，格式「第N页：标题 — 要点」，共 8~10 页。' }, { role: 'user', content: '主题：' + t }]; } },
    { id: 'spolish',  label: '✨ 润色本页', mode: 'result', build: function (t) { return [{ role: 'system', content: '优化幻灯片文字：更精炼、更有力，逐条输出优化后的文本。' }, { role: 'user', content: '当前页文字：\n\n' + t }]; }, gather: function () { return getSlideText(); } }
  ];

  function actionsForHost() {
    if (HOST.type === 'wps') return WRITER_ACTIONS;
    if (HOST.type === 'et') return ET_ACTIONS;
    if (HOST.type === 'wpp') return WPP_ACTIONS;
    return WRITER_ACTIONS;
  }

  /* ==================== UI 渲染 ==================== */
  var currentAction = null;

  function $(id) { return document.getElementById(id); }
  function setStatus(msg, isError) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = isError ? 'status error' : 'status';
  }
  function showResult(text) {
    $('result').value = text;
    $('result-wrap').classList.remove('hidden');
  }

  function renderActions() {
    var box = $('actions');
    box.innerHTML = '';
    actionsForHost().forEach(function (act) {
      var btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.textContent = act.label;
      btn.onclick = function () {
        if (act.mode === 'custom') { act.run(); return; }
        runAction(act);
      };
      box.appendChild(btn);
    });
    var needInput = actionsForHost().some(function (a) { return a.input; });
    var inputRow = $('input-row');
    var inputAct = actionsForHost().filter(function (a) { return a.input; })[0];
    if (needInput) {
      inputRow.classList.remove('hidden');
      $('user-input').placeholder = inputAct.input;
    } else {
      inputRow.classList.add('hidden');
    }
    // 输入框的「生成」按钮始终可用：写文档指令就本地执行，否则按当前动作/自由指令跑
    $('btn-input').onclick = function () {
      var typed = ($('user-input').value || '').trim();
      if (typed && tryDocOp(typed)) return;
      if (inputAct) { runAction(inputAct); return; }
      runCommand(typed);
    };
  }

  /* 主流程：取内容 → RAG 注入 → 流式调用 → 应用 */
  var runSeq = 0;   // 每次运行的流水号：防止上一条慢响应回来把新结果覆盖掉
  function runAction(act, _noClip) {
    currentAction = act;
    var mySeq = ++runSeq;
    try { $('btn-apply').classList.remove('ready'); $('btn-apply').classList.remove('warn'); } catch (e0) { }
    refreshSelHint();
    var text = null;

    if (act.gather) {
      text = act.gather.call(act);
      if (hasText(text) && act.gatherWrap) text = act.gatherWrap.call(act, text);
    } else if (act.input) {
      text = $('user-input').value.trim();
    } else {
      text = getWriterSelection();
    }

    // 独立窗口（PDF 场景）没有文档对象：退回到剪贴板取内容
    if (!hasText(text) && !_noClip && isStandalone()) {
      setStatus('正在读取剪贴板…');
      readClipboard().then(function (t) {
        if (hasText(t)) runAction(withText(act, t), true);
        else setStatus('没有取到内容：先在 PDF 里选中文字按 Ctrl+C，再点一次；或把内容粘贴到上方输入框', true);
      });
      return;
    }
    if (!hasText(text)) {
      if (act.input) setStatus('请先在输入框填写内容', true);
      else setStatus('没有取到内容（先在文档里选中要处理的文字，或在上方输入框填写）', true);
      return;
    }

    // 防误伤：文档里残留大片选区时，别默默把整段/整篇发给模型
    if (text.length > 2000) {
      if (!ask('这段内容有 ' + text.length + ' 字，可能是残留的旧选区。确定发给模型处理吗？')) {
        setStatus('已取消 —— 请重新选中要处理的那部分文字');
        return;
      }
    }

    var messages = act.build(text);
    $('result-wrap').classList.add('hidden');
    setStatus('模型思考中…');

    var ready = (window.RAG && RAG.isEnabled())
      ? RAG.search(text).catch(function () { return null; })
      : Promise.resolve(null);

    ready.then(function (ragCtx) {
      if (mySeq !== runSeq) return null;      // 已有更新的请求，丢弃这条
      if (ragCtx) setStatus('已注入知识库片段，生成中…');
      var first = true;
      return LLM.chatStream(injectRag(messages, ragCtx), function (delta, full) {
        if (mySeq !== runSeq) return;
        if (first) { showResult(''); first = false; }
        $('result').value = full; // 流式渐进显示
      });
    }).then(function (out) {
      if (mySeq !== runSeq || out === null) return;   // 旧请求的尾巴，别再弹窗/写文档
      var cleaned = cleanOutput(out);
      showResult(cleaned);
      applyOutput(act, cleaned);
    }).catch(function (err) {
      if (mySeq !== runSeq) return;
      setStatus(err.message, true);
    });
  }

  // 模型没拿到原文时的典型反问（「请把需要删除的那段话发给我」「您提供的这段话没有…」）
  // 这种回复不能写进文档，也不能让人误以为已经改好了
  function looksLikeRefusal(t) {
    var s = String(t || '').replace(/\s+/g, ' ').trim();
    if (!s || s.length > 200) return false;
    // 开头就是致歉 / 明确说做不到
    if (/^(抱歉|对不起|不好意思|很抱歉|我(无法|不能|没法|不支持)|作为一个?AI)/.test(s)) return true;
    // 开头就索要材料（「请提供原文…」「请把需要删除的那段话发给我」）
    if (/^请(你|您)?(先)?(提供|告诉|发送|补充|粘贴|说明|把)/.test(s)) return true;
    // 要求用户补充材料（典型反问句）
    if (/(请|需要|麻烦)(你|您)?(先)?(告诉|提供|发|给|补充|粘贴|说明)我/.test(s)) return true;
    if (/(发给我|告诉我|提供给我|贴给我)/.test(s)) return true;
    // 「您提供的这段…没有…」这类先否定再索要
    if (/^(您|你)(提供|发送|给)的/.test(s)) return true;
    // 追问具体是哪一段 / 哪部分
    if (/(哪+(一)?(段|部分|句|处)|具体(是)?哪)/.test(s) && /(请|告诉|说明|明确)/.test(s)) return true;
    // 结尾是「我再帮你处理」这类待命句，说明它在等材料
    if (/我再帮(你|您)(处理|看|改|润色|写)/.test(s)) return true;
    return false;
  }

  function ask(msg) {
    // 某些宿主 webview 里 confirm 会被拦掉（直接返回 false），此时不阻断流程
    try { return window.confirm(msg) !== false; } catch (e) { return true; }
  }

  // 生成结束后：只提示，不弹窗、不自动改文档。
  // 自动写入 + confirm 在 WPS webview 里是个陷阱 —— 弹窗会突然冒出来挡住文档，
  // 而且模型偶尔回的是反问，写进去就是脏数据。统一改成「点『应用』才写」。
  function applyOutput(act, cleaned) {
    if (looksLikeRefusal(cleaned)) {
      setStatus('模型回的是反问（多半没拿到原文）—— 结果没有写入文档。请选中文字后重试', true);
      try { $('btn-apply').classList.remove('ready'); $('btn-apply').classList.add('warn'); } catch (e) { }
      return;
    }
    try { $('btn-apply').classList.remove('warn'); $('btn-apply').classList.add('ready'); } catch (e) { }
    if (act.mode === 'write-table') {
      var rows = parseCsvTable(cleaned);
      if (!rows.length) { setStatus('生成完成，但没解析出表格 —— 点「应用」会原样插入，请手动处理', true); return; }
    }
    setStatus('生成完成 —— 点「应用」写入文档（或「复制」）');
  }

  // 点「应用」时再确认一次宿主：面板可能比文档对象先加载完
  function refreshHost() {
    try {
      if (!HOST || HOST.type === 'unknown' || !HOST.app) {
        var h = detectHost();
        if (h && h.type !== 'unknown' && h.app) HOST = h;
      }
    } catch (e) { }
    return HOST || { type: 'unknown', app: null };
  }

  // 是否有选区（光标不算）：Writer 的 Selection.Type 2 = 闪烁光标
  function hasTextSelection(host) {
    try {
      var s = host.app.Selection;
      if (!s) return false;
      if (typeof s.Type === 'number' && s.Type === 2) return false;
      return String(s.Text || '').length > 0;
    } catch (e) { return false; }
  }

  function copyResultQuiet() {
    try {
      var box = $('result');
      box.focus();
      box.select();
      document.execCommand('copy');
      try { box.setSelectionRange(box.value.length, box.value.length); } catch (e) { }
      return true;
    } catch (e) { return false; }
  }

  function applyResult() {
    if (!currentAction) { setStatus('先点一个动作生成结果，再点「应用」', true); return; }
    if (currentAction.mode === 'noop') { setStatus('这只是执行回执，文档已经改好了，不需要再应用'); return; }
    var text = $('result').value;
    if (!text || !text.replace(/\s/g, '')) { setStatus('结果为空，没有可应用的内容', true); return; }
    if (looksLikeRefusal(text)) {
      setStatus('模型回的是反问，不是结果 —— 已阻止写入。请先选中文字再点动作，或在指令框直接说「删除这段话」', true);
      return;
    }

    var host = refreshHost();
    var mode = currentAction.mode;
    var copied = false;

    try {
      // 1) 公式 → 写当前单元格（ET）
      if (mode === 'formula') {
        var f = text.replace(/\s+/g, '');
        if (f.charAt(0) !== '=') f = '=' + f;
        var cell = host.app && host.app.ActiveCell;
        if (!cell) { setStatus('请先选中目标单元格（当前宿主：' + host.type + '）', true); return; }
        cell.Formula = f;
        setStatus('已写入当前单元格 ✓');
        return;
      }

      // 2) 表格回写 → 选区下方（ET）
      if (mode === 'write-table') {
        var rows = parseCsvTable(text);
        if (!rows.length) { setStatus('未能从结果解析出表格，请手动处理', true); return; }
        var n = writeTableBelow(rows, currentAction._ctx || {});
        setStatus('已回写 ' + n + ' 行结果 ✓');
        return;
      }

      // 3) 文字类（润色/替换/插入/续写/写作…）：能写文档就写，不再区分 mode
      if (host.type === 'wps' && host.app) {
        if (mode === 'replace' && hasTextSelection(host)) {
          setWriterSelection(text);
          setStatus('已替换选区 ✓');
        } else {
          host.app.Selection.InsertAfter('\r' + text);
          try { host.app.Selection.Collapse(0); } catch (e2) { }
          setStatus(mode === 'replace' ? '没有选中内容，已插入光标处 ✓' : '已插入光标处 ✓');
        }
        return;
      }

      // 4) 表格宿主里的纯文字结果 → 只写空单元格，避免覆盖原有公式/数据
      if (host.type === 'et' && host.app) {
        var c2 = host.app.ActiveCell;
        if (!c2) { setStatus('请先选中一个单元格', true); return; }
        var occupied = String(c2.Text || '').length > 0;
        if (occupied) {
          copied = copyResultQuiet();
          setStatus('当前单元格已有内容，未覆盖 —— ' + (copied ? '结果已复制，可粘贴到空白单元格' : '请手动复制结果'), true);
          return;
        }
        c2.Value2 = text;
        setStatus('已写入当前单元格 ✓');
        return;
      }

      // 5) 演示宿主：放到当前页的文本框里
      if (host.type === 'wpp' && host.app) {
        var shape = null;
        try {
          var sel = host.app.ActiveWindow.Selection;
          shape = sel.ShapeRange.Item(1);
        } catch (e) { shape = null; }
        if (shape && shape.TextFrame) {
          shape.TextFrame.TextRange.Text = text;
          setStatus('已写入当前选中的文本框 ✓');
        } else {
          throw new Error('当前页没有选中的文本框，请先点一下要写入的文本框');
        }
        return;
      }

      // 6) 实在没有宿主：明确说清原因，并把结果放进剪贴板
      copied = copyResultQuiet();
      setStatus('没能写入文档：未检测到 WPS 文档对象（宿主 ' + host.type + '）'
        + (copied ? '—— 结果已复制，可直接 Ctrl+V 粘贴' : '—— 请手动复制结果'), true);
    } catch (e) {
      copied = copyResultQuiet();
      setStatus('写入失败：' + e.message + (copied ? '（结果已复制，可直接粘贴）' : '（请手动复制结果）'), true);
    }
  }

  /* ==================== 设置页 ==================== */
  // 设置页有自己的状态行，避免反馈写在“功能”页导致看不到
  function setCfgStatus(msg, isError) {
    var el = $('cfg-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (isError ? ' error' : '');
  }

  function fillSettings() {
    var cfg = LLM.load();
    $('cfg-baseurl').value = cfg.baseUrl;
    $('cfg-apikey').value = cfg.apiKey;
    $('cfg-model').value = cfg.model;
    $('cfg-temp').value = cfg.temperature;
    var sel = $('cfg-preset');
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    LLM.PRESETS.forEach(function (p, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = p.name;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      var p = LLM.PRESETS[Number(sel.value)];
      if (!p) return;
      $('cfg-baseurl').value = p.baseUrl;
      $('cfg-model').value = p.model;
      $('cfg-apikey').value = p.apiKey || '';
    };
  }
  function saveSettings() {
    LLM.save({
      baseUrl: $('cfg-baseurl').value.trim(),
      apiKey: $('cfg-apikey').value.trim(),
      model: $('cfg-model').value.trim(),
      temperature: Number($('cfg-temp').value) || 0.7
    });
    setStatus('设置已保存 ✓');
    setCfgStatus('设置已保存 ✓');
  }
  function testConnection() {
    saveSettings();
    setStatus('测试连接中…');
    setCfgStatus('测试连接中…');
    LLM.chat([{ role: 'user', content: '请只回复：ok' }]).then(function (r) {
      setStatus('连接成功，模型返回：' + r.slice(0, 50));
      setCfgStatus('连接成功 ✓ 模型返回：' + r.slice(0, 50));
    }).catch(function (err) {
      setStatus('连接失败：' + err.message, true);
      setCfgStatus('连接失败：' + err.message, true);
    });
  }

  /* ==================== 知识库页 ==================== */
  function fillKb() {
    if (!window.RAG) { $('kb-status').textContent = 'rag.js 未加载'; return; }
    RAG.fillStatus(function (s) { $('kb-status').textContent = s; });
    var cfg = RAG.load();
    $('kb-toggle').checked = cfg.enabled;
    $('kb-baseurl').value = cfg.baseUrl;
    $('kb-model').value = cfg.model;
    $('kb-topk').value = cfg.topK;
    $('kb-toggle').onchange = function () {
      RAG.saveField('enabled', $('kb-toggle').checked);
    };
    $('kb-save').onclick = function () {
      RAG.saveConfig({
        enabled: $('kb-toggle').checked,
        baseUrl: $('kb-baseurl').value.trim(),
        model: $('kb-model').value.trim(),
        topK: Number($('kb-topk').value) || 3
      });
      $('kb-status').textContent = '知识库设置已保存 ✓';
      RAG.fillStatus(function (s) { $('kb-status').textContent = s; });
    };
    $('kb-add').onclick = function () {
      var text = $('kb-text').value.trim();
      if (!text) { $('kb-status').textContent = '请先粘贴文档内容'; return; }
      $('kb-status').textContent = '正在切块并向量化…';
      RAG.addDocument(text, $('kb-title').value.trim() || '未命名文档').then(function (n) {
        $('kb-text').value = '';
        $('kb-status').textContent = '已入库 ' + n + ' 个片段 ✓';
        RAG.fillStatus(function (s) { $('kb-status').textContent = s; });
      }).catch(function (err) {
        $('kb-status').textContent = '入库失败：' + err.message;
      });
    };
    $('kb-clear').onclick = function () {
      if (!confirm('清空全部知识库片段？')) return;
      RAG.clear();
      RAG.fillStatus(function (s) { $('kb-status').textContent = s; });
    };
  }

  /* ==================== 工具中心 ==================== */
  function renderToolCenter() {
    var host = $('toolgrid');
    if (!host || !window.WTA_TOOLS) return;
    var labels = window.WTA_STATUS_LABEL || {};
    var html = '';
    window.WTA_TOOLS.forEach(function (cat) {
      html += '<div class="cat-title">' + cat.cat + '</div>';
      html += '<div class="cat-sub">' + cat.desc + '</div>';
      html += '<div class="tool-grid">';
      cat.items.forEach(function (it) {
        html += '<div class="tool-card' + (it.status === 'todo' ? ' todo' : '') + '" data-key="' + it.key + '">'
          + '<span class="badge ' + it.status + '">' + (labels[it.status] || '') + '</span>'
          + '<div class="ic">' + (function () {
            var f = (window.WTA_TOOL_ICON || {})[it.key];
            return f ? '<img src="images/' + f + '" alt="">' : it.icon;
          })() + '</div>'
          + '<div class="nm">' + it.name + '</div>'
          + '<div class="ds">' + it.desc + '</div>'
          + '</div>';
      });
      html += '</div>';
    });
    host.innerHTML = html;
    var cards = host.querySelectorAll('.tool-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].onclick = function () { onToolClick(this.getAttribute('data-key')); };
    }
  }

  function findTool(key) {
    if (!window.WTA_TOOLS) return null;
    for (var i = 0; i < window.WTA_TOOLS.length; i++) {
      var items = window.WTA_TOOLS[i].items;
      for (var j = 0; j < items.length; j++) if (items[j].key === key) return items[j];
    }
    return null;
  }

  // 外部站点：交给系统浏览器打开（面板在限制环境里不宜直接跳转）
  function openExternal(url) {
    if (!url) return;
    var fallback = function () {
      var opened = false;
      try { opened = !!window.open(url, '_blank'); } catch (e) { }
      if (!opened) {
        setStatus(svcDown
          ? '打不开「外部站点」—— 本地服务未连接（127.0.0.1:3889）。请双击「WPS工具助手-安装启动.exe」后再试'
          : '无法打开链接：' + url, true);
      }
    };
    try {
      fetch(serviceOrigin() + '/open?url=' + encodeURIComponent(url), { method: 'POST' })
        .then(function (r) { if (!r.ok) fallback(); })
        .catch(fallback);
    } catch (e) { fallback(); }
  }

  function onToolClick(key) {
    var it = findTool(key);
    if (!it) { setStatus('未找到工具：' + key, true); return; }
    if (it.status === 'link') { openExternal(it.url); setStatus('已在浏览器打开：' + it.name); return; }
    if (it.status === 'todo') { setStatus('「' + it.name + '」还在开发中', true); return; }
    if (it.status === 'ready') { executeReadyTool(key); return; }
    if (it.status === 'ai') { runAiTool(it); return; }
    activateTab('func');
    setStatus('已切到「功能」页 —— 选中内容后点相应动作（' + it.name + '）');
  }

  /* ==================== 文档排版指令（本地执行，不经过模型） ==================== */
  // 「改成红色字体」这类指令直接调 WPS JSAPI 改文档；模型只负责文本内容。
  function tryDocOp(text) {
    if (!window.WTA_DOC_OPS) return false;
    if (!WTA_DOC_OPS.looksLikeFormat(text)) return false;
    var r = WTA_DOC_OPS.run(text);
    if (r.ok) {
      var msg = '已应用：' + r.names + '\n范围：' + r.scope;
      if (r.failed && r.failed.length) msg += '\n未生效：' + r.failed.join('、');
      showResult(msg);
      currentAction = { mode: 'noop' };
      setStatus(r.kind === 'delete' ? '已删除 ✓（本地执行，没走模型）' : '已改文档格式 ✓（本地执行，没走模型）');
      return true;
    }
    if (r.reason === 'host') { setStatus(r.message, true); return true; }
    setStatus(r.message || '这条指令没能执行', true);
    showResult(WTA_DOC_OPS.HELP);
    return true;
  }

  // 输入框里的指令：能当排版/删除指令就本地执行；否则把「指令 + 选中原文」一起交给模型
  function runCommand(text) {
    var t = String(text || '').trim();
    if (!t) { setStatus('先输入一条指令', true); return; }
    if (tryDocOp(t)) return;

    var sel = '';
    try { if (HOST && HOST.type === 'wps') sel = getWriterSelection(); } catch (e) { sel = ''; }
    // 关键：模型拿不到选中的原文，就会反问「请把内容发给我」
    var prompt = sel
      ? '指令：' + t + '\n\n以下是选中的原文，请直接按指令处理它，不要反问我索要内容：\n' + sel
      : t;
    var act = {
      id: 'free-cmd', label: '指令', mode: sel ? 'replace' : 'insert',
      gather: function () { return prompt; },
      build: function (x) {
        return [
          { role: 'system', content: '你是中文办公文档助手。直接给出可用的结果，不要解释过程。' },
          { role: 'user', content: x }
        ];
      }
    };
    runAction(act);
  }

  // AI 类工具：每张卡片有自己的提示词，直接取选区/输入框内容跑一次
  function runAiTool(it) {
    activateTab('func');
    // 输入框里如果是排版指令（改成红色字体…），本地直接改文档，不问模型
    var typed = $('user-input') ? $('user-input').value.trim() : '';
    if (typed && tryDocOp(typed)) return;
    var cfg = it.ai || { sys: '你是中文办公文档助手，只输出结果。', user: '{text}' };
    var act = {
      id: it.key,
      label: it.name,
      mode: 'insert',
      gather: function () {
        var sel = HOST.type === 'wps' ? getWriterSelection() : '';
        if (sel && sel.trim()) return sel;
        var box = $('user-input');
        return box ? box.value.trim() : '';
      },
      build: function (text) {
        return [
          { role: 'system', content: cfg.sys },
          { role: 'user', content: String(cfg.user).replace('{text}', text) }
        ];
      }
    };

    var showInput = function (msg) {
      var row = $('input-row');
      if (row) row.classList.remove('hidden');
      var box = $('user-input');
      if (box) {
        box.placeholder = cfg.input || '在这里输入内容，然后点「生成」';
        try { box.focus(); } catch (e) { }
      }
      $('btn-input').onclick = function () { runAction(act); };
      setStatus(msg);
    };

    var pre = act.gather();
    // 独立窗口（PDF）里没有选区：先试剪贴板，再退回输入框
    if (!hasText(pre) && isStandalone()) {
      setStatus('正在读取剪贴板…');
      readClipboard().then(function (t) {
        if (hasText(t)) { act.gather = function () { return t; }; runAction(act); }
        else showInput('剪贴板里没有文字 —— 先在 PDF 里选中内容按 Ctrl+C；也可以直接粘到上方输入框');
      });
      return;
    }
    if (!hasText(pre)) {
      showInput('把内容粘贴到上方输入框（或先在文档里选中文字），再点「生成」');
      return;
    }
    runAction(act);
  }

  // 本地可执行工具
  function executeReadyTool(key) {
    if (key === 'word-replace') { wordBatchReplace(); return; }
    if (window.WTA_IMAGE && window.WTA_IMAGE[key]) { window.WTA_IMAGE[key](); return; }
    if (window.WTA_PDF && window.WTA_PDF[key]) { window.WTA_PDF[key](); return; }
    if (window.WTA_PDFX && window.WTA_PDFX[key]) { window.WTA_PDFX[key](); return; }
    if (window.WTA_DOC && window.WTA_DOC[key]) { window.WTA_DOC[key](); return; }
    if (window.WTA_WEB && window.WTA_WEB[key]) { window.WTA_WEB[key](); return; }
    if (window.WTA_OFFICE && window.WTA_OFFICE[key]) { window.WTA_OFFICE[key](); return; }
    setStatus('「' + key + '」暂未接入执行逻辑', true);
  }

  // Word 批量替换：每行一条「旧=>新」，保留原格式（走 Find/Replace）
  // 注意：不能用 window.prompt —— WPS 的 webview 不支持，点了只会「已取消」
  function wordBatchReplace() {
    if (HOST.type !== 'wps') { setStatus('请在 WPS 文字中使用（当前宿主：' + HOST.type + '）', true); return; }
    if (!window.TK || !TK.modal) { setStatus('工具界面组件未加载，请关闭面板重新打开', true); return; }
    TK.modal({
      title: '🔁 Word 批量替换',
      hint: '每行一条规则，格式：旧文本=>新文本。会替换当前文档里的全部匹配（保留原格式）。',
      runLabel: '开始替换',
      body:
        '<label class="tk-row tk-col"><span>替换规则（每行一条）</span>' +
        '<textarea id="wr-rules" rows="7" placeholder="2023=>2024&#10;张三=>李四&#10;旧电话=>新电话"></textarea></label>' +
        '<label class="tk-row tk-inline"><input id="wr-case" type="checkbox"><span>区分大小写（默认忽略）</span></label>',
      onRun: function () {
        var raw = TK.val('#wr-rules');
        var matchCase = TK.checked('#wr-case');
        var rules = [];
        String(raw || '').split('\n').forEach(function (line) {
          var t = line.replace(/\r$/, '');
          if (!t.trim()) return;
          var i = t.indexOf('=>');
          if (i < 0) return;
          var from = t.slice(0, i), to = t.slice(i + 2);
          if (from) rules.push([from, to]);
        });
        if (!rules.length) throw new Error('没有解析到规则。每行一条，格式：旧文本=>新文本');

        var doc = HOST.app.ActiveDocument;
        var done = [], failed = [];
        rules.forEach(function (r) {
          try {
            var f = doc.Content.Find;
            f.ClearFormatting();
            f.Replacement.ClearFormatting();
            var okExec = f.Execute(r[0], !!matchCase, false, false, false, false, true, 0, false, r[1], 2);
            // 个别桥接 Execute 无返回值：不报错即算成功
            if (okExec === false) failed.push(r[0] + '（没找到匹配）');
            else done.push(r[0] + ' => ' + r[1]);
          } catch (e) {
            failed.push(r[0] + '（' + e.message + '）');
          }
        });
        var msg = '已执行 ' + done.length + ' / ' + rules.length + ' 条替换 ✓'
          + (failed.length ? '\n未生效：\n' + failed.join('\n') : '');
        showResult(msg);
        currentAction = { mode: 'noop' };
        setStatus(done.length ? '批量替换完成 ✓（本地执行，没走模型）' : '替换没有生效 —— 请检查查找文本是否存在于文档中', !done.length);
      }
    });
  }

  /* ==================== 启动 ==================== */
  function activateTab(name) {
    var tabs = document.querySelectorAll('.tabs button');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    }
    ['tools', 'func', 'tpl', 'kb', 'cfg'].forEach(function (n) {
      var el = $('tab-' + n);
      if (el) el.classList.toggle('active', n === name);
    });
    if (name === 'kb') fillKb();
    if (name === 'tpl' && window.WTA_TPL) window.WTA_TPL.init();
  }

  function init() {
    // 先绑定关键按钮，避免后面任何一步抛错导致按钮“点了没反应”
    if ($('btn-save')) $('btn-save').onclick = saveSettings;
    if ($('btn-test')) $('btn-test').onclick = testConnection;

    /* 卡密激活区（设置页） */
    if (window.WTA_LICENSE) {
      var licState = $('lic-state');
      function renderLicState() {
        if (!licState) return;
        var L = WTA_LICENSE, c = L.cfg();
        var who = c.uid ? ('用户 ' + c.uid + (c.name ? '（' + c.name + '）' : '') + ' · ') : '';
        if (!L.serverConfigured()) {
          licState.textContent = '激活功能未启用（未配置激活服务器）—— AI 功能与离线工具均可直接使用';
          return;
        }
        if (L.unlocked()) {
          licState.textContent = who + '已激活 ✓' + (c.code ? '（卡密 ' + c.code + '，到期 ' + L.fmtTime(c.expiresAt) + '）' : '');
        } else {
          licState.textContent = who + '状态：' + L.stateText() + ' —— AI 功能暂不可用，请输入卡密激活';
        }
      }
      if ($('lic-name')) {
        $('lic-name').value = WTA_LICENSE.getName();
        var saveLicName = function () {
          var n = ($('lic-name').value || '').trim();
          if (!n || n === WTA_LICENSE.getName()) return;
          WTA_LICENSE.setName(n).then(function (ok) {
            var st = $('lic-status');
            if (st) st.textContent = ok ? ('用户名已保存：' + (WTA_LICENSE.getName() || n)) : '本地已记录，服务端暂时连不上，下次打开面板自动同步';
            renderLicState();
          });
        };
        $('lic-name').onchange = saveLicName;
        $('lic-name').onblur = saveLicName;
        try {
          window.addEventListener('wta:license', function () {
            if (document.activeElement !== $('lic-name')) $('lic-name').value = WTA_LICENSE.getName();
            renderLicState();
          });
        } catch (e) { }
      }
      if ($('lic-api')) $('lic-api').value = (WTA_LICENSE.cfg().api || WTA_LICENSE.defaultApi() || '');
      $('lic-api').placeholder = WTA_LICENSE.defaultApi() || 'https://your-server.com';
      renderLicState();
      if ($('lic-refresh')) $('lic-refresh').onclick = function () {
        var api = ($('lic-api').value || '').trim();
        WTA_LICENSE.setApiBase(api);
        renderLicState();
        var st = $('lic-status');
        if (st) st.textContent = api ? '已保存激活服务器地址' : (WTA_LICENSE.defaultApi() ? '已恢复默认激活服务器' : '已清空（激活功能关闭）');
      };
      if ($('lic-activate')) $('lic-activate').onclick = function () {
        var api = ($('lic-api').value || '').trim();
        WTA_LICENSE.setApiBase(api);
        var st = $('lic-status');
        var btn = this;
        btn.disabled = true;
        if (st) { st.textContent = '正在激活…'; st.style.color = ''; }
        WTA_LICENSE.activate($('lic-code').value).then(function (r) {
          btn.disabled = false;
          if (r.ok) {
            if (st) st.textContent = '激活成功 ✓ 有效期至 ' + WTA_LICENSE.fmtTime(r.expiresAt);
            $('lic-code').value = '';
            /* 激活后立刻按新套餐重拉模板，否则模板页还是激活前的锁定状态 */
            if (window.WTA_TPL) window.WTA_TPL.reload();
          } else {
            if (st) { st.textContent = r.error || '激活失败'; st.style.color = '#c0392b'; }
          }
          renderLicState();
        });
      };
      WTA_LICENSE.verify();   // 静默刷新到期时间
    }

    var tabs = document.querySelectorAll('.tabs button');
    for (var ti = 0; ti < tabs.length; ti++) {
      tabs[ti].onclick = function () { activateTab(this.getAttribute('data-tab')); };
    }
    $('btn-copy').onclick = function () {
      $('result').select();
      document.execCommand('copy');
      setStatus('已复制 ✓');
    };
    $('btn-apply').onclick = applyResult;

    // 排版指令行（仅 Writer 有意义）
    if (HOST.type === 'wps' && $('cmd-row')) {
      $('cmd-row').classList.remove('hidden');
      $('cmd-run').onclick = function () {
        runCommand($('cmd-input').value);
        $('cmd-input').value = '';
      };
      $('cmd-input').onkeydown = function (e) {
        if (e.keyCode === 13) { runCommand(this.value); this.value = ''; }
      };
    }

    renderActions();
    renderToolCenter();
    fillSettings();
    waitForHost(0);

    /* 支持 ?tab=tpl 直接打开某个页签（教程链接 / 自测用） */
    try {
      var mTab = /[?&]tab=(tools|func|tpl|kb|cfg)\b/.exec(location.search || '');
      if (mTab) activateTab(mTab[1]);
    } catch (e) { }

    // 从功能区按钮跳进来时，快捷键存在 localStorage（同源共享）
    try {
      var pending = localStorage.getItem('wta.pendingTool');
      if (pending) {
        localStorage.removeItem('wta.pendingTool');
        setTimeout(function () { onToolClick(pending); }, 250);
      }
    } catch (e) {}

    // 面板已打开时点功能区按钮：靠轮询这份“待执行”标记接力
    setInterval(function () {
      try {
        var p = localStorage.getItem('wta.pendingTool');
        if (p) { localStorage.removeItem('wta.pendingTool'); onToolClick(p); }
      } catch (e) {}
    }, 1200);

    svcWatch();

    // 选区提示：每 1.2 秒刷新一次（只读 Start/End，开销很小）
    refreshSelHint();
    setInterval(refreshSelHint, 1200);
  }

  // 本地服务（exe）是否活着 —— 它一挂，所有「选文件 / 存文件」都会 Failed to fetch
  var svcDown = false;
  function svcWatch() {
    if (!window.TK || !TK.ping) return;
    var tick = function () {
      TK.ping().then(function (ok) {
        if (!ok) {
          if (!svcDown) {
            svcDown = true;
            setStatus('本地服务未连接（127.0.0.1:3889）—— 请双击「WPS工具助手-安装启动.exe」，恢复后会自动提示', true);
          }
        } else if (svcDown) {
          svcDown = false;
          applyHostStatus();
        }
      });
    };
    tick();
    setInterval(tick, 6000);
  }

  function applyHostStatus() {
    if (HOST.type === 'unknown') {
      showStandaloneTip();
      var info = [];
      try { info.push('wps=' + (typeof wps)); } catch (e) { info.push('wps=err'); }
      try { info.push('et=' + (typeof et)); } catch (e) { info.push('et=err'); }
      try { info.push('wpp=' + (typeof wpp)); } catch (e) { info.push('wpp=err'); }
      setStatus('独立窗口模式：PDF / 图片工具可直接用，文字动作会读取剪贴板（' + info.join(', ') + '）');
    } else {
      setStatus('宿主：' + HOST.type.toUpperCase() + '，已就绪');
    }
  }

  /* ==================== 独立窗口提示条 ==================== */
  function showStandaloneTip() {
    var el = $('standalone-tip');
    if (!el) return;
    el.classList.remove('hidden');
    var btn = $('btn-clip');
    if (btn) btn.onclick = useClipboard;
    var close = $('btn-tip-close');
    if (close) close.onclick = function () { el.classList.add('hidden'); };
  }

  function useClipboard() {
    setStatus('正在读取剪贴板…');
    readClipboard().then(function (t) {
      if (!hasText(t)) { setStatus('剪贴板里没有文字：先在 PDF 里选中内容按 Ctrl+C', true); return; }
      activateTab('func');
      var row = $('input-row');
      if (row) row.classList.remove('hidden');
      var box = $('user-input');
      if (box) { box.value = t; try { box.focus(); } catch (e) {} }
      setStatus('已从剪贴板取到 ' + String(t).length + ' 字 —— 点上方的动作处理（或点「生成」）');
    });
  }

  /* ==================== 当前选中提示 ==================== */
  // 让用户清楚「点动作会拿什么去处理」：实时显示选中了多少字 / 多少单元格。
  // 之前最容易误解的就是：上一轮残留的选区被当成了这次要处理的内容。
  function refreshSelHint() {
    var el = $('sel-hint');
    if (!el) return;
    var h = HOST || { type: 'unknown', app: null };
    if (!h.app || h.type === 'unknown') { el.textContent = ''; el.className = 'sel-hint'; return; }
    var txt = '', has = false;
    try {
      if (h.type === 'wps') {
        var s = h.app.Selection;
        var n = Number(s.End || 0) - Number(s.Start || 0);
        if (!isFinite(n) || n <= 0) {
          // 少数桥接不暴露 Start/End，退回按文本长度估算
          n = String(s.Text || '').replace(/[\r\n]/g, '').length;
        }
        has = n > 0;
        txt = has ? ('已选中 ' + n + ' 字 —— 点动作只会处理这部分') : '未选中文字（点动作会处理光标所在段落）';
      } else if (h.type === 'et') {
        var sel = h.app.Selection;
        var cnt = Number(sel.Count || 0);
        has = cnt > 1;
        txt = has ? ('已选中 ' + cnt + ' 个单元格') : '当前 1 个单元格';
      } else if (h.type === 'wpp') {
        txt = '演示端：按当前页处理';
      }
    } catch (e) { txt = ''; }
    el.textContent = txt;
    el.className = 'sel-hint' + (txt ? (has ? ' has' : ' none') : '');
  }

  // WPS 注入 jsapi 可能晚于页面加载，轮询几次再下结论
  function waitForHost(attempt) {
    if (HOST.type !== 'unknown' || attempt >= 12) { applyHostStatus(); return; }
    setTimeout(function () {
      HOST = detectHost();
      if (HOST.type !== 'unknown') { renderActions(); applyHostStatus(); }
      else waitForHost(attempt + 1);
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
