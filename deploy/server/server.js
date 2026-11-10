/*
 * WPS 工具助手 — 卡密服务端（零依赖，Node >= 16 直接运行）
 *
 *   node server.js                 # 默认端口 3910
 *   PORT=80 node server.js         # 自定义端口
 *   WTA_ADMIN_KEY=xxx node server.js
 *
 * 接口：
 *   POST /api/activate   {code, machine}          → 激活卡密，绑定设备，返回 token
 *   POST /api/verify     {token}                  → 校验 token 有效性
 *   GET  /api/admin/keys            （Header X-Admin-Key 或 Bearer token）列出卡密
 *   POST /api/admin/keys            生成卡密 {count, days}
 *   POST /api/admin/keys/reset      解绑设备 {code}
 *   POST /api/admin/keys/disable    停用/恢复 {code, disabled}
 *   POST /api/admin/keys/delete     删除卡密 {code} 或 {unused:true} 清空未激活
 *   POST /api/admin/keys/extend     续费 {code, days, amount?}
 *   GET  /api/admin/stats           经营概览 + 收入统计
 *   GET  /api/admin/orders?limit=   收入明细
 *   GET  /api/admin/events?limit=   操作日志
 *   POST /api/admin/login           管理员登录 {username, password} → token
 *   GET  /api/admin/account         当前登录身份
 *   GET/POST /api/admin/admins      管理员账号管理（仅 owner）
 *   POST /api/admin/users/ent       企业授权 {uid, on:true|false}（永久 enterprise 档）
 *   GET  /api/templates?token=&machine=   模板列表（按套餐标记 locked）
 *   GET  /api/templates/<id>              模板正文（服务端二次校验套餐）
 *   GET/POST /api/admin/templates         模板管理
 *   GET  /                          → 官网落地页（site/ 目录）
 *   GET  /download/<file>           → dist/ 目录（安装包分发）
 *
 * 数据：data/licenses.json（自动创建）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3910);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'licenses.json');
const SITE_DIR = path.join(ROOT, '..', 'site');
/* 安装包目录：本地构建在 dist/，线上部署放 download/（发布平台会剔除 dist 等构建产物目录名） */
const DIST_DIR = fs.existsSync(path.join(ROOT, '..', 'dist'))
  ? path.join(ROOT, '..', 'dist')
  : path.join(ROOT, '..', 'download');

/* ---------------- 管理员密钥 ---------------- */
function loadAdminKey() {
  if (process.env.WTA_ADMIN_KEY) return process.env.WTA_ADMIN_KEY;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const f = path.join(DATA_DIR, 'admin-key.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const key = 'admin-' + crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(f, key, 'utf8');
  return key;
}
const ADMIN_KEY = loadAdminKey();

/* ---------------- 存储 ---------------- */
let DB = { cards: {} };
function loadDB() {
  try { DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* 首次启动 */ }
  if (!DB.cards) DB.cards = {};
}
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(DB, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  }, 50);
}

/* ---------------- MySQL 数据层（JSON 兜底） ---------------- */
const store = require('./db');

/* ---------------- 工具函数 ---------------- */
function rand(n) { return crypto.randomBytes(n).toString('hex'); }
function genCode() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return 'WTA-' + seg() + '-' + seg() + '-' + seg();
}
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, X-Admin-Token, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}
const DAY = 86400 * 1000;

/* ---------------- 业务逻辑 ---------------- */
function findCard(code) { return DB.cards[String(code || '').trim().toUpperCase()] || null; }

/* 注册/心跳：面板启动时上报设备指纹 → 用户进库，返回用户编号/用户名与当前权限档位 */
async function apiRegister(req, body, res) {
  const machine = String(body.machine || '').trim().slice(0, 64);
  if (!machine) return json(res, 400, { error: '缺少 machine' });
  const name = String(body.name || '').trim().slice(0, 32);
  const u = await store.upsertUser(machine, {
    ip: req.socket.remoteAddress || '', ver: body.ver || '', wps: body.wps || '', name: name
  });
  const card = await store.findCard(String(body.code || '').trim().toUpperCase());
  const p = await store.userPlan(machine, card);
  await store.logEvent('register', machine, 'uid=' + (u ? u.uid : '') + ' name=' + (u ? u.name : '') + ' plan=' + p.plan);
  return json(res, 200, {
    ok: true, uid: u ? u.uid : '', name: u ? u.name : '',
    plan: p.plan, planUntil: p.until, source: p.source
  });
}

