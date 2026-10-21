'use strict';
// API 测试：node --test test/   （每次使用独立的临时数据库）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
process.env.TZ = 'Asia/Shanghai';
const { build } = require('../src/app');
const U = require('../src/lib/util');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nail-test-'));
const DB = path.join(TMP, 'test.db');
let app, base, R, B;
const D = n => U.ymd(U.addDays(new Date(), n));

async function api(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j };
}
let phoneN = 0;
const newPhone = () => '1390000' + String(1000 + ++phoneN).slice(-4);
async function login(phone, name) {
  const s = await api('POST', '/api/auth/sms', { phone });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.match(s.body.devCode, /^\d{6}$/);
  const v = await api('POST', '/api/auth/verify', { phone, code: s.body.devCode, name: name || '测试' });
  assert.equal(v.status, 200);
  return v.body.token;
}
/** 让顾客变成老客（有到店记录），避免进入「待确认」 */
function makeRegular(phone) {
  const c = R.getCustomerByPhone(phone);
  R.insertBooking({ code: 'T' + Math.random().toString(36).slice(2, 9), customer_id: c.id, service_id: 6, service_name: '卸甲', price_cents: 3800, duration_min: 30, date: D(-30), start_min: 600, end_min: 630,
    start_at: U.startAt(D(-30), 600), end_at: U.startAt(D(-30), 630), name: 'x', note: '', status: 'done', deposit_cents: 0, deposit_status: null, hold_until: null });
}
let OWNER, STAFF;
const book = (tok, serviceId, date, time) => api('POST', '/api/bookings', { serviceId, date, time, name: '测试' }, tok);
const setRule = patch => api('PUT', '/api/merchant/settings', patch, OWNER);

