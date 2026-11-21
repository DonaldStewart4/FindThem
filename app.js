// app.js — runs the page: the map, the inputs, and drawing the results.
//
// The flow:
//   1. Tap the map to set where the person was last seen (and any familiar places).
//   2. Fill in minutes, direction and mobility.
//   3. "Run search prediction": data.js loads the streets and creeks, the engine works
//      out where the person probably is, and we draw a heatmap and a "Check these first" list.
//
// All on-screen words come from i18n.js (t('key')). Don't type user-facing text here.

import * as data from './data.js';
import * as i18n from './i18n.js';
import { t } from './i18n.js';
// The FAKE engine, until Jev's real one is ready. At integration change this one line to:
//   import * as engine from './engine/index.js';
import * as engine from './engine/fake.js';

// ---- Settings ---------------------------------------------------------------------

// Where the map opens: Fremont, CA, near Central Park. This is also the center of the
// bundled demo data (tests/fixtures/demo-area.json covers 3.2 km around it).
const DEMO_LOCATION = { lat: 37.5530, lng: -121.9700 };
// The Demo case: last seen in a quiet neighborhood (Placer Way / Tehama Avenue) with a
// drainage creek about 100 m away, heading northeast toward Central Park.
const DEMO_CASE = {
  lastSeen: { lat: 37.5405, lng: -121.9795 },
  minutes: 45,
  direction: 'NE',
  mobility: 'slow',
  familiarPlaces: [{ lat: 37.5485, lng: -121.9630, label: 'Lake Elizabeth' }],
  seed: 20261121, // fixed, so the demo looks the same every time
};

const MAX_FAMILIAR = 3;
const SPOTS_SHOWN_FIRST = 3; // the list shows 3, "Show more" reveals up to 8
const SPOTS_MAX = 8;
const HEAT_MAX_POINTS = 4000; // the most likely grid cells we draw in the heatmap

// ---- What the user has entered ---------------------------------------------------

const state = {
  lastSeen: null,          // { lat, lng }
  familiarPlaces: [],      // [{ lat, lng, label }]
  mode: 'lastSeen',        // what the next map tap does: 'lastSeen', 'familiar', or null
  seed: newSeed(),         // a new random seed for each new search
  units: 'imperial',
  showAllSpots: false,
  lastSpots: [],
};

// A random whole number for the engine's random-number generator.
function newSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

// Small helpers for remembering settings (language, units) on this phone.
// Wrapped in try/catch because private browsing can block storage.
function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not saved, that's fine */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

// ---- Page elements ---------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const els = {
  callLink: $('call-link'),
  callText: $('call-text'),
  status: $('status'),
  panel: $('panel'),
  panelToggle: $('panel-toggle'),
  results: $('results'),
  fakeNote: $('fake-note'),
  spots: $('spots'),
  moreSpots: $('more-spots'),
  setLastSeen: $('set-last-seen'),
  lastSeenHelp: $('last-seen-help'),
  minutes: $('minutes'),
  direction: $('direction'),
  familiarList: $('familiar-list'),
  addFamiliar: $('add-familiar'),
  run: $('run'),
  demo: $('demo'),
  language: $('language'),
  units: $('units'),
};

// ---- The map ---------------------------------------------------------------------

// preferCanvas draws thousands of street lines quickly.
const map = L.map('map', { preferCanvas: true, zoomControl: true }).setView(DEMO_LOCATION, 15);

// OpenStreetMap tiles. Tiles are only fetched for what the user actually looks at.
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// Layers we draw on top of the tiles.
const layers = {
  streets: L.layerGroup().addTo(map),   // thin street lines, so the map works without tiles
  heat: null,                            // the heatmap (made after a run)
  spots: L.layerGroup().addTo(map),     // numbered "check these first" markers
  pins: L.layerGroup().addTo(map),      // last-seen point and familiar places
};