async function apiActivate(body, res) {
  const code = String(body.code || '').trim().toUpperCase();
  const machine = String(body.machine || '').trim().slice(0, 64);
  const card = await store.findCard(code);
  if (!card) return json(res, 404, { error: '卡密不存在，请检查输入' });
  if (card.disabled) return json(res, 403, { error: '卡密已停用，请联系卖家' });
  if (machine && card.machine && card.machine !== machine) {
    return json(res, 403, { error: '该卡密已绑定其他设备（每张卡密限一台电脑），如需换机请联系卖家重置' });
  }
  const now = Date.now();
  if (!card.activated_at) {
    await store.activateNew(code, machine, card.days);
  } else if (card.expires_at && card.expires_at < now) {
    return json(res, 403, { error: '卡密已过期（' + new Date(card.expires_at).toISOString().slice(0, 10) + '）' });
  }
  let token = card.token;
  if (!token) { token = rand(24); await store.setCardToken(code, token); }
  await store.touchCard(code);
  const fresh = await store.findCard(code);
  const p = await store.userPlan(machine, fresh);
  await store.attachOrder(code, machine || fresh.machine || '');
  await store.logEvent('activate', machine, code + ' plan=' + p.plan);
  return json(res, 200, { token, plan: p.plan, expiresAt: fresh.expires_at, code });
}

async function apiVerify(body, res) {
  const token = String(body.token || '').trim();
  const machine = String(body.machine || '').trim().slice(0, 64);
  const now = Date.now();
  let card = null, plan = 'free', until = 0;
  if (token) {
    card = await store.findCardByToken(token);
    if (card && !card.disabled && card.expires_at > now) {
      const p = await store.userPlan(card.machine, card);
      plan = p.plan; until = p.until;
      await store.touchCard(card.code);
    } else card = null;
  }
  if (plan === 'free' && machine) {
    /* 无 token：按设备查他绑定的卡 + 管理员直接下发的权限，取最高 */
    const mc = await store.findCardByMachine(machine);
    const p = await store.userPlan(machine, mc);
    if (p.plan !== 'free') { plan = p.plan; until = p.until; }
  }
  if (plan === 'free') return json(res, 200, { valid: false });
  await store.logEvent('verify', machine || (card && card.machine) || '', 'plan=' + plan);
  return json(res, 200, { valid: true, plan, expiresAt: until });
}

/* ---------------- 模板中心 ---------------- */
const PLAN_RANK = { free: 0, trial: 1, pro: 2, enterprise: 3 };
function canUse(userPlan, needPlan) {
  const u = PLAN_RANK[userPlan] === undefined ? 0 : PLAN_RANK[userPlan];
  const n = PLAN_RANK[needPlan] === undefined ? 2 : PLAN_RANK[needPlan];
  return u >= n;
}

/* 当前客户端的档位：先看 token，再看设备绑定的卡/下发权限 */
async function resolvePlan(token, machine) {
  if (token) {
    const card = await store.findCardByToken(token);
    if (card) {
      const p = await store.userPlan(card.machine, card);
      if (p.plan !== 'free') return p.plan;
    }
  }
  if (machine) {
    const mc = await store.findCardByMachine(machine);
    const p = await store.userPlan(machine, mc);
    if (p.plan !== 'free') return p.plan;
  }
  return 'free';
}

async function apiTemplates(url, res) {
  const token = String(url.searchParams.get('token') || '');
  const machine = String(url.searchParams.get('machine') || '').slice(0, 64);
  const plan = await resolvePlan(token, machine);
  const rows = await store.listTemplates();
  const list = rows.map(t => ({
    id: t.id, name: t.name, category: t.category, summary: t.summary,
    plan: t.plan, locked: !canUse(plan, t.plan)
  }));
  json(res, 200, { plan, count: list.length, templates: list });
}

async function apiTemplateOne(id, url, res) {
  const token = String(url.searchParams.get('token') || '');
  const machine = String(url.searchParams.get('machine') || '').slice(0, 64);
  const plan = await resolvePlan(token, machine);
  const t = await store.getTemplate(id);
  if (!t) return json(res, 404, { error: '模板不存在或已下架' });
  if (!canUse(plan, t.plan)) {
    return json(res, 403, { error: '该模板需要 ' + t.plan + ' 套餐，当前是 ' + plan, locked: true, need: t.plan, plan });
  }
  json(res, 200, { template: { id: t.id, name: t.name, category: t.category, plan: t.plan, summary: t.summary, body: t.body } });
}

