/* ============================================================================
   app.js — Observatorio Turístico de l'Horta Sud.
   Declara las secciones sobre el kit (assets/ no se toca). Lo único propio es
   el mapa de coropletas por municipio, que el kit no trae (su mapa es de puntos).
   ========================================================================== */
(function () {
  'use strict';

  var D = window.DATOS || {};
  var F = Obs.fmt;
  var MUN = D.mun || [];
  var NOM = {};
  MUN.forEach(function (m) { NOM[m.c] = m.n; });
  var CODS = MUN.map(function (m) { return m.c; });

  var I = D.interno || { x: [], m: {}, origenes: [], origen: {} };
  var R = D.receptor || { x: [], m: {}, origenes: [], origen: {} };
  var V = D.vte || { x: [], viv: {}, plazas: {}, pct: {} };
  var H = D.hoteles || { lista: [], evol: { x: [], m: {} } };
  var U = D.vut || { m: {}, altas: { x: [], m: {} } };
  var O = D.otros || { tipos: [], m: {} };
  var P = D.pob || { x: [], m: {} };
  var PA = D.paro || { x: [], m: {} };
  var PR = D.prov || { hot: { x: [] }, apt: { x: [] } };

  /* Ámbito activo: 'all' (los 20 municipios) o el código INE de uno. */
  var ambito = 'all';
  var esTodo = function () { return ambito === 'all'; };
  var nombreAmbito = function () { return esTodo() ? "l'Horta Sud" : NOM[ambito]; };

  /* ------------------------------------------------------------ Utilidades */

  var ult = function (a) { return a && a.length ? a[a.length - 1] : null; };
  var suma = function (a) {
    var s = null;
    (a || []).forEach(function (v) { if (v != null) s = (s || 0) + v; });
    return s;
  };
  /* Suma de los 20 municipios, posición a posición. null si no hay ninguno. */
  var sumarMun = function (m) {
    var n = (m[CODS[0]] || []).length, out = [];
    for (var i = 0; i < n; i++) {
      var s = null;
      CODS.forEach(function (c) { var v = (m[c] || [])[i]; if (v != null) s = (s || 0) + v; });
      out.push(s);
    }
    return out;
  };
  var serie = function (m, c) {
    c = c || ambito;
    return c === 'all' ? sumarMun(m) : (m[c] || []);
  };
  var hayDatos = function (a) { return (a || []).some(function (v) { return v != null; }); };
  var ult12 = function (a) { return a && a.length >= 12 ? suma(a.slice(-12)) : null; };
  var delta12 = function (a) {
    if (!a || a.length < 24) return null;
    var c = suma(a.slice(-12)), p = suma(a.slice(-24, -12));
    return (c == null || !p) ? null : (c - p) / p * 100;
  };
  var varInt = function (a) {
    if (!a || a.length < 13) return null;
    var c = a[a.length - 1], p = a[a.length - 13];
    return (c == null || !p) ? null : (c - p) / p * 100;
  };
  /* Totales por año natural, solo de años con los doce meses publicados. */
  var porAnio = function (x, a) {
    var acc = {}, n = {};
    x.forEach(function (t, i) {
      var y = t.slice(0, 4);
      n[y] = (n[y] || 0) + 1;
      if (a[i] != null) acc[y] = (acc[y] || 0) + a[i];
    });
    var ys = Object.keys(n).filter(function (y) { return n[y] === 12 && acc[y] != null; }).sort();
    return { x: ys, v: ys.map(function (y) { return acc[y]; }) };
  };
  var delAnio = function (x, a, y) {
    var s = null;
    x.forEach(function (t, i) { if (t.slice(0, 4) === y && a[i] != null) s = (s || 0) + a[i]; });
    return s;
  };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  /* Una serie por año con los doce meses en el eje: para comparar campañas. */
  var porMesDelAnio = function (x, a, cuantos) {
    var ys = [];
    x.forEach(function (t) { var y = t.slice(0, 4); if (ys.indexOf(y) < 0) ys.push(y); });
    return ys.slice(-cuantos).map(function (y) {
      var fila = MESES.map(function () { return null; });
      x.forEach(function (t, i) { if (t.slice(0, 4) === y) fila[+t.slice(5, 7) - 1] = a[i]; });
      return { name: y, data: fila };
    });
  };
  var rango = function (x) {
    return x.length >= 12 ? Obs.periodo(x[x.length - 12], 'mes') + ' – ' + Obs.periodo(x[x.length - 1], 'mes') : '';
  };
  /* Categorías ordenadas de mayor a menor, descartando vacías. */
  var ranking = function (nombres, valores, tope) {
    var p = nombres.map(function (n, i) { return { n: n, v: valores[i] }; })
      .filter(function (o) { return o.v != null && o.v > 0; })
      .sort(function (a, b) { return b.v - a.v; });
    if (tope) p = p.slice(0, tope);
    return { x: p.map(function (o) { return o.n; }), v: p.map(function (o) { return o.v; }) };
  };
  var origenDe = function (d) {
    if (!esTodo()) return d.origen[ambito] || [];
    return d.origenes.map(function (_, i) {
      var s = null;
      CODS.forEach(function (c) { var v = (d.origen[c] || [])[i]; if (v != null) s = (s || 0) + v; });
      return s;
    });
  };
  var pobUlt = function (c) { return ult(P.m[c] || []); };
  var hotelesDe = function (c) {
    return H.lista.filter(function (h) { return c === 'all' || h.c === c; });
  };
  var plazasHot = function (c) { return suma(hotelesDe(c).map(function (h) { return h.plazas; })) || 0; };

  /* Último año natural completo a la vez en turistas nacionales y extranjeros. */
  var ANIO_COMUN = (function () {
    var a = porAnio(I.x, sumarMun(I.m)).x, b = porAnio(R.x, sumarMun(R.m)).x;
    var c = a.filter(function (y) { return b.indexOf(y) >= 0; });
    return c.length ? c[c.length - 1] : null;
  })();

  /* ---------------------------------------------------------------- Fuentes */

  var URL_MOVIL = 'https://www.ine.es/experimental/turismo_moviles/experimental_turismo_moviles.htm';
  var F_INT = { txt: 'INE · Turismo interno a partir de la telefonía móvil (experimental)', url: URL_MOVIL };
  var F_REC = { txt: 'INE · Turismo receptor a partir de la telefonía móvil (experimental)', url: URL_MOVIL };
  var F_VTE = { txt: 'INE · Viviendas turísticas en España (experimental)', url: 'https://www.ine.es/experimental/viv_turistica/experimental_viv_turistica.htm' };
  var F_EOH = { txt: 'INE · Encuesta de Ocupación Hotelera', url: 'https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736177015&menu=ultiDatos&idp=1254735576863' };
  var F_EOAP = { txt: 'INE · Encuesta de Ocupación en Apartamentos Turísticos', url: 'https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736176962&menu=ultiDatos&idp=1254735576863' };
  var F_HOT = { txt: 'Generalitat Valenciana · Registro de Turismo (hoteles)', url: 'https://dadesobertes.gva.es/es/dataset/dades-turisme-hotels-comunitat-valenciana' };
  var F_VUT = { txt: 'Generalitat Valenciana · Registro de Turismo (viviendas de uso turístico)', url: 'https://dadesobertes.gva.es/es/dataset/tur-gestur-vt' };
  var F_GVA = { txt: 'Generalitat Valenciana · Registro de Turismo', url: 'https://dadesobertes.gva.es/es/dataset?q=turismo' };
  var F_PAD = { txt: 'INE · Padrón municipal', url: 'https://www.ine.es/jaxiT3/Tabla.htm?t=2903' };
  var F_SEPE = { txt: 'SEPE · datos abiertos por municipios', url: 'https://www.sepe.es/HomeSepe/que-es-el-sepe/estadisticas/datos-estadisticos/municipios.html' };

  var MENSUAL = { txt: 'Mensual', tipo: 'live' };
  var ANUAL = { txt: 'Anual' };
  var SEMESTRAL = { txt: 'Semestral', tipo: 'live' };
  var DIARIO = { txt: 'Registro vivo', tipo: 'live' };

  var AVISO_SUMA = 'Las cifras de la comarca son la <b>suma de los 20 municipios</b>. El INE cuenta a cada turista en cada municipio donde pernocta, ' +
    'así que quien duerme en dos municipios de la comarca en el mismo mes suma dos veces.';

  /* ============================================================== 1. MAPA */

  var METRICAS = [
    { id: 'nac', txt: 'Turistas residentes en España', sub: 'Últimos 12 meses publicados (' + rango(I.x) + ')',
      val: function (c) { return ult12(I.m[c]); }, fuente: F_INT },
    { id: 'ext', txt: 'Turistas extranjeros', sub: 'Últimos 12 meses publicados (' + rango(R.x) + ')',
      val: function (c) { return ult12(R.m[c]); }, fuente: F_REC },
    { id: 'int', txt: 'Turistas por cada 1.000 habitantes', sub: 'Residentes en España más extranjeros, año ' + ANIO_COMUN,
      val: function (c) {
        var a = delAnio(I.x, I.m[c] || [], ANIO_COMUN), b = delAnio(R.x, R.m[c] || [], ANIO_COMUN), p = pobUlt(c);
        return (a == null && b == null) || !p ? null : ((a || 0) + (b || 0)) / p * 1000;
      }, fuente: F_INT },
    { id: 'hot', txt: 'Plazas hoteleras', sub: 'Hoteles, hostales y pensiones en alta en el registro',
      val: function (c) { return plazasHot(c); }, fuente: F_HOT },
    { id: 'vut', txt: 'Viviendas turísticas', sub: 'Anunciadas en plataformas, ' + Obs.periodo(ult(V.x), 'mes'),
      val: function (c) { return ult(V.viv[c] || []); }, fuente: F_VTE },
    { id: 'pct', txt: 'Viviendas turísticas sobre el total de viviendas', sub: 'Porcentaje, ' + Obs.periodo(ult(V.x), 'mes'),
      val: function (c) { return ult(V.pct[c] || []); }, fmt: function (v) { return F.pct(v, 2); }, fuente: F_VTE },
    { id: 'pob', txt: 'Población', sub: 'Padrón a 1 de enero de ' + ult(P.x),
      val: function (c) { return pobUlt(c); }, fuente: F_PAD }
  ];
  var metrica = METRICAS[0];
  var elegido = null;                   /* municipio seleccionado en el mapa */
  var mapa = null, capa = null, base = null;

  var RAMPA = {
    claro: ['#e3efd3', '#bcd99a', '#8dbd5e', '#5a9632', '#2c6612'],
    oscuro: ['#22381a', '#305c1c', '#4a8528', '#76b443', '#b0e27c']
  };
  var TESELAS = {
    claro: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    oscuro: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
  };
  var esOscuro = function () {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
  };
  var fmtM = function (v) { return (metrica.fmt || F.num)(v); };

  /* Cortes por cuantiles sobre los municipios con valor positivo. */
  function cortes() {
    var vs = CODS.map(metrica.val).filter(function (v) { return v != null && v > 0; }).sort(function (a, b) { return a - b; });
    if (!vs.length) return [];
    var q = [0.2, 0.4, 0.6, 0.8].map(function (p) { return vs[Math.min(vs.length - 1, Math.floor(p * vs.length))]; });
    return q.filter(function (v, i) { return i === 0 || v > q[i - 1]; });
  }
  function claseDe(v, cs) {
    var k = 0;
    cs.forEach(function (c) { if (v >= c) k++; });
    return k;
  }
  function colorDe(v, cs) {
    var st = getComputedStyle(document.documentElement);
    if (v == null) return st.getPropertyValue('--surface-sunk').trim() || '#eef2f8';
    if (v === 0) return st.getPropertyValue('--surface').trim() || '#fff';
    var r = esOscuro() ? RAMPA.oscuro : RAMPA.claro;
    /* Con pocos cortes se reparten por toda la rampa en vez de usar solo el extremo claro. */
    var paso = cs.length ? (r.length - 1) / cs.length : 0;
    return r[Math.round(claseDe(v, cs) * paso)];
  }

  function pintarMapa() {
    if (!mapa || !window.GEO) return;
    var cs = cortes();
    var st = getComputedStyle(document.documentElement);
    var borde = st.getPropertyValue('--surface').trim() || '#fff';
    var tinta = st.getPropertyValue('--ink').trim() || '#000';
    base.setUrl(esOscuro() ? TESELAS.oscuro : TESELAS.claro);
    if (capa) mapa.removeLayer(capa);
    capa = L.geoJSON(window.GEO, {
      style: function (f) {
        var c = f.properties.c, sel = c === elegido;
        return { fillColor: colorDe(metrica.val(c), cs), fillOpacity: .88,
                 color: sel ? tinta : borde, weight: sel ? 3 : 1.5 };
      },
      onEachFeature: function (f, l) {
        var c = f.properties.c;
        var v = metrica.val(c);
        l.bindTooltip('<b>' + Obs.esc(NOM[c]) + '</b><br>' + Obs.esc(metrica.txt) + ': <b>' +
          (v == null ? 'sin dato' : fmtM(v)) + '</b>', { sticky: true, className: 'hs-tip' });
        l.on('mouseover', function () { if (c !== elegido) l.setStyle({ weight: 3 }); });
        l.on('mouseout', function () { if (c !== elegido) l.setStyle({ weight: 1.5 }); });
        l.on('click', function () { elegir(c); });
      }
    }).addTo(mapa);
    capa.eachLayer(function (l) { if (l.feature.properties.c === elegido) l.bringToFront(); });

    /* Leyenda: el color significa algo solo si se dice qué. */
    var r = esOscuro() ? RAMPA.oscuro : RAMPA.claro;
    var paso = cs.length ? (r.length - 1) / cs.length : 0;
    var tramos = [];
    for (var k = 0; k <= cs.length; k++) {
      var desde = k === 0 ? null : cs[k - 1], hasta = k === cs.length ? null : cs[k];
      tramos.push('<span class="hs-ley"><i style="background:' + r[Math.round(k * paso)] + '"></i>' +
        (desde == null ? 'menos de ' + fmtM(hasta) : (hasta == null ? fmtM(desde) + ' o más' : fmtM(desde) + ' – ' + fmtM(hasta))) + '</span>');
    }
    var hayCero = CODS.some(function (c) { return metrica.val(c) === 0; });
    var hayNulo = CODS.some(function (c) { return metrica.val(c) == null; });
    if (!cs.length) tramos = [];
    if (hayCero) tramos.unshift('<span class="hs-ley"><i style="background:var(--surface);border:1px solid var(--line-strong)"></i>0</span>');
    if (hayNulo) tramos.push('<span class="hs-ley"><i style="background:var(--surface-sunk);border:1px solid var(--line-strong)"></i>sin dato publicado</span>');
    document.getElementById('hs-leyenda').innerHTML = tramos.join('');
    document.getElementById('hs-metrica-sub').textContent = metrica.sub;
    document.getElementById('hs-fuente').innerHTML = 'Fuente: <a href="' + metrica.fuente.url +
      '" target="_blank" rel="noopener">' + Obs.esc(metrica.fuente.txt) + '</a>';
    pintarLista();
  }

  /* La lista es la vista de tabla del mapa: las mismas cifras, legibles sin color. */
  function pintarLista() {
    var filas = CODS.map(function (c) { return { c: c, v: metrica.val(c) }; })
      .sort(function (a, b) { return (b.v == null ? -1 : b.v) - (a.v == null ? -1 : a.v); });
    var max = filas[0] && filas[0].v ? filas[0].v : 1;
    document.getElementById('hs-lista').innerHTML = filas.map(function (f, i) {
      return '<button type="button" class="hs-fila' + (f.c === elegido ? ' on' : '') + '" data-c="' + f.c + '">' +
        '<span class="p">' + (f.v == null ? '–' : i + 1) + '</span>' +
        '<span class="n">' + Obs.esc(NOM[f.c]) + '</span>' +
        '<span class="b"><i style="width:' + (f.v ? Math.max(2, f.v / max * 100) : 0) + '%"></i></span>' +
        '<span class="v">' + (f.v == null ? 'sin dato' : fmtM(f.v)) + '</span></button>';
    }).join('');
  }

  function puesto(m, c) {
    var v = m.val(c);
    if (v == null) return null;
    return CODS.filter(function (o) { var w = m.val(o); return w != null && w > v; }).length + 1;
  }

  function pintarFicha() {
    var host = document.getElementById('hs-ficha');
    if (!elegido) {
      host.innerHTML = '<div class="hs-ficha-vacia">Pulsa un municipio en el mapa o en la lista para ver su ficha.</div>';
      return;
    }
    var c = elegido;
    var filas = METRICAS.map(function (m) {
      var v = m.val(c), p = puesto(m, c);
      return '<tr><td>' + Obs.esc(m.txt) + '</td><td>' + (v == null ? 'sin dato' : (m.fmt || F.num)(v)) + '</td>' +
        '<td>' + (p ? p + '.º de ' + CODS.length : '–') + '</td></tr>';
    }).join('');
    var hs = hotelesDe(c);
    host.innerHTML =
      '<div class="hs-ficha-cab"><h3>' + Obs.esc(NOM[c]) + '</h3>' +
        '<button type="button" class="obs-btn" id="hs-ver">Ver todas sus gráficas</button></div>' +
      '<table class="obs-table"><thead><tr><th>Indicador</th><th>Valor</th><th>Puesto</th></tr></thead><tbody>' + filas + '</tbody></table>' +
      (hayDatos(I.m[c]) ? '<div class="hs-spark"><span>Turistas residentes en España, mes a mes desde ' +
        Obs.periodo(I.x[0], 'mes') + '</span>' + Obs.spark(I.m[c]) + '</div>' : '') +
      (hs.length ? '<div class="hs-hoteles"><span>Alojamiento hotelero</span>' + hs.map(function (h) {
        return '<div>' + Obs.esc(h.n) + ' <em>' + Obs.esc(h.cat) + ' · ' + F.num(h.plazas) + ' plazas</em></div>';
      }).join('') + '</div>' : '');
    document.getElementById('hs-ver').addEventListener('click', function () {
      ponerAmbito(c);
      Obs.ir('visitantes');
      if (caducas.visitantes) { caducas.visitantes = false; Obs.refrescar('visitantes'); }
      window.scrollTo({ top: 0 });
    });
  }

  function elegir(c) {
    elegido = elegido === c ? null : c;
    pintarMapa();
    pintarFicha();
  }

  function montarMapa() {
    var el = document.getElementById('hs-mapa');
    if (!el || typeof L === 'undefined' || !window.GEO) {
      if (el) el.innerHTML = '<div class="obs-msg error">No se pudo cargar el mapa.</div>';
      return;
    }
    mapa = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25, attributionControl: true });
    base = L.tileLayer(esOscuro() ? TESELAS.oscuro : TESELAS.claro, {
      maxZoom: 16, attribution: 'Teselas &copy; Esri · Límites municipales: IGN'
    }).addTo(mapa);
    mapa.on('click', function () { mapa.scrollWheelZoom.enable(); });
    mapa.on('mouseout', function () { mapa.scrollWheelZoom.disable(); });
    mapa.fitBounds(L.geoJSON(window.GEO).getBounds().pad(0.03));
    /* Rótulos fijos: se pintan una vez, encima de los polígonos. */
    var rotulos = window.GEO.features.map(function (f) {
      var m = L.marker([f.properties.lat, f.properties.lon], {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'hs-rotulo', html: '<span>' + Obs.esc(f.properties.n) + '</span>', iconSize: [0, 0] })
      }).addTo(mapa);
      return { m: m, caja: L.geoJSON(f).getBounds(), largo: f.properties.n.length };
    });
    /* Un rótulo solo se enseña si cabe dentro de su término municipal: en el
       centro de la comarca hay municipios de pocas hectáreas y los nombres se
       pisarían. El nombre sigue saliendo al pasar el ratón y en la lista. */
    var ajustarRotulos = function () {
      rotulos.forEach(function (r) {
        var a = mapa.latLngToContainerPoint(r.caja.getNorthWest());
        var b = mapa.latLngToContainerPoint(r.caja.getSouthEast());
        var cabe = (b.x - a.x) > r.largo * 6.4 + 6 && (b.y - a.y) > 22;
        var el = r.m.getElement();
        if (el) el.style.display = cabe ? '' : 'none';
      });
    };
    mapa.on('zoomend', ajustarRotulos);
    ajustarRotulos();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () { mapa.invalidateSize(); }).observe(el);
    }
    document.getElementById('hs-metrica').addEventListener('change', function () {
      var id = this.value;
      metrica = METRICAS.filter(function (m) { return m.id === id; })[0];
      pintarMapa();
    });
    document.getElementById('hs-lista').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-c]');
      if (b) elegir(b.getAttribute('data-c'));
    });
    pintarMapa();
    pintarFicha();
  }
  /* El armazón llama a esto al cambiar de tema. */
  Obs.mapasRepintar = function () { if (mapa) pintarMapa(); };

  var secMapa = {
    id: 'mapa', nombre: 'Mapa',
    titulo: "L'Horta Sud, municipio a municipio",
    desc: 'Elige un indicador y el mapa colorea los 20 municipios. Pulsa cualquiera para ver su ficha y saltar a sus gráficas.',
    render: function () {
      var nac = sumarMun(I.m), ext = sumarMun(R.m);
      mapa = null; capa = null;
      setTimeout(montarMapa, 0);
      return {
        hero: {
          valor: ult12(nac), label: 'Turistas residentes en España en los últimos 12 meses (' + rango(I.x) + ')',
          extra: [
            { label: 'Turistas extranjeros (' + rango(R.x) + ')', valor: ult12(ext) },
            { label: 'Plazas hoteleras', valor: plazasHot('all') },
            { label: 'Viviendas de uso turístico registradas', valor: suma(CODS.map(function (c) { return (U.m[c] || {}).n; })) },
            { label: 'Habitantes', valor: suma(CODS.map(pobUlt)) }
          ]
        },
        extra:
          '<div class="obs-card hs-mapa-card">' +
            '<div class="obs-card-head"><div class="t"><h3>Mapa de indicadores</h3><div class="cs" id="hs-metrica-sub"></div></div>' +
              '<label class="obs-card-ctrl"><span>Indicador</span><select class="obs-select" id="hs-metrica">' +
                METRICAS.map(function (m) { return '<option value="' + m.id + '">' + Obs.esc(m.txt) + '</option>'; }).join('') +
              '</select></label></div>' +
            '<div class="hs-mapa-cuerpo">' +
              '<div class="hs-mapa-izq"><div id="hs-mapa"></div><div class="hs-leyenda" id="hs-leyenda"></div></div>' +
              '<div class="hs-mapa-der"><div class="hs-lista" id="hs-lista"></div></div>' +
            '</div>' +
            '<div class="obs-card-foot"><span id="hs-fuente"></span>' +
              '<span style="flex-basis:100%;font-style:italic">Llocnou de la Corona (132 habitantes) queda por debajo del umbral a partir del cual el INE publica turistas.</span></div>' +
          '</div>' +
          '<div class="obs-card hs-ficha" id="hs-ficha"></div>'
      };
    }
  };

  /* ======================================================== 2. VISITANTES */

  var secVisitantes = {
    id: 'visitantes', nombre: 'Visitantes',
    titulo: 'Quién viene y cuándo',
    desc: 'Turistas que pernoctan en cada municipio, estimados por el INE a partir de la posición de los teléfonos móviles. ' +
      'Es una estadística experimental, y la única fuente oficial que baja hasta el municipio en la comarca: ' +
      'la encuesta hotelera no publica ninguno de los 20.',
    render: function () {
      var nac = serie(I.m), ext = serie(R.m);
      if (!hayDatos(nac) && !hayDatos(ext)) {
        return { nota: 'El INE no publica turistas para <b>' + Obs.esc(nombreAmbito()) + '</b>: el municipio queda por debajo del umbral ' +
          'de secreto estadístico. Elige otro municipio o el conjunto de la comarca.', notaTipo: 'warn' };
      }
      var aNac = porAnio(I.x, nac), aExt = porAnio(R.x, ext);
      var oCcaa = ranking(I.origenes, origenDe(I));
      var oPais = ranking(R.origenes, origenDe(R), 12);
      var pico = (function () {
        var u = nac.slice(-12), xs = I.x.slice(-12), k = 0;
        u.forEach(function (v, i) { if (v != null && v > (u[k] || 0)) k = i; });
        return xs[k];
      })();
      var n12 = ult12(nac), e12 = ult12(ext);
      var nAnio = delAnio(I.x, nac, ANIO_COMUN), eAnio = delAnio(R.x, ext, ANIO_COMUN);

      var cards = [
        {
          titulo: 'Turistas residentes en España', sub: nombreAmbito() + ' · llegados de otras provincias, mes a mes',
          chips: [MENSUAL], fuente: F_INT, ancho: 'full',
          spec: { type: 'area', xType: 'mes', x: I.x, yFormat: 'num', series: [{ name: 'Turistas residentes en España', data: nac }] }
        },
        {
          titulo: 'El año, mes a mes', sub: 'Turistas residentes en España: cada línea es un año',
          chips: [MENSUAL], fuente: F_INT,
          spec: { type: 'line', xType: 'cat', x: MESES, xTodas: true, xLabel: 'Mes', yFormat: 'num', series: porMesDelAnio(I.x, nac, 3) }
        },
        {
          titulo: 'De qué comunidad vienen', sub: 'Turistas residentes en España, ' + rango(I.x),
          chips: [MENSUAL], fuente: F_INT, alto: 'tall',
          spec: { type: 'barh', x: oCcaa.x, xLabel: 'Comunidad de residencia', yFormat: 'num', series: [{ name: 'Turistas', data: oCcaa.v }] }
        },
        {
          titulo: 'Turistas extranjeros', sub: nombreAmbito() + ' · mes a mes',
          chips: [MENSUAL], fuente: F_REC, ancho: 'full',
          nota: 'El INE publica esta serie con más retraso que la de residentes: el último mes disponible es ' + Obs.periodo(ult(R.x), 'mes') + '.',
          spec: { type: 'area', xType: 'mes', x: R.x, yFormat: 'num', series: [{ name: 'Turistas extranjeros', data: ext }] }
        },
        {
          titulo: 'De qué país vienen', sub: 'Doce primeros países de residencia, ' + rango(R.x),
          chips: [MENSUAL], fuente: F_REC, alto: 'tall',
          nota: 'Solo aparecen los países que superan el umbral de publicación en cada municipio; el total incluye también el resto.',
          spec: { type: 'barh', x: oPais.x, xLabel: 'País de residencia', yFormat: 'num', series: [{ name: 'Turistas', data: oPais.v }] }
        },
        {
          titulo: 'Balance por años', sub: 'Años naturales completos',
          chips: [ANUAL], fuente: F_INT,
          nota: 'La serie de extranjeros se recoge desde 2022.',
          spec: {
            type: 'bar', xType: 'anual', x: aNac.x, xLabel: 'Año', yFormat: 'num',
            series: [
              { name: 'Residentes en España', data: aNac.v },
              { name: 'Extranjeros', data: aNac.x.map(function (y) { var i = aExt.x.indexOf(y); return i < 0 ? null : aExt.v[i]; }) }
            ]
          }
        }
      ];

      if (esTodo()) {
        var porMun = function (d, anio) {
          return ranking(CODS.map(function (c) { return NOM[c]; }),
            CODS.map(function (c) { return anio ? delAnio(d.x, d.m[c] || [], anio) : ult12(d.m[c]); }));
        };
        var specRank = function (cual) {
          var r = cual === 'ext' ? porMun(R) : porMun(I);
          return { type: 'barh', x: r.x, xLabel: 'Municipio', yFormat: 'num',
                   series: [{ name: cual === 'ext' ? 'Turistas extranjeros' : 'Turistas residentes en España', data: r.v }] };
        };
        cards.push({
          titulo: 'Qué municipios reciben más', sub: 'Últimos 12 meses publicados de cada serie',
          chips: [MENSUAL], fuente: F_INT, ancho: 'full', alto: 'tall',
          control: { label: 'Turistas', valor: 'nac',
            opciones: [{ v: 'nac', txt: 'Residentes en España' }, { v: 'ext', txt: 'Extranjeros' }], spec: specRank },
          spec: specRank('nac')
        });
        /* Los seis municipios con más turistas, para ver si se mueven a la vez. */
        var top = CODS.slice().sort(function (a, b) { return (ult12(I.m[b]) || 0) - (ult12(I.m[a]) || 0); }).slice(0, 6);
        cards.push({
          titulo: 'Los seis municipios con más turistas', sub: 'Residentes en España, mes a mes',
          chips: [MENSUAL], fuente: F_INT, ancho: 'full',
          spec: { type: 'line', xType: 'mes', x: I.x, yFormat: 'num',
                  series: top.map(function (c) { return { name: NOM[c], data: I.m[c] }; }) }
        });
      }

      return {
        nota: esTodo() ? AVISO_SUMA : null,
        hero: { valor: n12, label: 'Turistas residentes en España en ' + nombreAmbito() + ', ' + rango(I.x),
          extra: [
            { label: 'Turistas extranjeros, ' + rango(R.x), valor: e12 },
            { label: 'Peso del turista extranjero en ' + ANIO_COMUN, valor: (nAnio || eAnio) ? (eAnio || 0) / ((nAnio || 0) + (eAnio || 0)) * 100 : null, formato: function (v) { return F.pct(v); } },
            { label: 'Mes con más turistas residentes', valor: pico, formato: function (v) { return Obs.periodo(v, 'mes'); } }
          ] },
        kpis: [
          { label: 'Residentes en España · ' + Obs.periodo(ult(I.x), 'mes'), valor: ult(nac), delta: varInt(nac), deltaRef: 'interanual', serie: nac.slice(-24) },
          { label: 'Residentes en España · 12 meses', valor: n12, delta: delta12(nac), deltaRef: 'sobre los 12 anteriores', serie: nac.slice(-36) },
          { label: 'Extranjeros · ' + Obs.periodo(ult(R.x), 'mes'), valor: ult(ext), delta: varInt(ext), deltaRef: 'interanual', serie: ext.slice(-24) },
          { label: 'Extranjeros · 12 meses', valor: e12, delta: delta12(ext), deltaRef: 'sobre los 12 anteriores', serie: ext.slice(-36) }
        ],
        cards: cards.filter(function (c) {
          return (c.spec.series || []).some(function (s) { return hayDatos(s.data); });
        })
      };
    }
  };

  /* ======================================================= 3. ALOJAMIENTO */

  function tablaHoteles(hs) {
    if (!hs.length) return '';
    return '<div class="obs-card hs-tabla-card"><div class="obs-card-head"><div class="t"><h3>Establecimientos hoteleros en alta</h3>' +
      '<div class="cs">' + hs.length + ' establecimientos · ' + F.num(suma(hs.map(function (h) { return h.plazas; }))) + ' plazas</div></div></div>' +
      '<div class="hs-tabla-scroll"><table class="obs-table"><thead><tr><th>Establecimiento</th><th>Municipio</th><th>Tipo</th><th>Categoría</th><th>Habitaciones</th><th>Plazas</th><th>Alta</th></tr></thead><tbody>' +
      hs.map(function (h) {
        return '<tr><td>' + Obs.esc(h.n) + '</td><td>' + Obs.esc(NOM[h.c]) + '</td><td>' + Obs.esc(h.mod) + '</td><td>' + Obs.esc(h.cat) +
          '</td><td>' + F.num(h.hab) + '</td><td>' + F.num(h.plazas) + '</td><td>' + (h.alta || '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="obs-card-foot"><span>Fuente: <a href="' + F_HOT.url + '" target="_blank" rel="noopener">' + F_HOT.txt + '</a>' +
      (H.fecha ? ' · carga del ' + H.fecha.split('-').reverse().join('/') : '') + '</span></div></div>';
  }

  var secAlojamiento = {
    id: 'alojamiento', nombre: 'Alojamiento',
    titulo: 'Dónde se puede dormir',
    desc: 'Oferta reglada según el Registro de Turismo de la Comunitat Valenciana, que la Generalitat publica en abierto, ' +
      'y viviendas turísticas anunciadas en plataformas según el INE. Son dos formas distintas de contar la vivienda turística: ' +
      'el registro dice cuántas están inscritas; el INE, cuántas se anuncian.',
    render: function () {
      var hs = hotelesDe(ambito);
      var evol = serie(H.evol.m);
      var desde = H.evol.x.indexOf('2000');
      var porCat = {};
      hs.forEach(function (h) { porCat[h.cat] = (porCat[h.cat] || 0) + h.plazas; });
      var cat = ranking(Object.keys(porCat), Object.keys(porCat).map(function (k) { return porCat[k]; }));
      var vViv = serie(V.viv), vPla = serie(V.plazas);
      var altas = serie(U.altas.m);
      var uN = esTodo() ? suma(CODS.map(function (c) { return (U.m[c] || {}).n; })) : (U.m[ambito] || {}).n;
      var uP = esTodo() ? suma(CODS.map(function (c) { return (U.m[c] || {}).plazas; })) : (U.m[ambito] || {}).plazas;
      var otros = O.tipos.map(function (_, i) {
        return esTodo() ? suma(CODS.map(function (c) { return (O.m[c] || [])[i]; })) : (O.m[ambito] || [])[i];
      });
      var rOtros = ranking(O.tipos, otros);
      var pl = plazasHot(ambito);

      var cards = [
        {
          titulo: 'Plazas hoteleras abiertas', sub: nombreAmbito() + ' · a 31 de diciembre de cada año',
          chips: [ANUAL], fuente: F_HOT, ancho: 'full',
          nota: 'Reconstruido con las fechas de alta y de baja de cada establecimiento en el registro.',
          spec: { type: 'area', xType: 'anual', x: H.evol.x.slice(desde), xLabel: 'Año', yFormat: 'num',
                  series: [{ name: 'Plazas hoteleras', data: evol.slice(desde) }] }
        },
        {
          titulo: 'Plazas por categoría', sub: 'Hoteles, hostales y pensiones en alta',
          chips: [DIARIO], fuente: F_HOT,
          spec: { type: 'donut', x: cat.x, yFormat: 'num', series: [{ name: 'Plazas', data: cat.v }] }
        }
      ];
      if (esTodo()) {
        var rh = ranking(CODS.map(function (c) { return NOM[c]; }), CODS.map(plazasHot));
        cards.push({
          titulo: 'Plazas hoteleras por municipio', sub: 'Establecimientos en alta',
          chips: [DIARIO], fuente: F_HOT, alto: 'tall',
          nota: 'Los municipios que no aparecen no tienen ningún establecimiento hotelero en alta.',
          spec: { type: 'barh', x: rh.x, xLabel: 'Municipio', yFormat: 'num', series: [{ name: 'Plazas', data: rh.v }] }
        });
      }
      cards.push({
        titulo: 'Viviendas turísticas anunciadas', sub: nombreAmbito() + ' · recuento del INE en plataformas digitales',
        chips: [SEMESTRAL], fuente: F_VTE, ancho: esTodo() ? null : 'full',
        nota: 'Desde 2025 el INE descuenta los anuncios sin número de registro, lo que explica parte del descenso.',
        spec: { type: 'line', xType: 'mes', x: V.x, yFormat: 'num', desdeCero: true,
                series: [{ name: 'Viviendas', data: vViv }, { name: 'Plazas', data: vPla }] }
      });
      cards.push({
        titulo: 'Altas de viviendas de uso turístico', sub: 'Viviendas hoy inscritas, por año de alta en el registro',
        chips: [DIARIO], fuente: F_VUT,
        nota: 'Solo cuenta las viviendas que siguen inscritas: las dadas de baja no figuran en el fichero.',
        spec: { type: 'bar', xType: 'anual', x: U.altas.x, xLabel: 'Año de alta', yFormat: 'num', series: [{ name: 'Altas', data: altas }] }
      });
      if (esTodo()) {
        var rp = ranking(CODS.map(function (c) { return NOM[c]; }), CODS.map(function (c) { return ult(V.pct[c] || []); }));
        cards.push({
          titulo: 'Peso de la vivienda turística', sub: 'Porcentaje sobre el total de viviendas del municipio, ' + Obs.periodo(ult(V.x), 'mes'),
          chips: [SEMESTRAL], fuente: F_VTE, alto: 'tall',
          spec: { type: 'barh', x: rp.x, xLabel: 'Municipio', yFormat: function (v) { return F.pct(v, 2); }, series: [{ name: '% de viviendas turísticas', data: rp.v }] }
        });
        var ru = ranking(CODS.map(function (c) { return NOM[c]; }), CODS.map(function (c) { return (U.m[c] || {}).n; }));
        cards.push({
          titulo: 'Viviendas de uso turístico registradas', sub: 'Inscritas en el Registro de Turismo',
          chips: [DIARIO], fuente: F_VUT, alto: 'tall',
          spec: { type: 'barh', x: ru.x, xLabel: 'Municipio', yFormat: 'num', series: [{ name: 'Viviendas', data: ru.v }] }
        });
      }
      if (rOtros.x.length) {
        cards.push({
          titulo: 'Otras empresas y alojamientos turísticos', sub: 'En alta en el Registro de Turismo',
          chips: [DIARIO], fuente: F_GVA,
          spec: { type: 'barh', x: rOtros.x, xLabel: 'Tipo', yFormat: 'num', series: [{ name: 'Establecimientos', data: rOtros.v }] }
        });
      }

      return {
        nota: !esTodo() && !hs.length ? '<b>' + Obs.esc(nombreAmbito()) + '</b> no tiene ningún establecimiento hotelero en alta en el Registro de Turismo.' : null,
        hero: { valor: pl, label: 'Plazas hoteleras en ' + nombreAmbito(),
          extra: [
            { label: 'Establecimientos hoteleros', valor: hs.length },
            { label: 'Viviendas de uso turístico registradas', valor: uN || 0 },
            { label: 'Plazas en viviendas registradas', valor: uP || 0 },
            { label: 'Viviendas anunciadas (INE, ' + Obs.periodo(ult(V.x), 'mes') + ')', valor: ult(vViv) }
          ] },
        cards: cards.filter(function (c) {
          return (c.spec.series || []).some(function (s) { return (s.data || []).some(function (v) { return v; }); });
        }),
        extra: tablaHoteles(hs)
      };
    }
  };

  /* ========================================================= 4. OCUPACIÓN */

  var secOcupacion = {
    id: 'ocupacion', nombre: 'Ocupación',
    titulo: 'Pernoctaciones y grado de ocupación · provincia de Valencia',
    desc: 'El INE solo publica ocupación hotelera para los municipios que declara «punto turístico», y ninguno de l’Horta Sud lo es. ' +
      'Lo que sigue es el dato de la provincia de Valencia: sirve de termómetro del mercado en el que compite la comarca, ' +
      'no como cifra propia de ningún municipio.',
    render: function () {
      var h = PR.hot, a = PR.apt;
      var sumar2 = function (p, q) { return (p || []).map(function (v, i) { return v == null && (q || [])[i] == null ? null : (v || 0) + ((q || [])[i] || 0); }); };
      var pern = sumar2(h.pern_res, h.pern_ext), viaj = sumar2(h.viajeros_res, h.viajeros_ext);
      var pernA = sumar2(a.pern_res, a.pern_ext);
      var pctF = function (v) { return F.pct(v); };
      return {
        nota: 'Dato <b>provincial</b>, no comarcal. Los últimos meses son provisionales y el INE los revisa.',
        notaTipo: 'warn',
        hero: { valor: ult(h.ocup), label: 'Grado de ocupación por plazas en hoteles, ' + Obs.periodo(ult(h.x), 'mes'), formato: pctF,
          extra: [
            { label: 'En fin de semana', valor: ult(h.ocup_fs), formato: pctF },
            { label: 'Por habitaciones', valor: ult(h.ocup_hab), formato: pctF },
            { label: 'En apartamentos turísticos (por plazas)', valor: ult(a.ocup), formato: pctF },
            { label: 'Estancia media en hoteles', valor: ult(h.estancia), formato: function (v) { return F.num(v, 2) + ' noches'; } }
          ] },
        kpis: [
          { label: 'Pernoctaciones hoteleras · ' + Obs.periodo(ult(h.x), 'mes'), valor: ult(pern), delta: varInt(pern), deltaRef: 'interanual', serie: pern.slice(-24) },
          { label: 'Pernoctaciones hoteleras · 12 meses', valor: ult12(pern), delta: delta12(pern), deltaRef: 'sobre los 12 anteriores', serie: pern.slice(-36) },
          { label: 'Viajeros en hoteles · ' + Obs.periodo(ult(h.x), 'mes'), valor: ult(viaj), delta: varInt(viaj), deltaRef: 'interanual', serie: viaj.slice(-24) },
          { label: 'Pernoctaciones en apartamentos · 12 meses', valor: ult12(pernA), delta: delta12(pernA), deltaRef: 'sobre los 12 anteriores', serie: pernA.slice(-36) }
        ],
        cards: [
          {
            titulo: 'Grado de ocupación en hoteles', sub: 'Provincia de Valencia · porcentaje',
            chips: [MENSUAL], fuente: F_EOH, ancho: 'full',
            spec: { type: 'line', xType: 'mes', x: h.x, yFormat: 'pct',
                    series: [{ name: 'Por plazas', data: h.ocup }, { name: 'Por plazas en fin de semana', data: h.ocup_fs }, { name: 'Por habitaciones', data: h.ocup_hab }] }
          },
          {
            titulo: 'Ocupación por plazas: el año, mes a mes', sub: 'Hoteles · cada línea es un año',
            chips: [MENSUAL], fuente: F_EOH,
            spec: { type: 'line', xType: 'cat', x: MESES, xTodas: true, xLabel: 'Mes', yFormat: 'pct', series: porMesDelAnio(h.x, h.ocup, 3) }
          },
          {
            titulo: 'Estancia media en hoteles', sub: 'Noches por viajero',
            chips: [MENSUAL], fuente: F_EOH,
            spec: { type: 'line', xType: 'mes', x: h.x, yFormat: 'dec1', series: [{ name: 'Estancia media', data: h.estancia }] }
          },
          {
            titulo: 'Pernoctaciones hoteleras', sub: 'Según residencia del viajero',
            chips: [MENSUAL], fuente: F_EOH, ancho: 'full',
            spec: { type: 'stack', xType: 'mes', x: h.x, yFormat: 'num',
                    series: [{ name: 'Residentes en España', data: h.pern_res }, { name: 'Residentes en el extranjero', data: h.pern_ext }] }
          },
          {
            titulo: 'Viajeros alojados en hoteles', sub: 'Según residencia',
            chips: [MENSUAL], fuente: F_EOH,
            spec: { type: 'line', xType: 'mes', x: h.x, yFormat: 'num',
                    series: [{ name: 'Residentes en España', data: h.viajeros_res }, { name: 'Residentes en el extranjero', data: h.viajeros_ext }] }
          },
          {
            titulo: 'Plazas hoteleras ofertadas', sub: 'Estimación mensual de la encuesta',
            chips: [MENSUAL], fuente: F_EOH,
            spec: { type: 'area', xType: 'mes', x: h.x, yFormat: 'num', series: [{ name: 'Plazas', data: h.plazas }] }
          },
          {
            titulo: 'Grado de ocupación en apartamentos turísticos', sub: 'Provincia de Valencia · porcentaje',
            chips: [MENSUAL], fuente: F_EOAP,
            spec: { type: 'line', xType: 'mes', x: a.x, yFormat: 'pct',
                    series: [{ name: 'Por plazas', data: a.ocup }, { name: 'Por apartamentos', data: a.ocup_apt }, { name: 'Por apartamentos en fin de semana', data: a.ocup_apt_fs }] }
          },
          {
            titulo: 'Pernoctaciones en apartamentos turísticos', sub: 'Según residencia del viajero',
            chips: [MENSUAL], fuente: F_EOAP,
            spec: { type: 'stack', xType: 'mes', x: a.x, yFormat: 'num',
                    series: [{ name: 'Residentes en España', data: a.pern_res }, { name: 'Residentes en el extranjero', data: a.pern_ext }] }
          }
        ]
      };
    }
  };

  /* ========================================================== 5. CONTEXTO */

  var secContexto = {
    id: 'contexto', nombre: 'Territorio',
    titulo: 'El territorio que recibe',
    desc: 'Población y paro registrado, para poner las cifras turísticas en proporción. El paro registrado del SEPE cuenta demandantes inscritos: ' +
      'no es la tasa de paro de la EPA y no se compara con ella.',
    render: function () {
      var pob = serie(P.m), par = serie(PA.m);
      var p0 = P.x.indexOf('2000');
      var cards = [
        {
          titulo: 'Población', sub: nombreAmbito() + ' · padrón a 1 de enero',
          chips: [ANUAL], fuente: F_PAD,
          spec: { type: 'line', xType: 'anual', x: P.x.slice(p0), xLabel: 'Año', yFormat: 'num', series: [{ name: 'Habitantes', data: pob.slice(p0) }] }
        },
        {
          titulo: 'Paro registrado', sub: nombreAmbito() + ' · demandantes inscritos a fin de mes',
          chips: [MENSUAL], fuente: F_SEPE,
          spec: { type: 'line', xType: 'mes', x: PA.x, yFormat: 'num', series: [{ name: 'Paro registrado', data: par }] }
        }
      ];
      if (esTodo()) {
        var rp = ranking(CODS.map(function (c) { return NOM[c]; }), CODS.map(pobUlt));
        var m = METRICAS.filter(function (x) { return x.id === 'int'; })[0];
        var ri = ranking(CODS.map(function (c) { return NOM[c]; }), CODS.map(m.val));
        cards.push({
          titulo: 'Habitantes por municipio', sub: 'Padrón de ' + ult(P.x),
          chips: [ANUAL], fuente: F_PAD, alto: 'tall',
          spec: { type: 'barh', x: rp.x, xLabel: 'Municipio', yFormat: 'num', series: [{ name: 'Habitantes', data: rp.v }] }
        });
        cards.push({
          titulo: 'Turistas por cada 1.000 habitantes', sub: 'Residentes en España más extranjeros, año ' + ANIO_COMUN,
          chips: [ANUAL], fuente: F_INT, alto: 'tall',
          nota: 'Mide la presión turística relativa: un municipio pequeño con hoteles junto al aeropuerto o a un polígono puede superar a los grandes.',
          spec: { type: 'barh', x: ri.x, xLabel: 'Municipio', yFormat: 'num', series: [{ name: 'Turistas por 1.000 hab.', data: ri.v.map(function (v) { return Math.round(v); }) }] }
        });
      }
      return {
        kpis: [
          { label: 'Habitantes (' + ult(P.x) + ')', valor: ult(pob), delta: pob.length > 1 ? (ult(pob) - pob[pob.length - 2]) / pob[pob.length - 2] * 100 : null, deltaRef: 'sobre el año anterior', serie: pob.slice(-15) },
          { label: 'Paro registrado · ' + Obs.periodo(ult(PA.x), 'mes'), valor: ult(par), delta: varInt(par), deltaRef: 'interanual', invertir: true, serie: par.slice(-24) }
        ],
        cards: cards
      };
    }
  };

  /* ============================================================= Arranque */

  var SECCIONES = [secMapa, secVisitantes, secAlojamiento, secOcupacion, secContexto];
  var caducas = {};

  function ponerAmbito(c) {
    ambito = c;
    var sel = document.getElementById('hs-ambito');
    if (sel) sel.value = c;
    SECCIONES.forEach(function (s) { if (s.id !== 'mapa' && s.id !== 'ocupacion') caducas[s.id] = true; });
    var activa = (location.hash || '').replace('#', '');
    if (caducas[activa]) { caducas[activa] = false; Obs.refrescar(activa); }
  }

  Obs.init({
    titulo: "Observatorio Turístico de l'Horta Sud",
    subtitulo: '20 municipios · datos oficiales del INE, la Generalitat Valenciana y el SEPE, recogidos automáticamente',
    secciones: SECCIONES,
    actualizado: (D.meta || {}).actualizado,
    controles: '<label class="obs-card-ctrl hs-ambito"><span>Ámbito</span><select class="obs-select" id="hs-ambito">' +
      '<option value="all">Toda la comarca (20 municipios)</option>' +
      MUN.map(function (m) { return '<option value="' + m.c + '">' + Obs.esc(m.n) + '</option>'; }).join('') +
      '</select></label>',
    fuentes: [F_INT, F_VTE, F_EOH, F_EOAP, F_GVA, F_PAD, F_SEPE],
    metodologia: 'Un proceso automático consulta cada día las API públicas del INE, del portal de datos abiertos de la Generalitat Valenciana y del SEPE, ' +
      'y regenera el fichero de datos. Cada gráfica enlaza a su fuente y permite ver la tabla y descargarla en CSV. ' +
      'Los turistas por municipio proceden de una estadística experimental del INE basada en la posición de los teléfonos móviles.',
    pie: 'Ejemplo elaborado para el curso «IA para acelerar la regeneración turística» (Plan de Formación Regenera l’Horta Sud 2026). ' +
      'No es una web oficial de la Mancomunitat. Los datos son de las fuentes citadas; su tratamiento, de este observatorio.'
  });

  document.getElementById('hs-ambito').addEventListener('change', function () { ponerAmbito(this.value); });
  document.querySelector('.obs-nav-in').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-sec]');
    if (!b) return;
    var id = b.getAttribute('data-sec');
    if (caducas[id]) { caducas[id] = false; Obs.refrescar(id); }
  });

  Obs.estado('Turistas por municipio hasta ' + Obs.periodo(ult(I.x), 'mes') +
    ' · ocupación provincial hasta ' + Obs.periodo(ult(PR.hot.x), 'mes'), 'live');

})();
