#!/usr/bin/env python3
"""The disk image's window background (desktop/mac/dmg/background.png, background@2x.png).

Night palette (web/theme.css): the page colour with its two soft glows, "Drag Sara to
Applications" at the top, the accent gradient arrow between the two icons. build.sh puts the two
sizes into one background.tiff (tiffutil) so Retina screens get the sharp one.

The icons themselves are Finder's (Sara.app and the Applications shortcut), placed by build.sh at
ICON_LEFT / ICON_RIGHT below (icon centres, in points from the window's top-left). Finder draws
their names black in Light mode and white in Dark mode, so each name sits on a mid-tone plate that
both read on (about 4.5:1 either way).

Run: python3 desktop/mac/dmg/make-background.py   (needs Pillow; fonts: Segoe UI on Windows,
SF / Helvetica on a Mac, else Pillow's own).
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 600, 400
ICON_LEFT = (160, 196)
ICON_RIGHT = (440, 196)
ICON = 128

BG = (0x0F, 0x0D, 0x17)
TEXT_1 = (0xF1, 0xED, 0xF7)
TEXT_2 = (0xAE, 0xA6, 0xBD)
FROM = (0xE0, 0x60, 0x7E)
TO = (0x9B, 0x6B, 0xFF)
PLATE = (0x77, 0x6D, 0x86)  # names read on it in black (Light mode) and white (Dark mode)

HERE = os.path.dirname(os.path.abspath(__file__))


def font(size, bold=False):
    names = (["seguisb.ttf", "SFNSDisplay-Semibold.otf", "SF-Pro-Display-Semibold.otf", "HelveticaNeue.ttc", "Helvetica.ttc", "Arial Bold.ttf", "arialbd.ttf"]
             if bold else ["segoeui.ttf", "SFNSText.otf", "SF-Pro-Text-Regular.otf", "HelveticaNeue.ttc", "Helvetica.ttc", "Arial.ttf", "arial.ttf"])
    dirs = ["C:/Windows/Fonts", "/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts"]
    for n in names:
        for d in dirs:
            p = os.path.join(d, n)
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size, index=1 if bold and p.endswith(".ttc") else 0)
                except OSError:
                    return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def glow(img, cx, cy, rx, ry, color, alpha):
    """A soft radial glow (theme.css --page-glow)."""
    s = img.width / W
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([(cx - rx) * s, (cy - ry) * s, (cx + rx) * s, (cy + ry) * s], fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(min(rx, ry) * s * 0.55))
    img.alpha_composite(layer)


def render(scale):
    s = scale
    img = Image.new("RGBA", (W * s, H * s), BG + (255,))
    glow(img, 470, -10, 300, 170, TO, 46)
    glow(img, 40, 430, 260, 150, FROM, 38)
    d = ImageDraw.Draw(img)

    # The instruction, centred at the top.
    title = "Drag Sara to Applications"
    f1 = font(24 * s, bold=True)
    w = d.textlength(title, font=f1)
    d.text(((W * s - w) / 2, 44 * s), title, font=f1, fill=TEXT_1)
    sub = "Then open Sara from your Applications folder."
    f2 = font(14 * s)
    w = d.textlength(sub, font=f2)
    d.text(((W * s - w) / 2, 80 * s), sub, font=f2, fill=TEXT_2)

    # The arrow: the accent gradient, left to right, between the two icons.
    x0, x1, y = ICON_LEFT[0] + ICON // 2 + 22, ICON_RIGHT[0] - ICON // 2 - 22, ICON_LEFT[1]
    arrow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    a = ImageDraw.Draw(arrow)
    head = 20
    shaft_end = x1 - head + 4
    steps = 120
    for i in range(steps):
        t0, t1 = i / steps, (i + 1) / steps
        xa, xb = x0 + (shaft_end - x0) * t0, x0 + (shaft_end - x0) * t1 + 0.6
        a.rectangle([xa * s, (y - 3) * s, xb * s, (y + 3) * s], fill=lerp(FROM, TO, t0 * 0.85) + (255,))
    a.ellipse([(x0 - 3) * s, (y - 3) * s, (x0 + 3) * s, (y + 3) * s], fill=FROM + (255,))
    a.polygon([((x1 - head) * s, (y - 13) * s), (x1 * s, y * s), ((x1 - head) * s, (y + 13) * s)], fill=TO + (255,))
    # A faint glow under it.
    g = arrow.filter(ImageFilter.GaussianBlur(6 * s))
    g.putalpha(g.getchannel("A").point(lambda v: v * 0.55))
    img.alpha_composite(g)
    img.alpha_composite(arrow)

    # Mid-tone plates where Finder writes the names (just under each icon).
    plates = Image.new("RGBA", img.size, (0, 0, 0, 0))
    p = ImageDraw.Draw(plates)
    for cx, cy in (ICON_LEFT, ICON_RIGHT):
        top = cy + ICON // 2 + 4
        p.rounded_rectangle([(cx - 56) * s, top * s, (cx + 56) * s, (top + 22) * s], radius=11 * s, fill=PLATE + (235,))
    img.alpha_composite(plates)

    # Small print at the bottom.
    f3 = font(12 * s)
    note = "Sara · your own AI companion, on your own computer"
    w = d.textlength(note, font=f3)
    ImageDraw.Draw(img).text(((W * s - w) / 2, (H - 38) * s), note, font=f3, fill=(0x8E, 0x86, 0xA0))
    return img.convert("RGB")


if __name__ == "__main__":
    render(1).save(os.path.join(HERE, "background.png"), optimize=True)
    render(2).save(os.path.join(HERE, "background@2x.png"), optimize=True)
    print("wrote", os.path.join(HERE, "background.png"), "and background@2x.png")
