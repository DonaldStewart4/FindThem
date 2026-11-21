// app.js — runs the page: the map, the inputs, and drawing the results.
//
// The flow:
//   0–1. "First steps": call emergency services, then check the house (a checklist).
//   2.   Tap the map to set where the person was last seen (and any familiar places),
//        then fill in minutes, direction and mobility.
//   3.   "Run search prediction": data.js loads the streets and creeks, the engine works
//        out where the person probably is, and we draw a heatmap, colored streets,
//        distance rings and a "Check these first" list.
//   4–6. "Next areas to search" gives each searcher an area and a walking route. Marking an
//        area searched, or reporting a sighting, adds an EVENT and the map is recomputed.
//
//   7.   "Share this search" puts the case in Firebase and gives a link. Everyone who opens
//        it sees the same live map, messages, searched areas and sightings (sync.js).
//   8.   "Hand-off sheet for police": a plain-text summary to copy, share or print.
//   9.   Report box: type or say a report; report.js asks the LLM proxy to fill in the
//        sighting form (or a message). Nothing is added until the person checks it and
//        taps the button. The LLM never touches the probabilities.
//   10.  Offline: sw.js keeps the app and viewed map tiles on the phone; "Save my home area"
//        downloads the streets around home ahead of time; a blue dot shows your own GPS
//        position (GPS works without cell signal).
//
// Every phone recomputes the same map from the same case + events.
// All on-screen words come from i18n.js (t('key')).

import * as data from './data.js';
import * as sync from './sync.js';
import * as report from './report.js';
import { databaseUrl, proxyUrl } from './config.js';
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
const SPOTS_SHOWN_FIRST = 3;          // the list shows 3, "Show more" reveals up to 8
const SPOTS_MAX = 8;
const HEAT_MAX_POINTS = 4000;         // the most likely grid cells we draw in the heatmap
const NEXT_AREAS = 3;                 // how many "next areas to search" we suggest
const DEFAULT_SEARCH_MINUTES = 20;    // effort per searcher when ranking areas
const RING_METERS = [804.672, 1609.344, 2414.016]; // 0.5, 1 and 1.5 miles
// Streets used by more walkers get darker and thicker (5 steps, light to dark purple).
const STREET_COLORS = ['#d9ccf0', '#b39ddb', '#8e6cc6', '#6a3fb0', '#3f1d8a'];
const AREA_LETTERS = 'ABCDEFGH';

// ---- What the user has entered ---------------------------------------------------

const state = {
  lastSeen: null,          // { lat, lng }
  familiarPlaces: [],      // [{ lat, lng, label }]
  mode: 'lastSeen',        // what the next map tap does: 'lastSeen', 'familiar', 'sighting', or null
  seed: newSeed(),         // a new random seed for each new search
  events: [],              // 'searched' and 'sighting' events (see INTERFACES.md)
  prediction: null,        // the engine's latest answer
  units: 'imperial',
  showAllSpots: false,
  lastSpots: [],
  selectedArea: null,      // sector id the user opened in "Next areas"
  sightingDraft: null,     // { lat, lng } while a sighting is being reported
  // Sharing (Screen C)
  searchId: null,          // id of the shared search in Firebase, or null if not shared
  remoteEvents: [],        // events from Firebase (with their push ids)
  optimistic: [],          // events this phone sent that haven't come back from Firebase yet
  liveStatus: null,        // 'live' | 'reconnecting' | 'denied'
  unsubscribe: null,       // stops the live stream
  caseStartedAt: null,     // when this search started (ms), for the police sheet
  areaSource: 'live',      // 'demo' if the bundled Fremont data is used (shared with joiners)
  myName: '',
  engineEventsKey: '',     // lets us skip re-running the engine when only messages changed
  stopVoice: null,         // stops voice input while listening
  homeDraft: null,         // { lat, lng } chosen in "Save my home area", not saved yet
  home: null,              // { lat, lng, savedAt } saved home area
  gpsWatch: null,          // id from navigator.geolocation.watchPosition while showing my location
};

// A random whole number for the engine's random-number generator.
function newSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

