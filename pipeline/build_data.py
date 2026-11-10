# -*- coding: utf-8 -*-
"""Colector del Observatorio Turistico de l'Horta Sud.

    python pipeline/build_data.py

Descarga, para los 20 municipios de la comarca, lo que las fuentes oficiales
publican de verdad a escala municipal, y el contexto provincial de lo que no:

  INE  - Turismo a partir de la telefonia movil (experimental): turistas
         residentes en Espana (tabla 53464) y en el extranjero (52048) por
         municipio de destino, mes a mes.
  INE  - Viviendas turisticas en Espana (experimental): 39363 y 39366.
  INE  - Padron municipal (2903).
  INE  - Encuestas de ocupacion hotelera y de apartamentos, provincia de
         Valencia (2074, 2066, 2065, 2063, 2072). La EOH NO se publica para
         ningun municipio de l'Horta Sud: por eso es contexto, no dato local.
  GVA  - Registro de Turismo de la Comunitat Valenciana (dadesobertes.gva.es):
         hoteles, viviendas de uso turistico, agencias, turismo activo, etc.
  SEPE - Paro registrado (por sector, sexo y edad) y contratos por municipios.
  SS   - Afiliados a la Seguridad Social el ultimo dia de cada mes por
         municipio y division CNAE (seg-social.es, desde 2023): la Hosteleria
         es el empleo turistico que baja a municipio. Mensual, con cache en
         pipeline/cache/afil_ss para no bajar 25 MB por mes cada dia.

Reglas del kit: solo GET; un fallo de una fuente no tumba el panel; nunca se
publica un data.js peor que el vigente (umbral del 90 %).
"""

import datetime
import json
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sources import sepe, ss                                          # noqa: E402
from sources.comun import get_json, escribir_js, paso, ok, aviso, num  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "data", "data.js")

# Los 20 municipios de la Mancomunitat: (codigo INE, nombre, id de valor en Tempus3)
MUNICIPIOS = [
    ("46005", "Alaquàs", 7670), ("46007", "Albal", 7671), ("46015", "Alcàsser", 7676),
    ("46021", "Aldaia", 7680), ("46022", "Alfafar", 7681), ("46054", "Benetússer", 7701),
    ("46065", "Beniparrell", 927), ("46094", "Catarroja", 7721),
    ("46152", "Llocnou de la Corona", 7765), ("46159", "Manises", 7772),
    ("46165", "Massanassa", 7778), ("46169", "Mislata", 7782), ("46186", "Paiporta", 7799),
    ("46193", "Picanya", 7806), ("46194", "Picassent", 774), ("46102", "Quart de Poblet", 7725),
    ("46223", "Sedaví", 7823), ("46230", "Silla", 7828), ("46244", "Torrent", 16550),
    ("46110", "Xirivella", 7730),
]
COD_DE_ID = {i: c for c, _, i in MUNICIPIOS}
CODS = [c for c, _, _ in MUNICIPIOS]
PROV_VALENCIA = 46           # id de valor de la provincia en Tempus3 (variable 115)

INE = "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/"
CKAN = "https://dadesobertes.gva.es/api/3/action/"


# ------------------------------------------------------------------- INE

def ine_tabla(tabla, tv, nult=None):
    """Series de una tabla con metadatos. Devuelve [] si el INE la niega."""
    url = f"{INE}{tabla}?tip=M&tv={tv}" + (f"&nult={nult}" if nult else "")
    j = get_json(url)
    if isinstance(j, dict):                  # {'status': 'restricciones de volumen'}
        raise RuntimeError(j.get("status", "respuesta inesperada"))
    return j


def periodo_mes(d):
    """AAAA-MM con Anyo + FK_Periodo. NUNCA con `Fecha` (trampa de zona horaria)."""
    p = d.get("FK_Periodo")
    if p is None or not (1 <= int(p) <= 12):
        return None
    return f"{int(d['Anyo']):04d}-{int(p):02d}"


def puntos_mes(serie):
    out = {}
    for d in serie.get("Data", []):
        t = periodo_mes(d)
        if t and d.get("Valor") is not None:
            out[t] = d["Valor"]
    return out


