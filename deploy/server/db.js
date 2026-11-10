/*
 * WPS 工具助手 — MySQL 数据层（用户注册 + 卡密 + 权限下发）
 *
 * 设计：
 *  - MySQL 连不上时自动降级回 JSON 文件存储（服务不因数据库挂而停）
 *  - 首次连接自动建表；自动把 data/licenses.json 里的卡密迁移进库（只迁一次）
 *
 * 表：
 *  users     下载/使用过面板的用户（设备指纹去重），含权限档位 plan/plan_until
 *  licenses  卡密（从 licenses.json 迁移）
 *  events    关键事件流水（注册/激活/校验/下发），审计用
 */
'use strict';

let mysql = null;
try { mysql = require('mysql2/promise'); } catch (e) { /* 降级 JSON */ }

const DAY = 86400 * 1000;

const CONF = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'wta_server',
  password: process.env.DB_PASS || 'wta_2026_local',
  database: process.env.DB_NAME || 'wta_lic'
};

let pool = null;
let dbReady = false;

/* ================= JSON 兜底存储 =================
 * 无 MySQL（或连不上）时自动启用：单文件 server/data/wta-db.json
 * 字段结构与 MySQL 行完全一致，业务层无需感知用的是哪种存储。
 */
const fs = require('fs');
const jpath = require('path');
const jcrypto = require('crypto');
const JDIR = jpath.join(__dirname, 'data');
const JFILE = jpath.join(JDIR, 'wta-db.json');
const JCOLLS = ['users', 'licenses', 'templates', 'admins', 'orders', 'events'];
let J = null, jTimer = null;

function jload() {
  if (J) return J;
  try { J = JSON.parse(fs.readFileSync(JFILE, 'utf8')); } catch (e) { J = {}; }
  for (const c of JCOLLS) if (!Array.isArray(J[c])) J[c] = [];
  if (!J.seq) J.seq = {};
  for (const c of JCOLLS) if (!J.seq[c]) J.seq[c] = J[c].reduce((m, x) => Math.max(m, x.id || 0), 0);
  return J;
}
/* 同步立即写盘：数据量小（几十 KB 级），同步写消除「防抖期间进程被杀丢数据」的窗口 */
function jsave() {
  try {
    fs.mkdirSync(JDIR, { recursive: true });
    const tmp = JFILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(J, null, 2), 'utf8');
    fs.renameSync(tmp, JFILE);
  } catch (e) { console.log('[JSON] 写盘失败：' + e.message); }
}
function jnext(coll) { const Jd = jload(); Jd.seq[coll] = (Jd.seq[coll] || 0) + 1; return Jd.seq[coll]; }
function jfind(coll, fn) { return jload()[coll].find(fn) || null; }
function jUid(id) { return 'U' + String(id).padStart(6, '0'); }

async function jInit(jsonCards) {
  jload();
  /* 迁移旧版 licenses.json 卡密（幂等：只在空库时迁一次） */
  const legacy = jsonCards ? Object.values(jsonCards) : [];
  if (legacy.length && J.licenses.length === 0) {
    for (const c of legacy) {
      J.licenses.push({
        id: jnext('licenses'), code: c.code, days: c.days || 30, plan: 'pro',
        machine: c.machine || '', token: c.token || '', activated_at: c.activatedAt || 0,
        expires_at: c.expiresAt || 0, last_seen: c.lastSeen || 0, disabled: c.disabled ? 1 : 0,
        price: c.price || 0, channel: c.channel || '', note: '', created_at: c.createdAt || Date.now()
      });
    }
    console.log('[JSON] 已迁移 ' + legacy.length + ' 张旧版卡密');
  }
  jSeedTemplates();
  jSeedAdmin();
  jsave();
  console.log('[DB] JSON 文件存储已就绪: ' + JFILE);
  return false;
}

async function jSeedTemplates() {
  if (J.templates.length) return;
  const now = Date.now();
  for (const t of SEED_TEMPLATES) {
    J.templates.push({ id: jnext('templates'), name: t.name, category: t.category, plan: t.plan,
      summary: t.summary, body: t.body, enabled: 1, sort: t.sort, created_at: now, updated_at: now });
  }
  console.log('[JSON] 已写入 ' + SEED_TEMPLATES.length + ' 个内置模板');
}

async function jSeedAdmin() {
  if (J.admins.length) return;
  const salt = jcrypto.randomBytes(16).toString('hex');
  J.admins.push({ id: jnext('admins'), username: 'admin', pass_hash: hashPass('admin123', salt),
    salt, role: 'owner', created_at: Date.now() });
  console.log('[admins] 已创建初始超管：admin / admin123（请尽快在管理台改密）');
}

/* ---- 用户 ---- */
async function jUpsertUser(machine, info) {
  const now = Date.now();
  let u = jfind('users', x => x.machine === machine);
  if (!u) {
    const id = jnext('users');
    u = { id, uid: jUid(id), name: '', machine, ip: '', ver: '', wps_ver: '',
      first_seen: now, last_seen: now, plan: 'free', plan_until: 0 };
    J.users.push(u);
  }
  u.ip = info.ip || u.ip; u.ver = info.ver || u.ver; u.wps_ver = info.wps || u.wps_ver;
  u.last_seen = now;
  if (info.name) u.name = info.name;
  if (!u.name) u.name = '用户' + String(u.id).padStart(6, '0');
  jsave();
  return u;
}
function jGetUser(machine) { return jfind('users', x => x.machine === machine); }
function jGetUserByUid(uid) {
  const s = String(uid || '').trim().toUpperCase();
  return s ? jfind('users', x => x.uid === s) : null;
}
async function jRenameUser(machine, name) {
  const u = jfind('users', x => x.machine === machine);
  if (!u) return false;
  u.name = name; jsave(); return true;
}
async function jGrantUser(machine, plan, days) {
  const now = Date.now();
  let u = jfind('users', x => x.machine === machine);
  if (!u) {
    const id = jnext('users');
    u = { id, uid: jUid(id), name: '用户' + String(id).padStart(6, '0'), machine,
      ip: '', ver: '', wps_ver: '', first_seen: now, last_seen: now, plan: 'free', plan_until: 0 };
    J.users.push(u);
  }
  u.plan = plan;
  u.plan_until = Math.max(now, u.plan_until || 0) + days * DAY;
  jsave();
  return u;
}
async function jUserPlan(machine, card) {
  const now = Date.now();
  let plan = 'free', until = 0, source = '';
  const u = jGetUser(machine);
  if (u && u.plan && u.plan !== 'free' && u.plan_until > now) { plan = u.plan; until = u.plan_until; source = 'grant'; }
  if (card && !card.disabled && card.expires_at > now) {
    if (plan === 'free' || card.expires_at > until) { plan = card.plan || 'pro'; until = card.expires_at; source = 'card'; }
  }
  return { plan, until, source };
}

