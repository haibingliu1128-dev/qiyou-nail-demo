-- 001 初始结构。约定：金额单位为分；时间戳为毫秒；date 为门店本地 YYYY-MM-DD，start_min 为当天分钟数
CREATE TABLE shop (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL, phone TEXT, address TEXT,
  open_min INTEGER NOT NULL DEFAULT 600, close_min INTEGER NOT NULL DEFAULT 1260,
  step_min INTEGER NOT NULL DEFAULT 30, book_days INTEGER NOT NULL DEFAULT 7,
  lead_min INTEGER NOT NULL DEFAULT 30, capacity INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE services (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, descr TEXT DEFAULT '',
  price_cents INTEGER NOT NULL, duration_min INTEGER NOT NULL,
  icon TEXT DEFAULT 'polish', color INTEGER DEFAULT 0, hot INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0,
  deposit_on INTEGER NOT NULL DEFAULT 0, deposit_cents INTEGER NOT NULL DEFAULT 3000,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE customers (
  id INTEGER PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT,
  verified_at INTEGER, blacklisted INTEGER NOT NULL DEFAULT 0, black_reason TEXT,
  restrict_cleared_at INTEGER, rate_lock_until INTEGER, created_at INTEGER
);
CREATE TABLE bookings (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  service_name TEXT NOT NULL, price_cents INTEGER NOT NULL, duration_min INTEGER NOT NULL,
  date TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL,
  start_at INTEGER NOT NULL, end_at INTEGER NOT NULL,
  name TEXT, note TEXT,
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment','pending','confirmed','arrived','done','cancelled','rejected','expired','no_show')),
  deposit_cents INTEGER NOT NULL DEFAULT 0, deposit_status TEXT, -- unpaid/paid/refunded/forfeited
  hold_until INTEGER, noshow_by TEXT, arrived_at INTEGER,
  cancelled_by TEXT, cancel_reason TEXT, seed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX ix_bookings_date ON bookings(date, status);
CREATE INDEX ix_bookings_customer ON bookings(customer_id, status);
CREATE INDEX ix_bookings_start ON bookings(start_at);
-- 数据库层兜底防超卖：同一时段占用数不得超过 shop.capacity（即使多进程并发也成立）
CREATE TRIGGER trg_bookings_no_overlap BEFORE INSERT ON bookings
WHEN NEW.status IN ('awaiting_payment','pending','confirmed','arrived')
 AND (SELECT COUNT(*) FROM bookings b WHERE b.date = NEW.date AND b.start_min < NEW.end_min AND b.end_min > NEW.start_min
      AND (b.status IN ('pending','confirmed','arrived')
           OR (b.status = 'awaiting_payment' AND b.hold_until > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))))
     >= (SELECT capacity FROM shop WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'SLOT_TAKEN'); END;
CREATE TABLE customer_events (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, kind TEXT NOT NULL, -- book/cancel
  booking_id INTEGER, at INTEGER NOT NULL
);
CREATE INDEX ix_cev ON customer_events(customer_id, kind, at);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY, out_trade_no TEXT NOT NULL UNIQUE, booking_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, provider TEXT NOT NULL,
  status TEXT NOT NULL, -- created/paid/refunded/closed
  provider_txn TEXT, created_at INTEGER NOT NULL, paid_at INTEGER, refunded_at INTEGER, raw TEXT
);
CREATE INDEX ix_pay_booking ON payments(booking_id);
CREATE TABLE sms_codes (
  id INTEGER PRIMARY KEY, phone TEXT NOT NULL, code_hash TEXT NOT NULL, purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used_at INTEGER,
  ip TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX ix_sms_phone ON sms_codes(phone, created_at);
CREATE INDEX ix_sms_ip ON sms_codes(ip, created_at);
CREATE TABLE merchant_users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','staff')), display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at INTEGER
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE login_failures (id INTEGER PRIMARY KEY, key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX ix_lf ON login_failures(key, at);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor_type TEXT NOT NULL, actor_id INTEGER,
  actor_name TEXT, action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT
);
CREATE INDEX ix_audit_at ON audit_log(at);
