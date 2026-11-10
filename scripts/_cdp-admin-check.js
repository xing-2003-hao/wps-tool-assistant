/* 无头 Edge + CDP 实测管理台：自动取密钥、刷新按钮、列表渲染 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = path.join(os.tmpdir(), 'wta-edge-admin-' + Date.now());
const PORT = 9444;
const URL = 'http://127.0.0.1:3910/admin';

const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.rmSync(UD, { recursive: true, force: true });
  const child = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + UD,
    '--no-first-run', '--disable-gpu', '--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*',
    '--allow-insecure-localhost', 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 30; i++) {
    try { list = JSON.parse(await get('http://127.0.0.1:' + PORT + '/json/list')); if (list && list.length) break; } catch (e) { }
    await sleep(300);
  }
  if (!list || !list.length) { console.log('ERR 浏览器没起来'); child.kill(); return; }
  const page = list.find(t => t.type === 'page') || list[0];

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = {}; const logs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push('console: ' + m.params.args.map(a => a.value).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
    if (m.method === 'Log.entryAdded') logs.push('log[' + m.params.entry.level + ']: ' + m.params.entry.text);
  });
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  const nav = await send('Page.navigate', { url: URL });
  console.log('navigate:', JSON.stringify(nav.result || nav.error || nav));
  await sleep(3000);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : (r.result && r.result.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails.text) : null);
  };

  console.log('页面标题:', await ev('document.title'));
  console.log('密钥已填:', await ev('($("key").value||"").length'));
  console.log('密钥状态:', await ev('$("keyState").textContent'));
  console.log('卡密表长度:', await ev('$("tbl").innerHTML.length'));
  console.log('卡密表首行:', await ev('($("tbl").querySelector("table")?"有表格":"无表格")'));
  console.log('最新一张卡行:', await ev('(document.querySelectorAll("#tbl tr")[1]||{}).innerText'));
  console.log('用户表:', await ev('$("utbl").innerHTML.slice(0,60)'));
  console.log('刷新按钮数:', await ev('Array.from(document.querySelectorAll("button")).filter(b=>b.textContent.trim()==="刷新").length'));

  /* 真实点击「刷新」（卡密列表的第一个刷新按钮） */
  await ev('Array.from(document.querySelectorAll("button")).filter(b=>b.textContent.trim()==="刷新")[0].click()');
  await sleep(1200);
  console.log('点刷新后 listMsg:', await ev('$("listMsg").textContent'));
  console.log('点刷新后 keyState:', await ev('$("keyState").textContent'));

  /* 点用户列表刷新 */
  await ev('Array.from(document.querySelectorAll("button")).filter(b=>b.textContent.trim()==="刷新")[1].click()');
  await sleep(1200);
  console.log('用户刷新后 userMsg:', await ev('$("userMsg").textContent'));

  if (logs.length) { console.log('--- 页面日志 ---'); logs.slice(0, 15).forEach(l => console.log(l)); }
  ws.close(); child.kill();
})().catch(e => { console.log('ERR', e.message); try { process.exit(0); } catch (e2) { } });