before(async () => {
  app = await build({ dbFile: DB, logger: false, smsPerIpHour: 100000, schedulerMs: 3600e3 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = 'http://127.0.0.1:' + app.server.address().port;
  R = app.ctx.repo; B = app.ctx.booking;
  OWNER = (await api('POST', '/api/merchant/login', { username: 'owner', password: 'qiyou2026' })).body.token;
  STAFF = (await api('POST', '/api/merchant/login', { username: 'staff', password: 'staff2026' })).body.token;
  assert.ok(OWNER && STAFF);
});
after(async () => { await app.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('公开信息与可约时段', async () => {
  const s = await api('GET', '/api/shop');
  assert.equal(s.status, 200); assert.equal(s.body.services.length, 6);
  assert.ok(s.body.rules.some(x => x.includes('每人最多 2 个未完成预约')));
  const a = await api('GET', '/api/availability?serviceId=3&from=' + D(1));
  assert.equal(a.status, 200); assert.equal(a.body.days.length, 6);
  const day = a.body.days[0];
  // 种子数据：明天 11:00-12:30 已约；手绘 120 分钟，从 10:00 开始会与之重叠
  assert.equal(day.slots.find(x => x.time === '10:00').why, '已约');
  assert.equal(day.slots.find(x => x.time === '20:00').why, '近打烊');
});

test('短信验证码：错误码拒绝、冷却、正确码登录', async () => {
  const phone = newPhone();
  const s = await api('POST', '/api/auth/sms', { phone });
  assert.equal(s.status, 200);
  const again = await api('POST', '/api/auth/sms', { phone });
  assert.equal(again.status, 429); assert.equal(again.body.error.code, 'SMS_COOLDOWN');
  const bad = await api('POST', '/api/auth/verify', { phone, code: s.body.devCode === '000000' ? '111111' : '000000' });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'CODE_WRONG');
  const ok = await api('POST', '/api/auth/verify', { phone, code: s.body.devCode });
  assert.equal(ok.status, 200); assert.ok(ok.body.token);
  const reuse = await api('POST', '/api/auth/verify', { phone, code: s.body.devCode });
  assert.equal(reuse.status, 400, '验证码只能用一次');
  assert.equal((await api('POST', '/api/auth/sms', { phone: '12345' })).status, 400);
  const outbox = await api('GET', '/api/dev/sms-outbox?phone=' + phone);
  assert.equal(outbox.body[0].code, s.body.devCode);
  assert.equal((await book(null, 1, D(4), '10:00')).status, 401, '未登录不能预约');
  const quick = await api('POST', '/api/auth/quick', { phone });
  assert.equal(quick.status, 403, '开启验证时不能免验证码登录');
});

test('新客需确认 → 商家确认；员工不能改设置', async () => {
  const phone = newPhone(), tok = await login(phone);
  const r = await book(tok, 1, D(4), '10:00');
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.booking.status, 'pending'); assert.equal(r.body.needConfirm, true);
  const acc = await api('POST', `/api/merchant/bookings/${r.body.booking.id}/accept`, null, STAFF);
  assert.equal(acc.status, 200); assert.equal(acc.body.booking.status, 'confirmed');
  const twice = await api('POST', `/api/merchant/bookings/${r.body.booking.id}/accept`, null, STAFF);
  assert.equal(twice.status, 409);
  const st = await api('PUT', '/api/merchant/settings', { maxOpen: { v: 5 } }, STAFF);
  assert.equal(st.status, 403);
  assert.equal((await api('GET', '/api/merchant/bookings?scope=all')).status, 401);
});

test('定金：待支付占位 → 模拟支付 → 确认；取消退款', async () => {
  const phone = newPhone(), tok = await login(phone); makeRegular(phone);
  const r = await book(tok, 3, D(4), '14:00');
  assert.equal(r.status, 201); assert.equal(r.body.booking.status, 'awaiting_payment'); assert.equal(r.body.payment.amount, 50);
  const a = await api('GET', '/api/availability?serviceId=1&from=' + D(4) + '&days=1');
  assert.equal(a.body.days[0].slots.find(x => x.time === '15:00').why, '已约', '待支付期间时段被保留');
  const other = await api('POST', `/api/pay/mock/${r.body.payment.outTradeNo}/confirm`, null, await login(newPhone()));
  assert.equal(other.status, 404, '别人不能替你确认支付');
  const p = await api('POST', `/api/pay/mock/${r.body.payment.outTradeNo}/confirm`, null, tok);
  assert.equal(p.status, 200); assert.equal(p.body.booking.status, 'confirmed'); assert.equal(p.body.booking.depositStatus, 'paid');
  const p2 = await api('POST', `/api/pay/mock/${r.body.payment.outTradeNo}/confirm`, null, tok);
  assert.equal(p2.body.booking.status, 'confirmed', '回调幂等');
  const c = await api('POST', `/api/bookings/${r.body.booking.id}/cancel`, null, tok);
  assert.equal(c.status, 200); assert.equal(c.body.refunded, true); assert.equal(c.body.booking.depositStatus, 'refunded');
});

test('待支付超时 → 定时任务释放时段', async () => {
  const phone = newPhone(), tok = await login(phone); makeRegular(phone);
  const r = await book(tok, 2, D(5), '10:00');
  assert.equal(r.body.booking.status, 'awaiting_payment');
  R.updateBooking(r.body.booking.id, { hold_until: Date.now() - 1000 });
  await B.tick();
  assert.equal(R.getBooking(r.body.booking.id).status, 'expired');
  const late = await api('POST', `/api/pay/mock/${r.body.payment.outTradeNo}/confirm`, null, tok);
  assert.equal(late.body.booking.status, 'expired');
  assert.equal(R.paymentForBooking(r.body.booking.id).status, 'refunded', '超时后付款自动退款');
});

test('未完成预约上限：消息引用当前值；商家改成 3 立即生效', async () => {
  const phone = newPhone(), tok = await login(phone); makeRegular(phone);
  assert.equal((await book(tok, 1, D(4), '16:00')).status, 201);
  assert.equal((await book(tok, 1, D(5), '16:00')).status, 201);
  const r3 = await book(tok, 1, D(6), '16:00');
  assert.equal(r3.status, 409); assert.equal(r3.body.error.code, 'LIMIT_OPEN');
  assert.match(r3.body.error.message, /最多同时保留 2 个/);
  assert.equal((await setRule({ maxOpen: { v: 3 } })).status, 200);
  assert.ok((await api('GET', '/api/shop')).body.rules.includes('每人最多 3 个未完成预约'));
  assert.equal((await book(tok, 1, D(6), '16:00')).status, 201);
  const r4 = await book(tok, 1, D(3), '16:00');
  assert.match(r4.body.error.message, /最多同时保留 3 个/);
  await setRule({ maxOpen: { on: false } });
  assert.equal((await book(tok, 1, D(3), '16:00')).status, 201, '关闭后不再限制');
  await api('POST', '/api/merchant/settings/reset', null, OWNER);
});

test('每天上限 + 每周上限', async () => {
  const phone = newPhone(), tok = await login(phone); makeRegular(phone);
  assert.equal((await book(tok, 6, D(5), '12:00')).status, 201);
  const r = await book(tok, 6, D(5), '13:00');
  assert.equal(r.body.error.code, 'LIMIT_DAY'); assert.match(r.body.error.message, /最多预约 1 个/);
  await setRule({ perDay: { v: 2 } });
  assert.equal((await book(tok, 6, D(5), '13:00')).status, 201);
  await setRule({ maxOpen: { v: 10 }, perDay: { on: false }, perWeek: { on: true, v: 1 } });
  const w = await book(tok, 6, D(5), '17:00');
  // D(5) 所在周已有 2 个
  assert.equal(w.body.error.code, 'LIMIT_WEEK'); assert.match(w.body.error.message, /每周最多预约 1 个/);
  await api('POST', '/api/merchant/settings/reset', null, OWNER);
});

test('设置校验：范围、步长、未知字段、恢复默认', async () => {
  for (const [patch, re] of [[{ maxOpen: { v: 0 } }, /1–10/], [{ maxOpen: { v: 11 } }, /1–10/], [{ rate: { lock: 7 } }, /5 的倍数/], [{ grace: { v: 2.5 } }, /整数/], [{ foo: { on: true } }, /未知/], [{ noshow: { act: 'x' } }, /block/]]) {
    const r = await setRule(patch); assert.equal(r.status, 400, JSON.stringify(patch)); assert.match(r.body.error.message, re);
  }
  const ok = await setRule({ cancelH: { v: 24 }, noshow: { act: 'deposit' } });
  assert.equal(ok.body.values.cancelH.v, 24); assert.equal(ok.body.values.noshow.act, 'deposit');
  const rs = await api('POST', '/api/merchant/settings/reset', null, OWNER);
  assert.equal(rs.body.values.cancelH.v, 2); assert.equal(rs.body.values.noshow.act, 'block');
  const bad = await api('PUT', '/api/merchant/services/2', { deposit: 15 }, OWNER);
  assert.equal(bad.status, 400);
  assert.equal((await api('PUT', '/api/merchant/services/2', { deposit: 40 }, OWNER)).body.deposit, 40);
});

test('取消时限：引用当前小时数；商家放宽后可取消；每月取消次数', async () => {
  const phone = newPhone(), tok = await login(phone); makeRegular(phone);
  const r = await book(tok, 6, D(6), '10:00'); const id = r.body.booking.id;
  // 把开始时间挪到 90 分钟后
  const st = Date.now() + 90 * 60000; R.updateBooking(id, { start_at: st, end_at: st + 30 * 60000 });
  const c = await api('POST', `/api/bookings/${id}/cancel`, null, tok);
  assert.equal(c.status, 409); assert.match(c.body.error.message, /不足 2 小时/);
  const mine = await api('GET', '/api/me/bookings', null, tok);
  assert.equal(mine.body.find(x => x.id === id).canCancel, false);
  await setRule({ cancelH: { v: 1 } });
  assert.equal((await api('POST', `/api/bookings/${id}/cancel`, null, tok)).status, 200);
  await setRule({ cancelMonth: { on: true, v: 1 } });
  const r2 = await book(tok, 6, D(6), '11:00');
  const c2 = await api('POST', `/api/bookings/${r2.body.booking.id}/cancel`, null, tok);
  assert.equal(c2.status, 409); assert.match(c2.body.error.message, /每月最多自助取消 1 次/);
  await api('POST', '/api/merchant/settings/reset', null, OWNER);
});

test('防刷：N 次/M 分钟后暂停，提示引用设置', async () => {
  await setRule({ rate: { n: 3, m: 10, lock: 30 }, maxOpen: { v: 10 }, perDay: { on: false } });
  const phone = newPhone(), tok = await login(phone); makeRegular(phone);
  const a = await book(tok, 6, D(6), '12:00');
  await api('POST', `/api/bookings/${a.body.booking.id}/cancel`, null, tok);
  assert.equal((await book(tok, 6, D(6), '12:00')).status, 201); // 第 3 次
  const x = await book(tok, 6, D(6), '13:00');
  assert.equal(x.status, 429); assert.match(x.body.error.message, /10 分钟内预约\+取消达 3 次，暂停 30 分钟/);
  await api('POST', `/api/merchant/customers/${phone}/clear`, null, OWNER);
  assert.equal((await book(tok, 6, D(6), '13:00')).status, 201, '商家解除后恢复');
  await api('POST', '/api/merchant/settings/reset', null, OWNER);
});

test('超时未到自动爽约 → 限制预约 → 改为必须付定金 → 解除', async () => {
  const phone = newPhone(), tok = await login(phone); makeRegular(phone);
  const ids = [];
  for (const t of ['15:00', '17:00']) { const r = await book(tok, 6, D(t === '15:00' ? 4 : 5), t); assert.equal(r.status, 201); ids.push(r.body.booking.id); }
  // 第一单：开始于 20 分钟前（宽限 15 分钟）→ 自动爽约
  let s = Date.now() - 20 * 60000; R.updateBooking(ids[0], { start_at: s, end_at: s + 30 * 60000 });
  // 第二单：开始于 10 分钟前 → 宽限内不标记
  s = Date.now() - 10 * 60000; R.updateBooking(ids[1], { start_at: s, end_at: s + 30 * 60000 });
  await B.tick();
  assert.equal(R.getBooking(ids[0]).status, 'no_show'); assert.equal(R.getBooking(ids[0]).noshow_by, 'auto');
  assert.equal(R.getBooking(ids[1]).status, 'confirmed');
  await setRule({ grace: { v: 5 } }); await B.tick();
  assert.equal(R.getBooking(ids[1]).status, 'no_show', '宽限改为 5 分钟后被标记');
  const me = await api('GET', '/api/me', null, tok);
  assert.equal(me.body.noshowCount, 2); assert.equal(me.body.restricted.act, 'block');
  const blocked = await book(tok, 1, D(6), '19:00');
  assert.equal(blocked.status, 403); assert.match(blocked.body.error.message, /爽约 2 次/);
  await setRule({ noshow: { act: 'deposit' }, deposit: { force: 60 } });
  const q = await api('GET', '/api/quote?serviceId=1', null, tok);
  assert.equal(q.body.deposit, 60);
  const dep = await book(tok, 1, D(6), '19:00');
  assert.equal(dep.status, 201); assert.equal(dep.body.payment.amount, 60, '受限顾客必须付定金');
  await api('POST', `/api/bookings/${dep.body.booking.id}/cancel`, null, tok);
  await setRule({ noshow: { act: 'block', n: 3 } });
  assert.equal((await api('GET', '/api/me', null, tok)).body.restricted, null, '阈值提高到 3 后不再受限');
  await setRule({ noshow: { n: 2 } });
  await api('POST', `/api/merchant/customers/${phone}/clear`, null, OWNER);
  assert.equal((await api('GET', '/api/me', null, tok)).body.restricted, null, '商家解除限制');
  const cust = (await api('GET', '/api/merchant/customers?q=' + phone, null, OWNER)).body[0];
  assert.equal(cust.noshowTotal, 2);
  // 手动标记爽约：未开始不允许
  const fut = await book(tok, 6, D(6), '20:00');
  assert.equal((await api('POST', `/api/merchant/bookings/${fut.body.booking.id}/noshow`, null, STAFF)).status, 409);
  await api('POST', '/api/merchant/settings/reset', null, OWNER);
});

test('黑名单：拉黑后不能预约，移出后恢复；种子爽约顾客受限', async () => {
  const phone = newPhone(), tok = await login(phone); makeRegular(phone);
  assert.equal((await api('POST', '/api/merchant/customers/blacklist', { phone, on: true, reason: '测试' }, STAFF)).status, 200);
  const r = await book(tok, 6, D(3), '19:00');
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'BLACKLISTED');
  await api('POST', '/api/merchant/customers/blacklist', { phone, on: false }, STAFF);
  assert.equal((await book(tok, 6, D(3), '19:00')).status, 201);
  const list = (await api('GET', '/api/merchant/customers', null, OWNER)).body;
  const zhou = list.find(c => c.phone === '13700003333');
  assert.equal(zhou.noshowInWindow, 2); assert.equal(zhou.restricted.act, 'block');
  const audit = (await api('GET', '/api/merchant/audit', null, OWNER)).body;
  assert.ok(audit.some(a => a.action === 'customer.blacklist'));
  assert.equal((await api('GET', '/api/merchant/audit', null, STAFF)).status, 403);
});

test('并发：20 个顾客同时抢同一时段，只有 1 个成功', async () => {
  await setRule({ confirmNew: { on: false } });
  const toks = await Promise.all(Array.from({ length: 20 }, () => login(newPhone())));
  const res = await Promise.all(toks.map(t => book(t, 4, D(6), '14:00')));
  const ok = res.filter(r => r.status === 201), taken = res.filter(r => r.status === 409 && r.body.error.code === 'SLOT_TAKEN');
  assert.equal(ok.length, 1); assert.equal(taken.length, 19);
  // 重叠时段（14:30 开始的 60 分钟服务）也应被拒
  assert.equal((await book(toks[1], 1, D(6), '14:30')).status, 409);
  await api('POST', '/api/merchant/settings/reset', null, OWNER);
});

test('并发（两个独立进程共享同一数据库）：数据库触发器兜底防超卖', async () => {
  const port = n => 3300 + Math.floor(Math.random() * 500) + n;
  const ports = [port(0), port(600)];
  const procs = ports.map(p => spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, PORT: String(p), HOST: '127.0.0.1', DB_FILE: DB, LOG_LEVEL: 'error', SMS_PER_IP_HOUR: '100000', SCHEDULER_MS: '3600000' }, stdio: 'ignore' }));
  try {
    for (const p of ports) { for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${p}/api/health`); break; } catch { await new Promise(r => setTimeout(r, 100)); } } }
    await setRule({ confirmNew: { on: false } });
    const toks = await Promise.all(Array.from({ length: 16 }, () => login(newPhone())));
    const res = await Promise.all(toks.map((t, i) => fetch(`http://127.0.0.1:${ports[i % 2]}/api/bookings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ serviceId: 4, date: D(6), time: '17:00', name: '并发' }) })));
    const codes = res.map(r => r.status);
    assert.equal(codes.filter(c => c === 201).length, 1, codes.join(','));
    assert.equal(codes.filter(c => c === 409).length, 15);
    // 触发器本身：直接插入重叠记录也会被拒
    const c = R.getCustomerByPhone(phoneN && '13900001001');
    assert.throws(() => R.insertBooking({ code: 'X1', customer_id: c.id, service_id: 4, service_name: 'x', price_cents: 1, duration_min: 90, date: D(6), start_min: 17 * 60, end_min: 18 * 60 + 30,
      start_at: U.startAt(D(6), 1020), end_at: U.startAt(D(6), 1110), name: 'x', note: '', status: 'confirmed', deposit_cents: 0, deposit_status: null, hold_until: null }), /SLOT_TAKEN/);
  } finally { procs.forEach(p => p.kill()); await api('POST', '/api/merchant/settings/reset', null, OWNER); }
});

