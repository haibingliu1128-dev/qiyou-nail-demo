# 栖柚美甲 · 在线预约（全栈版）

把离线演示版（`demo-booking/index.html`，数据存在浏览器 localStorage）升级为**真正的前后端系统**：
所有数据在服务器 SQLite，所有规则由服务端执行，顾客端和商家端看到的是同一份数据。

> 演示作品：店铺、地址、预约记录均为虚构。默认是**开发模式**：短信验证码不真实发送（显示在页面上），定金支付为模拟支付，不产生扣款。

- 后端：Node.js 18+ · Fastify 5 · SQLite（better-sqlite3，WAL）· bcryptjs
- 前端：原生 JS 单页（沿用离线版的界面），`public/`，由同一服务托管
- 单店部署；配置全部来自 `.env`

## 快速开始

```bash
npm install            # 需要能编译原生模块（build-essential / python3）或可下载 better-sqlite3 预编译包
cp .env.example .env   # 按需修改；开发环境可保留 mock 通道
./start.sh             # 后台启动（setsid + 自动重启守护），日志 logs/server.log
./stop.sh
npm test               # API 测试（node:test，临时数据库）
npm run e2e            # 端到端测试（Playwright Python，两个浏览器上下文）
npm run backup         # SQLite 热备份到 backups/
```

- 顾客端：`http://<host>:3100/`
- 商家端：`http://<host>:3100/#merchant`（或 `/m`）
- 演示账号：店主 `owner / qiyou2026`（全部权限）；店员 `staff / staff2026`（美甲师（演示））、`staff2 / staff2026`（前台小林（演示））。店员默认可以处理预约、拉黑/解除，其余操作需店主在「店员权限」里逐项授权（见下文）。密码可用 `DEMO_OWNER_PASSWORD` / `DEMO_STAFF_PASSWORD` / `DEMO_STAFF2_PASSWORD` 在**首次启动前**修改。
- 开发模式看验证码：点「获取验证码」后，验证码直接显示在弹层里（`DEV_SHOW_SMS_CODE=1`）；也会写进服务日志 `[mock-sms] 手机号 验证码 xxxxxx`，并可通过 `GET /api/dev/sms-outbox?phone=手机号` 查看最近 10 条。**上线必须设为 0**（此时接口不再返回验证码、发件箱接口关闭）。

## 部署到 Render（免费 Web Service）
本仓库已带 `render.yaml`（Blueprint）：
1. 把仓库推到 GitHub（公开仓库即可）。
2. Render 控制台 → **New → Blueprint** → 选择该仓库 → Apply。会创建一个 free 计划的 Node Web Service：`npm ci` 构建、`npm start` 启动、健康检查 `/api/health`，`APP_SECRET` 自动生成。
3. 部署完成后：顾客端 `https://<服务名>.onrender.com/`，商家端 `https://<服务名>.onrender.com/#merchant`（演示账号 owner / qiyou2026、staff / staff2026、staff2 / staff2026）。

说明：
- 服务监听 `process.env.PORT`（Render 自动注入）和 `0.0.0.0`。
- 免费实例**没有持久磁盘**：SQLite 文件（`./data/nail.db`）在重启、重新部署、闲置休眠（约 15 分钟无访问）后都会丢失；启动时会自动执行迁移并写入演示数据，所以页面顶部显示「演示环境，数据为示例，每次重启会重置」（`DEMO_NOTICE` 可改，设为空字符串可关闭）。需要持久数据请换付费实例 + Persistent Disk，或换 MySQL/Postgres。
- 休眠后第一次访问要等几十秒冷启动。
- 没有真实短信：`DEV_SHOW_SMS_CODE=1` 时页面显示「演示验证码」；单 IP 每小时最多获取 `SMS_PER_IP_HOUR`（默认 20）次验证码。`scripts/race_demo.js`（20 个并发顾客）会超过这个限制，只适合在本地或临时调高该值时运行。
- better-sqlite3 是原生模块：锁定在 12.9.0（有 Node 20 的 linux-x64 预编译包，安装时直接下载，不需要编译）。更新的 12.10+ 不再提供 Node 20 预编译包，会退回源码编译。Node 20 已于 2026 年 4 月停止维护，建议之后把 `NODE_VERSION` 改成 22 并升级 better-sqlite3。
- 不需要 Docker。

