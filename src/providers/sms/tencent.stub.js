'use strict';
// 腾讯云短信（占位）。上线需：企业/个体资质、短信签名与模板审核通过、SecretId/SecretKey。
// 实现方式：npm i tencentcloud-sdk-nodejs-sms，调用 SendSms({ PhoneNumberSet:['+86'+phone], SmsSdkAppId, SignName, TemplateId, TemplateParamSet:[code,'5'] })
// 环境变量建议：TENCENT_SECRET_ID / TENCENT_SECRET_KEY / SMS_APP_ID / SMS_SIGN / SMS_TEMPLATE_ID
exports.create = () => ({
  name: 'tencent',
  async send() { throw Object.assign(new Error('腾讯云短信尚未配置（见 src/providers/sms/tencent.stub.js 与 README）'), { status: 501 }); },
});
