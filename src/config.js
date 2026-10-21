'use strict';
// 配置：读取 .env（无依赖的极简解析）+ 环境变量。部署时改 .env 即可。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
function loadEnv(f) {
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(process.env.ENV_FILE || path.join(ROOT, '.env'));
process.env.TZ = process.env.TZ || 'Asia/Shanghai'; // 门店本地时区；所有日期/时段按此计算
const E = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const cfg = {
  root: ROOT,
  env: E.NODE_ENV || 'development',
  port: +E.PORT || 3100,
  host: E.HOST || '0.0.0.0',
  dbFile: E.DB_FILE || path.join(ROOT, 'data', 'nail.db'),
  secret: E.APP_SECRET || 'dev-only-insecure-secret-change-me',
  smsProvider: E.SMS_PROVIDER || 'mock',
  payProvider: E.PAY_PROVIDER || 'mock',
  devShowSmsCode: bool(E.DEV_SHOW_SMS_CODE, true),   // 开发/演示：接口返回验证码并在页面显示
  demoMode: bool(E.DEMO_MODE, true),                  // 允许商家「重置演示数据」
  demoNotice: E.DEMO_NOTICE !== undefined ? E.DEMO_NOTICE : '演示环境，数据为示例，每次重启会重置', // 页面顶部提示（设为空字符串可关闭）
  schedulerMs: +E.SCHEDULER_MS || 30000,
  payHoldMin: +E.PAY_HOLD_MIN || 10,                  // 待支付定金时段保留分钟
  customerSessionDays: +E.CUSTOMER_SESSION_DAYS || 30,
  merchantSessionHours: +E.MERCHANT_SESSION_HOURS || 12,
  smsPerIpHour: +E.SMS_PER_IP_HOUR || 20,
  logLevel: E.LOG_LEVEL || 'info',
};
if (cfg.env === 'production' && cfg.secret === 'dev-only-insecure-secret-change-me') console.warn('[config] APP_SECRET 未设置，正在使用不安全的默认值');
module.exports = cfg;