test('SSE：商家端实时收到新预约事件', async () => {
  const ac = new AbortController();
  const res = await fetch(base + '/api/merchant/stream?token=' + OWNER, { signal: ac.signal });
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /event-stream/);
  const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
  const got = (async () => { while (!buf.includes('booking.create')) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } return buf; })();
  const tok = await login(newPhone()); await book(tok, 6, D(2), '20:00');
  const txt = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('no SSE event')), 3000))]);
  assert.match(txt, /event: change/); ac.abort();
  assert.equal((await fetch(base + '/api/merchant/stream?token=bad')).status, 401);
});

test('商家登录：错误密码、连续失败锁定', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await api('POST', '/api/merchant/login', { username: 'staff', password: 'nope' })).status, 401);
  const l = await api('POST', '/api/merchant/login', { username: 'staff', password: 'staff2026' });
  assert.equal(l.status, 429);
});

// ---------------- 服务图片 ----------------
const JPG = fs.readFileSync(path.join(__dirname, '..', 'assets', 'seed-images', '01_solid.jpg'));
const PNG1 = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d6c5e50000000049454e44ae426082', 'hex');
const up = (buf, type, token) => fetch(base + '/api/merchant/images', { method: 'POST', headers: { 'content-type': type, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: buf })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

test('图片上传：店主上传 JPG/PNG 成功，可读取且带缓存头', async () => {
  const r = await up(JPG, 'image/jpeg', OWNER);
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.mime, 'image/jpeg'); assert.match(r.body.url, /^\/api\/images\/[\w-]+$/);
  const g = await fetch(base + r.body.url);
  assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'image/jpeg');
  assert.match(g.headers.get('cache-control'), /max-age=31536000/);
  assert.ok(Buffer.from(await g.arrayBuffer()).equals(JPG));
  const nm = await fetch(base + r.body.url, { headers: { 'if-none-match': g.headers.get('etag') } });
  assert.equal(nm.status, 304);
  // Content-Type 写错也以魔数为准
  const p = await up(PNG1, 'application/octet-stream', OWNER);
  assert.equal(p.status, 201); assert.equal(p.body.mime, 'image/png');
  assert.equal((await fetch(base + '/api/images/doesnotexist123')).status, 404);
});
test('图片上传：非商家 / 员工被拒', async () => {
  assert.equal((await up(JPG, 'image/jpeg')).status, 401);
  const ct = await login(newPhone());
  assert.equal((await up(JPG, 'image/jpeg', ct)).status, 401);   // 顾客令牌不能当商家令牌
  const s = await up(JPG, 'image/jpeg', STAFF);
  assert.equal(s.status, 403); assert.equal(s.body.error.code, 'OWNER_ONLY');
});
test('图片上传：格式不对 / 太大被拒', async () => {
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)]);
  const a = await up(gif, 'image/jpeg', OWNER);
  assert.equal(a.status, 415); assert.equal(a.body.error.code, 'IMAGE_BAD_TYPE'); assert.match(a.body.error.message, /JPG/);
  const b = await up(gif, 'image/gif', OWNER);
  assert.equal(b.status, 415);
  const txt = await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml', OWNER);
  assert.equal(txt.status, 415);
  const big = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(2 * 1024 * 1024)]);
  const c = await up(big, 'image/jpeg', OWNER);
  assert.equal(c.status, 413); assert.equal(c.body.error.code, 'IMAGE_TOO_LARGE'); assert.match(c.body.error.message, /2MB/);
});
test('服务图片：新增/编辑服务带图片，顾客端返回封面；校验 ID 与数量；种子服务有默认图', async () => {
  const shop0 = await api('GET', '/api/shop');
  assert.ok(shop0.body.services.every(s => s.cover && s.images.length === 1), '种子服务应有默认配图');
  const i1 = (await up(JPG, 'image/jpeg', OWNER)).body, i2 = (await up(PNG1, 'image/png', OWNER)).body;
  const c = await api('POST', '/api/merchant/services', { name: '图片测试款', price: 128, duration: 60, images: [i1.id, i2.id] }, OWNER);
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.cover, i1.url); assert.equal(c.body.images.length, 2);
  const shop = await api('GET', '/api/shop');
  assert.equal(shop.body.services.find(s => s.id === c.body.id).cover, i1.url);
  const e = await api('PUT', '/api/merchant/services/' + c.body.id, { images: [i2.id] }, OWNER);   // 更换封面 / 删除一张
  assert.equal(e.body.cover, i2.url); assert.equal(e.body.images.length, 1);
  assert.equal((await api('PUT', '/api/merchant/services/' + c.body.id, { images: ['nope12345678'] }, OWNER)).body.error.code, 'IMAGE_NOT_FOUND');
  const many = await api('PUT', '/api/merchant/services/' + c.body.id, { images: [i1.id, i2.id, shop0.body.services[0].images[0].id, shop0.body.services[1].images[0].id] }, OWNER);
  assert.equal(many.body.error.code, 'TOO_MANY_IMAGES');
  const none = await api('PUT', '/api/merchant/services/' + c.body.id, { images: [] }, OWNER);
  assert.equal(none.body.cover, null);
  assert.equal((await api('PUT', '/api/merchant/services/' + c.body.id, { images: [i1.id] }, STAFF)).status, 403);
  await api('DELETE', '/api/merchant/services/' + c.body.id, null, OWNER);
});
test('顾客端实时：商家改服务后公开 SSE 收到 service 事件（不含顾客数据）', async () => {
  const ac = new AbortController();
  const res = await fetch(base + '/api/stream', { signal: ac.signal });
  const reader = res.body.getReader(); let buf = '';
  const got = (async () => { while (!buf.includes('"service"')) { const { value, done } = await reader.read(); if (done) break; buf += Buffer.from(value).toString(); } return buf; })();
  await new Promise(r => setTimeout(r, 100));
  await api('PUT', '/api/merchant/services/1', { desc: '实时测试' }, OWNER);
  const txt = await Promise.race([got, new Promise((_, j) => setTimeout(() => j(new Error('timeout')), 3000))]);
  ac.abort();
  assert.match(txt, /event: change\ndata: {"type":"service"}/);
  const h = await api('GET', '/api/health');
  assert.ok(h.body.version && 'commit' in h.body && h.body.features.includes('images'));
});

