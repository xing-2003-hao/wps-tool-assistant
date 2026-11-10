/*
 * 卡密激活模块（客户端）—— 完整版（AI 功能默认上闸）
 *
 * ★ 部署上线时只改这一行：DEFAULT_API 换成你的服务器地址（如 https://api.xxx.com）
 *   置为空字符串 '' 则回到「全放行」的免费版。
 *
 * 设计：
 *  - 「自带 Key」：用户在模型设置里填了自己的 API Key → 放行（自带钥匙不收费）
 *  - 「激活」：有 token 且未过期 → 放行
 *  - 「宽限」：服务器暂时不可达 → 72 小时内仍放行（服务挂了不坑付费用户）
 *  - 其余 → AI 调用前弹激活窗；离线工具（PDF/图片/表格）不受影响，永远免费
 *
 * 面板调用：window.WTA_LICENSE.ensureUnlock() → Promise<boolean>
 */
(function () {
  'use strict';

  var LS = 'wta.license';
  var GRACE_MS = 72 * 3600 * 1000;   // 离线宽限 72 小时
  var DEFAULT_API = 'https://wps-tool-assistant.app.workbuddy.host';   // ★ 公网激活服务器
  /* 发布平台链接校验码：平台网关要求每个请求携带（浏览器访问时自动记住，程序请求需手动带上） */
  var SHARE_CODE = 'YT3HRQMGYO';

  function cfg() {
    try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveCfg(c) { localStorage.setItem(LS, JSON.stringify(c)); }

  function machineId() {
    var m = localStorage.getItem('wta.machine');
    if (!m) {
      m = 'M-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem('wta.machine', m);
    }
    return m;
  }

  function apiBase() { return String(cfg().api || DEFAULT_API).replace(/\/+$/, ''); }
  function serverConfigured() { return !!apiBase(); }
  /* 给请求 URL 附加发布平台的 sharecode（有查询串时用 & 连接） */
  function apiUrl(path) {
    var u = apiBase() + path;
    if (!SHARE_CODE) return u;
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + SHARE_CODE;
  }

  /* 用户自己在模型设置填了 API Key → 不拦截 */
  function hasOwnKey() {
    try {
      var llm = JSON.parse(localStorage.getItem('wta.llm') || '{}');
      return !!(llm.apiKey && String(llm.apiKey).trim());
    } catch (e) { return false; }
  }

  /*
   * 状态机：
   *   off      未配置激活服务器（全放行）
   *   ownkey   用户自带 API Key（放行）
   *   active   已激活且有效（放行）
   *   expired  已过期
   *   locked   未激活
   */
  function state() {
    if (!serverConfigured()) return 'off';
    if (hasOwnKey()) return 'ownkey';
    var c = cfg();
    var now = Date.now();
    if (c.grantUntil && c.grantUntil > now) return 'active';   // 管理员直接下发的权限
    if (!c.token) return 'locked';
    if (c.expiresAt && c.expiresAt < now) return 'expired';
    return 'active';
  }
  function unlocked() {
    var s = state();
    return s === 'off' || s === 'ownkey' || s === 'active';
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function call(path, body) {
    return fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  /* 启动静默校验：网络失败不动 lastVerifyAt，靠宽限逻辑兜底 */
  function verify() {
    var c = cfg();
    if (!serverConfigured()) return Promise.resolve(false);
    if (!c.token && !(c.grantUntil > Date.now())) return Promise.resolve(false);
    return call('/api/verify', { token: c.token || '', machine: machineId() }).then(function (j) {
      if (j && j.valid) {
        c.expiresAt = j.expiresAt;
        c.plan = j.plan || 'pro';
        c.lastVerifyAt = Date.now();
        saveCfg(c);
        return true;
      }
      if (j && j.valid === false && c.token) {   // 服务端明确判无效（重置/停用/过期）→ 清 token（下发权限不受影响，register 会刷新）
        c.token = '';
        c.code = '';
        c.expiresAt = 0;
        saveCfg(c);
      }
      return false;
    }).catch(function () { return false; });   // 网络失败：保留 token 走宽限
  }

  function activate(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return Promise.resolve({ ok: false, error: '请输入卡密' });
    if (!serverConfigured()) return Promise.resolve({ ok: false, error: '未配置激活服务器地址' });
    return call('/api/activate', { code: code, machine: machineId() }).then(function (j) {
      if (j && j.token) {
        var c = cfg();
        c.token = j.token;
        c.code = code;
        c.expiresAt = j.expiresAt;
        c.plan = j.plan || 'pro';
        c.lastVerifyAt = Date.now();
        saveCfg(c);
        return { ok: true, expiresAt: j.expiresAt };
      }
      return { ok: false, error: (j && j.error) || '激活失败' };
    }).catch(function () {
      return { ok: false, error: '连不上激活服务器，请检查网络' };
    });
  }

  /* ---------------- 激活弹窗（内联样式，不依赖 panel.css） ---------------- */
  var STATE_TEXT = {
    locked: '未激活', expired: '已过期', off: '未启用', ownkey: '自带 Key'
  };

  function showDialog() {
    return new Promise(function (resolve) {
      var c = cfg();
      var mask = document.createElement('div');
      mask.id = 'wta-lic-mask';
      mask.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;';
      var box = document.createElement('div');
      box.style.cssText = 'background:#fff;border-radius:12px;padding:22px 20px 18px;width:320px;max-width:92%;font-size:13px;color:#222;box-shadow:0 8px 40px rgba(0,0,0,.25);font-family:inherit;';
      box.innerHTML =
        '<div style="font-size:15px;font-weight:500;margin-bottom:6px;">激活 AI 功能</div>' +
        '<div style="color:#666;line-height:1.6;margin-bottom:12px;">当前状态：<b>' + (STATE_TEXT[state()] || '未激活') + '</b>' +
        (c.expiresAt ? '（到期：' + fmtTime(c.expiresAt) + '）' : '') +
        '<br>离线工具（PDF / 图片 / 表格）免费，无需激活。AI 功能需要卡密，购买后输入即可。</div>' +
        '<input id="wta-lic-code" type="text" placeholder="WTA-XXXX-XXXX-XXXX" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px;margin-bottom:10px;" />' +
        '<div id="wta-lic-msg" style="color:#c0392b;min-height:18px;margin-bottom:8px;font-size:12px;"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button id="wta-lic-close" style="padding:7px 14px;border:1px solid #ccc;background:#f5f5f5;border-radius:8px;cursor:pointer;">关闭</button>' +
        '<button id="wta-lic-go" style="padding:7px 14px;border:none;background:#185fa5;color:#fff;border-radius:8px;cursor:pointer;">激活</button>' +
        '</div>';
      mask.appendChild(box);
      document.body.appendChild(mask);

      var input = box.querySelector('#wta-lic-code');
      var msg = box.querySelector('#wta-lic-msg');
      var done = false;
      function close(ok) {
        if (done) return;
        done = true;
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(ok);
      }
      box.querySelector('#wta-lic-close').onclick = function () { close(false); };
      mask.onclick = function (e) { if (e.target === mask) close(false); };

      var go = box.querySelector('#wta-lic-go');
      go.onclick = function () {
        var code = input.value;
        if (!code.trim()) { msg.textContent = '请输入卡密'; return; }
        go.disabled = true;
        go.textContent = '激活中…';
        msg.style.color = '#666';
        msg.textContent = '正在连接激活服务器…';
        activate(code).then(function (r) {
          go.disabled = false;
          go.textContent = '激活';
          msg.style.color = r.ok ? '#1d7a3e' : '#c0392b';
          if (r.ok) {
            msg.textContent = '激活成功！有效期至 ' + fmtTime(r.expiresAt);
            setTimeout(function () { close(true); }, 800);
          } else {
            msg.textContent = r.error || '激活失败';
          }
        });
      };
      input.onkeydown = function (e) { if (e.key === 'Enter') go.click(); };
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
    });
  }

  /*
   * AI 调用前统一入口：
   *   放行 → resolve(true)；用户关掉弹窗 → resolve(false)
   */
  function ensureUnlock() {
    if (unlocked()) return Promise.resolve(true);
    if (!serverConfigured()) return Promise.resolve(true);   // 双保险
    return showDialog().then(function (ok) {
      if (ok) verify();   // 后台刷新到期时间，不阻塞
      return ok;
    });
  }

  /* 启动上报：把本机指纹注册到服务端（用户进库），并取回管理员下发的权限 */
  /* 从 WPS 环境取当前用户名（用户在 WPS「设置-个人信息」里填的名字）。
     拿不到就算了——不弹窗、不要求用户输入任何东西。 */
  function wpsUserName() {
    try {
      var hosts = [];
      try { if (window.wps) hosts.push(window.wps); } catch (e0) { /* */ }
      try { if (window.WPS) hosts.push(window.WPS); } catch (e1) { /* */ }
      try { if (window.et) hosts.push(window.et); } catch (e2) { /* */ }
      try { if (window.wpp) hosts.push(window.wpp); } catch (e3) { /* */ }
      try { if (window.parent && window.parent.wps) hosts.push(window.parent.wps); } catch (e4) { /* */ }
      var apps = ['WpsApplication', 'EtApplication', 'WppApplication'];
      for (var i = 0; i < hosts.length; i++) {
        for (var j = 0; j < apps.length; j++) {
          try {
            var app = hosts[i][apps[j]] && hosts[i][apps[j]]();
            var n = app && app.UserName;
            if (n && String(n).trim()) return String(n).trim().slice(0, 32);
          } catch (e5) { /* jsapi 不可用则跳过 */ }
        }
      }
    } catch (e6) { /* */ }
    return '';
  }

  function register() {
    if (!serverConfigured()) return Promise.resolve(false);
    var c = cfg();
    return call('/api/register', {
      machine: machineId(), ver: 'panel-1.0', code: c.code || '',
      name: c.name || wpsUserName() || ''
    }).then(function (j) {
      if (j && j.ok) {
        var c = cfg();   // ★ 重新读：注册是异步的，期间用户可能刚完成激活，不能拿旧快照覆盖 token
        var changed = false;
        if (j.uid && c.uid !== j.uid) { c.uid = j.uid; changed = true; }
        if (j.name && c.name !== j.name) { c.name = j.name; changed = true; }
        if (j.plan !== 'free' && j.planUntil > Date.now()) {
          if (c.grantUntil !== j.planUntil || c.grantPlan !== j.plan) {
            c.grantPlan = j.plan; c.grantUntil = j.planUntil; changed = true;
          }
        } else if (c.grantUntil) {
          delete c.grantPlan; delete c.grantUntil; changed = true;   // 下发的权限已到期/被收回
        }
        if (changed) saveCfg(c);
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          try { window.dispatchEvent(new CustomEvent('wta:license', { detail: { uid: c.uid, name: c.name } })); } catch (e) { }
        }
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  /* 改用户名（幂等：本地先改，再上报同步到服务端） */
  function setName(name) {
    var n = String(name || '').trim().slice(0, 32);
    if (!n) return Promise.resolve(false);
    var c = cfg(); c.name = n; saveCfg(c);
    if (!serverConfigured()) return Promise.resolve(true);
    return call('/api/register', { machine: machineId(), ver: 'panel-1.0', code: c.code || '', name: n })
      .then(function (j) {
        if (j && j.ok) {
          var cc = cfg();
          if (j.uid) cc.uid = j.uid;
          if (j.name) cc.name = j.name;
          saveCfg(cc);
          return true;
        }
        return false;
      }).catch(function () { return false; });
  }

  /* 启动时若已激活，静默校验一次（刷新 lastVerifyAt 支撑宽限） */
  if (cfg().token && serverConfigured()) verify();
  register();   // 无条件上报：下载即进库
  /* 自动同步权限：管理台下发后，面板开着也能收到（每 5 分钟 + 切回面板时） */
  setInterval(function () { register(); }, 5 * 60 * 1000);
  try {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) register();
    });
  } catch (e) { /* 环境不支持则跳过 */ }

  window.WTA_LICENSE = {
    state: state,
    stateText: function () { return STATE_TEXT[state()] || '未知'; },
    unlocked: unlocked,
    ensureUnlock: ensureUnlock,
    activate: activate,
    verify: verify,
    register: register,
    setName: setName,
    getName: function () { return cfg().name || ''; },
    uid: function () { return cfg().uid || ''; },
    cfg: cfg,
    defaultApi: function () { return DEFAULT_API; },
    apiUrl: apiUrl,
    setDefaultApi: function (u) { DEFAULT_API = String(u || ''); },   // 仅供自测/免费版切换
    setApiBase: function (u) { var c = cfg(); c.api = String(u || '').trim(); saveCfg(c); },
    serverConfigured: serverConfigured,
    machineId: machineId,
    fmtTime: fmtTime
  };
})();
