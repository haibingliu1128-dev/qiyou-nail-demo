"""端到端测试：两个独立浏览器上下文（顾客手机 + 商家后台）操作同一后端，证明数据经服务器共享。
用法：先启动一个测试实例（或直接跑 npm run e2e，会自动用临时数据库起服务）
      BASE=http://localhost:3101 python test/e2e.py
"""
import os, re, random, sys, time, zlib, struct
from playwright.sync_api import sync_playwright, expect
BASE = os.environ.get('BASE', 'http://localhost:3101')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
PHONE = '177' + ''.join(random.choice('0123456789') for _ in range(8))
ok = lambda m: print('ok  ', m, flush=True)
TAG = PHONE[-4:]   # 每次运行唯一的标记，可对同一实例重复运行

def big_png(w=2400, h=1800):
    """生成一张大尺寸 PNG（模拟手机原图），用来验证前端压缩到 ≤1080px"""
    row = bytes([0]) + bytes(sum(([(x * 255 // w), 120, 200 - (x * 120 // w)] for x in range(w)), []))
    raw = b''.join(row for _ in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 6)) + ch(b'IEND', b'')

def code_and_verify(c):
    c.click('[data-a=sms]')
    code = c.locator('#ab-demo-code').inner_text(timeout=5000).strip()
    assert re.fullmatch(r'\d{6}', code), code
    c.fill('#ab-code', '000000' if code != '000000' else '111111'); c.click('[data-a=smsVerify]')
    expect(c.locator('#ab-cerr')).to_contain_text('验证码不正确')
    c.fill('#ab-code', code); c.click('[data-a=smsVerify]')
    return code

def book(c, svc, day_idx, slot_idx=2, name='E2E测试', first=False):
    if c.locator('.tabbar').count() == 0: c.click('button:has-text("返回首页")')
    c.click('.tab:has-text("预约")'); c.click(f'.svc:has-text("{svc}")'); c.click('.foot .btn')
    c.wait_for_selector('.date'); c.locator('.date').nth(day_idx).click()
    c.locator('.slot:not([disabled])').nth(slot_idx).click(); c.click('.foot .btn')
    if c.locator('#f-name').input_value() == '': c.fill('#f-name', name)
    if c.locator('#f-phone').input_value() == '': c.fill('#f-phone', PHONE)
    c.click('.foot .btn'); c.wait_for_selector('.ticket')
    c.click('.foot .btn[data-a=submit]')

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=CHROME)
    cu = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    mc = br.new_context(viewport={'width': 430, 'height': 900})
    c, m = cu.new_page(), mc.new_page()
    errs = []
    for pg in (c, m): pg.on('pageerror', lambda e: errs.append(str(e)))

    # 商家先登录，停留在后台（SSE 实时连接）
    m.goto(BASE + '/#merchant'); m.fill('#m-user', 'owner'); m.fill('#m-pass', 'wrong'); m.click('[data-a=mLogin]')
    expect(m.locator('.toast')).to_contain_text('用户名或密码错误')
    m.fill('#m-pass', 'qiyou2026'); m.click('[data-a=mLogin]')
    expect(m.locator('.mhead')).to_contain_text('店主'); ok('商家登录（错误密码被拒）')
    m.click('[data-a=mTab][data-v=pending]'); m.wait_for_timeout(500)
    before = m.locator('.tl').count()

    # 顾客：手绘设计款（定金 ¥50）→ 验证码 → 模拟支付 → 新客待确认
    c.goto(BASE + '/'); c.wait_for_selector('.svc')
    book(c, '手绘', 1)
    expect(c.locator('.sheet')).to_contain_text('验证手机号')
    code_and_verify(c); ok('短信验证码（开发模式显示在页面，错误码被拒）')
    expect(c.locator('.abwxsheet')).to_contain_text('50.00'); c.click('[data-a=payConfirm]')
    expect(c.locator('.succ h2')).to_contain_text('待门店确认'); ok('定金模拟支付 → 已提交待确认')

    # 商家端无需刷新即可看到（SSE）
    expect(m.locator('.tl')).to_have_count(before + 1, timeout=8000)
    expect(m.locator(f'.card.bk:has-text("{PHONE}")')).to_contain_text('定金¥50已付'); ok('商家端实时出现新预约（SSE，无刷新）')
    m.locator(f'.card.bk:has-text("{PHONE}") [data-a=mOp]:has-text("确认预约")').click(); m.click('.dlg [data-d="1"]')
    expect(m.locator('.toast')).to_contain_text('已确认')

    c.click('[data-a=goMine]')
    expect(c.locator('.card.bk').first).to_contain_text('待服务', timeout=5000); ok('顾客端看到商家确认后的状态')

    # 第二单（不同天）成功，第三单触发「未完成上限 2」
    book(c, '纯色', 3); expect(c.locator('.succ h2')).to_be_visible()
    book(c, '卸甲', 5)
    expect(c.locator('.abalert')).to_contain_text('最多同时保留 2 个'); ok('达到上限：提示引用当前值 2')
    c.click('.abalert [data-d="1"]')

    # 商家把上限改为 3 → 顾客端立刻生效
    m.click('[data-a=back]') if m.locator('[data-a=back]').count() else None
    m.goto(BASE + '/#merchant'); m.click('.abentry'); m.click('[data-a=abSet]')
    m.click('[data-a=abStep][data-v="maxOpen.v|1"]'); expect(m.locator('.toast')).to_contain_text('已保存：3')
    expect(m.locator('input[data-abin="maxOpen.v"]')).to_have_value('3')
    m.fill('input[data-abin="maxOpen.v"]', '99'); m.dispatch_event('input[data-abin="maxOpen.v"]', 'change')
    expect(m.locator('.toast')).to_contain_text('1–10'); ok('商家改上限 2→3；非法值 99 被拒')
    c.click('.foot .btn[data-a=submit]')
    expect(c.locator('.succ h2')).to_be_visible(); ok('顾客重试成功（新上限生效）')
    c.click('button:has-text("返回首页")'); c.click('.tab:has-text("预约")'); c.click('.svc:has-text("纯色")'); c.click('.foot .btn')
    expect(c.locator('.abrules')).to_contain_text('每人最多 3 个未完成预约'); ok('顾客端规则文案显示新值 3')

    # 取消时限：商家改为 72 小时 → 顾客取消被拦
    m.fill('input[data-abin="cancelH.v"]', '72'); m.dispatch_event('input[data-abin="cancelH.v"]', 'change'); expect(m.locator('.toast')).to_contain_text('72')
    c.click('[data-a=back]'); c.click('.tab:has-text("我的")'); c.wait_for_selector('.card.bk [data-a=uCancel]')
    c.locator('.card.bk [data-a=uCancel]').first.click()
    expect(c.locator('.abalert')).to_contain_text('72 小时'); c.click('.abalert [data-d="1"]'); ok('取消时限 72 小时：顾客端被拦并引用设置值')
    m.click('[data-a=abReset]'); m.click('.dlg [data-d="1"]'); expect(m.locator('.toast')).to_contain_text('恢复默认')

    # 黑名单：商家拉黑 → 顾客下单被拒；移出后恢复
    m.click('[data-a=back]'); m.click('[data-a=abT][data-v=cust]')
    m.fill('#ab-bl', PHONE); m.click('[data-a=abBlAdd]'); expect(m.locator('.toast')).to_contain_text('已加入黑名单')
    expect(m.locator(f'.abcust:has-text("{PHONE}")')).to_contain_text('黑名单')
    c.click('.tab:has-text("首页")')
    book(c, '手部护理', 6)
    expect(c.locator('.abalert')).to_contain_text('暂不能线上预约'); c.click('.abalert [data-d="1"]'); ok('拉黑后顾客无法预约')
    m.locator(f'.abcust:has-text("{PHONE}") [data-a=abBlk]').click(); expect(m.locator('.toast')).to_contain_text('已移出')

    # 员工账号只读
    st = br.new_context().new_page(); st.goto(BASE + '/#merchant'); st.fill('#m-user', 'staff'); st.fill('#m-pass', 'staff2026'); st.click('[data-a=mLogin]')
    st.click('.abentry'); st.click('[data-a=abSet]'); st.click('[data-a=abStep][data-v="maxOpen.v|1"]')
    expect(st.locator('.toast')).to_contain_text('店主未授权你「修改防占号规则」'); ok('店员未授权时不能修改规则')

    # 服务图片：商家新增服务并上传图片（大图自动压缩）→ 顾客端无需刷新即看到封面
    c3 = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True).new_page()
    c3.on('pageerror', lambda e: errs.append(str(e)))
    c3.goto(BASE + '/'); c3.wait_for_selector('.svc .thumb.img img'); c3.click('.tab:has-text("预约")'); c3.wait_for_selector('.svc')
    assert c3.locator('.svc .thumb.img img').count() == c3.locator('.svc').count() >= 6
    c3.wait_for_function("[...document.querySelectorAll('.svc .thumb.img img')].slice(0,3).every(i=>i.complete&&i.naturalWidth>0)"); ok('种子服务显示默认配图（懒加载）')
    m.goto(BASE + '/'); m.goto(BASE + '/#merchant'); m.wait_for_selector('[data-a=goSvcEdit]'); m.click('[data-a=goSvcEdit]'); m.click('.add')
    m.set_input_files('input[data-img=new]', files=[{'name': 'huge.jpg', 'mimeType': 'image/jpeg', 'buffer': b'\xff\xd8\xff\xe0' + bytes(11 * 1024 * 1024)}])
    expect(m.locator('.abalert')).to_contain_text('超过 10MB'); m.click('.abalert [data-d="1"]'); ok('原图超过 10MB 友好提示')
    m.fill('#s-name', f'E2E图片款{TAG}'); m.fill('#s-price', '199'); m.fill('#s-desc', '带图片的新服务')
    m.set_input_files('input[data-img=new]', files=[{'name': 'photo.png', 'mimeType': 'image/png', 'buffer': big_png()}])
    expect(m.locator('#pk-imgs .itile img')).to_have_count(1, timeout=15000)
    m.wait_for_function("document.querySelector('#pk-imgs .itile img').naturalWidth>0")
    wh = m.evaluate("(()=>{const i=document.querySelector('#pk-imgs .itile img');return [i.naturalWidth,i.naturalHeight]})()")
    assert max(wh) == 1080 and wh[0] / wh[1] == 4 / 3, wh; ok(f'前端压缩 2400×1800 → {wh[0]}×{wh[1]}，封面标记' )
    expect(m.locator('#pk-imgs .icov')).to_have_text('封面')
    m.set_input_files('input[data-img=new]', files=[{'name': 'p2.png', 'mimeType': 'image/png', 'buffer': big_png(600, 900)}])
    expect(m.locator('#pk-imgs .itile img')).to_have_count(2, timeout=15000)
    m.click('[data-a=svcSave]'); expect(m.locator('.toast')).to_contain_text('已新增服务')
    expect(m.locator(f'.card.se:has-text("E2E图片款{TAG}") .thumb.img img')).to_be_visible()
    card = c3.locator(f'.svc:has-text("E2E图片款{TAG}")')
    expect(card).to_be_visible(timeout=8000)
    c3.wait_for_function("(()=>{const i=[...document.querySelectorAll('.svc')].find(x=>x.textContent.includes('E2E图片款"+TAG+"'));const im=i&&i.querySelector('.thumb.img img');return im&&im.complete&&im.naturalWidth>0})()")
    ok('顾客端实时出现新服务及封面（无需刷新）')
    card.click(); c3.click('.foot .btn'); expect(c3.locator('#gal img')).to_have_count(2); expect(c3.locator('#galn')).to_have_text('1/2')
    c3.wait_for_function("document.querySelector('#gal img').naturalWidth>0"); ok('预约页图片轮播（2 张）')
    # 编辑：第二张设为封面，再删除一张
    m.locator(f'.card.se:has-text("E2E图片款{TAG}") [data-a=svcEdit]').click(); expect(m.locator('#pk-imgs .itile')).to_have_count(2)
    m.click('#pk-imgs [data-a=imgCover]'); m.locator('#pk-imgs [data-a=imgDel]').nth(1).click(); expect(m.locator('#pk-imgs .itile')).to_have_count(1)
    m.click('[data-a=svcSave]'); expect(m.locator('.toast')).to_contain_text('已保存')
    expect(c3.locator('#gal img')).to_have_count(1, timeout=8000); ok('商家更换封面/删除图片 → 顾客端实时更新')
    m.locator(f'.card.se:has-text("E2E图片款{TAG}") [data-a=svcDel]').click(); m.click('.dlg [data-d="1"]'); expect(m.locator('.toast')).to_contain_text('已下架')

    # 评价与反馈：商家把订单标为完成 → 顾客评价（低分+晒图）→ 店主实时收到提醒 → 回复 → 顾客看到回复；隐藏后公开页实时移除
    m.goto(BASE + '/'); m.goto(BASE + '/#merchant'); m.wait_for_selector('.mhead'); m.click('[data-a=mTab][data-v=upcoming]')
    m.locator(f'.card.bk:has-text("{PHONE}"):has-text("手绘") [data-a=mOp]:has-text("完成")').click(); expect(m.locator('.toast')).to_contain_text('已标记完成')
    c.goto(BASE + '/'); c.click('.tab:has-text("我的")'); c.click('[data-a=mineSeg][data-v=done]')
    c.locator('.card.bk:has-text("手绘") [data-a=rvOpen]').click(); expect(c.locator('.sheet')).to_contain_text('评价本次服务')
    c.click('[data-a=rvStar][data-v="2"]'); expect(c.locator('.rvstars span')).to_have_text('不满意')
    c.click('[data-a=rvTag]:has-text("等待太久")'); c.fill('#rv-text', f'等了二十分钟才开始（E2E{TAG}）')
    c.set_input_files('input[data-img=new]', files=[{'name': 'r.png', 'mimeType': 'image/png', 'buffer': big_png(800, 800)}])
    expect(c.locator('#rv-imgs .itile img')).to_have_count(1, timeout=15000)
    c.click('[data-a=rvSubmit]'); expect(c.locator('.toast')).to_contain_text('感谢你的评价'); ok('顾客对已完成订单评价（2 星 + 差评标签 + 晒图）')
    expect(m.locator('.abalert')).to_contain_text('低分评价', timeout=8000); ok('店主实时收到低分提醒弹窗')
    m.click('.abalert [data-d="1"]'); expect(m.locator('.mrv.low').first).to_contain_text(f'开始（E2E{TAG}）')
    expect(m.locator('.mrv.low').first).to_contain_text('****'); ok('差评列表：打码手机号 + 订单信息')
    m.locator(f'.mrv:has-text("开始（E2E{TAG}") [data-a=rvReply]').click(); m.fill('#rp-text', f'非常抱歉让您久等，已调整排班（E2E{TAG}）'); m.click('[data-a=rpSave]')
    expect(m.locator('.toast')).to_contain_text('回复已发布')
    expect(c.locator('.card.bk:has-text("手绘") .rvreply')).to_contain_text('已调整排班', timeout=8000); ok('顾客端实时看到商家回复')
    c.click('.tab:has-text("预约")'); c.click('.svc:has-text("手绘")'); c.click('.foot .btn')
    expect(c.locator('#svc-reviews')).to_contain_text(f'开始（E2E{TAG}', timeout=8000)
    expect(c.locator('#svc-reviews')).to_contain_text('已调整排班'); ok('服务详情页显示评分、标签与最新评价（含商家回复）')
    m.locator(f'.mrv:has-text("开始（E2E{TAG}") [data-a=rvAct]:has-text("隐藏")').click(); expect(m.locator('.toast')).to_contain_text('已隐藏')
    expect(c.locator('#svc-reviews')).not_to_contain_text(f'开始（E2E{TAG}', timeout=8000); ok('商家隐藏评价 → 公开页实时移除')
    # 意见反馈 + 联系商家
    c.click('[data-a=back]'); c.click('.tab:has-text("我的")'); c.click('[data-a=callShop]')
    expect(c.locator('#tel-link')).to_have_attribute('href', 'tel:13800000000'); c.click('[data-a=closeSheet]'); ok('联系商家：拨号链接 + 地址')
    c.click('[data-a=goFeedback]'); c.click('[data-a=fbType]:has-text("服务投诉")'); c.fill('#fb-text', f'前台没有指引（E2E 反馈{TAG}）'); c.click('[data-a=fbContact][data-v=phone]')
    c.set_input_files('#fb-imgs input[data-img=new]', files=[{'name': 'f.png', 'mimeType': 'image/png', 'buffer': big_png(500, 500)}]); expect(c.locator('#fb-imgs .itile img')).to_have_count(1, timeout=15000)
    c.click('[data-a=fbSubmit]'); expect(c.locator('.toast')).to_contain_text('感谢你的反馈'); expect(c.locator('.fbmine').first).to_contain_text('待处理')
    m.click('[data-a=back]'); expect(m.locator('.abentry:has-text("意见反馈") em')).to_be_visible(timeout=8000); ok('顾客提交反馈 → 商家角标实时出现')
    m.click('[data-a=goMFeedback]'); fb = m.locator(f'.mfb:has-text("E2E 反馈{TAG}")'); expect(fb).to_contain_text(PHONE); expect(fb.locator('.rvph img')).to_have_count(1)
    fb.locator('[data-a=fbSt]:has-text("处理中")').click(); expect(m.locator('.toast')).to_contain_text('已更新')
    m.click('[data-a=fbF][data-v=doing]'); m.locator(f'.mfb:has-text("E2E 反馈{TAG}") [data-a=fbNote]').click(); m.fill('#fbn-text', '已安排前台（内部）'); m.click('[data-a=fbNoteSave]')
    expect(m.locator(f'.mfb:has-text("E2E 反馈{TAG}")')).to_contain_text('已安排前台')
    c.click('[data-a=back]'); c.click('[data-a=goFeedback]'); expect(c.locator('.fbmine').first).to_contain_text('处理中'); expect(c.locator('.fbmine').first).not_to_contain_text('已安排前台')
    ok('商家处理反馈（状态 + 内部备注），顾客只看到状态')
    # 功能开关：商家关闭「意见反馈」「公开展示评价」→ 顾客端实时隐藏；恢复默认后重新出现
    c.click('[data-a=back]'); expect(c.locator('[data-a=goFeedback]')).to_be_visible()
    m.click('[data-a=back]'); m.click('.abentry:has-text("防占号")'); m.click('[data-a=abSet]')
    m.click('[data-a=abTog][data-v=feedback]'); expect(m.locator('.toast')).to_contain_text('已关闭')
    expect(c.locator('[data-a=goFeedback]')).to_have_count(0, timeout=8000); ok('关闭意见反馈 → 顾客端入口实时消失')
    m.click('[data-a=abTog][data-v=reviewPublic]'); expect(m.locator('.toast')).to_contain_text('已关闭')
    c.click('.tab:has-text("首页")'); expect(c.locator('.rvcard')).to_have_count(0, timeout=8000)
    m.click('[data-a=abReset]'); m.click('.dlg [data-d="1"]'); expect(m.locator('.toast')).to_contain_text('恢复默认')
    expect(c.locator('.rvcard')).to_be_visible(timeout=8000); ok('关闭/恢复公开展示 → 首页评分卡实时隐藏/出现')

    # 店员权限：店主授权「回复评价」→ 已登录的店员页面实时出现回复按钮 → 回复 → 收回后按钮实时消失；操作日志可查
    sr = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True).new_page(); sr.on('pageerror', lambda e: errs.append(str(e)))
    sr.goto(BASE + '/#merchant'); sr.fill('#m-user', 'staff'); sr.fill('#m-pass', 'staff2026'); sr.click('[data-a=mLogin]'); sr.wait_for_selector('.mhead')
    expect(sr.locator('[data-a=goStaff]')).to_have_count(0); expect(sr.locator('[data-a=goSvcEdit]')).to_have_count(0)
    sr.click('[data-a=goMReviews] >> nth=0'); sr.wait_for_selector('.mrv')
    expect(sr.locator('[data-a=rvReply]')).to_have_count(0); expect(sr.locator('.permnote')).to_contain_text('店员权限'); ok('店员默认只能查看评价（无回复/隐藏按钮）')
    m.goto(BASE + '/'); m.goto(BASE + '/#merchant'); m.wait_for_selector('.mhead'); m.click('[data-a=goStaff]'); m.wait_for_selector('.staffcard')
    card = m.locator('.staffcard:has(small:text-is("@staff"))')
    expect(m.locator('.staffcard')).to_have_count(2)
    card.locator('[data-a=stPerm][data-v$="|review.reply"]').click(); expect(m.locator('.toast')).to_contain_text('已授权「回复评价」')
    expect(sr.locator('[data-a=rvReply]').first).to_be_visible(timeout=8000); expect(sr.locator('[data-a=rvAct]')).to_have_count(0); ok('店主授权「回复评价」→ 店员页面实时出现回复按钮（隐藏仍不可用）')
    sr.locator('.mrv:has([data-a=rvReply]:text-is("回复"))').first.locator('[data-a=rvReply]').click()
    sr.fill('#rp-text', f'谢谢支持，期待再次光临（店员回复{TAG}）'); sr.click('[data-a=rpSave]'); expect(sr.locator('.toast')).to_contain_text('回复已发布')
    expect(sr.locator(f'.mrv:has-text("店员回复{TAG}") .rvreply')).to_contain_text('美甲师（演示）'); ok('店员回复成功，显示回复人和时间')
    card.locator('[data-a=stPerm][data-v$="|review.reply"]').click(); expect(m.locator('.toast')).to_contain_text('已收回')
    expect(sr.locator('[data-a=rvReply]')).to_have_count(0, timeout=8000); ok('收回授权 → 店员按钮实时消失')
    m.click('[data-a=back]'); m.click('[data-a=goAudit]'); m.click('[data-a=auF][data-v=staff]')
    expect(m.locator('.abitem').first).to_contain_text('回复评价'); expect(m.locator('.abitem:has-text("回复评价")').first).to_contain_text('店员 美甲师（演示） @staff'); ok('操作日志「店员操作」显示谁回复了评价')

    # 刷新/换设备：数据在服务器
    c2 = br.new_context(viewport={'width': 390, 'height': 844}).new_page(); c2.goto(BASE + '/'); c2.click('.tab:has-text("我的")')
    expect(c2.locator('.btn[data-a=login]')).to_be_visible(); ok('新设备未登录看不到他人预约')
    assert not errs, errs
    print('\nE2E ERRORS: none')
    br.close()
