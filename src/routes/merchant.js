'use strict';
// 商家端 API（商家令牌；店主 owner / 员工 staff）
const { AppError } = require('../lib/util');
const { seed } = require('../seed');
module.exports = async function (app) {
  const { auth, booking, merchant, bus, cfg, repo } = app.ctx;
  const tok = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token || null;
  app.decorateRequest('user', null);
  app.addHook('preHandler', async req => {
    if (req.routeOptions.url === '/api/merchant/login') return;
    const u = auth.resolve(tok(req), 'merchant');
    if (!u) throw new AppError(401, 'NEED_LOGIN', '请先登录商家后台');
    req.user = u;
  });
  app.post('/login', async req => { const b = req.body || {}; return auth.merchantLogin(b.username, b.password, req.ip); });
  app.post('/logout', async req => { auth.logout(tok(req)); return { ok: true }; });
  app.get('/me', async req => ({ username: req.user.username, role: req.user.role, name: req.user.display_name }));
  app.get('/dashboard', async () => ({ ...merchant.dashboard(), inbox: app.ctx.reviews.counts() }));
  app.get('/bookings', async req => merchant.bookings(req.query.scope || 'today', req.query.date));
  for (const op of ['accept', 'reject', 'arrive', 'done', 'noshow', 'cancel'])
    app.post(`/bookings/:id/${op}`, async req => booking.merchantAction(req.user, req.params.id, op, { ip: req.ip }));
  app.get('/noshows', async () => merchant.noShows());
  app.get('/customers', async req => merchant.customers(req.query.q));
  app.post('/customers/blacklist', async req => { const b = req.body || {}; return merchant.setBlacklist(req.user, String(b.phone || ''), b.on !== false, b.reason, req.ip); });
  app.post('/customers/:phone/clear', async req => merchant.clearRestriction(req.user, req.params.phone, req.ip));
  app.get('/settings', async () => merchant.getSettings());
  app.put('/settings', async req => merchant.updateSettings(req.user, req.body || {}, req.ip));
  app.post('/settings/reset', async req => merchant.resetSettings(req.user, req.ip));
  app.get('/services', async () => repo.listServices().map(s => booking.svcDto(s, booking.settings())));
  app.post('/services', async req => merchant.saveService(req.user, null, req.body || {}, req.ip));
  app.put('/services/:id', async req => merchant.saveService(req.user, req.params.id, req.body || {}, req.ip));
  app.delete('/services/:id', async req => merchant.deleteService(req.user, req.params.id, req.ip));
  // 上传图片（店主）：请求体为压缩后的图片二进制，返回 {id,url}；保存服务时把 id 放进 images 数组
  app.post('/images', async (req, reply) => {
    if (req.user.role !== 'owner') throw new AppError(403, 'OWNER_ONLY', '仅店主可上传服务图片');
    const r = app.ctx.images.save(req.body, { type: 'merchant', id: req.user.id });
    repo.audit({ actor_type: 'merchant', actor_id: req.user.id, actor_name: req.user.username, action: 'image.upload', target: 'image:' + r.id, detail: { bytes: r.bytes, mime: r.mime }, ip: req.ip });
    reply.code(201); return r;
  });
  // 评价管理 / 意见反馈 / 门店信息
  app.get('/reviews', async req => app.ctx.reviews.merchantReviews(req.user, req.query.filter));
  const doReply = async req => app.ctx.reviews.reply(req.user, req.params.id, (req.body || {}).text, req.ip);
  app.post('/reviews/:id/reply', doReply); app.put('/reviews/:id/reply', doReply);
  for (const op of ['hide', 'unhide', 'approve']) app.post(`/reviews/:id/${op}`, async req => app.ctx.reviews.setVisibility(req.user, req.params.id, op, req.ip));
  app.get('/feedback', async req => app.ctx.reviews.merchantFeedback(req.user, req.query.status));
  app.put('/feedback/:id', async req => app.ctx.reviews.updateFeedback(req.user, req.params.id, req.body || {}, req.ip));
  app.get('/inbox', async () => app.ctx.reviews.counts());
  app.put('/shop', async req => app.ctx.reviews.updateShop(req.user, req.body || {}, req.ip));
  app.get('/audit', async req => merchant.auditLog(req.user));
  app.post('/demo-reset', async req => {
    if (!cfg.demoMode) throw new AppError(404, 'NOT_FOUND', 'not found');
    if (req.user.role !== 'owner') throw new AppError(403, 'OWNER_ONLY', '仅店主可重置');
    await seed(repo, auth, { force: true, images: app.ctx.images });
    repo.audit({ actor_type: 'merchant', actor_id: req.user.id, actor_name: req.user.username, action: 'demo.reset', ip: req.ip });
    bus.emit('change', { type: 'reset' });
    return { ok: true };
  });
  // 实时推送（SSE）：有新预约/状态变化时通知商家端刷新。EventSource 无法带 Header，令牌走 ?token=
  app.get('/stream', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const send = e => res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`);
    const hb = setInterval(() => res.write(': ping\n\n'), 20000);
    bus.on('change', send);
    req.raw.on('close', () => { clearInterval(hb); bus.off('change', send); });
  });
};
