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
};
// [min, max, step, unit, label]
const RANGES = {
  'maxOpen.v': [1, 10, 1, '个', '最多'], 'perDay.v': [1, 10, 1, '个', '每天最多'], 'perWeek.v': [1, 30, 1, '个', '每周最多'], 'perMonth.v': [1, 60, 1, '个', '每月最多'],
  'rate.n': [2, 20, 1, '次', '达到次数'], 'rate.m': [1, 120, 1, '分钟', '统计时间（分钟内）'], 'rate.lock': [5, 1440, 5, '分钟', '暂停时长'],
  'cancelH.v': [1, 72, 1, '小时', '开始前'], 'cancelMonth.v': [1, 30, 1, '次', '每月最多'],
  'noshow.n': [1, 10, 1, '次', '爽约达到'], 'noshow.days': [7, 365, 1, '天', '统计周期'], 'noshow.release': [1, 365, 1, '天', '自动解除'],
  'grace.v': [5, 120, 5, '分钟', '超时未到'], 'deposit.force': [10, 500, 10, '元', '受限顾客定金'],
};
const DEP_RANGE = [10, 500, 10];   // 单项目定金（元）
const ENUMS = { 'noshow.act': ['block', 'deposit'] };
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
      if (f === 'on') { if (typeof val !== 'boolean') throw { path: p, msg: '开关须为 true/false' }; nv.on = val; continue; }
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
module.exports = { DEFAULTS, RANGES, DEP_RANGE, ENUMS, SCHEMA, merged, validatePatch, customerRules };