def meta_nombres(serie):
    return [m.get("Nombre", "") for m in serie.get("MetaData", [])]


def otro_nombre(serie, excluir):
    """El valor de la dimension que no es ni municipio ni concepto."""
    for m in serie.get("MetaData", []):
        n = m.get("Nombre", "")
        if m.get("Id") in COD_DE_ID or n in excluir:
            continue
        return n
    return None


def por_municipio(tabla, nult=None):
    """Itera (cod_municipio, [series]) pidiendo la tabla municipio a municipio."""
    for cod, nombre, vid in MUNICIPIOS:
        try:
            yield cod, ine_tabla(tabla, f"19:{vid}", nult)
        except Exception as e:                                    # noqa: BLE001
            aviso(f"INE {tabla} {nombre}: {e}")
            yield cod, []


def alinear(por_cod):
    """{cod: {periodo: valor}} -> (x ordenado, {cod: [valores con None]})."""
    xs = sorted({t for d in por_cod.values() for t in d})
    return xs, {c: [por_cod.get(c, {}).get(t) for t in xs] for c in CODS}


def suma_ult12(d, xs):
    ult = xs[-12:]
    vals = [d.get(t) for t in ult if d.get(t) is not None]
    return round(sum(vals)) if vals else None


def turismo_movil(tabla, total, nult=None):
    """Turistas por municipio de destino y origen. `total` es el nombre de la
    serie agregada ('Total Nacional' / 'Total')."""
    tot, det = {}, {}
    for cod, series in por_municipio(tabla, nult):
        for s in series:
            o = otro_nombre(s, ("Turistas", "Dato base"))
            if not o:
                continue
            p = puntos_mes(s)
            if o == total:
                tot[cod] = p
            else:
                det.setdefault(cod, {})[o] = p
    xs, m = alinear(tot)
    origenes = sorted({o for d in det.values() for o in d})
    # Suma de los ultimos 12 meses por origen: el reparto que se lee sin estacionalidad.
    orig = {c: [suma_ult12(det.get(c, {}).get(o, {}), xs) for o in origenes] for c in CODS}
    # Se descartan los origenes sin dato en ningun municipio.
    vivos = [i for i, _ in enumerate(origenes) if any(orig[c][i] for c in CODS)]
    return {"x": xs, "m": m,
            "origenes": [origenes[i] for i in vivos],
            "origen": {c: [orig[c][i] for i in vivos] for c in CODS},
            "origen_periodo": [xs[-12], xs[-1]] if len(xs) >= 12 else []}


def viviendas_turisticas():
    viv, pla, pct = {}, {}, {}
    for cod, series in por_municipio(39363):
        for s in series:
            ns = " ".join(meta_nombres(s)) + " " + s.get("Nombre", "")
            p = puntos_mes(s)
            if "Plazas por vivienda" in ns:
                continue
            if "Plazas" in ns:
                pla[cod] = p
            elif "Viviendas" in ns:
                viv[cod] = p
    for cod, series in por_municipio(39366):
        for s in series:
            pct[cod] = puntos_mes(s)
    xs = sorted({t for d in list(viv.values()) + list(pct.values()) for t in d})
    f = lambda src: {c: [src.get(c, {}).get(t) for t in xs] for c in CODS}   # noqa: E731
    return {"x": xs, "viv": f(viv), "plazas": f(pla), "pct": f(pct)}


def padron():
    pob = {}
    for cod, series in por_municipio(2903, nult=30):
        for s in series:
            ns = meta_nombres(s)
            if "Total" in ns and not ("Hombres" in ns or "Mujeres" in ns):
                pob[cod] = {str(int(d["Anyo"])): d["Valor"] for d in s.get("Data", [])
                            if d.get("Valor") is not None}
    xs, m = alinear(pob)
    return {"x": xs, "m": m}


