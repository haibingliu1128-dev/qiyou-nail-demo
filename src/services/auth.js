'use strict';
// 身份：顾客 = 手机号+短信验证码 → 会话令牌；商家 = 用户名+密码（bcrypt）→ 会话令牌（owner/staff）
const bcrypt = require('bcryptjs');
const U = require('../lib/util');
const Rules = require('./rules');
const { AppError } = U;
const SMS = { ttlMs: 5 * 60e3, cooldownMs: 60e3, perPhoneDay: 10, perIpHour: 30, maxAttempts: 5 };

function createAuthService(ctx) {
  const { repo, cfg, sms } = ctx;
  const now = () => Date.now();
  const codeHash = (phone, code) => U.hmac(cfg.secret, phone + ':' + code);
  function issue(kind, subjectId, ttlMs) {
    const token = U.randToken();
    repo.insertSession({ token_hash: U.sha256(token), kind, subject_id: subjectId, expires_at: now() + ttlMs });
    return { token, expiresAt: now() + ttlMs };
  }
  async function sendCode(phone, ip) {
    if (!U.isPhone(phone)) throw new AppError(400, 'BAD_PHONE', '请输入正确的 11 位手机号');
    const last = repo.lastSms(phone);
    if (last && now() - last.created_at < SMS.cooldownMs) {
      throw new AppError(429, 'SMS_COOLDOWN', `请 ${Math.ceil((SMS.cooldownMs - (now() - last.created_at)) / 1000)} 秒后再获取验证码`);
    }
    if (repo.countSms('phone', phone, now() - 864e5) >= SMS.perPhoneDay) throw new AppError(429, 'SMS_LIMIT', '该号码今日获取验证码次数过多，请明天再试');
    if (ip && repo.countSms('ip', ip, now() - 3600e3) >= (cfg.smsPerIpHour || SMS.perIpHour)) throw new AppError(429, 'SMS_LIMIT', '请求过于频繁，请稍后再试');
    const code = U.randCode(6);
    repo.insertSms({ phone, code_hash: codeHash(phone, code), purpose: 'login', expires_at: now() + SMS.ttlMs, ip: ip || null });
    const r = await sms.send({ phone, code, purpose: 'login' });
    return { ok: true, cooldown: SMS.cooldownMs / 1000, ttl: SMS.ttlMs / 1000, devCode: cfg.devShowSmsCode ? r.devCode || code : undefined };
  }
  function verifyCode(phone, code, name) {
    if (!U.isPhone(phone)) throw new AppError(400, 'BAD_PHONE', '请输入正确的 11 位手机号');
    const r = repo.lastSms(phone);
    if (!r || r.used_at || r.expires_at < now()) throw new AppError(400, 'CODE_EXPIRED', '验证码已失效，请重新获取');
    if (r.attempts >= SMS.maxAttempts) throw new AppError(429, 'CODE_LOCKED', '错误次数过多，请重新获取验证码');
    if (codeHash(phone, String(code || '').trim()) !== r.code_hash) {
      repo.updateSms(r.id, { attempts: r.attempts + 1 });
      throw new AppError(400, 'CODE_WRONG', `验证码不正确，还可尝试 ${SMS.maxAttempts - r.attempts - 1} 次`);
    }
    repo.updateSms(r.id, { used_at: now() });
    const c = repo.ensureCustomer(phone, name);
    repo.updateCustomer(c.id, { verified_at: now(), ...(name ? { name: String(name).slice(0, 12) } : {}) });
    return { ...issue('customer', c.id, cfg.customerSessionDays * 864e5), customer: { phone: c.phone, name: name || c.name } };
  }
  /** 商家关闭「验证手机号」时：仅凭手机号登录（风险更高，仅建议演示/熟客店使用） */
  function quickLogin(phone, name) {
    const C = Rules.merged(repo.getSettings());
    if (C.verify.on) throw new AppError(403, 'VERIFY_REQUIRED', '门店要求验证手机号，请获取验证码');
    if (!U.isPhone(phone)) throw new AppError(400, 'BAD_PHONE', '请输入正确的 11 位手机号');
    const c = repo.ensureCustomer(phone, name);
    return { ...issue('customer', c.id, cfg.customerSessionDays * 864e5), customer: { phone: c.phone, name: name || c.name } };
  }
  async function merchantLogin(username, password, ip) {
    username = String(username || '').trim();
    const key = 'm:' + username.toLowerCase();
    if (repo.countLoginFailures(key, now() - 15 * 60e3) >= 5) throw new AppError(429, 'LOGIN_LOCKED', '密码错误次数过多，请 15 分钟后再试');
    const u = repo.getMerchantByUsername(username);
    const ok = u && u.active && await bcrypt.compare(String(password || ''), u.password_hash);
    if (!ok) { repo.addLoginFailure(key); repo.audit({ actor_type: 'merchant', actor_name: username, action: 'login.fail', ip }); throw new AppError(401, 'LOGIN_FAILED', '用户名或密码错误'); }
    repo.audit({ actor_type: 'merchant', actor_id: u.id, actor_name: u.username, action: 'login', ip });
    return { ...issue('merchant', u.id, cfg.merchantSessionHours * 3600e3), user: { username: u.username, role: u.role, name: u.display_name } };
  }
  function resolve(token, kind) {
    if (!token) return null;
    const s = repo.getSession(U.sha256(token)); if (!s || s.kind !== kind) return null;
    if (kind === 'customer') return repo.getCustomer(s.subject_id);
    const u = repo.getMerchant(s.subject_id); return u && u.active ? u : null;
  }
  const logout = token => token && repo.deleteSession(U.sha256(token));
  const hashPassword = p => bcrypt.hash(p, 10);
  return { sendCode, verifyCode, quickLogin, merchantLogin, resolve, logout, hashPassword };
}
module.exports = { createAuthService, SMS };
