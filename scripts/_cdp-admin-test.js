/* 无头 Edge 冒烟测试：验证管理台「停用」按钮点击链路（内嵌 webview 兼容性回归） */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const ADMIN = process.env.ADMIN_KEY || fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'admin-key.txt'), 'utf8').trim();
const UD = path.join(os.tmpdir(), 'wta-edge-test');

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  fs.rmSync(UD, { recursive: true, force: true });
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + UD,
    '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 20; i++) {
    try { list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list')); if (list.length) break; } catch (e) {}
    await sleep(400);
  }
  if (!list) { console.log('FAIL 浏览器未启动'); process.exit(1); }

  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const pend = {};
  const events = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
    else if (m.method === 'Runtime.exceptionThrown') events.push(m.params.exceptionDetails.text + ' ' + JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ''));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') events.push('console.error');
  });
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await evalJS('localStorage.setItem("wta.admin.key", ' + JSON.stringify(ADMIN) + ')');
  await send('Page.navigate', { url: 'http://127.0.0.1:3910/admin' });
  await sleep(2500);

  const ok = (n, c) => console.log((c ? 'PASS ' : 'FAIL ') + n);
  ok('页面标题', (await evalJS('document.title')).includes('管理台'));
  ok('toggleCard 已定义', (await evalJS('typeof toggleCard')) === 'function');
  ok('ask 确认框已定义', (await evalJS('typeof ask')) === 'function');
  ok('卡密表格已渲染', (await evalJS('document.querySelectorAll("#tbl table tr").length')) > 1);

  /* 找一张未停用的卡，点它的「停用」 */
  const code = await evalJS('(function(){var c=document.querySelectorAll("#tbl table tr");for(var i=1;i<c.length;i++){var b=c[i].querySelector("button.warn");if(b){return c[i].querySelector("code").textContent;}}return "";})()');
  ok('找到可停用卡密: ' + code, !!code);
  await evalJS('toggleCard(' + JSON.stringify(code) + ', true)');
  await sleep(300);
  ok('自绘确认框已弹出', (await evalJS('!!document.getElementById("_ask_yes")')) === true);
  await evalJS('document.getElementById("_ask_yes").click()');
  await sleep(1200);
  const rowState = await evalJS('(function(){var c=document.querySelectorAll("#tbl table tr");for(var i=1;i<c.length;i++){if(c[i].querySelector("code").textContent===' + JSON.stringify(code) + ')return c[i].innerText;}return "";})()');
  ok('停用后状态变为「已停用」', rowState.indexOf('已停用') >= 0);
  ok('无 JS 异常', events.length === 0);
  if (events.length) console.log('异常:', events.slice(0, 3).join(' | '));

  /* 恢复现场 */
  await evalJS('toggleCard(' + JSON.stringify(code) + ', false)');
  await sleep(800);

  ws.close();
  edge.kill();
  console.log('done');
  process.exit(0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
