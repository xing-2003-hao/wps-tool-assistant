/* ============================================================
 * WPS 工具助手 · RAG 本地知识库模块
 * 流程：粘贴文档 → 按段落切块 → OpenAI-compatible /v1/embeddings
 *       向量化 → localStorage 存储 → 余弦相似度 top-k 检索
 * 兜底：Embedding 不可用时自动降级为关键词检索
 * ============================================================ */
(function () {
  'use strict';

  var CFG_KEY = 'wta.rag';
  var DOCS_KEY = 'wta.rag.docs';
  var MAX_CHUNKS = 300; // localStorage 容量保护

  var RAG = {
    defaults: {
      enabled: false,
      baseUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      topK: 3,
      chunkSize: 400,
      overlap: 50
    },

    load: function () {
      try {
        return Object.assign({}, this.defaults, JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
      } catch (e) { return Object.assign({}, this.defaults); }
    },
    saveConfig: function (cfg) {
      localStorage.setItem(CFG_KEY, JSON.stringify(Object.assign(this.load(), cfg)));
    },
    saveField: function (k, v) {
      var cfg = this.load(); cfg[k] = v;
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    },

    loadDocs: function () {
      try { return JSON.parse(localStorage.getItem(DOCS_KEY) || '[]'); } catch (e) { return []; }
    },
    saveDocs: function (docs) {
      localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
    },
    clear: function () { localStorage.removeItem(DOCS_KEY); },

    /* ---------- 文本切块：按段落聚合，块间带 overlap ---------- */
    splitText: function (text, size, overlap) {
      size = size || this.defaults.chunkSize;
      overlap = overlap == null ? this.defaults.overlap : overlap;
      var paras = String(text).replace(/\r\n/g, '\n').split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
      var chunks = [], cur = '', len = 0;
      paras.forEach(function (p) {
        // 单段超长 → 硬切
        while (p.length > size) {
          if (cur) { chunks.push(cur); cur = ''; len = 0; }
          chunks.push(p.slice(0, size));
          p = p.slice(size - overlap);
        }
        if (len + p.length > size && cur) {
          // 带重叠：保留上一块尾部
          var tail = cur.slice(-overlap);
          chunks.push(cur);
          cur = tail + p; len = tail.length + p.length;
        } else {
          cur += (cur ? '\n' : '') + p; len += p.length;
        }
      });
      if (cur) chunks.push(cur);
      return chunks;
    },

    /* ---------- Embedding 调用 ---------- */
    _embedUrl: function () { return this.load().baseUrl.replace(/\/+$/, '') + '/embeddings'; },
    // 与面板一致：优先走本地助手服务代理，绕开 webview 跨域
    _proxy: function (url) {
      try {
        if (location.protocol === 'http:' && location.host) {
          return location.origin + '/proxy?target=' + encodeURIComponent(url);
        }
      } catch (e) {}
      return null;
    },
    embed: function (texts) {
      var cfg = this.load();
      var url = this._embedUrl();
      var body = JSON.stringify({ model: cfg.model, input: texts });
      var direct = function () {
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
      };
      var p = this._proxy(url);
      var req = !p ? direct() : fetch(p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
      }).then(function (r) {
        if (r.status === 502) throw new Error('retry-direct');
        return r;
      }).catch(function () { return direct(); });

      return req.then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (t) {
            throw new Error('Embedding 接口失败 HTTP ' + resp.status + '：' + t.slice(0, 150));
          });
        }
        return resp.json();
      }).then(function (data) {
        if (!data.data || !data.data.length) throw new Error('Embedding 返回为空');
        return data.data.map(function (d) { return d.embedding; });
      });
    },

    /* ---------- 入库 ---------- */
    addDocument: function (text, title) {
      var self = this;
      var cfg = this.load();
      var chunks = this.splitText(text, cfg.chunkSize, cfg.overlap);
      if (!chunks.length) return Promise.reject(new Error('没有可入库的内容'));
      var docs = this.loadDocs();
      if (docs.length + chunks.length > MAX_CHUNKS) {
        return Promise.reject(new Error('知识库已达上限（' + MAX_CHUNKS + ' 片段），请清空后再添加'));
      }
      return this.embed(chunks).then(function (vectors) {
        vectors.forEach(function (vec, i) {
          docs.push({ title: title || '未命名', text: chunks[i], vec: vec });
        });
        self.saveDocs(docs);
        return chunks.length;
      });
    },

    /* ---------- 检索 ---------- */
    cosine: function (a, b) {
      var dot = 0, na = 0, nb = 0;
      for (var i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
    },
    keywordScore: function (query, text) {
      // 兜底：按 2-gram 关键词命中计分
      var q = query.replace(/[\s，。；、！？,.!?]/g, '');
      if (q.length < 2) return 0;
      var score = 0;
      for (var i = 0; i < q.length - 1; i++) {
        if (text.indexOf(q.substr(i, 2)) >= 0) score++;
      }
      return score / (q.length - 1);
    },
    search: function (query) {
      var self = this;
      var docs = this.loadDocs();
      if (!docs.length) return Promise.resolve(null);
      var topK = this.load().topK || 3;
      var useVector = !!docs[0].vec;
      var rank;
      if (useVector) {
        rank = this.embed([String(query).slice(0, 500)]).then(function (vecs) {
          var qv = vecs[0];
          return docs
            .map(function (d) { return { d: d, s: self.cosine(qv, d.vec) }; })
            .sort(function (x, y) { return y.s - x.s; })
            .slice(0, topK)
            .map(function (x) { return x.d; });
        }).catch(function () {
          return self._keywordRank(docs, String(query), topK);
        });
      } else {
        rank = Promise.resolve(this._keywordRank(docs, String(query), topK));
      }
      return rank.then(function (hits) {
        if (!hits || !hits.length) return null;
        return hits.map(function (d, i) {
          return '[' + (i + 1) + '] 来源：' + d.title + '\n' + d.text;
        }).join('\n---\n');
      });
    },
    _keywordRank: function (docs, query, topK) {
      return docs
        .map(function (d) { return { d: d, s: RAG.keywordScore(query, d.text) }; })
        .sort(function (x, y) { return y.s - x.s; })
        .slice(0, topK)
        .filter(function (x) { return x.s > 0; })
        .map(function (x) { return x.d; });
    },

    isEnabled: function () { return !!this.load().enabled && this.loadDocs().length > 0; },

    fillStatus: function (cb) {
      var docs = this.loadDocs();
      var cfg = this.load();
      cb('当前片段数：' + docs.length + (docs.length ? '，最近来源：' + docs[docs.length - 1].title : '') +
        '　|　检索模式：' + (cfg.enabled ? (docs.length && docs[0].vec ? '向量检索' : '关键词检索') : '已关闭'));
    }
  };

  window.RAG = RAG;
})();
