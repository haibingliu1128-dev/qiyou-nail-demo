'use strict';
// 演示数据（全部虚构，带 seed=1 标记）。首次启动自动写入；商家后台「重置演示数据」会清空后重写。
const U = require('./lib/util');
const fs = require('fs'), path = require('path');
const IMG_DIR = path.join(__dirname, '..', 'assets', 'seed-images');   // 程序绘制的示例插画（scripts/gen_seed_images.py 生成）
const SERVICES = [
  { name: '纯色美甲', img: '01_solid', descr: '进口胶 · 40+色可选 · 含基础修型', price: 98, dur: 60, icon: 'polish', color: 0, hot: 1 },
  { name: '猫眼 / 渐变款', img: '02_cateye', descr: '磁吸猫眼或晕染渐变，显白百搭', price: 168, dur: 90, icon: 'gem', color: 2, dep: 30 },
  { name: '手绘设计款', img: '03_art', descr: '按图定制 · 法式/插画/贴饰', price: 238, dur: 120, icon: 'hand', color: 1, dep: 50 },
  { name: '日式足部美甲', img: '04_foot', descr: '含足部清洁与死皮护理', price: 158, dur: 90, icon: 'foot', color: 3 },
  { name: '手部护理 SPA', img: '05_spa', descr: '去角质 + 精油按摩 + 手膜', price: 88, dur: 45, icon: 'leaf', color: 4 },
  { name: '卸甲 + 修护', img: '06_remove', descr: '无损卸甲，甲面营养修护', price: 38, dur: 30, icon: 'drop', color: 5 },
];
const ACCOUNTS = [
  { username: 'owner', password: process.env.DEMO_OWNER_PASSWORD || 'qiyou2026', role: 'owner', display_name: '店主（演示）' },
  { username: 'staff', password: process.env.DEMO_STAFF_PASSWORD || 'staff2026', role: 'staff', display_name: '美甲师（演示）' },
  { username: 'staff2', password: process.env.DEMO_STAFF2_PASSWORD || 'staff2026', role: 'staff', display_name: '前台小林（演示）' },
];
async function ensureAccounts(repo, auth) {
  for (const a of ACCOUNTS) if (!repo.getMerchantByUsername(a.username)) {
    repo.insertMerchant({ ...a, password_hash: await auth.hashPassword(a.password) });
    // 新店员显式写入默认权限（处理预约开，其余关）
    if (a.role === 'staff') repo.updateMerchant(repo.getMerchantByUsername(a.username).id, { perms: JSON.stringify(require('./services/perms').DEFAULTS) });
  }
}
function seedImage(images, name) {
  if (!images || !name) return [];
  const f = path.join(IMG_DIR, name + '.jpg');
  if (!fs.existsSync(f)) return [];
  return [images.save(fs.readFileSync(f), null, { seed: true }).id];
}
function seedData(repo, images) {
  const now = new Date(), t = U.today(), d = n => U.ymd(U.addDays(now, n));
  repo.upsertShop({ name: '栖柚美甲', phone: '138-0000-0000', address: 'XX市XX区XX路 88 号 2 楼（示例地址）', open_min: 600, close_min: 1260, step_min: 30, book_days: 7, lead_min: 30, capacity: 1 });
  const sid = SERVICES.map((s, i) => repo.insertService({ name: s.name, descr: s.descr, price_cents: s.price * 100, duration_min: s.dur, icon: s.icon, color: s.color, hot: s.hot || 0, sort: i, deposit_on: s.dep ? 1 : 0, deposit_cents: (s.dep || 30) * 100, images: JSON.stringify(seedImage(images, s.img)) }));
  const cust = (phone, name, verified) => { const c = repo.ensureCustomer(phone, name); if (verified) repo.updateCustomer(c.id, { verified_at: Date.now() }); return c.id; };
  let k = 0;
  const bk = (si, date, hm, phone, name, status, extra) => {
    const s = SERVICES[si], m = typeof hm === 'number' ? hm : U.toMin(hm), e = m + s.dur;
    return repo.insertBooking({ code: 'QYDEMO' + String(++k).padStart(2, '0'), customer_id: cust(phone, name, true), service_id: sid[si], service_name: s.name, price_cents: s.price * 100, duration_min: s.dur,
      date, start_min: m, end_min: e, start_at: U.startAt(date, m), end_at: U.startAt(date, e), name, note: '', status, deposit_cents: 0, deposit_status: null, hold_until: null, seed: 1,
      created_at: U.startAt(date, m) - 3 * 864e5, ...(extra || {}) });
  };
  // 历史记录（已完成的订单带示例评价）
  const done = [
    bk(1, d(-5), '11:00', '13800001111', '林小姐', 'done'), bk(0, d(-3), '14:00', '13900002222', '陈女士', 'done'),
    bk(4, d(-7), '16:00', '13600004444', '王女士', 'done'), bk(0, d(-2), '10:30', '13500005555', '赵小姐', 'done'),
    bk(5, d(-20), '12:00', '13000001212', '何小姐', 'done'), bk(2, d(-9), '15:00', '13100002323', '吴小姐', 'done'),
    bk(3, d(-14), '13:00', '13200003434', '郑女士', 'done'), bk(1, d(-25), '17:00', '13300004545', '钱小姐', 'done'),
  ];
  seedReviews(repo, images, done);
  // 爽约示例顾客：周小姐 90 天内爽约 2 次 → 默认规则下被限制
  bk(0, d(-41), '15:00', '13700003333', '周小姐', 'no_show', { noshow_by: 'manual' });
  bk(0, d(-12), '15:00', '13700003333', '周小姐', 'no_show', { noshow_by: 'auto' });
  // 未来预约
  bk(1, d(1), '11:00', '13800001111', '林小姐', 'confirmed'); bk(4, d(1), '16:00', '13600004444', '王女士', 'confirmed');
  bk(0, d(2), '14:00', '13900002222', '陈女士', 'confirmed'); bk(0, d(3), '10:30', '13500005555', '赵小姐', 'confirmed');
  bk(0, d(2), '18:00', '13600007777', '李小姐', 'pending');   // 新客 → 待门店确认
  // 今天：一单「已开始但未到店」用于演示自动爽约（营业时间外则放在昨天）；再放两单今天稍后的
  const nm = now.getHours() * 60 + now.getMinutes();
  const late = Math.floor((nm - 40) / 30) * 30;
  if (late >= 600 && late + 30 <= 1260) bk(5, t, late, '13000001212', '何小姐', 'confirmed');
  else bk(5, d(-1), '19:30', '13000001212', '何小姐', 'confirmed');
  const nx = Math.ceil((nm + 60) / 30) * 30;
  if (nx >= 600 && nx + 60 <= 1260) bk(0, t, nx, '13400006666', '孙女士', 'confirmed');
  if (nx + 120 >= 600 && nx + 210 <= 1260) bk(1, t, nx + 120, '13500005555', '赵小姐', 'confirmed');
}
// 示例评价 / 反馈：内容为虚构示例（seed=1，页面显示「示例」标签），顾客以打码手机号展示
const REVIEWS = [
  [5, ['手法专业', '效果满意'], '猫眼颜色很显白，老师很耐心地帮我挑色号。', '02_cateye', '谢谢喜欢～下次来可以试试新到的冰透色。'],
  [5, ['准时', '环境干净'], '准点开始，一个小时左右做完，店里很干净。', null, null],
  [4, ['服务热情', '性价比高'], '手膜很舒服，价格也合适，就是周末人有点多。', null, '感谢建议！周末可以提前两天预约，时段会多一些。'],
  [3, ['等待太久'], '到店后等了二十分钟才开始，颜色还不错。', null, '非常抱歉让您久等了，我们已调整预约间隔，下次到店为您免费加一次手部护理。'],
  [5, ['手法专业'], '卸甲很轻柔，甲面没有变薄。', null, null],
  [5, ['效果满意', '手法专业'], '带了参考图，画得比图上还精致！', '03_art', '谢谢认可～欢迎常来定制。'],
  [4, ['环境干净'], '足部护理很细致，下次还来。', null, null],
  [5, ['性价比高', '服务热情'], '', null, null],
];
function seedReviews(repo, images, bookingIds) {
  bookingIds.forEach((bid, i) => {
    const r = REVIEWS[i]; if (!r) return;
    const b = repo.getBooking(bid), at = b.end_at + 3 * 3600e3;
    repo.insertReview({ booking_id: bid, customer_id: b.customer_id, service_id: b.service_id, stars: r[0], tags: JSON.stringify(r[1]), text: r[2],
      photos: JSON.stringify(seedImage(images, r[3])), status: 'public', seed: 1, alert_seen: 1, created_at: at,
      reply_text: r[4], reply_at: r[4] ? at + 5 * 3600e3 : null, reply_by: r[4] ? '店主（演示）' : null });
  });
  const c1 = repo.getCustomerByPhone('13800001111'), c2 = repo.getCustomerByPhone('13900002222');
  const t = Date.now();
  const f1 = repo.insertFeedback({ customer_id: c1.id, type: '功能建议', text: '希望预约时可以上传想做的款式图片。', photos: '[]', contact: 'none', seed: 1, created_at: t - 6 * 864e5 });
  repo.updateFeedback(f1, { status: 'done', note: '已记录到需求清单（示例）', seen: 1 });
  const f2 = repo.insertFeedback({ customer_id: c2.id, type: '环境卫生', text: '洗手台旁边可以多放一些擦手纸。', photos: '[]', contact: 'sms', seed: 1, created_at: t - 864e5 });
  repo.updateFeedback(f2, { seen: 1 });
}
async function seed(repo, auth, { force, images } = {}) {
  await ensureAccounts(repo, auth);
  if (repo.getShop() && !force) {
    // 老数据库升级到 002_images 时：给仍没有图片的演示服务补上默认插画（只做一次）
    if (images && (repo.db.appliedNow || []).includes('002_images.sql')) repo.tx(() => {
      for (const s of repo.listServices(true)) {
        const def = SERVICES.find(x => x.name === s.name);
        if (def && (s.images || '[]') === '[]') repo.updateService(s.id, { images: JSON.stringify(seedImage(images, def.img)) });
      }
    });
    // 升级到 003_reviews_feedback 时：用已有的示例「已完成」订单补上示例评价（只做一次）
    if ((repo.db.appliedNow || []).includes('003_reviews_feedback.sql') && !repo.reviewRows({}).length) repo.tx(() => {
      const ids = repo.db.prepare("SELECT id FROM bookings WHERE seed=1 AND status='done' ORDER BY id LIMIT 8").all().map(r => r.id);
      if (ids.length && repo.getCustomerByPhone('13800001111') && repo.getCustomerByPhone('13900002222')) seedReviews(repo, images, ids);
    });
    return false;
  }
  repo.tx(() => { if (force) repo.wipeBusinessData(); seedData(repo, images); });
  return true;
}
module.exports = { seed, ACCOUNTS };
