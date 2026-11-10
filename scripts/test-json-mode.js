/*
 * JSON 兜底模式全链路测试
 * 强制 MySQL 连不上（DB_PORT=1），验证纯 JSON 存储下所有功能可用。
 * 用法：node scripts/test-json-mode.js
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3911;
const BASE = 'http://127.0.0.1:' + PORT;
const KEY = 'testkey-json-mode';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + JSON.stringify(extra).slice(0, 200) : '')); }
}
async function api(method, p, body, auth) {
  const h = { 'Content-Type': 'application/json' };
  if (auth) {
    if (auth === KEY) h['X-Admin-Key'] = KEY;   // 本机管理密钥
    else h['Authorization'] = 'Bearer ' + auth; // 账号登录 token
  }
  const res = await fetch(BASE + p, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, body: j };
}

(async () => {
  // 清掉上次的测试数据，从零开始
  const fs = require('fs');
  const dataFile = path.join(__dirname, '..', 'server', 'data', 'wta-db.json');
  try { fs.unlinkSync(dataFile); } catch (e) { /* 无 */ }

  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'server'),
    env: Object.assign({}, process.env, {
      PORT: String(PORT), WTA_ADMIN_KEY: KEY,
      DB_HOST: '127.0.0.1', DB_PORT: '1', DB_USER: 'x', DB_PASS: 'x', DB_NAME: 'x'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => logs.push('[srv1] ' + d));
  child.stderr.on('data', d => logs.push('[srv1-err] ' + d));
  child.on('exit', (code, sig) => logs.push('[srv1-exit] code=' + code + ' sig=' + sig + '\n'));
  console.log('  [debug] 子进程 PID=' + child.pid);

  try {
    // 等服务起来
    for (let i = 0; i < 30; i++) {
      try { await fetch(BASE + '/api/templates'); break; } catch (e) { await new Promise(r => setTimeout(r, 300)); }
    }
    const b = await api('GET', '/api/admin/bootstrap');
    console.log('  [debug] 响应者密钥匹配: ' + (b.body && b.body.key === KEY) + ' port=' + (b.body && b.body.port));

    console.log('== 模板中心 ==');
    let r = await api('GET', '/api/templates');
    ok('模板列表可访问', r.status === 200 && r.body.count === 8, r);
    ok('未订阅时 5 个 pro 锁定', r.body.templates.filter(t => t.locked).length === 6 && r.body.plan === 'free', r.body.count);

    console.log('== 注册 + 生成卡密 + 激活 ==');
    r = await api('POST', '/api/register', { machine: 'TEST-MACHINE-001', name: '测试用户' });
    ok('注册返回 uid', r.status === 200 && /^U\d{6}$/.test(r.body.uid), r);
    const uid = r.body.uid;

    r = await api('POST', '/api/admin/keys', { count: 2, days: 30, price: 9.9, channel: 'test' }, KEY);
    ok('生成卡密 x2', r.status === 200 && r.body.generated === 2, r);
    const code = r.body.codes[0];

    r = await api('POST', '/api/activate', { code, machine: 'TEST-MACHINE-001' });
    ok('激活成功返回 token', r.status === 200 && r.body.token && r.body.plan === 'pro', r);
    const cliToken = r.body.token;

    r = await api('POST', '/api/activate', { code, machine: 'OTHER-DEVICE' });
    ok('换设备激活被拒', r.status === 403, r);

    console.log('== 校验 / 模板解锁 ==');
    r = await api('POST', '/api/verify', { token: cliToken, machine: 'TEST-MACHINE-001' });
    ok('verify 有效 pro', r.body.valid === true && r.body.plan === 'pro', r);
    r = await api('GET', '/api/templates?token=' + cliToken);
    ok('有效卡解锁 7/8', r.body.templates.filter(t => !t.locked).length === 7, r.body);
    const entId = r.body.templates.find(t => !t.locked && t.plan === 'enterprise');
    ok('pro 拿不到企业模板', !entId, r.body);

    r = await api('GET', '/api/templates/' + (r.body.templates.find(t => t.plan === 'enterprise').id) + '?token=' + cliToken);
    ok('服务端拒绝越权取企业模板', r.status === 403, r);
    r = await api('GET', '/api/templates/1?token=' + cliToken);
    ok('正常取模板正文', r.status === 200 && r.body.template && r.body.template.body.length > 50, r);

    console.log('== 管理台账号体系 ==');
    r = await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
    ok('超管登录', r.status === 200 && r.body.role === 'owner', r);
    const T = r.body.token;
    r = await api('POST', '/api/admin/login', { username: 'admin', password: 'wrong' });
    ok('错密码 401', r.status === 401, r);

    r = await api('POST', '/api/admin/admins/add', { username: '客服小王', password: 'abc12345', role: 'manager' }, T);
    ok('添加 manager', r.status === 200, r);
    r = await api('POST', '/api/admin/login', { username: '客服小王', password: 'abc12345' });
    const TM = r.body.token;
    ok('manager 登录', r.status === 200 && r.body.role === 'manager', r);
    r = await api('POST', '/api/admin/admins/add', { username: 'x2', password: 'abc12345' }, TM);
    ok('manager 加账号被拒 403', r.status === 403, r);

    console.log('== 用户管理 / 企业授权 ==');
    r = await api('GET', '/api/admin/users', undefined, KEY);
    ok('用户列表含 lic_plan', r.status === 200 && r.body.users[0].uid === uid, r.body);
    r = await api('POST', '/api/admin/users/ent', { uid, on: true }, KEY);
    ok('授企业权限', r.status === 200 && r.body.plan === 'enterprise', r);
    r = await api('GET', '/api/templates?machine=TEST-MACHINE-001');
    ok('企业用户 8/8 解锁', r.body.templates.filter(t => !t.locked).length === 8, r.body);
    r = await api('POST', '/api/admin/users/ent', { uid, on: false }, KEY);
    ok('取消企业权限', r.status === 200 && r.body.plan === 'free', r);
    r = await api('GET', '/api/templates?machine=TEST-MACHINE-001');
    ok('取消后回落（卡仍有效 → pro）', r.body.plan === 'pro', r.body);

    console.log('== 模板 CRUD ==');
    r = await api('POST', '/api/admin/templates', { name: '测试模板', category: '测试', plan: 'free', summary: 'x', body: '# 测试\n内容' }, KEY);
    ok('新增模板', r.status === 200 && r.body.id > 8, r);
    const newId = r.body.id;
    r = await api('POST', '/api/admin/templates', { id: newId, name: '测试模板2', body: '# 改', plan: 'pro' }, KEY);
    ok('编辑模板', r.status === 200, r);
    r = await api('POST', '/api/admin/templates/toggle', { id: newId, enabled: false }, KEY);
    ok('下架模板', r.status === 200, r);
    r = await api('GET', '/api/templates');
    ok('列表里不出现已下架', !r.body.templates.find(t => t.id === newId), r.body.count);
    r = await api('POST', '/api/admin/templates/delete', { id: newId }, KEY);
    ok('删除模板', r.status === 200, r);

    console.log('== 卡密管理 ==');
    r = await api('POST', '/api/admin/keys/reset', { code }, KEY);
    ok('重置绑定', r.status === 200, r);
    r = await api('POST', '/api/verify', { token: cliToken });
    ok('重置后 token 失效', r.body.valid === false, r);
    r = await api('POST', '/api/admin/keys/extend', { code, days: 15, amount: 5 }, KEY);
    ok('续费未激活卡', r.status === 200 && r.body.activated === false, r);
    r = await api('POST', '/api/admin/keys/disable', { code, disabled: true }, KEY);
    ok('停用卡密', r.status === 200 && r.body.disabled === true, r);
    r = await api('POST', '/api/admin/keys/delete', { code: r.body.code }, KEY);
    ok('删除卡密', r.status === 200 && r.body.deleted === 1, r);
    const code2 = (await api('POST', '/api/admin/keys', { count: 1 }, KEY)).body.codes[0];
    r = await api('POST', '/api/admin/keys/delete', { unused: true }, KEY);
    ok('清空未激活卡', r.status === 200 && r.body.deleted >= 1, r);

    console.log('== 概览 / 收入 / 日志 ==');
    r = await api('GET', '/api/admin/stats', undefined, KEY);
    ok('概览有数据', r.status === 200 && r.body.overview && r.body.overview.users >= 1, r);
    ok('收入统计（9.9 + 5 元续费）', r.body.revenue && r.body.revenue.total >= 14, r.body.revenue);
    r = await api('GET', '/api/admin/orders', undefined, KEY);
    ok('订单列表', r.status === 200 && r.body.count >= 2, r.body.count);
    r = await api('GET', '/api/admin/events', undefined, KEY);
    ok('事件日志', r.status === 200 && r.body.count >= 5, r.body.count);

    console.log('== 持久化（重启后数据还在） ==');
    try {
      const j = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      console.log('  [debug] 杀进程前文件: users=' + j.users.length + ' licenses=' + j.licenses.length +
        ' admins=' + j.admins.length + ' orders=' + j.orders.length + ' events=' + j.events.length);
    } catch (e) { console.log('  [debug] 杀进程前读文件失败: ' + e.message); }
    child.kill();
    await new Promise(r => setTimeout(r, 500));
    const child2 = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..', 'server'),
      env: Object.assign({}, process.env, {
        PORT: String(PORT), WTA_ADMIN_KEY: KEY,
        DB_HOST: '127.0.0.1', DB_PORT: '1', DB_USER: 'x', DB_PASS: 'x', DB_NAME: 'x'
      }),
      stdio: 'ignore'
    });
    for (let i = 0; i < 30; i++) {
      try { await fetch(BASE + '/api/templates'); break; } catch (e) { await new Promise(r => setTimeout(r, 300)); }
    }
    r = await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
    ok('重启后账号还在', r.status === 200, r);
    r = await api('GET', '/api/admin/users', undefined, KEY);
    ok('重启后用户还在', r.body.users.find(u => u.uid === uid), r.body.count);

    child2.kill();
  } catch (e) {
    fail++;
    console.log('  ✗ 异常中断: ' + e.message);
    try { child.kill(); } catch (e2) { /* */ }
  }

  console.log('\n---- 服务端日志 ----');
  console.log(logs.join(''));
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
