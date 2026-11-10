# Observatorio Turístico de l'Horta Sud

Panel de los 20 municipios de la comarca, montado sobre el kit de observatorios.
Ejemplo para el Curso 5 del Plan de Formación Regenera l'Horta Sud (12-11-2026).
No es una web oficial de la Mancomunitat.

## Qué fuentes consulta

| Bloque | Fuente | Escala | Frecuencia |
|---|---|---|---|
| Turistas residentes en España | INE, telefonía móvil, tabla 53464 | municipio | mensual |
| Turistas extranjeros y país | INE, telefonía móvil, tabla 52048 | municipio | mensual (con más retraso) |
| Viviendas turísticas anunciadas | INE, tablas 39363 y 39366 | municipio | semestral |
| Hoteles, VUT, agencias, turismo activo… | Registro de Turismo, dadesobertes.gva.es | establecimiento | diaria |
| Ocupación y pernoctaciones | INE, EOH y EOAP (2074, 2066, 2065, 2063, 2072) | **provincia de Valencia** | mensual |
| Población | INE, padrón, tabla 2903 | municipio | anual |
| Paro registrado y contratos | SEPE, datos abiertos | municipio | mensual |
| Afiliados por sector (hostelería) | Seguridad Social, `MUNCNAEmmaa.xlsx` (CNAE 2D, último día del mes) | municipio | mensual, desde ene-2023 |

Los Excel de la Seguridad Social pesan ~25 MB cada uno (toda España): el
colector resume cada mes en `pipeline/cache/afil_ss/AAAA-MM.json`, que va al
repositorio, y solo descarga los meses nuevos o revisados (sufijo `R`).

La encuesta de ocupación hotelera no se publica para ningún municipio de la
comarca (ninguno es «punto turístico» del INE): por eso la pestaña de ocupación
es provincial y lo dice. Llocnou de la Corona no tiene turistas publicados
(secreto estadístico).

## Actualizar

    python pipeline/build_data.py     # datos (lo hace la Action cada día)
    python pipeline/build_geo.py      # límites municipales, solo una vez

`assets/` es el kit y no se toca. Lo propio de este observatorio: `app.js`,
`horta.css` (mapa de coropletas) y `pipeline/`.
