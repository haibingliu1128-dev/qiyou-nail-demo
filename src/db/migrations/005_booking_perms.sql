-- 「处理预约」对店员默认开启：给已有店员账号显式写入 booking.handle = true（店主可在「店员权限」关闭）
UPDATE merchant_users SET perms = json_set(CASE WHEN json_valid(perms) THEN perms ELSE '{}' END, '$."booking.handle"', json('true')) WHERE role = 'staff';