// A unique id for an event made on this phone. (In Screen C, Firebase gives the ids.)
let eventCounter = 0;
function newEventId() {
  eventCounter += 1;
  return `local-${Date.now()}-${eventCounter}`;
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
  callButton: $('call-button'),
  firstSteps: $('first-steps'),
  status: $('status'),
  panel: $('panel'),
  panelToggle: $('panel-toggle'),
  results: $('results'),
  fakeNote: $('fake-note'),
  spots: $('spots'),
  moreSpots: $('more-spots'),
  reportSighting: $('report-sighting'),
  sightingForm: $('sighting-form'),
  sightingWhere: $('sighting-where'),
  sightingMinutes: $('sighting-minutes'),
  sightingDirection: $('sighting-direction'),
  sightingNote: $('sighting-note'),
  sightingSave: $('sighting-save'),
  sightingCancel: $('sighting-cancel'),
  sightingCheck: $('sighting-check'),
  reportOpen: $('report-open'),
  reportBox: $('report-box'),
  reportText: $('report-text'),
  reportVoice: $('report-voice'),
  reportRead: $('report-read'),
  reportStatus: $('report-status'),
  offlineBanner: $('offline-banner'),
  homeAddress: $('home-address'),
  homeFind: $('home-find'),
  homeTap: $('home-tap'),
  homeGps: $('home-gps'),
  homeSave: $('home-save'),
  homeStatus: $('home-status'),
  areas: $('areas'),
  myName: $('my-name'),
  share: $('share'),
  liveStatus: $('live-status'),
  shareLink: $('share-link'),
  messages: $('messages'),
  messageText: $('message-text'),
  messageSend: $('message-send'),
  handoff: $('handoff'),
  handoffDialog: $('handoff-dialog'),
  handoffText: $('handoff-text'),
  handoffCopy: $('handoff-copy'),
  handoffPrint: $('handoff-print'),
  handoffClose: $('handoff-close'),
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

// Layers we draw on top of the tiles (bottom to top).
const layers = {
  streets: L.layerGroup().addTo(map),   // thin grey street lines, so the map works without tiles
  used: L.layerGroup().addTo(map),      // streets colored by how many walkers used them
  heat: null,                            // the heatmap (made after a run)
  rings: L.layerGroup().addTo(map),     // dashed 0.5 / 1 / 1.5 mile rings
  searched: L.layerGroup().addTo(map),  // grey squares over areas already searched
  areas: L.layerGroup().addTo(map),     // blue squares for the next areas to search
  route: L.layerGroup().addTo(map),     // the walking route of the selected area
  spots: L.layerGroup().addTo(map),     // numbered "check these first" markers
  sightings: L.layerGroup().addTo(map), // reported sightings
  pins: L.layerGroup().addTo(map),      // last-seen point, familiar places, sighting draft, home
  me: L.layerGroup().addTo(map),        // my own GPS position (blue dot)
};

// A small square or round marker with text in it.
function labelIcon(text, className) {
  return L.divIcon({
    className: '',
    html: `<div class="${className}">${text}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Redraws the last-seen pin, familiar places and the sighting being reported.
function drawPins() {
  layers.pins.clearLayers();
  if (state.lastSeen) {
    L.circleMarker(state.lastSeen, { radius: 11, color: '#fff', weight: 3, fillColor: '#b00020', fillOpacity: 1 })
      .bindTooltip(t('lastSeenMarker'))
      .addTo(layers.pins);
  }
  state.familiarPlaces.forEach((place, i) => {
    L.marker(place, { icon: labelIcon('★' + (i + 1), 'map-num familiar'), keyboard: false })
      .bindTooltip(place.label || t('familiarDefault', { n: i + 1 }))
      .addTo(layers.pins);
  });
  if (state.sightingDraft) {
    L.marker(state.sightingDraft, { icon: labelIcon('!', 'map-sighting'), keyboard: false }).addTo(layers.pins);
  }
  const home = state.homeDraft || state.home;
  if (home) {
    L.marker(home, { icon: labelIcon('⌂', 'map-home'), keyboard: false }).bindTooltip(t('homeMarker')).addTo(layers.pins);
  }
}

// What a tap on the map does depends on the current mode.
map.on('click', (e) => {
  const point = { lat: e.latlng.lat, lng: e.latlng.lng };
  if (state.mode === 'lastSeen') {
    state.lastSeen = point;
    state.seed = newSeed();   // a new case gets a new seed...
    state.events = [];        // ...and starts with no searches or sightings
    leaveSharedSearch();      // ...and is not the shared search any more
    setMode(null);
    showStatus(t('lastSeenSet'));
  } else if (state.mode === 'familiar') {
    if (state.familiarPlaces.length < MAX_FAMILIAR) {
      state.familiarPlaces.push({ ...point, label: '' });
      renderFamiliarList();
    }
    setMode(null);
  } else if (state.mode === 'sighting') {
    state.sightingDraft = point;
    els.sightingWhere.textContent = t('sightingPlaced');
    showStatus(t('sightingPlaced'));
  } else if (state.mode === 'home') {
    setHomeDraft(point, `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`);
    setMode(null);
  }
  drawPins();
});

function setMode(mode) {
  state.mode = mode;
  els.setLastSeen.setAttribute('aria-pressed', String(mode === 'lastSeen'));
  els.addFamiliar.setAttribute('aria-pressed', String(mode === 'familiar'));
  els.reportSighting.setAttribute('aria-pressed', String(mode === 'sighting'));
  els.homeTap.setAttribute('aria-pressed', String(mode === 'home'));
  els.lastSeenHelp.hidden = mode !== 'lastSeen';
  if (mode === 'familiar') showStatus(t('tapFamiliar'));
  if (mode === 'lastSeen') showStatus(t('tapLastSeen'));
  if (mode === 'sighting') showStatus(t('tapSighting'));
  if (mode === 'home') showStatus(t('homeTapPrompt'));
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

// Fills a direction dropdown ("Unknown" + 8 compass directions) in the current language.
function buildDirectionOptions(select) {
  const current = select.value;
  select.innerHTML = '';
  select.append(new Option(t('dirUnknown'), ''));
  for (const d of DIRECTIONS) select.append(new Option(t('dir_' + d), d));
  select.value = current;
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

// Lets the browser repaint (show "Working…") before heavy work starts. A short timer, not
// requestAnimationFrame: that one never fires while the tab or app is in the background.
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 30));

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
    state.areaSource = useDemoData ? 'demo' : 'live';
    if (!state.caseStartedAt) state.caseStartedAt = Date.now();

    // 2. The engine works out where they may be, and we draw it.
    showStatus(t('calculating'), { sticky: true });
    await nextFrame();
    state.showAllSpots = false;
    state.selectedArea = null;
    recompute();
    els.firstSteps.open = false; // first steps are done once a search is running
    hideStatus();
  } finally {
    setBusy(false);
  }
}

// Runs the engine on the current case + all events, then redraws every result.
// Called after a run, after "searched", and after a sighting.
function recompute() {
  const caseInput = readCase();
  state.prediction = engine.replay(areaCache.area, caseInput, currentEvents());
  state.lastSpots = engine.topSpots(areaCache.area, state.prediction, SPOTS_MAX);
  state.engineEventsKey = engineEventsKey();
  drawResults();
}

// All events for this search: from Firebase, plus ones this phone sent that haven't
// come back yet (or are waiting for signal). Not shared: just this phone's events.
function currentEvents() {
  if (!state.searchId) return state.events;
  const seen = new Set(state.remoteEvents.map((e) => e.cid)); // cid = this event's id on its phone
  const waiting = [];
  for (const e of [...state.optimistic, ...sync.queuedEvents(state.searchId)]) {
    if (seen.has(e.cid)) continue; // already came back from Firebase (or listed twice)
    seen.add(e.cid);
    waiting.push({ ...e, id: 'z-' + e.cid }); // 'z-' sorts after real ids made at the same time
  }
  return [...state.remoteEvents, ...waiting];
}

// A short fingerprint of the events the engine uses (not messages).
function engineEventsKey() {
  return currentEvents()
    .filter((e) => e.type === 'searched' || e.type === 'sighting')
    .map((e) => e.cid || e.id)
    .join(',');
}

// Records a new event: on this phone, and in Firebase if the search is shared.
function recordEvent(event) {
  const ev = { ...event, cid: newEventId(), by: state.myName, at: Date.now() };
  if (state.searchId) {
    state.optimistic.push(ev);
    sync.addEvent(state.searchId, ev).then(renderLiveStatus);
  } else {
    state.events.push(ev);
  }
  if (ev.type === 'message') renderMessages();
  else recompute();
}

// Redraws everything that depends on the prediction (also used when language/units change).
function drawResults() {
  if (!state.prediction) return;
  const area = areaCache.area;
  drawUsedStreets(area, state.prediction);
  drawHeat(area, state.prediction);
  drawRings(state.lastSeen);
  drawSearched(state.prediction);
  drawSightings();
  renderSpots();
  renderAreas();
  renderMessages();
  renderLiveStatus();
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

// Streets colored light → dark by how many simulated walkers used them.
// Uses a log scale, so a street with 10× more walkers is a few shades darker, not off the chart.
function drawUsedStreets(area, prediction) {
  layers.used.clearLayers();
  const counts = prediction.sim.edgeCounts;
  const max = counts.reduce((m, c) => (c > m ? c : m), 0);
  if (max === 0) return;
  const { nodes, edges } = area.graph;
  counts.forEach((count, i) => {
    if (count === 0) return;
    const step = Math.min(STREET_COLORS.length - 1, Math.floor((Math.log(count + 1) / Math.log(max + 1)) * STREET_COLORS.length));
    const a = nodes[edges[i].a];
    const b = nodes[edges[i].b];
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
      color: STREET_COLORS[step], weight: 2 + step, opacity: 0.9, interactive: false,
    }).addTo(layers.used);
  });
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

// Dashed rings at 0.5, 1 and 1.5 miles, each labeled in the chosen units.
function drawRings(center) {
  layers.rings.clearLayers();
  for (const r of RING_METERS) {
    L.circle(center, { radius: r, color: '#111', weight: 2, dashArray: '6 8', fill: false, interactive: false }).addTo(layers.rings);
    const top = { lat: center.lat + r / 111320, lng: center.lng }; // the ring's northern edge
    L.tooltip({ permanent: true, direction: 'center', className: 'ring-label' })
      .setLatLng(top)
      .setContent(i18n.formatDistance(r, state.units))
      .addTo(layers.rings);
  }
}

// Grey squares over areas that have been searched.
function drawSearched(prediction) {
  layers.searched.clearLayers();
  for (const s of prediction.grid.sectors) {
    if (!s.searchedMinutes) continue;
    L.rectangle(s.bounds, { color: '#555', weight: 1, fillColor: '#777', fillOpacity: 0.35, interactive: false })
      .addTo(layers.searched);
  }
}

// Orange "!" markers for reported sightings.
function drawSightings() {
  layers.sightings.clearLayers();
  for (const ev of state.events) {
    if (ev.type !== 'sighting') continue;
    const text = ev.note ? `${t('sightingMarker')}: ${ev.note}` : t('sightingMarker');
    L.marker([ev.lat, ev.lng], { icon: labelIcon('!', 'map-sighting') }).bindTooltip(text).addTo(layers.sightings);
  }
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

    L.marker([spot.lat, spot.lng], { icon: labelIcon(i + 1, 'map-num') })
      .bindTooltip(spotTitle(spot))
      .addTo(layers.spots);
  });

  const hiddenCount = spots.length - SPOTS_SHOWN_FIRST;
  els.moreSpots.hidden = hiddenCount <= 0;
  els.moreSpots.textContent = state.showAllSpots ? t('showLess') : t('showMore', { n: hiddenCount });
}

// ---- Next areas to search -------------------------------------------------------------

// Lists the engine's best areas (A, B, C) with their walking routes. Opening one shows
// its route on the map and a "Searched, nobody found" button.
function renderAreas() {
  const area = areaCache.area;
  const prediction = state.prediction;
  const next = engine.nextSectors(prediction, DEFAULT_SEARCH_MINUTES, NEXT_AREAS);
  if (!next.some((n) => n.sectorId === state.selectedArea)) state.selectedArea = null;

  els.areas.innerHTML = '';
  layers.areas.clearLayers();
  layers.route.clearLayers();

  next.forEach((choice, i) => {
    const letter = AREA_LETTERS[i];
    const sector = prediction.grid.sectors.find((s) => s.id === choice.sectorId);
    const route = engine.routeFor(area, prediction, choice.sectorId);
    const selected = state.selectedArea === choice.sectorId;

    // On the map: a blue square with its letter.
    L.rectangle(sector.bounds, {
      color: '#0b57d0', weight: selected ? 4 : 2, dashArray: selected ? null : '4 6', fill: false, interactive: false,
    }).addTo(layers.areas);
    L.marker([sector.bounds[1][0], sector.bounds[0][1]], { icon: labelIcon(letter, 'map-letter'), keyboard: false })
      .addTo(layers.areas);
    if (selected && route.points.length) {
      L.polyline(route.points.map((p) => [p.lat, p.lng]), { color: '#0b57d0', weight: 6, opacity: 0.85 }).addTo(layers.route);
    }

    // In the list.
    const li = document.createElement('li');
    li.classList.toggle('selected', selected);

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'area-head';
    head.setAttribute('aria-expanded', String(selected));
    const badge = document.createElement('span');
    badge.className = 'area-letter';
    badge.textContent = letter;
    const text = document.createElement('span');
    text.className = 'spot-text';
    const title = document.createElement('strong');
    title.textContent = t('areaLabel', { n: letter });
    const chance = document.createElement('span');
    chance.className = 'spot-share';
    chance.textContent = t('areaChance', { pct: i18n.formatPercent(sector.probability) });
    const routeLine = document.createElement('span');
    routeLine.className = route.points.length ? 'spot-share' : 'spot-hazard';
    routeLine.textContent = route.points.length
      ? ' · ' + t('routeInfo', { dist: i18n.formatDistance(route.lengthM, state.units), min: Math.round(route.minutes) })
      : t('noRoute');
    text.append(title, chance, routeLine);
    if (sector.searchedMinutes) {
      const done = document.createElement('span');
      done.className = 'area-searched';
      done.textContent = t('searchedMinutes', { min: sector.searchedMinutes });
      text.append(done);
    }
    head.append(badge, text);
    head.addEventListener('click', () => {
      state.selectedArea = selected ? null : choice.sectorId;
      renderAreas();
      if (!selected) map.flyToBounds(sector.bounds, { padding: [30, 30], maxZoom: 17 });
    });
    li.append(head);

    if (selected) {
      const body = document.createElement('div');
      body.className = 'area-body';
      const id = `minutes-${choice.sectorId}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = t('minutesSpent');
      const input = document.createElement('input');
      input.id = id;
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = '1';
      input.value = String(Math.max(1, Math.round(route.minutes || DEFAULT_SEARCH_MINUTES)));
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'big primary';
      done.textContent = t('markSearched');
      done.addEventListener('click', () => markSearched(choice.sectorId, Number(input.value)));
      body.append(label, input, done);
      li.append(body);
    }

    els.areas.append(li);
  });
}