// A numbered round marker (used for spots and familiar places).
function numberIcon(text, extraClass = '') {
  return L.divIcon({
    className: '',
    html: `<div class="map-num ${extraClass}">${text}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Redraws the last-seen pin and familiar places.
function drawPins() {
  layers.pins.clearLayers();
  if (state.lastSeen) {
    L.circleMarker(state.lastSeen, { radius: 11, color: '#fff', weight: 3, fillColor: '#b00020', fillOpacity: 1 })
      .bindTooltip(t('lastSeenMarker'))
      .addTo(layers.pins);
  }
  state.familiarPlaces.forEach((place, i) => {
    L.marker(place, { icon: numberIcon('★' + (i + 1), 'familiar'), keyboard: false })
      .bindTooltip(place.label || t('familiarDefault', { n: i + 1 }))
      .addTo(layers.pins);
  });
}

// What a tap on the map does depends on the current mode.
map.on('click', (e) => {
  const point = { lat: e.latlng.lat, lng: e.latlng.lng };
  if (state.mode === 'lastSeen') {
    state.lastSeen = point;
    state.seed = newSeed(); // a new case gets a new seed
    setMode(null);
    showStatus(t('lastSeenSet'));
  } else if (state.mode === 'familiar') {
    if (state.familiarPlaces.length < MAX_FAMILIAR) {
      state.familiarPlaces.push({ ...point, label: '' });
      renderFamiliarList();
    }
    setMode(null);
  }
  drawPins();
});

function setMode(mode) {
  state.mode = mode;
  els.setLastSeen.setAttribute('aria-pressed', String(mode === 'lastSeen'));
  els.addFamiliar.setAttribute('aria-pressed', String(mode === 'familiar'));
  els.lastSeenHelp.hidden = mode !== 'lastSeen';
  if (mode === 'familiar') showStatus(t('tapFamiliar'));
  if (mode === 'lastSeen') showStatus(t('tapLastSeen'));
}

// ---- Status messages -------------------------------------------------------------

let statusTimer = null;

// Shows a short message over the map. Errors stay until the next message.
function showStatus(text, { error = false, sticky = false } = {}) {
  clearTimeout(statusTimer);
  els.status.textContent = text;
  els.status.classList.toggle('error', error);
  els.status.hidden = false;
  if (!error && !sticky) statusTimer = setTimeout(() => { els.status.hidden = true; }, 4000);
}
function hideStatus() {
  els.status.hidden = true;
}

// ---- Inputs ------------------------------------------------------------------------

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function buildDirectionOptions() {
  const current = els.direction.value;
  els.direction.innerHTML = '';
  els.direction.append(new Option(t('dirUnknown'), ''));
  for (const d of DIRECTIONS) els.direction.append(new Option(t('dir_' + d), d));
  els.direction.value = current;
}

function buildLanguageOptions() {
  els.language.innerHTML = '';
  for (const [code, name] of Object.entries(i18n.LANGUAGES)) els.language.append(new Option(name, code));
  els.language.value = i18n.getLanguage();
}

function renderFamiliarList() {
  els.familiarList.innerHTML = '';
  state.familiarPlaces.forEach((place, i) => {
    const li = document.createElement('li');

    const name = document.createElement('input');
    name.type = 'text';
    name.value = place.label;
    name.placeholder = t('familiarDefault', { n: i + 1 });
    name.setAttribute('aria-label', t('familiarName'));
    name.addEventListener('input', () => { place.label = name.value; drawPins(); });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = t('remove');
    remove.addEventListener('click', () => {
      state.familiarPlaces.splice(i, 1);
      renderFamiliarList();
      drawPins();
    });

    li.append(name, remove);
    els.familiarList.append(li);
  });
  els.addFamiliar.disabled = state.familiarPlaces.length >= MAX_FAMILIAR;
}

function readMobility() {
  return document.querySelector('input[name="mobility"]:checked').value;
}
function setMobility(value) {
  document.querySelector(`input[name="mobility"][value="${value}"]`).checked = true;
}

// Builds the CaseInput the engine expects (see INTERFACES.md).
function readCase() {
  return {
    lastSeen: state.lastSeen,
    minutes: Number(els.minutes.value),
    direction: els.direction.value || null,
    mobility: readMobility(),
    familiarPlaces: state.familiarPlaces.map((p, i) => ({ lat: p.lat, lng: p.lng, label: p.label || t('familiarDefault', { n: i + 1 }) })),
    seed: state.seed,
  };
}

// ---- Running the prediction -------------------------------------------------------

let areaCache = { key: null, area: null, osm: null }; // so a re-run on the same area is fast

function setBusy(busy) {
  els.run.disabled = busy;
  els.demo.disabled = busy;
}

// Lets the browser repaint (show "Working…") before heavy work starts.
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function runPrediction({ useDemoData = false } = {}) {
  if (!state.lastSeen) { showStatus(t('needLastSeen'), { error: true }); setMode('lastSeen'); return; }
  const caseInput = readCase();
  if (!(caseInput.minutes > 0)) { showStatus(t('needMinutes'), { error: true }); els.minutes.focus(); return; }

  setBusy(true);
  try {
    // 1. Street and creek data (saved copy if we have one).
    const key = useDemoData ? 'demo' : data.areaKey(caseInput.lastSeen.lat, caseInput.lastSeen.lng);
    if (areaCache.key !== key) {
      showStatus(t('loadingData'), { sticky: true });
      let loaded;
      try {
        loaded = useDemoData
          ? await data.loadBundledArea()
          : await data.loadArea(caseInput.lastSeen.lat, caseInput.lastSeen.lng);
      } catch (err) {
        console.error(err);
        showStatus(t('dataError'), { error: true });
        return;
      }
      if (loaded.fromCache && loaded.savedAt) showStatus(t('usingSaved', { date: i18n.formatDateTime(loaded.savedAt) }));
      await nextFrame();
      areaCache = { key, area: engine.prepareArea(loaded.osm), osm: loaded.osm };
      drawStreets(loaded.osm);
    }

    // 2. The engine works out where they may be.
    showStatus(t('calculating'), { sticky: true });
    await nextFrame();
    const prediction = engine.replay(areaCache.area, caseInput, []);

    // 3. Draw it.
    drawHeat(areaCache.area, prediction);
    state.lastSpots = engine.topSpots(areaCache.area, prediction, SPOTS_MAX);
    state.showAllSpots = false;
    renderSpots();
    hideStatus();
  } finally {
    setBusy(false);
  }
}

// ---- Drawing results ---------------------------------------------------------------

// Thin grey lines for every walkable street and path.
function drawStreets(osm) {
  layers.streets.clearLayers();
  const nodeById = new Map(osm.nodes.map((n) => [n.id, n]));
  for (const way of osm.ways) {
    const line = way.nodeIds.map((id) => nodeById.get(id)).filter(Boolean).map((n) => [n.lat, n.lng]);
    L.polyline(line, { color: '#555', weight: 1.5, opacity: 0.6, interactive: false }).addTo(layers.streets);
  }
}

// The heatmap: the most likely grid cells, brighter where the probability is higher.
function drawHeat(area, prediction) {
  const { p } = prediction.grid;
  const order = [...p.keys()].sort((a, b) => p[b] - p[a]).slice(0, HEAT_MAX_POINTS);
  const top = p[order[0]] || 1;
  const points = order.map((i) => {
    const { lat, lng } = engine.cellToLatLng(area, prediction.grid, i);
    return [lat, lng, p[i] / top];
  });
  if (layers.heat) map.removeLayer(layers.heat);
  // Neighboring points add up, so `max` is set above 1; otherwise everything turns red.
  layers.heat = L.heatLayer(points, { radius: 18, blur: 16, maxZoom: 16, max: 3, minOpacity: 0.2 }).addTo(map);
}

// One line of text for a spot, e.g. "Creek 130 ft off Main St".
function spotTitle(spot) {
  const trap = spot.trapType ? t('trap_' + spot.trapType) : null;
  const trapLabel = trap && spot.trapName ? `${trap} (${spot.trapName})` : trap;
  const dist = spot.distanceToStreetM != null ? i18n.formatDistance(spot.distanceToStreetM, state.units) : '';
  if (trapLabel && spot.streetName) return t('spotTrapStreet', { trap: trapLabel, dist, street: spot.streetName });
  if (trapLabel) return trapLabel;
  if (spot.streetName) return t('spotStreet', { street: spot.streetName });
  return t('spotUnnamed');
}

function renderSpots() {
  const spots = state.lastSpots;
  const shown = state.showAllSpots ? spots : spots.slice(0, SPOTS_SHOWN_FIRST);

  els.results.hidden = spots.length === 0;
  els.fakeNote.hidden = !engine.IS_FAKE;
  els.spots.innerHTML = '';
  layers.spots.clearLayers();

  shown.forEach((spot, i) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';

    const num = document.createElement('span');
    num.className = 'spot-num';
    num.textContent = String(i + 1);

    const text = document.createElement('span');
    text.className = 'spot-text';
    const title = document.createElement('strong');
    title.textContent = spotTitle(spot);
    const share = document.createElement('span');
    share.className = 'spot-share';
    share.textContent = t('spotShare', { pct: i18n.formatPercent(spot.walkerShare) });
    text.append(title, share);
    if (spot.hazard) {
      const hazard = document.createElement('span');
      hazard.className = 'spot-hazard';
      hazard.textContent = t('hazard');
      text.append(hazard);
    }

    button.append(num, text);
    button.addEventListener('click', () => map.flyTo([spot.lat, spot.lng], 18));
    li.append(button);
    els.spots.append(li);

    L.marker([spot.lat, spot.lng], { icon: numberIcon(i + 1) })
      .bindTooltip(spotTitle(spot))
      .addTo(layers.spots);
  });

  const hiddenCount = spots.length - SPOTS_SHOWN_FIRST;
  els.moreSpots.hidden = hiddenCount <= 0;
  els.moreSpots.textContent = state.showAllSpots ? t('showLess') : t('showMore', { n: hiddenCount });
}

// ---- Demo ---------------------------------------------------------------------------

async function runDemo() {
  state.lastSeen = { ...DEMO_CASE.lastSeen };
  state.familiarPlaces = DEMO_CASE.familiarPlaces.map((p) => ({ ...p }));
  state.seed = DEMO_CASE.seed;
  els.minutes.value = DEMO_CASE.minutes;
  els.direction.value = DEMO_CASE.direction;
  setMobility(DEMO_CASE.mobility);
  setMode(null);
  renderFamiliarList();
  drawPins();
  map.setView(DEMO_CASE.lastSeen, 15);
  await runPrediction({ useDemoData: true });
}

// ---- Language, units, emergency number ------------------------------------------------

function applyLanguage(code) {
  i18n.setLanguage(code);
  remember('lang', code);
  i18n.applyTranslations();
  buildDirectionOptions();
  renderFamiliarList();
  els.callText.textContent = t('callFirst', { number: state.emergencyNumber });
  els.panelToggle.textContent = els.panel.classList.contains('collapsed') ? t('showPanel') : t('hidePanel');
  if (state.lastSpots.length) renderSpots();
  drawPins();
}

function applyUnits(units) {
  state.units = units;
  remember('units', units);
  els.units.textContent = units === 'imperial' ? 'mi' : 'km';
  if (state.lastSpots.length) renderSpots();
}

// ---- Start-up -------------------------------------------------------------------------

function start() {
  const region = i18n.detectRegion();
  state.emergencyNumber = i18n.emergencyNumber(region);
  els.callLink.href = 'tel:' + state.emergencyNumber;

  i18n.setLanguage(recall('lang') || i18n.detectLanguage());
  buildLanguageOptions();
  applyLanguage(i18n.getLanguage());
  applyUnits(recall('units') || i18n.defaultUnits(region));

  els.setLastSeen.addEventListener('click', () => setMode(state.mode === 'lastSeen' ? null : 'lastSeen'));
  els.addFamiliar.addEventListener('click', () => {
    if (state.familiarPlaces.length >= MAX_FAMILIAR) { showStatus(t('maxFamiliar')); return; }
    setMode(state.mode === 'familiar' ? null : 'familiar');
  });
  els.run.addEventListener('click', () => runPrediction({ useDemoData: areaCache.key === 'demo' && isNearDemo() }));
  els.demo.addEventListener('click', runDemo);
  els.language.addEventListener('change', () => applyLanguage(els.language.value));
  els.units.addEventListener('click', () => applyUnits(state.units === 'imperial' ? 'metric' : 'imperial'));
  els.moreSpots.addEventListener('click', () => { state.showAllSpots = !state.showAllSpots; renderSpots(); });
  els.panelToggle.addEventListener('click', () => {
    const collapsed = els.panel.classList.toggle('collapsed');
    els.panelToggle.setAttribute('aria-expanded', String(!collapsed));
    els.panelToggle.textContent = collapsed ? t('showPanel') : t('hidePanel');
    setTimeout(() => map.invalidateSize(), 0); // the map got bigger or smaller
  });

  setMode('lastSeen');
}

// After a demo, re-running with a last-seen point still inside the demo area reuses the
// bundled demo data instead of downloading again.
function isNearDemo() {
  if (!state.lastSeen) return false;
  return map.distance(state.lastSeen, DEMO_LOCATION) < 2000;
}

start();
