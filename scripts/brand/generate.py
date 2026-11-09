"""Gogo brand assets from the approved character (components/gogo/gogo-character.tsx, calm state).

Input:  gogo-calm-inner.svgfrag  (the component's calm SVG body, ids normalised, styles stripped)
Output: out/  — svg + png icons at every size, favicon.ico (16/32/48), maskable, apple, and two 1200x630 share images.
Fonts for the share images are local files (Instrument Serif / Instrument Sans, as on askgogo.in).
"""
import base64, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

HERE = Path(__file__).parent
OUT = HERE / 'out'; OUT.mkdir(exist_ok=True)
INNER = (HERE / 'gogo-calm-inner.svgfrag').read_text()
CREAM, INK, ORANGE, MUTED = '#F6F1E8', '#16130F', '#EF7A27', '#6B625A'
# Character content bounds in its 0..120 viewBox (measured): x 15..105, y 10..115 → centre (60, 62.5), height 105.
CX, CY, CH = 60, 62.5, 105


def char(size, height_frac, cx=None, cy=None):
    """The character placed in a size×size canvas, its drawn height = height_frac of the canvas."""
    s = size * height_frac / CH
    cx = size / 2 if cx is None else cx
    cy = size / 2 if cy is None else cy
    return f'<g transform="translate({cx - CX * s:.3f} {cy - CY * s:.3f}) scale({s:.5f})">{INNER}</g>'


def icon_svg(size, *, rounded, height_frac, bleed=False):
    bg = f'<rect width="{size}" height="{size}" fill="{CREAM}"/>' if bleed else f'<rect width="{size}" height="{size}" rx="{size * 0.225:.2f}" fill="{CREAM}"/>'
    if not rounded and not bleed:
        bg = ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" aria-label="Gogo"><title>Gogo</title>{bg}{char(size, height_frac)}</svg>'


def font_face():
    f = HERE / 'fonts/node_modules/@fontsource'
    serif = base64.b64encode((f / 'instrument-serif/files/instrument-serif-latin-400-normal.woff2').read_bytes()).decode()
    sans4 = base64.b64encode((f / 'instrument-sans/files/instrument-sans-latin-400-normal.woff2').read_bytes()).decode()
    sans6 = base64.b64encode((f / 'instrument-sans/files/instrument-sans-latin-600-normal.woff2').read_bytes()).decode()
    return (f"@font-face{{font-family:IS;src:url(data:font/woff2;base64,{serif}) format('woff2');font-weight:400}}"
            f"@font-face{{font-family:ISans;src:url(data:font/woff2;base64,{sans4}) format('woff2');font-weight:400}}"
            f"@font-face{{font-family:ISans;src:url(data:font/woff2;base64,{sans6}) format('woff2');font-weight:600}}")


def og_html(headline_lines, sub, pill, label):
    lines = ''.join(f'<div>{l}</div>' for l in headline_lines)
    return f"""<html><head><style>{font_face()}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{width:1200px;height:630px;background:{CREAM};font-family:ISans,sans-serif;color:{INK};position:relative;overflow:hidden}}
.halo{{position:absolute;right:70px;top:65px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle at 50% 55%,#FBE3CC 0,#F8EBDD 55%,rgba(246,241,232,0) 72%)}}
.char{{position:absolute;right:95px;top:70px;width:450px;height:450px}}
.text{{position:absolute;left:80px;top:0;bottom:0;width:600px;display:flex;flex-direction:column;justify-content:center;gap:26px}}
.label{{font-size:20px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:{MUTED}}}
.h{{font-family:IS,serif;font-size:96px;line-height:1.0;letter-spacing:-.01em}}
.sub{{font-size:27px;color:{MUTED};line-height:1.35;max-width:540px}}
.pill{{align-self:flex-start;background:{ORANGE};color:#fff;font-weight:600;font-size:24px;border-radius:999px;padding:12px 26px}}
</style></head><body><div class="halo"></div>
<svg class="char" viewBox="0 0 450 450">{char(450, 0.96)}</svg>
<div class="text"><div class="label">{label}</div><div class="h">{lines}</div><div class="sub">{sub}</div><div class="pill">{pill}</div></div></body></html>"""


def main():
    files = {}
    # Vector sources
    files['gogo-icon.svg'] = icon_svg(96, rounded=True, height_frac=0.80)
    files['gogo-mark.svg'] = icon_svg(120, rounded=False, height_frac=0.96)  # transparent, character only
    for name, svg in files.items():
        (OUT / name).write_text(svg)
    renders = [
        # (file, size, kind, height_frac)
        ('favicon-16.png', 16, 'round', 0.92), ('favicon-32.png', 32, 'round', 0.88), ('favicon-48.png', 48, 'round', 0.86),
        ('icon-192.png', 192, 'round', 0.80), ('icon-512.png', 512, 'round', 0.80),
        ('apple-touch-icon.png', 180, 'bleed', 0.74), ('icon-maskable-512.png', 512, 'bleed', 0.58),
        ('gogo-mark-512.png', 512, 'none', 0.96),
    ]
    with sync_playwright() as p:
        b = p.chromium.launch()
        for fname, size, kind, frac in renders:
            svg = icon_svg(size, rounded=kind == 'round', height_frac=frac, bleed=kind == 'bleed')
            pg = b.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
            pg.set_content(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
            pg.screenshot(path=str(OUT / fname), omit_background=True, clip={'x': 0, 'y': 0, 'width': size, 'height': size})
            pg.close()
        for fname, html in [
            ('og-site.png', og_html(['Less prompting.', 'More living.'], 'A personal AI on WhatsApp that remembers the details and follows everyday tasks through.', 'askgogo.in', 'AskGogo')),
            ('og-app.png', og_html(['Your Gogo,', 'on every screen.'], 'Chat, Today, tasks and approvals: the same Gogo you message on WhatsApp.', 'app.askgogo.in', 'AskGogo app')),
        ]:
            pg = b.new_page(viewport={'width': 1200, 'height': 630}, device_scale_factor=1)
            pg.set_content(html); pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT / fname))
            pg.close()
        sq = f"""<html><head><style>{font_face()}*{{margin:0}}body{{width:800px;height:800px;background:{CREAM};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;font-family:ISans,sans-serif;color:{INK}}}
.halo{{position:absolute;left:150px;top:90px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle at 50% 55%,#FBE3CC 0,#F8EBDD 55%,rgba(246,241,232,0) 72%)}}
.c{{position:relative;width:440px;height:440px}}.w{{position:relative;font-weight:600;font-size:76px;letter-spacing:-.01em}}</style></head>
<body><div class="halo"></div><svg class="c" viewBox="0 0 440 440">{char(440, 0.98)}</svg><div class="w">AskGogo</div></body></html>"""
        pg = b.new_page(viewport={'width': 800, 'height': 800}, device_scale_factor=1)
        pg.set_content(sq); pg.wait_for_timeout(300); pg.screenshot(path=str(OUT / 'og-app-square.png')); pg.close()
        b.close()
    # favicon.ico with 16/32/48 frames drawn at those sizes (not downscaled from one image)
    frames = [Image.open(OUT / f'favicon-{s}.png').convert('RGBA') for s in (16, 32, 48)]
    frames[2].save(OUT / 'favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=frames[:2])
    for f in sorted(OUT.iterdir()):
        print(f.name, f.stat().st_size)


if __name__ == '__main__':
    main()