// ---------------- 评价与反馈 ----------------
function doneBooking(phone, status) {
  const c = R.getCustomerByPhone(phone), d = D(-2);
  return R.insertBooking({ code: 'RV' + Math.random().toString(36).slice(2, 9), customer_id: c.id, service_id: 2, service_name: '猫眼 / 渐变款', price_cents: 16800, duration_min: 90, date: d, start_min: 660, end_min: 750,
    start_at: U.startAt(d, 660), end_at: U.startAt(d, 750), name: '测试', note: '', status: status || 'done', deposit_cents: 0, deposit_status: null, hold_until: null });
}
const cup = (buf, token) => fetch(base + '/api/me/images', { method: 'POST', headers: { 'content-type': 'image/jpeg', authorization: 'Bearer ' + token }, body: buf }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const resetRules = () => api('POST', '/api/merchant/settings/reset', null, OWNER);
function sseCollect(url) {
  const ac = new AbortController(); let buf = '';
  const ready = fetch(base + url, { signal: ac.signal }).then(async res => { const rd = res.body.getReader(); (async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += Buffer.from(value).toString(); } } catch {} })(); });
  return { ready, text: () => buf, close: () => ac.abort() };
}
const waitFor = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 30)); } return false; };

test('评价：只有本人已完成的订单可评价；一单一次；期限内可修改；文本清洗；照片须本人上传', async () => {
  const phone = newPhone(), tok = await login(phone, '评价测试');
  const pend = doneBooking(phone, 'confirmed');
  let r = await api('POST', '/api/reviews', { bookingId: pend, stars: 5 }, tok);
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'NOT_COMPLETED');
  const bid = doneBooking(phone);
  const other = await login(newPhone());
  assert.equal((await api('POST', '/api/reviews', { bookingId: bid, stars: 5 }, other)).status, 404);
  assert.equal((await api('POST', '/api/reviews', { bookingId: bid, stars: 5 })).status, 401);
  const mine = await api('GET', '/api/me/bookings', null, tok);
  assert.equal(mine.body.find(b => b.id === bid).canReview, true);
  assert.equal((await api('POST', '/api/reviews', { bookingId: bid, stars: 5, text: 'x'.repeat(301) }, tok)).body.error.code, 'TEXT_TOO_LONG');
  assert.equal((await api('POST', '/api/reviews', { bookingId: bid, stars: 5, tags: ['不存在的标签'] }, tok)).body.error.code, 'BAD_TAG');
  assert.equal((await api('POST', '/api/reviews', { bookingId: bid, stars: 6 }, tok)).status, 400);
  const mimg = (await up(JPG, 'image/jpeg', OWNER)).body;      // 商家上传的图不能冒充顾客晒图
  assert.equal((await api('POST', '/api/reviews', { bookingId: bid, stars: 5, photos: [mimg.id] }, tok)).body.error.code, 'IMAGE_NOT_FOUND');
  const ph = await cup(JPG, tok); assert.equal(ph.status, 201);
  r = await api('POST', '/api/reviews', { bookingId: bid, stars: 5, tags: ['手法专业', '准时'], text: '很好<script>alert(1)</script>', photos: [ph.body.id] }, tok);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.text, '很好＜script＞alert(1)＜/script＞'); assert.equal(r.body.photos.length, 1); assert.equal(r.body.canEdit, true);
  assert.equal((await api('POST', '/api/reviews', { bookingId: bid, stars: 4 }, tok)).body.error.code, 'ALREADY_REVIEWED');
  const e = await api('PUT', '/api/reviews/' + r.body.id, { stars: 4, tags: ['环境干净'], text: '改一下', photos: [] }, tok);
  assert.equal(e.status, 200); assert.equal(e.body.stars, 4); assert.equal(e.body.photos.length, 0);
  assert.equal((await api('PUT', '/api/reviews/' + r.body.id, { stars: 4 }, other)).status, 404);
  R.db.prepare('UPDATE reviews SET created_at=? WHERE id=?').run(Date.now() - 8 * 864e5, r.body.id);
  const late = await api('PUT', '/api/reviews/' + r.body.id, { stars: 3 }, tok);
  assert.equal(late.status, 403); assert.equal(late.body.error.code, 'EDIT_EXPIRED'); assert.match(late.body.error.message, /7 天/);
  const pub = await api('GET', '/api/reviews?serviceId=2&limit=30');
  const it = pub.body.items.find(x => x.id === r.body.id);
  assert.match(it.who, /^\d{3}\*{4}\d{4}$/); assert.ok(!JSON.stringify(pub.body).includes(phone));
});

