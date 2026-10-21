'use strict';
// 店员权限：店主始终拥有全部权限；店员除「处理预约」默认开启外其余默认关闭，由店主在「店员权限」逐项授权。
// 每个请求都会重新读取账号（auth.resolve），所以授权/收回立即生效。
const { AppError } = require('../lib/util');
const PERMS = [
  { key: 'booking.handle', label: '处理预约', desc: '确认/拒绝、到店、完成、取消、标记爽约（关闭后只能查看预约）', default: true },
  { key: 'customer.blacklist', label: '拉黑/解除拉黑顾客', desc: '拉黑、移出黑名单、解除爽约限制' },
  { key: 'customer.phone', label: '查看顾客完整手机号', desc: '预约列表、顾客列表、意见反馈回访中显示完整号码（未授权时一律打码，如 138****5678）' },
  { key: 'review.reply', label: '回复评价', desc: '回复顾客评价、修改回复' },
  { key: 'review.hide', label: '隐藏/显示评价', desc: '隐藏评价或恢复公开' },
  { key: 'review.approve', label: '审核评价', desc: '「先审后发」时通过待审核评价' },
  { key: 'feedback.handle', label: '处理意见反馈', desc: '修改处理状态、填写内部备注' },
  { key: 'service.manage', label: '管理服务与图片', desc: '新增/编辑/下架服务、上传服务图片、单项定金' },
  { key: 'rules.edit', label: '修改防占号规则', desc: '数量限制、取消、爽约、定金等规则（不含评价与反馈开关、恢复默认、门店信息）' },
];
const BY_KEY = Object.fromEntries(PERMS.map(p => [p.key, p]));
const parse = j => { try { const o = JSON.parse(j || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const DEFAULTS = Object.fromEntries(PERMS.map(p => [p.key, !!p.default]));
/** 店员某项是否开启：显式设置优先，否则用默认值（处理预约默认开，其余默认关） */
const val = (stored, key) => (key in stored ? stored[key] === true : !!DEFAULTS[key]);
/** 账号的实际权限（店主全部为 true） */
const effective = u => { const s = parse(u.perms); return Object.fromEntries(PERMS.map(p => [p.key, u.role === 'owner' || val(s, p.key)])); };
const can = (u, key) => !!u && (u.role === 'owner' || (!!BY_KEY[key] && val(parse(u.perms), key)));
const { maskPhone } = require('../lib/util');
/** 按权限返回手机号：店主或有「查看顾客完整手机号」→ 完整，否则打码（服务端打码，不依赖前端） */
const phoneFor = (u, phone) => (phone && !can(u, 'customer.phone') ? maskPhone(phone) : phone);
function need(u, key) {
  if (!can(u, key)) throw new AppError(403, 'NO_PERMISSION', `店主未授权你「${BY_KEY[key].label}」，如需操作请联系店主在「店员权限」中开通`, { perm: key });
}
const ownerOnly = (u, what) => { if (!u || u.role !== 'owner') throw new AppError(403, 'OWNER_ONLY', `仅店主可${what || '操作'}`); };

function createPermService({ repo, bus, auth }) {
  const audit = (user, action, target, detail, ip) => repo.audit({ actor_type: 'merchant', actor_id: user.id, actor_name: user.username, action, target, detail, ip });
  const dto = u => ({ id: u.id, username: u.username, name: u.display_name, role: u.role, active: !!u.active, perms: effective(u), createdAt: u.created_at });
  function list(user) {
    ownerOnly(user, '管理店员权限');
    return { perms: PERMS, staff: repo.listMerchants().filter(u => u.role === 'staff').map(dto) };
  }
  async function create(user, b, ip) {
    ownerOnly(user, '管理店员权限');
    const username = String(b.username || '').trim(), name = String(b.name || '').trim().replace(/[<>]/g, ''), password = String(b.password || '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new AppError(400, 'BAD_INPUT', '账号为 3–20 位字母、数字或下划线');
    if (repo.getMerchantByUsername(username)) throw new AppError(409, 'USERNAME_TAKEN', '该账号已存在');
    if (!name || name.length > 12) throw new AppError(400, 'BAD_INPUT', '店员名称 1–12 字');
    if (password.length < 6 || password.length > 64) throw new AppError(400, 'BAD_INPUT', '密码 6–64 位');
    repo.insertMerchant({ username, password_hash: await auth.hashPassword(password), role: 'staff', display_name: name });
    let u = repo.getMerchantByUsername(username);
    repo.updateMerchant(u.id, { perms: JSON.stringify(DEFAULTS) });   // 新店员：显式写入默认值（处理预约开，其余关）
    u = repo.getMerchant(u.id);
    audit(user, 'staff.create', 'merchant:' + u.id + ' ' + username, { username, name }, ip);
    bus.emit('change', { type: 'perms', userId: u.id });
    return dto(u);
  }
  async function update(user, id, b, ip) {
    ownerOnly(user, '管理店员权限');
    const u = repo.getMerchant(+id);
    if (!u || u.role !== 'staff') throw new AppError(404, 'NOT_FOUND', '店员账号不存在');
    const f = {}, detail = {};
    if (b.perms !== undefined) {
      if (typeof b.perms !== 'object' || b.perms === null || Array.isArray(b.perms)) throw new AppError(400, 'BAD_INPUT', '权限格式错误');
      const stored = parse(u.perms), cur = Object.fromEntries(PERMS.map(p => [p.key, val(stored, p.key)]));
      for (const [k, v] of Object.entries(b.perms)) {
        if (!BY_KEY[k]) throw new AppError(400, 'BAD_INPUT', `未知权限 ${k}`);
        if (typeof v !== 'boolean') throw new AppError(400, 'BAD_INPUT', '权限开关须为 true/false');
        cur[k] = v; detail[k] = v;
      }
      f.perms = JSON.stringify(cur);   // 每项都显式保存 true/false（默认开启的项关闭后也能保持关闭）
    }
    if (b.active !== undefined) { f.active = b.active ? 1 : 0; detail.active = !!b.active; }
    if (b.name !== undefined) { const n = String(b.name).trim().replace(/[<>]/g, ''); if (!n || n.length > 12) throw new AppError(400, 'BAD_INPUT', '店员名称 1–12 字'); f.display_name = n; }
    if (b.password !== undefined) { const p = String(b.password); if (p.length < 6 || p.length > 64) throw new AppError(400, 'BAD_INPUT', '密码 6–64 位'); f.password_hash = await auth.hashPassword(p); detail.password = '已重置'; }
    repo.updateMerchant(u.id, f);
    if (f.active === 0 || f.password_hash) repo.deleteSubjectSessions('merchant', u.id);   // 停用/改密：立即下线
    audit(user, 'staff.update', 'merchant:' + u.id + ' ' + u.username, detail, ip);
    bus.emit('change', { type: 'perms', userId: u.id });
    return dto(repo.getMerchant(u.id));
  }
  return { list, create, update, dto, PERMS };
}
module.exports = { createPermService, PERMS, DEFAULTS, can, need, effective, ownerOnly, phoneFor };
