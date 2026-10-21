-- 店员权限：每个店员账号单独授权（JSON 对象，默认全部关闭）；店主始终拥有全部权限
ALTER TABLE merchant_users ADD COLUMN perms TEXT NOT NULL DEFAULT '{}';
-- 记录最后由谁处理（店主后台展示「谁、何时」）
ALTER TABLE reviews ADD COLUMN moderated_by TEXT;
ALTER TABLE reviews ADD COLUMN moderated_at INTEGER;
ALTER TABLE feedback ADD COLUMN handled_by TEXT;
ALTER TABLE feedback ADD COLUMN handled_at INTEGER;