async function adminListTpl(res) {  const rows = await store.adminListTemplates();
  const list = rows.map(t => ({
    id: t.id, name: t.name, category: t.category, plan: t.plan, summary: t.summary,
    body: t.body, enabled: !!t.enabled, sort: t.sort, updatedAt: t.updated_at
  }));
  json(res, 200, { count: list.length, templates: list });
}

async function adminSaveTpl(body, res) {  if (!String(body.name || '').trim()) return json(res, 400, { error: '模板名称不能为空' });
  if (!String(body.body || '').trim()) return json(res, 400, { error: '模板内容不能为空' });
  const id = await store.saveTemplate(body);
  await store.logEvent('template', '', (body.id ? 'edit ' : 'new ') + String(body.name).slice(0, 40));
  json(res, 200, { ok: true, id });
}

async function adminDeleteTpl(body, res) {  const n = await store.deleteTemplate(body.id);
  if (!n) return json(res, 404, { error: '模板不存在' });
  await store.logEvent('template', '', 'delete #' + body.id);
  json(res, 200, { ok: true, deleted: n });
}

async function adminToggleTpl(body, res) {  const n = await store.setTemplateEnabled(body.id, body.enabled !== false);
  if (!n) return json(res, 404, { error: '模板不存在' });
  json(res, 200, { ok: true, enabled: body.enabled !== false });
}

/* ---------------- 管理员身份 ----------------
 * 两种凭据：
 *  1) X-Admin-Key   本机密钥（bootstrap 自动读取），等同 owner
 *  2) Bearer token  管理员账号登录后下发，7 天有效，内存会话
 * 角色：owner（超管，可管理账号）/ manager（日常操作）
 */
const sessions = new Map();   // token → { username, role, exp }（本机单实例时用）
const SESSION_MS = 7 * 24 * 3600 * 1000;

/* 线上可能多实例轮询 → 管理员登录改用无状态签名 token（HMAC，任何实例都能验证） */
const ADMIN_SECRET = crypto.createHash('sha256').update('wta-sessions::' + ADMIN_KEY).digest('hex');
function makeToken(username, role) {
  const payload = Buffer.from(JSON.stringify({ u: username, r: role, e: Date.now() + SESSION_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function parseToken(tok) {
  const s = String(tok || '');
  const i = s.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = s.slice(0, i), sig = s.slice(i + 1);
  const expect = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  if (sig !== expect) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!p.e || p.e < Date.now()) return null;
    return { role: p.r, username: p.u, token: s };
  } catch (e) { return null; }
}

function auth(req) {
  if (req.headers['x-admin-key'] === ADMIN_KEY) {
    return { role: 'owner', username: '本机', local: true };
  }
  /* 平台网关会注入自己的 Authorization 头 → 自定义头 X-Admin-Token 优先，其次 Bearer */
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers['authorization'] || ''));
  const token = String(req.headers['x-admin-token'] || '').trim() || (bearer && bearer[1]);
  if (token) {
    const m = sessions.get(token);          // 旧版内存会话（本机兼容）
    if (m && m.exp > Date.now()) return { role: m.role, username: m.username, token: token };
    const p = parseToken(token);            // 无状态签名 token（线上多实例）
    if (p) return p;
  }
  return null;
}

function requireAdmin(req, res) {
  const a = auth(req);
  if (!a) { json(res, 401, { error: '未登录或密钥错误' }); return null; }
  return a;
}

function requireOwner(req, res) {
  const a = requireAdmin(req, res);
  if (a && a.role !== 'owner') { json(res, 403, { error: '该操作需要超级管理员权限' }); return null; }
  return a;
}

/* ---------------- 登录 / 账号管理 ---------------- */
async function adminLogin(body, res) {
  const username = String(body.username || '').trim().slice(0, 32);
  const password = String(body.password || '');
  if (!username || !password) return json(res, 400, { error: '请填写用户名和密码' });
  const a = await store.findAdminByName(username);
  if (!a || a.pass_hash !== store.hashPass(password, a.salt)) {
    return json(res, 401, { error: '用户名或密码错误' });
  }
  const token = makeToken(a.username, a.role);
  sessions.set(token, { username: a.username, role: a.role, exp: Date.now() + SESSION_MS });
  json(res, 200, { ok: true, token, username: a.username, role: a.role });
}