test('低分评价：实时提醒店主 + 角标；查看后清除；带打码手机号与订单信息', async () => {
  const phone = newPhone(), tok = await login(phone), bid = doneBooking(phone);
  const s = sseCollect('/api/merchant/stream?token=' + OWNER); await s.ready; await new Promise(r => setTimeout(r, 80));
  const r = await api('POST', '/api/reviews', { bookingId: bid, stars: 2, tags: ['等待太久'], text: '等太久了' }, tok);
  assert.equal(r.status, 201);
  assert.ok(await waitFor(() => /"type":"review"[^\n]*"low":true/.test(s.text())), s.text()); s.close();
  let d = await api('GET', '/api/merchant/dashboard', null, OWNER);
  assert.ok(d.body.inbox.reviews.lowNew >= 1);
  const st = await api('GET', '/api/merchant/reviews?filter=low', null, STAFF);    // 员工查看不清除店主提醒
  const item = st.body.items.find(x => x.id === r.body.id);
  assert.equal(item.alertNew, true); assert.match(item.phone, /^\d{3}\*{4}\d{4}$/); assert.ok(item.bookingCode && item.date && item.time);
  await api('GET', '/api/merchant/reviews?filter=low', null, OWNER);
  d = await api('GET', '/api/merchant/dashboard', null, OWNER);
  assert.equal(d.body.inbox.reviews.lowNew, 0);
});

