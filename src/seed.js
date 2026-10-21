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
];
async function ensureAccounts(repo, auth) {
  for (const a of ACCOUNTS) if (!repo.getMerchantByUsername(a.username)) repo.insertMerchant({ ...a, password_hash: await auth.hashPassword(a.password) });
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
    repo.insertBooking({ code: 'QYDEMO' + String(++k).padStart(2, '0'), customer_id: cust(phone, name, true), service_id: sid[si], service_name: s.name, price_cents: s.price * 100, duration_min: s.dur,
      date, start_min: m, end_min: e, start_at: U.startAt(date, m), end_at: U.startAt(date, e), name, note: '', status, deposit_cents: 0, deposit_status: null, hold_until: null, seed: 1,
      created_at: U.startAt(date, m) - 3 * 864e5, ...(extra || {}) });
  };
  // 历史记录
  bk(1, d(-5), '11:00', '13800001111', '林小姐', 'done'); bk(0, d(-3), '14:00', '13900002222', '陈女士', 'done');
  bk(4, d(-7), '16:00', '13600004444', '王女士', 'done'); bk(0, d(-2), '10:30', '13500005555', '赵小姐', 'done');
  bk(5, d(-20), '12:00', '13000001212', '何小姐', 'done');
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
    return false;
  }
  repo.tx(() => { if (force) repo.wipeBusinessData(); seedData(repo, images); });
  return true;
}
module.exports = { seed, ACCOUNTS };
