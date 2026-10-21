'use strict';
/*
 * 微信支付 JSAPI（APIv3）占位实现 —— 未接入真实密钥，调用会返回 501。
 * 接入步骤（详见 README「接入微信支付」）：
 *  1. 需要：已认证的服务号/小程序 AppID、微信支付商户号 mchid、APIv3 密钥、商户 API 证书（apiclient_key.pem）及证书序列号。
 *  2. 下单：POST https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi
 *       body: { appid, mchid, description, out_trade_no, notify_url, amount:{ total: amountCents, currency:'CNY' }, payer:{ openid } }
 *       请求头 Authorization: WECHATPAY2-SHA256-RSA2048 mchid="",nonce_str="",signature="",timestamp="",serial_no=""
 *       （签名串 = METHOD\nURL\ntimestamp\nnonce\nbody\n，用商户私钥 SHA256withRSA）
 *  3. 返回 prepay_id 后，生成前端调起参数 { appId, timeStamp, nonceStr, package:'prepay_id=...', signType:'RSA', paySign }
 *     H5（公众号内）用 WeixinJSBridge.invoke('getBrandWCPayRequest', params)；小程序用 wx.requestPayment(params)。
 *  4. 回调 notify_url：校验 Wechatpay-Signature（平台证书公钥），用 APIv3 密钥 AES-256-GCM 解密 resource，
 *     trade_state === 'SUCCESS' 时调用 bookingService.markPaid(out_trade_no, transaction_id)。必须幂等。
 *  5. 退款：POST /v3/refund/domestic/refunds { out_trade_no, out_refund_no, amount:{ refund, total, currency:'CNY' } }
 *  推荐使用官方/社区 SDK（如 wechatpay-node-v3）处理签名与解密。
 */
exports.create = () => {
  const ni = () => { throw Object.assign(new Error('微信支付未配置（见 src/providers/pay/wechat-jsapi-v3.stub.js）'), { status: 501 }); };
  return { name: 'wechat', create: async () => ni(), refund: async () => ni(), parseNotify: ni };
};