/* ---- 卡密 ---- */
function jFindCard(code) { return jfind('licenses', x => x.code === code); }
function jFindCardByToken(token) { return token ? jfind('licenses', x => x.token === token) : null; }
function jFindCardByMachine(machine) {
  const rows = jload().licenses.filter(x => x.machine && x.machine === machine)
    .sort((a, b) => b.expires_at - a.expires_at);
  return rows[0] || null;
}
async function jGenCards(count, days, plan, price, channel) {
  const seg = () => jcrypto.randomBytes(2).toString('hex').toUpperCase();
  const made = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const code = 'WTA-' + seg() + '-' + seg() + '-' + seg();
    J.licenses.push({ id: jnext('licenses'), code, days, plan: plan || 'pro', machine: '',
      token: '', activated_at: 0, expires_at: 0, last_seen: 0, disabled: 0,
      price: price || 0, channel: channel || '', note: '', created_at: now });
    if (price > 0) await jAddOrder(code, '', price, channel || '', 'sell');
    made.push(code);
  }
  jsave();
  return made;
}
async function jExtendCard(code, days) {
  const c = jFindCard(code);
  if (!c) return null;
  if (c.activated_at > 0) c.expires_at = Math.max(c.expires_at || 0, Date.now()) + days * DAY;
  else c.days = (c.days || 0) + days;
  jsave();
  return c;
}

/* ---- 订单 / 事件 ---- */
async function jAddOrder(code, uid, amount, channel, kind, note) {
  const now = Date.now();
  J.orders.push({ id: jnext('orders'), code: code || '', uid: uid || '', amount: Number(amount) || 0,
    channel: channel || '', kind: kind || 'sell', note: note || '', paid_at: now, created_at: now });
  jsave();
}
async function jListOrders(limit) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return jload().orders.slice().sort((a, b) => b.id - a.id).slice(0, n).map(o => {
    const l = jfind('licenses', x => x.code === o.code);
    const u = o.uid ? jfind('users', x => x.uid === o.uid) : null;
    return { ...o, card_days: l ? l.days : null, card_channel: l ? l.channel : null, user_name: u ? u.name : null };
  });
}
async function jRevenueStats() {
  const now = Date.now();
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const t0 = d.getTime();
  const os = jload().orders;
  const sum = f => os.filter(f).reduce((m, o) => m + (Number(o.amount) || 0), 0);
  const recent = os.filter(o => o.paid_at >= t0 - 30 * DAY);
  const ch = {};
  for (const o of recent) {
    const k = o.channel || '未标渠道';
    ch[k] = ch[k] || { channel: k, amount: 0, cnt: 0 };
    ch[k].amount += Number(o.amount) || 0; ch[k].cnt++;
  }
  return {
    today: sum(o => o.paid_at >= t0), week: sum(o => o.paid_at >= now - 7 * DAY),
    month: sum(o => o.paid_at >= now - 30 * DAY), total: sum(() => true), orders: os.length,
    byChannel: Object.values(ch).sort((a, b) => b.amount - a.amount)
  };
}
async function jLogEvent(type, machine, detail) {
  const Jd = jload();
  Jd.events.push({ id: jnext('events'), ts: Date.now(), type, machine: machine || '',
    detail: String(detail || '').slice(0, 250) });
  if (Jd.events.length > 2000) Jd.events = Jd.events.slice(-2000);   // 防无限膨胀
  jsave();
}
async function jListEvents(limit) {
  const n = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return jload().events.slice().sort((a, b) => b.id - a.id).slice(0, n).map(e => {
    const u = e.machine ? jfind('users', x => x.machine === e.machine) : null;
    return { ...e, user_uid: u ? u.uid : null, user_name: u ? u.name : null };
  });
}

/* ---- 概览 / 列表 ---- */
async function jOverview() {
  const now = Date.now();
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const t0 = d.getTime();
  const us = J.users, ls = J.licenses;
  return {
    users: us.length,
    active24: us.filter(u => u.last_seen >= now - DAY).length,
    newToday: us.filter(u => u.first_seen >= t0).length,
    actToday: ls.filter(c => c.activated_at >= t0).length,
    exp7: ls.filter(c => c.activated_at > 0 && !c.disabled && c.expires_at > now && c.expires_at <= now + 7 * DAY).length,
    unused: ls.filter(c => !c.activated_at && !c.disabled).length
  };
}
async function jListCards() {
  return jload().licenses.slice().sort((a, b) => b.created_at - a.created_at).map(l => {
    const u = l.machine ? jfind('users', x => x.machine === l.machine) : null;
    return { ...l, user_uid: u ? u.uid : null, user_name: u ? u.name : null };
  });
}
async function jListUsers() {
  const best = {};
  for (const l of jload().licenses) {
    if (!l.machine) continue;
    if (!best[l.machine] || l.created_at > best[l.machine].created_at) best[l.machine] = l;
  }
  /* 消费汇总：按订单的 uid 聚合 */
  const spent = {};
  for (const o of jload().orders) {
    if (!o.uid) continue;
    const s = spent[o.uid] = spent[o.uid] || { total: 0, cnt: 0, last: 0 };
    s.total += o.amount || 0; s.cnt++; s.last = Math.max(s.last, o.paid_at || 0);
  }
  return jload().users.slice().sort((a, b) => b.last_seen - a.last_seen).map(u => {
    const l = best[u.machine];
    const s = spent[u.uid] || { total: 0, cnt: 0, last: 0 };
    return { ...u, lic_code: l ? l.code : null, lic_expires: l ? l.expires_at : 0,
      lic_disabled: l ? l.disabled : 0, lic_plan: l ? l.plan : null,
      spent: s.total, order_cnt: s.cnt, last_paid: s.last || null };
  });
}

