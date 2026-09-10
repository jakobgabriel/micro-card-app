#!/usr/bin/env python3
"""Generate the Micro Card app icons.

Pure standard library so it runs anywhere: the icon is simple enough to
describe analytically (rounded square, gradient, two stacked cards) and is
supersampled 4x for antialiasing.
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
SS = 4  # supersampling factor

BG_TOP = (124, 58, 237)     # violet
BG_BOTTOM = (67, 56, 202)   # indigo
ACCENT = (251, 146, 60)     # amber
WHITE = (255, 255, 255)


def rounded_rect(x, y, w, h, r, px, py):
    """Signed containment test for a rounded rectangle."""
    if px < x or px > x + w or py < y or py > y + h:
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def blend(dst, src, alpha):
    return tuple(round(d + (s - d) * alpha) for d, s in zip(dst, src))


def render(size):
    n = size * SS
    rows = []
    for j in range(n):
        row = bytearray()
        for i in range(n):
            u, v = i / n, j / n
            # Rounded app-icon shape with a vertical gradient.
            inside = rounded_rect(0.06, 0.06, 0.88, 0.88, 0.20, u, v)
            if not inside:
                row += bytes((0, 0, 0, 0))
                continue
            color = blend(BG_TOP, BG_BOTTOM, v)
            # Back card, rotated feel via offset; front card on top.
            if rounded_rect(0.26, 0.22, 0.46, 0.34, 0.05, u, v):
                color = blend(color, WHITE, 0.35)
            if rounded_rect(0.20, 0.34, 0.54, 0.40, 0.06, u, v):
                color = WHITE
                # Three "text lines" on the front card.
                for line_y, line_w in ((0.44, 0.36), (0.52, 0.30), (0.60, 0.20)):
                    if rounded_rect(0.26, line_y, line_w, 0.035, 0.018, u, v):
                        color = BG_BOTTOM if line_y < 0.58 else ACCENT
            row += bytes(color + (255,))
        rows.append(bytes(row))

    # Downsample the supersampled buffer.
    out = []
    for j in range(size):
        line = bytearray()
        for i in range(size):
            r = g = b = a = 0
            for dj in range(SS):
                src = rows[j * SS + dj]
                for di in range(SS):
                    o = ((i * SS) + di) * 4
                    r += src[o]
                    g += src[o + 1]
                    b += src[o + 2]
                    a += src[o + 3]
            count = SS * SS
            line += bytes((r // count, g // count, b // count, a // count))
        out.append(bytes(line))
    return out


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    cache = {}
    for name, size in sorted(targets.items(), key=lambda kv: kv[1]):
        if size not in cache:
            cache[size] = render(size)
        write_png(os.path.join(OUT, name), cache[size], size)
        print(f"  {name} ({size}px)")


if __name__ == "__main__":
    main()
