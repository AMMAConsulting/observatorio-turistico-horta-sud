# -*- coding: utf-8 -*-
"""Genera data/geo.js con los limites de los 20 municipios de l'Horta Sud.

    python pipeline/build_geo.py

Se ejecuta una sola vez (los terminos municipales no cambian). Fuente: IGN,
servido por Opendatasoft (georef-spain-municipio). Las geometrias se simplifican
con Douglas-Peucker a ~15 m: sobra para un mapa comarcal y deja el fichero ligero.
"""

import io
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sources.comun import get_json, ok          # noqa: E402
from build_data import MUNICIPIOS               # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-spain-municipio/records"
TOL = 0.00015


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    n = (dx * dx + dy * dy) ** 0.5 or 1e-12
    imax, dmax = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / n
        if d > dmax:
            imax, dmax = i, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return dp(pts[:imax + 1], tol)[:-1] + dp(pts[imax:], tol)


def anillo(r):
    r = [[p[0], p[1]] for p in r]
    mitad = len(r) // 2
    s = dp(r[:mitad + 1], TOL)[:-1] + dp(r[mitad:], TOL)
    return [[round(x, 5), round(y, 5)] for x, y in s]


def main():
    sys.setrecursionlimit(20000)
    feats = []
    for cod, nombre, _ in MUNICIPIOS:
        q = urllib.parse.urlencode({"where": f'mun_code="{cod}"', "limit": 1})
        r = get_json(f"{API}?{q}")["results"][0]
        g = r["geo_shape"]["geometry"]
        polis = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        polis = [[anillo(a) for a in p] for p in polis]
        feats.append({"type": "Feature",
                      "properties": {"c": cod, "n": nombre,
                                     "lat": round(r["geo_point_2d"]["lat"], 5),
                                     "lon": round(r["geo_point_2d"]["lon"], 5)},
                      "geometry": {"type": "MultiPolygon", "coordinates": polis}})
        ok(f"{nombre}: {sum(len(a) for p in polis for a in p)} vertices")
    ruta = os.path.join(RAIZ, "data", "geo.js")
    with io.open(ruta, "w", encoding="utf-8") as f:
        f.write("/* Generado por pipeline/build_geo.py - limites municipales (IGN). */\n")
        f.write("window.GEO = ")
        json.dump({"type": "FeatureCollection", "features": feats}, f,
                  ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    ok(f"{ruta} ({os.path.getsize(ruta) // 1024} KB)")


if __name__ == "__main__":
    main()