function adminAccount(req, res) {
  const a = auth(req);
  if (!a) return json(res, 401, { error: '未登录' });
  json(res, 200, { username: a.username, role: a.role, local: !!a.local });
}

async function adminLogout(req, res) {
  const a = auth(req);
  if (a && a.token) sessions.delete(a.token);
  json(res, 200, { ok: true });
}

async function adminAccList(res) {  const rows = await store.listAdmins();
  json(res, 200, { count: rows.length, admins: rows.map(a => ({
    id: a.id, username: a.username, role: a.role, createdAt: a.created_at
  })) });
}

async function adminAddAcc(body, res) {  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const role = body.role === 'owner' ? 'owner' : 'manager';
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{2,32}$/.test(username)) {
    return json(res, 400, { error: '用户名 2-32 位，字母/数字/下划线/中文' });
  }
  if (password.length < 6) return json(res, 400, { error: '密码至少 6 位' });
  if (await store.findAdminByName(username)) return json(res, 409, { error: '用户名已存在' });
  const id = await store.addAdmin(username, password, role);
  await store.logEvent('admin_add', '', username + ' (' + role + ')');
  json(res, 200, { ok: true, id, username, role });
}

async function adminDelAcc(body, res) {  const id = Number(body.id) || 0;
  const rows = await store.listAdmins();
  const target = rows.find(a => a.id === id);
  if (!target) return json(res, 404, { error: '账号不存在' });
  if (target.role === 'owner' && (await store.countOwners()) <= 1) {
    return json(res, 400, { error: '至少保留一个超级管理员' });
  }
  await store.delAdmin(id);
  await store.logEvent('admin_del', '', target.username);
  json(res, 200, { ok: true });
}

async function adminResetPass(body, res) {  const id = Number(body.id) || 0;
  const password = String(body.password || '');
  if (password.length < 6) return json(res, 400, { error: '密码至少 6 位' });
  const n = await store.setAdminPass(id, password);
  if (!n) return json(res, 404, { error: '账号不存在' });
  json(res, 200, { ok: true });
}

function maskToken(t) { return t ? t.slice(0, 6) + '…' : ''; }

async function adminList(res) {
  const rows = await store.listCards();
  const list = rows.map(c => ({
    code: c.code, days: c.days, disabled: !!c.disabled,
    machine: c.machine || '', uid: c.user_uid || '', name: c.user_name || '',
    activatedAt: c.activated_at || 0,
    expiresAt: c.expires_at || 0, lastSeen: c.last_seen || 0,
    price: c.price || 0, channel: c.channel || ''
  }));
  json(res, 200, { count: list.length, cards: list });
}

async function adminGen(body, res) {
  const count = Math.min(Math.max(Number(body.count) || 1, 1), 200);
  const days = Math.min(Math.max(Number(body.days) || 30, 1), 3650);
  const plan = String(body.plan || 'pro').slice(0, 16);
  const channel = String(body.channel || '').slice(0, 32);
  const price = Math.max(0, Math.round((Number(body.price) || 0) * 100));  // 元 → 分
  const made = await store.genCards(count, days, plan, price, channel);
  await store.logEvent('gen', '', made.join(',').slice(0, 200));
  json(res, 200, { generated: made.length, days, price, channel, codes: made });
}

/* 续费：延长卡密有效期，可顺手记一笔续费收入 */
async function adminExtend(body, res) {
  const code = String(body.code || '').trim().toUpperCase();
  const days = Math.min(Math.max(Number(body.days) || 30, 1), 3650);
  const amount = Math.max(0, Math.round((Number(body.amount) || 0) * 100));
  if (!code) return json(res, 400, { error: '缺少卡密' });
  const after = await store.extendCard(code, days);
  if (!after) return json(res, 404, { error: '卡密不存在' });
  if (amount > 0) {
    const uid = await store.uidOf(after.machine || '');
    await store.addOrder(code, uid, amount, '', 'renew');
  }
  await store.logEvent('extend', after.machine || '', code + ' +' + days + 'd');
  json(res, 200, {
    ok: true, code, days,
    expiresAt: after.expires_at || 0,
    activated: !!after.activated_at
  });
}

