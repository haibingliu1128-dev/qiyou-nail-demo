'use strict';
// 顾客端 API（公开 + 顾客令牌）
const { AppError } = require('../lib/util');
module.exports = async function (app) {
  const { auth, booking, cfg, sms, repo } = app.ctx;
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  const customer = req => { const c = auth.resolve(bearer(req), 'customer'); if (!c) throw new AppError(401, 'NEED_LOGIN', '请先验证手机号'); return c; };

  app.get('/health', async () => ({ ok: true, time: Date.now(), sms: cfg.smsProvider, pay: cfg.payProvider }));
  app.get('/shop', async () => ({ ...booking.publicInfo(), demo: { showSmsCode: cfg.devShowSmsCode, mockPay: cfg.payProvider === 'mock', notice: cfg.demoNotice || '' } }));
  app.get('/availability', async req => booking.availability(req.query.serviceId, req.query.from, req.query.days ? +req.query.days : undefined));

  app.post('/auth/sms', async req => auth.sendCode(String((req.body || {}).phone || ''), req.ip));
  app.post('/auth/verify', async req => { const b = req.body || {}; return auth.verifyCode(String(b.phone || ''), b.code, b.name); });
  app.post('/auth/quick', async req => { const b = req.body || {}; return auth.quickLogin(String(b.phone || ''), b.name); });
  app.post('/auth/logout', async req => { auth.logout(bearer(req)); return { ok: true }; });

  app.get('/me', async req => booking.me(customer(req)));
  app.get('/me/bookings', async req => booking.myBookings(customer(req)));
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