// Adds a "searched, nobody found" event and recomputes the map.
function markSearched(sectorId, minutes) {
  if (!(minutes > 0)) return;
  state.selectedArea = null;
  recordEvent({ type: 'searched', sectorId, minutes });
  showStatus(t('searchedDone'));
}

// ---- Sightings --------------------------------------------------------------------------

// Opens the sighting form, empty, or filled in from a report-box draft (which the person
// then checks and fixes before tapping "Add sighting to the map").
function openSightingForm({ draft = null } = {}) {
  if (!state.prediction) { showStatus(t('needRunFirst'), { error: true }); return; }
  state.sightingDraft = null;
  els.sightingWhere.textContent = t('tapSighting');
  els.sightingMinutes.value = draft && draft.minutesSince != null ? String(draft.minutesSince) : '0';
  els.sightingDirection.value = (draft && draft.direction) || '';
  els.sightingNote.value = (draft && draft.note) || '';
  const sure = draft ? String(draft.reliability) : '0.6';
  const radio = document.querySelector(`input[name="sure"][value="${sure}"]`);
  if (radio) radio.checked = true;
  els.sightingCheck.hidden = !draft;
  els.sightingForm.hidden = false;
  setMode('sighting');
  if (draft && draft.lat != null && draft.lng != null) {
    // The report named a place we could pin: show it; a tap on the map still moves it.
    state.sightingDraft = { lat: draft.lat, lng: draft.lng };
    els.sightingWhere.textContent = t('sightingPlaced');
    showStatus(t('sightingPlaced'));
    drawPins();
    map.flyTo([draft.lat, draft.lng], 17);
  } else if (draft) {
    showStatus(t('reportNeedPin'), { sticky: true });
  }
  els.sightingForm.scrollIntoView({ block: 'start' });
}