## 架构

```
src/
  server.js              启动入口（监听端口、启动定时任务、优雅退出）
  app.js                 组装：config → db → repo → providers → services → routes
  config.js              读取 .env / 环境变量（TZ 默认 Asia/Shanghai）
  db/index.js            打开 SQLite + 执行迁移（schema_migrations 记录已执行版本）
  db/migrations/*.sql    迁移脚本（按序号执行一次）
  repo/sqlite.js         数据访问层：业务层只调用这里的方法，不直接写 SQL
  services/rules.js      防占号规则：默认值、取值范围、服务端校验、顾客可见文案
  services/booking.js    预约核心：可约时段、下单（事务）、支付回调、取消、商家操作、定时任务
  services/auth.js       顾客短信登录、商家密码登录（bcrypt）、会话令牌
  services/merchant.js   看板、顾客/黑名单、设置、服务管理、审计日志
  providers/sms/         短信通道接口：mock（开发）/ tencent.stub（占位）
  providers/pay/         支付通道接口：mock（模拟）/ wechat-jsapi-v3.stub（占位 + 接入说明）
  routes/public.js       顾客端 API
  routes/merchant.js     商家端 API（含 SSE 实时推送）
  seed.js                演示数据与演示账号
public/                  前端（index.html / app.js / style.css）
test/api.test.js         API 测试
test/e2e.py              端到端测试
```

### 数据表
`shop`（营业时间 / 时段步长 / 可约天数 / 提前量 / 同时可服务人数）· `services`（价格、时长、单项定金）· `settings`（防占号规则 JSON）·
`customers`（手机号、验证时间、黑名单、限制解除时间、频率锁）· `bookings`（状态流、定金、保留到期、爽约来源）· `customer_events`（预约/取消记录，用于防刷与每月取消次数）·
`payments` · `sms_codes`（只存 HMAC 哈希）· `merchant_users`（bcrypt，owner/staff，`perms` 为店员授权 JSON）· `sessions`（只存令牌 SHA-256）· `login_failures` · `audit_log`。金额单位为分。

### 预约状态流
```
                  ┌─(有定金)→ awaiting_payment ─支付→ ┐      超时未付 → expired（支付晚到自动退款）
下单 ─────────────┤                                  ├→ pending（新客需确认）─商家确认→ confirmed
                  └─(无定金)────────────────────────── ┘                     └─拒绝→ rejected（退定金）/ 开始前未确认 → expired（退定金）
confirmed ─到店→ arrived ─完成→ done
confirmed ─开始后超过宽限分钟仍未到店（定时任务）/ 商家手动 → no_show（定金不退）
awaiting_payment / pending / confirmed ─顾客或商家取消→ cancelled（已付定金退回）
```

### 服务端执行的规则（全部可在商家后台开关/调整，修改立即生效）
| 规则 | 默认 | 说明 |
|---|---|---|
| 首次预约验证手机号 | 开 | 短信验证码登录（6 位，5 分钟有效，错 5 次作废，60 秒冷却，单号每天 10 条，单 IP 每小时 `SMS_PER_IP_HOUR` 条） |
| 每人最多未完成预约 | 2 | 1–10 |
| 每人每天 / 每周 / 每月 | 1 / 关(3) / 关(8) | 含已完成 |
| 短时间反复预约/取消 | 10 分钟 5 次 → 暂停 30 分钟 | |
| 取消时限 | 开始前 2 小时内不可线上取消 | 1–72 小时 |
| 每月可自助取消次数 | 关(3) | |
| 超时未到自动记爽约 | 15 分钟 | 定时任务每 `SCHEDULER_MS` 执行 |
| 爽约限制 | 90 天内 2 次 → 禁止线上预约（或改为必须付定金），最后一次爽约 30 天后自动解除 | 商家可手动「解除限制」 |
| 定金 | 按项目设置（演示：猫眼 ¥30、手绘 ¥50）；受限顾客 ¥30 | 到店抵扣，取消退回，爽约不退 |
| 新客需门店确认 | 开 | |