def provincia():
    """EOH y EOAP de la provincia de Valencia: el contexto de ocupacion que no
    existe a escala municipal en la comarca."""
    def tabla(t, nult=96):
        try:
            return ine_tabla(t, f"115:{PROV_VALENCIA}", nult)
        except Exception as e:                                    # noqa: BLE001
            aviso(f"INE {t} provincia: {e}")
            return []

    def pick(series, *trozos):
        nd = [x.lower() for x in trozos]
        for s in series:
            n = (s.get("Nombre", "") + " " + " ".join(meta_nombres(s))).lower()
            if all(x in n for x in nd):
                return puntos_mes(s)
        aviso(f"provincia: sin serie para {trozos}")
        return {}

    vp, oc, es = tabla(2074), tabla(2066), tabla(2065)
    hot = {
        "viajeros_res": pick(vp, "viajeros", "residentes en españa"),
        "viajeros_ext": pick(vp, "viajeros", "residentes en el extranjero"),
        "pern_res": pick(vp, "pernoctaciones", "residentes en españa"),
        "pern_ext": pick(vp, "pernoctaciones", "residentes en el extranjero"),
        "plazas": pick(oc, "plazas estimadas"),
        "estab": pick(oc, "establecimientos abiertos"),
        "ocup": pick(oc, "grado de ocupación por plazas."),
        "ocup_fs": pick(oc, "ocupación por plazas en fin de semana"),
        "ocup_hab": pick(oc, "ocupación por habitaciones"),
        "personal": pick(oc, "personal empleado"),
        "estancia": pick(es, "estancia media"),
    }
    av, ao = tabla(2063), tabla(2072)
    apt = {
        "viajeros_res": pick(av, "viajero", "residentes en españa"),
        "viajeros_ext": pick(av, "viajero", "residentes en el extranjero"),
        "pern_res": pick(av, "pernoctaciones", "residentes en españa"),
        "pern_ext": pick(av, "pernoctaciones", "residentes en el extranjero"),
        "plazas": pick(ao, "plazas estimadas"),
        "ocup": pick(ao, "grado de ocupación por plazas"),
        "ocup_apt": pick(ao, "ocupación por apartamentos."),
        "ocup_apt_fs": pick(ao, "apartamentos en fin de semana"),
    }

    def empaquetar(d):
        xs = sorted({t for v in d.values() for t in v})
        out = {"x": xs}
        for k, v in d.items():
            out[k] = [v.get(t) for t in xs]
        return out

    return {"hot": empaquetar(hot), "apt": empaquetar(apt)}


# ------------------------------------------------------------------- GVA

def ckan(recurso, filtros):
    q = urllib.parse.quote(json.dumps(filtros))
    out, off = [], 0
    while True:
        r = get_json(f"{CKAN}datastore_search?resource_id={recurso}&limit=5000&offset={off}&filters={q}")["result"]
        out += r["records"]
        off += 5000
        if off >= r.get("total", 0):
            return out


def ckan_fecha(paquete):
    """Fecha de la ultima carga del recurso con datastore."""
    try:
        p = get_json(f"{CKAN}package_show?id={paquete}")["result"]
        for r in p["resources"]:
            if r.get("datastore_active"):
                return (r.get("last_modified") or p.get("metadata_modified") or "")[:10]
    except Exception:                                             # noqa: BLE001
        pass
    return None


def arregla(s):
    """El portal sirve el texto con doble codificacion (UTF-8 leido como cp1252)."""
    if not isinstance(s, str):
        return s
    for enc in ("cp1252", "latin-1"):
        try:
            return s.encode(enc).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return s


def anyo(f):
    """Año de '2001-11-15T00:00:00' o de '27/06/2019'."""
    s = str(f or "")
    m = re.match(r"(\d{4})-\d{2}", s) or re.search(r"/(\d{4})", s)
    return int(m.group(1)) if m else None


M3 = [c[2:] for c in CODS]            # codigo de municipio de 3 cifras de la GVA