/* ---- 模板中心 ---- */
async function jListTemplates() {
  return jload().templates.filter(t => t.enabled === 1)
    .sort((a, b) => b.sort - a.sort || a.id - b.id);
}
async function jGetTemplate(id) { return jfind('templates', t => t.id === Number(id) && t.enabled === 1); }
async function jAdminListTemplates() {
  return jload().templates.slice().sort((a, b) => b.sort - a.sort || a.id - b.id);
}
async function jSaveTemplate(t) {
  const now = Date.now();
  const base = { name: String(t.name || '').slice(0, 64), category: String(t.category || '').slice(0, 32),
    plan: String(t.plan || 'pro').slice(0, 16), summary: String(t.summary || '').slice(0, 255),
    body: String(t.body || ''), enabled: t.enabled === false ? 0 : 1, sort: Number(t.sort) || 0, updated_at: now };
  if (t.id) {
    const row = jfind('templates', x => x.id === Number(t.id));
    if (!row) return 0;
    Object.assign(row, base);
    jsave();
    return Number(t.id);
  }
  const id = jnext('templates');
  J.templates.push({ id, ...base, created_at: now });
  jsave();
  return id;
}
async function jDeleteTemplate(id) {
  const i = J.templates.findIndex(x => x.id === Number(id));
  if (i < 0) return 0;
  J.templates.splice(i, 1);
  jsave();
  return 1;
}
async function jSetTemplateEnabled(id, enabled) {
  const row = jfind('templates', x => x.id === Number(id));
  if (!row) return 0;
  row.enabled = enabled ? 1 : 0;
  jsave();
  return 1;
}

/* ---- 管理员账号 ---- */
async function jListAdmins() {
  return jload().admins.slice().sort((a, b) => a.id - b.id)
    .map(a => ({ id: a.id, username: a.username, role: a.role, created_at: a.created_at }));
}
async function jAddAdmin(username, password, role) {
  const salt = jcrypto.randomBytes(16).toString('hex');
  const id = jnext('admins');
  J.admins.push({ id, username, pass_hash: hashPass(password, salt), salt,
    role: role === 'owner' ? 'owner' : 'manager', created_at: Date.now() });
  jsave();
  return id;
}
async function jDelAdmin(id) {
  const i = J.admins.findIndex(a => a.id === Number(id));
  if (i < 0) return 0;
  J.admins.splice(i, 1);
  jsave();
  return 1;
}
async function jSetAdminPass(id, password) {
  const a = jfind('admins', x => x.id === Number(id));
  if (!a) return 0;
  a.salt = jcrypto.randomBytes(16).toString('hex');
  a.pass_hash = hashPass(password, a.salt);
  jsave();
  return 1;
}
function jFindAdminByName(username) { return jfind('admins', a => a.username === username); }
async function jCountOwners() { return jload().admins.filter(a => a.role === 'owner').length; }

async function init(jsonCards) {
  if (!mysql) { return jInit(jsonCards); }
  try {
    pool = mysql.createPool({ ...CONF, connectionLimit: 10, waitForConnections: true });
    const conn = await pool.getConnection();
    conn.release();
    await createTables();
    await migrate(jsonCards);
    await seedTemplates();
    await seedAdmin();
    dbReady = true;
    console.log('[DB] MySQL 已连接: ' + CONF.database + '@' + CONF.host);
    return true;
  } catch (e) {
    console.log('[DB] MySQL 连接失败，降级 JSON：' + e.message);
    pool = null;
    return jInit(jsonCards);
  }
}

