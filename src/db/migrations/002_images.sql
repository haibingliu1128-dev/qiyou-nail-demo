-- 图片（服务配图等）。演示/免费实例直接存 SQLite BLOB，无需额外存储；
-- 生产可换腾讯云 COS / 阿里云 OSS：只需按 repo 的 putImage/getImage 签名实现一份（见 README）。
CREATE TABLE images (
  id TEXT PRIMARY KEY,            -- 随机 ID（不可猜测，内容不可变 → 可长缓存）
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  bytes INTEGER NOT NULL,
  data BLOB NOT NULL,
  owner_type TEXT, owner_id INTEGER, -- 上传者（merchant / customer）
  seed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- 服务配图：JSON 数组（图片 ID），第一张为封面，最多 3 张
ALTER TABLE services ADD COLUMN images TEXT NOT NULL DEFAULT '[]';
