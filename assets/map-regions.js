/* Two map states: local district overview, then detailed basemap. */
const regionPalette = ['#B7D6C2', '#E8C9A3', '#B8CEE6', '#D2C0DD', '#E6B9B1', '#D9DFA7', '#A9D4D5'];
const regionFeatures = window.TULA_BOUNDARIES.features;
const districtShapes = new Map();
const ratingByDistrict = new Map();
for (const feature of regionFeatures) {
  const values = objects.filter(o => o.districtId === feature.properties.id && Number.isFinite(o.satisfaction)).map(o => o.satisfaction);
  if (values.length) ratingByDistrict.set(feature.properties.id, {value:values.reduce((a,b)=>a+b,0)/values.length, count:values.length});
}
map.createPane('ratingsPane').style.zIndex = 410;
map.getPane('ratingsPane').style.pointerEvents = 'none';
map.createPane('regionMaskPane').style.zIndex = 450;
map.getPane('regionMaskPane').style.pointerEvents = 'none';
map.createPane('regionBordersPane').style.zIndex = 460;
const regionMask = L.layerGroup().addTo(map);
const mapPage = document.getElementById('page-map');
const regionBack = document.getElementById('regionBack');
const regionTitle = document.getElementById('regionTitle');
const regionHint = document.getElementById('regionHint');
const tileNotice = document.getElementById('tileNotice');
const settingsButton = document.getElementById('mapSettings');
function districtColor(id) {
  return regionPalette[regionFeatures.find(f => f.properties.id === id).properties.colorIndex];
}
function districtStyle(feature) {
  const selected = feature.properties.id === currentDistrictFilter;
  const ratings = document.getElementById('toggleHeat').checked;
  const overview = mapView === 'overview';
  return {color: overview ? (ratings ? '#b4c1cd' : '#fff') : selected ? '#3569a0' : '#9aaebe',
    weight: overview ? 1.5 : selected ? 3 : 1.3,
    fillColor: overview && !ratings ? districtColor(feature.properties.id) : '#fff',
    fillOpacity: overview ? (ratings ? (ratingByDistrict.has(feature.properties.id) ? 0 : 1) : 0.95) : mapView === 'detail' && !selected ? 1 : 0,
    className:'region-outline'};
}
const regionsLayer = L.geoJSON(window.TULA_BOUNDARIES, {
  pane: 'regionBordersPane',
  style: districtStyle,
  onEachFeature(feature, layer) {
    const {id, name} = feature.properties;
    districtShapes.set(id, layer);
    layer.bindTooltip(name, {sticky:true, className:'region-tooltip'});
    layer.on('mouseover', () => {
      if (mapView !== 'overview' || document.getElementById('toggleHeat').checked) return;
      layer.setStyle({weight:2.5, color:'#536c80', fillOpacity:1});
      layer.bringToFront();
    });
    layer.on('mouseout', () => regionsLayer.resetStyle(layer));
    layer.on('click', () => selectDistrict(id));
    layer.on('add', () => {
      const path = layer.getElement();
      if (!path) return;
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', 'Открыть: ' + name);
      path.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDistrict(id); }
      });
    });
  }
}).addTo(map);
map.attributionControl.addAttribution('Границы: <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · 12.09.2026');

