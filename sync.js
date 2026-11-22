// sync.js — shares one search between phones, live, through Firebase Realtime Database.
//
// What gets stored (see INTERFACES.md, section 6):
//   searches/<search id>/case             the CaseInput + extras (createdAt, area, engineVersion...)
//   searches/<search id>/events/<push id> one event: 'searched', 'sighting', 'message', ...
//   searches/<search id>/searchers/<id>   where each searcher is now: { lat, lng, at, name }
// Events are only ever ADDED, never edited or deleted. Searcher positions are the exception:
// each phone overwrites its own entry as it moves. The engine never uses them; they're only
// dots on the map so everyone can see where the others are. Every phone downloads the case and
// all events and runs the engine itself, so everyone sees the same map.
//
// We talk to Firebase with plain web requests (its "REST API"), no Firebase library:
//   - fetch() with PUT to save the case and to add an event (at an id this phone makes)
//   - EventSource to get a live stream of every change
//
// No signal? addEvent() keeps the event in a queue (saved in localStorage) and sends it,
// in order, the next time anything is sent or the phone comes back online.
//
// Keeping the shared map safe (the "integrity" rules):
//   - firebase-rules.json makes the database refuse any event that isn't exactly one of the
//     known shapes (right fields, right types, numbers in range, short text, nothing extra),
//     refuses edits and deletes of events, and lets the case be written only once.
//   - This file checks everything it RECEIVES with the same rules (checkEvent / checkCase /
//     checkSearcher) before the engine sees it. A bad event is dropped and counted, never
//     thrown: one broken event must not stop the map. The same rules run on every phone and
//     don't use the phone's clock, so every phone drops exactly the same events.
//   - The same event arriving twice (a retry, a second tab, someone re-sending a copy) is
//     counted once.
//   - The case carries engineVersion. A phone whose engine is different says so
//     (info.versionMismatch) instead of quietly drawing a different map from the same events.
// tools/mock-firebase.py enforces the same rules, and tests/sync.test.js checks that the
// rules file, the mock and this file agree on every test event.
//
// This file has no page (DOM) code and no UI text, so tests/sync.test.js can run it in Node.

const QUEUE_KEY = 'findthem-queue';

// The version of the map engine this phone runs. Two phones with different values may draw
// different maps from the same case and events, so a phone joining a search made by another
// version is warned. Bump it whenever the engine's output changes for the same inputs.
// (Better: engine/index.js exports its own version and app.js passes it in with
// setEngineVersion. Until then this value is the one used.)
export const ENGINE_VERSION = '2026-11-22.1';
const VERSION_RE = /^[0-9A-Za-z._-]{1,40}$/;
let engineVersion = ENGINE_VERSION;

export function setEngineVersion(v) {
  if (VERSION_RE.test(String(v))) engineVersion = String(v);
}

export function getEngineVersion() {
  return engineVersion;
}

// ---- Settings ------------------------------------------------------------------------

let dbUrl = ''; // set by app.js from config.js; empty = live sharing not set up

export function setDbUrl(url) {
  dbUrl = (url || '').replace(/\/$/, '');
}

export function isConfigured() {
  return dbUrl !== '';
}

function url(path) {
  return `${dbUrl}/${path}.json`;
}

// A long random id (128 bits, 32 hex characters) that nobody can guess. It is the only
// "password" a search has, so it's only shared by link.
export function newSearchId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// An event id in Firebase's own "push id" style: 8 characters of time (so ids sort roughly in
// the order they were made) + 12 random characters (72 bits, so two phones never pick the same
// one). This phone picks the id itself, before sending, so if a send is retried it goes to
// the SAME id, and the database refuses the second copy (events can't be overwritten).
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
export function newPushId(nowMs = Date.now()) {
  let time = Math.max(0, Math.floor(nowMs));
  let id = '';
  for (let i = 0; i < 8; i++) {
    id = PUSH_CHARS[time % 64] + id;
    time = Math.floor(time / 64);
  }
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const b of bytes) id += PUSH_CHARS[b % 64];
  return id;
}

// ---- Checking data (the same rules as firebase-rules.json) ------------------------------

