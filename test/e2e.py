"""端到端测试：两个独立浏览器上下文（顾客手机 + 商家后台）操作同一后端，证明数据经服务器共享。
用法：先启动一个测试实例（或直接跑 npm run e2e，会自动用临时数据库起服务）
      BASE=http://localhost:3101 python test/e2e.py
"""
import os, re, random, sys, time
from playwright.sync_api import sync_playwright, expect
BASE = os.environ.get('BASE', 'http://localhost:3101')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
PHONE = '177' + ''.join(random.choice('0123456789') for _ in range(8))
ok = lambda m: print('ok  ', m, flush=True)

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
    expect(st.locator('.toast')).to_contain_text('员工账号不能修改'); ok('员工账号不能修改规则')

    # 刷新/换设备：数据在服务器
    c2 = br.new_context(viewport={'width': 390, 'height': 844}).new_page(); c2.goto(BASE + '/'); c2.click('.tab:has-text("我的")')
    expect(c2.locator('.btn[data-a=login]')).to_be_visible(); ok('新设备未登录看不到他人预约')
    assert not errs, errs
    print('\nE2E ERRORS: none')
    br.close()