async function createTables() {
  const q = `
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    uid VARCHAR(16) DEFAULT '',
    name VARCHAR(64) DEFAULT '',
    machine VARCHAR(64) NOT NULL UNIQUE,
    ip VARCHAR(64) DEFAULT '',
    ver VARCHAR(32) DEFAULT '',
    wps_ver VARCHAR(32) DEFAULT '',
    first_seen BIGINT DEFAULT 0,
    last_seen BIGINT DEFAULT 0,
    plan VARCHAR(16) DEFAULT 'free',
    plan_until BIGINT DEFAULT 0,
    note VARCHAR(255) DEFAULT ''
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE IF NOT EXISTS licenses (
    code VARCHAR(24) PRIMARY KEY,
    days INT NOT NULL,
    plan VARCHAR(16) DEFAULT 'pro',
    machine VARCHAR(64) DEFAULT '',
    token VARCHAR(64) DEFAULT '',
    activated_at BIGINT DEFAULT 0,
    expires_at BIGINT DEFAULT 0,
    last_seen BIGINT DEFAULT 0,
    disabled TINYINT(1) DEFAULT 0,
    created_at BIGINT DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE IF NOT EXISTS events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ts BIGINT NOT NULL,
    type VARCHAR(32) NOT NULL,
    machine VARCHAR(64) DEFAULT '',
    detail VARCHAR(255) DEFAULT ''
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(24) DEFAULT '',
    uid VARCHAR(16) DEFAULT '',
    amount INT DEFAULT 0,
    channel VARCHAR(32) DEFAULT '',
    kind VARCHAR(16) DEFAULT 'sell',
    note VARCHAR(255) DEFAULT '',
    paid_at BIGINT DEFAULT 0,
    created_at BIGINT DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE IF NOT EXISTS templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    category VARCHAR(32) DEFAULT '',
    plan VARCHAR(16) DEFAULT 'pro',
    summary VARCHAR(255) DEFAULT '',
    body MEDIUMTEXT,
    enabled TINYINT(1) DEFAULT 1,
    sort INT DEFAULT 0,
    created_at BIGINT DEFAULT 0,
    updated_at BIGINT DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    pass_hash CHAR(64) NOT NULL,
    salt CHAR(32) NOT NULL,
    role VARCHAR(16) DEFAULT 'manager',
    created_at BIGINT DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  const conn = await pool.getConnection();
  try { for (const stmt of q.split(';').map(s => s.trim()).filter(Boolean)) await conn.query(stmt); }
  finally { conn.release(); }
  await ensureColumns();
}

/*
 * 老库升级：给 users 补 uid / name 两列，并回填历史用户
 * uid  = U + 6 位数字（U000007），对外展示的用户编号
 * name = 用户名，用户可自改；没填时默认「用户000007」
 */
async function ensureColumns() {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='users'`, [CONF.database]);
  const have = new Set(cols.map(r => r.c));
  if (!have.has('uid')) await pool.query("ALTER TABLE users ADD COLUMN uid VARCHAR(16) DEFAULT '' AFTER id");
  if (!have.has('name')) await pool.query("ALTER TABLE users ADD COLUMN name VARCHAR(64) DEFAULT '' AFTER uid");
  await backfillUsers();
  try { await pool.query('ALTER TABLE users ADD UNIQUE KEY uk_uid (uid)'); } catch (e) { /* 已存在或重复则跳过 */ }

  /* licenses 增补：售价（分）、渠道、备注 */
  try {
    const [lcols] = await pool.query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='licenses'`, [CONF.database]);
    const lhave = new Set(lcols.map(r => r.c));
    if (!lhave.has('price')) await pool.query('ALTER TABLE licenses ADD COLUMN price INT DEFAULT 0');
    if (!lhave.has('channel')) await pool.query("ALTER TABLE licenses ADD COLUMN channel VARCHAR(32) DEFAULT ''");
    if (!lhave.has('note')) await pool.query("ALTER TABLE licenses ADD COLUMN note VARCHAR(255) DEFAULT ''");
  } catch (e) { console.log('[DB] licenses 升级跳过：' + e.message); }
}

/* 补齐 uid / 默认用户名（幂等） */
async function backfillUsers() {
  await pool.query("UPDATE users SET uid=CONCAT('U', LPAD(id,6,'0')) WHERE uid IS NULL OR uid=''");
  await pool.query("UPDATE users SET name=CONCAT('用户', LPAD(id,6,'0')) WHERE name IS NULL OR name=''");
}

/* 把 JSON 时代的卡密搬进库（幂等：已存在 code 跳过） */
async function migrate(jsonCards) {
  if (!jsonCards) return;
  const cards = Object.values(jsonCards);
  if (!cards.length) return;
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM licenses');
  if (rows[0].n > 0) return; // 库里已有数据就不动
  for (const c of cards) {
    await pool.query(
      `INSERT IGNORE INTO licenses (code, days, plan, machine, token, activated_at, expires_at, last_seen, disabled, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [c.code, c.days || 30, 'pro', c.machine || '', c.token || '', c.activatedAt || 0,
       c.expiresAt || 0, c.lastSeen || 0, c.disabled ? 1 : 0, c.createdAt || Date.now()]
    );
  }
  console.log('[DB] 已从 licenses.json 迁移 ' + cards.length + ' 张卡密');
}

async function logEvent(type, machine, detail) {
  if (!dbReady) return;
  try { await pool.query('INSERT INTO events (ts, type, machine, detail) VALUES (?,?,?,?)',
    [Date.now(), type, machine || '', String(detail || '').slice(0, 250)]); } catch (e) { /* 忽略 */ }
}

/* ---------------- 用户（注册/心跳/权限） ---------------- */

async function upsertUser(machine, info) {
  const now = Date.now();
  const name = String((info && info.name) || '').trim().slice(0, 32);
  await pool.query(
    `INSERT INTO users (machine, ip, ver, wps_ver, first_seen, last_seen, name)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE ip=VALUES(ip), ver=VALUES(ver), wps_ver=VALUES(wps_ver), last_seen=VALUES(last_seen),
       name=IF(VALUES(name)='', name, VALUES(name))`,
    [machine, info.ip || '', info.ver || '', info.wps || '', now, now, name]
  );
  await backfillUsers();
  return getUser(machine);
}

async function getUser(machine) {
  const [rows] = await pool.query('SELECT * FROM users WHERE machine=?', [machine]);
  return rows[0] || null;
}

/* 按用户编号查（U000007），管理台下发/收回用 */
async function getUserByUid(uid) {
  const u = String(uid || '').trim().toUpperCase();
  if (!u) return null;
  const [rows] = await pool.query('SELECT * FROM users WHERE uid=?', [u]);
  return rows[0] || null;
}

/* 改名（用户自己在面板改，或管理员在后台改） */
async function renameUser(machine, name) {
  const n = String(name || '').trim().slice(0, 32);
  if (!n) return false;
  const [r] = await pool.query('UPDATE users SET name=? WHERE machine=?', [n, machine]);
  return r.affectedRows > 0;
}

/* 用户当前生效的订阅档位：卡密订阅 + 直接下发的权限，取最高 */
async function userPlan(machine, card) {
  const now = Date.now();
  let plan = 'free', until = 0, source = '';
  const u = await getUser(machine);
  if (u && u.plan && u.plan !== 'free' && u.plan_until > now) { plan = u.plan; until = u.plan_until; source = 'grant'; }
  if (card && !card.disabled && card.expires_at > now) {
    if (plan === 'free' || card.expires_at > until) { plan = card.plan || 'pro'; until = card.expires_at; source = 'card'; }
  }
  return { plan, until, source };
}

/* ---------------- 卡密 CRUD ---------------- */

async function findCard(code) {
  const [rows] = await pool.query('SELECT * FROM licenses WHERE code=?', [code]);
  return rows[0] || null;
}
async function findCardByToken(token) {
  const [rows] = await pool.query('SELECT * FROM licenses WHERE token=? AND token<>\'\'', [token]);
  return rows[0] || null;
}
async function findCardByMachine(machine) {
  const [rows] = await pool.query('SELECT * FROM licenses WHERE machine=? AND machine<>\'\' ORDER BY expires_at DESC', [machine]);
  return rows[0] || null;
}
async function genCards(count, days, plan, price, channel) {
  const crypto = require('crypto');
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  const made = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const code = 'WTA-' + seg() + '-' + seg() + '-' + seg();
    await pool.query(
      'INSERT INTO licenses (code, days, plan, created_at, price, channel) VALUES (?,?,?,?,?,?)',
      [code, days, plan || 'pro', now, price || 0, channel || '']
    );
    // 填了售价就算一笔进账（个人卖家流程：先收款再发卡）
    if (price > 0) await addOrder(code, '', price, channel || '', 'sell');
    made.push(code);
  }
  return made;
}

