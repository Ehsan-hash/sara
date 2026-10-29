# Makes the native app icons from one picture, so every platform shows the same Sara.
#
#   uv run --with pillow python scripts/make-app-icons.py
#
# Source: ios/Sara/Assets.xcassets/AppIcon.appiconset/icon-1024.png (the largest copy of the art;
# the web icons in web/ are the same picture). Writes:
#   desktop/windows/src/sara.ico         Windows (app, tray, installer). Sizes up to 48 px show a
#                                        closer crop of her face, so the tray icon stays readable.
#   desktop/mac/AppIcon.png              Mac (desktop/mac/build.sh turns it into Sara.icns): the
#                                        macOS shape, a rounded square with the standard margin.
#   android/app/src/main/res/drawable-nodpi/icon_foreground.png
#                                        Android's adaptive icon foreground (the launcher cuts it
#                                        to its own shape; res/mipmap-anydpi-v26/ic_launcher.xml).
#   desktop/windows/src/page-logo.h, desktop/mac/Sources/PageLogo.swift
#                                        Her picture (small JPEG data URL) at the top of the
#                                        desktop apps' own pages (welcome, can't reach), as on
#                                        the phones' setup screens.
# iOS and the web apps use the square picture as it is (the system rounds it).
import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "ios/Sara/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
art = Image.open(SRC).convert("RGBA").resize((1024, 1024), Image.LANCZOS)

# Her face (hairline to chin, with the hair at the sides), as a share of the picture.
FACE = (0.18, 0.10, 0.80, 0.72)
face = art.crop(tuple(round(v * 1024) for v in FACE))

# Windows: one .ico with every size Windows asks for.
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
frames = [(face if s <= 48 else art).resize((s, s), Image.LANCZOS) for s in sizes]
ico = ROOT / "desktop/windows/src/sara.ico"
frames[-1].save(ico, format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[:-1])

# Mac: 824 px rounded square (radius 185) centred on a 1024 canvas, with a soft shadow.
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
body = art.resize((824, 824), Image.LANCZOS)
mask = Image.new("L", (824, 824), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, 823, 823), radius=185, fill=255)
shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((100, 112, 923, 935), radius=185, fill=(0, 0, 0, 90))
canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
canvas.paste(body, (100, 100), mask)
canvas.save(ROOT / "desktop/mac/AppIcon.png", optimize=True)

# Android adaptive icon: 432 px (108 dp at xxxhdpi); the picture fills the 72 dp middle that
# every launcher shape shows, with the background colour around it.
fg = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
fg.paste(art.resize((288, 288), Image.LANCZOS), (72, 72))
out = ROOT / "android/app/src/main/res/drawable-nodpi"
out.mkdir(parents=True, exist_ok=True)
fg.save(out / "icon_foreground.png", optimize=True)
# The desktop apps' pages: 128 px (64 px at 2x), as a data URL compiled into the apps.
buf = io.BytesIO()
art.convert("RGB").resize((128, 128), Image.LANCZOS).save(buf, format="JPEG", quality=82, optimize=True)
url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
note = "Made by scripts/make-app-icons.py (her picture for the app's own pages). Don't edit by hand."
(ROOT / "desktop/windows/src/page-logo.h").write_text(f"// {note}\n#pragma once\nstatic const wchar_t* kLogoDataUrl = L\"{url}\";\n", encoding="utf-8", newline="\n")
(ROOT / "desktop/mac/Sources/PageLogo.swift").write_text(f"// {note}\nlet pageLogoDataURL = \"{url}\"\n", encoding="utf-8", newline="\n")
print("icons written")