function closeSightingForm() {
  state.sightingDraft = null;
  els.sightingForm.hidden = true;
  els.sightingCheck.hidden = true;
  setMode(null);
  drawPins();
}

function saveSighting() {
  if (!state.sightingDraft) { showStatus(t('needSightingPlace'), { error: true }); return; }
  const sighting = {
    type: 'sighting',
    lat: state.sightingDraft.lat,
    lng: state.sightingDraft.lng,
    direction: els.sightingDirection.value || null,
    minutesSince: Math.max(0, Number(els.sightingMinutes.value) || 0),
    reliability: Number(document.querySelector('input[name="sure"]:checked').value),
    note: els.sightingNote.value.trim(),
  };
  closeSightingForm();
  recordEvent(sighting);
  showStatus(t('sightingAdded'));
}

// ---- Report box (type or speak) ---------------------------------------------------------

function toggleReportBox() {
  const opening = els.reportBox.hidden;
  els.reportBox.hidden = !opening;
  els.reportOpen.setAttribute('aria-expanded', String(opening));
  if (opening) els.reportText.focus();
  else stopListening();
}

function toggleVoice() {
  if (state.stopVoice) { stopListening(); return; }
  els.reportStatus.textContent = '';
  els.reportVoice.setAttribute('aria-pressed', 'true');
  els.reportVoice.textContent = t('reportListening');
  state.stopVoice = report.startVoice(
    i18n.getLanguage(),
    (text) => { els.reportText.value = text; },             // words appear as they're heard
    (code) => { els.reportStatus.textContent = code === 'no_speech' ? t('voiceNoSpeech') : t('voiceDenied'); },
    resetVoiceButton,                                         // listening stopped
  );
}