/* ---------------- 订单 / 收入 ---------------- */

/* machine → 用户编号（订单关联用户用） */
async function uidOf(machine) {
  if (!machine) return '';
  if (!dbReady) {
    const u = jfind('users', x => x.machine === machine);
    return (u && u.uid) || '';
  }
  const [r] = await pool.query('SELECT uid FROM users WHERE machine=? LIMIT 1', [machine]);
  return (r[0] && r[0].uid) || '';
}

/* 激活后回填订单的用户编号（先收款后发卡：发卡时不知道买家，激活时对上号） */
async function attachOrder(code, machine) {
  if (!code || !machine) return;
  const uid = await uidOf(machine);
  if (!uid) return;
  if (!dbReady) {
    let hit = 0;
    for (const o of jload().orders) {
      if (o.code === code && !o.uid) { o.uid = uid; hit++; }
    }
    if (hit) jsave();
    return;
  }
  await pool.query("UPDATE orders SET uid=? WHERE code=? AND (uid IS NULL OR uid='')", [uid, code]);
}

async function addOrder(code, uid, amount, channel, kind, note) {
  if (!dbReady) return;
  const now = Date.now();
  await pool.query(
    'INSERT INTO orders (code, uid, amount, channel, kind, note, paid_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [code || '', uid || '', Number(amount) || 0, channel || '', kind || 'sell', note || '', now, now]);
}

async function listOrders(limit) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const [rows] = await pool.query(
    `SELECT o.*, l.days AS card_days, l.channel AS card_channel, u.name AS user_name
     FROM orders o
     LEFT JOIN licenses l ON l.code = o.code
     LEFT JOIN users u ON u.uid = o.uid AND o.uid <> ''
     ORDER BY o.id DESC LIMIT ${n}`);
  return rows;
}