**防超卖**：下单在 `BEGIN IMMEDIATE` 事务中检查并写入；数据库还有触发器 `trg_bookings_no_overlap`，即使多个进程同时写同一个库也不会出现重叠预约（测试里用两个独立进程并发抢同一时段验证过）。可约时段按服务时长判断重叠，营业结束前放不下的时段显示「近打烊」。

## API 一览
顾客端（`Authorization: Bearer <顾客令牌>`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 健康检查（含 version / commit，可用来确认线上版本） |
| GET | /api/images/:id | 读取图片（正确 Content-Type；ID 不可变 → `Cache-Control: public, max-age=31536000, immutable` + ETag） |
| GET | /api/stream | 顾客端 SSE：服务/设置变化时推送（只含事件类型，不含顾客数据） |
| GET | /api/shop | 门店信息、在售服务、当前规则文案 |
| GET | /api/availability?serviceId=&from=&days= | 可约时段（含不可约原因） |
| POST | /api/auth/sms `{phone}` | 发送验证码（开发模式返回 devCode） |
| POST | /api/auth/verify `{phone,code,name}` | 验证并登录，返回 token |
| POST | /api/auth/quick `{phone}` | 仅当商家关闭「验证手机号」时可用 |
| POST | /api/auth/logout | |
| GET | /api/me | 爽约次数、是否受限/拉黑/频率锁、未完成数 |
| GET | /api/me/bookings | 我的预约（含能否取消及原因） |
| GET | /api/quote?serviceId= | 预检：需付定金金额、是否需确认 |
| POST | /api/bookings `{serviceId,date,time,name,note}` | 下单；有定金时返回 payment |
| GET | /api/bookings/:id/payment | 继续支付 |
| POST | /api/bookings/:id/cancel | 顾客取消 |
| POST | /api/pay/mock/:outTradeNo/confirm | 模拟支付成功（仅 PAY_PROVIDER=mock） |
| POST | /api/pay/notify/wechat | 微信支付回调（接入后启用） |
| GET | /api/dev/sms-outbox?phone= | 开发模式验证码发件箱 |
| GET | /api/reviews?serviceId=&offset=&limit= | 公开评价：汇总（均分/条数/好评率/星级分布/标签统计）+ 列表（手机号打码、含商家回复）；关闭「公开展示」时 403 |
| POST | /api/reviews `{bookingId,stars,tags,text,photos}` | 评价本人「已完成」订单（每单一次） |
| PUT | /api/reviews/:id | 修改评价（发布后 N 天内，N 可设置） |
| POST | /api/me/images | 顾客上传评价/反馈图片（同商家上传的校验与限制） |
| POST | /api/feedback `{type,text,photos,contact}` | 意见反馈（仅商家可见；contact = phone/sms/none） |
| GET | /api/me/feedback | 我的反馈及处理状态（不含商家内部备注） |

