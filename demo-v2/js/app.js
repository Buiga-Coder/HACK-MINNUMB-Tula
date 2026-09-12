/* Портал ОКС Тульской области — демонстрационная сборка.
   Данные: window.TULA_DATA (см. js/data.js). Реестр импортирован из файла владельца проекта; качество данных указано в карточках. */
(function () {
  "use strict";
  var D = window.TULA_DATA;
  var DICT = D.dicts;
  var OKS = D.oks;
  var DISTRICTS = D.districts.features;
  var byId = {};
  OKS.forEach(function (o) { byId[o.id] = o; });
  var distById = {};
  DISTRICTS.forEach(function (f) { distById[f.properties.id] = f; });

  distById.unknown = {properties:{id:"unknown",name:"Муниципалитет не указан"}};

  /* ---------- утилиты ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(iso) { // ДД.ММ.ГГГГ (UX-02)
    if (!iso) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    return m[3] + "." + m[2] + "." + m[1];
  }
  function fmtMoney(v, cur) {
    if (v == null) return null;
    return v.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " " + (cur === "RUB" ? "₽" : cur);
  }
  function nd(v) { return (v === null || v === undefined || v === "") ? '<span class="nodata">Нет данных</span>' : esc(v); }
  function plural(n, a, b, c) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return b;
    return c;
  }

  /* ---------- состояние + URL (FR-05: без персональных данных) ---------- */
  var state = {
    fullMap: false,
    unmappedOnly: false,
    mode: "commissioned",           // commissioned | building | planned | all
    q: "",
    f: { sector: [], stage: [], status: [], ownership: [], district: [], year: [] },
    yearMode: "fact",               // fact | plan (FR-04)
    viewportOnly: false,
    sort: "name",
    page: 1,
    district: null,                 // выбранный муниципалитет (режим района)
    obj: null,
    layer: "none",                  // none | prov | sat
    provSector: "edu",
    scenario: "now",                // now | future (FR-20)
    view: "map"                     // map | methods | data | about-admin
  };
  var MODE_STATUSES = {
    commissioned: ["commissioned"],
    building: ["building", "paused", "done_no_commission"],
    planned: ["planned"],
    all: ["unknown", "planned", "building", "paused", "done_no_commission", "commissioned", "cancelled"]
  };

  var applyingUrl = false;
  function writeUrl() {
    if (applyingUrl) return;
    var p = [];
    if (state.view !== "map") p.push("view=" + state.view);
    if (state.mode !== "commissioned") p.push("m=" + state.mode);
    if (state.q) p.push("q=" + encodeURIComponent(state.q));
    ["sector", "stage", "status", "ownership", "district", "year"].forEach(function (k) {
      if (state.f[k].length) p.push(k + "=" + state.f[k].join(","));
    });
    if (state.yearMode !== "fact") p.push("ym=" + state.yearMode);
    if (state.district) p.push("d=" + state.district);
    if (state.fullMap) p.push("full=1");
    if (state.viewportOnly) p.push("vp=1");
    if (state.unmappedOnly) p.push("unmapped=1");
    if (state.obj) p.push("obj=" + state.obj);
    if (state.layer !== "none") p.push("layer=" + state.layer + (state.layer === "prov" ? ":" + state.provSector : ""));
    if (state.scenario !== "now") p.push("scen=" + state.scenario);
    if (state.sort !== "name") p.push("sort=" + state.sort);
    if (state.page !== 1) p.push("pg=" + state.page);
    if (map) {
      var c = map.getCenter();
      p.push("map=" + c.lat.toFixed(4) + "," + c.lng.toFixed(4) + "," + map.getZoom());
    }
    history.replaceState(null, "", "#" + p.join("&"));
  }
  function safeDecode(value) { try { return decodeURIComponent(value); } catch (_) { return ""; } }
  function hasCoordinates(o) { return Number.isFinite(o.lat) && Number.isFinite(o.lon); }
  function readUrl() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return null;
    var out = {};
    h.split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) out[kv.slice(0, i)] = safeDecode(kv.slice(i + 1));
    });
    return out;
  }

  /* ---------- фильтрация (FR-04: AND между фильтрами, OR внутри) ---------- */
  function yearOf(o) {
    return state.yearMode === "fact" ? o.yearCommissioned : o.yearPlanned;
  }
  function matches(o) {
    if (state.unmappedOnly && !o.geocoding) return false;
    if (MODE_STATUSES[state.mode].indexOf(o.status) < 0) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      if (o.name.toLowerCase().indexOf(q) < 0 && o.address.toLowerCase().indexOf(q) < 0) return false;
    }
    var f = state.f;
    if (f.sector.length && f.sector.indexOf(o.sector) < 0) return false;
    if (f.stage.length && f.stage.indexOf(o.stage) < 0) return false;
    if (f.status.length && f.status.indexOf(o.status) < 0) return false;
    if (f.ownership.length && f.ownership.indexOf(o.ownership) < 0) return false;
    if (f.district.length && f.district.indexOf(o.district) < 0) return false;
    if (f.year.length) {
      var y = yearOf(o);
      var key = (y == null) ? "unknown" : String(y);
      if (f.year.indexOf(key) < 0) return false;
    }
    if (state.district && o.district !== state.district) return false;
    if (state.viewportOnly && map) {
      if (!hasCoordinates(o) || !map.getBounds().contains([o.lat, o.lon])) return false;
    }
    return true;
  }
  function filtered() { return OKS.filter(matches); }

  /* ---------- карта ---------- */
  var map = null, shadowLayer = null, districtLayer = null, labelGroup = null,
      countGroup = null, markerGroup = null, isoGroup = null, poiGroup = null,
      groundLayer = null, streetLayerGroup = null, routeLayerGroup = null;
  var OBLAST_BOUNDS = null, schemeLayer, satelliteLayer, tileControl, maskLayer, ratingsLayer;
  var walkingMinutes = 10, walkingEnabled = true;

  function initMap() {
    map = L.map("map", { zoomControl: false, attributionControl: true, minZoom: 6, maxZoom: 19, zoomSnap:.25 });
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Границы: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · снимок 12.09.2026');
    schemeLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'});
    satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'&copy; Esri, Maxar, Earthstar Geographics'});
    tileControl = L.control.layers({'Схема':schemeLayer,'Спутник':satelliteLayer},{},{position:'bottomright'});
    [schemeLayer,satelliteLayer].forEach(function(layer) {
      layer.on('loading',function(){ $('#mapStatus').textContent='Загрузка подробной карты…'; $('#mapStatus').hidden=false; });
      layer.on('tileerror',function(){ $('#mapStatus').textContent='Подложка недоступна. Границы и объекты доступны. Проверьте соединение.'; $('#mapStatus').hidden=false; });
      layer.on('tileload',function(){ $('#mapStatus').hidden=true; });
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // панели рендера (снизу вверх): подложка МО → уличная схема → «плашки» муниципалитетов → подписи
    map.createPane("ground");      map.getPane("ground").style.zIndex = 345;
    map.createPane("streets");     map.getPane("streets").style.zIndex = 350;
    map.createPane("glassShadow"); map.getPane("glassShadow").style.zIndex = 355;
    map.createPane("glass");       map.getPane("glass").style.zIndex = 450;
    map.createPane("dlabels");     map.getPane("dlabels").style.zIndex = 620;
    map.getPane("dlabels").style.pointerEvents = "none";

    map.createPane('boundaryMask'); map.getPane('boundaryMask').style.zIndex=440; map.getPane('boundaryMask').style.pointerEvents='none';
    map.createPane('ratings'); map.getPane('ratings').style.zIndex=420; map.getPane('ratings').style.pointerEvents='none';
    maskLayer=L.layerGroup().addTo(map); ratingsLayer=L.layerGroup().addTo(map);
    // тень под «плашкой» муниципалитета
    shadowLayer = L.geoJSON(D.districts, {
      pane: "glassShadow", smoothFactor: 1.8,
      style: function () { return { color: "rgba(60,66,80,.30)", weight: 5, fill: false }; },
      interactive: false
    });

    districtLayer = L.geoJSON(D.districts, {
      pane: "glass", style: districtStyle, smoothFactor: 0.5,
      onEachFeature: function (f, layer) {
        layer.on("click", function (e) {
          if (reportPicking) return; // идёт выбор точки обращения
          if (state.layer !== "none") showAnalyticsPopup(f, e.latlng);
          if (state.district === f.properties.id) return; // уже внутри — клик по себе ничего не делает
          enterDistrict(f.properties.id);
        });
        layer.on("mouseover", function () { if (!state.district && state.layer === "none") layer.setStyle({ fillOpacity: 0.98, weight: 2.6 }); });
        layer.on("mouseout", function () { districtLayer.resetStyle(layer); });
        layer.bindTooltip(f.properties.name, { sticky: true, direction: "top" });
        layer.on('add',function(){ var path=layer.getElement(); path.setAttribute('role','button');path.setAttribute('tabindex','0');path.setAttribute('aria-label','Открыть '+f.properties.name);path.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();enterDistrict(f.properties.id);}}); });
      }
    }).addTo(map);
    OBLAST_BOUNDS = districtLayer.getBounds();
    map.fitBounds(OBLAST_BOUNDS.pad(0.03));

    labelGroup = L.layerGroup().addTo(map);
    DISTRICTS.forEach(function (f) {
      var p = f.properties;
      if (p.id === "slavny" || p.id === "novogurovsky") return; // малые ГО внутри районов: подпись — только tooltip
      labelGroup.addLayer(L.marker([p.labelLat, p.labelLon], {
        interactive: false, keyboard: false, pane: "dlabels",
        icon: L.divIcon({ className: "district-label", html: "<span>" + esc(p.name.replace(" (гор. округ)", "")) + "</span>", iconSize: [0, 0] })
      }));
    });

    groundLayer = L.layerGroup({ pane: "ground" }); streetLayerGroup = L.layerGroup({ pane: "streets" });
    countGroup = L.layerGroup().addTo(map);
    markerGroup = L.layerGroup().addTo(map);
    poiGroup = L.layerGroup().addTo(map);
    isoGroup = L.layerGroup().addTo(map);
    routeLayerGroup = L.layerGroup().addTo(map);

    map.on("zoomend", renderMarkers);
    map.on("moveend", function () {
      if (state.viewportOnly) {renderList();renderMarkers();}
      writeUrl();
    });
  }

  function setMapMode(mode) {
    var detail=mode==='tiles';
    map.getContainer().classList.toggle('mode-tiles',detail);
    map.getContainer().classList.toggle('mode-glass',!detail);
    if(detail) { if(!map.hasLayer(schemeLayer)&&!map.hasLayer(satelliteLayer)) schemeLayer.addTo(map);tileControl.addTo(map); }
    else {map.removeLayer(schemeLayer);map.removeLayer(satelliteLayer);tileControl.remove();$('#mapStatus').hidden=true;}
    $('#fullMap').checked=state.fullMap;
    updateMask();
  }
  function buildStreetFabric() { /* Compatibility entrypoint: real tiled basemap replaces procedural streets. */ }
  function updateMask() {
    maskLayer.clearLayers();
    if(state.fullMap)return;
    var fs=state.district ? DISTRICTS.filter(function(f){return f.properties.id===state.district;}) : DISTRICTS;
    var rings=[[[85,-540],[85,540],[-85,540],[-85,-540]]];
    fs.forEach(function(f){var ps=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;ps.forEach(function(p){p.forEach(function(r){rings.push(r.map(function(v){return [v[1],v[0]];}));});});});
    L.polygon(rings,{pane:'boundaryMask',interactive:false,stroke:false,fillColor:'#fff',fillOpacity:1,fillRule:'evenodd'}).addTo(maskLayer);
  }

  function districtStyle(f) {
    var active=state.district===f.properties.id;
    if(state.district && !active)return {color:'#a9bacb',weight:1.4,fillColor:'#fff',fillOpacity:1};
    if(state.layer!=='none')return {color:'#a9bacb',weight:1.4,fillColor:analyticsColor(f.properties.id).color,fillOpacity:(active||state.fullMap) ? .16 : .65};
    if(active||state.fullMap)return {color:active?'#3569a0':'#a9bacb',weight:active?3:1.4,fillOpacity:0};
    return {color:'#fff',weight:1.5,fillColor:f.properties.color,fillOpacity:.95};
  }
  function restyleDistricts() {
    districtLayer.eachLayer(function(l){l.setStyle(districtStyle(l.feature));});
    updateMask();
  }

  /* кластеризация-агрегация: на мелком масштабе — счётчики по районам (FR-03) */
  function renderMarkers() {
    countGroup.clearLayers();
    markerGroup.clearLayers();
    var list = filteredForMap().filter(hasCoordinates);
    var z = map.getZoom();
    if (!state.district && !state.fullMap) {
      var per = {};
      list.forEach(function (o) { per[o.district] = (per[o.district] || 0) + 1; });
      Object.keys(per).forEach(function (did) {
        var p = distById[did].properties;
        var m = L.marker([p.labelLat, p.labelLon], {
          keyboard: true, title: p.name + ": " + per[did] + " объект(ов)",
          icon: L.divIcon({ className: "district-count", html: '<div class="cnt" role="button" aria-label="' + esc(p.name) + ', объектов: ' + per[did] + '">' + per[did] + "</div>", iconSize: [0, 0] })
        });
        m.on("click", function () { enterDistrict(did); });
        countGroup.addLayer(m);
      });
      return;
    }
    var showHolo = state.district || z >= 10;
    // объекты соц-инфраструктуры видны на детальной карте постоянно;
    // объекты, не прошедшие текущий фильтр, показываются приглушённо
    var drawList = list, matchedIds = null;
    var hs = Math.max(0.30, Math.min(1.0, 0.30 + (z - 9) * 0.11)); // масштаб голограммы от зума
    var locations={};drawList.forEach(function(o){var key=o.lat+','+o.lon;(locations[key]||(locations[key]=[])).push(o);});
    var grouped={};
    Object.keys(locations).forEach(function(key){var items=locations[key];if(items.length<2)return;
      items.forEach(function(o){grouped[o.id]=true;});
      var approximate=items.some(function(o){return !!o.geocoding;});
      var marker=L.marker([items[0].lat,items[0].lon],{title:'Объектов в одной точке: '+items.length,icon:L.divIcon({className:'location-cluster',html:'<span>'+(approximate?'≈ ':'')+items.length+'</span>',iconSize:[42,36],iconAnchor:[21,18]})});
      marker.bindPopup('<b>'+(approximate?'Приблизительная общая точка':'Объекты в одной точке')+'</b><div class="grouped-objects">'+items.map(function(o){return '<button type="button" data-archive-object="'+esc(o.id)+'">'+esc(o.name)+'</button>';}).join('')+'</div>',{maxWidth:340});
      marker.on('popupopen',function(){map.getContainer().querySelectorAll('[data-archive-object]').forEach(function(button){button.addEventListener('click',function(){map.closePopup();openCard(button.dataset.archiveObject);});});});markerGroup.addLayer(marker);
    });
    drawList.forEach(function (o) {
      if(grouped[o.id])return;
      var sel = state.obj === o.id;
      var dim = matchedIds && !matchedIds[o.id];
      var html;
      if (showHolo) {
        html = '<div class="wrap" style="--hs:' + hs.toFixed(2) + '">' +
          '<div class="holo-fig" aria-hidden="true">' + holoSVG(o.sector) +
            '<div class="holo-base"></div><div class="holo-spark s1"></div><div class="holo-spark s2"></div><div class="holo-spark s3"></div></div>' +
          '<div class="holo-tag">' + (o.geocoding ? '≈ ' : '') + esc(o.typeLabel) + '</div>' +
          '<div class="beam" aria-hidden="true"></div><div class="dot" aria-hidden="true"></div></div>';
      } else {
        html = '<div class="wrap"><div class="dot"></div></div>';
      }
      var m = L.marker([o.lat, o.lon], {
        keyboard: true, title: (o.geocoding ? "≈ Требует проверки: " : "") + o.name,
        icon: L.divIcon({ className: "holo" + (o.geocoding ? " approximate" : "") + (sel ? " sel" : "") + (dim ? " dim" : ""), html: html, iconSize: [0, 0] })
      });
      m.on("click", function () { openCard(o.id); });
      markerGroup.addLayer(m);
    });
    renderPois();
  }

  /* ---------- существующие объекты соц. инфраструктуры: видны постоянно (как в Яндекс Картах) ---------- */
  function renderPois() {
    poiGroup.clearLayers();
    if (!state.district || !D.pois) return;
    D.pois.filter(function (p) { return p.district === state.district; }).forEach(function (p) {
      var m = L.marker([p.lat, p.lon], {
        keyboard: true, title: p.name + " (существующий объект)",
        icon: L.divIcon({ className: "poi-ic", html: '<div class="poi-dot"><span>' + p.icon + '</span></div>', iconSize: [0, 0] })
      });
      m.on("click", function () { onPoiClick(p, m); });
      poiGroup.addLayer(m);
    });
  }

  /* ---------- пешая доступность: клик по объекту строит маршрут, как в Яндекс Картах ---------- */
  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function pseudoRoute(a, b, seed) {
    // деталь-маршрут без реального графа улиц: 1–2 изгиба, детерминированные по паре id
    var r = mulberry(seed);
    var midLat = (a[0] + b[0]) / 2, midLon = (a[1] + b[1]) / 2;
    var dLat = b[0] - a[0], dLon = b[1] - a[1];
    var perpLat = -dLon, perpLon = dLat;
    var norm = Math.sqrt(perpLat * perpLat + perpLon * perpLon) || 1;
    var off = (r() - 0.5) * 0.35;
    var p1 = [midLat + (perpLat / norm) * off * Math.abs(dLat + dLon || 0.01) * 1.6,
              midLon + (perpLon / norm) * off * Math.abs(dLat + dLon || 0.01) * 1.6];
    return [a, p1, b];
  }
  function mulberry(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5; var x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedOf(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

  function drawRouteToPoi(o, p) {
    routeLayerGroup.clearLayers();
    var distM = haversine(o.lat, o.lon, p.lat, p.lon);
    var speedMh = 4800 / 60; // 4.8 км/ч → м/мин
    var minutes = Math.round(distM / speedMh);
    var pts = pseudoRoute([o.lat, o.lon], [p.lat, p.lon], seedOf(o.id + p.id));
    var color = minutes <= 10 ? "#3f8f52" : (minutes <= 15 ? "#b3872a" : "#a8604f");
    var line = L.polyline(pts, { color: color, weight: 4, opacity: .92, dashArray: "1 9", lineCap: "round" }).addTo(routeLayerGroup);
    L.circleMarker([o.lat, o.lon], { radius: 5, color: color, fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(routeLayerGroup);
    L.circleMarker([p.lat, p.lon], { radius: 5, color: color, fillColor: color, fillOpacity: 1, weight: 2 }).addTo(routeLayerGroup)
      .bindTooltip(p.name, { permanent: false });
    var mid = pts[1];
    L.marker(mid, {
      interactive: false, keyboard: false,
      icon: L.divIcon({ className: "route-eta", html: '<div class="route-eta-tag" style="--rc:' + color + '">≈ ' + minutes + ' мин пешком</div>', iconSize: [0, 0] })
    }).addTo(routeLayerGroup);
    map.fitBounds(L.latLngBounds(pts), { padding: [90, 90], maxZoom: 16 });
    return { minutes: minutes, distM: Math.round(distM) };
  }

  var lastRouteInfo = null;
  function onPoiClick(p) {
    if (!state.obj) {
      L.popup({ maxWidth: 240 }).setLatLng([p.lat, p.lon])
        .setContent('<div class="an-pop"><h4>' + esc(p.name) + '</h4><div class="mut">Существующий объект (не входит в реестр ОКС). Откройте карточку объекта ОКС и нажмите на этот значок ещё раз — будет построен пешеходный маршрут.</div></div>')
        .openOn(map);
      return;
    }
    var o = byId[state.obj]; if (!o) return;
    lastRouteInfo = drawRouteToPoi(o, p);
    lastRouteInfo.poiName = p.name;
    if (cardTab === "access") renderCard();
  }

  /* неоновый каркас-«голограмма» вида ОКС (изометрия, стиль референса) */
  var HOLO_CACHE = {};
  function holoSVG(sector) {
    if (HOLO_CACHE[sector]) return HOLO_CACHE[sector];
    function iso(x, y, z) { // изометрическая проекция
      return [60 + (x - y) * 0.866, 78 + (x + y) * 0.5 - z].map(function (v) { return Math.round(v * 10) / 10; });
    }
    function P(pts) { return pts.map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join(" "); }
    function box(cx, cy, w, d, h, floors, cols) { // каркасный параллелепипед с сеткой окон
      var x0 = cx - w / 2, y0 = cy - d / 2, x1 = cx + w / 2, y1 = cy + d / 2;
      var A = iso(x0, y0, 0), B = iso(x1, y0, 0), C = iso(x1, y1, 0), Dd = iso(x0, y1, 0);
      var A2 = iso(x0, y0, h), B2 = iso(x1, y0, h), C2 = iso(x1, y1, h), D2 = iso(x0, y1, h);
      var d1 = "";
      d1 += P([A, B, C, Dd, A]) + " " + P([A2, B2, C2, D2, A2]);
      d1 += " " + P([A, A2]) + " " + P([B, B2]) + " " + P([C, C2]) + " " + P([Dd, D2]);
      // окна на двух видимых гранях
      for (var f2 = 1; f2 < floors; f2++) {
        var z = h * f2 / floors;
        d1 += " " + P([iso(x0, y1, z), iso(x1, y1, z)]) + " " + P([iso(x1, y0, z), iso(x1, y1, z)]);
      }
      for (var c2 = 1; c2 < cols; c2++) {
        d1 += " " + P([iso(x0 + w * c2 / cols, y1, 0), iso(x0 + w * c2 / cols, y1, h)]);
        d1 += " " + P([iso(x1, y0 + d * c2 / cols, 0), iso(x1, y0 + d * c2 / cols, h)]);
      }
      return d1;
    }
    var body = "";
    if (sector === "housing") {           // композиция референса: башня + два малых блока
      body = box(0, 0, 26, 26, 62, 8, 3) + " " + box(-30, 26, 24, 22, 22, 2, 2) + " " + box(30, 24, 22, 20, 26, 3, 2);
    } else if (sector === "edu") {        // длинный корпус школы + флагшток
      body = box(0, 6, 56, 24, 26, 3, 5) + " " + box(-2, -18, 20, 16, 34, 3, 2) +
        " " + P([iso(24, -8, 34), iso(24, -8, 56)]) + " " + P([iso(24, -8, 56), iso(34, -8, 51), iso(24, -8, 46)]);
    } else if (sector === "health") {     // корпус с крестом
      body = box(0, 4, 40, 26, 40, 4, 3) +
        " " + P([iso(-6, 17, 22), iso(6, 17, 22)]) + " " + P([iso(0, 17, 16), iso(0, 17, 28)]);
    } else if (sector === "sport") {      // арена: кольцо из сегментов
      var ring = "";
      for (var a = 0; a < 360; a += 20) {
        var r1 = 30, r2 = 38, ra = a * Math.PI / 180, rb = (a + 20) * Math.PI / 180;
        ring += " " + P([iso(r1 * Math.cos(ra), r1 * Math.sin(ra), 0), iso(r2 * Math.cos(ra), r2 * Math.sin(ra), 14),
                         iso(r2 * Math.cos(rb), r2 * Math.sin(rb), 14), iso(r1 * Math.cos(rb), r1 * Math.sin(rb), 0)]);
      }
      body = ring;
    } else if (sector === "infra") {      // блок с трубой
      body = box(0, 6, 44, 26, 24, 2, 4) + " " + box(16, -6, 10, 10, 58, 5, 1);
    } else {                              // культура: портик с колоннами
      body = box(0, 6, 50, 26, 30, 2, 1);
      for (var cx = -18; cx <= 18; cx += 12) body += " " + P([iso(cx, 19, 0), iso(cx, 19, 24)]);
      body += " " + P([iso(-25, 19, 24), iso(0, 19, 38), iso(25, 19, 24), iso(-25, 19, 24)]);
    }
    var svg = '<svg class="holo-svg" viewBox="0 0 120 96" xmlns="http://www.w3.org/2000/svg">' +
      '<path class="hl-glow" d="' + body + '"/><path class="hl-line" d="' + body + '"/></svg>';
    HOLO_CACHE[sector] = svg;
    return svg;
  }

  function filteredForMap() { return filtered(); }
  function unusedFilteredForMap() {
    // карта и список — единый набор фильтров (FR-05); viewport-фильтр карту не режет
    var save = state.viewportOnly; state.viewportOnly = false;
    var res = filtered(); state.viewportOnly = save; return res;
  }

  function enterDistrict(id) {
    if(!distById[id] || id==="unknown")return;
    closeCard();state.fullMap=false;map.stop();
    state.district = id; state.page = 1;
    var f = distById[id];
    buildStreetFabric(id);
    setMapMode("tiles");
    map.removeLayer(labelGroup); // на детальной карте подписи районов не нужны
    restyleDistricts();
    var lb = L.geoJSON(f).getBounds();
    map.flyToBounds(lb,{padding:[35,100],duration:.6,animate:!matchMedia("(prefers-reduced-motion: reduce)").matches}); // анимация приближения
    $("#crumb").style.display = "flex";
    $("#crumbName").textContent = f.properties.name;
    renderAll();
  }
  function exitDistrict(fit) {
    closeCard();state.fullMap=false;map.stop();
    state.district = null; state.page = 1;
    $("#crumb").style.display = "none";
    setMapMode("glass");
    if (!map.hasLayer(labelGroup)) labelGroup.addTo(map);
    restyleDistricts();
    if (fit !== false) map.flyToBounds(OBLAST_BOUNDS.pad(0.03), { duration: 0.6, animate:!matchMedia("(prefers-reduced-motion: reduce)").matches });
    renderAll();
  }

  /* ---------- аналитические слои (FR-06, FR-17–FR-20, FR-24–FR-26) ---------- */
  function provisionValue(did) {
    var da = D.analytics[did]; var a = da && da[state.provSector];
    if (!a) return null;
    var v = a.provisionPct;
    if (state.scenario === "future") {
      var add = 0;
      OKS.forEach(function (o) {
        if (o.district === did && o.sector === state.provSector &&
            (o.status === "planned" || o.status === "building" || o.status === "paused" || o.status === "done_no_commission")) {
          add += o.capacity || 0;
        }
      });
      if (a.capacity == null && !add) return null;
      var cap = (a.capacity || 0) + add;
      v = Math.round((cap / (da.population / 1000)) / a.normPer1000 * 100);
    }
    return v == null ? null : v;
  }
  function analyticsColor(did) {
    if (state.layer === "prov") {
      var v = provisionValue(did);
      if (v == null) return { color: "#b9c2c9", label: "Нет данных / несопоставимо" };
      if (v < 85) return { color: "#c0564a", label: "Пониженная обеспеченность (<85%)" };
      if (v <= 115) return { color: "#4f8f5f", label: "Нормальная обеспеченность (85–115%)" };
      return { color: "#d9a94a", label: "Повышенная обеспеченность (>115%)" };
    }
    if (state.layer === "sat") {
      var s = D.analytics[did] && D.analytics[did].satisfaction;
      if (!s || s.index == null) return { color: "#b9c2c9", label: s && s.suppressed ? "Скрыто: менее 10 оценок" : "Нет данных об удовлетворённости" };
      if (s.index < 3.5) return { color: "#c0564a", label: "Индекс ниже 3,5" };
      if (s.index < 4.2) return { color: "#d9a94a", label: "Индекс 3,5–4,2" };
      return { color: "#4f8f5f", label: "Индекс выше 4,2" };
    }
    return { color: "#b9c2c9" };
  }
  function renderLegend() {
    var lg = $("#legend");
    lg.style.display = "";
    if (state.layer === "none") {
      var rows = DISTRICTS.slice(0, 0); // муниципальная раскраска — сводная строка
      lg.innerHTML = ""; lg.style.display = "none";
      return;
    }
    if (state.layer === "prov") {
      lg.innerHTML = "<h4>Обеспеченность: " + esc(DICT.sectors[state.provSector]) + "</h4>" +
        legendRow("#c0564a", "Пониженная (<85% нормы)") +
        legendRow("#4f8f5f", "Нормальная (85–115%)") +
        legendRow("#d9a94a", "Повышенная (>115%)") +
        legendRow("#b9c2c9", "Нет данных / несопоставимо") +
        '<div class="legend-note">Для расчёта не предоставлены население, нормы и полные мощности. Нет данных об обеспеченности' +
        (state.scenario === "future" ? " · Сценарий: с учётом планируемых объектов, население — текущее (демо-сценарий)" : " · Сценарий: сейчас") +
        "<br>«Повышенная обеспеченность» не означает повышенную нагрузку.</div>";
      return;
    }
    lg.innerHTML = "<h4>Удовлетворённость ответами (ПОС)</h4>" +
      legendRow("#c0564a", "Индекс ниже 3,5") +
      legendRow("#d9a94a", "Индекс 3,5–4,2") +
      legendRow("#4f8f5f", "Индекс выше 4,2") +
      legendRow("#b9c2c9", "Нет данных или менее 10 оценок") +
      '<div class="legend-note">Оценки ответов граждан не предоставлены. Нет данных об удовлетворённости. Интерполяция между районами не выполняется.</div>';
  }
  function legendRow(c, t) {
    return '<div class="legend-row"><span class="legend-sw" style="background:' + c + '"></span><span>' + esc(t) + "</span></div>";
  }
  function showAnalyticsPopup(f, latlng) {
    var did = f.properties.id, html = "";
    if (state.layer === "prov") {
      var a = D.analytics[did] && D.analytics[did][state.provSector];
      if (!a) {
        L.popup({ maxWidth: 300 }).setLatLng(latlng).setContent('<div class="an-pop"><h4>' + esc(f.properties.name) + '</h4><div class="mut">Нет данных по выбранной отрасли: исходные показатели не опубликованы или несопоставимы.</div></div>').openOn(map);
        return;
      }
      var v = provisionValue(did);
      var da = D.analytics[did];
      html = '<div class="an-pop"><h4>' + esc(f.properties.name) + "</h4><table>" +
        "<tr><td class=\"mut\">Отрасль</td><td>" + esc(DICT.sectors[state.provSector]) + "</td></tr>" +
        "<tr><td class=\"mut\">Мощность действующих</td><td>" + (a.capacity != null ? a.capacity : "Нет данных") + "</td></tr>" +
        "<tr><td class=\"mut\">Население</td><td>" + da.population.toLocaleString("ru-RU") + " чел. (" + esc(da.populationSource) + ")</td></tr>" +
        "<tr><td class=\"mut\">Плотность</td><td>" + da.density + " чел./км² · площадь " + da.areaKm2 + " км²</td></tr>" +
        "<tr><td class=\"mut\">Норма</td><td>" + a.normPer1000 + " ед. на 1000 жителей</td></tr>" +
        "<tr><td class=\"mut\">Показатель</td><td><b>" + (v == null ? "Нет данных" : v + "% нормы") + "</b></td></tr>" +
        "<tr><td class=\"mut\">Период</td><td>" + esc(a.period) + "</td></tr>" +
        "<tr><td class=\"mut\">Качество данных</td><td>демонстрационные</td></tr>" +
        "</table><div class=\"mut\" style=\"margin-top:5px\">Формула: мощность / (население/1000) / норма × 100%. Показатель приведён вместе с плотностью населения муниципалитета.</div></div>";
    } else if (state.layer === "sat") {
      var s = D.analytics[did] && D.analytics[did].satisfaction;
      if(!s){L.popup().setLatLng(latlng).setContent('<b>'+esc(f.properties.name)+'</b><p>В архиве нет оценок ответов граждан. Нет данных об удовлетворённости.</p>').openOn(map);return;}
      html = '<div class="an-pop"><h4>' + esc(f.properties.name) + "</h4><table>" +
        "<tr><td class=\"mut\">Индекс</td><td><b>" + (s.index != null ? s.index.toFixed(2) : (s.suppressed ? "Скрыт (n<10)" : "Нет данных об удовлетворённости")) + "</b></td></tr>" +
        "<tr><td class=\"mut\">Оценённых ответов</td><td>" + s.nRated + "</td></tr>" +
        "<tr><td class=\"mut\">Доступно для оценки</td><td>" + s.nAvailable + "</td></tr>" +
        "<tr><td class=\"mut\">Доля участия</td><td>" + s.participation + "%</td></tr>" +
        "<tr><td class=\"mut\">Период</td><td>" + esc(s.period) + "</td></tr>" +
        "<tr><td class=\"mut\">Методика</td><td>" + esc(s.methodVersion) + "</td></tr>" +
        "</table><div class=\"mut\" style=\"margin-top:5px\">Публикация агрегата — от 10 оценок (проектный минимум).</div></div>";
    }
    L.popup({ maxWidth: 300 }).setLatLng(latlng).setContent(html).openOn(map);
  }
  function setLayer(layer) {
    state.layer = layer;
    if (layer !== "none") {
      closeCard(); state.fullMap=false; state.district = null; $("#crumb").style.display = "none";
      setMapMode("glass");
      if (!map.hasLayer(labelGroup)) labelGroup.addTo(map);
      map.flyToBounds(OBLAST_BOUNDS.pad(0.03), { duration: 0.6 });
    }
    // FR-06: одновременно не более одного цветового аналитического слоя
    restyleDistricts(); renderLegend(); renderAll(); writeUrl();
    $("#scenarioRow").style.display = (layer === "prov") ? "flex" : "none";
    $("#provSectorRow").style.display = (layer === "prov") ? "block" : "none";
  }

  /* ---------- фильтры UI ---------- */
  var FILTER_DEFS = [
    { key: "sector", label: "Отрасль", items: function () { return DICT.sectors; } },
    { key: "stage", label: "Этап", items: function () { return DICT.stages; } },
    { key: "status", label: "Статус", items: function () { return DICT.statuses; } },
    { key: "ownership", label: "Собственность", items: function () { return DICT.ownership; } },
    { key: "district", label: "Муниципалитет / АМО", items: function () {
        var o = {unknown:"Муниципалитет не указан"}; DISTRICTS.forEach(function (f) { o[f.properties.id] = f.properties.name; }); return o;
      }, note: "Географическая территория определяется по координатам; исходное АМО и расхождения сохранены в карточке." },
    { key: "year", label: "Год", items: function () {
        var ys = {}; OKS.forEach(function (o) {
          var y = yearOf(o);
          ys[y == null ? "unknown" : String(y)] = y == null ? "Год неизвестен" : String(y);
        });
        var keys = Object.keys(ys).sort(function (a, b) {
          if (a === "unknown") return 1; if (b === "unknown") return -1; return a < b ? 1 : -1;
        });
        var out = {}; keys.forEach(function (k) { out[k] = ys[k]; }); return out;
      }, yearMode: true }
  ];
  function buildFilters() {
    var host = $("#filters"); host.innerHTML = "";
    FILTER_DEFS.forEach(function (def) {
      var d = el("details");
      var items = def.items();
      var active = state.f[def.key].length;
      var sum = el("summary", { text: def.label + (active ? " · " + active : "") });
      if (active) sum.classList.add("active");
      d.appendChild(sum);
      var menu = el("div", { class: "fmenu", role: "group", "aria-label": "Фильтр: " + def.label });
      if (def.yearMode) {
        var ym = el("div", { class: "year-mode", role: "radiogroup", "aria-label": "Режим года" });
        [["fact", "Фактический ввод"], ["plan", "Плановое окончание"]].forEach(function (pair) {
          var lab = el("label");
          var r = el("input", { type: "radio", name: "yearMode", value: pair[0] });
          r.checked = state.yearMode === pair[0];
          r.addEventListener("change", function () {
            state.yearMode = pair[0]; state.f.year = []; state.page = 1; buildFilters(); renderAll(); writeUrl();
          });
          lab.appendChild(r); lab.appendChild(document.createTextNode(" " + pair[1]));
          ym.appendChild(lab);
        });
        menu.appendChild(ym);
      }
      if (def.note) menu.appendChild(el("div", { class: "fmenu-head", text: def.note }));
      Object.keys(items).forEach(function (k) {
        var lab = el("label");
        var cb = el("input", { type: "checkbox", value: k });
        cb.checked = state.f[def.key].indexOf(k) >= 0;
        cb.addEventListener("change", function () {
          var arr = state.f[def.key];
          if (cb.checked) arr.push(k); else arr.splice(arr.indexOf(k), 1);
          state.page = 1; renderAll(); writeUrl();
          sum.textContent = def.label + (arr.length ? " · " + arr.length : "");
          sum.classList.toggle("active", !!arr.length);
        });
        lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + items[k]));
        menu.appendChild(lab);
      });
      d.appendChild(menu);
      host.appendChild(d);
    });
    document.addEventListener("click", function (e) {
      $$("details", host).forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute("open"); });
    });
  }
  function renderChips() {
    var host = $("#chips"); host.innerHTML = "";
    var any = false;
    FILTER_DEFS.forEach(function (def) {
      var items = def.items();
      state.f[def.key].forEach(function (k) {
        any = true;
        var ch = el("span", { class: "chip" });
        ch.appendChild(document.createTextNode(items[k] || k));
        ch.appendChild(el("button", {
          type: "button", "aria-label": "Убрать фильтр: " + (items[k] || k), text: "✕",
          onclick: function () {
            var arr = state.f[def.key]; arr.splice(arr.indexOf(k), 1);
            state.page = 1; buildFilters(); renderAll(); writeUrl();
          }
        }));
        host.appendChild(ch);
      });
    });
    if (state.q) {
      any = true;
      var ch = el("span", { class: "chip" });
      ch.appendChild(document.createTextNode("Поиск: " + state.q));
      ch.appendChild(el("button", { type: "button", "aria-label": "Очистить поиск", text: "✕", onclick: function () {
        state.q = ""; $("#searchInput").value = ""; state.page = 1; renderAll(); writeUrl();
      }}));
      host.appendChild(ch);
    }
    $("#clearAll").style.display = any ? "inline-block" : "none";
  }
  function clearAllFilters() {
    state.q = ""; $("#searchInput").value = "";
    Object.keys(state.f).forEach(function (k) { state.f[k] = []; });
    state.page = 1; buildFilters(); renderAll(); writeUrl();
  }

  /* ---------- список (FR-05) ---------- */
  var PAGE_SIZE = 10;
  function renderList() {
    var list = filtered();
    var host = $("#objList"); host.innerHTML = "";
    $("#resultCount").textContent = list.length + " " + plural(list.length, "объект", "объекта", "объектов");
    list.sort(function (a, b) {
      if (state.sort === "name") return a.name.localeCompare(b.name, "ru");
      var ya = yearOf(a), yb = yearOf(b);
      if (ya == null && yb == null) return a.name.localeCompare(b.name, "ru");
      if (ya == null) return 1; if (yb == null) return -1;
      return yb - ya;
    });
    if (!list.length) {
      host.appendChild(el("div", { class: "empty-state" }, [
        el("p", { text: "По заданным условиям объекты не найдены." }),
        el("button", { class: "btn", type: "button", text: "Сбросить фильтры", onclick: clearAllFilters })
      ]));
      $("#pager").innerHTML = "";
      return;
    }
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var slice = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    slice.forEach(function (o) {
      var li = el("li");
      var it = el("button", { class: "obj-item" + (state.obj === o.id ? " current" : ""), type: "button" });
      it.style.width = "100%"; it.style.textAlign = "left";
      var y = yearOf(o);
      it.innerHTML = "<span class=\"t\">" + esc(o.name) + "</span>" +
        '<div class="obj-meta">' + esc(distById[o.district].properties.name) + " · " + esc(DICT.sectors[o.sector]) +
        (y != null ? " · " + y : " · год не определён") + "</div>" +
        '<div style="margin-top:4px"><span class="badge badge-status-' + o.status + '">' + esc(DICT.statuses[o.status]) + "</span> " +
        '<span class="badge-source">Архив</span></div>';
      it.addEventListener("click", function () { openCard(o.id, true); });
      li.appendChild(it); host.appendChild(li);
    });
    var pg = $("#pager"); pg.innerHTML = "";
    if (pages > 1) {
      pg.appendChild(el("button", { class: "btn", type: "button", text: "‹", "aria-label": "Предыдущая страница", onclick: function () { if (state.page > 1) { state.page--; renderList(); writeUrl(); } } }));
      pg.appendChild(el("span", { class: "cur", text: "стр. " + state.page + " из " + pages }));
      pg.appendChild(el("button", { class: "btn", type: "button", text: "›", "aria-label": "Следующая страница", onclick: function () { if (state.page < pages) { state.page++; renderList(); writeUrl(); } } }));
    }
  }

  function renderAll() {
    renderChips(); renderList(); renderMarkers(); restyleDistricts(); renderLegend();
  }

  /* ---------- SVG-заглушки материалов (демо) ---------- */
  function mediaSVG(m, o) {
    var w = 640, h = 360;
    var sky, ground, scene;
    var label = m.kind === "render" ? "ПРОЕКТНЫЙ ВИД" : (m.kind === "satellite" ? "СПУТНИКОВЫЙ СНИМОК" :
      (m.kind === "camera" ? "КАМЕРА ПОДРЯДЧИКА (демо)" : (m.type === "after" ? "ФАКТИЧЕСКИЙ ВИД" : "ФОТОФИКСАЦИЯ")));
    if (m.kind === "satellite") {
      scene = '<rect width="640" height="360" fill="#5c7047"/>' +
        '<rect x="0" y="0" width="640" height="360" fill="url(#g1)" opacity=".5"/>' +
        '<path d="M0 200 Q160 160 320 210 T640 190" stroke="#3f5533" stroke-width="26" fill="none" opacity=".8"/>' +
        '<rect x="240" y="120" width="180" height="130" fill="none" stroke="#e8e2c8" stroke-width="3" stroke-dasharray="9 6"/>' +
        '<text x="330" y="112" fill="#f2efdd" font-size="15" text-anchor="middle" font-family="PT Sans,sans-serif">участок будущего объекта</text>';
    } else if (m.type === "progress") {
      var phase = /фундамент/i.test(m.caption) ? 1 : (/коробк/i.test(m.caption) ? 2 : 3);
      sky = '<rect width="640" height="360" fill="#a9c3d4"/>';
      ground = '<rect y="290" width="640" height="70" fill="#6f6250"/>';
      var bld = "";
      if (phase >= 1) bld += '<rect x="200" y="268" width="240" height="24" fill="#8f8f8f"/>';
      if (phase >= 2) bld += '<rect x="210" y="150" width="220" height="120" fill="#c8c2b4" stroke="#8d8778"/>' +
        '<g fill="#7d90a0">' + [0,1,2].map(function(r){return [0,1,2,3].map(function(c){return '<rect x="'+(226+c*52)+'" y="'+(164+r*36)+'" width="30" height="22"/>';}).join("");}).join("") + "</g>";
      if (phase >= 3) bld += '<rect x="210" y="138" width="220" height="14" fill="#9a5f34"/><rect x="180" y="300" width="300" height="6" fill="#4f8f5f"/>';
      var crane = '<g stroke="#c9a13d" stroke-width="6" fill="none"><path d="M120 292 L120 80 L360 80"/><path d="M120 80 L96 116"/><line x1="300" y1="80" x2="300" y2="130" stroke-width="3"/><rect x="288" y="130" width="24" height="18" fill="#c9a13d" stroke="none"/></g>';
      scene = sky + ground + bld + (phase < 3 ? crane : "");
    } else if (m.type === "after" && m.kind === "render") {
      scene = '<rect width="640" height="360" fill="#20364a"/>' +
        '<rect x="150" y="110" width="340" height="170" fill="#3d6a8f" stroke="#9fd4ff" stroke-width="2"/>' +
        '<g fill="#bfe6ff" opacity=".85">' + [0,1,2].map(function(r){return [0,1,2,3,4].map(function(c){return '<rect x="'+(166+c*64)+'" y="'+(126+r*48)+'" width="40" height="30"/>';}).join("");}).join("") + "</g>" +
        '<line x1="120" y1="282" x2="520" y2="282" stroke="#9fd4ff" stroke-width="2"/>' +
        '<text x="320" y="330" fill="#9fd4ff" font-size="14" text-anchor="middle" font-family="PT Sans,sans-serif">архитектурная визуализация · не является фотографией</text>';
    } else { // after / photo
      scene = '<rect width="640" height="360" fill="#bcd3e0"/>' +
        '<rect y="290" width="640" height="70" fill="#5f7a52"/>' +
        '<rect x="170" y="120" width="300" height="170" fill="#e2d9c6" stroke="#b3a888"/>' +
        '<rect x="170" y="106" width="300" height="16" fill="#9a5f34"/>' +
        '<g fill="#5f7f9e">' + [0,1,2].map(function(r){return [0,1,2,3].map(function(c){return '<rect x="'+(190+c*70)+'" y="'+(136+r*46)+'" width="44" height="30"/>';}).join("");}).join("") + "</g>" +
        '<rect x="300" y="240" width="46" height="50" fill="#6b4a2f"/>' +
        '<circle cx="120" cy="250" r="26" fill="#4f8f5f"/><rect x="116" y="266" width="8" height="26" fill="#5c4632"/>';
    }
    var dateTxt = m.date ? fmtDate(m.date) : "дата не установлена";
    return '<svg viewBox="0 0 640 360" role="img" aria-label="' + esc(m.caption) + ", " + esc(dateTxt) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d8352"/><stop offset="1" stop-color="#4c6238"/></linearGradient></defs>' +
      scene +
      '<rect x="0" y="0" width="640" height="30" fill="rgba(16,26,34,.78)"/>' +
      '<text x="12" y="20" fill="#ffd98a" font-size="14" font-family="PT Sans,sans-serif" font-weight="bold">' + label + "</text>" +
      '<text x="628" y="20" fill="#d7e4ec" font-size="14" text-anchor="end" font-family="PT Sans,sans-serif">' + esc(dateTxt) + "</text>" +
      '<text x="12" y="352" fill="rgba(255,255,255,.8)" font-size="12" font-family="PT Sans,sans-serif">демонстрационное изображение</text>' +
      "</svg>";
  }



  function mediaHTML(m, o) {
    if (!m.src) return mediaSVG(m, o);
    var label = m.kind === "camera" ? "КАМЕРА ПОДРЯДЧИКА (демо)" : (m.type === "after" ? "ФАКТИЧЕСКИЙ ВИД" : (m.type === "before" ? "ФОТО ДО НАЧАЛА РАБОТ" : "ФОТОФИКСАЦИЯ"));
    var fallback = mediaSVG(m, o).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    return '<div class="photo-wrap">' +
      '<img class="media-photo" loading="lazy" src="' + esc(m.src) + '" alt="' + esc(m.caption) + '" ' +
        'onerror="this.parentNode.classList.add(&#39;ph-fb&#39;);this.outerHTML=this.dataset.fb" data-fb="' + fallback + '">' +
      '<span class="photo-label">' + label + '</span>' +
      '<span class="photo-date">' + esc(m.date ? fmtDate(m.date) : "") + '</span>' +
      (m.note ? '<span class="photo-note">' + esc(m.note) + '</span>' : '') +
      '</div>';
  }
  function mediaCredit(m) {
    if (!m.credit) return "";
    return '<div class="photo-credit">' + esc(m.credit) +
      ' · <a href="' + esc(m.licUrl || m.page) + '" target="_blank" rel="noopener">' + esc(m.license || "лицензия") + '</a>' +
      (m.page ? ' · <a href="' + esc(m.page) + '" target="_blank" rel="noopener">страница файла</a>' : "") + "</div>";
  }

  function flyToVisible(latlng, zoom, dur) {
    var panelOpen = $("#cardPanel").classList.contains("open");
    var z = (zoom != null) ? zoom : map.getZoom();
    if (!panelOpen || window.innerWidth < 900) { map.flyTo(latlng, z, { duration: dur || 0.7 }); return; }
    var overlap = Math.min(560, window.innerWidth) / 2;
    var pt = map.project(L.latLng(latlng), z).add([overlap, 0]);
    map.flyTo(map.unproject(pt, z), z, { duration: dur || 0.7 });
  }

  /* ---------- карточка ОКС ---------- */
  var cardTab = "overview";
  var lastFocus = null;
  function openCard(id, keepMapView) {
    var o = byId[id];
    if (!o) return;
    stopPlay();isoGroup.clearLayers();routeLayerGroup.clearLayers();reportPoint=null;reportPicking=false;
    state.obj = id; cardTab = "overview";
    lastFocus = document.activeElement;
    if (!keepMapView) { /* открытие по ссылке */ }
    if (o.district!=="unknown" && state.district !== o.district) {
      state.fullMap=false;
      state.district = o.district;
      buildStreetFabric(o.district);
      setMapMode("tiles"); if (map.hasLayer(labelGroup)) map.removeLayer(labelGroup);
      restyleDistricts();
      $("#crumb").style.display = "flex"; $("#crumbName").textContent = distById[o.district].properties.name;
    }
    $("#cardPanel").classList.add("open");
    if(hasCoordinates(o))flyToVisible([o.lat, o.lon],Math.max(map.getZoom(),13),.7);
    renderCard(); renderAll(); writeUrl();
    var panel = $("#cardPanel");
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    setTimeout(function () { $("#cardClose").focus(); }, 60);
  }
  function closeCard() {
    state.obj = null;isoGroup.clearLayers();reportPicking=false;reportPoint=null;map.getContainer().style.cursor="";
    routeLayerGroup.clearLayers(); lastRouteInfo = null;
    stopPlay();
    var panel = $("#cardPanel");
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    renderAll(); writeUrl();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function switchTab(t) {
    cardTab = t; stopPlay();isoGroup.clearLayers();
    renderCard();
  }
  function renderCard() {
    var o = byId[state.obj]; if (!o) return;
    $("#cardTitle").textContent = o.name;
    $$(".card-tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.tab === cardTab ? "true" : "false");
    });
    var body = $("#cardBody"); body.innerHTML = "";
    ({ overview: tabOverview, media: tabMedia, access: tabAccess, procure: tabProcure, report: tabReport })[cardTab](o, body);
  }

  function tabOverview(o, body) {
    var y = o.yearCommissioned;
    var kv = el("dl", { class: "kv" });
    function row(k, vHtml) {
      kv.appendChild(el("dt", { text: k }));
      kv.appendChild(el("dd", { html: vHtml }));
    }
    row("Наименование", esc(o.name));
    row("Этап строительства (источник)", nd(o.rawStage));
    row("Статус", '<span class="badge badge-status-' + o.status + '">' + esc(DICT.statuses[o.status]) + "</span>");
    row("Адрес", esc(o.address) + ' <button class="btn btn-ghost" type="button" id="showOnMap" style="padding:2px 8px;font-size:12.5px">показать на карте</button>');
    row("Отрасль (источник)", nd(o.rawSector === "0" ? null : o.rawSector));
    row("Форма собственности", esc(DICT.ownership[o.ownership]));
    row("Муниципалитет", esc(distById[o.district].properties.name));
    row("АМО", nd(o.amo) + '<div class="nodata" style="font-style:normal;font-size:12.5px">' + esc(o.amoNote) + "</div>");
    row("Заказчик", nd(o.customer));
    row("Подрядчик", nd(o.contractor));
    row("Год ввода (факт)", y != null ? String(y) : '<span class="nodata">Нет данных — ввод не подтверждён</span>');
    row("Плановое окончание работ", nd(o.yearPlanned));
    row("Мощность", o.capacity != null ? esc(o.capacity + " " + o.capacityUnit) : nd(null));
    row("Доступность для маломобильных посетителей", nd(o.accessibility === "Нет данных" ? null : o.accessibility));
    row("Источник сведений", esc(o.source.name));
    row("Дата сведений", nd(fmtDate(o.source.dataDate)));
    row("Обновлено в реестре", nd(fmtDate(o.source.updated)));
    row('Статус в исходном файле',nd(o.rawStatus));
    row('Координаты источника',o.sourceCoordinates.lat!==null?esc(o.sourceCoordinates.lat+', '+o.sourceCoordinates.lon):nd(null));
    if(o.geocoding){row('Приблизительная точка для демонстрации',esc(o.lat+', '+o.lon));row('Точность и проверка',esc(o.geocoding.precision+' · требуется проверка'));row('Источник подобранной точки','<a target="_blank" rel="noopener" href="'+esc(o.geocoding.url)+'">'+esc(o.geocoding.displayName)+'</a>');}
    body.appendChild(kv);
    (o.qualityWarnings||[]).forEach(function(w){body.appendChild(el('div',{class:'notice notice-warn',text:w}));});
    var raw=el('details',{class:'card-sec'},[el('summary',{text:'Все поля исходного архива'})]);
    var rawList=el('dl',{class:'kv'});(o.archiveFields||[]).forEach(function(f){rawList.appendChild(el('dt',{text:f.name}));rawList.appendChild(el('dd',{text:f.value||'Не указано'}));});raw.appendChild(rawList);body.appendChild(raw);
    if (o.status === "done_no_commission") {
      body.appendChild(el("div", { class: "notice notice-warn", text: "Работы завершены, но объект не введён в эксплуатацию. Завершение работ не приравнивается к вводу." }));
    }
    body.appendChild(el("div", { class: "card-sec" }, [
      el("h3", { text: "Описание" }),
      el("p", { text: o.description })
    ]));
    body.appendChild(el("div", { class: "notice notice-info", html: "Постоянная ссылка на карточку: <code id=\"permaCode\" style=\"word-break:break-all\"></code> <button class=\"btn\" type=\"button\" id=\"copyPerma\" style=\"margin-left:6px\">Скопировать</button>" }));
    var url = location.origin === "null" || location.protocol === "file:" ? location.pathname + "#obj=" + o.id : location.href.split("#")[0] + "#obj=" + o.id;
    $("#permaCode").textContent = url;
    $("#copyPerma").addEventListener("click", function () { copyText(url, this); });
    var so = $("#showOnMap");
    if(so && !hasCoordinates(o)){so.disabled=true;so.textContent="Нет координат";}
    if (so) so.addEventListener("click", function () { flyToVisible([o.lat, o.lon], 14, 0.6); });
  }

  /* --- «До / В процессе / После» + таймлапс (FR-09–FR-13) --- */
  var playTimer = null, playSpeed = 1, tlIndex = 0;
  function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; } var b = $("#playBtn"); if (b) b.textContent = "▶ Воспроизвести"; }
  function datedMedia(o) { return o.media.filter(function (m) { return !!m.date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }); }
  function tabMedia(o, body) {
    if(!o.media.length){body.appendChild(el('div',{class:'notice notice-info',text:'В архиве нет фотографий, рендеров, архивных снимков и видеопотоков этого объекта. Материалы не подменяются демонстрационными изображениями.'}));return;}
    var groups = { before: [], progress: [], after: [] };
    o.media.forEach(function (m) { groups[m.type].push(m); });
    var seq = datedMedia(o);
    tlIndex = Math.min(tlIndex, Math.max(0, seq.length - 1));

    body.appendChild(el("div", { class: "notice notice-info", text: "Материалы демонстрационные. Воспроизведение — последовательность опубликованных датированных материалов; промежуточные состояния не моделируются." }));

    // Таймлапс
    var sec = el("div", { class: "card-sec" }, [el("h3", { text: "Временная шкала" })]);
    if (seq.length >= 2) {
      var frame = el("div", { class: "media-frame", id: "tlFrame" });
      frame.innerHTML = mediaHTML(seq[tlIndex], o);
      sec.appendChild(frame);
      var cap = el("div", { class: "media-cap", id: "tlCap" });
      sec.appendChild(cap);
      var ctr = el("div", { class: "tl-controls" });
      var play = el("button", { class: "btn", type: "button", id: "playBtn", text: "▶ Воспроизвести" });
      var range = el("input", { type: "range", min: 0, max: seq.length - 1, step: 1, value: tlIndex, "aria-label": "Кадр временной шкалы" });
      var speeds = el("span", { class: "speed-group", role: "group", "aria-label": "Скорость воспроизведения" });
      [0.5, 1, 2].forEach(function (s) {
        var b = el("button", { class: "btn", type: "button", text: s.toString().replace(".", ",") + "×" });
        b.setAttribute("aria-pressed", playSpeed === s ? "true" : "false");
        b.addEventListener("click", function () {
          playSpeed = s;
          $$(".speed-group button", ctr).forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          if (playTimer) { stopPlay(); startPlay(); }
        });
        speeds.appendChild(b);
      });
      ctr.appendChild(play); ctr.appendChild(range); ctr.appendChild(speeds);
      sec.appendChild(ctr);
      function showFrame(i) {
        tlIndex = i;
        range.value = i;
        frame.innerHTML = mediaHTML(seq[i], o);
        cap.innerHTML = "<span>" + esc(seq[i].caption) + "</span><span>" + esc(fmtDate(seq[i].date)) +
          " · " + esc(seq[i].source) + "</span>" + mediaCredit(seq[i]);
      }
      function startPlay() {
        $("#playBtn").textContent = "⏸ Пауза";
        playTimer = setInterval(function () {
          var next = tlIndex + 1;
          if (next >= seq.length) { stopPlay(); return; }
          showFrame(next);
        }, 1400 / playSpeed);
      }
      play.addEventListener("click", function () { if (playTimer) stopPlay(); else { if (tlIndex >= seq.length - 1) showFrame(0); startPlay(); } });
      range.addEventListener("input", function () { stopPlay(); showFrame(+range.value); });
      showFrame(tlIndex);
    } else {
      sec.appendChild(el("div", { class: "notice notice-warn", text: seq.length === 1 ? "Опубликован только один датированный материал — воспроизведение недоступно." : "Датированные материалы отсутствуют — временная шкала недоступна." }));
    }
    body.appendChild(sec);

    // Сравнение двух кадров
    if (seq.length >= 2) {
      var cs = el("div", { class: "card-sec" }, [el("h3", { text: "Сравнение двух кадров" })]);
      cs.appendChild(el("p", { class: "nodata", text: "Кадры сняты с разных ракурсов и в разное время; пространственное совпадение не гарантируется." }));
      var selRow = el("div", { class: "tl-controls" });
      var selA = el("select", { "aria-label": "Левый кадр" }), selB = el("select", { "aria-label": "Правый кадр" });
      seq.forEach(function (m, i) {
        selA.appendChild(el("option", { value: i, text: fmtDate(m.date) + " — " + m.caption }));
        selB.appendChild(el("option", { value: i, text: fmtDate(m.date) + " — " + m.caption }));
      });
      selA.value = 0; selB.value = seq.length - 1;
      selRow.appendChild(selA); selRow.appendChild(selB);
      cs.appendChild(selRow);
      var cw = el("div", { class: "compare-wrap" });
      var bot = el("div", { class: "lay bot" }), top = el("div", { class: "lay top" });
      cw.appendChild(bot); cw.appendChild(top);
      cs.appendChild(cw);
      var slider = el("input", { type: "range", class: "compare-slider", min: 0, max: 100, value: 50, "aria-label": "Ползунок сравнения кадров" });
      cs.appendChild(slider);
      function drawCompare() {
        top.innerHTML = mediaHTML(seq[+selA.value], o);
        bot.innerHTML = mediaHTML(seq[+selB.value], o);
      }
      slider.addEventListener("input", function () { top.style.clipPath = "inset(0 " + (100 - slider.value) + "% 0 0)"; });
      selA.addEventListener("change", drawCompare); selB.addEventListener("change", drawCompare);
      drawCompare();
      body.appendChild(cs);
    }

    // Разделы До / В процессе / После
    [["before", "До"], ["progress", "В процессе"], ["after", "После"]].forEach(function (g) {
      var list = groups[g[0]];
      var sec2 = el("div", { class: "card-sec" }, [el("h3", { text: g[1] })]);
      if (g[0] === "progress") {
        sec2.appendChild(el("p", { class: "nodata", text: "Прямые трансляции с камер подрядчика в демо-версии не подключены: доступ к камерам предоставляется только через серверный шлюз после согласования." }));
      }
      if (!list.length) {
        sec2.appendChild(el("div", { class: "notice notice-info", text: g[0] === "after" ? "Раздел недоступен: объект не введён, а проектная визуализация не опубликована." : "Материалы этого раздела пока не опубликованы." }));
      } else {
        list.forEach(function (m) {
          var fr = el("div", { class: "media-frame" }); fr.innerHTML = mediaHTML(m, o);
          sec2.appendChild(fr);
          sec2.appendChild(el("div", { class: "media-cap", html: "<span>" + esc(m.caption) + "</span><span>" + (m.date ? esc(fmtDate(m.date)) : '<span class="nodata">дата не установлена</span>') + " · " + esc(m.source) + " · " + esc(m.rights) + "</span>" + mediaCredit(m) }));
        });
        if (g[0] === "before") {
          if (o.siteHistory) {
            sec2.appendChild(el("div", { class: "notice notice-info", html: "<b>История места:</b> ранее здесь — " + esc(o.siteHistory.text) + ". <span class='nodata'>Источник: " + esc(o.siteHistory.source) + ", " + esc(fmtDate(o.siteHistory.date)) + "</span>" }));
          } else {
            sec2.appendChild(el("p", { class: "nodata", text: "Историческая справка об участке публикуется при наличии подтверждённого источника и не заполняется предположениями." }));
          }
        }
      }
      body.appendChild(sec2);
    });
  }

  /* --- Пешая доступность: клик по значку сада/школы/поликлиники строит маршрут --- */
  function walkingRing(o,minutes) {
    var lat=o.lat*Math.PI/180,lng=o.lon*Math.PI/180,d=minutes*80/6371000;
    return Array.from({length:97},function(_,i){var a=i*2*Math.PI/96,y=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(a));return [y*180/Math.PI,(lng+Math.atan2(Math.sin(a)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(y)))*180/Math.PI];});
  }
  function drawWalkingZones(o) {
    isoGroup.clearLayers();
    if(!hasCoordinates(o)||!walkingEnabled)return;
    var colors=['#23976c','#65b66a','#c4bd45','#e5a43b','#df753d','#cc4e50'];
    var prev=0;
    for(var end=5;prev<walkingMinutes;end+=5){var mins=Math.min(end,walkingMinutes),rings=[walkingRing(o,mins)];if(prev)rings.push(walkingRing(o,prev));L.polygon(rings,{interactive:false,weight:1,fillRule:'evenodd',color:colors[Math.ceil(mins/5)-1],fillOpacity:.25,className:'walking-band'}).addTo(isoGroup);prev=mins;}
  }
  function tabAccess(o,body) {
    routeLayerGroup.clearLayers();
    body.appendChild(el('div',{class:'notice notice-warn',text:'Демо-приближение по прямой (80 м/мин), не расчёт по дорожной сети. Переходы, реки и препятствия не учитываются.'}));
    if(!hasCoordinates(o)||o.geocoding){body.appendChild(el('div',{class:'notice notice-info',text:'В исходном архиве нет координат объекта. Подобранная точка требует проверки; пешая доступность от неё не рассчитывается.'}));return;}
    var controls=el('div',{class:'walk-controls'});
    var label=el('label',{for:'walkingMinutes'},[el('span',{text:'Пешая доступность'}),el('output',{id:'walkingValue',text:walkingMinutes+' мин'})]);
    var range=el('input',{id:'walkingMinutes',type:'range',min:'5',max:'30',step:'1',value:walkingMinutes,'aria-label':'Время пешком в минутах'});
    var toggle=el('input',{type:'checkbox',id:'walkingEnabled'});toggle.checked=walkingEnabled;
    controls.appendChild(el('label',{for:'walkingEnabled'},[el('span',{text:'Показывать цветные зоны'}),toggle]));controls.appendChild(label);controls.appendChild(range);
    controls.appendChild(el('div',{class:'walk-scale',html:'<span>5 мин</span><span>15 мин</span><span>30 мин</span>'}));controls.appendChild(el('div',{class:'walk-gradient'}));body.appendChild(controls);
    range.disabled=!walkingEnabled;
    range.addEventListener('input',function(){walkingMinutes=+range.value;$('#walkingValue').textContent=walkingMinutes+' мин';drawWalkingZones(o);});
    toggle.addEventListener('change',function(){walkingEnabled=toggle.checked;range.disabled=!walkingEnabled;drawWalkingZones(o);});
    drawWalkingZones(o);
    var nearby=OKS.filter(function(other){return other.id!==o.id&&hasCoordinates(other);}).map(function(other){return {o:other,d:haversine(o.lat,o.lon,other.lat,other.lon)};}).sort(function(a,b){return a.d-b.d;}).slice(0,8);
    body.appendChild(el('h3',{text:'Другие объекты из архива рядом'}));
    body.appendChild(el('p',{class:'nodata',text:'Список не является полным перечнем действующей инфраструктуры. Указано расстояние по прямой.'}));
    nearby.forEach(function(n){body.appendChild(el('button',{type:'button',class:'poi-quickbtn',text:n.o.name+' · '+Math.round(n.d)+' м',onclick:function(){openCard(n.o.id);}}));});
  }

  /* --- Закупки (FR-21–FR-23) --- */
  function tabProcure(o, body) {
    if (!o.contracts || !o.contracts.length) {
      body.appendChild(el("div", { class: "notice notice-info", text: "Связанные закупки не опубликованы. Связь ОКС и контракта подтверждается внешним идентификатором или модератором; совпадения по адресу и названию остаются кандидатами и не публикуются." }));
      return;
    }
    body.appendChild(el("div", { class: "notice notice-info", text: "Демо-выгрузка. Целевой режим — согласованный официальный интерфейс ЕИС/региональной системы с суточным опросом; HTML-скрейпинг не используется." }));
    var stale = daysBetween(o.contracts[0].updated, "2026-09-12") > 2;
    if (stale) body.appendChild(el("div", { class: "notice notice-warn", text: "Данные о закупках не обновлялись более 48 часов и помечены как устаревшие." }));
    var wrap = el("div", { class: "tbl-scroll" });
    var t = el("table", { class: "tbl" });
    t.innerHTML = "<thead><tr><th>Система / №</th><th>Предмет</th><th>Статус</th><th>Заказчик → Поставщик</th><th>Цена</th><th>Сроки</th><th>Изм.</th><th>Обновлено</th></tr></thead>";
    var tb = el("tbody");
    o.contracts.forEach(function (c) {
      var tr = el("tr");
      tr.innerHTML = "<td>" + esc(c.system) + "<br><code style='font-size:11.5px'>" + esc(c.number) + "</code><br><span class='nodata' style='font-style:normal;font-size:11.5px'>заключённый контракт</span></td>" +
        "<td>" + esc(c.subject) + "</td>" +
        "<td>" + esc(c.sourceStatus) + (c.normStatus && c.normStatus !== c.sourceStatus ? "<br><span class='nodata'>норм.: " + esc(c.normStatus) + "</span>" : "") + "</td>" +
        "<td>" + esc(c.customer) + " → " + esc(c.supplier) + "</td>" +
        "<td>" + esc(fmtMoney(c.price, c.currency)) + "</td>" +
        "<td>подписан " + esc(fmtDate(c.signed)) + "<br>срок " + esc(fmtDate(c.deadline)) + "</td>" +
        "<td>" + c.changes + "</td><td>" + esc(fmtDate(c.updated)) + "</td>";
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); body.appendChild(wrap);
    body.appendChild(el("p", { class: "nodata", text: "Связь подтверждена: " + o.contracts[0].linkConfirmed + ". Итоговая стоимость по объекту не суммируется автоматически: возможны несколько контрактов на объект и распределение сумм между объектами." }));
    body.appendChild(el("div", { class: "card-sec" }, [
      el("h3", { text: "Проверить по номеру на официальном портале" }),
      el("p", { html: 'Скопируйте номер контракта выше и найдите его в <a href="https://zakupki.gov.ru/epz/main/public/home.html" target="_blank" rel="noopener">Единой информационной системе в сфере закупок</a> ' +
        'или, для закупок малого объёма, на <a href="https://zakupki.tularegion.ru/servisy/zapros-tsen-dlya-zakupok-malogo-obema-2020" target="_blank" rel="noopener">портале закупок малого объёма Тульской области</a>. ' +
        'Портал не встроен напрямую: показанные выше данные — демонстрационная выгрузка, а не результат живого запроса к ЕИС.' })
    ]));
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  /* --- Сообщить о проблеме (FR-27–FR-31) --- */
  var reportPoint = null, reportPicking = false, reportMarker = null, reportClickBound = false;
  var CATEGORIES = ["Состояние строительного объекта", "Строительный мусор", "Разбитая дорога",
    "Грязь на выезде со строительной площадки", "Нарушение графика шумных работ",
    "Техника без тента при перевозке сыпучих материалов", "Отсутствие информационного стенда (паспорта объекта)", "Другое"];
  function tabReport(o, body) {
    reportPoint = reportPoint || (hasCoordinates(o)&&!o.geocoding?{lat:o.lat,lon:o.lon}:null);
    body.appendChild(el("div", { class: "notice notice-warn", html: "Портал не отправляет обращения самостоятельно: двусторонняя интеграция с Платформой обратной связи не подключена. Подготовьте текст ниже, скопируйте его и подайте через <b>официальную форму ПОС или электронную приёмную</b>. Персональные данные в адресную строку не передаются, черновики на сервере не сохраняются." }));
    var form = el("div", { class: "form-grid" });

    form.appendChild(el("label", { class: "fl", for: "repCat", text: "Категория" }));
    var sel = el("select", { id: "repCat" });
    CATEGORIES.forEach(function (c) { sel.appendChild(el("option", { value: c, text: c })); });
    form.appendChild(sel);

    form.appendChild(el("label", { class: "fl", text: "Точка на карте" }));
    var prow = el("div");
    var pbtn = el("button", { class: "btn", type: "button", id: "pickPoint", text: "Указать / исправить точку на карте" });
    var pinfo = el("span", { id: "pickInfo", style: "margin-left:8px;font-size:13px;color:var(--muted)" });
    prow.appendChild(pbtn); prow.appendChild(pinfo);
    form.appendChild(prow);

    form.appendChild(el("label", { class: "fl", for: "repText", text: "Описание проблемы (от 20 до 5000 символов)" }));
    var ta = el("textarea", { id: "repText", maxlength: "5000", "aria-describedby": "repCount" });
    form.appendChild(ta);
    var cc = el("div", { class: "char-count", id: "repCount", text: "0 / 5000 (минимум 20)" });
    form.appendChild(cc);

    form.appendChild(el("label", { class: "fl", for: "repFiles", text: "Вложения (до 5 файлов JPEG/PNG/PDF, по 10 МБ, не более 25 МБ суммарно)" }));
    var fi = el("input", { type: "file", id: "repFiles", multiple: "multiple", accept: ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" });
    form.appendChild(fi);
    var ferr = el("div", { class: "field-err", id: "fileErr", role: "alert" });
    var flist = el("ul", { class: "file-list", id: "fileList" });
    form.appendChild(ferr); form.appendChild(flist);
    form.appendChild(el("p", { class: "nodata", text: "Файлы проверяются локально и никуда не загружаются до подачи через официальный канал. При промышленной интеграции проверяется фактический формат, выполняется антивирусная проверка и очистка EXIF-метаданных изображений; жалобы и вложения публично не размещаются." }));

    var gen = el("button", { class: "btn btn-primary", type: "button", text: "Подготовить текст обращения" });
    form.appendChild(gen);
    var outWrap = el("div", { style: "display:none" }, [
      el("label", { class: "fl", for: "repOut", text: "Готовый текст" }),
      el("textarea", { class: "copy-out", id: "repOut", readonly: "readonly" })
    ]);
    var copyBtn = el("button", { class: "btn", type: "button", text: "Скопировать текст" });
    var posLink = el("p", { html: 'Куда подать: <a href="https://pos.gosuslugi.ru/" target="_blank" rel="noopener">Платформа обратной связи</a> (откроется главная страница; предзаполнение выполняется только через согласованный механизм).' });
    outWrap.appendChild(copyBtn); outWrap.appendChild(posLink);
    form.appendChild(outWrap);
    body.appendChild(form);

    ta.addEventListener("input", function () {
      var n = ta.value.length;
      cc.textContent = n + " / 5000 (минимум 20)";
      cc.classList.toggle("bad", n > 0 && n < 20);
    });
    function updPickInfo() {
      pinfo.textContent = reportPoint ? ("выбрано: " + reportPoint.lat.toFixed(5) + ", " + reportPoint.lon.toFixed(5)) : "точка не выбрана";
      if (reportMarker) isoGroup.removeLayer(reportMarker);
      if (reportPoint) {
        reportMarker = L.circleMarker([reportPoint.lat, reportPoint.lon], { radius: 7, color: "#b04a3a", fillColor: "#e6a79c", fillOpacity: 0.9 }).bindTooltip("Точка обращения");
        isoGroup.addLayer(reportMarker);
      }
    }
    updPickInfo();
    pbtn.addEventListener("click", function () {
      reportPicking = !reportPicking;
      reportPickingGuard();
      map.getContainer().style.cursor = reportPicking ? "crosshair" : "";
    });
    if (!reportClickBound) {
      reportClickBound = true;
      map.on("click", function (e) {
        if (!reportPicking) return;
        reportPoint = { lat: e.latlng.lat, lon: e.latlng.lng };
        reportPicking = false;
        var b = $("#pickPoint"), pi = $("#pickInfo");
        if (b) b.textContent = "Указать / исправить точку на карте";
        map.getContainer().style.cursor = "";
        if (pi) pi.textContent = "выбрано: " + reportPoint.lat.toFixed(5) + ", " + reportPoint.lon.toFixed(5);
        if (reportMarker) isoGroup.removeLayer(reportMarker);
        reportMarker = L.circleMarker([reportPoint.lat, reportPoint.lon], { radius: 7, color: "#b04a3a", fillColor: "#e6a79c", fillOpacity: 0.9 }).bindTooltip("Точка обращения");
        isoGroup.addLayer(reportMarker);
      });
    }
    fi.addEventListener("change", function () {
      ferr.textContent = ""; flist.innerHTML = "";
      var files = Array.prototype.slice.call(fi.files);
      var ok = true, total = 0;
      if (files.length > 5) { ferr.textContent = "Не более 5 файлов."; ok = false; }
      files.forEach(function (f) {
        total += f.size;
        var typeOk = /(^image\/(jpeg|png)$)|(^application\/pdf$)/.test(f.type) || /\.(jpe?g|png|pdf)$/i.test(f.name);
        if (!typeOk) { ferr.textContent = "Допустимы только JPEG, PNG и PDF: " + f.name; ok = false; }
        if (f.size > 10 * 1024 * 1024) { ferr.textContent = "Файл больше 10 МБ: " + f.name; ok = false; }
        flist.appendChild(el("li", { text: f.name + " · " + (f.size / 1024 / 1024).toFixed(1) + " МБ" }));
      });
      if (total > 25 * 1024 * 1024) { ferr.textContent = "Суммарный размер вложений превышает 25 МБ."; ok = false; }
      if (!ok) fi.value = "";
      if (!ok) flist.innerHTML = "";
    });
    gen.addEventListener("click", function () {
      var n = ta.value.trim().length;
      if (n < 20) { cc.classList.add("bad"); ta.focus(); cc.textContent = "Минимальная длина описания — 20 символов (сейчас " + n + ")."; return; }
      if(!reportPoint){pinfo.textContent="Выберите точку на карте перед подготовкой текста";pbtn.focus();return;}
      var txt = "Категория: " + sel.value + "\n" +
        "Объект: " + o.name + " (карточка портала: " + (location.href.split("#")[0] + "#obj=" + o.id) + ")\n" +
        "Адрес объекта: " + o.address + "\n" +
        "Координаты проблемы: " + reportPoint.lat.toFixed(5) + ", " + reportPoint.lon.toFixed(5) + "\n\n" +
        "Описание:\n" + ta.value.trim() + "\n\n" +
        "Вложения (приложите вручную при подаче): " + ($("#fileList").children.length || "нет") + "\n" +
        "Подготовлено на демонстрационном портале ОКС Тульской области, " + fmtDate("2026-09-12");
      $("#repOut").value = txt;
      outWrap.style.display = "block";
      $("#repOut").focus();
    });
    copyBtn.addEventListener("click", function () { copyText($("#repOut").value, copyBtn); });
  }

  function reportPickingGuard() {
    var b = $("#pickPoint");
    if (b) b.textContent = reportPicking ? "Кликните по карте… (нажмите ещё раз для отмены)" : "Указать / исправить точку на карте";
  }
  function copyText(t, btn) {
    function done(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? "Скопировано" : "Не удалось — выделите вручную";
      setTimeout(function () { btn.textContent = old; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { done(true); }, function () { done(false); });
    } else done(false);
  }

  /* ---------- страницы ---------- */
  function setView(v) {
    state.view = "map";
    if (map) setTimeout(function () { map.invalidateSize(); }, 60);
  }

  /* ---------- запуск ---------- */
  function applyUrlState() {
    var u = readUrl(); if (!u) return;
    applyingUrl = true;
    if (u.view) state.view = u.view;
    if (u.m && MODE_STATUSES[u.m]) state.mode = u.m;
    state.fullMap=u.full==="1";state.viewportOnly=u.vp==="1";state.unmappedOnly=u.unmapped==="1";$("#vpOnly").checked=state.viewportOnly;$("#unmappedOnly").checked=state.unmappedOnly;
    if (u.q) { state.q = u.q; $("#searchInput").value = u.q; }
    ["sector", "stage", "status", "ownership", "district", "year"].forEach(function (k) {
      if (u[k]) state.f[k] = u[k].split(",").filter(Boolean);
    });
    if (u.ym === "plan") state.yearMode = "plan";
    if (u.sort) state.sort = u.sort;
    if (u.pg) state.page = Math.max(1, parseInt(u.pg, 10) || 1);
    if (u.scen === "future") state.scenario = "future";
    if (u.layer) {
      var parts = u.layer.split(":");
      if (parts[0] === "prov") { state.layer = "prov"; if (parts[1] && DICT.sectors[parts[1]]) state.provSector = parts[1]; }
      if (parts[0] === "sat") state.layer = "sat";
    }
    if (u.d && u.d!=="unknown" && distById[u.d]) state.district = u.d;
    if (u.map) {
      var m = u.map.split(",");
      if (m.length === 3 && m.every(function(v){return Number.isFinite(+v);}) && Math.abs(+m[0])<=85 && Math.abs(+m[1])<=180 && +m[2]>=6 && +m[2]<=19) map.setView([+m[0], +m[1]], +m[2]);
    } else if (state.district) {
      map.fitBounds(L.geoJSON(distById[state.district]).getBounds().pad(0.08));
    }
    if (state.district) {
      $("#crumb").style.display = "flex"; $("#crumbName").textContent = distById[state.district].properties.name;
      buildStreetFabric(state.district);
      setMapMode("tiles"); map.removeLayer(labelGroup); restyleDistricts(); renderMarkers();
    }
    if(state.fullMap)setMapMode("tiles");
    buildFilters();renderAll();
    $$(".mode-tabs button").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.mode===state.mode?"true":"false");});
    applyingUrl = false;
    if (u.obj && byId[u.obj]) openCard(u.obj, true);
  }

  function boot() {
    initMap();
    $('#unmappedOnly').addEventListener('change',function(){state.unmappedOnly=this.checked;state.page=1;renderAll();writeUrl();});
    $('#fullMap').addEventListener('change',function(){var enabled=this.checked;closeCard();state.fullMap=enabled;state.district=null;state.page=1;$('#crumb').style.display='none';setMapMode(enabled?'tiles':'glass');map.stop();map.fitBounds(OBLAST_BOUNDS,{padding:[30,90]});renderAll();writeUrl();});
    buildFilters();

    $$(".mode-tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.mode = b.dataset.mode; state.page = 1;
        $$(".mode-tabs button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        buildFilters(); renderAll(); writeUrl();
      });
    });
    var st;
    $("#searchInput").addEventListener("input", function () {
      clearTimeout(st);
      st = setTimeout(function () { state.q = $("#searchInput").value.trim(); state.page = 1; renderAll(); writeUrl(); }, 220);
    });
    $("#clearAll").addEventListener("click", clearAllFilters);
    $("#sortSel").addEventListener("change", function () { state.sort = this.value; renderList(); writeUrl(); });
    $("#vpOnly").addEventListener("change", function () { state.viewportOnly = this.checked; state.page = 1; renderAll(); writeUrl(); });

    $("#fitAll").addEventListener("click", function () { exitDistrict(true); });
    $("#crumbBack").addEventListener("click", function () { exitDistrict(true); });
    $("#locateBtn").addEventListener("click", function () {
      // геолокация только по явному действию; координаты не сохраняются (FR-03)
      if (!navigator.geolocation) { alert("Геолокация не поддерживается браузером."); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        var mk = L.circleMarker([p.coords.latitude, p.coords.longitude], { radius: 8, color: "#1d84c9", fillColor: "#8fc7e8", fillOpacity: 0.9 }).addTo(map).bindTooltip("Вы здесь (не сохраняется)");
        map.flyTo([p.coords.latitude, p.coords.longitude], 12, { duration: 0.7 });
        setTimeout(function () { map.removeLayer(mk); }, 30000);
      }, function () { /* отказ не блокирует портал */ });
    });

    $("#layerSel").addEventListener("change", function () { setLayer(this.value); });
    $("#provSector").addEventListener("change", function () { state.provSector = this.value; restyleDistricts(); renderLegend(); writeUrl(); });
    $$("#scenarioRow input").forEach(function (r) {
      r.addEventListener("change", function () { state.scenario = r.value; restyleDistricts(); renderLegend(); writeUrl(); });
    });

    $("#cardClose").addEventListener("click", closeCard);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !state.obj) return;
      var t = document.activeElement;
      if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type === "text") || t.tagName === "SELECT")) { t.blur(); return; }
      closeCard();
    });
    $$(".card-tabs button").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });
    renderAll();
    setMapMode(state.district ? "tiles" : "glass");
    applyUrlState();
    setView(state.view);
    renderLegend();
    window.oksPortal={map:map,state:state,filtered:filtered,openCard:openCard,enterDistrict:enterDistrict,exitDistrict:exitDistrict,markers:markerGroup};
  }
  window.addEventListener("hashchange", function () { applyUrlState(); });
  document.addEventListener("DOMContentLoaded", boot);
})();