// Limits. firebase-rules.json and tools/mock-firebase.py use the same numbers; the test
// checks that all three agree.
export const LIMITS = {
  MIN_TIME: 1600000000000,   // ms since 1970: Sept 2020. Anything earlier is a mistake.
  MAX_TIME: 10000000000000,  // ms: year 2286. (The database also refuses times more than
                             // 1 hour ahead of its own clock. Phones don't check that: their
                             // clocks differ, and every phone must drop the same events.)
  EVENT_MINUTES: [1, 600],   // searcher-minutes in a 'searched' or 'completed' event
  CASE_MINUTES: [1, 1440],   // minutes since last seen in the case (the form allows 1–1440)
  SIGHTING_MINUTES: [0, 1440], // minutes from a sighting to its report (the form allows 0–1440)
  SEARCH_MIN: [0, 600],      // planned minutes in an 'assigned' event
  NAME_MAX: 40,              // a searcher's name (index.html: maxlength 40)
  TEXT_MAX: 300,             // a message, a sighting note
  LABEL_MAX: 100,            // a familiar place's name
  FAMILIAR_MAX: 3,
  TRACK_MAX: 2000,           // squares in a planner track
  TRACK_CELL_MAX: 999999,    // largest square number in a track
  ASSIGN_MAX_MS: 86400000,   // an assignment expires at most 24 h after it was made
};