商家端（`Authorization: Bearer <商家令牌>`；SSE 用 `?token=`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/merchant/login `{username,password}` | 15 分钟内错 5 次锁定 |
| POST | /api/merchant/logout · GET /api/merchant/me | `me` 返回 `{id,username,name,role,perms}`，`perms` 为当前生效的权限（店主全部为 true） |
| GET | /api/merchant/staff | 店员列表 + 权限项定义（**仅店主**） |
| POST | /api/merchant/staff `{username,name,password}` | 新增店员账号，默认无任何授权（仅店主） |
| PUT | /api/merchant/staff/:id `{perms,active,name,password}` | 修改授权（部分更新，未知权限项 400）/ 停用 / 改名 / 重置密码；停用或重置密码会让该店员已登录的会话立即失效（仅店主） |
| GET | /api/merchant/dashboard | 今日/待确认/待服务/本周营业额估算 |
| GET | /api/merchant/bookings?scope=today\|upcoming\|pending\|all | |
| POST | /api/merchant/bookings/:id/{accept,reject,arrive,done,noshow,cancel} | 状态校验 + 自动退款/定金不退 |
| GET | /api/merchant/noshows | 最近爽约记录（自动/手动） |
| GET | /api/merchant/customers?q= | 顾客、爽约次数、受限/黑名单 |
| POST | /api/merchant/customers/blacklist `{phone,on,reason}` | 拉黑/移出 |
| POST | /api/merchant/customers/:phone/clear | 解除爽约限制与频率锁 |
| GET/PUT | /api/merchant/settings | 读取（含 schema 与范围）/ 部分更新（服务端校验；防占号规则需「修改防占号规则」，评价与反馈开关仅店主） |
| POST | /api/merchant/settings/reset | 恢复默认（店主） |
| GET/POST/PUT/DELETE | /api/merchant/services[/:id] | 服务管理、单项定金、`images:[图片ID…]`（≤3 张，第一张为封面；需「管理服务与图片」；删除=下架） |
| POST | /api/merchant/images | 上传图片（需「管理服务与图片」）。请求体为图片二进制，`Content-Type: image/jpeg\|png\|webp`；≤2MB；按文件头魔数校验真实格式；返回 `{id,url}` |
| GET | /api/merchant/audit | 操作日志（仅店主；含操作人角色与姓名 `actorRole` / `actorDisplay`） |
| GET | /api/merchant/reviews?filter=all\|unreplied\|low\|pending\|hidden | 评价管理（含打码手机号、订单号、时间；店员可查看；店主查看后清除低分提醒） |
| PUT | /api/merchant/reviews/:id/reply `{text}` | 回复 / 修改回复（需「回复评价」；一条回复，记录回复人） |
| POST | /api/merchant/reviews/:id/{hide,unhide,approve} | 隐藏 / 取消隐藏（需「隐藏/显示评价」）/ 通过审核（需「审核评价」）；记录操作人 |
| GET | /api/merchant/feedback?status=open\|doing\|done | 反馈收件箱（顾客选择回访、且为店主或有「查看顾客完整手机号」时显示完整号码，否则打码） |
| PUT | /api/merchant/feedback/:id `{status,note}` | 处理状态 + 内部备注（需「处理意见反馈」；记录处理人） |
| GET | /api/merchant/inbox | 角标计数：待回复、新低分、待审核、待处理反馈 |
| PUT | /api/merchant/shop `{phone,address}` | 门店电话/地址（「联系商家」用；店主） |
| GET | /api/merchant/stream | SSE：新预约/状态变化实时推送 |
| POST | /api/merchant/demo-reset | 重置演示数据（DEMO_MODE=1，店主） |

错误统一为 `{ "error": { "code": "LIMIT_OPEN", "message": "每人最多同时保留 2 个未完成的预约（门店设置）…" } }`，消息里引用当前设置值。店员无权限时返回 `403 NO_PERMISSION`（`perm` 字段为缺少的权限项），仅店主可做的操作返回 `403 OWNER_ONLY`。

## 店员权限
店主在「商家后台 → 店员权限」按店员账号逐项授权，可以有多个店员账号（可新增、停用、重置密码）。**所有授权默认关闭**。

| 权限项（key） | 允许的操作 |
|---|---|
| 回复评价 `review.reply` | 回复顾客评价、修改回复 |
| 隐藏/显示评价 `review.hide` | 隐藏评价或恢复公开 |
| 审核评价 `review.approve` | 「先审后发」时通过待审核评价 |
| 处理意见反馈 `feedback.handle` | 修改反馈处理状态、填写内部备注 |
| 查看顾客完整手机号 `customer.phone` | 意见反馈里顾客要求回访时显示完整号码（未授权时打码） |
| 管理服务与图片 `service.manage` | 新增/编辑/下架服务、上传服务图片、单项定金 |
| 修改防占号规则 `rules.edit` | 数量限制、取消、爽约、定金等规则（不含评价与反馈开关、恢复默认、门店信息） |

