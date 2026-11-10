/* WPS 工具助手 · 加载项入口（表格 ET）
 *
 * WPS 各版本注入的宿主对象并不统一：
 *   - 官方 Office 全局对象是 `wps`（所有进程都在）：wps.WpsApplication() / EtApplication() / WppApplication()
 *   - 部分版本额外暴露 VBA 风格的 `Application`
 *   - 顶层 `et` / `wpp` 在多数版本里 **不存在**，直接写 et.CreateTaskPane 会报 "et is not defined"
 * 所以这里按候选列表挨个试，谁有 CreateTaskPane 就用谁。
 */
var HOST_KIND = 'et';        // wps | et | wpp
var HOST_LABEL = 'WPS 表格';
var _taskPane = null;
var _autoOpened = false;
var AUTO_OPEN_PANEL = true;  // 加载项载入后自动弹出侧边栏

// 面板地址：以加载项所在目录为基准拼绝对 URL，避免 WPS 相对路径解析差异
function paneUrl() {
  try {
    var u = location.href.split('#')[0].split('?')[0];
    return u.replace(/[^\/]*$/, '') + 'panel.html';
  } catch (e) { return './panel.html'; }
}

function safeApp(bridge, getter) {
  try {
    if (bridge && typeof bridge[getter] === 'function') return bridge[getter]();
  } catch (e) { /* 非本进程的方法会抛错，忽略 */ }
  return null;
}

function paneCandidates() {
  var out = [];
  function push(o) { if (o && out.indexOf(o) < 0) out.push(o); }
  try { push(window.wps); } catch (e) {}
  try { push(window.Application); } catch (e) {}
  try { push(window[HOST_KIND]); } catch (e) {}
  try { if (window.external) push(window.external.Application); } catch (e) {}
  try {
    if (window.wps) {
      push(safeApp(window.wps, 'WpsApplication'));
      push(safeApp(window.wps, 'EtApplication'));
      push(safeApp(window.wps, 'WppApplication'));
    }
  } catch (e) {}
  return out;
}

// 诊断串：出错时直接告诉用户到底有哪些对象可用
function hostDiag() {
  var names = ['wps', 'Application', 'wps', HOST_KIND, 'et', 'wpp'], seen = {}, out = [];
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    if (seen[n]) continue;
    seen[n] = 1;
    var t = 'undefined';
    try { t = typeof window[n]; } catch (e) { t = 'err'; }
    out.push(n + '=' + t);
  }
  var api = null;
  for (var j = 0; j < paneCandidates().length; j++) {
    try {
      if (typeof paneCandidates()[j].CreateTaskPane === 'function' ||
          typeof paneCandidates()[j].CreateTaskpane === 'function') { api = j; break; }
    } catch (e) {}
  }
  out.push('api#' + (api === null ? 'none' : api));
  return out.join(' ');
}

function createPane(url) {
  var cands = paneCandidates();
  var lastErr = null;
  for (var i = 0; i < cands.length; i++) {
    var o = cands[i], fn = null;
    try {
      if (typeof o.CreateTaskPane === 'function') fn = o.CreateTaskPane;
      else if (typeof o.CreateTaskpane === 'function') fn = o.CreateTaskpane;
    } catch (e) { fn = null; }
    if (!fn) continue;
    try {
      var tp = fn.call(o, url, '工具助手');
      if (tp) return tp;
    } catch (e) { lastErr = e; }
  }
  throw new Error('没有可用的 CreateTaskPane（' + hostDiag() + '）' +
    (lastErr ? '；最后一次错误：' + (lastErr.message || lastErr) : ''));
}

function ensurePane() {
  if (_taskPane) return _taskPane;
  _taskPane = createPane(paneUrl());
  return _taskPane;
}

function showPane() {
  try {
    var p = ensurePane();
    p.Visible = true;
    return true;
  } catch (e) {
    try { console.log('[WTA] CreateTaskPane failed:', e && e.message, paneUrl()); } catch (x) {}
    return false;
  }
}

function OnAddinLoad(control) {
  if (!AUTO_OPEN_PANEL || _autoOpened) return;
  _autoOpened = true;
  // 等宿主界面初始化完成，太早调用 CreateTaskPane 会失败；失败就退避重试几次
  var tries = 0;
  (function attempt() {
    if (showPane()) return;
    if (++tries >= 4) return;
    setTimeout(attempt, 900 * tries);
  })();
}

function OnShowPanel(control) {
  try {
    var p = ensurePane();
    p.Visible = !p.Visible;
  } catch (e) {
    alert('无法打开助手面板：' + (e && e.message ? e.message : e) + '\n地址：' + paneUrl());
  }
}

// 功能区工具按钮：把工具 key 写进同源 localStorage，面板打开后自动定位
function OnTool(control) {
  var id = '';
  try { id = control.Id || control.id || ''; } catch (e) {}
  var map = (typeof WTA_RIBBON_MAP !== 'undefined' && WTA_RIBBON_MAP) || window.WTA_RIBBON_MAP || {};
  var key = map[id] || '';
  try { if (key) localStorage.setItem('wta.pendingTool', key); } catch (e) {}
  showPane();
}

// 功能区图标：WPS 调用 getImage 时按按钮 id 返回图片路径（相对加载项根目录）
function OnGetImage(control) {
  var id = '';
  try { id = control.Id || control.id || ''; } catch (e) {}
  var map = (typeof WTA_ICON_MAP !== 'undefined' && WTA_ICON_MAP) || window.WTA_ICON_MAP || {};
  return map[id] ? ('images/' + map[id]) : '';
}

function OnAbout(control) {
  alert('WPS 工具助手 v0.4.1（' + HOST_LABEL + '）\n本地工具：图片 / PDF 转换 / 文档生成 / 表格处理\nAI 能力：需在「模型设置」里配置接口（Ollama 或云端 API）');
}
