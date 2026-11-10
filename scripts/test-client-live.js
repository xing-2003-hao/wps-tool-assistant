/**
 * 模拟 WPS 面板环境，用真实客户端代码跑线上全链路：
 * register → activate → verify → 模板列表 → 模板详情
 * 用法: node scripts/test-client-live.js [卡密]
 * 不传卡密则先调线上管理台发一张测试卡（用环境变量 ADMIN_USER/ADMIN_PASS）
 */
'use strict';
const path = require('path');
const vm = require('vm');

const BASE = 'https://wps-tool-assistant.app.workbuddy.host';
const SHARE = 'YT3HRQMGYO';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* 伪造 WPS 面板环境 */
function makeEnv() {
  const store = {};
  const sandbox = {
    console,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    fetch: (u, o) => fetch(u, o),
    setTimeout, clearTimeout,
    window: null
  };
  sandbox.window = sandbox;
  sandbox.dispatchEvent = () => {};
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(require('fs').readFileSync(path.join(__dirname, '..', 'common', 'license.js'), 'utf8'), ctx, { filename: 'license.js' });
  return { sandbox, ctx, store };
}

async function genTestCard() {
  const login = await fetch(BASE + '/api/admin/login?sharecode=' + SHARE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
  }).then(r => r.json());
  if (!login.token) throw new Error('管理台登录失败: ' + JSON.stringify(login));
  const r = await fetch(BASE + '/api/admin/keys?sharecode=' + SHARE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': login.token },
    body: JSON.stringify({ count: 1, days: 30, price: 12, channel: 'auto-test' })
  }).then(r => r.json());
  return r.codes[0];
}

async function main() {
  console.log('== 1) 直接 API 层验证（服务端） ==');
  const reg = await fetch(BASE + '/api/register?sharecode=' + SHARE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine: 'HARNESS-' + Math.random().toString(36).slice(2, 8), ver: 'harness-1.0' })
  }).then(r => r.json());
  ok('register 返回 uid', !!reg.uid, 'uid=' + reg.uid + ' plan=' + reg.plan);

  let code = process.argv[2];
  if (!code) {
    if (!ADMIN_PASS) { console.log('（未提供 ADMIN_PASS，跳过自动发卡，直接看未激活模板列表）'); }
    else code = await genTestCard().catch(e => { console.log('  发卡失败: ' + e.message); return null; });
    if (code) console.log('  自动发测试卡: ' + code);
  }

  console.log('== 2) 客户端代码全链路（模拟 WPS 面板） ==');
  const env = makeEnv();
  const L = env.sandbox.WTA_LICENSE;
  ok('license.js 加载 + 默认 API 指向线上', L.defaultApi().indexOf('https://') === 0, L.defaultApi());

  const planBefore = await L.currentPlan ? await L.currentPlan() : null;
  console.log('  （激活前档位: ' + planBefore + '）');

  if (code) {
    const ar = await L.activate(code);
    ok('activate 激活成功', !ar.error, 'plan=' + ar.plan + ' expiresAt=' + (ar.expiresAt ? new Date(ar.expiresAt).toISOString().slice(0, 10) : '-'));
  }

  console.log('== 3) 模板中心（templates.js，同面板逻辑） ==');
  const tplSrc = require('fs').readFileSync(path.join(__dirname, '..', 'common', 'templates.js'), 'utf8');
  /* templates.js 依赖 WTA_LICENSE.apiUrl — 确认存在 */
  ok('WTA_LICENSE.apiUrl 存在', typeof L.apiUrl === 'function', String(L.apiUrl ? L.apiUrl() : 'undefined').slice(0, 80));
  try {
    vm.runInContext(tplSrc, env.ctx, { filename: 'templates.js' });
    const T = env.sandbox.WTA_TPL;
    ok('templates.js 加载', !!T);
    const list = await T.load ? await T.load() : await T.list ? await T.list() : null;
    if (!list) { ok('模板加载接口存在', false, 'WTA_TPL 方法: ' + Object.keys(T).join(',')); }
  } catch (e) {
    ok('templates.js 加载', false, e.message);
  }

  /* 直接复刻 templates.js 的 getJson 逻辑验证接口（带 machine+token，与面板一致） */
  const machine = env.sandbox.localStorage.getItem('wta.machine');
  const tok = env.sandbox.localStorage.getItem('wta.license') || '';
  let tokVal = '';
  try { tokVal = (JSON.parse(tok) || {}).token || ''; } catch (e) { /* */ }
  const r2 = await fetch(BASE + '/api/templates?sharecode=' + SHARE + '&machine=' + encodeURIComponent(machine) + '&token=' + tokVal, { headers: { 'Cache-Control': 'no-store' } }).then(r => r.json());
  ok('GET /api/templates', (r2.count || 0) > 0, 'count=' + r2.count + ' plan=' + r2.plan + ' unlocked=' + (r2.templates || []).filter(t => !t.locked).length);

  if (code) {
    const firstPro = (r2.templates || []).find(t => !t.locked);
    if (firstPro) {
      const d = await fetch(BASE + '/api/templates/' + firstPro.id + '?sharecode=' + SHARE + '&machine=' + encodeURIComponent(machine) + '&token=' + tokVal, {}).then(r => r.json());
      ok('GET /api/templates/:id 解锁模板正文', !d.error && !!d.template, 'id=' + firstPro.id + ' 正文长度=' + (d.template ? d.template.length : 0));
    }
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('致命:', e); process.exit(1); });