def hoteles():
    rec = ckan("04795475-2072-404f-8f1d-d75bd963ab2f",
               {"Cod. Provincia": "46", "Cod. Municipio": M3})
    hoy = datetime.date.today().year
    lista, evol = [], {c: {} for c in CODS}
    anios = list(range(2000, hoy + 1))
    for r in rec:
        cod = "46" + r["Cod. Municipio"]
        pl = r.get("Plazas") or 0
        a, b = anyo(r.get("Fecha Alta")), anyo(r.get("Fecha Baja"))
        # Plazas abiertas a 31 de diciembre de cada año: alta <= año y sin baja aun.
        for y in anios:
            if a is not None and a <= y and (b is None or b > y):
                evol[cod][y] = evol[cod].get(y, 0) + pl
        if (r.get("Estado") or "").upper() == "ALTA":
            lista.append({
                "n": arregla(r.get("Nombre") or "").title(),
                "mod": arregla(r.get("Modalidad") or r.get("Grupo") or "Pensión").capitalize(),
                "cat": arregla(r.get("Categoria") or "").capitalize(),
                "c": cod, "plazas": pl, "hab": r.get("Habitaciones") or 0, "alta": a,
            })
    lista.sort(key=lambda h: -h["plazas"])
    return {"lista": lista,
            "evol": {"x": [str(y) for y in anios],
                     "m": {c: [evol[c].get(y, 0) for y in anios] for c in CODS}},
            "fecha": ckan_fecha("dades-turisme-hotels-comunitat-valenciana")}


def vut_registro():
    rec = ckan("b1bdc28e-9813-422a-ab7a-63c21290493d",
               {"cod_provincia": "46", "cod_municipio": M3})
    m = {c: {"n": 0, "plazas": 0} for c in CODS}
    altas = {c: {} for c in CODS}
    for r in rec:
        cod = "46" + r["cod_municipio"]
        m[cod]["n"] += 1
        m[cod]["plazas"] += int(num(r.get("plazas_totales"), 0) or 0)
        a = anyo(r.get("fecha_alta"))
        if a:
            altas[cod][a] = altas[cod].get(a, 0) + 1
    ys = sorted({y for d in altas.values() for y in d})
    ys = list(range(max(ys[0], 2010), ys[-1] + 1)) if ys else []
    antes = {c: sum(n for y, n in altas[c].items() if y < 2010) for c in CODS}
    return {"m": m, "antes_2010": antes,
            "altas": {"x": [str(y) for y in ys],
                      "m": {c: [altas[c].get(y, 0) for y in ys] for c in CODS}},
            "fecha": ckan_fecha("tur-gestur-vt")}


OTROS = [   # (etiqueta, recurso, campo provincia, campo municipio, paquete)
    ("Agencias de viajes", "23e56d9e-d31b-4f28-8f5f-3ce45dccdf31", "cod_provincia", "cod_municipio"),
    ("Empresas de turismo activo", "a1802652-f1cb-4a7d-b8ac-5bdc0183a740", "PROV_CODIGO", "MUNI_CODIGO"),
    ("Albergues", "2ccc33a9-0e63-4bcd-a3af-f5b94c5787d0", "cod_provincia", "cod_municipio"),
    ("Campings", "fd47e816-1c56-49fa-a931-0d64756be3e2", "cod_provincia", "cod_municipio"),
    ("Casas rurales", "6b31800d-f2e8-4e99-ad4d-913aa71ad1dc", "cod_provincia", "cod_municipio"),
    ("Áreas de pernocta", "78bcca14-020a-4219-ac18-e648615e0c2b", "cod_provincia", "cod_municipio"),
]


def otros_registros(fallos):
    tipos, m = [], {c: [] for c in CODS}
    for etq, rid, cp, cm in OTROS:
        try:
            rec = ckan(rid, {cp: "46", cm: M3})
        except Exception as e:                                    # noqa: BLE001
            fallos.append(f"GVA {etq}: {e}")
            continue
        cuenta = {}
        for r in rec:
            est = (r.get("estado") or "ACTIVO").upper()
            if est.startswith("BAJA"):
                continue
            c = "46" + r[cm]
            cuenta[c] = cuenta.get(c, 0) + 1
        tipos.append(etq)
        for c in CODS:
            m[c].append(cuenta.get(c, 0))
        ok(f"{etq}: {sum(cuenta.values())}")
    return {"tipos": tipos, "m": m}


# ------------------------------------------------------------------ SEPE

