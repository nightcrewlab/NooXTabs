import sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 1024  # çizim çözünürlüğü (sonra küçültülür)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient(size, c1, c2, diagonal=True):
    W, H = size
    w, h = 64, 64  # küçük çizip büyüt (hızlı, degrade zaten yumuşak)
    g = Image.new('RGBA', (w, h))
    px = g.load()
    for y in range(h):
        for x in range(w):
            t = ((x / w) * 0.45 + (y / h) * 0.55) if diagonal else y / h
            px[x, y] = lerp(c1, c2, min(1, max(0, t)))
    return g.resize((W, H), Image.BICUBIC)


def rmask(size, box, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, r, fill=255)
    return m


def folder_mask(x, y, w, h, tab_w, tab_h, r):
    """Klasör silueti: üstte solda sekme (kulak) + gövde."""
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((x, y, x + tab_w, y + tab_h + r * 2), r, fill=255)          # kulak
    # kulaktan gövdeye yumuşak geçiş (eğik kenar)
    d.polygon([(x + tab_w - r, y), (x + tab_w + tab_h * 0.9, y + tab_h), (x + tab_w - r, y + tab_h + r)], fill=255)
    d.rounded_rectangle((x, y + tab_h, x + w, y + h), r, fill=255)                 # gövde
    return m


def paste_mask(base, layer, mask):
    base.alpha_composite(Image.composite(layer, Image.new('RGBA', layer.size, (0, 0, 0, 0)), mask))


def make(detail=True):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # ---- Arka plan: koyu yuvarlak kare, hafif dikey degrade + ince kenar ----
    pad = 56 if detail else 24
    radius = 230 if detail else 200
    bg_mask = rmask((S, S), (pad, pad, S - pad, S - pad), radius)
    if detail:  # yumuşak gölge
        sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        sm = rmask((S, S), (pad, pad + 18, S - pad, S - pad + 18), radius).filter(ImageFilter.GaussianBlur(22))
        sh.putalpha(sm.point(lambda v: int(v * 0.55)))
        img.alpha_composite(sh)
    paste_mask(img, gradient((S, S), (40, 43, 54, 255), (18, 19, 25, 255), diagonal=False), bg_mask)
    # iç kenar parlaması
    edge = rmask((S, S), (pad, pad, S - pad, S - pad), radius)
    inner = rmask((S, S), (pad + 6, pad + 6, S - pad - 6, S - pad - 6), radius - 6)
    ring = ImageChops.subtract(edge, inner)
    top_fade = gradient((S, S), (255, 255, 255, 70), (255, 255, 255, 8), diagonal=False)
    paste_mask(img, top_fade, ring)

    # ---- Klasörler: arkada iki "sekme" katmanı, önde degradeli klasör ----
    if detail:
        fx, fy, fw, fh = 230, 330, 600, 440
        tab_w, tab_h, r = 230, 70, 46
        back = [  # (dx, dy, renk1, renk2)
            (110, -110, (88, 76, 170, 255), (60, 52, 120, 255)),
            (55, -55, (64, 112, 210, 255), (44, 78, 160, 255)),
        ]
        for dx, dy, c1, c2 in back:
            m = folder_mask(fx + dx - 60, fy + dy, fw, fh, tab_w, tab_h, r)
            paste_mask(img, gradient((S, S), c1, c2), m)
            # katmanlar arası koyu ayrım çizgisi (öndekinin gölgesi)
        shadow = folder_mask(fx - 60, fy + 14, fw, fh, tab_w, tab_h, r).filter(ImageFilter.GaussianBlur(18))
        sl = Image.new('RGBA', (S, S), (8, 9, 14, 0))
        sl.putalpha(shadow.point(lambda v: int(v * 0.6)))
        img.alpha_composite(sl)
        front = folder_mask(fx - 60, fy, fw, fh, tab_w, tab_h, r)
    else:
        front = folder_mask(150, 250, 724, 560, 290, 90, 60)

    paste_mask(img, gradient((S, S), (102, 170, 255, 255), (98, 92, 255, 255)), front)

    # ön klasörün gövdesinde üst parlama şeridi (cam hissi)
    if detail:
        fx0, fy0 = 170, 330
        lip = rmask((S, S), (fx0, fy0 + tab_h + 46, fx0 + fw, fy0 + tab_h + 52), 3)
        paste_mask(img, Image.new('RGBA', (S, S), (255, 255, 255, 90)), ImageChops.multiply(lip, front))
        hl = gradient((S, S), (255, 255, 255, 60), (255, 255, 255, 0), diagonal=False)
        paste_mask(img, hl, front)
        # "+" sekme işareti: sağ altta küçük yuvarlak rozet
        cx, cy, rr = 705, 650, 92
        badge = Image.new('L', (S, S), 0)
        ImageDraw.Draw(badge).ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=255)
        bsh = badge.filter(ImageFilter.GaussianBlur(14))
        bs = Image.new('RGBA', (S, S), (10, 10, 30, 0)); bs.putalpha(bsh.point(lambda v: int(v * 0.5)))
        img.alpha_composite(bs)
        paste_mask(img, gradient((S, S), (32, 34, 46, 255), (20, 21, 30, 255), diagonal=False), badge)
        plus = Image.new('L', (S, S), 0)
        d = ImageDraw.Draw(plus)
        t, L = 13, 50
        d.rounded_rectangle((cx - L, cy - t, cx + L, cy + t), t, fill=255)
        d.rounded_rectangle((cx - t, cy - L, cx + t, cy + L), t, fill=255)
        paste_mask(img, gradient((S, S), (140, 196, 255, 255), (150, 130, 255, 255)), plus)

    return img


big = make(True)
small = make(False)
out = sys.argv[1]
sizes = {}
for n in (256, 128, 64, 48, 32, 24, 16):
    src = big if n >= 48 else small
    sizes[n] = src.resize((n, n), Image.LANCZOS)
sizes[256].save(f'{out}/icon.png')
big.resize((512, 512), Image.LANCZOS).save(f'{out}/icon-512.png')
sizes[256].save(f'{out}/icon.ico', sizes=[(n, n) for n in sizes], append_images=[sizes[n] for n in sizes if n != 256])
# önizleme: koyu ve açık zemin üzerinde tüm boyutlar
prev = Image.new('RGBA', (900, 620), (30, 30, 30, 255))
prev.paste(Image.new('RGBA', (900, 310), (235, 235, 235, 255)), (0, 310))
x = 20
for n in (256, 64, 48, 32, 24, 16):
    for row in (0, 310):
        prev.alpha_composite(sizes[n], (x, row + 27))
    x += n + 30
prev.save(f'{out}/preview.png')
print('ok')