async function revenueStats() {
  const now = Date.now();
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const t0 = d.getTime();
  const [r] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN paid_at>=? THEN amount ELSE 0 END),0) AS today,
       COALESCE(SUM(CASE WHEN paid_at>=? THEN amount ELSE 0 END),0) AS week,
       COALESCE(SUM(CASE WHEN paid_at>=? THEN amount ELSE 0 END),0) AS month,
       COALESCE(SUM(amount),0) AS total,
       COUNT(*) AS orders
     FROM orders`, [t0, now - 7 * DAY, now - 30 * DAY]);
  const row = r[0] || {};
  const [byCh] = await pool.query(
    `SELECT channel, COALESCE(SUM(amount),0) AS amount, COUNT(*) AS cnt
     FROM orders WHERE paid_at>=? GROUP BY channel ORDER BY amount DESC`, [t0 - 30 * DAY]);
  return {
    today: Number(row.today) || 0, week: Number(row.week) || 0,
    month: Number(row.month) || 0, total: Number(row.total) || 0,
    orders: Number(row.orders) || 0,
    byChannel: byCh.map(x => ({ channel: x.channel || '未标渠道', amount: Number(x.amount) || 0, cnt: Number(x.cnt) || 0 }))
  };
}

/* 续费：已激活卡延长到期时间（从今天或原到期日取较晚者起算）；未激活卡直接加时长 */
async function extendCard(code, days) {
  const c = await findCard(code);
  if (!c) return null;
  const add = Number(days) * DAY;
  if (c.activated_at > 0) {
    await pool.query('UPDATE licenses SET expires_at = GREATEST(expires_at, ?) + ? WHERE code=?', [Date.now(), add, code]);
  } else {
    await pool.query('UPDATE licenses SET days = days + ? WHERE code=?', [Number(days), code]);
  }
  return findCard(code);
}

async function listEvents(limit) {
  const n = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const [rows] = await pool.query(
    `SELECT e.*, u.uid AS user_uid, u.name AS user_name
     FROM events e LEFT JOIN users u ON u.machine = e.machine AND e.machine <> ''
     ORDER BY e.id DESC LIMIT ${n}`);
  return rows;
}

/* 管理台顶部概览 */
async function overview() {
  const now = Date.now();
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const t0 = d.getTime();
  const [[u]] = await pool.query(
    'SELECT COUNT(*) AS total, COALESCE(SUM(last_seen>=?),0) AS active24, COALESCE(SUM(first_seen>=?),0) AS newToday FROM users',
    [now - DAY, t0]);
  const [[a]] = await pool.query(
    'SELECT COALESCE(SUM(activated_at>=?),0) AS actToday FROM licenses', [t0]);
  const [[e]] = await pool.query(
    'SELECT COUNT(*) AS exp7 FROM licenses WHERE activated_at>0 AND disabled=0 AND expires_at BETWEEN ? AND ?',
    [now, now + 7 * DAY]);
  const [[c]] = await pool.query(
    'SELECT COUNT(*) AS unused FROM licenses WHERE activated_at=0 AND disabled=0');
  return {
    users: Number(u.total) || 0, active24: Number(u.active24) || 0, newToday: Number(u.newToday) || 0,
    actToday: Number(a.actToday) || 0, exp7: Number(e.exp7) || 0, unused: Number(c.unused) || 0
  };
}
async function listCards() {
  const [rows] = await pool.query(
    `SELECT l.*, u.uid AS user_uid, u.name AS user_name
     FROM licenses l LEFT JOIN users u ON u.machine = l.machine
     ORDER BY l.created_at DESC`);
  return rows;
}
async function listUsers() {
  const [rows] = await pool.query(
    `SELECT u.*, l.code AS lic_code, l.expires_at AS lic_expires, l.disabled AS lic_disabled, l.plan AS lic_plan,
       COALESCE(s.total, 0) AS spent, COALESCE(s.cnt, 0) AS order_cnt, s.last_paid
     FROM users u
     LEFT JOIN licenses l ON l.machine = u.machine
     LEFT JOIN (SELECT uid, SUM(amount) AS total, COUNT(*) AS cnt, MAX(paid_at) AS last_paid
                FROM orders WHERE uid <> '' GROUP BY uid) s ON s.uid = u.uid
     ORDER BY u.last_seen DESC`);
  return rows;
}
async function grantUser(machine, plan, days) {
  const now = Date.now();
  const add = days * DAY;
  await pool.query(
    `INSERT INTO users (machine, first_seen, last_seen, plan, plan_until)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE plan=VALUES(plan),
       plan_until=GREATEST(?, COALESCE(plan_until,0)) + ?`,
    [machine, now, now, plan, now + add, now, add]
  );
  await backfillUsers();
  return getUser(machine);
}

/* ---------------- 模板中心 ---------------- */

/* 内置模板：首次建库时写入，之后可在管理台增删改 */
const SEED_TEMPLATES = [
  {
    name: '请假条', category: '行政', plan: 'free', sort: 90,
    summary: '事假/病假/年假通用，含交接与审批栏',
    body: [
      '# 请假条',
      '',
      '**申请人：**________　　**部门：**________　　**工号：**________',
      '',
      '## 一、请假类型',
      '□ 事假　　□ 病假　　□ 年假　　□ 调休　　□ 婚假　　□ 产假',
      '',
      '## 二、请假时间',
      '自 ______ 年 ____ 月 ____ 日 ____ 时 至 ______ 年 ____ 月 ____ 日 ____ 时，共 ____ 天。',
      '',
      '## 三、请假事由',
      '（请简要说明）',
      '',
      '## 四、工作交接',
      '本人请假期间的工作已交接给 ________，联系电话 ________。',
      '',
      '**申请人签字：**____________　　　**日期：**______ 年 ____ 月 ____ 日',
      '',
      '**部门负责人意见：**____________',
      '',
      '**人事部门意见：**____________'
    ].join('\n')
  },
  {
    name: '会议纪要', category: '行政', plan: 'free', sort: 89,
    summary: '议题、决议、待办三栏，直接能用',
    body: [
      '# 会议纪要',
      '',
      '**会议主题：**____________',
      '**会议时间：**____ 年 __ 月 __ 日 __:__ — __:__',
      '**会议地点：**____________',
      '**主 持 人：**________　　**记 录 人：**________',
      '',
      '## 一、参会人员',
      '____________',
      '',
      '## 二、议题与讨论',
      '### 1. 议题一',
      '（讨论要点）',
      '',
      '### 2. 议题二',
      '（讨论要点）',
      '',
      '## 三、决议事项',
      '',
      '| 序号 | 事项 | 负责人 | 完成时间 |',
      '| --- | --- | --- | --- |',
      '| 1 |  |  |  |',
      '| 2 |  |  |  |',
      '| 3 |  |  |  |',
      '',
      '## 四、待办跟进',
      '（下次会议时间、需提前准备的材料）'
    ].join('\n')
  },
  {
    name: '工作周报', category: '汇报', plan: 'pro', sort: 80,
    summary: '完成情况、数据、问题、下周计划',
    body: [
      '# 工作周报',
      '',
      '**姓名：**________　　**部门：**________　　**周期：**____ 年 __ 月 __ 日 — __ 月 __ 日',
      '',
      '## 一、本周完成',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## 二、数据与进展',
      '',
      '| 指标 | 目标 | 实际 | 完成率 |',
      '| --- | --- | --- | --- |',
      '|  |  |  |  |',
      '|  |  |  |  |',
      '',
      '## 三、问题与风险',
      '1. ',
      '',
      '## 四、下周计划',
      '1. ',
      '2. ',
      '',
      '## 五、需要的支持',
      '（需要谁配合、需要什么资源）'
    ].join('\n')
  },
  {
    name: '工作汇报', category: '汇报', plan: 'pro', sort: 79,
    summary: '背景、工作、成果、不足、计划五段式',
    body: [
      '# 工作汇报',
      '',
      '**汇报人：**________　　**部门/岗位：**________　　**汇报日期：**____ 年 __ 月 __ 日',
      '',
      '## 一、背景与目标',
      '',
      '## 二、主要工作',
      '### 1. ',
      '### 2. ',
      '',
      '## 三、成果与数据',
      '',
      '## 四、存在不足',
      '',
      '## 五、下一步计划'
    ].join('\n')
  },
  {
    name: '通知公告', category: '行政', plan: 'pro', sort: 78,
    summary: '符合公文习惯的抬头、正文、落款',
    body: [
      '# 关于____________的通知',
      '',
      '各部门、各位同事：',
      '',
      '　　为____________，经研究决定，现将有关事项通知如下：',
      '',
      '## 一、',
      '',
      '## 二、',
      '',
      '## 三、',
      '',
      '　　本通知自发布之日起执行，请各部门认真落实。',
      '',
      '　　特此通知。',
      '',
      '　　　　　　　　　　　　　　　　________（单位名称）',
      '　　　　　　　　　　　　　　　　____ 年 __ 月 __ 日'
    ].join('\n')
  },
  {
    name: '离职证明', category: '人事', plan: 'pro', sort: 70,
    summary: '标准表述，可直接盖章使用',
    body: [
      '# 离职证明',
      '',
      '兹证明 **________**（身份证号：________________）自 ______ 年 ____ 月 ____ 日 至 ______ 年 ____ 月 ____ 日 在我单位 ________ 部门担任 ________ 岗位。',
      '',
      '在职期间，该员工工作认真负责，与我单位劳动合同已于 ______ 年 ____ 月 ____ 日依法解除（终止），双方已办理完毕工作交接手续，不存在未了结的劳动争议。',
      '',
      '特此证明。',
      '',
      '　　　　　　　　　　　　　　　　________（单位名称，盖章）',
      '　　　　　　　　　　　　　　　　____ 年 __ 月 __ 日'
    ].join('\n')
  },
  {
    name: '项目计划书', category: '项目', plan: 'pro', sort: 68,
    summary: '交付物、里程碑、预算、风险四件套',
    body: [
      '# ____________项目计划书',
      '',
      '## 一、项目背景',
      '',
      '## 二、项目目标',
      '',
      '## 三、范围与交付物',
      '',
      '| 序号 | 交付物 | 说明 | 交付时间 |',
      '| --- | --- | --- | --- |',
      '| 1 |  |  |  |',
      '| 2 |  |  |  |',
      '',
      '## 四、里程碑计划',
      '',
      '| 阶段 | 开始 | 结束 | 负责人 |',
      '| --- | --- | --- | --- |',
      '|  |  |  |  |',
      '',
      '## 五、资源与预算',
      '',
      '## 六、风险与应对',
      '',
      '| 风险 | 影响 | 应对措施 |',
      '| --- | --- | --- |',
      '|  |  |  |'
    ].join('\n')
  },
  {
    name: '采购合同（简版）', category: '合同', plan: 'enterprise', sort: 60,
    summary: '标的、价款、交付、质保、违约、争议',
    body: [
      '# 采购合同',
      '',
      '**甲方（采购方）：**____________',
      '**乙方（供应方）：**____________',
      '',
      '根据《中华人民共和国民法典》及相关法律法规，甲乙双方本着平等自愿、诚实信用的原则，就甲方向乙方采购货物事宜达成如下协议：',
      '',
      '## 第一条 标的物',
      '',
      '| 序号 | 名称 | 规格型号 | 数量 | 单价（元） | 金额（元） |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 |  |  |  |  |  |',
      '| 合计 |  |  |  |  |  |',
      '',
      '## 第二条 价款与支付',
      '合同总金额人民币（大写）____________元整（¥________）。甲方于合同签订后 ____ 个工作日内支付 ____%，验收合格后支付余款。',
      '',
      '## 第三条 交付与验收',
      '乙方应于 ______ 年 ____ 月 ____ 日前将货物送达甲方指定地点，甲方应在收货后 ____ 个工作日内完成验收。',
      '',
      '## 第四条 质量保证',
      '乙方保证货物符合国家相关标准及本合同约定，质保期 ____ 个月，质保期内出现质量问题由乙方负责免费维修或更换。',
      '',
      '## 第五条 违约责任',
      '任何一方违约，应向守约方支付合同总金额 ____% 的违约金；因违约造成损失的，还应赔偿实际损失。',
      '',
      '## 第六条 争议解决',
      '本合同履行中发生争议，双方应协商解决；协商不成的，提交甲方所在地人民法院诉讼解决。',
      '',
      '## 第七条 其他',
      '本合同一式两份，甲乙双方各执一份，自双方签字盖章之日起生效。',
      '',
      '**甲方（盖章）：**____________　　**乙方（盖章）：**____________',
      '**授权代表：**____________　　　　**授权代表：**____________',
      '**日期：**____ 年 __ 月 __ 日　　　**日期：**____ 年 __ 月 __ 日'
    ].join('\n')
  }
];

async function seedTemplates() {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM templates');
  if (rows[0].n > 0) return;
  const now = Date.now();
  for (const t of SEED_TEMPLATES) {
    await pool.query(
      'INSERT INTO templates (name, category, plan, summary, body, enabled, sort, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?)',
      [t.name, t.category, t.plan, t.summary, t.body, t.sort, now, now]);
  }
  console.log('[DB] 已写入 ' + SEED_TEMPLATES.length + ' 个内置模板');
}

async function listTemplates() {
  const [rows] = await pool.query(
    'SELECT id, name, category, plan, summary, enabled, sort, updated_at FROM templates WHERE enabled=1 ORDER BY sort DESC, id ASC');
  return rows;
}

async function getTemplate(id) {
  const [rows] = await pool.query('SELECT * FROM templates WHERE id=? AND enabled=1', [Number(id)]);
  return rows[0] || null;
}

async function adminListTemplates() {
  const [rows] = await pool.query('SELECT * FROM templates ORDER BY sort DESC, id ASC');
  return rows;
}

async function saveTemplate(t) {
  const now = Date.now();
  const base = [String(t.name || '').slice(0, 64), String(t.category || '').slice(0, 32),
    String(t.plan || 'pro').slice(0, 16), String(t.summary || '').slice(0, 255),
    String(t.body || ''), t.enabled === false ? 0 : 1, Number(t.sort) || 0, now];
  if (t.id) {
    await pool.query(
      'UPDATE templates SET name=?, category=?, plan=?, summary=?, body=?, enabled=?, sort=?, updated_at=? WHERE id=?',
      base.concat([Number(t.id)]));
    return Number(t.id);
  }
  const [r] = await pool.query(
    'INSERT INTO templates (name, category, plan, summary, body, enabled, sort, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    base.concat([now]));
  return r.insertId;
}

async function deleteTemplate(id) {
  const [r] = await pool.query('DELETE FROM templates WHERE id=?', [Number(id)]);
  return r.affectedRows;
}

async function setTemplateEnabled(id, enabled) {
  const [r] = await pool.query('UPDATE templates SET enabled=? WHERE id=?', [enabled ? 1 : 0, Number(id)]);
  return r.affectedRows;
}

/* ---------------- 管理员账号 ---------------- */
const crypto = require('crypto');

function hashPass(password, salt) {
  return crypto.createHash('sha256').update(String(salt) + String(password)).digest('hex');
}

/* 首次启动播种一个超级管理员 admin / admin123 */
async function seedAdmin() {
  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM admins');
  if (row.n > 0) return;
  const salt = crypto.randomBytes(16).toString('hex');
  await pool.query(
    'INSERT INTO admins (username, pass_hash, salt, role, created_at) VALUES (?,?,?,?,?)',
    ['admin', hashPass('admin123', salt), salt, 'owner', Date.now()]
  );
  console.log('[admins] 已创建初始超管：admin / admin123（请尽快在管理台改密）');
}

async function listAdmins() {
  const [rows] = await pool.query('SELECT id, username, role, created_at FROM admins ORDER BY id');
  return rows;
}

async function addAdmin(username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  const [r] = await pool.query(
    'INSERT INTO admins (username, pass_hash, salt, role, created_at) VALUES (?,?,?,?,?)',
    [username, hashPass(password, salt), salt, role === 'owner' ? 'owner' : 'manager', Date.now()]
  );
  return r.insertId;
}

async function delAdmin(id) {
  const [r] = await pool.query('DELETE FROM admins WHERE id=?', [id]);
  return r.affectedRows;
}

async function setAdminPass(id, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const [r] = await pool.query('UPDATE admins SET pass_hash=?, salt=? WHERE id=?',
    [hashPass(password, salt), salt, id]);
  return r.affectedRows;
}

async function findAdminByName(username) {
  const [rows] = await pool.query('SELECT * FROM admins WHERE username=?', [username]);
  return rows[0] || null;
}

async function countOwners() {
  const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM admins WHERE role='owner'");
  return row.n;
}

/* ---------------- 卡密便捷操作（两种存储通用） ---------------- */
/* 首次激活：写入激活时间/到期时间/绑定设备 */
async function activateNew(code, machine, days) {
  const now = Date.now();
  if (!dbReady) {
    const c = jfind('licenses', x => x.code === code);
    if (!c) return 0;
    c.activated_at = now;
    c.expires_at = now + (Number(days) || 30) * DAY;
    c.machine = machine || 'unknown';
    jsave();
    return 1;
  }
  const [r] = await pool.query(
    'UPDATE licenses SET activated_at=?, expires_at=?, machine=? WHERE code=?',
    [now, now + (Number(days) || 30) * DAY, machine || 'unknown', code]);
  return r.affectedRows;
}
/* 写入访问令牌 */
async function setCardToken(code, token) {
  if (!dbReady) {
    const c = jfind('licenses', x => x.code === code);
    if (!c) return 0;
    c.token = token; jsave(); return 1;
  }
  const [r] = await pool.query('UPDATE licenses SET token=? WHERE code=?', [token, code]);
  return r.affectedRows;
}
/* 心跳：刷新 last_seen */
async function touchCard(code) {
  const now = Date.now();
  if (!dbReady) {
    const c = jfind('licenses', x => x.code === code);
    if (!c) return 0;
    c.last_seen = now; jsave(); return 1;
  }
  const [r] = await pool.query('UPDATE licenses SET last_seen=? WHERE code=?', [now, code]);
  return r.affectedRows;
}
/* 重置绑定（换机）：清空设备/令牌/激活信息 */
async function resetCard(code) {
  if (!dbReady) {
    const c = jfind('licenses', x => x.code === code);
    if (!c) return 0;
    c.machine = ''; c.token = ''; c.activated_at = 0; c.expires_at = 0;
    jsave(); return 1;
  }
  const [r] = await pool.query(
    "UPDATE licenses SET machine='', token='', activated_at=0, expires_at=0 WHERE code=?", [code]);
  return r.affectedRows;
}
/* 停用 / 启用 */
async function setCardDisabled(code, disabled) {
  const v = disabled ? 1 : 0;
  if (!dbReady) {
    const c = jfind('licenses', x => x.code === code);
    if (!c) return 0;
    c.disabled = v; jsave(); return 1;
  }
  const [r] = await pool.query('UPDATE licenses SET disabled=? WHERE code=?', [v, code]);
  return r.affectedRows;
}
/* 删除单张卡密 */
async function deleteCard(code) {
  if (!dbReady) {
    const i = J.licenses.findIndex(x => x.code === code);
    if (i < 0) return 0;
    J.licenses.splice(i, 1);
    jsave(); return 1;
  }
  const [r] = await pool.query('DELETE FROM licenses WHERE code=?', [code]);
  return r.affectedRows;
}
/* 清空所有未激活的卡（误生成时用） */
async function deleteUnusedCards() {
  if (!dbReady) {
    const before = J.licenses.length;
    J.licenses = J.licenses.filter(x => x.activated_at > 0 || x.machine || x.disabled);
    jsave();
    return before - J.licenses.length;
  }
  const [r] = await pool.query(
    "DELETE FROM licenses WHERE activated_at=0 AND (machine IS NULL OR machine='') AND disabled=0");
  return r.affectedRows;
}
/* 收回下发权限（管理员撤销 / 取消企业授权） */
async function revokeUser(machine) {
  if (!dbReady) {
    const u = jfind('users', x => x.machine === machine);
    if (!u) return 0;
    u.plan = 'free'; u.plan_until = 0;
    jsave(); return 1;
  }
  const [r] = await pool.query("UPDATE users SET plan='free', plan_until=0 WHERE machine=?", [machine]);
  return r.affectedRows;
}

/* ---------------- 导出：MySQL 优先，JSON 自动兜底 ---------------- */
const MYSQL_IMPL = {
  logEvent, upsertUser, getUser, getUserByUid, renameUser, userPlan, grantUser,
  findCard, findCardByToken, findCardByMachine, genCards, listCards, listUsers,
  extendCard, addOrder, listOrders, revenueStats, listEvents, overview,
  listTemplates, getTemplate, adminListTemplates, saveTemplate, deleteTemplate, setTemplateEnabled,
  seedAdmin, listAdmins, addAdmin, delAdmin, setAdminPass, findAdminByName, countOwners
};
const JSON_IMPL = {
  logEvent: jLogEvent, upsertUser: jUpsertUser, getUser: jGetUser, getUserByUid: jGetUserByUid,
  renameUser: jRenameUser, userPlan: jUserPlan, grantUser: jGrantUser,
  findCard: jFindCard, findCardByToken: jFindCardByToken, findCardByMachine: jFindCardByMachine,
  genCards: jGenCards, listCards: jListCards, listUsers: jListUsers, extendCard: jExtendCard,
  addOrder: jAddOrder, listOrders: jListOrders, revenueStats: jRevenueStats,
  listEvents: jListEvents, overview: jOverview,
  listTemplates: jListTemplates, getTemplate: jGetTemplate, adminListTemplates: jAdminListTemplates,
  saveTemplate: jSaveTemplate, deleteTemplate: jDeleteTemplate, setTemplateEnabled: jSetTemplateEnabled,
  seedAdmin: jSeedAdmin, listAdmins: jListAdmins, addAdmin: jAddAdmin, delAdmin: jDelAdmin,
  setAdminPass: jSetAdminPass, findAdminByName: jFindAdminByName, countOwners: jCountOwners
};

module.exports = {
  init, dbReady: () => dbReady, mode: () => dbReady ? 'mysql' : 'json',
  pool: () => pool, hashPass,
  ...Object.fromEntries(Object.keys(MYSQL_IMPL).map(k => [
    k, (...a) => dbReady ? MYSQL_IMPL[k](...a) : JSON_IMPL[k](...a)
  ])),
  activateNew, setCardToken, touchCard, resetCard, uidOf, attachOrder,
  setCardDisabled, deleteCard, deleteUnusedCards, revokeUser
};