const SEARCH_ID_RE = /^[0-9a-f]{32}$/;
const SEARCHER_ID_RE = /^[0-9a-f]{16}$/;
const PUSH_ID_RE = /^[-0-9A-Za-z_]{20}$/;
const SECTOR_RE = /^r[0-9]{1,3}c[0-9]{1,3}$/;
const TASK_RE = /^[0-9A-Za-z:_-]{1,64}$/;
const CID_RE = /^[0-9A-Za-z_.:-]{1,64}$/;
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// How they may be travelling (docs/INTAKE-SPEC.md: Walking · Maybe car · Maybe bus · Not sure).
export const TRAVEL = ['walking', 'car', 'bus', 'unknown'];
// The case fields a 'caseUpdate' event may change, and what "cleared" means for the ones that
// can be cleared (Firebase can't store null or [], so a cleared value is simply left out).
export const CASE_UPDATE_FIELDS = ['minutes', 'minutesAt', 'direction', 'mobility', 'familiarPlaces', 'travel', 'description'];
const CLEARED = { direction: null, familiarPlaces: [], description: '' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (lo, hi) => (v) => isNum(v) && v >= lo && v <= hi;
const int = (lo, hi) => (v) => num(lo, hi)(v) && Number.isInteger(v);
const str = (max, min = 0) => (v) => typeof v === 'string' && v.length >= min && v.length <= max;
const match = (re) => (v) => typeof v === 'string' && re.test(v);
const oneOf = (list) => (v) => list.includes(v);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const LAT = num(-90, 90);
const LNG = num(-180, 180);
const TIME = num(LIMITS.MIN_TIME, LIMITS.MAX_TIME);
const NAME = str(LIMITS.NAME_MAX);
const SEARCHER = match(SEARCHER_ID_RE);
const TRACK = (v) => Array.isArray(v) && v.length >= 1 && v.length <= LIMITS.TRACK_MAX
  && v.every(int(0, LIMITS.TRACK_CELL_MAX));

// Every field an event may have, and its check.
const EVENT_FIELDS = {
  type: str(20),
  at: TIME,
  cid: match(CID_RE),          // the id the sending phone gave the event (app.js)
  by: NAME,
  sectorId: match(SECTOR_RE),
  minutes: num(...LIMITS.EVENT_MINUTES),
  lat: LAT,
  lng: LNG,
  direction: oneOf(DIRECTIONS),
  minutesSince: num(...LIMITS.SIGHTING_MINUTES),
  reliability: oneOf([0.3, 0.6, 0.9]),
  note: str(LIMITS.TEXT_MAX),
  text: str(LIMITS.TEXT_MAX, 1),
  taskId: match(TASK_RE),
  searcherId: SEARCHER,
  partnerId: SEARCHER,
  to: NAME,
  toId: SEARCHER,
  expiresAt: TIME,
  searchMin: num(...LIMITS.SEARCH_MIN),
  fraction: num(0, 1),
  canvass: (v) => typeof v === 'boolean', // planner: knock and ask at the doors (true) or only walk past
  track: TRACK,
  field: oneOf(CASE_UPDATE_FIELDS),
  value: () => true,           // checked in checkEvent, like the case field it replaces
};

// The known event types: which fields each MUST have and which it MAY have (besides
// type, at, cid and by, which every type may have; type and at are required).
// assigned / released / completed are the planner's (docs/PLANNER.md §5); 'assigned' also
// accepts the INTERFACES.md shape { sectorId, to, toId? }.
// caseUpdate changes one case field after the search was shared (the case itself is written
// once): { field, value }. The latest one per field wins (applyCaseUpdates).
// found: the person was found, at { lat, lng }.
export const EVENT_TYPES = {
  searched: { required: ['sectorId', 'minutes'], optional: [] },
  sighting: { required: ['lat', 'lng', 'minutesSince', 'reliability'], optional: ['direction', 'note'] },
  message: { required: ['text'], optional: [] },
  assigned: { required: [], optional: ['sectorId', 'taskId', 'to', 'toId', 'searcherId', 'partnerId', 'expiresAt', 'searchMin', 'track', 'canvass'] },
  released: { required: ['searcherId', 'taskId'], optional: ['track', 'fraction'] },
  completed: { required: ['searcherId', 'taskId', 'minutes'], optional: ['track', 'partnerId'] },
  caseUpdate: { required: ['field'], optional: ['value'] },
  found: { required: ['lat', 'lng'], optional: ['note'] },
};
const COMMON_FIELDS = ['type', 'at', 'cid', 'by'];

// Firebase never stores null (a null field just isn't there), so null and missing are the same.
function present(obj, key) {
  return has(obj, key) && obj[key] !== null && obj[key] !== undefined;
}

// Checks one event as stored (without `id`: that's the database key, checked separately).
// Returns null if it's fine, or a short reason ('bad:lat', 'extra:foo', ...).
// Doesn't use the clock, so every phone gets the same answer.
export function checkEvent(ev) {
  if (!isObj(ev)) return 'not-an-object';
  const shape = typeof ev.type === 'string' && has(EVENT_TYPES, ev.type) ? EVENT_TYPES[ev.type] : null;
  if (!shape) return 'unknown-type';
  const allowed = new Set([...COMMON_FIELDS, ...shape.required, ...shape.optional]);
  for (const key of Object.keys(ev)) {
    if (!present(ev, key)) continue;
    if (!allowed.has(key)) return `extra:${key}`;
    if (!EVENT_FIELDS[key](ev[key])) return `bad:${key}`;
  }
  for (const key of ['at', ...shape.required]) if (!present(ev, key)) return `missing:${key}`;
  if (ev.type === 'assigned') {
    if (!present(ev, 'taskId') && !present(ev, 'sectorId')) return 'missing:taskId';
    if (!present(ev, 'searcherId') && !present(ev, 'toId') && !present(ev, 'to')) return 'missing:searcherId';
    if (present(ev, 'expiresAt') && !(ev.expiresAt > ev.at && ev.expiresAt <= ev.at + LIMITS.ASSIGN_MAX_MS)) return 'bad:expiresAt';
  }
  if (ev.type === 'caseUpdate') {
    if (present(ev, 'value')) {
      if (!CASE_FIELDS[ev.field](ev.value)) return 'bad:value';
    } else if (!has(CLEARED, ev.field)) {
      return 'missing:value'; // only direction, familiarPlaces and description can be cleared
    }
  }
  return null;
}

// Checks the shared case. Returns null if fine, or a reason.
const onlyKeys = (obj, keys) => Object.keys(obj).every((k) => keys.includes(k) || !present(obj, k));
const CASE_FIELDS = {
  lastSeen: (v) => isObj(v) && LAT(v.lat) && LNG(v.lng) && onlyKeys(v, ['lat', 'lng']),
  minutes: num(...LIMITS.CASE_MINUTES),
  direction: oneOf(DIRECTIONS),
  mobility: oneOf(['normal', 'slow', 'walker']),
  familiarPlaces: (v) => Array.isArray(v) && v.length <= LIMITS.FAMILIAR_MAX && v.every((p) => isObj(p)
    && LAT(p.lat) && LNG(p.lng) && (!present(p, 'label') || str(LIMITS.LABEL_MAX)(p.label))
    && onlyKeys(p, ['lat', 'lng', 'label'])),
  seed: int(0, 4294967295),
  createdAt: TIME,
  minutesAt: TIME,
  area: oneOf(['demo', 'live']),
  startedBy: NAME,
  startedAt: TIME,
  engineVersion: match(VERSION_RE),
  travel: oneOf(TRAVEL),
  description: str(LIMITS.TEXT_MAX), // what they are wearing (docs/INTAKE-SPEC.md)
};
const CASE_REQUIRED = ['lastSeen', 'minutes', 'mobility', 'seed', 'createdAt', 'engineVersion'];

export function checkCase(c) {
  if (!isObj(c)) return 'not-an-object';
  for (const key of Object.keys(c)) {
    if (!present(c, key)) continue;
    if (!has(CASE_FIELDS, key)) return `extra:${key}`;
    if (!CASE_FIELDS[key](c[key])) return `bad:${key}`;
  }
  for (const key of CASE_REQUIRED) if (!present(c, key)) return `missing:${key}`;
  return null;
}

// Checks one searcher's position (only drawn as a dot, but a bad one could break the map).
const SEARCHER_FIELDS = { lat: LAT, lng: LNG, at: TIME, name: NAME };
export function checkSearcher(s) {
  if (!isObj(s)) return 'not-an-object';
  for (const key of Object.keys(s)) {
    if (!present(s, key)) continue;
    if (!has(SEARCHER_FIELDS, key)) return `extra:${key}`;
    if (!SEARCHER_FIELDS[key](s[key])) return `bad:${key}`;
  }
  for (const key of ['lat', 'lng', 'at']) if (!present(s, key)) return `missing:${key}`;
  return null;
}

// A copy without the fields Firebase wouldn't store: null, an empty list, an empty object.
function withoutNulls(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (isObj(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

// Orders two ids by Unicode code point (push ids are plain ASCII, so this is also simple
// character order). Every phone sorts the same way.
export function compareIds(a, b) {
  const x = [...String(a)];
  const y = [...String(b)];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d < 0 ? -1 : 1;
  }
  return x.length - y.length < 0 ? -1 : x.length > y.length ? 1 : 0;
}
const byTimeThenId = (a, b) => (a.at - b.at) || compareIds(a.id, b.id);

// The case with every caseUpdate applied: for each field, the update with the latest `at`
// wins (same `at`: the larger id, by code point). Any update beats the value the case was
// created with. `events` must already be checked (cleanEvents). Returns a new object.
export function applyCaseUpdates(caseDoc, events) {
  if (!isObj(caseDoc)) return caseDoc;
  const latest = {};
  for (const ev of events || []) {
    if (!ev || ev.type !== 'caseUpdate') continue;
    const cur = latest[ev.field];
    if (!cur || byTimeThenId(ev, cur) > 0) latest[ev.field] = ev;
  }
  const out = { ...caseDoc };
  for (const [field, ev] of Object.entries(latest)) {
    out[field] = present(ev, 'value') ? structuredClone(ev.value) : structuredClone(CLEARED[field]);
  }
  return out;
}

// The same JSON whatever order the keys are in: used to spot two copies of one event.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// The case as the engine expects it: fills in what Firebase leaves out (an empty list of
// familiar places and a null direction aren't stored).
function normalizeCase(c) {
  return { ...c, direction: present(c, 'direction') ? c.direction : null, familiarPlaces: c.familiarPlaces || [] };
}

// ---- Writing --------------------------------------------------------------------------

// Saves the case for a new shared search. Returns { ok } or { ok: false, error }.
// error: 'no-db-url' | 'invalid' (with reason; nothing sent) | 'rejected' | 'offline'
export async function createSearch(searchId, caseDoc) {
  if (!isConfigured()) return { ok: false, error: 'no-db-url' };
  if (!SEARCH_ID_RE.test(String(searchId))) return { ok: false, error: 'invalid', reason: 'bad:searchId' };
  const doc = withoutNulls({ ...caseDoc, createdAt: Date.now(), engineVersion });
  // Text the person typed is cut to the database's limits rather than refused.
  if (typeof doc.startedBy === 'string') doc.startedBy = doc.startedBy.slice(0, LIMITS.NAME_MAX);
  if (Array.isArray(doc.familiarPlaces)) {
    doc.familiarPlaces = doc.familiarPlaces.map((p) => (isObj(p) ? withoutNulls({
      ...p, label: typeof p.label === 'string' ? p.label.slice(0, LIMITS.LABEL_MAX) : p.label,
    }) : p));
    if (doc.familiarPlaces.length === 0) delete doc.familiarPlaces; // Firebase doesn't store []
  }
  const reason = checkCase(doc);
  if (reason) return { ok: false, error: 'invalid', reason };
  try {
    const res = await fetch(url(`searches/${searchId}/case`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    return res.ok ? { ok: true } : { ok: false, error: 'rejected', status: res.status };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

// Adds one event. Anything already waiting in the queue is sent first, so events arrive
// in the order they happened. Returns:
//   { ok: true }                            sent
//   { queued: true, error: 'no-db-url' }    live sharing isn't set up; kept for later
//   { queued: true, error: 'offline' }      no signal; will send later
//   { ok: false, error: 'invalid', reason } breaks the rules: not kept, not sent
//   { ok: false, error: 'rejected' }        the database refused it (rules); not retried
export async function addEvent(searchId, event) {
  const { id, ...rest } = isObj(event) ? event : {}; // this phone makes its own push id below
  const body = withoutNulls(rest);
  const reason = SEARCH_ID_RE.test(String(searchId)) ? checkEvent(body) : 'bad:searchId';
  if (reason) return { ok: false, error: 'invalid', reason };
  const queue = readQueue();
  queue.push({ searchId, id: newPushId(), event: body });
  writeQueue(queue);
  if (!isConfigured()) return { queued: true, error: 'no-db-url' };
  return flushQueue();
}

// Sends everything in the queue, oldest first. Stops at the first failure.
// Only ONE send runs at a time: if a second event arrives while a send is running, the running
// one picks it up too. (Two sends at once both sent the first item, so it reached the
// database twice. Found testing with real Firebase.)
let flushing = null;
let flushAgain = false;

// A send that gets no answer is given up after this long (weak signal can leave a request
// hanging for minutes, and everything queued behind it waited too).
const SEND_TIMEOUT_MS = 15000;
// While anything is still waiting, try again this often. (Before, a failed send was only
// retried when the person posted something else or the live stream reconnected.)
const RETRY_MS = 15000;
// fetch options that stop the request after `ms` (left out where the browser can't do it).
function timeLimit(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(ms) } : {};
}
let retryTimer = null;
function armRetry() {
  if (retryTimer || !isConfigured() || pendingCount() === 0) return;
  retryTimer = setTimeout(() => { retryTimer = null; flushQueue(); }, RETRY_MS);
  if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref(); // Node (tests): don't keep the process alive
}

export function flushQueue() {
  if (!isConfigured()) return Promise.resolve({ queued: pendingCount() > 0, error: 'no-db-url' });
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    let result;
    do {
      flushAgain = false;
      result = await flushOnce();
    } while (flushAgain && result.ok);
    return result;
  })().finally(() => { flushing = null; armRetry(); });
  return flushing;
}

async function flushOnce() {
  let queue = readQueue();
  let refused = null; // the first event the database said no to, if any
  while (queue.length) {
    const item = queue[0];
    if (!item.id) { // queued by an older version of this file: give it an id now, and keep it
      item.id = newPushId();
      writeQueue(queue);
    }
    const { searchId, id, event } = item;
    const where = url(`searches/${searchId}/events/${id}`);
    let res;
    try {
      res = await fetch(where, {
        method: 'PUT', // at our own id: a retry can never make a second copy
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        ...timeLimit(SEND_TIMEOUT_MS),
      });
    } catch {
      return { queued: true, error: 'offline' };
    }
    let ok = res.ok;
    if (!ok) {
      // Refused. Maybe an earlier try did arrive and only the answer was lost: then the
      // event is already there (and can't be written twice). Look before giving up.
      try {
        const there = await fetch(where, timeLimit(SEND_TIMEOUT_MS));
        ok = there.ok && canonical(await there.json()) === canonical(event);
      } catch {
        return { queued: true, error: 'offline' };
      }
    }
    // A passing trouble on the server's side (too busy, an error of its own): the event is
    // fine, so KEEP it and try again later. Only a real "no" (bad request, not allowed) drops it.
    if (!ok && (res.status === 408 || res.status === 429 || res.status >= 500)) {
      return { queued: true, error: 'offline', status: res.status };
    }
    // Remove what we just sent. Re-read first: new events may have been added meanwhile.
    queue = readQueue().filter((q) => q.id !== id);
    writeQueue(queue);
    // Refused for good: remember it, and carry on with the events behind it (they used to
    // wait until something else set the queue going again).
    if (!ok && !refused) refused = { ok: false, error: 'rejected', status: res.status };
  }
  return refused || { ok: true };
}

// ---- Offline queue -----------------------------------------------------------------------

// If the phone's storage is blocked or full, the queue is kept in memory instead (it lasts
// until the page is closed). Before, nothing was kept, and every event was reported as sent.
let memoryQueue = null;
function readQueue() {
  if (memoryQueue) return memoryQueue.filter((x) => isObj(x) && isObj(x.event));
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
    return Array.isArray(q) ? q.filter((x) => isObj(x) && isObj(x.event)) : [];
  } catch { return []; }
}
function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    memoryQueue = null;
  } catch {
    memoryQueue = queue.slice(); // storage blocked or full
  }
}

// How many events are waiting to be sent.
export function pendingCount() {
  return readQueue().length;
}

// Saves where this searcher is now (overwrites their previous position). Positions are not
// queued when there's no signal: an old position is no use later. Returns true if saved.
export async function setSearcherPosition(searchId, searcherId, pos) {
  if (!isConfigured()) return false;
  if (!SEARCH_ID_RE.test(String(searchId)) || !SEARCHER_ID_RE.test(String(searcherId))) return false;
  const body = {
    lat: Math.round(pos.lat * 1e5) / 1e5, // about 1 m: plenty for a dot on the map
    lng: Math.round(pos.lng * 1e5) / 1e5,
    at: Date.now(),
    name: String(pos.name || '').slice(0, LIMITS.NAME_MAX),
  };
  if (checkSearcher(body)) return false;
  try {
    const res = await fetch(url(`searches/${searchId}/searchers/${searcherId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// A random id for this phone (16 hex characters), so its position entry can be overwritten.
export function newSearcherId() {
  return newSearchId().slice(0, 16);
}

// The events still waiting for one search (the screen shows them on the map anyway).
export function queuedEvents(searchId) {
  return readQueue().filter((q) => q.searchId === searchId).map((q) => q.event);
}

// ---- Keeping a local copy ("mirror") of a search ---------------------------------------------

// Keys that would change how JavaScript objects behave if used as names ("prototype pollution").
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Firebase's live stream sends changes as { path, data }:
//   put   → replace whatever is at `path` with `data` (null means delete)
//   patch → for each key of `data`, replace what's at `path`/key (a key may itself be a
//           path like "events/-Nab…" when several places were written at once)
// applyChange returns the updated mirror.
export function applyChange(mirror, kind, path, data) {
  const keys = String(path || '/').split('/').filter(Boolean);
  if (keys.some((k) => UNSAFE_KEYS.has(k))) return mirror || {};
  if (kind === 'patch') {
    let m = mirror || {};
    if (!isObj(data)) return m;
    for (const [k, v] of Object.entries(data)) m = applyChange(m, 'put', [...keys, k].join('/'), v);
    return m;
  }
  if (keys.length === 0) return isObj(data) ? structuredClone(data) : {};
  const root = structuredClone(mirror || {});
  let node = root;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(node[k])) node[k] = {};
    node = node[k];
  }
  const last = keys[keys.length - 1];
  if (data === null || data === undefined) delete node[last];
  else node[last] = structuredClone(data);
  return root;
}

// Turns Firebase's { pushId: event, ... } into a list sorted by time (then id), with each
// event's id filled in. That's the order the engine applies them in. (No checking: see
// cleanEvents for what the engine is given.)
export function sortedEvents(eventsObject) {
  return Object.entries(isObj(eventsObject) ? eventsObject : {})
    .filter(([, ev]) => isObj(ev))
    .map(([id, ev]) => ({ ...ev, id }))
    .sort(byTimeThenId);
}

// What the engine is given: only events that pass checkEvent and have a proper push id, each
// one once, sorted by time then id. Returns { events, dropped, duplicates }:
//   dropped     [{ id, reason }] events that broke the rules (left out)
//   duplicates  how many exact copies of an earlier event were left out
// Same input → same output on every phone (no clock, no randomness).
export function cleanEvents(eventsObject) {
  const dropped = [];
  const list = [];
  for (const [id, ev] of Object.entries(isObj(eventsObject) ? eventsObject : {})) {
    const reason = PUSH_ID_RE.test(id) ? checkEvent(ev) : 'bad:id';
    if (reason) dropped.push({ id, reason });
    else list.push({ ...withoutNulls(ev), id });
  }
  list.sort(byTimeThenId);
  // Two events with the same content (everything but the id, which includes the sending
  // phone's cid and its time) are one event sent twice: keep the first.
  const seen = new Set();
  const events = [];
  let duplicates = 0;
  for (const ev of list) {
    const { id, ...content } = ev;
    const key = canonical(content);
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    events.push(ev);
  }
  dropped.sort((a, b) => compareIds(a.id, b.id));
  return { events, dropped, duplicates };
}

// The searchers whose positions pass checkSearcher.
function cleanSearchers(searchersObject) {
  const out = {};
  for (const [id, s] of Object.entries(isObj(searchersObject) ? searchersObject : {})) {
    if (SEARCHER_ID_RE.test(id) && !checkSearcher(s)) out[id] = s;
  }
  return out;
}

// The case (checked and filled in) plus what the screen should know about it.
// caseDoc is null if there is no case yet or it breaks the rules (caseProblem says why).
function readCaseDoc(raw) {
  if (raw === null || raw === undefined) return { caseDoc: null, caseProblem: null, caseEngineVersion: null, versionMismatch: false };
  const problem = checkCase(raw);
  const version = isObj(raw) && typeof raw.engineVersion === 'string' ? raw.engineVersion : null;
  return {
    caseDoc: problem ? null : normalizeCase(raw),
    caseProblem: problem,
    caseEngineVersion: version,
    versionMismatch: version !== engineVersion,
  };
}

// Everything in one mirror of a search, checked: { caseDoc, baseCase, events, searchers, info }.
//   caseDoc   the case with every caseUpdate applied: what the engine should use
//   baseCase  the case as it was first written
// info = {
//   caseUpdates                         how many caseUpdate events there are
//   dropped, droppedIds, duplicates     bad events and repeated copies left out
//   caseProblem                         why the case was refused (null if fine or none yet)
//   caseEngineVersion, engineVersion    the case's engine version and this phone's
//   versionMismatch                     true: this phone may draw a different map; warn
// }
export function readMirror(mirror) {
  const m = isObj(mirror) ? mirror : {};
  const c = readCaseDoc(m.case);
  const { events, dropped, duplicates } = cleanEvents(m.events);
  return {
    caseDoc: applyCaseUpdates(c.caseDoc, events),
    baseCase: c.caseDoc,
    events,
    searchers: cleanSearchers(m.searchers),
    info: {
      dropped: dropped.length,
      droppedIds: dropped,
      duplicates,
      caseUpdates: events.filter((e) => e.type === 'caseUpdate').length,
      caseProblem: c.caseProblem,
      caseEngineVersion: c.caseEngineVersion,
      versionMismatch: c.versionMismatch,
      engineVersion,
    },
  };
}

// ---- Reading, live ------------------------------------------------------------------------

// Reads a search once (used when opening a shared link).
// Returns { caseDoc, events, info } (see readMirror). caseDoc is null if missing or broken.
export async function loadSearch(searchId) {
  if (!SEARCH_ID_RE.test(String(searchId))) throw new Error('Could not load search (bad id)');
  // A time limit: on weak signal this could hang, and the share link then showed nothing.
  const res = await fetch(url(`searches/${searchId}`), timeLimit(8000));
  if (!res.ok) throw new Error(`Could not load search (${res.status})`);
  let doc;
  try { doc = await res.json(); } catch { doc = null; }
  const { caseDoc, events, info } = readMirror(doc);
  warnIfNeeded(info);
  return { caseDoc, events, info };
}

// One console line when something was left out (for whoever is debugging; not UI text).
let lastWarning = '';
function warnIfNeeded(info) {
  if (!info.dropped && !info.duplicates && !info.caseProblem && !info.versionMismatch) return;
  const note = `${info.dropped}/${info.duplicates}/${info.caseProblem}/${info.versionMismatch}`;
  if (note === lastWarning) return;
  lastWarning = note;
  console.warn('FindThem sync:', {
    dropped: info.droppedIds, duplicates: info.duplicates, caseProblem: info.caseProblem,
    caseEngineVersion: info.caseEngineVersion, myEngineVersion: info.engineVersion,
  });
}

// Listens for every change to a search. Calls onChange(caseDoc, events, searchers, info) each
// time (searchers: { id: { lat, lng, at, name } }; info: see readMirror), and
// onStatus('live' | 'reconnecting' | 'denied'). Returns a function that stops listening.
// Only checked data is passed on; a broken message from the stream is ignored.
export function subscribe(searchId, onChange, onStatus = () => {}) {
  if (!SEARCH_ID_RE.test(String(searchId))) {
    onStatus('denied');
    return () => {};
  }
  let mirror = {};
  let source = null;
  let stopped = false;
  let reopenTimer = null;

  const handle = (kind) => (message) => {
    let change;
    try {
      change = JSON.parse(message.data);
    } catch {
      return; // not JSON: ignore it
    }
    if (!isObj(change) || typeof change.path !== 'string') return;
    mirror = applyChange(mirror, kind, change.path, change.data);
    const { caseDoc, events, searchers, info } = readMirror(mirror);
    warnIfNeeded(info);
    onChange(caseDoc, events, searchers, info);
  };
  let lastStatus = 'reconnecting';
  const status = (s) => { lastStatus = s; onStatus(s); };
  // Send anything that waited for signal, then report the status again so the screen's
  // "x updates waiting" count goes away once they're sent.
  const flush = () => { flushQueue().then(() => onStatus(lastStatus)); };

  const open = () => {
    if (stopped) return;
    mirror = {}; // a new stream starts by sending everything again
    const stream = new EventSource(url(`searches/${searchId}`));
    source = stream;
    stream.addEventListener('put', handle('put'));
    stream.addEventListener('patch', handle('patch'));
    stream.addEventListener('open', () => { status('live'); flush(); });
    stream.addEventListener('error', () => {
      status('reconnecting');
      // The browser retries a dropped connection by itself. But when the server ANSWERS with
      // an error (503, say), the browser closes the stream for good (readyState 2) and the
      // phone would never hear another update. Then open a new stream a little later.
      if (stream.readyState === 2 && !stopped && !reopenTimer) {
        reopenTimer = setTimeout(() => { reopenTimer = null; open(); }, 5000);
      }
    });
    stream.addEventListener('cancel', () => { status('denied'); stopped = true; stream.close(); }); // rules said no
  };
  open();
  window.addEventListener('online', flush);

  return () => {
    stopped = true;
    clearTimeout(reopenTimer);
    if (source) source.close();
    window.removeEventListener('online', flush);
  };
}