function stopListening() {
  if (state.stopVoice) state.stopVoice();
  resetVoiceButton();
}

function resetVoiceButton() {
  state.stopVoice = null;
  els.reportVoice.setAttribute('aria-pressed', 'false');
  els.reportVoice.textContent = t('reportSpeak');
}

// Named streets near the last-seen point, nearest first. Sent with the report so the
// LLM can pin a place like "the corner of Paseo Padre and Stevenson".
function nearbyStreetNames(limit = 50) {
  if (!areaCache.osm || !state.lastSeen) return [];
  const nodeById = new Map(areaCache.osm.nodes.map((n) => [n.id, n]));
  const best = new Map(); // name -> distance in meters
  for (const way of areaCache.osm.ways) {
    if (!way.name) continue;
    const n = nodeById.get(way.nodeIds[0]);
    if (!n) continue;
    const d = map.distance(state.lastSeen, [n.lat, n.lng]);
    if (!best.has(way.name) || d < best.get(way.name)) best.set(way.name, d);
  }
  return [...best.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([name]) => name);
}

// Sends the report to the proxy and puts the answer into a form for the person to check.
async function readReport() {
  const text = els.reportText.value.trim();
  if (!text) { els.reportStatus.textContent = t('reportEmpty'); return; }
  if (!state.prediction) { showStatus(t('needRunFirst'), { error: true }); return; }
  stopListening();
  els.reportStatus.textContent = t('reportReading');
  els.reportRead.disabled = true;

  let draft;
  try {
    draft = await report.parseReport(text, { lastSeen: state.lastSeen, streetNames: nearbyStreetNames() }, i18n.getLanguage());
  } catch (err) {
    // Whatever went wrong, the manual form is always the way out.
    if (err.message === 'offline') els.reportStatus.textContent = t('reportOffline');
    else if (!report.isProxyConfigured()) els.reportStatus.textContent = t('reportNotSetUp');
    else els.reportStatus.textContent = t('reportFailed');
    openSightingForm();
    return;
  } finally {
    els.reportRead.disabled = false;
  }

  els.reportStatus.textContent = '';
  if (draft.kind === 'sighting') {
    els.reportText.value = '';
    toggleReportBox(); // close it, so the filled-in form is right there
    openSightingForm({ draft });
  } else if (draft.kind === 'message') {
    els.reportText.value = '';
    toggleReportBox();
    els.messageText.value = draft.note || draft.placeText;
    els.messageText.scrollIntoView({ block: 'center' });
    showStatus(t('reportMessageReady'));
  } else {
    // 'searched' needs an area from the map, which the person picks under "Next areas".
    els.reportStatus.textContent = t('reportSearched');
  }
}

// ---- Offline ---------------------------------------------------------------------------

// The service worker (sw.js) keeps the app on the phone so it opens with no signal.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return; // very old browsers: the app still works online
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable', err));
}

// Yellow "You're offline" line under the emergency banner.
function showOnlineState(online) {
  els.offlineBanner.hidden = online;
  setTimeout(() => map.invalidateSize(), 0); // the map's height changed
}

// ---- My location (blue dot) ------------------------------------------------------------

// A round button under the zoom buttons. GPS works without cell signal.
const LocateControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd() {
    const box = L.DomUtil.create('div', 'leaflet-bar');
    const button = L.DomUtil.create('button', 'locate-button', box);
    button.type = 'button';
    button.textContent = '◎';
    button.setAttribute('aria-pressed', 'false');
    L.DomEvent.disableClickPropagation(box); // a tap on the button isn't a tap on the map
    L.DomEvent.on(button, 'click', toggleMyLocation);
    els.locateButton = button;
    return box;
  },
});