def _norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def sepe_municipal(fichero, columnas):
    """Lee los CSV anuales del SEPE de los ultimos 6 años y devuelve
    {"x": meses, "<clave>": {cod: [...]}} para cada clave de `columnas`.

    `columnas` = {clave: [trozos de cabecera]}: la columna se localiza por el
    texto de la cabecera, no por la posicion (el SEPE las ha movido otras veces),
    y si una clave lista varias cabeceras se suman (p. ej. indefinidos de
    hombres + de mujeres)."""
    hoy = datetime.date.today().year
    por = {k: {c: {} for c in CODS} for k in columnas}
    for a in range(hoy - 5, hoy + 1):
        try:
            filas = sepe._csv(sepe.BASE + fichero.format(a=a))
        except Exception as e:                                    # noqa: BLE001
            aviso(f"SEPE {fichero.format(a=a)}: {e}")
            continue
        cab = next((f for f in filas[:5] if any(_norm(x) == "codigo municipio" for x in f)), None)
        if not cab:
            aviso(f"SEPE {a}: sin cabecera reconocible")
            continue
        cabn = [_norm(x) for x in cab]
        idx = {}
        for k, trozos in columnas.items():
            ii = [i for i, h in enumerate(cabn) if any(_norm(t) == h for t in trozos)]
            if len(ii) != len(trozos):
                aviso(f"SEPE {a}: columna '{k}' no encontrada")
                continue
            idx[k] = ii
        for f in filas:
            if len(f) < len(cab):
                continue
            c = f[sepe.COL_MUN_COD].strip().zfill(5)
            t = sepe._periodo(f[sepe.COL_PERIODO])
            if c not in CODS or not t:
                continue
            for k, ii in idx.items():
                vs = [num(f[i]) for i in ii]
                if all(v is not None for v in vs):
                    por[k][c][t] = sum(vs)
    xs = sorted({t for d in por.values() for m in d.values() for t in m})
    out = {"x": xs}
    for k, d in por.items():
        out[k] = {c: [d[c].get(t) for t in xs] for c in CODS}
    return out


def paro():
    r = sepe_municipal(sepe.PARO, {
        "m": ["total Paro Registrado"],
        "serv": ["Paro Servicios"],
        "agri": ["Paro Agricultura"], "ind": ["Paro Industria"],
        "cons": ["Paro Construcción"], "sin": ["Paro Sin empleo Anterior"],
        "muj": ["Paro mujer edad < 25", "Paro mujer edad 25 -45", "Paro mujer edad >=45"],
        "jov": ["Paro hombre edad < 25", "Paro mujer edad < 25"],
        "may45": ["Paro hombre edad >=45", "Paro mujer edad >=45"],
    })
    return r


def contratos():
    return sepe_municipal(sepe.CONTRATOS, {
        "m": ["Total Contratos"],
        "serv": ["Contratos Servicios"],
        "indef": ["Contratos iniciales indefinidos hombres", "Contratos convertidos en indefinidos hombres",
                  "Contratos iniciales indefinidos mujeres", "Contratos convertidos en indefinidos mujeres"],
    })


# ------------------------------------- Seguridad Social - afiliacion mensual

CACHE_AFIL = os.path.join(RAIZ, "pipeline", "cache", "afil_ss")


def afiliacion_mensual():
    return ss.afiliacion_mensual(CODS, PROV_VALENCIA, CACHE_AFIL)


# ------------------------------------------------------------ Recoleccion

