"""生成演示服务的默认配图（纯 SVG 程序绘制 → Chrome 截图为 JPEG，1080×810）。
不含任何下载素材或真人照片。输出到 assets/seed-images/，服务启动写入演示数据时自动入库。
用法：python scripts/gen_seed_images.py   （需要 playwright + Chrome）
"""
import os, pathlib
from playwright.sync_api import sync_playwright
OUT = pathlib.Path(__file__).resolve().parent.parent / 'assets' / 'seed-images'
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
SKIN, SKIN_D = '#F7D6C8', '#EBB9A6'

def sparkle(x, y, s, c='#fff', o=.9):
    return f'<path transform="translate({x} {y}) scale({s})" d="M0-10 2.6-2.6 10 0 2.6 2.6 0 10-2.6 2.6-10 0-2.6-2.6z" fill="{c}" opacity="{o}"/>'

def hand(nails, cuff, tx=0, ty=0, sc=1.0):
    """手背朝前的手：nails 为 5 个指甲的 fill（可为 url(#grad)），顺序 拇指,食指,中指,无名指,小指"""
    fingers = [(150, 50, 70), (205, 54, 30), (262, 52, 48), (316, 46, 100)]  # cx, w, top
    g = f'<g transform="translate({tx} {ty}) scale({sc})">'
    g += f'<rect x="150" y="380" width="170" height="260" rx="30" fill="{SKIN}"/>'
    g += f'<rect x="138" y="520" width="194" height="140" rx="26" fill="{cuff}"/><rect x="138" y="520" width="194" height="22" rx="11" fill="#fff" opacity=".35"/>'
    g += f'<g transform="rotate(-38 140 360)"><rect x="112" y="200" width="56" height="190" rx="28" fill="{SKIN}"/>'
    g += f'<rect x="122" y="210" width="36" height="58" rx="18" fill="{nails[0]}"/><rect x="129" y="218" width="7" height="34" rx="3.5" fill="#fff" opacity=".5"/></g>'
    for i, (cx, w, top) in enumerate(fingers):
        x = cx - w / 2
        g += f'<rect x="{x}" y="{top}" width="{w}" height="{330-top}" rx="{w/2}" fill="{SKIN}"/>'
        g += f'<path d="M{x+8} {top+150} h{w-16}" stroke="{SKIN_D}" stroke-width="3" stroke-linecap="round" opacity=".6"/>'
        nw = w - 16
        g += f'<rect x="{x+8}" y="{top+9}" width="{nw}" height="{nw*1.45:.0f}" rx="{nw/2}" fill="{nails[i+1]}"/>'
        g += f'<rect x="{x+14}" y="{top+16}" width="{nw*.22:.0f}" height="{nw*.8:.0f}" rx="{nw*.11:.1f}" fill="#fff" opacity=".5"/>'
    g += f'<rect x="125" y="250" width="230" height="200" rx="80" fill="{SKIN}"/>'
    g += f'<path d="M190 300 q20 12 40 0 M250 300 q20 12 40 0" stroke="{SKIN_D}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".45"/>'
    return g + '</g>'

def bottle(x, y, c, s=1.0, rot=0):
    return (f'<g transform="translate({x} {y}) rotate({rot}) scale({s})"><rect x="-22" y="-120" width="44" height="70" rx="8" fill="#3A3F4B"/>'
            f'<rect x="-55" y="-56" width="110" height="130" rx="34" fill="{c}"/><rect x="-40" y="-40" width="16" height="84" rx="8" fill="#fff" opacity=".45"/></g>')

def bg(c1, c2, accent):
    return (f'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient></defs>'
            f'<rect width="1080" height="810" fill="url(#bg)"/><circle cx="930" cy="120" r="210" fill="#fff" opacity=".35"/><circle cx="110" cy="720" r="170" fill="#fff" opacity=".3"/>'
            f'<circle cx="980" cy="700" r="60" fill="{accent}" opacity=".12"/><circle cx="160" cy="140" r="34" fill="{accent}" opacity=".15"/>')

def label(t):
    return f'<g transform="translate(40 742)"><rect width="{len(t)*26+36}" height="44" rx="22" fill="#fff" opacity=".85"/><text x="18" y="30" font-size="24" fill="#5B6270" font-family="Noto Sans CJK SC, sans-serif">{t}</text></g>'