test('商家回复 / 隐藏 / 先审后发；隐藏的不进公开统计但计入商家统计', async () => {
  const phone = newPhone(), tok = await login(phone), bid = doneBooking(phone);
  const rv = (await api('POST', '/api/reviews', { bookingId: bid, stars: 5, text: '回复测试' }, tok)).body;
  assert.equal((await api('PUT', `/api/merchant/reviews/${rv.id}/reply`, { text: '谢谢' }, STAFF)).status, 403);
  assert.equal((await api('PUT', `/api/merchant/reviews/${rv.id}/reply`, { text: '' }, OWNER)).status, 400);
  assert.equal((await api('PUT', `/api/merchant/reviews/${rv.id}/reply`, { text: '谢谢光临' }, OWNER)).body.reply.text, '谢谢光临');
  assert.equal((await api('PUT', `/api/merchant/reviews/${rv.id}/reply`, { text: '谢谢光临，欢迎再来' }, OWNER)).body.reply.text, '谢谢光临，欢迎再来');
  let pub = await api('GET', '/api/reviews?serviceId=2&limit=30');
  assert.equal(pub.body.items.find(x => x.id === rv.id).reply.text, '谢谢光临，欢迎再来');
  const before = pub.body.summary.count, mBefore = (await api('GET', '/api/merchant/reviews', null, OWNER)).body.counts.total;
  assert.equal((await api('POST', `/api/merchant/reviews/${rv.id}/hide`, null, STAFF)).status, 403);
  await api('POST', `/api/merchant/reviews/${rv.id}/hide`, null, OWNER);
  pub = await api('GET', '/api/reviews?serviceId=2&limit=30');
  assert.ok(!pub.body.items.some(x => x.id === rv.id)); assert.equal(pub.body.summary.count, before - 1);
  assert.equal((await api('GET', '/api/merchant/reviews', null, OWNER)).body.counts.total, mBefore);
  await api('POST', `/api/merchant/reviews/${rv.id}/unhide`, null, OWNER);
  assert.equal((await api('GET', '/api/reviews?serviceId=2&limit=30')).body.summary.count, before);
  // 先审后发：仅低分
  await setRule({ review: { moderate: 'low' } });
  const p2 = newPhone(), t2 = await login(p2), b2 = doneBooking(p2);
  const low = (await api('POST', '/api/reviews', { bookingId: b2, stars: 1 }, t2)).body;
  assert.equal(low.status, 'pending');
  assert.ok(!(await api('GET', '/api/reviews?serviceId=2&limit=30')).body.items.some(x => x.id === low.id));
  assert.equal((await api('POST', `/api/merchant/reviews/${rv.id}/approve`, null, OWNER)).status, 409);
  await api('POST', `/api/merchant/reviews/${low.id}/approve`, null, OWNER);
  assert.ok((await api('GET', '/api/reviews?serviceId=2&limit=30')).body.items.some(x => x.id === low.id));
  await resetRules();
});

