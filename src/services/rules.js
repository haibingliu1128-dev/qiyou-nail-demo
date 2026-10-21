'use strict';
// 防占号规则：默认值、可调范围（服务端校验）、给前端渲染设置页的 schema、给顾客看的规则文案
const DEFAULTS = {
  verify: { on: true },
  maxOpen: { on: true, v: 2 }, perDay: { on: true, v: 1 }, perWeek: { on: false, v: 3 }, perMonth: { on: false, v: 8 },
  rate: { on: true, n: 5, m: 10, lock: 30 },
  cancelH: { on: true, v: 2 }, cancelMonth: { on: false, v: 3 },
  noshow: { on: true, n: 2, days: 90, act: 'block', release: 30 },
  grace: { on: true, v: 15 },
  confirmNew: { on: true },
  deposit: { on: true, force: 30 },
  // 评价与反馈（每项可单独开关；默认全部开启）
  review: { on: true, editDays: 7, photos: true, maxPhotos: 3, lowStar: 3, moderate: 'off',
    tagsPos: ['手法专业', '准时', '环境干净', '性价比高', '服务热情', '效果满意'], tagsNeg: ['等待太久', '效果一般', '沟通不畅', '价格偏高'] },
  reply: { on: true },
  reviewPublic: { on: true },
  feedback: { on: true, photos: true, types: ['功能建议', '服务投诉', '环境卫生', '预约问题', '其他'] },
  contact: { on: true },
};
const BOOLS = new Set(['review.photos', 'feedback.photos']);
// 可编辑的文字列表：[最少项, 最多项, 每项最长字数, 名称]
const LISTS = { 'review.tagsPos': [1, 12, 8, '好评标签'], 'review.tagsNeg': [1, 12, 8, '差评标签'], 'feedback.types': [1, 10, 8, '反馈类型'] };
// [min, max, step, unit, label]
const RANGES = {
  'maxOpen.v': [1, 10, 1, '个', '最多'], 'perDay.v': [1, 10, 1, '个', '每天最多'], 'perWeek.v': [1, 30, 1, '个', '每周最多'], 'perMonth.v': [1, 60, 1, '个', '每月最多'],
  'rate.n': [2, 20, 1, '次', '达到次数'], 'rate.m': [1, 120, 1, '分钟', '统计时间（分钟内）'], 'rate.lock': [5, 1440, 5, '分钟', '暂停时长'],
  'cancelH.v': [1, 72, 1, '小时', '开始前'], 'cancelMonth.v': [1, 30, 1, '次', '每月最多'],
  'noshow.n': [1, 10, 1, '次', '爽约达到'], 'noshow.days': [7, 365, 1, '天', '统计周期'], 'noshow.release': [1, 365, 1, '天', '自动解除'],
  'grace.v': [5, 120, 5, '分钟', '超时未到'], 'deposit.force': [10, 500, 10, '元', '受限顾客定金'],
  'review.editDays': [1, 30, 1, '天', '评价可修改期限'], 'review.maxPhotos': [0, 3, 1, '张', '每条最多照片'], 'review.lowStar': [1, 4, 1, '星', '低分提醒（≤）'],
};
const DEP_RANGE = [10, 500, 10];   // 单项目定金（元）
const ENUMS = { 'noshow.act': ['block', 'deposit'], 'review.moderate': ['off', 'low', 'all'] };
const SCHEMA = [
  { group: '身份验证', rules: [{ key: 'verify', title: '首次预约验证手机号', desc: '短信验证码登录后才能预约（演示环境验证码显示在屏幕上）' }] },
  { group: '数量限制', rules: [
    { key: 'maxOpen', title: '每人最多未完成预约', desc: '同一手机号同时保留的待服务预约上限', fields: ['v'] },
    { key: 'perDay', title: '每人每天最多预约', desc: '按预约日期计算，含已完成', fields: ['v'] },
    { key: 'perWeek', title: '每人每周最多预约', desc: '周一至周日', fields: ['v'] },
    { key: 'perMonth', title: '每人每月最多预约', desc: '按自然月', fields: ['v'] }] },
  { group: '防刷', rules: [{ key: 'rate', title: '短时间反复预约/取消', desc: '在设定时间内预约+取消达到次数，暂停该号码线上操作', fields: ['m', 'n', 'lock'] }] },
  { group: '取消规则', rules: [
    { key: 'cancelH', title: '取消时限', desc: '开始前多少小时内不可线上自助取消', fields: ['v'] },
    { key: 'cancelMonth', title: '每月可自助取消次数', desc: '超过后需联系门店取消', fields: ['v'] }] },
  { group: '爽约处理', rules: [
    { key: 'grace', title: '超时未到自动记爽约', desc: '开始后超过设定分钟仍未到店，自动标记爽约并释放时段', fields: ['v'] },
    { key: 'noshow', title: '爽约限制', desc: '统计周期内爽约达到次数后限制预约；最后一次爽约满「自动解除」天数后恢复', fields: ['n', 'days', 'release'], enum: 'act' }] },
  { group: '定金与审核', rules: [
    { key: 'deposit', title: '定金', desc: '按项目设置的定金（到店抵扣，爽约不退）；受限顾客的定金金额', fields: ['force'] },
    { key: 'confirmNew', title: '新客预约需门店确认', desc: '没有到店记录的顾客，预约先进入「待确认」' }] },
  { group: '评价与反馈', rules: [
    { key: 'review', title: '服务后评价', desc: '顾客对「已完成」的订单评价（每单一次，期限内可修改）；低于等于设定星级会提醒店主', fields: ['editDays', 'lowStar', 'maxPhotos'], bools: ['photos'], enum: 'moderate', lists: ['tagsPos', 'tagsNeg'] },
    { key: 'reply', title: '商家回复', desc: '店主可回复每条评价（一条回复，可修改）；顾客和公开页可见' },
    { key: 'reviewPublic', title: '公开展示评价', desc: '服务详情页和首页显示评分、标签统计和最近评价（手机号打码）' },
    { key: 'feedback', title: '意见反馈', desc: '顾客可随时提交建议/投诉，仅商家可见', bools: ['photos'], lists: ['types'] },
    { key: 'contact', title: '联系商家按钮', desc: '顾客端显示「联系商家」（拨打门店电话、查看地址）' }] },
];
const clone = o => JSON.parse(JSON.stringify(o));
function merged(stored) {
  const r = clone(DEFAULTS);
  for (const k of Object.keys(r)) if (stored && stored[k]) Object.assign(r[k], stored[k]);
  return r;
}
/** 校验部分更新 { key: {on, field...} }，返回规范化的新值；不合法抛出 {path, msg} */
function validatePatch(cur, patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!DEFAULTS[k]) throw { path: k, msg: `未知规则 ${k}` };
    if (typeof v !== 'object' || v === null) throw { path: k, msg: '格式错误' };
    const nv = { ...cur[k] };
    for (const [f, val] of Object.entries(v)) {
      const p = `${k}.${f}`;
      if (f === 'on' || BOOLS.has(p)) { if (typeof val !== 'boolean') throw { path: p, msg: '开关须为 true/false' }; nv[f] = val; continue; }
      if (LISTS[p]) {
        const [mn, mx, len, name] = LISTS[p];
        if (!Array.isArray(val)) throw { path: p, msg: `${name}格式错误` };
        const items = [...new Set(val.map(x => cleanText(x, len + 1)).filter(Boolean))];
        if (items.some(x => x.length > len)) throw { path: p, msg: `${name}每项最多 ${len} 个字` };
        if (items.length < mn || items.length > mx) throw { path: p, msg: `${name}需 ${mn}–${mx} 项` };
        nv[f] = items; continue;
      }
      if (ENUMS[p]) { if (!ENUMS[p].includes(val)) throw { path: p, msg: `只能是 ${ENUMS[p].join('/')}` }; nv[f] = val; continue; }
      const r = RANGES[p]; if (!r) throw { path: p, msg: `未知字段 ${p}` };
      if (typeof val !== 'number' || !Number.isInteger(val)) throw { path: p, msg: `${r[4]}须为整数` };
      if (val < r[0] || val > r[1]) throw { path: p, msg: `${r[4]}须在 ${r[0]}–${r[1]} ${r[3]}之间` };
      if ((val - r[0]) % r[2]) throw { path: p, msg: `${r[4]}须为 ${r[2]} 的倍数` };
      nv[f] = val;
    }
    out[k] = nv;
  }
  return out;
}
/** 文本清洗：去控制字符、把尖括号换成全角（防 HTML 注入；前端输出时仍会转义）、截断 */
function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/</g, '＜').replace(/>/g, '＞').trim().slice(0, max);
}
/** 顾客可见的规则文案（引用当前数值） */
function customerRules(C) {
  const a = [];
  if (C.maxOpen.on) a.push(`每人最多 ${C.maxOpen.v} 个未完成预约`);
  if (C.perDay.on) a.push(`同一天最多 ${C.perDay.v} 个`);
  if (C.perWeek.on) a.push(`每周最多 ${C.perWeek.v} 个`);
  if (C.perMonth.on) a.push(`每月最多 ${C.perMonth.v} 个`);
  if (C.cancelH.on) a.push(`开始前 ${C.cancelH.v} 小时内不可线上取消`);
  if (C.cancelMonth.on) a.push(`每月最多自助取消 ${C.cancelMonth.v} 次`);
  if (C.grace.on) a.push(`超过开始时间 ${C.grace.v} 分钟未到店记为爽约`);
  if (C.verify.on) a.push('首次预约需验证手机号');
  return a;
}
module.exports = { DEFAULTS, RANGES, DEP_RANGE, ENUMS, BOOLS, LISTS, SCHEMA, merged, validatePatch, customerRules, cleanText };
