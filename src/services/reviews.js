'use strict';
// 评价与反馈：服务后评价、商家回复、公开展示、意见反馈、联系商家。
// 每项功能都受商家设置开关控制：关闭后前端隐藏，服务端同样拒绝（403 FEATURE_OFF）。
const U = require('../lib/util');
const Rules = require('./rules');
const Perm = require('./perms');
const { AppError, maskPhone } = U;
const DAY = 864e5;
const FB_STATUS = { open: '待处理', doing: '处理中', done: '已处理' };
const CONTACT = { phone: '电话回访', sms: '短信回复', none: '无需回复' };

function createReviewService(ctx) {
  const { repo, bus, images } = ctx;
  const C = () => Rules.merged(repo.getSettings());
  const off = (on, msg) => { if (!on) throw new AppError(403, 'FEATURE_OFF', msg); };
  const parse = images.parse, url = images.url;
  const audit = (user, action, target, detail, ip) => repo.audit({ actor_type: 'merchant', actor_id: user.id, actor_name: user.username, action, target, detail, ip });
  const owner = user => { if (user.role !== 'owner') throw new AppError(403, 'OWNER_ONLY', '仅店主账号可操作'); };

  // ---- 频率限制：按顾客（数据库事件）+ 按 IP（内存滑动窗口，单实例足够）----
  const ipHits = new Map();
  function limitIp(key, max, windowMs, msg) {
    const t = Date.now(), a = (ipHits.get(key) || []).filter(x => x > t - windowMs);
    if (a.length >= max) throw new AppError(429, 'TOO_FREQUENT', msg);
    a.push(t); ipHits.set(key, a);
    if (ipHits.size > 5000) for (const [k, v] of ipHits) if (!v.some(x => x > t - DAY)) ipHits.delete(k);
  }
  function limitCustomer(cust, kind, max, windowMs, msg) {
    if (repo.countEvents(cust.id, [kind], Date.now() - windowMs) >= max) throw new AppError(429, 'TOO_FREQUENT', msg);
  }
  const LIM = { review: [10, 3600e3, '评价提交太频繁，请稍后再试'], feedback: [5, DAY, '今天提交的反馈已达 5 条，如有急事请直接联系门店'], upload: [30, 3600e3, '上传太频繁，请稍后再试'] };
  const IPLIM = { review: [30, 3600e3], feedback: [20, DAY], upload: [60, 3600e3] };
  function guard(cust, kind, ip) {
    const [m, w, msg] = LIM[kind]; limitCustomer(cust, kind, m, w, msg);
    if (ip) limitIp(kind + ':' + ip, IPLIM[kind][0], IPLIM[kind][1], msg);
  }

  /** 校验顾客上传的图片：必须存在且是本人上传 */
  function ownPhotos(ids, max, cust, label) {
    const u = images.checkIds(ids, max, label);
    const meta = repo.imageMeta(u);
    if (meta.some(m => !(m.owner_type === 'customer' && m.owner_id === cust.id))) throw new AppError(400, 'IMAGE_NOT_FOUND', '图片不存在或已过期，请重新上传');
    return u;
  }

  // ---- 统计 ----
  function summary(rows, C0) {
    const n = rows.length, dist = [0, 0, 0, 0, 0], tags = {};
    let sum = 0;
    for (const r of rows) { sum += r.stars; dist[r.stars - 1]++; for (const t of parse(r.tags)) tags[t] = (tags[t] || 0) + 1; }
    const neg = new Set(C0.review.tagsNeg);
    return { count: n, avg: n ? Math.round(sum / n * 10) / 10 : null, good: n ? Math.round((dist[3] + dist[4]) / n * 100) : null, dist,
      tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, n]) => ({ tag, n, neg: neg.has(tag) })) };
  }
  const publicDto = (r, C0) => ({ id: r.id, stars: r.stars, tags: parse(r.tags), text: r.text, photos: parse(r.photos).map(url), who: maskPhone(r.phone), serviceName: r.service_name,
    createdAt: r.created_at, seed: !!r.seed, reply: C0.reply.on && r.reply_text ? { text: r.reply_text, at: r.reply_at } : null });
  const ownDto = (r, C0) => ({ id: r.id, stars: r.stars, tags: parse(r.tags), text: r.text, photos: parse(r.photos).map(id => ({ id, url: url(id) })), status: r.status,
    createdAt: r.created_at, editableUntil: r.created_at + C0.review.editDays * DAY, canEdit: C0.review.on && Date.now() < r.created_at + C0.review.editDays * DAY,
    reply: C0.reply.on && r.reply_text ? { text: r.reply_text, at: r.reply_at } : null });
  const merchantDto = (r, C0) => ({ ...publicDto(r, C0), reply: r.reply_text ? { text: r.reply_text, at: r.reply_at, by: r.reply_by } : null, status: r.status,
    moderatedBy: r.moderated_by || null, moderatedAt: r.moderated_at || null,
    phone: maskPhone(r.phone), bookingId: r.booking_id, bookingCode: r.code, date: r.date, time: U.toHm(r.start_min), low: r.stars <= C0.review.lowStar, alertNew: r.stars <= C0.review.lowStar && !r.alert_seen });

  // ---- 顾客端公开信息 ----
  function features(C0) {
    return { review: C0.review.on, reply: C0.reply.on, reviewPublic: C0.reviewPublic.on, feedback: C0.feedback.on, contact: C0.contact.on,
      reviewPhotos: C0.review.photos ? C0.review.maxPhotos : 0, editDays: C0.review.editDays, tagsPos: C0.review.tagsPos, tagsNeg: C0.review.tagsNeg,
      feedbackTypes: C0.feedback.types, feedbackPhotos: C0.feedback.photos ? 3 : 0 };
  }
  /** /api/shop 附加：功能开关、全店评分、各服务评分（公开展示关闭时不返回评分） */
  function shopExtras() {
    const C0 = C(), f = features(C0);
    if (!C0.reviewPublic.on) return { features: f, rating: null, serviceRatings: {} };
    const rows = repo.reviewRows({ publicOnly: true }), by = {};
    for (const r of rows) (by[r.service_id] = by[r.service_id] || []).push(r);
    const serviceRatings = {};
    for (const [sid, rs] of Object.entries(by)) { const s = summary(rs, C0); serviceRatings[sid] = { avg: s.avg, count: s.count }; }
    return { features: f, rating: summary(rows, C0), serviceRatings };
  }
  function publicList(serviceId, offset, limit) {
    const C0 = C(); off(C0.reviewPublic.on, '门店未开启评价展示');
    const sid = serviceId ? +serviceId : null;
    limit = Math.min(Math.max(+limit || 10, 1), 30); offset = Math.max(+offset || 0, 0);
    const items = repo.listPublicReviews({ serviceId: sid, limit: limit + 1, offset });
    return { summary: summary(repo.reviewRows({ serviceId: sid, publicOnly: true }), C0), items: items.slice(0, limit).map(r => publicDto(r, C0)), hasMore: items.length > limit };
  }

  // ---- 顾客：评价 ----
  function cleanReview(C0, b, cust) {
    const stars = Number(b.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new AppError(400, 'BAD_INPUT', '请选择 1–5 星');
    const allowed = new Set(C0.review.tagsPos.concat(C0.review.tagsNeg));
    const tags = [...new Set((Array.isArray(b.tags) ? b.tags : []).map(String))];
    if (tags.length > 8 || tags.some(t => !allowed.has(t))) throw new AppError(400, 'BAD_TAG', '标签不在门店设置的列表里，请刷新后重选');
    const raw = String(b.text == null ? '' : b.text);
    if ([...raw.trim()].length > 300) throw new AppError(400, 'TEXT_TOO_LONG', '评价内容最多 300 字');
    const text = Rules.cleanText(raw, 300);
    const max = C0.review.photos ? C0.review.maxPhotos : 0;
    const ph = Array.isArray(b.photos) ? b.photos : [];
    if (ph.length && !max) throw new AppError(403, 'FEATURE_OFF', '门店未开启评价晒图');
    const photos = ownPhotos(ph, max, cust, '评价照片');
    return { stars, tags, text, photos };
  }
  const statusFor = (C0, stars) => C0.review.moderate === 'all' || (C0.review.moderate === 'low' && stars <= C0.review.lowStar) ? 'pending' : 'public';
  function createReview(cust, body, ip) {
    const C0 = C(); off(C0.review.on, '门店已关闭评价功能');
    const b = repo.getBooking(+(body || {}).bookingId);
    if (!b || b.customer_id !== cust.id) throw new AppError(404, 'BOOKING_NOT_FOUND', '订单不存在');
    if (b.status !== 'done') throw new AppError(403, 'NOT_COMPLETED', '订单完成后才能评价');
    if (repo.reviewsByBookings([b.id]).length) throw new AppError(409, 'ALREADY_REVIEWED', '这单已经评价过了，可以在期限内修改');
    guard(cust, 'review', ip);
    const v = cleanReview(C0, body, cust);
    const id = repo.insertReview({ booking_id: b.id, customer_id: cust.id, service_id: b.service_id, stars: v.stars, tags: JSON.stringify(v.tags), text: v.text, photos: JSON.stringify(v.photos),
      status: statusFor(C0, v.stars), alert_seen: v.stars <= C0.review.lowStar ? 0 : 1 });
    repo.addEvent(cust.id, 'review', b.id);
    bus.emit('change', { type: 'review', id, low: v.stars <= C0.review.lowStar });
    return ownDto(repo.getReview(id), C0);
  }
  function editReview(cust, id, body, ip) {
    const C0 = C(); off(C0.review.on, '门店已关闭评价功能');
    const r = repo.getReview(+id);
    if (!r || r.customer_id !== cust.id) throw new AppError(404, 'NOT_FOUND', '评价不存在');
    if (Date.now() > r.created_at + C0.review.editDays * DAY) throw new AppError(403, 'EDIT_EXPIRED', `评价发布 ${C0.review.editDays} 天内可修改，已超过期限`);
    guard(cust, 'review', ip);
    const v = cleanReview(C0, body, cust);
    const wasLow = r.stars <= C0.review.lowStar, isLow = v.stars <= C0.review.lowStar;
    repo.updateReview(r.id, { stars: v.stars, tags: JSON.stringify(v.tags), text: v.text, photos: JSON.stringify(v.photos),
      status: r.status === 'hidden' ? 'hidden' : statusFor(C0, v.stars), ...(isLow && !wasLow ? { alert_seen: 0 } : {}) });
    repo.addEvent(cust.id, 'review', r.booking_id);
    bus.emit('change', { type: 'review', id: r.id, low: isLow && !wasLow });
    return ownDto(repo.getReview(r.id), C0);
  }
  /** 给「我的预约」附加评价状态 */
  function attachToBookings(list) {
    const C0 = C(), rs = repo.reviewsByBookings(list.filter(b => b.status === 'done').map(b => b.id)), by = {};
    for (const r of rs) by[r.booking_id] = r;
    for (const b of list) {
      if (b.status !== 'done') continue;
      const r = by[b.id];
      b.review = r ? ownDto({ ...r }, C0) : null;
      b.canReview = C0.review.on && !r;
    }
    return list;
  }
  function uploadPhoto(cust, buf, ip) {
    const C0 = C();
    off((C0.review.on && C0.review.photos && C0.review.maxPhotos > 0) || (C0.feedback.on && C0.feedback.photos), '门店未开启图片上传');
    guard(cust, 'upload', ip);
    const r = images.save(buf, { type: 'customer', id: cust.id });
    repo.addEvent(cust.id, 'upload', null);
    return r;
  }

  // ---- 顾客：意见反馈 ----
  function createFeedback(cust, body, ip) {
    const C0 = C(); off(C0.feedback.on, '门店已关闭意见反馈');
    body = body || {};
    const type = String(body.type || '');
    if (!C0.feedback.types.includes(type)) throw new AppError(400, 'BAD_TYPE', '请选择反馈类型');
    const raw = String(body.text == null ? '' : body.text).trim();
    if ([...raw].length < 2) throw new AppError(400, 'BAD_INPUT', '请填写反馈内容');
    if ([...raw].length > 500) throw new AppError(400, 'TEXT_TOO_LONG', '反馈内容最多 500 字');
    const contact = CONTACT[body.contact] ? body.contact : 'none';
    const ph = Array.isArray(body.photos) ? body.photos : [];
    if (ph.length && !C0.feedback.photos) throw new AppError(403, 'FEATURE_OFF', '门店未开启反馈图片');
    const photos = ownPhotos(ph, 3, cust, '反馈图片');
    guard(cust, 'feedback', ip);
    const id = repo.insertFeedback({ customer_id: cust.id, type, text: Rules.cleanText(raw, 500), photos: JSON.stringify(photos), contact });
    repo.addEvent(cust.id, 'feedback', null);
    bus.emit('change', { type: 'feedback', id, isNew: true });
    return { id, status: 'open', statusText: FB_STATUS.open };
  }
  const fbOwn = f => ({ id: f.id, type: f.type, text: f.text, photos: parse(f.photos).map(url), contact: f.contact, contactText: CONTACT[f.contact], status: f.status, statusText: FB_STATUS[f.status], createdAt: f.created_at });
  function myFeedback(cust) { return repo.listCustomerFeedback(cust.id).map(fbOwn); }

  // ---- 商家：评价管理 ----
  function merchantReviews(user, filter) {
    const C0 = C();
    if (user.role === 'owner' && (!filter || filter === 'all' || filter === 'low')) { if (repo.markLowSeen(C0.review.lowStar)) bus.emit('change', { type: 'review.seen' }); }
    const counts = repo.reviewCounts(C0.review.lowStar);
    return { items: repo.listMerchantReviews(filter, C0.review.lowStar).map(r => merchantDto(r, C0)), counts: countsDto(counts), lowStar: C0.review.lowStar,
      summary: summary(repo.reviewRows({ publicOnly: false }), C0), features: features(C0) };
  }
  const countsDto = c => ({ total: c.total || 0, unreplied: c.unreplied || 0, low: c.low || 0, lowNew: c.low_new || 0, pending: c.pending || 0, hidden: c.hidden || 0 });
  function reply(user, id, text, ip) {
    const C0 = C(); off(C0.reply.on, '商家回复功能已关闭（可在设置中开启）'); Perm.need(user, 'review.reply');
    const r = repo.getReview(+id); if (!r) throw new AppError(404, 'NOT_FOUND', '评价不存在');
    const raw = String(text == null ? '' : text).trim();
    if (!raw) throw new AppError(400, 'BAD_INPUT', '请填写回复内容');
    if ([...raw].length > 300) throw new AppError(400, 'TEXT_TOO_LONG', '回复最多 300 字');
    repo.updateReview(r.id, { reply_text: Rules.cleanText(raw, 300), reply_at: Date.now(), reply_by: user.display_name || user.username });
    audit(user, r.reply_text ? 'review.reply_edit' : 'review.reply', 'review:' + r.id, null, ip);
    bus.emit('change', { type: 'review', id: r.id });
    return merchantDto(repo.getReview(r.id), C0);
  }
  function setVisibility(user, id, action, ip) {
    const C0 = C();
    const st = { hide: 'hidden', unhide: 'public', approve: 'public' }[action];
    if (!st) throw new AppError(400, 'BAD_INPUT', '未知操作');
    Perm.need(user, action === 'approve' ? 'review.approve' : 'review.hide');
    const r = repo.getReview(+id); if (!r) throw new AppError(404, 'NOT_FOUND', '评价不存在');
    if (action === 'approve' && r.status !== 'pending') throw new AppError(409, 'NOT_PENDING', '该评价不在待审核状态');
    repo.updateReview(r.id, { status: st, moderated_by: user.display_name || user.username, moderated_at: Date.now() });
    audit(user, 'review.' + action, 'review:' + r.id, null, ip);
    bus.emit('change', { type: 'review', id: r.id });
    return merchantDto(repo.getReview(r.id), C0);
  }
  // ---- 商家：反馈收件箱 ----
  // 完整号码：顾客选择回访 且 （店主 或 店员被授权「查看顾客完整手机号」）
  const fbMerchant = (f, user) => ({ ...fbOwn(f), note: f.note || '', seed: !!f.seed, name: f.cname || '',
    phone: f.contact !== 'none' && Perm.can(user, 'customer.phone') ? f.phone : maskPhone(f.phone), phoneMasked: !(f.contact !== 'none' && Perm.can(user, 'customer.phone')),
    unseen: !f.seen, handledBy: f.handled_by || null, handledAt: f.handled_at || null });
  function merchantFeedback(user, status) {
    const list = repo.listFeedback(['open', 'doing', 'done'].includes(status) ? status : null).map(f => fbMerchant(f, user));
    if (repo.markFeedbackSeen()) bus.emit('change', { type: 'feedback.seen' });
    return { items: list, counts: repo.feedbackCounts() };
  }
  function updateFeedback(user, id, body, ip) {
    Perm.need(user, 'feedback.handle');
    const f = repo.getFeedback(+id); if (!f) throw new AppError(404, 'NOT_FOUND', '反馈不存在');
    const p = {};
    if (body.status !== undefined) { if (!FB_STATUS[body.status]) throw new AppError(400, 'BAD_INPUT', '状态不正确'); p.status = body.status; }
    if (body.note !== undefined) p.note = Rules.cleanText(body.note, 200) || null;
    repo.updateFeedback(f.id, { ...p, handled_by: user.display_name || user.username, handled_at: Date.now() });
    audit(user, 'feedback.update', 'feedback:' + f.id, p, ip);
    bus.emit('change', { type: 'feedback', id: f.id });
    return fbMerchant(repo.getFeedback(f.id), user);
  }
  function counts() {
    const C0 = C();
    return { reviews: countsDto(repo.reviewCounts(C0.review.lowStar)), feedback: repo.feedbackCounts(), lowStar: C0.review.lowStar };
  }
  function updateShop(user, body, ip) {
    Perm.ownerOnly(user, '修改门店信息');
    const shop = repo.getShop(), phone = String(body.phone == null ? shop.phone : body.phone).trim(), address = Rules.cleanText(body.address == null ? shop.address : body.address, 60);
    if (!/^[0-9+\- ]{5,20}$/.test(phone)) throw new AppError(400, 'BAD_PHONE', '门店电话格式不正确（5–20 位数字，可含 - 和空格）');
    if (!address) throw new AppError(400, 'BAD_INPUT', '请填写门店地址');
    repo.updateShopContact(phone, address);
    audit(user, 'shop.update', 'shop', { phone, address }, ip);
    bus.emit('change', { type: 'shop' });
    return { phone, address };
  }
  return { features, shopExtras, publicList, createReview, editReview, attachToBookings, uploadPhoto, createFeedback, myFeedback,
    merchantReviews, reply, setVisibility, merchantFeedback, updateFeedback, counts, updateShop, summary, FB_STATUS };
}
module.exports = { createReviewService };