- **始终仅店主**：店员权限本身、评价与反馈的功能开关和子设置、恢复默认设置、门店电话/地址、操作日志、重置演示。
- **服务端逐请求校验**：每次请求都从数据库重新读取账号和授权，所以店主改完**立即生效**（同一个已登录的店员令牌，下一次请求就按新权限判断）。无权限返回 `403 NO_PERMISSION` 和中文提示（如「店主未授权你「回复评价」，如需操作请联系店主在「店员权限」中开通」）。
- **界面同步**：店员页面只显示有权限的按钮；店主修改授权后通过商家 SSE 推送 `perms` 事件，店员页面自动刷新并提示「店主已更新你的权限，立即生效」。
- **操作留痕**：评价回复显示回复人和时间；隐藏/审核记录操作人（`moderated_by/at`），反馈记录最后处理人（`handled_by/at`）；操作日志可按「评价与反馈」「店员操作」筛选，显示店员姓名、账号和时间。
- 店员一直可以处理预约、查看顾客和拉黑/解除（与之前相同）；预约和顾客列表里的手机号仍完整显示，「查看顾客完整手机号」只控制意见反馈回访号码。
- 截图：`nail-render-shots/30_owner_staff_permissions.png`（店主授权页）、`31_staff_reply_allowed.png`（获授权后店员回复）、`32_staff_denied.png` / `32b_staff_denied_settings.png`（未授权）、`33_owner_audit_staff_ops.png`（操作日志）。

## 服务图片
- 商家在「服务管理 → 新增/编辑服务」里选图（手机上可拍照或从相册选），最多 3 张，第一张为封面，可「设为封面 / 更换 / 删除」。
- 前端用 canvas 压缩：最长边 ≤1080px、JPEG 质量 0.8（仍超 1.9MB 时降到 0.6）；原图超过 10MB 直接提示换图。
- 服务端：仅店主可上传；只接受 JPG / PNG / WebP（看文件头，不信任 Content-Type）；压缩后 ≤2MB；超过 24 小时仍未被任何服务引用的上传图片由定时任务清理。
- 评价晒图、反馈图片复用同一套压缩、校验和存储（顾客通过 `/api/me/images` 上传，只能使用本人上传的图片）。
- 存储：当前直接存在 SQLite 的 `images` 表（BLOB，迁移 `002_images.sql`），所以 Render 免费实例无需额外配置也能用（但同样会随重启重置）。
  **换腾讯云 COS / 阿里云 OSS**：只需重写 `src/repo/sqlite.js` 里的 `putImage / getImage`（上传到对象存储并记录 key；读取时 302 到 CDN/签名 URL 或代理），业务代码和前端不用改。
- 顾客端：服务列表显示封面（居中裁剪、懒加载），预约页顶部是可左右滑动的图片轮播；没有图片时显示插画占位。商家保存后，顾客页面通过 `/api/stream` 自动刷新。
- 演示服务的默认配图在 `assets/seed-images/`，由 `scripts/gen_seed_images.py` 用 SVG 程序绘制后导出（无下载素材、无真人），首次启动写入数据库；老数据库升级到该迁移时会给演示服务补上默认图。

## 评价与反馈
四个部分都在「商家后台 → 防占号 → 设置 → 评价与反馈」里单独开关（默认全部开启，仅店主可改，修改后顾客页面通过 `/api/stream` 实时生效）。店员能否回复/隐藏/审核/处理反馈由「店员权限」决定。关闭的功能在顾客端隐藏，服务端同样拒绝（`403 FEATURE_OFF`，带中文提示）。

