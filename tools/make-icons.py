# tools/make-icons.py: draws the FindThem PNG icons with only Python's standard library.
# Same design as icons/icon.svg: red rounded square, white magnifier with a dot.
# Run: python3 tools/make-icons.py
import struct, zlib, math, os

RED, WHITE = (0xb0, 0x00, 0x20), (255, 255, 255)

def color_at(x, y):  # x, y in 0..512 design units
    r = 96  # rounded corners (transparent outside)
    cx, cy = min(max(x, r), 512 - r), min(max(y, r), 512 - r)
    if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
        return None
    d = math.hypot(x - 230, y - 230)
    if 90 <= d <= 130 or d <= 28:
        return WHITE
    # handle: thick line from (310,310) to (400,400)
    t = max(0, min(1, ((x - 310) + (y - 310)) / (2 * 90)))
    if math.hypot(x - (310 + 90 * t), y - (310 + 90 * t)) <= 24:
        return WHITE
    return RED

def png(size, path, rounded=True):
    rows, s, n = b'', 512 / size, 3  # 3x3 supersampling for smooth edges
    for py in range(size):
        rows += b'\x00'
        for px in range(size):
            acc, cnt = [0, 0, 0], 0
            for i in range(n):
                for j in range(n):
                    x, y = (px + (i + .5) / n) * s, (py + (j + .5) / n) * s
                    c = color_at(x, y)
                    if c is None and not rounded:
                        c = RED
                    if c:
                        cnt += 1
                        acc = [a + b for a, b in zip(acc, c)]
            a = cnt * 255 // (n * n)
            rows += bytes([v // cnt for v in acc] + [a]) if cnt else b'\0\0\0\0'
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))
    open(path, 'wb').write(data)

out = os.path.join(os.path.dirname(__file__), '..', 'icons')
# 192/512 are full-bleed squares so they also work as "maskable" icons.
png(192, os.path.join(out, 'icon-192.png'), rounded=False)
png(512, os.path.join(out, 'icon-512.png'), rounded=False)
png(180, os.path.join(out, 'apple-touch-icon.png'), rounded=False)  # iOS rounds it itself