function toggleMyLocation() {
  if (state.gpsWatch !== null) {
    navigator.geolocation.clearWatch(state.gpsWatch);
    state.gpsWatch = null;
    layers.me.clearLayers();
    els.locateButton.setAttribute('aria-pressed', 'false');
    return;
  }
  if (!navigator.geolocation) { showStatus(t('locationDenied'), { error: true }); return; }
  showStatus(t('locating'), { sticky: true });
  els.locateButton.setAttribute('aria-pressed', 'true');
  let first = true;
  state.gpsWatch = navigator.geolocation.watchPosition(
    (pos) => {
      const here = [pos.coords.latitude, pos.coords.longitude];
      layers.me.clearLayers();
      L.circle(here, { radius: pos.coords.accuracy, color: '#0b57d0', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(layers.me);
      L.circleMarker(here, { radius: 9, color: '#fff', weight: 3, fillColor: '#0b57d0', fillOpacity: 1 })
        .bindTooltip(t('youAreHere'))
        .addTo(layers.me);
      if (first) { map.flyTo(here, Math.max(map.getZoom(), 16)); hideStatus(); first = false; }
    },
    () => {
      showStatus(t('locationDenied'), { error: true });
      toggleMyLocation(); // stop watching
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  );
}

// ---- Save my home area -----------------------------------------------------------------

function setHomeDraft(point, label) {
  state.homeDraft = { lat: point.lat, lng: point.lng };
  els.homeStatus.textContent = t('homePicked', { place: label });
  drawPins();
  map.flyTo([point.lat, point.lng], 15);
}

async function findHomeAddress() {
  const query = els.homeAddress.value.trim();
  if (!query) return;
  els.homeFind.disabled = true;
  try {
    const found = await data.geocode(query);
    if (found) setHomeDraft(found, found.label.split(',').slice(0, 3).join(','));
    else els.homeStatus.textContent = t('homeNotFound');
  } catch {
    els.homeStatus.textContent = t('homeSearchFailed');
  } finally {
    els.homeFind.disabled = false;
  }
}

function useMyLocationForHome() {
  if (!navigator.geolocation) { els.homeStatus.textContent = t('locationDenied'); return; }
  els.homeStatus.textContent = t('locating');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setHomeDraft(p, `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
    },
    () => { els.homeStatus.textContent = t('locationDenied'); },
    { enableHighAccuracy: true, timeout: 30000 },
  );
}

async function saveHomeArea() {
  const point = state.homeDraft || state.home;
  if (!point) { els.homeStatus.textContent = t('homeNeedPoint'); return; }
  els.homeSave.disabled = true;
  els.homeStatus.textContent = t('homeSaving');
  try {
    const result = await data.loadArea(point.lat, point.lng); // downloads and stores it (or finds it saved)
    state.home = { lat: point.lat, lng: point.lng, savedAt: result.savedAt };
    state.homeDraft = null;
    remember('home', JSON.stringify(state.home));
    showHomeSaved();
    drawPins();
  } catch (err) {
    console.error(err);
    els.homeStatus.textContent = t('homeSaveFailed');
  } finally {
    els.homeSave.disabled = false;
  }
}

function showHomeSaved() {
  if (state.home && state.home.savedAt) {
    els.homeStatus.textContent = t('homeSaved', { date: i18n.formatDateTime(state.home.savedAt) });
  }
}

// ---- Demo ---------------------------------------------------------------------------

async function runDemo() {
  state.lastSeen = { ...DEMO_CASE.lastSeen };
  state.familiarPlaces = DEMO_CASE.familiarPlaces.map((p) => ({ ...p }));
  state.seed = DEMO_CASE.seed;
  state.events = [];
  state.caseStartedAt = null;
  leaveSharedSearch();
  els.minutes.value = DEMO_CASE.minutes;
  els.direction.value = DEMO_CASE.direction;
  setMobility(DEMO_CASE.mobility);
  els.sightingForm.hidden = true;
  state.sightingDraft = null;
  setMode(null);
  renderFamiliarList();
  drawPins();
  map.setView(DEMO_CASE.lastSeen, 15);
  await runPrediction({ useDemoData: true });
}

// ---- Sharing: create, join, live updates --------------------------------------------------

// The case packed into the link itself, so a link shows the same map even if the live
// database can't be reached. Short keys keep the link short.
function encodeCase(c) {
  const packed = {
    la: +c.lastSeen.lat.toFixed(6), ln: +c.lastSeen.lng.toFixed(6), m: c.minutes, d: c.direction,
    mo: c.mobility, s: c.seed, f: c.familiarPlaces.map((p) => [+p.lat.toFixed(6), +p.lng.toFixed(6), p.label]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(packed));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCase(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const p = JSON.parse(new TextDecoder().decode(bytes));
  return {
    lastSeen: { lat: p.la, lng: p.ln }, minutes: p.m, direction: p.d || null, mobility: p.mo || 'normal',
    seed: p.s >>> 0, familiarPlaces: (p.f || []).map(([lat, lng, label]) => ({ lat, lng, label: label || '' })),
  };
}

// The link to share: this page + #s=<search id>&c=<case>&a=<demo|live>.
// (On your own computer, ?db=... is kept so tabs use the same test database.)
function shareLink() {
  const params = new URLSearchParams();
  if (state.searchId) params.set('s', state.searchId);
  params.set('c', encodeCase(readCase()));
  params.set('a', state.areaSource);
  return `${location.origin}${location.pathname}${location.search}#${params}`;
}

// Fills the inputs from a case (when opening a shared link).
function applyCase(c) {
  state.lastSeen = { ...c.lastSeen };
  state.seed = c.seed;
  state.familiarPlaces = (c.familiarPlaces || []).map((p) => ({ lat: p.lat, lng: p.lng, label: p.label || '' }));
  els.minutes.value = c.minutes;
  els.direction.value = c.direction || '';
  setMobility(c.mobility || 'normal');
  renderFamiliarList();
  drawPins();
  map.setView(state.lastSeen, 15);
}

async function shareSearch() {
  if (!state.prediction) { showStatus(t('needRunFirst'), { error: true }); return; }
  saveName();

  // First share: create the shared search and move this phone's events into it.
  if (!state.searchId && sync.isConfigured()) {
    const id = sync.newSearchId();
    const caseDoc = { ...readCase(), area: state.areaSource, startedBy: state.myName, startedAt: state.caseStartedAt };
    const result = await sync.createSearch(id, caseDoc);
    if (result.ok) {
      const local = state.events;
      state.events = [];
      startLive(id);
      for (const ev of local) {
        state.optimistic.push(ev);
        await sync.addEvent(id, ev);
      }
    } else {
      showStatus(t('liveDenied'), { error: true });
    }
  }

  const link = shareLink();
  els.shareLink.hidden = true;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'FindThem', text: t('shareText'), url: link });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // the person closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    showStatus(t('linkCopied'));
  } catch {
    // Couldn't copy by itself: show the link so the person can copy it.
    els.shareLink.value = link;
    els.shareLink.hidden = false;
    els.shareLink.select();
    showStatus(t('copyThisLink'));
  }
  renderLiveStatus();
}

// Starts listening to a shared search. Every change re-draws the map (if needed).
function startLive(searchId) {
  if (state.unsubscribe) state.unsubscribe();
  state.searchId = searchId;
  state.remoteEvents = [];
  history.replaceState(null, '', shareLinkPathWithHash());
  state.unsubscribe = sync.subscribe(
    searchId,
    (caseDoc, events) => {
      state.remoteEvents = events;
      const back = new Set(events.map((e) => e.cid));
      state.optimistic = state.optimistic.filter((e) => !back.has(e.cid));
      if (caseDoc && caseDoc.startedAt && !state.caseStartedAt) state.caseStartedAt = caseDoc.startedAt;
      if (state.prediction && engineEventsKey() !== state.engineEventsKey) recompute();
      else { renderMessages(); renderLiveStatus(); }
    },
    (status) => { state.liveStatus = status; renderLiveStatus(); },
  );
  renderLiveStatus();
}

function shareLinkPathWithHash() {
  return state.lastSeen ? shareLink().replace(location.origin, '') : location.pathname + location.search;
}

function leaveSharedSearch() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.searchId = null;
  state.remoteEvents = [];
  state.optimistic = [];
  state.liveStatus = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  renderLiveStatus();
}

