# -*- coding: utf-8 -*-
"""Seguridad Social - afiliados en alta el ultimo dia del mes por municipio,
division CNAE (2 digitos), regimen y sexo. Un Excel por mes (~25 MB, toda
Espana) en www.seg-social.es/descargas/STAT/MUNCNAE<MM><AA>[R].xlsx.

Cada mes se reduce a lo que usa el observatorio y se guarda en
pipeline/cache/afil_ss/<AAAA-MM>.json, que va al repositorio: la Action solo
descarga los meses nuevos (o los que la Seguridad Social revisa: sufijo R).

Las celdas con menos de 5 afiliados vienen como '<5' (secreto estadistico):
no se suman y se cuentan aparte, para poder decir cuanto queda fuera.

Desde enero de 2026 la clasificacion es la CNAE-2025; antes, la CNAE-2009.
Las divisiones de 2 digitos casi no cambian de numero (55-56 sigue siendo la
Hosteleria), asi que la serie se agrupa por division y es comparable salvo
retoques de contenido.

Solo biblioteca estandar: el .xlsx se lee como zip + XML en streaming.
"""

import io
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET

from .comun import get, ok, aviso

PAGINA = ("https://www.seg-social.es/wps/portal/wss/internet/EstadisticasPresupuestosEstudios/"
          "Estadisticas/EST8/EST10/EST305/c43ad8ea-fe79-4329-ac8e-e5758f3c4d7a/"
          "f83fe4aa-2dee-49c5-8317-98d105813796")
BASE = "https://www.seg-social.es/descargas/STAT/"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Division CNAE (2 digitos) -> seccion, con las letras de la CNAE-2009 para que
# toda la serie use una sola agrupacion.
SECCIONES = [
    ("A", range(1, 4)), ("B", range(5, 10)), ("C", range(10, 34)), ("D", [35]),
    ("E", range(36, 40)), ("F", range(41, 44)), ("G", range(45, 48)), ("H", range(49, 54)),
    ("I", [55, 56]), ("J", range(58, 64)), ("K", range(64, 67)), ("L", [68]),
    ("M", range(69, 76)), ("N", range(77, 83)), ("O", [84]), ("P", [85]),
    ("Q", range(86, 89)), ("R", range(90, 94)), ("S", range(94, 97)), ("T", [97, 98]), ("U", [99]),
]
SECCION_DE = {d: s for s, ds in SECCIONES for d in ds}


def ficheros_publicados():
    """{'AAAA-MM': 'MUNCNAEmmaa[R].xlsx'} segun la pagina de la Seguridad Social."""
    html = get(PAGINA).decode("utf-8", errors="replace")
    out = {}
    for mm, aa, r in re.findall(r"descargas/STAT/MUNCNAE(\d{2})(\d{2})(R?)\.xlsx", html):
        mes = f"20{aa}-{mm}"
        nombre = f"MUNCNAE{mm}{aa}{r}.xlsx"
        if r or mes not in out:          # la revision (R) manda sobre la original
            out[mes] = nombre
    return out


def _col(ref):
    return re.match(r"[A-Z]+", ref).group(0)


def _filas(xlsx_bytes):
    """Genera cada fila como {columna: valor} leyendo el XML en streaming."""
    z = zipfile.ZipFile(io.BytesIO(xlsx_bytes))
    compartidas = []
    if "xl/sharedStrings.xml" in z.namelist():
        with z.open("xl/sharedStrings.xml") as f:
            for _, el in ET.iterparse(f):
                if el.tag == NS + "si":
                    compartidas.append("".join(t.text or "" for t in el.iter(NS + "t")))
                    el.clear()
    hoja = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))[0]
    with z.open(hoja) as f:
        for _, el in ET.iterparse(f):
            if el.tag != NS + "row":
                continue
            fila = {}
            for c in el.iter(NS + "c"):
                v = c.find(NS + "v")
                if v is None:
                    t = c.find(NS + "is")
                    val = "".join(x.text or "" for x in t.iter(NS + "t")) if t is not None else None
                else:
                    val = v.text
                    if c.get("t") == "s":
                        val = compartidas[int(val)]
                fila[_col(c.get("r"))] = val
            el.clear()
            yield fila


