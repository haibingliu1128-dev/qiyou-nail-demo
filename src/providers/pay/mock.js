'use strict';
// 模拟支付：不扣款。前端展示「微信支付（演示）」面板，点击后调用 /api/pay/mock/:outTradeNo/confirm 模拟支付成功回调
exports.create = () => ({
  name: 'mock',
  async create({ outTradeNo, amountCents }) { return { provider: 'mock', payParams: { mock: true, outTradeNo, amountCents } }; },
  async refund({ outTradeNo }) { return { ok: true, refundId: 'mock-rf-' + outTradeNo }; },
  parseNotify() { throw new Error('mock provider uses /api/pay/mock/:no/confirm'); },
});
