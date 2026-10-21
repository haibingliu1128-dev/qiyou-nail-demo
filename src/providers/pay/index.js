'use strict';
// 支付通道接口：
//   create({ outTradeNo, amountCents, description, openid }) -> { provider, payParams }   前端拿 payParams 调起支付
//   refund({ outTradeNo, amountCents, reason })              -> { ok, refundId }
//   parseNotify(headers, rawBody)                            -> { outTradeNo, txnId, paid }  验签 + 解密回调
const providers = { mock: () => require('./mock'), wechat: () => require('./wechat-jsapi-v3.stub') };
function createPay(name, opts) {
  const f = providers[name]; if (!f) throw new Error('unknown PAY_PROVIDER ' + name);
  return f().create(opts || {});
}
module.exports = { createPay };