test('功能开关：关闭后服务端拒绝（403 FEATURE_OFF）且公开接口隐藏；设置校验；员工不能改', async () => {
  const phone = newPhone(), tok = await login(phone), bid = doneBooking(phone);
  const s = sseCollect('/api/stream'); await s.ready; await new Promise(r => setTimeout(r, 80));
  await setRule({ review: { on: false } });
  assert.ok(await waitFor(() => s.text().includes('"settings"'))); s.close();
  let r = await api('POST', '/api/reviews', { bookingId: bid, stars: 5 }, tok);
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'FEATURE_OFF'); assert.match(r.body.error.message, /关闭评价/);
  assert.equal((await api('GET', '/api/me/bookings', null, tok)).body.find(b => b.id === bid).canReview, false);
  assert.equal((await api('GET', '/api/shop')).body.features.review, false);
  await setRule({ review: { on: true, photos: false } });
  assert.equal((await api('GET', '/api/shop')).body.features.reviewPhotos, 0);
  const ph = await cup(JPG, tok); assert.equal(ph.status, 201);   // 反馈仍允许图片
  assert.equal((await api('POST', '/api/reviews', { bookingId: bid, stars: 5, photos: [ph.body.id] }, tok)).body.error.code, 'FEATURE_OFF');
  await setRule({ feedback: { photos: false } });
  assert.equal((await cup(JPG, tok)).status, 403);
  await setRule({ reviewPublic: { on: false } });
  assert.equal((await api('GET', '/api/reviews')).status, 403);
  const shop = (await api('GET', '/api/shop')).body;
  assert.equal(shop.rating, null); assert.ok(shop.services.every(x => x.rating === null));
  await setRule({ reviewPublic: { on: true }, reply: { on: false } });
  const any = (await api('GET', '/api/merchant/reviews', null, OWNER)).body.items[0];
  assert.equal((await api('PUT', `/api/merchant/reviews/${any.id}/reply`, { text: 'x' }, OWNER)).body.error.code, 'FEATURE_OFF');
  assert.ok((await api('GET', '/api/reviews?limit=30')).body.items.every(x => x.reply === null), '回复关闭时公开页不显示回复');
  await setRule({ feedback: { on: false }, contact: { on: false } });
  r = await api('POST', '/api/feedback', { type: '其他', text: '测试反馈' }, tok);
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'FEATURE_OFF');
  assert.equal((await api('GET', '/api/shop')).body.shop.phone, null);
  // 校验
  assert.equal((await setRule({ review: { tagsPos: [] } })).status, 400);
  assert.equal((await setRule({ review: { tagsNeg: ['这个标签实在太长了啊'] } })).body.error.path, 'review.tagsNeg');
  assert.equal((await setRule({ review: { moderate: 'maybe' } })).status, 400);
  assert.equal((await setRule({ review: { lowStar: 5 } })).status, 400);
  assert.equal((await api('PUT', '/api/merchant/settings', { review: { on: false } }, STAFF)).status, 403);
  const ok = await setRule({ review: { tagsPos: ['手法好', '手法好', '<i>美</i>'] }, feedback: { types: ['建议', '投诉'] } });
  assert.deepEqual(ok.body.values.review.tagsPos, ['手法好', '＜i＞美＜/i＞']);
  assert.deepEqual((await api('GET', '/api/shop')).body.features.feedbackTypes, ['建议', '投诉']);
  await resetRules();
  const f = (await api('GET', '/api/shop')).body.features;
  assert.ok(f.review && f.reply && f.reviewPublic && f.feedback && f.contact, '默认全部开启');
});

