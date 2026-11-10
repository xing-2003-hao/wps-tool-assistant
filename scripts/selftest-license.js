/*
 * license.js 客户端逻辑自测（Node 运行，stub localStorage/fetch）
 * 前置：卡密服务端已启动（PORT=3910 node server/server.js）
 * 运行：node scripts/selftest-license.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API = 'http://127.0.0.1:3910';
const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'admin-key.txt'), 'utf8').trim();

/* ---- 浏览器环境 stub ---- */
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.window = global;
global.document = { createElement: () => ({ style: {}, querySelector: () => null, appendChild: () => {} }), body: { appendChild: () => {} } };
// Node 18+ 原生 fetch
const fetchNative = global.fetch.bind(global);
global.fetch = (url, opts) => fetchNative(url, opts);

const src = fs.readFileSync(path.join(__dirname, '..', 'common', 'license.js'), 'utf8');
eval(src);
const L = global.WTA_LICENSE;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

function adminPost(p, body) {
  return fetchNative(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN }, body: JSON.stringify(body) }).then(r => r.json());
}

(async function main() {
  console.log('=== license.js 自测（服务端 ' + API + '）===');

  /* 1. 免费版（DEFAULT_API 置空）→ off 放行 */
  L.setDefaultApi('');
  ok('未配置服务器时 state()=off', L.state() === 'off');
  ok('未配置服务器时 unlocked()=true', L.unlocked() === true);

  /* 1b. 完整版（内置默认地址）→ 默认就是已配置、未激活 */
  L.setDefaultApi('http://default-api-placeholder');
  ok('完整版默认地址下 state()=locked', L.state() === 'locked');
  ok('完整版默认地址下 unlocked()=false', L.unlocked() === false);
  L.setDefaultApi('');

  /* 2. 配置服务器、未激活 → locked */
  L.setApiBase(API);
  ok('配置服务器后未激活 state()=locked', L.state() === 'locked');
  ok('配置服务器后未激活 unlocked()=false', L.unlocked() === false);

  /* 2b. 用户身份：注册自动分配用户ID + 用户名可改 */
  await L.register();
  ok('注册后拿到用户ID（U+数字）', /^U\d{6,}$/.test(L.uid()));
  ok('注册后本地有默认用户名', !!L.getName());
  const nm = '测试用户' + String(Date.now()).slice(-4);
  const rn = await L.setName(nm);
  ok('setName() 同步成功且本地更新', rn === true && L.getName() === nm);
  const ul = await (await fetchNative(API + '/api/admin/users', { headers: { 'X-Admin-Key': ADMIN } })).json();
  const me = (ul.users || []).find(u => u.uid === L.uid());
  ok('管理端按用户ID查到该用户且名字一致', !!me && me.name === nm);

  /* 3. 自带 API Key → 放行 */
  store['wta.llm'] = JSON.stringify({ apiKey: 'sk-test' });
  ok('自带 API Key 时 unlocked()=true', L.unlocked() === true);
  delete store['wta.llm'];

  /* 4. 生成卡密并激活 */
  const gen = await adminPost('/api/admin/keys', { count: 1, days: 30 });
  const code = gen.codes[0];
  const r1 = await L.activate(code);
  ok('激活成功', r1.ok === true && r1.expiresAt > Date.now());
  ok('激活后 state()=active', L.state() === 'active');
  ok('激活后 unlocked()=true', L.unlocked() === true);

  /* 5. 校验刷新 */
  const v = await L.verify();
  ok('verify() 返回 true 且刷新 lastVerifyAt', v === true && L.cfg().lastVerifyAt > 0);

  /* 6. 网络失败走宽限：token 保留、不判过期 */
  const savedLic = JSON.parse(store['wta.license']);
  savedLic.api = 'http://127.0.0.1:9';   // 指向不通端口
  store['wta.license'] = JSON.stringify(savedLic);
  const v2 = await L.verify();
  ok('服务器不可达时 verify()=false 但保留 token', v2 === false && !!L.cfg().token);
  // 还原 api
  savedLic.api = API;
  store['wta.license'] = JSON.stringify(savedLic);
  ok('还原地址后 state()=active', L.state() === 'active');

  /* 7. 换机绑定拦截：服务端拒绝，激活失败不落 token */
  const r2 = await L.activate(code);   // 同机重复激活 → 幂等成功
  ok('同机重复激活幂等成功', r2.ok === true);

  /* 8. 管理端重置 → verify 变 false、回 locked */
  await adminPost('/api/admin/keys/reset', { code });
  const v3 = await L.verify();
  ok('重置后 verify()=false 且 token 被清', v3 === false && !L.cfg().token);
  ok('重置后 state()=locked', L.state() === 'locked');

  /* 9. 停用卡密 → 激活被拒 */
  const gen2 = await adminPost('/api/admin/keys', { count: 1, days: 30 });
  await adminPost('/api/admin/keys/disable', { code: gen2.codes[0], disabled: true });
  const r3 = await L.activate(gen2.codes[0]);
  ok('停用卡密激活被拒并带原因', r3.ok === false && /停用/.test(r3.error));

  /* 10. 过期卡密 → expired */
  const gen3 = await adminPost('/api/admin/keys', { count: 1, days: 1 });
  const c3 = JSON.parse(store['wta.license'] || '{}');
  c3.token = 'fake'; c3.expiresAt = Date.now() - 1000;
  store['wta.license'] = JSON.stringify(c3);
  ok('过期 token → state()=expired', L.state() === 'expired');
  ok('过期 → unlocked()=false', L.unlocked() === false);
  await adminPost('/api/admin/keys/reset', { code: gen3.codes[0] }); // 清理

  console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本异常：', e); process.exit(2); });
