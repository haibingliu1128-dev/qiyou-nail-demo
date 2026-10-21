'use strict';
// 组装应用：配置 → 数据库 → 数据访问层 → 通道（短信/支付）→ 业务服务 → HTTP 路由
const path = require('path');
const EventEmitter = require('events');
const Fastify = require('fastify');
const cfgDefault = require('./config');
const { open } = require('./db');
const { createRepo } = require('./repo/sqlite');
const { createSms } = require('./providers/sms');
const { createPay } = require('./providers/pay');
const { createAuthService } = require('./services/auth');
const { createBookingService } = require('./services/booking');
const { createMerchantService } = require('./services/merchant');
const { createImageService, MAX_BYTES } = require('./services/images');
const { seed } = require('./seed');
const { AppError } = require('./lib/util');

async function build(over = {}) {
  const cfg = { ...cfgDefault, ...over };
  const app = Fastify({ logger: over.logger !== undefined ? over.logger : { level: cfg.logLevel }, trustProxy: true, bodyLimit: 64 * 1024 });
  const db = open(cfg.dbFile);
  const repo = createRepo(db);
  const bus = new EventEmitter(); bus.setMaxListeners(200);
  const sms = createSms(cfg.smsProvider, { log: app.log });
  const pay = createPay(cfg.payProvider, { log: app.log });
  const ctx = { cfg, repo, bus, sms, pay, log: app.log };
  ctx.images = createImageService(ctx);
  ctx.auth = createAuthService(ctx);
  ctx.booking = createBookingService(ctx);
  ctx.merchant = createMerchantService(ctx, ctx.booking);
  await seed(repo, ctx.auth, { images: ctx.images });
  app.decorate('ctx', ctx);

  // 图片上传：原始二进制（Content-Type: image/jpeg|png|webp），单独的大小上限；真实格式由魔数校验
  app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_BYTES }, (req, body, done) => done(null, body));
  app.setErrorHandler((err, req, reply) => {
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' && /image|octet/.test(req.headers['content-type'] || '')) return reply.code(413).send({ error: { code: 'IMAGE_TOO_LARGE', message: `图片太大：压缩后需小于 ${MAX_BYTES / 1024 / 1024}MB` } });
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return reply.code(415).send({ error: { code: 'BAD_CONTENT_TYPE', message: '不支持的内容类型（图片仅支持 JPG / PNG / WebP）' } });
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.extra || {}) } });
    if (err.validation) return reply.code(400).send({ error: { code: 'BAD_INPUT', message: err.message } });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: err.code || 'BAD_REQUEST', message: err.message } });
    req.log.error(err);
    reply.code(err.status || 500).send({ error: { code: 'SERVER_ERROR', message: err.status === 501 ? err.message : '服务器开小差了，请稍后再试' } });
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) { if (!reply.getHeader('Cache-Control')) reply.header('Cache-Control', 'no-store'); }
    else if (!reply.getHeader('Cache-Control')) reply.header('Cache-Control', 'no-cache');
    reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });
  await app.register(require('./routes/public'), { prefix: '/api' });
  await app.register(require('./routes/merchant'), { prefix: '/api/merchant' });
  await app.register(require('@fastify/static'), { root: path.join(cfg.root, 'public'), prefix: '/', index: ['index.html'], cacheControl: false });
  app.get('/m', (req, reply) => reply.redirect('/#merchant'));
  app.get('/favicon.ico', (req, reply) => reply.code(204).send());

  // 定时任务：过期待支付/待确认、超时未到自动爽约
  let timer = null;
  ctx.startScheduler = () => {
    const run = () => { ctx.booking.tick().catch(e => app.log.error(e)); try { repo.purgeOrphanImages(24 * 3600e3); } catch (e) { app.log.error(e); } };
    run(); timer = setInterval(run, cfg.schedulerMs); timer.unref();
  };
  app.addHook('onClose', async () => { clearInterval(timer); db.close(); });
  return app;
}
module.exports = { build };
