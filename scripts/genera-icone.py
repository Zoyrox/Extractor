#!/usr/bin/env python3
"""Genera le icone dell'app (SVG e PNG) senza dipendenze esterne.

Uso:  python3 scripts/genera-icone.py
Crea in icons/: icon.svg, icon-192.png, icon-512.png, icon-maskable-192.png,
icon-maskable-512.png, apple-touch-icon.png (180x180).

Disegno (coordinate su 512x512): sfondo indaco, un foglio bianco con tre
righe; la prima ha il pallino giallo, cioè "l'estratto".
"""
import os
import struct
import zlib

ACCENTO = (0x43, 0x38, 0xCA)
BIANCO = (0xFF, 0xFF, 0xFF)
GIALLO = (0xF5, 0xB4, 0x00)
CHIARO = (0xC7, 0xD2, 0xFE)

CARTELLA = os.path.join(os.path.dirname(__file__), '..', 'icons')


def forme(sfondo_raggio):
    """Elenco di forme (tipo, parametri, colore) in ordine di disegno."""
    f = [('rrect', (0, 0, 512, 512, sfondo_raggio), ACCENTO),
         ('rrect', (112, 128, 288, 256, 36), BIANCO)]
    for i, cy in enumerate((196, 256, 316)):
        f.append(('circle', (160, cy, 18), GIALLO if i == 0 else CHIARO))
        f.append(('rrect', (196, cy - 12, 156 if i == 0 else 120, 24, 12), ACCENTO if i == 0 else CHIARO))
    return f


def dentro(tipo, p, x, y):
    if tipo == 'circle':
        cx, cy, r = p
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    rx, ry, w, h, r = p
    if x < rx or y < ry or x > rx + w or y > ry + h:
        return False
    # Angoli arrotondati.
    cx = min(max(x, rx + r), rx + w - r)
    cy = min(max(y, ry + r), ry + h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def bbox(tipo, p):
    if tipo == 'circle':
        cx, cy, r = p
        return cx - r, cy - r, cx + r, cy + r
    rx, ry, w, h, _ = p
    return rx, ry, rx + w, ry + h


def rasterizza(dim, sfondo_raggio, ss=4):
    """Rasterizza con supersampling ss x ss. Restituisce righe RGBA."""
    scala = 512 / dim
    lista = [(t, p, c, bbox(t, p)) for t, p, c in forme(sfondo_raggio)]
    righe = []
    for py in range(dim):
        riga = bytearray()
        for px in range(dim):
            r = g = b = a = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) * scala
                    y = (py + (sy + 0.5) / ss) * scala
                    col = None
                    for t, p, c, (x0, y0, x1, y1) in lista:
                        if x0 <= x <= x1 and y0 <= y <= y1 and dentro(t, p, x, y):
                            col = c
                    if col:
                        r += col[0]; g += col[1]; b += col[2]; a += 255
            n = ss * ss
            if a:
                cov = a / 255
                riga += bytes((round(r / cov), round(g / cov), round(b / cov), round(a / n)))
            else:
                riga += b'\x00\x00\x00\x00'
        righe.append(bytes(riga))
    return righe


def salva_png(percorso, dim, righe):
    raw = b''.join(b'\x00' + r for r in righe)

    def chunk(tipo, dati):
        c = struct.pack('>I', len(dati)) + tipo + dati
        return c + struct.pack('>I', zlib.crc32(tipo + dati) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', dim, dim, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(percorso, 'wb') as f:
        f.write(png)


def svg(sfondo_raggio):
    hexc = lambda c: '#%02x%02x%02x' % c
    parti = []
    for t, p, c in forme(sfondo_raggio):
        if t == 'circle':
            parti.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="{p[2]}" fill="{hexc(c)}"/>')
        else:
            parti.append(f'<rect x="{p[0]}" y="{p[1]}" width="{p[2]}" height="{p[3]}" rx="{p[4]}" fill="{hexc(c)}"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            + ''.join(parti) + '</svg>\n')


def main():
    os.makedirs(CARTELLA, exist_ok=True)
    with open(os.path.join(CARTELLA, 'icon.svg'), 'w') as f:
        f.write(svg(112))
    # (nome, dimensione, raggio dello sfondo): le maskable e l'icona Apple
    # sono a tutta pagina, il sistema operativo applica la propria forma.
    for nome, dim, raggio in (('icon-192.png', 192, 112), ('icon-512.png', 512, 112),
                              ('icon-maskable-192.png', 192, 0), ('icon-maskable-512.png', 512, 0),
                              ('apple-touch-icon.png', 180, 0)):
        salva_png(os.path.join(CARTELLA, nome), dim, rasterizza(dim, raggio, ss=3 if dim > 200 else 4))
        print('creato', nome)


if __name__ == '__main__':
    main()
