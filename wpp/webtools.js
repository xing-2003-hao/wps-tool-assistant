/* ============================================================
 * WPS 工具助手 · 网络小工具
 *   doc-video-nowm  短视频去水印：从分享文案里提取链接，
 *                   可选接入自己的解析接口（配置后自动调用并给出直链）
 * 说明：各平台都限制第三方直链，所以这里不内置破解逻辑，
 *       而是把「提取链接 → 调用你的解析接口 → 拿到无水印直链」这套流程做顺。
 * ============================================================ */
(function () {
  'use strict';

  function status(t, e) { if (window.WTA_setStatus) window.WTA_setStatus(t, e); }

  var PLATFORMS = [
    { re: /douyin\.com|iesdouyin\.com/i, name: '抖音' },
    { re: /kuaishou\.com|gifshow\.com/i, name: '快手' },
    { re: /xiaohongshu\.com|xhslink\.com/i, name: '小红书' },
    { re: /bilibili\.com|b23\.tv/i, name: 'B 站' },
    { re: /weibo\.com|weibo\.cn/i, name: '微博' },
    { re: /ixigua\.com/i, name: '西瓜视频' },
    { re: /pipix\.com/i, name: '皮皮虾' }
  ];

  function extractUrl(text) {
    var m = String(text || '').match(/https?:\/\/[^\s，。、"'\u3000）)】]+/i);
    return m ? m[0] : '';
  }
  function platformOf(url) {
    for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i].re.test(url)) return PLATFORMS[i].name;
    return '未知平台';
  }
  function cfg() {
    try { return JSON.parse(localStorage.getItem('wta.parseapi') || '{}'); } catch (e) { return {}; }
  }
  function saveCfg(o) { localStorage.setItem('wta.parseapi', JSON.stringify(o)); }

  // 从解析接口返回的 JSON 里挖出可能的直链
  function digLinks(obj, out, depth) {
    if (!obj || depth > 6) return out;
    if (typeof obj === 'string') {
      if (/^https?:\/\//i.test(obj) && /\.(mp4|m3u8|mov|jpg|jpeg|png)(\?|$)/i.test(obj)) out.push(obj);
      return out;
    }
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      obj.forEach(function (v) { digLinks(v, out, depth + 1); });
      return out;
    }
    if (typeof obj === 'object') {
      Object.keys(obj).forEach(function (k) { digLinks(obj[k], out, depth + 1); });
    }
    return out;
  }

  function copyText(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function openUrl(url) {
    try {
      fetch((location.protocol === 'http:' ? location.origin : 'http://127.0.0.1:3889') + '/open?url=' + encodeURIComponent(url), { method: 'POST' })
        .catch(function () { try { window.open(url, '_blank'); } catch (e) { } });
    } catch (e) { }
  }

  function videoNoWm() {
    var c = cfg();
    TK.modal({
      title: '🎬 短视频去水印',
      hint: '把 App 里复制的分享文案整段粘进来（含链接就行）。有自建/购买的解析接口时填在下面，会直接调用并给出无水印直链；没填则只提取链接并打开原页面。',
      runLabel: '解析链接',
      body:
        '<label class="tk-row tk-col"><span>分享文案 / 链接</span><textarea id="vn-text" rows="5" placeholder="7.36 复制打开抖音，看看【xxx】的作品 https://v.douyin.com/xxxxx/"></textarea></label>' +
        '<label class="tk-row tk-col"><span>解析接口（可选）</span><input id="vn-api" type="text" placeholder="https://your-api.com/parse"></label>' +
        '<label class="tk-row tk-inline"><input id="vn-post" type="checkbox" checked><span>用 POST JSON 调用（{"url": "..."}），不勾选则拼 ?url=</span></label>' +
        '<p class="tk-hint">解析接口返回 JSON 里只要带 mp4 / m3u8 链接就能识别出来。接口只保存在本机。</p>',
      onMount: function () {
        if (c.api) document.getElementById('vn-api').value = c.api;
      },
      onRun: function () {
        var text = TK.val('#vn-text');
        var api = (TK.val('#vn-api') || '').trim();
        var usePost = TK.checked('#vn-post');
        var url = extractUrl(text);
        if (!url) throw new Error('没在文案里找到链接，请重新复制分享内容');
        saveCfg({ api: api });
        var plat = platformOf(url);

        if (!api) {
          var copied = copyText(url);
          openUrl(url);
          status('已提取 ' + plat + ' 链接');
          TK.resultBox([], '平台：' + plat + '；链接已' + (copied ? '复制并' : '') + '在浏览器打开。' +
            '如需直接拿无水印直链，请在上方填写你自己的解析接口地址后重试。');
          return;
        }

        TK.msg('正在调用解析接口…');
        var target = api;
        var init;
        if (usePost) {
          init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url }) };
        } else {
          target = api + (api.indexOf('?') >= 0 ? '&' : '?') + 'url=' + encodeURIComponent(url);
          init = { method: 'GET' };
        }
        var proxied = (location.protocol === 'http:' ? location.origin : 'http://127.0.0.1:3889') +
          '/proxy?target=' + encodeURIComponent(target);

        return fetch(proxied, init).then(function (r) {
          if (!r.ok) throw new Error('解析接口返回 HTTP ' + r.status);
          return r.text();
        }).then(function (txt) {
          var json = null;
          try { json = JSON.parse(txt); } catch (e) { }
          var links = [];
          if (json) links = digLinks(json, [], 0);
          if (!links.length) {
            var m = String(txt).match(/https?:\/\/[^\s"'<>]+\.(mp4|m3u8)[^\s"'<>]*/i);
            if (m) links.push(m[0]);
          }
          if (!links.length) throw new Error('接口返回里没找到视频直链，请检查接口格式（需返回含 mp4/m3u8 的 JSON）');
          var uniq = [];
          links.forEach(function (l) { if (uniq.indexOf(l) < 0 && uniq.length < 6) uniq.push(l); });
          var copied = copyText(uniq[0]);
          openUrl(uniq[0]);
          status('解析成功，共 ' + uniq.length + ' 个直链');
          TK.resultBox([], '平台：' + plat + '；已' + (copied ? '复制首个直链并' : '') + '在浏览器打开' +
            (uniq.length > 1 ? '（共 ' + uniq.length + ' 个）' : ''));
        });
      }
    });
  }

  window.WTA_WEB = {
    'doc-video-nowm': videoNoWm
  };
})();
