'use strict';
const { build } = require('./app');
(async () => {
  const app = await build();
  const { port, host } = app.ctx.cfg;
  app.ctx.startScheduler();
  await app.listen({ port, host });
  app.log.info(`栖柚美甲 full-stack demo listening on http://${host}:${port}  (sms=${app.ctx.cfg.smsProvider}, pay=${app.ctx.cfg.payProvider})`);
  const stop = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch(e => { console.error(e); process.exit(1); });
