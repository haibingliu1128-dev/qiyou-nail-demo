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
