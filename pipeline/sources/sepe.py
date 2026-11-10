# -*- coding: utf-8 -*-
"""SEPE - datos abiertos de paro y contratos por municipio.

Un CSV por año y por tema, publicado en la sede electronica. Cada fila es un
municipio-mes, asi que el MISMO fichero sirve para el municipio y para construir
los agregados de provincia, comunidad y España: por eso las comparativas de
estos observatorios son homogeneas de verdad (misma fuente, mismo criterio) y no
mezclan un dato municipal del SEPE con una tasa de la EPA.

Ojo con lo que se esta contando: el paro REGISTRADO son demandantes inscritos en
las oficinas de empleo, no la tasa de paro de la EPA. Sirve para la evolucion de
un municipio; no es comparable con el 11 % que sale en los titulares.
"""

import csv
import io

from .comun import get, num, aviso

BASE = ("https://sede.sepe.gob.es/es/portaltrabaja/resources/sede/"
        "datos_abiertos/datos/")

PARO = "Paro_por_municipios_{a}_csv.csv"
CONTRATOS = "Contratos_por_municipios_{a}_csv.csv"

# Columnas del CSV (indice 0). Se mantienen aqui y no repartidas por el codigo
# porque el SEPE ha movido columnas entre ejercicios mas de una vez.
COL_PERIODO = 0        # AAAAMM
COL_PROV = 3           # nombre de provincia
COL_MUN_COD = 6        # codigo INE del municipio (5 digitos)
COL_TOTAL = 8          # total de paro / contratos del mes


def _csv(url):
    raw = get(url)
    # El SEPE publica en Latin-1 con cabecera de varias lineas.
    txt = raw.decode("latin-1", errors="replace")
    return list(csv.reader(io.StringIO(txt), delimiter=";"))


def _periodo(celda):
    s = (celda or "").strip()
    if len(s) < 6 or not s[:6].isdigit():
        return None
    return f"{s[:4]}-{s[4:6]}"


def serie_municipal(anios, municipio_ine, fichero=PARO, columna=COL_TOTAL,
                    provincia=None, comunidad_provincias=None):
    """Descarga los años pedidos y devuelve, de una pasada:

        {"x": [...], "municipio": [...], "provincia": [...],
         "comunidad": [...], "espana": [...]}

    Las tres agregaciones se calculan sumando el mismo fichero, de modo que
    cualquiera de las cuatro series es directamente comparable con las demas.
    Si no se pide comparativa, esas listas vienen vacias.
    """
    mun, agg = {}, {}
    provincia = (provincia or "").upper()
    comunidad = {p.upper() for p in (comunidad_provincias or [])}

    for a in anios:
        url = BASE + fichero.format(a=a)
        try:
            filas = _csv(url)
        except Exception as e:                                    # noqa: BLE001
            aviso(f"SEPE {fichero.format(a=a)}: no disponible ({e})")
            continue

        for r in filas:
            if len(r) <= columna:
                continue
            t = _periodo(r[COL_PERIODO])
            if not t:
                continue
            v = num(r[columna], 0) or 0
            cod = (r[COL_MUN_COD] or "").strip().zfill(5)
            prov = (r[COL_PROV] or "").strip().upper()

            if cod == str(municipio_ine).zfill(5):
                mun[t] = v
            b = agg.setdefault(t, {"prov": 0, "com": 0, "esp": 0})
            b["esp"] += v
            if provincia and prov == provincia:
                b["prov"] += v
            if comunidad and prov in comunidad:
                b["com"] += v

    xs = sorted(set(mun) | set(agg))
    return {
        "x": xs,
        "municipio": [mun.get(t) for t in xs],
        "provincia": [agg.get(t, {}).get("prov") for t in xs] if provincia else [],
        "comunidad": [agg.get(t, {}).get("com") for t in xs] if comunidad else [],
        "espana": [agg.get(t, {}).get("esp") for t in xs],
    }
