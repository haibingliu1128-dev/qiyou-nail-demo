'use strict';
// 商家后台业务：看板、预约列表、顾客/黑名单、防占号设置、服务管理、审计
const U = require('../lib/util');
const Rules = require('./rules');
const { AppError, today, toHm } = U;

function createMerchantService(ctx, B) {
  const { repo, bus } = ctx;
  const audit = (user, action, target, detail, ip) => repo.audit({ actor_type: 'merchant', actor_id: user.id, actor_name: user.username, action, target, detail, ip });
  const owner = user => { if (user.role !== 'owner') throw new AppError(403, 'OWNER_ONLY', '仅店主账号可修改该设置'); };

  function dashboard() {
    const t = today(), [a, b] = U.weekRange(t), s = repo.stats(t, a, b);
    const days = []; for (let i = 0; i < 7; i++) { const d = U.ymd(U.addDays(U.parseYmd(a), i)); const r = s.week.find(x => x.date === d); days.push({ date: d, amount: r ? r.s / 100 : 0 }); }
    return { today: s.today, pending: s.pending, upcoming: s.upcoming, noshow30: s.noshow30, blacklisted: s.blacklisted, week: days };
  }
  function bookings(scope, date) {
    const t = today();
    let rows;
    if (scope === 'today') rows = repo.listBookings({ from: date || t, to: date || t });
    else if (scope === 'pending') rows = repo.listBookings({ from: U.ymd(U.addDays(new Date(), -1)), statuses: ['pending', 'awaiting_payment'] });
    else if (scope === 'upcoming') rows = repo.listBookings({ from: t, statuses: ['pending', 'confirmed', 'arrived', 'awaiting_payment'] });
    else rows = repo.listBookings({ limit: 200 });
    return rows.map(b => B.dto(b, { merchant: true }));
  }
  function customers(q) {
    const C = B.settings();
    return repo.listCustomers(q && String(q).trim()).map(c => {
      const r = B.restriction(C, c);
      return { id: c.id, phone: c.phone, name: c.name, blacklisted: !!c.blacklisted, blackReason: c.black_reason, total: c.total, noshowTotal: c.noshow_total,
        noshowInWindow: r.count, restricted: r.restricted ? { act: r.act, until: r.until } : null, verified: !!c.verified_at,
        rateLockedUntil: c.rate_lock_until > Date.now() ? c.rate_lock_until : null };
    });
  }
  function setBlacklist(user, phone, on, reason, ip) {
    if (!U.isPhone(phone)) throw new AppError(400, 'BAD_PHONE', '请输入正确的 11 位手机号');
    const c = repo.ensureCustomer(phone);
    repo.updateCustomer(c.id, { blacklisted: on ? 1 : 0, black_reason: on ? String(reason || '').slice(0, 40) || null : null });
    audit(user, on ? 'customer.blacklist' : 'customer.unblacklist', 'customer:' + phone, { reason }, ip);
    bus.emit('change', { type: 'customer' });
    return { phone, blacklisted: !!on };
  }
  function clearRestriction(user, phone, ip) {
    const c = repo.getCustomerByPhone(phone); if (!c) throw new AppError(404, 'NOT_FOUND', '顾客不存在');
    repo.updateCustomer(c.id, { restrict_cleared_at: Date.now(), rate_lock_until: null });
    audit(user, 'customer.clear_restriction', 'customer:' + phone, null, ip);
    bus.emit('change', { type: 'customer' });
    return { ok: true };
  }
  function getSettings() {
    return { values: B.settings(), schema: Rules.SCHEMA, ranges: Rules.RANGES, depositRange: Rules.DEP_RANGE, defaults: Rules.DEFAULTS,
      services: repo.listServices(true).filter(s => s.active).map(s => ({ id: s.id, name: s.name, depositOn: !!s.deposit_on, deposit: s.deposit_cents / 100 })) };
  }
  function updateSettings(user, patch, ip) {
    owner(user);
    const cur = B.settings();
    let nv; try { nv = Rules.validatePatch(cur, patch); } catch (e) { throw new AppError(400, 'BAD_SETTING', e.msg, { path: e.path }); }
    repo.tx(() => { for (const [k, v] of Object.entries(nv)) repo.putSetting(k, v); });
    audit(user, 'settings.update', 'settings', nv, ip);
    bus.emit('change', { type: 'settings' });
    return getSettings();
  }
  function resetSettings(user, ip) {
    owner(user); repo.clearSettings(); audit(user, 'settings.reset', 'settings', null, ip); bus.emit('change', { type: 'settings' }); return getSettings();
  }
  function cleanService(b, partial) {
    const f = {};
    const need = k => !partial || b[k] !== undefined;
    if (need('name')) { const n = String(b.name || '').trim(); if (!n || n.length > 14) throw new AppError(400, 'BAD_INPUT', '服务名称 1–14 字'); f.name = n; }
    if (need('desc')) f.descr = String(b.desc || '').trim().slice(0, 24);
    if (need('price')) { const p = Number(b.price); if (!(p >= 0 && p <= 99999)) throw new AppError(400, 'BAD_INPUT', '价格须在 0–99999 元'); f.price_cents = Math.round(p * 100); }
    if (need('duration')) { const d = Number(b.duration); if (![30, 45, 60, 90, 120, 150, 180].includes(d)) throw new AppError(400, 'BAD_INPUT', '时长不合法'); f.duration_min = d; }
    if (b.icon !== undefined) f.icon = String(b.icon).slice(0, 12);
    if (b.color !== undefined) f.color = Math.max(0, Math.min(5, +b.color || 0));
    if (b.images !== undefined) f.images = JSON.stringify(ctx.images.checkIds(b.images, 3, '服务图片'));
    if (b.depositOn !== undefined) f.deposit_on = b.depositOn ? 1 : 0;
    if (b.deposit !== undefined) {
      const [mn, mx, st] = Rules.DEP_RANGE, v = Number(b.deposit);
      if (!Number.isInteger(v) || v < mn || v > mx || (v - mn) % st) throw new AppError(400, 'BAD_SETTING', `定金须在 ${mn}–${mx} 元之间，且为 ${st} 的倍数`, { path: 'dep' });
      f.deposit_cents = v * 100;
    }
    return f;
  }
  function saveService(user, id, body, ip) {
    owner(user);
    if (id) {
      const s = repo.getService(+id); if (!s || !s.active) throw new AppError(404, 'NOT_FOUND', '服务不存在');
      const f = cleanService(body, true); repo.updateService(s.id, f); audit(user, 'service.update', 'service:' + s.id, f, ip);
    } else {
      const f = cleanService(body, false);
      id = repo.insertService({ icon: 'polish', color: 0, hot: 0, sort: 99, deposit_on: 0, deposit_cents: 3000, ...f });
      audit(user, 'service.create', 'service:' + id, f, ip);
    }
    bus.emit('change', { type: 'service' });
    return B.svcDto(repo.getService(+id), B.settings());
  }
  function deleteService(user, id, ip) {
    owner(user); repo.updateService(+id, { active: 0 }); audit(user, 'service.delete', 'service:' + id, null, ip); bus.emit('change', { type: 'service' }); return { ok: true };
  }
  function noShows() { return repo.recentNoShows(20).map(b => B.dto(b, { merchant: true })); }
  function auditLog(user) { owner(user); return repo.listAudit(150).map(a => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null })); }
  return { dashboard, bookings, customers, setBlacklist, clearRestriction, getSettings, updateSettings, resetSettings, saveService, deleteService, noShows, auditLog };
}
module.exports = { createMerchantService };
