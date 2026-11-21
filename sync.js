// sync.js — shares one search between phones, live, through Firebase Realtime Database.
//
// What gets stored (see INTERFACES.md, section 6):
//   searches/<search id>/case             the CaseInput + extras (createdAt, area source)
//   searches/<search id>/events/<push id> one event: 'searched', 'sighting', 'message', ...
// Events are only ever ADDED, never edited or deleted. Every phone downloads the case and
// all events and runs the engine itself, so everyone sees the same map.
//
// We talk to Firebase with plain web requests (its "REST API"), no Firebase library:
//   - fetch() with PUT to save the case, POST to add an event
//   - EventSource to get a live stream of every change
//
// No signal? addEvent() keeps the event in a queue (saved in localStorage) and sends it,
// in order, the next time anything is sent or the phone comes back online.
//
// This file has no page (DOM) code and no UI text, so tests/sync.test.js can run it in Node.

const QUEUE_KEY = 'findthem-queue';

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

// ---- Writing --------------------------------------------------------------------------

// Saves the case for a new shared search. Returns { ok } or { ok: false, error }.
export async function createSearch(searchId, caseDoc) {
  if (!isConfigured()) return { ok: false, error: 'no-db-url' };
  try {
    const res = await fetch(url(`searches/${searchId}/case`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...caseDoc, createdAt: Date.now() }),
    });
    return res.ok ? { ok: true } : { ok: false, error: 'rejected', status: res.status };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

// Adds one event. Anything already waiting in the queue is sent first, so events arrive
// in the order they happened. Returns:
//   { ok: true }                          sent
//   { queued: true, error: 'no-db-url' }  live sharing isn't set up; kept for later
//   { queued: true, error: 'offline' }    no signal; will send later
//   { ok: false, error: 'rejected' }      the database refused it (rules); not retried
export async function addEvent(searchId, event) {
  const { id, ...body } = event; // the database makes the id (the "push id")
  const queue = readQueue();
  queue.push({ searchId, event: body });
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
  })().finally(() => { flushing = null; });
  return flushing;
}

async function flushOnce() {
  const queue = readQueue();
  while (queue.length) {
    const { searchId, event } = queue[0];
    let res;
    try {
      res = await fetch(url(`searches/${searchId}/events`), {
        method: 'POST', // POST makes Firebase create a new, time-ordered push id
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch {
      return { queued: true, error: 'offline' };
    }
    // Remove what we just sent. Re-read first: new events may have been added meanwhile.
    const now = readQueue();
    const i = now.findIndex((q) => q.searchId === searchId && JSON.stringify(q.event) === JSON.stringify(event));
    if (i >= 0) now.splice(i, 1);
    writeQueue(now);
    queue.splice(0, queue.length, ...now);
    if (!res.ok) return { ok: false, error: 'rejected', status: res.status };
  }
  return { ok: true };
}

// ---- Offline queue -----------------------------------------------------------------------

function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}
function writeQueue(queue) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* storage blocked */ }
}

// How many events are waiting to be sent.
export function pendingCount() {
  return readQueue().length;
}

// The events still waiting for one search (the screen shows them on the map anyway).
export function queuedEvents(searchId) {
  return readQueue().filter((q) => q.searchId === searchId).map((q) => q.event);
}

// ---- Keeping a local copy ("mirror") of a search ---------------------------------------------

// Firebase's live stream sends changes as { path, data }:
//   put   → replace whatever is at `path` with `data` (null means delete)
//   patch → merge the keys of `data` into whatever is at `path`
// applyChange returns the updated mirror.
export function applyChange(mirror, kind, path, data) {
  const keys = path.split('/').filter(Boolean);
  if (keys.length === 0) {
    if (kind === 'put') return data === null || data === undefined ? {} : structuredClone(data);
    return { ...mirror, ...structuredClone(data) };
  }
  const root = structuredClone(mirror || {});
  let node = root;
  for (const k of keys.slice(0, -1)) {
    if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
    node = node[k];
  }
  const last = keys[keys.length - 1];
  if (kind === 'put') {
    if (data === null) delete node[last];
    else node[last] = structuredClone(data);
  } else {
    node[last] = { ...(node[last] || {}), ...structuredClone(data) };
  }
  return root;
}

// Turns Firebase's { pushId: event, ... } into a list sorted by time (then id), with each
// event's id filled in. That's the order the engine applies them in.
export function sortedEvents(eventsObject) {
  return Object.entries(eventsObject || {})
    .map(([id, ev]) => ({ ...ev, id }))
    .sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---- Reading, live ------------------------------------------------------------------------

// Reads a search once (used when opening a shared link).
export async function loadSearch(searchId) {
  const res = await fetch(url(`searches/${searchId}`));
  if (!res.ok) throw new Error(`Could not load search (${res.status})`);
  const doc = (await res.json()) || {};
  return { caseDoc: doc.case || null, events: sortedEvents(doc.events) };
}

// Listens for every change to a search. Calls onChange(caseDoc, events) each time, and
// onStatus('live' | 'reconnecting' | 'denied'). Returns a function that stops listening.
export function subscribe(searchId, onChange, onStatus = () => {}) {
  let mirror = {};
  const source = new EventSource(url(`searches/${searchId}`));

  const handle = (kind) => (message) => {
    const { path, data } = JSON.parse(message.data);
    mirror = applyChange(mirror, kind, path, data);
    onChange(mirror.case || null, sortedEvents(mirror.events));
  };
  const flush = () => { flushQueue(); };

  source.addEventListener('put', handle('put'));
  source.addEventListener('patch', handle('patch'));
  source.addEventListener('open', () => { onStatus('live'); flush(); });
  source.addEventListener('error', () => onStatus('reconnecting')); // the browser retries by itself
  source.addEventListener('cancel', () => { onStatus('denied'); source.close(); }); // rules said no
  window.addEventListener('online', flush);

  return () => {
    source.close();
    window.removeEventListener('online', flush);
  };
}