function showRegionInfo(id) {
  document.getElementById('objContent')?.remove();
  sideEmpty.style.display = 'block';
  sideEmpty.className = 'region-intro';
  if (id === 'all') {
    sideEmpty.innerHTML = `<div class="eyebrow">ОБЗОР РЕГИОНА</div><h2>${mapView === 'full' ? 'Объекты всей области' : 'Начните с района'}</h2>
      <span class="region-count">${regionFeatures.length} районов и округов</span>
      <p>Нажмите на цветную территорию или выберите её в списке. Карта приблизится и покажет улицы, населённые пункты и объекты строительства.</p>
      <p id="overviewColorHint">Цвета помогают различать территории и не обозначают рейтинг или обеспеченность.</p>
      <div id="overviewRatingLegend" hidden><b>Демо-оценки жителей</b><div class="rating-gradient"></div><div class="legend-scale"><span>0% · низкие</span><span>100% · высокие</span></div></div>
      <div class="region-list">${regionFeatures.map(f => `<button class="region-choice" data-district="${f.properties.id}"><span class="region-swatch" style="background:${districtColor(f.properties.id)}"></span>${f.properties.name}</button>`).join('')}</div>
      <p class="region-source">Границы: OpenStreetMap, снимок от 12.09.2026. Объекты и показатели — демонстрационные.</p>`;
  } else {
    const items = objects.filter(o => o.districtId === id);
    sideEmpty.innerHTML = `<div class="eyebrow">ВЫБРАННАЯ ТЕРРИТОРИЯ</div><h2>${districtLabel(id)}</h2>
      <span class="region-count">Демо-объектов: ${items.length}</span>
      <p>${items.length ? 'Выберите маркер на карте или объект в списке, чтобы открыть карточку строительства.' : 'В этом районе пока нет объектов в демонстрационном наборе. Подробная карта доступна: приближайте её, чтобы рассмотреть улицы и населённые пункты.'}</p>
      <div class="region-list">${items.map(o => `<button class="region-choice" data-object="${o.id}">${o.name}</button>`).join('')}</div>
      <p class="region-source">Картографическая подложка: OpenStreetMap / Esri. Объекты и показатели — демонстрационные.</p>`;
  }
  updateRatingExplanation();
  sideEmpty.querySelectorAll('[data-district]').forEach(button => button.addEventListener('click', () => selectDistrict(button.dataset.district)));
  sideEmpty.querySelectorAll('[data-object]').forEach(button => button.addEventListener('click', () => selectObject(objects.find(o => o.id === Number(button.dataset.object)))));
}