// Opening a shared link: fill in the case, run the map, and join the live search.
async function joinFromLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const searchId = params.get('s');
  const packedCase = params.get('c');
  if (!searchId && !packedCase) return false;

  let caseInput = null;
  if (packedCase) {
    try { caseInput = decodeCase(packedCase); } catch (err) { console.warn('Bad case in link', err); }
  }
  // The database copy of the case wins, if we can reach it.
  if (searchId && sync.isConfigured()) {
    try {
      const { caseDoc } = await sync.loadSearch(searchId);
      if (caseDoc) {
        caseInput = caseDoc;
        if (caseDoc.startedAt) state.caseStartedAt = caseDoc.startedAt;
        if (caseDoc.area) params.set('a', caseDoc.area);
      }
    } catch {
      showStatus(t('joinFailed'));
    }
  }
  if (!caseInput) return false;

  applyCase(caseInput);
  state.events = [];
  state.areaSource = params.get('a') === 'demo' ? 'demo' : 'live'; // before startLive saves the link
  if (searchId && sync.isConfigured()) startLive(searchId);
  els.firstSteps.open = false;
  await runPrediction({ useDemoData: params.get('a') === 'demo' });
  if (state.searchId) showStatus(t('joinedSearch'));
  return true;
}

function renderLiveStatus() {
  let text;
  if (!state.searchId) text = sync.isConfigured() ? t('localOnly') : t('syncNotSetUp');
  else if (state.liveStatus === 'denied') text = t('liveDenied');
  else if (state.liveStatus === 'reconnecting') text = t('liveReconnecting');
  else text = t('liveOn');
  const waiting = state.searchId ? sync.queuedEvents(state.searchId).length : 0;
  if (waiting) text += ' ' + t('queued', { n: waiting });
  els.liveStatus.textContent = text;
}

function saveName() {
  state.myName = els.myName.value.trim().slice(0, 40);
  remember('name', state.myName);
}

// ---- Messages -------------------------------------------------------------------------------