P = '#E86F8A'
IMGS = {}
IMGS['01_solid'] = bg('#FDECEF', '#FFF8F2', P) + hand([P]*5, '#F6A8B6', 290, 70, 1.12) + bottle(820, 520, P, 1.1, 8) + bottle(200, 560, '#F6A8B6', .8, -12) + sparkle(760, 210, 3) + sparkle(250, 260, 2) + label('纯色 · 示例插画')
grad = '<defs><linearGradient id="ce" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C9B8FF"/><stop offset=".55" stop-color="#8C7CF0"/><stop offset="1" stop-color="#E86F8A"/></linearGradient></defs>'
IMGS['02_cateye'] = bg('#F0EEFE', '#FDF0F6', '#8C7CF0') + grad + hand(['url(#ce)']*5, '#C9B8FF', 290, 70, 1.12) + \
    '<g transform="translate(830 330)"><path d="M-90 0 l50-60h80l50 60-90 110z" fill="#8C7CF0"/><path d="M-90 0h180M-40-60l20 60 20-60 20 60 20-60M-20 0l20 110 20-110" stroke="#fff" stroke-width="5" fill="none" opacity=".7"/></g>' + \
    ''.join(sparkle(x, y, s) for x, y, s in [(760, 560, 3), (920, 520, 2), (220, 250, 2.6), (260, 520, 1.6)]) + label('猫眼 / 渐变 · 示例插画')
def tip(x, y, inner, rot=0):
    return f'<g transform="translate({x} {y}) rotate({rot})"><clipPath id="c{x}"><rect x="-55" y="-90" width="110" height="180" rx="55"/></clipPath><rect x="-55" y="-90" width="110" height="180" rx="55" fill="#FFF7F2"/><g clip-path="url(#c{x})">{inner}</g><rect x="-55" y="-90" width="110" height="180" rx="55" fill="none" stroke="#EBD9CF" stroke-width="3"/></g>'
flower = ''.join(f'<circle cx="{18*__import__("math").cos(a*1.2566):.1f}" cy="{18*__import__("math").sin(a*1.2566):.1f}" r="13" fill="#F6A8B6"/>' for a in range(5)) + '<circle r="9" fill="#F2C14E"/>'
tips = [tip(200, 400, '<rect x="-60" y="-100" width="120" height="200" fill="#F6C9B8"/><path d="M-60 -40 Q0 -80 60 -40 V-100 H-60z" fill="#fff"/>', -14),
        tip(340, 370, '<rect x="-60" y="-100" width="120" height="200" fill="#FDECEF"/>' + flower.replace('<circle', '<circle transform="translate(0 0)"'), -5),
        tip(480, 360, '<rect x="-60" y="-100" width="120" height="200" fill="#3A3F4B"/>' + ''.join(f'<circle cx="{(i%3-1)*30}" cy="{(i//3-1.5)*38}" r="8" fill="#F2C14E"/>' for i in range(12)), 3),
        tip(620, 370, '<rect x="-60" y="-100" width="120" height="200" fill="#E7F6F2"/>' + ''.join(f'<rect x="-60" y="{-100+i*40}" width="120" height="18" fill="#3DB39E" opacity=".8"/>' for i in range(5)), 9),
        tip(760, 400, '<rect x="-60" y="-100" width="120" height="200" fill="#F29C6B"/><path d="M0 22 C-40 -6 -24 -40 0 -22 C24 -40 40 -6 0 22z" fill="#fff"/>', 16)]
IMGS['03_art'] = bg('#FEF1E8', '#FFF9F3', '#F29C6B') + ''.join(tips) + \
    '<g transform="translate(870 560) rotate(35)"><rect x="-10" y="-170" width="20" height="200" rx="10" fill="#3A3F4B"/><rect x="-14" y="20" width="28" height="40" rx="6" fill="#C9A27A"/><path d="M-12 60 Q0 120 12 60z" fill="#F29C6B"/></g>' + \
    ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>' for x, y, r, c in [(180, 620, 26, '#F6A8B6'), (250, 650, 20, '#8C7CF0'), (320, 630, 22, '#F2C14E'), (390, 655, 18, '#3DB39E')]) + label('手绘设计款 · 示例插画')
foot = ('<g transform="translate(330 70) scale(1.15)"><path d="M120 640 C60 640 40 580 52 500 L80 300 C92 200 130 120 210 120 C290 120 320 180 320 250 C320 320 290 370 290 430 C290 500 350 540 350 590 C350 630 320 640 290 640z" fill="' + SKIN + '"/>' +
        ''.join(f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{SKIN}"/><ellipse cx="{x}" cy="{y-4}" rx="{rx*.62:.1f}" ry="{ry*.6:.1f}" fill="#3DB39E"/><ellipse cx="{x-rx*.2:.1f}" cy="{y-ry*.3:.1f}" rx="{rx*.15:.1f}" ry="{ry*.25:.1f}" fill="#fff" opacity=".5"/>'
                for x, y, rx, ry in [(150, 112, 44, 50), (232, 96, 30, 34), (290, 112, 26, 30), (334, 142, 22, 26), (362, 182, 18, 22)]) + '</g>')