| 设置 | 说明 |
|---|---|
| 服务后评价 | 只能评价本人、商家已标为「已完成」的订单；每单一条；发布后 **评价可修改期限**（1–30 天，默认 7）内可修改。1–5 星 + 标签 + 文字（≤300 字）+ 图片 |
| └ 允许上传图片 / 每条最多照片 | 开关 + 0–3 张 |
| └ 低分提醒（≤N 星） | 默认 ≤3 星：店主后台实时弹窗 + 首页红色提示条 + 角标，列表显示打码手机号和订单号，方便跟进；店主查看评价列表后清除 |
| └ 先审后发 | 关闭 / 仅低分 / 全部。需审核的评价进入「待审核」，店主通过后才公开 |
| └ 好评标签 / 差评标签 | 可增删（1–12 项，每项 ≤8 字）。4–5 星显示好评标签，1–3 星显示差评+好评标签 |
| 商家回复 | 每条评价一条回复，可修改；关闭后不能回复，公开页也不显示回复 |
| 公开展示评价 | 首页全店评分卡；服务卡片显示星级；预约页显示均分、条数、标签统计和最近评价；「全部评价」页含星级分布。关闭后接口不返回评分 |
| 意见反馈 | 顾客随时提交（类型可编辑、≤500 字、可选图片、是否需要回复），**仅商家可见**；收件箱分 待处理/处理中/已处理，可写内部备注（顾客看不到）；新反馈实时角标 |
| 联系商家按钮 | 拨打门店电话（`tel:` 链接）并显示地址、营业时间；关闭后 `/api/shop` 不再返回电话。电话和地址在设置页「门店联系方式」修改 |

- **隐藏的评价**：不出现在公开列表，也**不计入公开的均分/条数/标签统计**；但仍计入商家后台的统计（评价管理页顶部）。待审核的评价同理。
- **隐私**：公开页和商家评价列表的手机号都打码（如 138****5678）。反馈里只有顾客选择「电话回访 / 短信回复」时才向商家显示完整号码。
- **防刷**：评价提交/修改每人每小时 ≤10 次；反馈每人每天 ≤5 条、每个 IP 每天 ≤20 条；顾客图片每人每小时 ≤30 张。超出返回 `429 TOO_FREQUENT`。
- **文本清洗**：服务端去掉控制字符，把 `<` `>` 换成全角字符；前端输出时也统一转义，不会被注入 HTML。
- **示例数据**：首次启动写入 8 条示例评价（部分带商家回复和示例插画图片）和 2 条示例反馈，全部标「示例」，顾客只以打码手机号显示，不含真实姓名。
- 低分提醒和反馈事件只推送到商家端 SSE；顾客端 SSE 只收到「评价有更新」这类不含内容的信号。

## 始终浅色显示
页面声明了 `<meta name="color-scheme" content="light only">` 和 CSS `color-scheme: light only`，并显式设置了 html/body/表单控件的前景和背景色。这样手机系统开启深色模式（包括 Chrome 安卓的「网页自动深色」）时不会把页面强制变暗，始终按设计的浅色主题显示。

## 部署到腾讯云 / 阿里云（单台云服务器）
1. 买一台 1 核 2G 的轻量服务器（Ubuntu 22.04/24.04）；**中国大陆服务器 + 域名必须先完成 ICP 备案**才能用 80/443 对外提供网站（香港/海外服务器不需要备案，但国内访问速度和微信内打开体验可能较差）。
2. 安装：`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs nginx build-essential`
3. 上传代码到 `/srv/nail`，`npm ci --omit=dev`，`cp .env.example .env` 并修改：`NODE_ENV=production`、`HOST=127.0.0.1`、随机 `APP_SECRET`、`DEV_SHOW_SMS_CODE=0`、`DEMO_MODE=0`、强密码。
4. systemd（推荐，代替 start.sh）：
   ```ini
   # /etc/systemd/system/nail.service
   [Service]
   WorkingDirectory=/srv/nail
   ExecStart=/usr/bin/node src/server.js
   Restart=always
   User=www-data
   Environment=NODE_ENV=production
   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now nail`（或 `npm i -g pm2 && pm2 start src/server.js --name nail && pm2 save && pm2 startup`）