def recoger():
    datos = {"meta": {
        "ambito": "l'Horta Sud",
        "actualizado": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }, "mun": [{"c": c, "n": n} for c, n, _ in MUNICIPIOS]}
    fallos = []

    def intenta(clave, titulo, fn, comprobar):
        paso(titulo)
        try:
            r = fn()
            if comprobar(r):
                datos[clave] = r
                return r
            fallos.append(f"{titulo}: vacio")
            aviso("sin datos")
        except Exception as e:                                    # noqa: BLE001
            fallos.append(f"{titulo}: {e}")
            aviso(str(e))
        return None

    r = intenta("interno", "INE - turistas residentes en Espana (movil, 53464)",
                lambda: turismo_movil(53464, "Total Nacional"), lambda r: r["x"])
    if r:
        ok(f"{len(r['x'])} meses, ultimo {r['x'][-1]}")
        datos["meta"]["ultimo_periodo"] = r["x"][-1]
    r = intenta("receptor", "INE - turistas extranjeros (movil, 52048)",
                lambda: turismo_movil(52048, "Total", nult=48), lambda r: r["x"])
    if r:
        ok(f"{len(r['x'])} meses, ultimo {r['x'][-1]}")
    r = intenta("vte", "INE - viviendas turisticas (39363, 39366)",
                viviendas_turisticas, lambda r: r["x"])
    if r:
        ok(f"{len(r['x'])} ediciones, ultima {r['x'][-1]}")
    r = intenta("pob", "INE - padron (2903)", padron, lambda r: r["x"])
    if r:
        ok(f"ultimo año {r['x'][-1]}")
    r = intenta("prov", "INE - EOH y EOAP provincia de Valencia",
                provincia, lambda r: r["hot"]["x"])
    if r:
        ok(f"hoteles hasta {r['hot']['x'][-1]}, apartamentos hasta {(r['apt']['x'] or ['-'])[-1]}")
    r = intenta("hoteles", "GVA - registro de hoteles", hoteles, lambda r: r["lista"])
    if r:
        ok(f"{len(r['lista'])} establecimientos en alta, carga del {r['fecha']}")
    r = intenta("vut", "GVA - registro de viviendas de uso turistico",
                vut_registro, lambda r: any(v["n"] for v in r["m"].values()))
    if r:
        ok(f"{sum(v['n'] for v in r['m'].values())} viviendas, carga del {r['fecha']}")
    paso("GVA - otros registros")
    datos["otros"] = otros_registros(fallos)
    r = intenta("paro", "SEPE - paro registrado", paro, lambda r: r["x"])
    if r:
        ok(f"{len(r['x'])} meses, ultimo {r['x'][-1]}")
    r = intenta("contratos", "SEPE - contratos registrados", contratos, lambda r: r["x"])
    if r:
        ok(f"{len(r['x'])} meses, ultimo {r['x'][-1]}")
    r = intenta("afilm", "Seguridad Social - afiliados por municipio y sector (mensual)",
                afiliacion_mensual, lambda r: r["x"] and any(any(v for v in s if v) for s in r["hos"].values()))
    if r:
        ok(f"{len(r['x'])} meses, ultimo {r['x'][-1]}")

    datos["meta"]["fallos"] = fallos
    return datos, fallos


# -------------------------------------------------------- Red de seguridad

def _contar_valores(obj):
    if isinstance(obj, dict):
        return sum(_contar_valores(v) for v in obj.values())
    if isinstance(obj, list):
        return sum(_contar_valores(v) if isinstance(v, (dict, list))
                   else (1 if isinstance(v, (int, float)) else 0) for v in obj)
    return 0


def _vigente():
    if not os.path.exists(SALIDA):
        return None
    try:
        txt = open(SALIDA, encoding="utf-8").read()
        m = re.search(r"window\.DATOS\s*=\s*(\{.*\});?\s*$", txt, re.S)
        return json.loads(m.group(1)) if m else None
    except Exception:                                             # noqa: BLE001
        return None


RETIRADOS = ["afil"]     # afiliacion trimestral de la GVA, sustituida por la mensual de la SS


def main():
    print("== Observatorio Turistico de l'Horta Sud - recoleccion ==")
    datos, fallos = recoger()
    previo = _vigente()

    # Una fuente caida no borra lo que ya habia: se conserva el bloque anterior.
    # Bloques retirados: no se arrastran del data.js anterior.
    for k in RETIRADOS:
        (previo or {}).pop(k, None)
    if previo:
        for k, v in previo.items():
            if k not in datos:
                datos[k] = v
                aviso(f"se conserva el bloque anterior de '{k}'")

    nuevos = _contar_valores(datos)
    if previo is not None and previo.get("mun"):
        antes = _contar_valores(previo)
        if antes and nuevos < antes * 0.9:
            aviso(f"ABORTADO: {nuevos} valores frente a {antes} publicados "
                  f"({nuevos / antes:.0%}). No se sobrescribe data.js.")
            return 1

    paso("Escritura")
    escribir_js(SALIDA, datos)
    if fallos:
        aviso(f"{len(fallos)} fuente(s) con incidencia: " + "; ".join(fallos))
    print(f"\nListo. {nuevos} valores. Ultimo periodo: "
          f"{datos['meta'].get('ultimo_periodo', 'n/d')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