def _entero(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def resumir_mes(xlsx_bytes, cods, prov):
    """Reduce el Excel nacional a los municipios de la comarca y a la provincia.

    Columnas: A fecha, B cod. provincia, D cod. municipio, F cod. regimen,
    H cod. CNAE, J cod. sexo (1 hombre, 2 mujer), L afiliados."""
    cods = set(int(c) for c in cods)
    mun = {}
    p = {"total": 0, "hos": 0, "sup": 0}
    cabecera = True
    for f in _filas(xlsx_bytes):
        if cabecera:
            cabecera = False
            continue
        if _entero(f.get("B")) != prov:
            continue
        crudo = f.get("L")
        n = _entero(crudo)
        div = _entero(f.get("H"))
        sec = SECCION_DE.get(div)
        if n is None:
            p["sup"] += 1
        else:
            p["total"] += n
            if sec == "I":
                p["hos"] += n
        c = _entero(f.get("D"))
        # Algun mes (MUNCNAE0525) trae el codigo partido: la ultima cifra va
        # pegada al principio del nombre ('100' + '1ALEGRIA-DULANTZI' = 1001).
        pegado = re.match(r"\d+", f.get("E") or "")
        if pegado and c is not None:
            c = int(str(c) + pegado.group(0))
        if c not in cods:
            continue
        m = mun.setdefault(str(c).zfill(5), {"total": 0, "sec": {}, "sup": 0, "hos_sup": 0,
                                             "hos_sexo": {"h": 0, "m": 0}, "hos_reg": {"rg": 0, "aut": 0, "otro": 0}})
        if n is None:
            m["sup"] += 1
            if sec == "I":
                m["hos_sup"] += 1
            continue
        m["total"] += n
        if sec:
            m["sec"][sec] = m["sec"].get(sec, 0) + n
        if sec == "I":
            sx = _entero(f.get("J"))
            m["hos_sexo"]["h" if sx == 1 else "m"] += n
            reg = _entero(f.get("F"))
            m["hos_reg"]["rg" if reg == 111 else "aut" if reg == 521 else "otro"] += n
    return {"mun": mun, "prov": p}


def _sin_enlace(desde, hasta, primer_dic):
    """Meses que la pagina ya no enlaza pero siguen en el servidor: todos los
    meses desde `desde` y el diciembre de cada año desde `primer_dic`.
    Comprobado en nov-2026: hay mensual desde ene-2022 y solo diciembres de
    2012 a 2021. Diciembre de 2011 existe, pero en CNAE-93: no es comparable."""
    out = []
    a, m = int(desde[:4]), int(desde[5:])
    while f"{a}-{m:02d}" <= hasta:
        out.append(f"{a}-{m:02d}")
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    out += [f"{y}-12" for y in range(int(primer_dic), int(desde[:4]))]
    return sorted(set(out))


def _bajar(mes):
    """Descarga un mes sin enlace probando el nombre normal y el revisado."""
    mm, aa = mes[5:], mes[2:4]
    ultimo = None
    for nombre in (f"MUNCNAE{mm}{aa}.xlsx", f"MUNCNAE{mm}{aa}R.xlsx"):
        try:
            return nombre, get(BASE + nombre, timeout=300, reintentos=1)
        except Exception as e:                                    # noqa: BLE001
            ultimo = e
    raise ultimo


def afiliacion_mensual(cods, prov, carpeta_cache, desde="2022-01", primer_dic="2012"):
    """Serie mensual por municipio desde `desde` y serie anual (diciembre) desde
    `primer_dic`. Lee la cache y descarga solo lo que falta."""
    os.makedirs(carpeta_cache, exist_ok=True)
    publicados = ficheros_publicados()
    if not publicados:
        raise RuntimeError("la pagina de la Seguridad Social no lista ficheros MUNCNAE")
    candidatos = sorted(set(m for m in publicados if m >= desde) |
                        set(_sin_enlace(desde, max(publicados), primer_dic)))
    meses = {}
    for mes in candidatos:
        ruta = os.path.join(carpeta_cache, mes + ".json")
        previo = None
        if os.path.exists(ruta):
            with io.open(ruta, encoding="utf-8") as fh:
                previo = json.load(fh)
        # Sin enlace en la pagina, lo que hay en la cache vale (no se revisa).
        if previo and (mes not in publicados or previo.get("fichero") == publicados[mes]):
            meses[mes] = previo
            continue
        try:
            if mes in publicados:
                nombre, crudo = publicados[mes], get(BASE + publicados[mes], timeout=300)
            else:
                nombre, crudo = _bajar(mes)
            r = resumir_mes(crudo, cods, prov)
        except Exception as e:                                    # noqa: BLE001
            aviso(f"{mes}: {e}")
            if previo:
                meses[mes] = previo
            continue
        if not r["mun"]:
            aviso(f"{nombre}: sin filas de la comarca")
            continue
        r["fichero"] = nombre
        with io.open(ruta, "w", encoding="utf-8") as fh:
            json.dump(r, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        ok(f"{mes}: {nombre} descargado y resumido")
        meses[mes] = r
    for nombre in sorted(os.listdir(carpeta_cache)):
        mes = nombre[:-5]
        if nombre.endswith(".json") and mes >= f"{primer_dic}-12" and mes not in meses:
            with io.open(os.path.join(carpeta_cache, nombre), encoding="utf-8") as fh:
                meses[mes] = json.load(fh)

    # Serie anual: diciembre de cada año (el mes de cierre que hay desde 2012).
    dics = sorted(m for m in meses if m.endswith("-12"))
    cods5 = [str(c).zfill(5) for c in cods]
    anual = {
        "x": [m[:4] for m in dics],
        "total": {c: [(meses[m]["mun"].get(c) or {}).get("total") for m in dics] for c in cods5},
        "hos": {c: [((meses[m]["mun"].get(c) or {}).get("sec") or {}).get("I") for m in dics] for c in cods5},
        "prov": {"total": [meses[m]["prov"]["total"] for m in dics], "hos": [meses[m]["prov"]["hos"] for m in dics]},
    }
    meses = {m: v for m, v in meses.items() if m >= desde}

    xs = sorted(meses)
    letras = [s for s, _ in SECCIONES]
    cods = [str(c).zfill(5) for c in cods]

    def de(c, fn):
        return [fn(meses[x]["mun"].get(c)) if meses[x]["mun"].get(c) else None for x in xs]

    return {
        "x": xs,
        "letras": letras,
        "total": {c: de(c, lambda m: m["total"]) for c in cods},
        "hos": {c: de(c, lambda m: m["sec"].get("I", 0)) for c in cods},
        "hos_h": {c: de(c, lambda m: m["hos_sexo"]["h"]) for c in cods},
        "hos_m": {c: de(c, lambda m: m["hos_sexo"]["m"]) for c in cods},
        "hos_aut": {c: de(c, lambda m: m["hos_reg"]["aut"]) for c in cods},
        "sec": {c: {s: de(c, lambda m, s=s: m["sec"].get(s, 0)) for s in letras} for c in cods},
        "sup": {c: de(c, lambda m: m["sup"]) for c in cods},
        "prov": {"total": [meses[x]["prov"]["total"] for x in xs], "hos": [meses[x]["prov"]["hos"] for x in xs]},
        "ficheros": {x: meses[x].get("fichero") for x in xs},
        "anual": anual,
    }