function renderMessages() {
  const messages = currentEvents().filter((e) => e.type === 'message').sort((a, b) => a.at - b.at);
  els.messages.innerHTML = '';
  if (!messages.length) {
    const li = document.createElement('li');
    li.className = 'help';
    li.textContent = t('noMessages');
    els.messages.append(li);
    return;
  }
  for (const m of messages) {
    const li = document.createElement('li');
    if (m.by && m.by === state.myName) li.classList.add('mine');
    const who = document.createElement('span');
    who.className = 'msg-who';
    who.textContent = m.by || t('someone');
    const when = document.createElement('span');
    when.className = 'msg-time';
    when.textContent = i18n.formatTime(m.at);
    const text = document.createElement('div');
    text.textContent = m.text; // textContent, never innerHTML: messages come from other people
    li.append(who, when, text);
    els.messages.append(li);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function sendMessage() {
  const text = els.messageText.value.trim();
  if (!text) return;
  saveName();
  recordEvent({ type: 'message', text: text.slice(0, 300) });
  els.messageText.value = '';
}

// ---- Police hand-off sheet -----------------------------------------------------------------

const coords = (p) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

// The sheet as plain text, in one language.
function handoffText(lang) {
  const tr = (key, vars) => i18n.tIn(lang, key, vars);
  const c = readCase();
  const started = state.caseStartedAt || Date.now();
  const lines = [];
  lines.push(tr('handoffTitle'), '='.repeat(30));
  lines.push(tr('handoffMade', { time: i18n.formatDateTime(new Date().toISOString()) }), '');
  lines.push(tr('handoffLastSeen', { coords: coords(c.lastSeen), time: i18n.formatTime(started - c.minutes * 60000), min: c.minutes }));
  lines.push(tr('handoffWalks', { mobility: tr('mob_' + c.mobility) }));
  lines.push(tr('handoffHeading', { direction: c.direction ? tr('dir_' + c.direction) : tr('dirUnknown') }));
  if (c.familiarPlaces.length) {
    lines.push(tr('handoffFamiliar', { list: c.familiarPlaces.map((p) => `${p.label} (${coords(p)})`).join('; ') }));
  }

  lines.push('', tr('handoffTimeline'), '-'.repeat(30));
  const events = currentEvents().slice().sort((a, b) => a.at - b.at);
  const sure = { 0.3: 'sure_low', 0.6: 'sure_mid', 0.9: 'sure_high' };
  if (!events.some((e) => e.type === 'searched' || e.type === 'sighting')) lines.push(tr('handoffNothing'));
  for (const ev of events) {
    const time = i18n.formatTime(ev.at);
    const by = ev.by || tr('someone');
    if (ev.type === 'searched') {
      const sector = state.prediction.grid.sectors.find((s) => s.id === ev.sectorId);
      lines.push(tr('handoffSearched', {
        time, by, coords: sector ? coords(sector.center) : ev.sectorId, min: ev.minutes,
        pod: i18n.formatPercent(sector ? sector.pod : 0),
      }));
    } else if (ev.type === 'sighting') {
      lines.push(tr('handoffSighting', {
        time, by, coords: coords(ev), min: ev.minutesSince, sure: tr(sure[ev.reliability] || 'sure_mid'), note: ev.note || '',
      }).trim());
    } else if (ev.type === 'message') {
      lines.push(tr('handoffMessage', { time, by, text: ev.text }));
    }
  }

  lines.push('', tr('handoffTop'), '-'.repeat(30));
  state.lastSpots.forEach((spot, i) => {
    lines.push(tr('handoffSpot', { n: i + 1, title: spotTitleIn(lang, spot), coords: coords(spot), pct: i18n.formatPercent(spot.probability) }));
  });

  lines.push('', tr('handoffLink', { url: shareLink() }), '', tr('handoffNote'));
  return lines.join('\n');
}

// spotTitle() in a given language (for the English copy).
function spotTitleIn(lang, spot) {
  const saved = i18n.getLanguage();
  i18n.setLanguage(lang);
  try { return spotTitle(spot); } finally { i18n.setLanguage(saved); }
}

function openHandoff() {
  if (!state.prediction) { showStatus(t('needRunFirst'), { error: true }); return; }
  const lang = i18n.getLanguage();
  let text = handoffText(lang);
  if (lang !== 'en') text += `\n\n\n— ${t('handoffEnglish')} —\n\n` + handoffText('en');
  els.handoffText.textContent = text;
  els.handoffDialog.showModal();
}

async function copyHandoff() {
  try {
    await navigator.clipboard.writeText(els.handoffText.textContent);
    showStatus(t('copied'));
  } catch {
    // Select the text so the person can copy it by hand.
    const range = document.createRange();
    range.selectNodeContents(els.handoffText);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }
}

// ---- Language, units, emergency number ------------------------------------------------

function applyLanguage(code) {
  i18n.setLanguage(code);
  remember('lang', code);
  i18n.applyTranslations();
  buildDirectionOptions(els.direction);
  buildDirectionOptions(els.sightingDirection);
  renderFamiliarList();
  els.callText.textContent = t('callFirst', { number: state.emergencyNumber });
  els.callButton.textContent = t('call911Title', { number: state.emergencyNumber });
  els.panelToggle.textContent = els.panel.classList.contains('collapsed') ? t('showPanel') : t('hidePanel');
  if (state.sightingDraft) els.sightingWhere.textContent = t('sightingPlaced');
  if (els.locateButton) {
    els.locateButton.setAttribute('aria-label', t('myLocation'));
    els.locateButton.title = t('myLocation');
  }
  showHomeSaved();
  drawResults();
  drawPins();
}

function applyUnits(units) {
  state.units = units;
  remember('units', units);
  els.units.textContent = units === 'imperial' ? 'mi' : 'km';
  drawResults();
}

// ---- Start-up -------------------------------------------------------------------------

function start() {
  registerServiceWorker();
  new LocateControl().addTo(map);
  const region = i18n.detectRegion();
  state.emergencyNumber = i18n.emergencyNumber(region);
  els.callLink.href = 'tel:' + state.emergencyNumber;
  els.callButton.href = 'tel:' + state.emergencyNumber;

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
  els.reportSighting.addEventListener('click', () => (state.mode === 'sighting' ? closeSightingForm() : openSightingForm()));
  els.sightingSave.addEventListener('click', saveSighting);
  els.sightingCancel.addEventListener('click', closeSightingForm);
  els.panelToggle.addEventListener('click', () => {
    const collapsed = els.panel.classList.toggle('collapsed');
    els.panelToggle.setAttribute('aria-expanded', String(!collapsed));
    els.panelToggle.textContent = collapsed ? t('showPanel') : t('hidePanel');
    setTimeout(() => map.invalidateSize(), 0); // the map got bigger or smaller
  });

  // Offline and home area
  showOnlineState(navigator.onLine);
  window.addEventListener('online', () => showOnlineState(true));
  window.addEventListener('offline', () => showOnlineState(false));
  try { state.home = JSON.parse(recall('home')); } catch { state.home = null; }
  showHomeSaved();
  drawPins();
  els.homeFind.addEventListener('click', findHomeAddress);
  els.homeAddress.addEventListener('keydown', (e) => { if (e.key === 'Enter') findHomeAddress(); });
  els.homeTap.addEventListener('click', () => {
    els.panel.classList.remove('collapsed');
    setMode(state.mode === 'home' ? null : 'home');
  });
  els.homeGps.addEventListener('click', useMyLocationForHome);
  els.homeSave.addEventListener('click', saveHomeArea);

  // Report box
  report.setProxyUrl(proxyUrl());
  els.reportVoice.hidden = !report.isVoiceSupported(); // e.g. Firefox has no voice input
  els.reportOpen.addEventListener('click', toggleReportBox);
  els.reportVoice.addEventListener('click', toggleVoice);
  els.reportRead.addEventListener('click', readReport);

  // Sharing
  sync.setDbUrl(databaseUrl());
  state.myName = recall('name') || '';
  els.myName.value = state.myName;
  els.myName.addEventListener('change', saveName);
  els.share.addEventListener('click', shareSearch);
  els.messageSend.addEventListener('click', sendMessage);
  els.messageText.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
  els.handoff.addEventListener('click', openHandoff);
  els.handoffCopy.addEventListener('click', copyHandoff);
  els.handoffPrint.addEventListener('click', () => window.print());
  els.handoffClose.addEventListener('click', () => els.handoffDialog.close());
  renderLiveStatus();

  setMode('lastSeen');
  joinFromLink().then((joined) => { if (joined) setMode(null); });
}

// After a demo, re-running with a last-seen point still inside the demo area reuses the
// bundled demo data instead of downloading again.
function isNearDemo() {
  if (!state.lastSeen) return false;
  return map.distance(state.lastSeen, DEMO_LOCATION) < 2000;
}

start();