/* 收益统计 + 概览 */
async function adminStats(res) {
  const [ov, rv] = await Promise.all([store.overview(), store.revenueStats()]);
  json(res, 200, { overview: ov, revenue: rv });
}

async function adminOrders(res, url) {
  const rows = await store.listOrders(url.searchParams.get('limit'));
  const list = rows.map(o => ({
    id: o.id, code: o.code, uid: o.uid, name: o.user_name || '',
    amount: o.amount, channel: o.channel || '', kind: o.kind || 'sell',
    paidAt: o.paid_at || 0, note: o.note || ''
  }));
  json(res, 200, { count: list.length, orders: list });
}

/* 手动记一笔收入（收款码/转账收款后，管理员对账补录） */
async function adminIncome(body, res) {
  const amount = Math.max(0, Math.round((Number(body.amount) || 0) * 100));
  if (amount <= 0) return json(res, 400, { error: '金额要大于 0' });
  const channel = String(body.channel || '').slice(0, 32);
  const note = String(body.note || '').slice(0, 120);
  await store.addOrder('', '', amount, channel, 'manual', note);
  await store.logEvent('income', '', '手工入账 ' + (amount / 100).toFixed(2) + '元 ' + note);
  json(res, 200, { ok: true, amount });
}

async function adminEvents(res, url) {
  const rows = await store.listEvents(url.searchParams.get('limit'));
  const list = rows.map(e => ({
    id: e.id, ts: e.ts, type: e.type,
    uid: e.user_uid || '', name: e.user_name || '',
    machine: e.machine || '', detail: e.detail || ''
  }));
  json(res, 200, { count: list.length, events: list });
}

async function adminReset(body, res) {
  const code = String(body.code || '').trim().toUpperCase();
  const n = await store.resetCard(code);
  if (!n) return json(res, 404, { error: '卡密不存在' });
  await store.logEvent('reset', '', code);
  json(res, 200, { ok: true, code });
}

async function adminDisable(body, res) {
  const code = String(body.code || '').trim().toUpperCase();
  const disabled = body.disabled !== false;
  const n = await store.setCardDisabled(code, disabled);
  if (!n) return json(res, 404, { error: '卡密不存在' });
  await store.logEvent('disable', '', code + ' disabled=' + disabled);
  json(res, 200, { ok: true, code, disabled });
}

/* 删除卡密：{code} 删单张；{unused:true} 清空所有未激活的卡（误生成时用） */
async function adminDelete(body, res) {
  const code = String(body.code || '').trim().toUpperCase();
  const unused = body.unused === true;
  if (!code && !unused) return json(res, 400, { error: '请指定卡密，或清空未激活' });

  if (code) {
    const n = await store.deleteCard(code);
    if (!n) return json(res, 404, { error: '卡密不存在' });
    await store.logEvent('delete', '', code);
    return json(res, 200, { ok: true, code, deleted: 1 });
  }
  const n = await store.deleteUnusedCards();
  await store.logEvent('delete', '', 'unactivated x' + n);
  json(res, 200, { ok: true, deleted: n });
}

/* ---------------- 用户管理 / 权限下发 ---------------- */
async function adminUsers(res) {
  const rows = await store.listUsers();
  const now = Date.now();
  const list = rows.map(u => ({
    uid: u.uid || ('U' + String(u.id).padStart(6, '0')),
    name: u.name || ('用户' + String(u.id).padStart(6, '0')),
    machine: u.machine, ip: u.ip || '', ver: u.ver || '',
    firstSeen: u.first_seen, lastSeen: u.last_seen,
    plan: u.plan || 'free', planUntil: u.plan_until || 0,
    licPlan: u.lic_plan || '',
    active: (u.plan !== 'free' && u.plan_until > now) || (u.lic_expires > now && !u.lic_disabled),
    licCode: u.lic_code || '',
    licExpires: u.lic_expires || 0,
    spent: Number(u.spent) || 0,
    orderCnt: Number(u.order_cnt) || 0,
    lastPaid: u.last_paid || 0
  }));
  json(res, 200, { count: list.length, users: list });
}

