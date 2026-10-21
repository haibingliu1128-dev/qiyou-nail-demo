'use strict';
// 顾客端 API（公开 + 顾客令牌）
const { AppError } = require('../lib/util');
module.exports = async function (app) {
  const { auth, booking, cfg, sms, repo, bus, reviews } = app.ctx;
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  const customer = req => { const c = auth.resolve(bearer(req), 'customer'); if (!c) throw new AppError(401, 'NEED_LOGIN', '请先验证手机号'); return c; };

  app.get('/health', async () => ({ ok: true, time: Date.now(), version: cfg.version, commit: cfg.commit, features: ['images', 'light-theme', 'reviews', 'staff-perms', 'booking-perms'], sms: cfg.smsProvider, pay: cfg.payProvider }));
  // 图片：ID 随机且内容不可变 → 长缓存；ETag 便于条件请求
  app.get('/images/:id', async (req, reply) => {
    const id = String(req.params.id);
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) throw new AppError(404, 'NOT_FOUND', '图片不存在');
    const etag = '"' + id + '"';
    reply.header('Cache-Control', 'public, max-age=31536000, immutable').header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    const im = repo.getImage(id);
    if (!im) { reply.header('Cache-Control', 'no-store'); throw new AppError(404, 'NOT_FOUND', '图片不存在'); }
    return reply.type(im.mime).header('Content-Length', im.bytes).send(im.data);
  });
  // 顾客端实时更新（SSE）：只推送「服务/设置有变化」这类公开信号，不含任何顾客数据
  const PUBLIC_EVENTS = new Set(['service', 'settings', 'reset', 'shop', 'review']);
  app.get('/stream', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 5000\n\n');
    const send = e => { if (PUBLIC_EVENTS.has(e.type)) res.write(`event: change\ndata: ${JSON.stringify({ type: e.type })}\n\n`); };
    const hb = setInterval(() => res.write(': ping\n\n'), 20000);
    bus.on('change', send);
    req.raw.on('close', () => { clearInterval(hb); bus.off('change', send); });
  });
  app.get('/shop', async () => {
    const info = booking.publicInfo(), x = reviews.shopExtras();
    info.services = info.services.map(s => ({ ...s, rating: x.serviceRatings[s.id] || null }));
    if (!x.features.contact) info.shop = { ...info.shop, phone: null };   // 关闭「联系商家」时不下发电话
    return { ...info, features: x.features, rating: x.rating, demo: { showSmsCode: cfg.devShowSmsCode, mockPay: cfg.payProvider === 'mock', notice: cfg.demoNotice || '' } };
  });
  // 评价（公开展示）
  app.get('/reviews', async req => reviews.publicList(req.query.serviceId, req.query.offset, req.query.limit));
  app.post('/reviews', async (req, reply) => { const r = reviews.createReview(customer(req), req.body || {}, req.ip); reply.code(201); return r; });
  app.put('/reviews/:id', async req => reviews.editReview(customer(req), req.params.id, req.body || {}, req.ip));
  app.post('/me/images', async (req, reply) => { const r = reviews.uploadPhoto(customer(req), req.body, req.ip); reply.code(201); return r; });
  // 意见反馈（仅商家可见）
  app.post('/feedback', async (req, reply) => { const r = reviews.createFeedback(customer(req), req.body || {}, req.ip); reply.code(201); return r; });
  app.get('/me/feedback', async req => reviews.myFeedback(customer(req)));
  app.get('/availability', async req => booking.availability(req.query.serviceId, req.query.from, req.query.days ? +req.query.days : undefined));

  app.post('/auth/sms', async req => auth.sendCode(String((req.body || {}).phone || ''), req.ip));
  app.post('/auth/verify', async req => { const b = req.body || {}; return auth.verifyCode(String(b.phone || ''), b.code, b.name); });
  app.post('/auth/quick', async req => { const b = req.body || {}; return auth.quickLogin(String(b.phone || ''), b.name); });
  app.post('/auth/logout', async req => { auth.logout(bearer(req)); return { ok: true }; });

  app.get('/me', async req => booking.me(customer(req)));
  app.get('/me/bookings', async req => reviews.attachToBookings(booking.myBookings(customer(req))));
  app.get('/quote', async req => booking.quote(customer(req), req.query.serviceId));
  app.post('/bookings', async (req, reply) => { const r = await booking.create(customer(req), req.body || {}, { ip: req.ip }); reply.code(201); return r; });
  app.get('/bookings/:id/payment', async req => booking.paymentInfo(customer(req), req.params.id));
  app.post('/bookings/:id/cancel', async req => booking.customerCancel(customer(req), req.params.id, { ip: req.ip }));

  // 模拟支付：仅 PAY_PROVIDER=mock 时可用；只有下单本人能确认
  app.post('/pay/mock/:no/confirm', async req => {
    if (cfg.payProvider !== 'mock') throw new AppError(404, 'NOT_FOUND', 'not found');
    const c = customer(req), p = repo.getPayment(req.params.no);
    if (!p || repo.getBooking(p.booking_id).customer_id !== c.id) throw new AppError(404, 'PAY_NOT_FOUND', '支付单不存在');
    return { booking: await booking.markPaid(req.params.no, 'mock-' + Date.now()) };
  });
  // 微信支付回调（接入后启用，见 providers/pay/wechat-jsapi-v3.stub.js）
  app.post('/pay/notify/wechat', async (req, reply) => {
    const r = app.ctx.pay.parseNotify(req.headers, req.body);
    if (r.paid) await booking.markPaid(r.outTradeNo, r.txnId, r);
    return { code: 'SUCCESS' };
  });
  // 开发/演示：查看模拟短信发件箱（DEV_SHOW_SMS_CODE=1 且使用 mock 通道时才开放）
  app.get('/dev/sms-outbox', async req => {
    if (!cfg.devShowSmsCode || !sms.outbox) throw new AppError(404, 'NOT_FOUND', 'not found');
    const p = String(req.query.phone || '');
    return sms.outbox().filter(x => !p || x.phone === p).slice(0, 10).map(x => ({ phone: x.phone, code: x.code, at: x.at }));
  });
};
