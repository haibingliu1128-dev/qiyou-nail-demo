'use strict';
// 短信通道接口：send({ phone, code, purpose }) -> Promise<{ ok, devCode? }>
// 新增通道：实现同名方法并在此注册；在 .env 设置 SMS_PROVIDER=<name>
const providers = { mock: () => require('./mock'), tencent: () => require('./tencent.stub') };
function createSms(name, opts) {
  const f = providers[name]; if (!f) throw new Error('unknown SMS_PROVIDER ' + name);
  return f().create(opts || {});
}
module.exports = { createSms };
