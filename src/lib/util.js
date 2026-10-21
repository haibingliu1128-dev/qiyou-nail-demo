'use strict';
const crypto = require('crypto');
class AppError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const pad = n => (n < 10 ? '0' : '') + n;
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseYmd = s => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const toMin = t => { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); };
const toHm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const startAt = (date, min) => { const d = parseYmd(date); d.setMinutes(min); return d.getTime(); };
const today = () => ymd(new Date());
function weekRange(date) { const d = parseYmd(date), w = d.getDay() || 7, mon = addDays(d, 1 - w); return [ymd(mon), ymd(addDays(mon, 6))]; }
function monthRange(date) { const d = parseYmd(date); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))]; }
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(String(s)).digest('hex');
const randToken = () => crypto.randomBytes(32).toString('base64url');
const randCode = (n = 6) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');
const isPhone = p => /^1[3-9]\d{9}$/.test(String(p || ''));
const maskPhone = p => p ? p.slice(0, 3) + '****' + p.slice(7) : '';
const yuan = c => (c / 100).toFixed(c % 100 ? 2 : 0);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && ymd(parseYmd(s)) === s;
module.exports = { AppError, pad, ymd, parseYmd, addDays, toMin, toHm, startAt, today, weekRange, monthRange, sha256, hmac, randToken, randCode, isPhone, maskPhone, yuan, isDate };