test('意见反馈：仅商家可见；状态与内部备注；回访时显示完整号码；频率限制', async () => {
  const phone = newPhone(), tok = await login(phone, '反馈测试');
  assert.equal((await api('POST', '/api/feedback', { type: '其他', text: '没登录' })).status, 401);
  assert.equal((await api('POST', '/api/feedback', { type: '乱写', text: '类型不对' }, tok)).body.error.code, 'BAD_TYPE');
  assert.equal((await api('POST', '/api/feedback', { type: '其他', text: 'a' }, tok)).status, 400);
  const s = sseCollect('/api/merchant/stream?token=' + OWNER); await s.ready; await new Promise(r => setTimeout(r, 80));
  const pub = sseCollect('/api/stream'); await pub.ready;
  const ph = (await cup(JPG, tok)).body;
  const r = await api('POST', '/api/feedback', { type: '服务投诉', text: '希望<b>改进</b>', contact: 'phone', photos: [ph.id] }, tok);
  assert.equal(r.status, 201);
  assert.ok(await waitFor(() => /"type":"feedback"[^\n]*"isNew":true/.test(s.text()))); s.close();
  assert.ok(!pub.text().includes('feedback'), '公开 SSE 不推送反馈'); pub.close();
  let m = await api('GET', '/api/merchant/feedback?status=open', null, OWNER);
  let it = m.body.items.find(x => x.id === r.body.id);
  assert.equal(it.phone, phone); assert.equal(it.text, '希望＜b＞改进＜/b＞'); assert.equal(it.photos.length, 1);
  assert.equal((await api('PUT', '/api/merchant/feedback/' + it.id, { status: 'doing' }, STAFF)).status, 403);
  assert.equal((await api('PUT', '/api/merchant/feedback/' + it.id, { status: 'bad' }, OWNER)).status, 400);
  const u = await api('PUT', '/api/merchant/feedback/' + it.id, { status: 'done', note: '已电话联系' }, OWNER);
  assert.equal(u.body.status, 'done'); assert.equal(u.body.note, '已电话联系');
  const mine = await api('GET', '/api/me/feedback', null, tok);
  assert.equal(mine.body[0].statusText, '已处理'); assert.ok(!('note' in mine.body[0]), '顾客看不到内部备注');
  const r2 = await api('POST', '/api/feedback', { type: '其他', text: '不用回复', contact: 'none' }, tok);
  it = (await api('GET', '/api/merchant/feedback', null, OWNER)).body.items.find(x => x.id === r2.body.id);
  assert.match(it.phone, /^\d{3}\*{4}\d{4}$/);
  for (let i = 0; i < 3; i++) assert.equal((await api('POST', '/api/feedback', { type: '其他', text: '第' + i + '条' }, tok)).status, 201);
  const lim = await api('POST', '/api/feedback', { type: '其他', text: '第6条' }, tok);
  assert.equal(lim.status, 429); assert.equal(lim.body.error.code, 'TOO_FREQUENT');
});

test('评价频率限制 + 门店联系方式可修改', async () => {
  const phone = newPhone(), tok = await login(phone), bid = doneBooking(phone);
  const rv = (await api('POST', '/api/reviews', { bookingId: bid, stars: 5 }, tok)).body;
  let last;
  for (let i = 0; i < 10; i++) last = await api('PUT', '/api/reviews/' + rv.id, { stars: 4 }, tok);
  assert.equal(last.status, 429); assert.equal(last.body.error.code, 'TOO_FREQUENT');
  assert.equal((await api('PUT', '/api/merchant/shop', { phone: 'abc' }, OWNER)).body.error.code, 'BAD_PHONE');
  assert.equal((await api('PUT', '/api/merchant/shop', { phone: '020-1234-5678' }, STAFF)).status, 403);
  assert.equal((await api('PUT', '/api/merchant/shop', { phone: '020-1234-5678', address: '示例路 1 号' }, OWNER)).status, 200);
  const sh = (await api('GET', '/api/shop')).body.shop;
  assert.equal(sh.phone, '020-1234-5678'); assert.equal(sh.address, '示例路 1 号');
  assert.equal((await api('GET', '/api/merchant/settings', null, OWNER)).body.shop.phone, '020-1234-5678');
});

test('示例评价：公开展示有内容、标记为示例、手机号打码', async () => {
  const r = await api('GET', '/api/reviews?limit=30');
  const seeds = r.body.items.filter(x => x.seed);
  assert.ok(seeds.length >= 8); assert.ok(seeds.some(x => x.reply)); assert.ok(seeds.some(x => x.photos.length));
  assert.ok(seeds.every(x => /^\d{3}\*{4}\d{4}$/.test(x.who)));
  const shop = (await api('GET', '/api/shop')).body;
  assert.ok(shop.rating.count >= 8 && shop.rating.avg >= 1 && shop.rating.tags.length);
});
