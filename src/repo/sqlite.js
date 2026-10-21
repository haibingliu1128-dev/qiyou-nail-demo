'use strict';
// 数据访问层（SQLite 实现）。业务层只调用这里的方法，不直接写 SQL。
// 迁移到 MySQL / 微信云开发时，按同样的方法签名再实现一份即可（见 README「移植」）。
const OPEN = ['awaiting_payment', 'pending', 'confirmed', 'arrived'];   // 占用时段 / 计入「未完成」
const LIVE = OPEN.concat(['done', 'no_show']);                            // 计入每日/周/月次数（含已完成）
const inList = a => a.map(s => `'${s}'`).join(',');
const ACTIVE_SQL = `(status IN ('pending','confirmed','arrived') OR (status='awaiting_payment' AND hold_until > @now))`;

function createRepo(db) {
  const q = sql => db.prepare(sql);
  const now = () => Date.now();
  const R = {
    db, OPEN, LIVE,
    /** 事务：fn 内的所有读写原子执行（BEGIN IMMEDIATE，防并发） */
    tx: fn => db.transaction(fn).immediate(),

    // ---- shop / settings ----
    getShop: () => q('SELECT * FROM shop WHERE id=1').get(),
    upsertShop: s => q(`INSERT INTO shop (id,name,phone,address,open_min,close_min,step_min,book_days,lead_min,capacity)
      VALUES (1,@name,@phone,@address,@open_min,@close_min,@step_min,@book_days,@lead_min,@capacity)
      ON CONFLICT(id) DO UPDATE SET name=@name,phone=@phone,address=@address,open_min=@open_min,close_min=@close_min,step_min=@step_min,book_days=@book_days,lead_min=@lead_min,capacity=@capacity`).run(s),
    getSettings: () => Object.fromEntries(q('SELECT key,value FROM settings').all().map(r => [r.key, JSON.parse(r.value)])),
    putSetting: (k, v) => q('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(k, JSON.stringify(v), now()),
    clearSettings: () => q('DELETE FROM settings').run(),

    // ---- services ----
    listServices: (all) => q(`SELECT * FROM services ${all ? '' : 'WHERE active=1'} ORDER BY sort, id`).all(),
    getService: id => q('SELECT * FROM services WHERE id=?').get(id),
    insertService: s => q(`INSERT INTO services (name,descr,price_cents,duration_min,icon,color,hot,active,sort,deposit_on,deposit_cents,images,created_at,updated_at)
      VALUES (@name,@descr,@price_cents,@duration_min,@icon,@color,@hot,1,@sort,@deposit_on,@deposit_cents,@images,@t,@t)`).run({ images: '[]', ...s, t: now() }).lastInsertRowid,
    updateService: (id, f) => {
      const keys = Object.keys(f); if (!keys.length) return;
      q(`UPDATE services SET ${keys.map(k => `${k}=@${k}`).join(',')}, updated_at=@_t WHERE id=@_id`).run({ ...f, _t: now(), _id: id });
    },

    // ---- images ----
    // 存储实现：SQLite BLOB。换对象存储（COS/OSS）时，putImage 改为上传并记录 key，getImage 返回签名 URL 或代理流即可。
    putImage: im => q(`INSERT INTO images (id,mime,bytes,data,owner_type,owner_id,seed,created_at) VALUES (@id,@mime,@bytes,@data,@owner_type,@owner_id,@seed,@t)`)
      .run({ owner_type: null, owner_id: null, seed: 0, ...im, bytes: im.data.length, t: now() }),
    getImage: id => q('SELECT id,mime,bytes,data,created_at FROM images WHERE id=?').get(String(id)),
    imageMeta: ids => ids.length ? q(`SELECT id,mime,bytes,owner_type,owner_id FROM images WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [],
    /** 删除超过 olderThan 毫秒、且没有被任何服务（或其它引用表）使用的上传图片 */
    purgeOrphanImages: olderThan => q(`DELETE FROM images WHERE seed=0 AND created_at < ? AND id NOT IN (SELECT j.value FROM services s, json_each(s.images) j)
      AND id NOT IN (SELECT j.value FROM reviews r, json_each(r.photos) j) AND id NOT IN (SELECT j.value FROM feedback f, json_each(f.photos) j)`).run(now() - olderThan).changes,

    // ---- reviews（评价）----
    insertReview: r => q(`INSERT INTO reviews (booking_id,customer_id,service_id,stars,tags,text,photos,status,seed,reply_text,reply_at,reply_by,alert_seen,created_at,updated_at)
      VALUES (@booking_id,@customer_id,@service_id,@stars,@tags,@text,@photos,@status,@seed,@reply_text,@reply_at,@reply_by,@alert_seen,@t,@t)`)
      .run({ seed: 0, reply_text: null, reply_at: null, reply_by: null, alert_seen: 0, ...r, t: r.created_at || now() }).lastInsertRowid,
    updateReview: (id, f) => {
      const keys = Object.keys(f); if (!keys.length) return;
      q(`UPDATE reviews SET ${keys.map(k => `${k}=@${k}`).join(',')}, updated_at=@_t WHERE id=@_id`).run({ ...f, _t: now(), _id: id });
    },
    getReview: id => q(`SELECT r.*, c.phone, b.service_name, b.date, b.code, b.start_min FROM reviews r JOIN customers c ON c.id=r.customer_id JOIN bookings b ON b.id=r.booking_id WHERE r.id=?`).get(id),
    reviewsByBookings: ids => ids.length ? q(`SELECT * FROM reviews WHERE booking_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [],
    /** 公开列表：只含 status='public' */
    listPublicReviews: ({ serviceId, limit, offset }) => q(`SELECT r.*, c.phone, b.service_name FROM reviews r JOIN customers c ON c.id=r.customer_id JOIN bookings b ON b.id=r.booking_id
      WHERE r.status='public' AND (@sid IS NULL OR r.service_id=@sid) ORDER BY r.created_at DESC LIMIT @limit OFFSET @offset`).all({ sid: serviceId || null, limit: limit || 10, offset: offset || 0 }),
    /** 统计原始数据（publicOnly=true 时排除隐藏/待审核） */
    reviewRows: ({ serviceId, publicOnly }) => q(`SELECT service_id, stars, tags FROM reviews WHERE (@sid IS NULL OR service_id=@sid) ${publicOnly ? "AND status='public'" : ''}`).all({ sid: serviceId || null }),
    listMerchantReviews: (filter, lowStar) => q(`SELECT r.*, c.phone, b.service_name, b.date, b.code, b.start_min FROM reviews r JOIN customers c ON c.id=r.customer_id JOIN bookings b ON b.id=r.booking_id
      WHERE ${{ unreplied: "r.reply_text IS NULL AND r.status!='hidden'", low: 'r.stars<=@low', pending: "r.status='pending'", hidden: "r.status='hidden'" }[filter] || '1=1'}
      ORDER BY r.created_at DESC LIMIT 200`).all({ low: lowStar }),
    reviewCounts: lowStar => q(`SELECT COUNT(*) total,
        SUM(CASE WHEN reply_text IS NULL AND status!='hidden' THEN 1 ELSE 0 END) unreplied,
        SUM(CASE WHEN stars<=@low THEN 1 ELSE 0 END) low,
        SUM(CASE WHEN stars<=@low AND alert_seen=0 THEN 1 ELSE 0 END) low_new,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN status='hidden' THEN 1 ELSE 0 END) hidden, AVG(stars) avg FROM reviews`).get({ low: lowStar }),
    markLowSeen: lowStar => q('UPDATE reviews SET alert_seen=1 WHERE stars<=? AND alert_seen=0').run(lowStar).changes,

    // ---- feedback（意见反馈，仅商家可见）----
    insertFeedback: f => q(`INSERT INTO feedback (customer_id,type,text,photos,contact,status,seed,created_at,updated_at) VALUES (@customer_id,@type,@text,@photos,@contact,'open',@seed,@t,@t)`)
      .run({ seed: 0, ...f, t: f.created_at || now() }).lastInsertRowid,
    getFeedback: id => q('SELECT f.*, c.phone, c.name AS cname FROM feedback f JOIN customers c ON c.id=f.customer_id WHERE f.id=?').get(id),
    updateFeedback: (id, f) => {
      const keys = Object.keys(f); if (!keys.length) return;
      q(`UPDATE feedback SET ${keys.map(k => `${k}=@${k}`).join(',')}, updated_at=@_t WHERE id=@_id`).run({ ...f, _t: now(), _id: id });
    },
    listFeedback: status => q(`SELECT f.*, c.phone, c.name AS cname FROM feedback f JOIN customers c ON c.id=f.customer_id WHERE (@st IS NULL OR f.status=@st) ORDER BY f.created_at DESC LIMIT 200`).all({ st: status || null }),
    listCustomerFeedback: cid => q('SELECT * FROM feedback WHERE customer_id=? ORDER BY created_at DESC LIMIT 50').all(cid),
    feedbackCounts: () => q(`SELECT SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) open, SUM(CASE WHEN status='doing' THEN 1 ELSE 0 END) doing, SUM(CASE WHEN seen=0 THEN 1 ELSE 0 END) unseen, COUNT(*) total FROM feedback`).get(),
    markFeedbackSeen: () => q('UPDATE feedback SET seen=1 WHERE seen=0').run().changes,
    updateShopContact: (phone, address) => q('UPDATE shop SET phone=?, address=? WHERE id=1').run(phone, address),

    // ---- customers ----
    getCustomerByPhone: p => q('SELECT * FROM customers WHERE phone=?').get(p),
    getCustomer: id => q('SELECT * FROM customers WHERE id=?').get(id),
    ensureCustomer: (phone, name) => {
      let c = R.getCustomerByPhone(phone);
      if (!c) { q('INSERT INTO customers (phone,name,created_at) VALUES (?,?,?)').run(phone, name || null, now()); c = R.getCustomerByPhone(phone); }
      return c;
    },
    updateCustomer: (id, f) => {
      const keys = Object.keys(f); if (!keys.length) return;
      q(`UPDATE customers SET ${keys.map(k => `${k}=@${k}`).join(',')} WHERE id=@_id`).run({ ...f, _id: id });
    },
    listCustomers: (search) => q(`SELECT c.*,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id) AS total,
        (SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id AND b.status='no_show') AS noshow_total,
        (SELECT MAX(start_at) FROM bookings b WHERE b.customer_id=c.id AND b.status='no_show') AS last_noshow
      FROM customers c WHERE (@s IS NULL OR c.phone LIKE @s OR c.name LIKE @s)
      ORDER BY c.blacklisted DESC, noshow_total DESC, c.id LIMIT 200`).all({ s: search ? `%${search}%` : null }),
    /** 统计周期内（且晚于「解除限制」时间）的爽约记录 */
    noShowsSince: (customerId, since) => q(`SELECT start_at FROM bookings WHERE customer_id=? AND status='no_show' AND start_at>=? ORDER BY start_at DESC`).all(customerId, since),
    isNewCustomer: id => !q(`SELECT 1 FROM bookings WHERE customer_id=? AND status IN ('done','arrived') LIMIT 1`).get(id),

    // ---- events (rate limit / cancel counts) ----
    addEvent: (cid, kind, bid) => q('INSERT INTO customer_events (customer_id,kind,booking_id,at) VALUES (?,?,?,?)').run(cid, kind, bid || null, now()),
    countEvents: (cid, kinds, since) => q(`SELECT COUNT(*) n FROM customer_events WHERE customer_id=? AND kind IN (${inList(kinds)}) AND at>=?`).get(cid, since).n,

    // ---- bookings ----
    insertBooking: b => q(`INSERT INTO bookings (code,customer_id,service_id,service_name,price_cents,duration_min,date,start_min,end_min,start_at,end_at,name,note,status,deposit_cents,deposit_status,hold_until,seed,created_at,updated_at)
      VALUES (@code,@customer_id,@service_id,@service_name,@price_cents,@duration_min,@date,@start_min,@end_min,@start_at,@end_at,@name,@note,@status,@deposit_cents,@deposit_status,@hold_until,@seed,@t,@t)`).run({ seed: 0, ...b, t: b.created_at || now() }).lastInsertRowid,
    getBooking: id => q(`SELECT b.*, c.phone FROM bookings b JOIN customers c ON c.id=b.customer_id WHERE b.id=?`).get(id),
    updateBooking: (id, f) => {
      const keys = Object.keys(f);
      q(`UPDATE bookings SET ${keys.map(k => `${k}=@${k}`).join(',')}, updated_at=@_t WHERE id=@_id`).run({ ...f, _t: now(), _id: id });
    },
    /** 与 [start,end) 重叠且仍占用时段的预约数 */
    overlapCount: (date, s, e) => q(`SELECT COUNT(*) n FROM bookings WHERE date=@date AND start_min<@e AND end_min>@s AND ${ACTIVE_SQL}`).get({ date, s, e, now: now() }).n,
    activeOnDates: (from, to) => q(`SELECT date,start_min,end_min FROM bookings WHERE date BETWEEN @from AND @to AND ${ACTIVE_SQL}`).all({ from, to, now: now() }),
    countOpen: cid => q(`SELECT COUNT(*) n FROM bookings WHERE customer_id=@cid AND end_at>@now AND ${ACTIVE_SQL}`).get({ cid, now: now() }).n,
    countLiveBetween: (cid, from, to) => q(`SELECT COUNT(*) n FROM bookings WHERE customer_id=@cid AND date BETWEEN @from AND @to
       AND (status IN (${inList(LIVE.filter(s => s !== 'awaiting_payment'))}) OR (status='awaiting_payment' AND hold_until>@now))`).get({ cid, from, to, now: now() }).n,
    listCustomerBookings: cid => q(`SELECT b.*, c.phone FROM bookings b JOIN customers c ON c.id=b.customer_id WHERE customer_id=? ORDER BY start_at DESC LIMIT 100`).all(cid),
    listBookings: ({ from, to, statuses, limit }) => q(`SELECT b.*, c.phone,
        (SELECT COUNT(*) FROM bookings x WHERE x.customer_id=b.customer_id AND x.status='no_show') AS cust_noshow,
        c.blacklisted AS cust_black
      FROM bookings b JOIN customers c ON c.id=b.customer_id
      WHERE (@from IS NULL OR date>=@from) AND (@to IS NULL OR date<=@to)
        ${statuses ? `AND status IN (${inList(statuses)})` : ''}
      ORDER BY start_at ${from ? 'ASC' : 'DESC'} LIMIT @limit`).all({ from: from || null, to: to || null, limit: limit || 300 }),
    expiredHolds: t => q(`SELECT id FROM bookings WHERE status='awaiting_payment' AND hold_until<=?`).all(t),
    pendingPastStart: t => q(`SELECT id FROM bookings WHERE status='pending' AND start_at<=?`).all(t),
    overdueConfirmed: cutoffStart => q(`SELECT id FROM bookings WHERE status='confirmed' AND start_at<=?`).all(cutoffStart),
    recentNoShows: (limit) => q(`SELECT b.*, c.phone FROM bookings b JOIN customers c ON c.id=b.customer_id WHERE status='no_show' ORDER BY start_at DESC LIMIT ?`).all(limit || 20),
    stats: (date, wFrom, wTo) => ({
      today: q(`SELECT COUNT(*) n FROM bookings WHERE date=? AND status IN (${inList(LIVE)})`).get(date).n,
      pending: q(`SELECT COUNT(*) n FROM bookings WHERE status='pending'`).get().n,
      upcoming: q(`SELECT COUNT(*) n FROM bookings WHERE status IN ('confirmed','arrived') AND end_at>?`).get(now()).n,
      week: q(`SELECT date, SUM(price_cents) s FROM bookings WHERE date BETWEEN ? AND ? AND status IN ('confirmed','arrived','done') GROUP BY date`).all(wFrom, wTo),
      noshow30: q(`SELECT COUNT(*) n FROM bookings WHERE status='no_show' AND start_at>?`).get(now() - 30 * 864e5).n,
      blacklisted: q(`SELECT COUNT(*) n FROM customers WHERE blacklisted=1`).get().n,
    }),

    // ---- payments ----
    insertPayment: p => q(`INSERT INTO payments (out_trade_no,booking_id,amount_cents,provider,status,created_at) VALUES (@out_trade_no,@booking_id,@amount_cents,@provider,'created',@t)`).run({ ...p, t: now() }),
    getPayment: no => q('SELECT * FROM payments WHERE out_trade_no=?').get(no),
    paymentForBooking: bid => q(`SELECT * FROM payments WHERE booking_id=? ORDER BY id DESC LIMIT 1`).get(bid),
    updatePayment: (no, f) => {
      const keys = Object.keys(f);
      q(`UPDATE payments SET ${keys.map(k => `${k}=@${k}`).join(',')} WHERE out_trade_no=@_no`).run({ ...f, _no: no });
    },

    // ---- sms ----
    insertSms: r => q(`INSERT INTO sms_codes (phone,code_hash,purpose,expires_at,ip,created_at) VALUES (@phone,@code_hash,@purpose,@expires_at,@ip,@t)`).run({ ...r, t: now() }),
    lastSms: phone => q(`SELECT * FROM sms_codes WHERE phone=? ORDER BY id DESC LIMIT 1`).get(phone),
    countSms: (field, val, since) => q(`SELECT COUNT(*) n FROM sms_codes WHERE ${field === 'ip' ? 'ip' : 'phone'}=? AND created_at>=?`).get(val, since).n,
    updateSms: (id, f) => { const k = Object.keys(f); q(`UPDATE sms_codes SET ${k.map(x => `${x}=@${x}`).join(',')} WHERE id=@_id`).run({ ...f, _id: id }); },

    // ---- merchant users / sessions ----
    getMerchantByUsername: u => q('SELECT * FROM merchant_users WHERE username=?').get(u),
    getMerchant: id => q('SELECT * FROM merchant_users WHERE id=?').get(id),
    listMerchants: () => q('SELECT * FROM merchant_users ORDER BY id').all(),
    updateMerchant: (id, f) => { const keys = Object.keys(f); if (!keys.length) return; q(`UPDATE merchant_users SET ${keys.map(k => `${k}=@${k}`).join(',')} WHERE id=@_id`).run({ ...f, _id: id }); },
    deleteSubjectSessions: (kind, id) => q('DELETE FROM sessions WHERE kind=? AND subject_id=?').run(kind, id).changes,
    insertMerchant: m => q(`INSERT INTO merchant_users (username,password_hash,role,display_name,active,created_at) VALUES (@username,@password_hash,@role,@display_name,1,@t)
      ON CONFLICT(username) DO UPDATE SET password_hash=@password_hash, role=@role, display_name=@display_name, active=1`).run({ ...m, t: now() }),
    insertSession: s => q('INSERT INTO sessions (token_hash,kind,subject_id,expires_at,created_at) VALUES (@token_hash,@kind,@subject_id,@expires_at,@t)').run({ ...s, t: now() }),
    getSession: h => q('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(h, now()),
    deleteSession: h => q('DELETE FROM sessions WHERE token_hash=?').run(h),
    purgeSessions: () => q('DELETE FROM sessions WHERE expires_at<=?').run(now()),
    addLoginFailure: key => q('INSERT INTO login_failures (key,at) VALUES (?,?)').run(key, now()),
    countLoginFailures: (key, since) => q('SELECT COUNT(*) n FROM login_failures WHERE key=? AND at>=?').get(key, since).n,

    // ---- audit ----
    audit: (a) => q(`INSERT INTO audit_log (at,actor_type,actor_id,actor_name,action,target,detail,ip) VALUES (@at,@actor_type,@actor_id,@actor_name,@action,@target,@detail,@ip)`)
      .run({ at: now(), actor_id: null, actor_name: null, target: null, ip: null, ...a, detail: a.detail ? JSON.stringify(a.detail) : null }),
    listAudit: (limit) => q('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit || 100),

    /** 演示重置：清空业务数据（保留商家账号） */
    wipeBusinessData: () => db.exec(`DELETE FROM reviews; DELETE FROM feedback; DELETE FROM payments; DELETE FROM customer_events; DELETE FROM bookings; DELETE FROM customers; DELETE FROM sms_codes;
      DELETE FROM sessions WHERE kind='customer'; DELETE FROM services; DELETE FROM images; DELETE FROM settings; DELETE FROM login_failures;`),
  };
  return R;
}
module.exports = { createRepo, OPEN, LIVE };