/* 用户定位：优先用户编号（uid），兼容旧的 machine */
async function locateUser(body) {
  const uid = String(body.uid || '').trim().toUpperCase();
  if (uid) return await store.getUserByUid(uid);
  const machine = String(body.machine || '').trim().slice(0, 64);
  if (machine) return await store.getUser(machine);
  return null;
}

async function adminGrant(body, res) {
  const u = await locateUser(body);
  if (!u) return json(res, 404, { error: '用户不存在，请检查用户 ID' });
  const plan = String(body.plan || 'pro').slice(0, 16);
  const days = Math.min(Math.max(Number(body.days) || 30, 1), 3650);
  await store.grantUser(u.machine, plan, days);
  await store.logEvent('grant', u.machine, u.uid + ' ' + plan + ' +' + days + 'd');
  const after = await store.getUser(u.machine);
  json(res, 200, {
    ok: true, uid: u.uid, name: after ? after.name : u.name, plan, days,
    planUntil: after ? after.plan_until : 0
  });
}

async function adminRevoke(body, res) {  const u = await locateUser(body);
  if (!u) return json(res, 404, { error: '用户不存在，请检查用户 ID' });
  await store.revokeUser(u.machine);
  await store.logEvent('revoke', u.machine, u.uid);
  json(res, 200, { ok: true, uid: u.uid, name: u.name });
}

/* 企业授权：只给指定用户开 enterprise 档（100 年 ≈ 永久），再点一次取消 */
async function adminEntGrant(body, res) {  const u = await locateUser(body);
  if (!u) return json(res, 404, { error: '用户不存在，请检查用户 ID' });
  const on = body.on !== false;
  if (on) {
    await store.grantUser(u.machine, 'enterprise', 36500);
    await store.logEvent('grant', u.machine, u.uid + ' enterprise 授权（管理员指定）');
  } else {
    await store.revokeUser(u.machine);
    await store.logEvent('revoke', u.machine, u.uid + ' 取消企业授权');
  }
  const after = await store.getUser(u.machine);
  json(res, 200, {
    ok: true, uid: u.uid, name: after ? after.name : u.name,
    ent: on, plan: after ? after.plan : 'free', planUntil: after ? after.plan_until : 0
  });
}

async function adminRename(body, res) {  const name = String(body.name || '').trim().slice(0, 32);
  if (!name) return json(res, 400, { error: '用户名不能为空' });
  const u = await locateUser(body);
  if (!u) return json(res, 404, { error: '用户不存在，请检查用户 ID' });
  await store.renameUser(u.machine, name);
  await store.logEvent('rename', u.machine, u.uid + ' → ' + name);
  json(res, 200, { ok: true, uid: u.uid, name });
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.exe': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8'
};
function serveStatic(res, baseDir, rel, download) {
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(path.normalize(baseDir))) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 Not Found'); }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';   // 管理台改版后不用手动清缓存
    if (download) headers['Content-Disposition'] = 'attachment; filename="' + encodeURIComponent(path.basename(file)) + '"';
    res.writeHead(200, headers);
    res.end(data);
  });
}