IMGS['04_foot'] = bg('#E7F6F2', '#F5FBF9', '#3DB39E') + \
    '<g transform="translate(110 520)"><rect width="260" height="150" rx="24" fill="#fff"/><path d="M0 50h260M0 100h260" stroke="#BFE6DC" stroke-width="10"/></g>' + foot + \
    sparkle(860, 230, 3) + sparkle(800, 560, 2) + '<circle cx="880" cy="430" r="44" fill="#3DB39E" opacity=".25"/>' + label('日式足部 · 示例插画')
IMGS['05_spa'] = bg('#EAF3FD', '#F7FBFF', '#5AA2E8') + \
    '<ellipse cx="540" cy="600" rx="300" ry="60" fill="#5AA2E8" opacity=".15"/><path d="M260 440 h560 a280 200 0 0 1 -560 0z" fill="#fff"/><ellipse cx="540" cy="440" rx="280" ry="52" fill="#BFDDF7"/><ellipse cx="540" cy="440" rx="280" ry="52" fill="none" stroke="#fff" stroke-width="10"/>' + \
    ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fff" opacity=".8"/>' for x, y, r in [(470, 432, 12), (600, 446, 9), (640, 426, 6)]) + \
    '<g transform="translate(330 300) rotate(-30)"><path d="M0 0 C0 -90 70 -150 160 -150 C160 -60 100 0 0 0z" fill="#3DB39E"/><path d="M0 0 L120 -110" stroke="#fff" stroke-width="5" opacity=".7"/></g>' + \
    '<g transform="translate(760 300) rotate(200)"><path d="M0 0 C0 -70 55 -120 125 -120 C125 -50 80 0 0 0z" fill="#7FCBB6"/></g>' + \
    '<g transform="translate(860 520) rotate(-20)"><rect x="-30" y="-150" width="60" height="180" rx="16" fill="#fff"/><rect x="-30" y="-60" width="60" height="50" fill="#5AA2E8" opacity=".7"/><rect x="-18" y="-180" width="36" height="34" rx="6" fill="#3A3F4B"/></g>' + \
    '<g transform="translate(200 560)"><rect x="-44" y="-70" width="88" height="90" rx="12" fill="#FFF4D6"/><path d="M0 -112 C16 -92 12 -80 0 -76 C-12 -80 -16 -92 0 -112z" fill="#F2A33A"/><rect x="-2" y="-78" width="4" height="10" fill="#3A3F4B"/></g>' + label('手部护理 SPA · 示例插画')
IMGS['06_remove'] = bg('#FCF4E3', '#FFFBF3', '#E0A93B') + bottle(330, 470, '#E0A93B', 1.5, -6) + \
    ''.join(f'<g transform="translate({x} {y})"><circle r="70" fill="#fff"/><circle r="70" fill="none" stroke="#F1E3C6" stroke-width="6" stroke-dasharray="8 10"/></g>' for x, y in [(640, 560), (760, 600), (700, 470)]) + \
    '<g transform="translate(800 260) rotate(40)"><rect x="-16" y="-150" width="32" height="300" rx="16" fill="#C9A27A"/><path d="M-10 -130v200M0 -130v200M10 -130v200" stroke="#B28A63" stroke-width="2" opacity=".6"/></g>' + \
    ''.join(f'<path transform="translate({x} {y}) scale({s})" d="M0-30 C12-14 18-4 18 6 a18 18 0 0 1-36 0 C-18-4-12-14 0-30z" fill="#E0A93B" opacity=".75"/>' for x, y, s in [(560, 250, 1.4), (620, 330, 1), (500, 340, .8)]) + label('卸甲 + 修护 · 示例插画')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    pg = b.new_page(viewport={'width': 1080, 'height': 810})
    OUT.mkdir(parents=True, exist_ok=True)
    for name, body in IMGS.items():
        pg.set_content(f'<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="1080" height="810" viewBox="0 0 1080 810">{body}</svg></body></html>')
        pg.screenshot(path=str(OUT / f'{name}.jpg'), type='jpeg', quality=82)
        print(name, (OUT / f'{name}.jpg').stat().st_size)
    b.close()
