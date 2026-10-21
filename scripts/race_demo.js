// 并发演示：20 个顾客同一瞬间抢同一个时段（对正在运行的服务发真实 HTTP 请求）
// 用法：node scripts/race_demo.js [BASE]   需开发模式（DEV_SHOW_SMS_CODE=1）以自动获取验证码
const BASE = process.argv[2] || 'http://localhost:3100', N = 20, SVC = 4;
const j = async (m, u, b, t) => { const r = await fetch(BASE + u, { method: m, headers: { ...(b ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, b: await r.json() }; };
(async () => {
  const shop = (await j('GET', '/api/shop')).b, svc = shop.services.find(s => s.id === SVC);
  const av = (await j('GET', `/api/availability?serviceId=${SVC}`)).b;
  const day = av.days[av.days.length - 1], slot = day.slots.find(x => x.ok);
  console.log(`$ 目标：${day.date} ${slot.time}  ${svc.name}（${svc.duration} 分钟）`);
  console.log(`$ 准备 ${N} 个测试顾客（验证码登录）…`);
  const toks = [];
  for (let i = 0; i < N; i++) {
    const phone = '166' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const s = (await j('POST', '/api/auth/sms', { phone })).b;
    toks.push((await j('POST', '/api/auth/verify', { phone, code: s.devCode, name: '并发' + (i + 1) })).b.token);
  }
  console.log(`$ 同时发出 ${N} 个 POST /api/bookings …`);
  const t0 = Date.now();
  const res = await Promise.all(toks.map(t => j('POST', '/api/bookings', { serviceId: SVC, date: day.date, time: slot.time, name: '并发' }, t)));
  const ms = Date.now() - t0;
  res.forEach((r, i) => console.log(`#${String(i + 1).padStart(2, '0')}  ${r.s}  ${r.s === 201 ? '预约成功 ' + r.b.booking.code : r.b.error.code + ' ' + r.b.error.message}`));
  const ok = res.filter(r => r.s === 201).length;
  console.log(`结果：${ok} 个成功，${N - ok} 个被拒绝（${ms} ms）`);
  process.exit(ok === 1 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