5. nginx 反向代理 + HTTPS（证书可用云厂商免费 DV 证书或 certbot）：
   ```nginx
   server {
     listen 443 ssl http2; server_name book.example.com;
     ssl_certificate /etc/nginx/ssl/book.pem; ssl_certificate_key /etc/nginx/ssl/book.key;
     gzip on; gzip_types text/css application/javascript application/json;
     location /api/merchant/stream {               # SSE：关闭缓冲
       proxy_pass http://127.0.0.1:3100; proxy_http_version 1.1; proxy_set_header Connection '';
       proxy_buffering off; proxy_read_timeout 1h; proxy_set_header X-Forwarded-For $remote_addr; }
     location / { proxy_pass http://127.0.0.1:3100; proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
   }
   server { listen 80; server_name book.example.com; return 301 https://$host$request_uri; }
   ```
6. 备份：`crontab -e` 加 `0 3 * * * /srv/nail/scripts/backup.sh`，并把 `backups/` 同步到对象存储（COS/OSS）。SQLite 单文件即全部数据，恢复 = 停服务、替换 `data/nail.db`、启动。
7. 防火墙/安全组只开放 80、443（和 SSH）。

## 上线前还需要什么
- **真实短信**：腾讯云/阿里云短信需要企业或个体工商户资质、短信签名和模板审核。实现 `src/providers/sms/tencent.stub.js` 的 `send()`（注释里有调用方式），`.env` 设 `SMS_PROVIDER=tencent` 和密钥。
- **微信支付**：需要已认证的服务号或小程序、微信支付商户号、APIv3 密钥、商户证书。按 `src/providers/pay/wechat-jsapi-v3.stub.js` 的步骤实现下单/回调/退款；JSAPI 支付还需要用户 openid（公众号网页授权或小程序 `wx.login`）。回调地址必须是公网 HTTPS。
- **微信一键获取手机号**：只在小程序里可用（`getPhoneNumber`，按次收费），H5 网页做不到，所以本版本使用短信验证码。
- **ICP 备案**：大陆服务器 + 域名对外服务必须备案；小程序也需要备案。
- **隐私**：上线需隐私政策与用户同意（收集手机号）；建议加日志脱敏和数据保留期限。

## 移植：MySQL / 微信云开发
- 业务层只依赖 `repo` 的方法（见 `src/repo/sqlite.js`），换数据库 = 按同样签名实现 `repo/mysql.js`（`tx(fn)` 改为异步事务 + `SELECT … FOR UPDATE` 锁定当天预约，或用 `(date, slot)` 唯一索引兜底防超卖），在 `app.js` 换掉 `createRepo`。迁移 SQL 基本通用（触发器需改写，或改用唯一索引 / 应用层加锁）。
- 微信云开发：把 `services/*` 搬到云函数（每个 API 一个云函数或一个路由云函数），`repo` 用云数据库实现；云数据库事务用 `db.runTransaction`；定时任务用云函数定时触发器；身份直接用 `OPENID`，手机号用 `getPhoneNumber`。前端改为小程序页面，调用方式从 `fetch` 换成 `wx.cloud.callFunction`。

## 已知限制
- 单门店、单工位（`shop.capacity=1`，可在库里改为多人同时服务，但没有「指定技师」）。
- 顾客端轮询（30 秒）刷新可约时段；商家端 SSE 实时 + 30 秒兜底轮询。多实例部署时 SSE 事件只在本进程内广播（需要 Redis pub/sub 才能跨实例）。
- 定时任务在进程内运行；多实例部署时应只让一个实例执行（或改成独立 cron）。
- 没有消息通知（短信/订阅消息提醒），没有改期（需取消后重约）。
- 商家后台没有图形化修改营业时间（在 `shop` 表里改）。
