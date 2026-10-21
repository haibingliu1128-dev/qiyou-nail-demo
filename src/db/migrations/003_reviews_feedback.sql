-- 服务后评价（每个已完成订单最多一条）与意见反馈（仅商家可见）
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  service_id INTEGER NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags TEXT NOT NULL DEFAULT '[]',          -- JSON 数组
  text TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',        -- JSON 数组（images.id）
  status TEXT NOT NULL DEFAULT 'public' CHECK (status IN ('public','pending','hidden')), -- pending=先审后发待审核；hidden=商家隐藏
  reply_text TEXT, reply_at INTEGER, reply_by TEXT,
  alert_seen INTEGER NOT NULL DEFAULT 0,    -- 低分提醒是否已被店主查看
  seed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX ix_reviews_service ON reviews(service_id, status, created_at);
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL, text TEXT NOT NULL,
  photos TEXT NOT NULL DEFAULT '[]',
  contact TEXT NOT NULL DEFAULT 'none' CHECK (contact IN ('phone','sms','none')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','doing','done')),
  note TEXT,                                -- 商家内部备注（顾客不可见）
  seen INTEGER NOT NULL DEFAULT 0,
  seed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX ix_feedback_status ON feedback(status, created_at);