function fitRegion(bounds, overview, animate = true) {
  map.invalidateSize();
  const motion = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const options = {paddingTopLeft:[24, overview ? 135 : 150], paddingBottomRight:[24,32], maxZoom:overview ? 9 : 13, animate:motion, reset:!motion, duration:0.6};
  // flyToBounds can be interrupted by map.stop() when a new territory is selected.
  if (motion) map.flyToBounds(bounds, options);
  else map.fitBounds(bounds, options);
}
function selectDistrict(id, zoom = true, full = false) {
  if (id !== 'all' && !districtShapes.has(id)) return;
  map.stop();
  currentDistrictFilter = id;
  districtSelect.value = id;
  mapView = id === 'all' ? (full ? 'full' : 'overview') : 'detail';
  document.getElementById('toggleFullMap').checked = mapView === 'full';
  const overview = mapView === 'overview';
  mapPage.classList.toggle('is-overview', overview);
  mapPage.classList.remove('settings-open');
  settingsButton.setAttribute('aria-expanded', 'false');
  regionBack.hidden = overview;
  regionTitle.textContent = overview ? 'Тульская область' : mapView === 'full' ? 'Вся карта Тульской области' : districtLabel(id);
  regionHint.textContent = overview ? 'Выберите район на карте, чтобы рассмотреть его подробнее' : 'Улицы, населённые пункты и объекты строительства';
  tileNotice.hidden = true;
  document.getElementById('mapLoading').hidden = overview;
  map.closePopup();
  if (isoCircle) { map.removeLayer(isoCircle); isoCircle = null; }
  selectedMarker = null;
  document.getElementById('isoHint').textContent = 'Выберите объект, чтобы увидеть цветные зоны времени пешком.';
  if (overview) {
    [satLayer, schemeLayer, labelsLayer, socialLayer, heatLayer].forEach(layer => map.removeLayer(layer));
    baseLayerControl.remove();
  } else {
    if (!map.hasLayer(satLayer) && !map.hasLayer(schemeLayer)) schemeLayer.addTo(map);
    baseLayerControl.addTo(map);
    if (document.getElementById('toggleSocial').checked) socialLayer.addTo(map);
    if (document.getElementById('toggleHeat').checked) heatLayer.addTo(map);
  }
  document.getElementById('mapLoading').hidden = overview || ![satLayer, schemeLayer].some(layer => map.hasLayer(layer) && layer.isLoading());
  updateRegionMask();
  updateRatingLayer();
  refreshMapMarkers();
  showRegionInfo(id);
  renderObjectsTable();
  if (zoom && mapPage.classList.contains('active')) fitRegion(id === 'all' ? regionsLayer.getBounds() : districtShapes.get(id).getBounds(), overview);
}
function updateRegionMask() {
  regionMask.clearLayers();
  if (mapView === 'full') return;
  const features = mapView === 'overview' ? regionFeatures : regionFeatures.filter(f => f.properties.id === currentDistrictFilter);
  const rings = [[[85,-540],[85,540],[-85,540],[-85,-540]]];
  for (const feature of features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) rings.push(ring.map(([lng,lat])=>[lat,lng]));
  }
  L.polygon(rings, {pane:'regionMaskPane',stroke:false,fillColor:'#fff',fillOpacity:1,fillRule:'evenodd',interactive:false}).addTo(regionMask);
}
function ratingColor(value) {
  // Continuous red → amber → green scale; color is a display of demo ratings only.
  const low = value < .5 ? [197,68,70] : [230,184,64];
  const high = value < .5 ? [230,184,64] : [44,155,107];
  const t = value < .5 ? value * 2 : (value-.5)*2;
  return `rgb(${low.map((v,i)=>Math.round(v+(high[i]-v)*t)).join(',')})`;
}
function updateRatingLayer() {
  const enabled = document.getElementById('toggleHeat').checked;
  document.getElementById('ratingLegend').hidden = !enabled;
  heatLayer.clearLayers();
  if (enabled) {
    for (const feature of regionFeatures) {
      const rating = ratingByDistrict.get(feature.properties.id);
      if (!rating) continue;
      L.geoJSON(feature, {pane:'ratingsPane',interactive:false,style:{stroke:false,
        fillColor:ratingColor(rating.value),fillOpacity:.55,className:'municipality-rating-zone'}}).addTo(heatLayer);
    }
    heatLayer.addTo(map);
  } else map.removeLayer(heatLayer);
  regionsLayer.setStyle(districtStyle);
  updateRatingExplanation();
  districtShapes.forEach((layer,id) => {
    const rating = ratingByDistrict.get(id);
    layer.setTooltipContent(districtLabel(id) + (enabled ? rating ? ` — ${Math.round(rating.value*100)}% · среднее демо-оценок (${rating.count} объектов)` : ' — нет оценок' : ''));
  });
}
function updateRatingExplanation() {
  const enabled = document.getElementById('toggleHeat').checked;
  const hint = document.getElementById('overviewColorHint');
  if (hint) hint.textContent = enabled ? 'Цвет показывает среднюю демо-оценку объектов муниципалитета. Без заливки — нет оценок. Наведите на территорию, чтобы увидеть значение.' : 'Цвета помогают различать территории и не обозначают рейтинг или обеспеченность.';
  const legend = document.getElementById('overviewRatingLegend');
  if (legend) legend.hidden = !enabled;
}
document.getElementById('toggleFullMap').addEventListener('change', e => {
  selectDistrict('all', true, e.target.checked);
  mapPage.classList.add('settings-open');
  settingsButton.setAttribute('aria-expanded', 'true');
});
regionBack.addEventListener('click', () => selectDistrict('all'));
settingsButton.addEventListener('click', () => {
  settingsButton.setAttribute('aria-expanded', String(mapPage.classList.toggle('settings-open')));
});
// Selecting a territory from another page also prepares the map when it is opened.
window.addEventListener('hashchange', () => {
  if (mapPage.classList.contains('active')) requestAnimationFrame(() => fitRegion(currentDistrictFilter === 'all' ? regionsLayer.getBounds() : districtShapes.get(currentDistrictFilter).getBounds(), mapView === 'overview'));
});
let tileFailures = 0;
[satLayer, schemeLayer].forEach(layer => {
  layer.on('loading', () => { tileFailures = 0; document.getElementById('mapLoading').hidden = mapView === 'overview'; });
  layer.on('load', () => { document.getElementById('mapLoading').hidden = true; });
  layer.on('tileerror', () => {
    if (mapView !== 'overview' && map.hasLayer(layer) && ++tileFailures >= 3) { tileNotice.hidden = false; document.getElementById('mapLoading').hidden = true; }
  });
  layer.on('tileload', () => { if (tileFailures === 0) tileNotice.hidden = true; });
});
document.getElementById('retryTiles').addEventListener('click', () => {
  tileFailures = 0;
  tileNotice.hidden = true;
  [satLayer, schemeLayer].filter(layer => map.hasLayer(layer)).forEach(layer => layer.redraw());
});
function resizeRegionMap() {
  mapPage.style.height = `calc(100dvh - ${document.querySelector('header').offsetHeight}px)`;
  if (mapPage.classList.contains('active')) {
    map.invalidateSize();
    if (mapView === 'overview') { map.stop(); fitRegion(regionsLayer.getBounds(), true, false); }
  }
}
new ResizeObserver(resizeRegionMap).observe(document.querySelector('header'));
window.addEventListener('resize', resizeRegionMap);
selectDistrict('all');