/* ---------------- 服务 ---------------- */
loadDB();
(async () => {
  await store.init(DB.cards);
})();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  try {
    if (req.method === 'POST' && p === '/api/register') return await apiRegister(req, await readBody(req), res);
    if (req.method === 'POST' && p === '/api/activate') return await apiActivate(await readBody(req), res);
    if (req.method === 'POST' && p === '/api/verify') return await apiVerify(await readBody(req), res);

    /* 模板中心（客户端拉取，按套餐解锁） */
    if (req.method === 'GET' && p === '/api/templates') return await apiTemplates(url, res);
    if (req.method === 'GET' && p.startsWith('/api/templates/')) {
      return await apiTemplateOne(Number(p.slice('/api/templates/'.length)) || 0, url, res);
    }

    /* 仅本机：管理台自动取密钥（省得每次去 data/admin-key.txt 里翻） */
    if (req.method === 'GET' && p === '/api/admin/bootstrap') {
      /* 双重保险：源 IP 必须是回环地址，且 Host 头必须确实是本地地址。
         线上经网关反代时源 IP 可能表现为 127.0.0.1，但 Host 是公网域名 → 拒绝。 */
      const ip = String(req.socket.remoteAddress || '').replace('::ffff:', '');
      const host = String(req.headers.host || '').toLowerCase();
      const ipLocal = ip === '127.0.0.1' || ip === '::1';
      const hostLocal = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
      if (!(ipLocal && hostLocal)) {
        return json(res, 403, { error: '仅限本机访问' });
      }
      return json(res, 200, { key: ADMIN_KEY, port: PORT });
    }

    /* 登录 / 登出 / 当前身份：不需要预先持有凭据（登录本身即凭据校验） */
    if (req.method === 'POST' && p === '/api/admin/login') return await adminLogin(await readBody(req), res);
    if (p === '/api/admin/account' || p === '/api/admin/logout') {
      const a = auth(req);
      if (!a) return json(res, 401, { error: '未登录' });
      if (req.method === 'POST' && p === '/api/admin/logout') return adminLogout(req, res);
      return adminAccount(req, res);
    }

    if (p.startsWith('/api/admin/')) {
      const me = requireAdmin(req, res);
      if (!me) return;
      if (req.method === 'GET' && p === '/api/admin/keys') return await adminList(res);
      if (req.method === 'POST' && p === '/api/admin/keys') return await adminGen(await readBody(req), res);
      if (req.method === 'POST' && p === '/api/admin/keys/reset') return await adminReset(await readBody(req), res);
      if (req.method === 'POST' && p === '/api/admin/keys/disable') return await adminDisable(await readBody(req), res);
      if (req.method === 'POST' && p === '/api/admin/keys/delete') return await adminDelete(await readBody(req), res);
      if (req.method === 'POST' && p === '/api/admin/keys/extend') return await adminExtend(await readBody(req), res);
      if (req.method === 'GET' && p === '/api/admin/stats') return await adminStats(res);
      if (req.method === 'GET' && p === '/api/admin/orders') return await adminOrders(res, url);
      if (req.method === 'POST' && p === '/api/admin/income') return await adminIncome(await readBody(req), res);
      if (req.method === 'GET' && p === '/api/admin/events') return await adminEvents(res, url);
      if (req.method === 'GET' && p === '/api/admin/templates') return await adminListTpl(res);
      if (req.method === 'POST' && p === '/api/admin/templates') return await adminSaveTpl(await readBody(req), res);
      if (req.method === 'POST' && p === '/api/admin/templates/delete') return await adminDeleteTpl(await readBody(req), res);
      if (req.method === 'POST' && p === '/api/admin/templates/toggle') return await adminToggleTpl(await readBody(req), res);
      if (req.method === 'GET' && p === '/api/admin/users') return await adminUsers(res);
      if (req.method === 'POST' && p === '/api/admin/users/grant') return await adminGrant(await readBody(req), res);
      if (req.method === 'POST' && p === '/api/admin/users/revoke') return await adminRevoke(await readBody(req), res);
      if (req.method === 'POST' && p === '/api/admin/users/rename') return await adminRename(await readBody(req), res);
      if (req.method === 'POST' && p === '/api/admin/users/ent') return await adminEntGrant(await readBody(req), res);

      /* 管理员账号管理：仅超管 */
      if (p === '/api/admin/admins' || p.startsWith('/api/admin/admins/')) {
        if (!requireOwner(req, res)) return;
        if (req.method === 'GET' && p === '/api/admin/admins') return await adminAccList(res);
        if (req.method === 'POST' && p === '/api/admin/admins/add') return await adminAddAcc(await readBody(req), res);
        if (req.method === 'POST' && p === '/api/admin/admins/del') return await adminDelAcc(await readBody(req), res);
        if (req.method === 'POST' && p === '/api/admin/admins/pass') return await adminResetPass(await readBody(req), res);
      }
    }

    if (req.method === 'GET') {
      if (p === '/' || p === '/index.html') return serveStatic(res, SITE_DIR, 'index.html');
      if (p === '/admin' || p === '/admin.html') return serveStatic(res, ROOT, 'admin.html');
      if (p.startsWith('/download/')) return serveStatic(res, DIST_DIR, p.slice('/download/'.length), true);
      return serveStatic(res, SITE_DIR, p.slice(1));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: '服务器内部错误：' + e.message });
  }
});

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  WPS 工具助手 · 卡密服务端已启动');
  console.log('  地址:    http://127.0.0.1:' + PORT);
  console.log('  管理密钥: ' + ADMIN_KEY);
  console.log('  数据文件: ' + DATA_FILE + (store.dbReady() ? '（MySQL 已接管）' : ''));
  console.log('==============================================');
});
