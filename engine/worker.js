// engine/worker.js — the engine in a Web Worker (a background thread of the page).
// app.js starts it with  new Worker('engine/worker.js', { type: 'module' })  and sends:
//   { id, type: 'area',   key, osm }                       a new map area
//   { id, type: 'layers', key, layers }                    that area's buildings etc. arrived
//   { id, type: 'replay', key, caseInput, events, spotsMax }
//   { id, type: 'plan',   key, caseInput, events, searchers, nowMs }   the search plan (planner/)
// Every message is answered with { id, ok: true, ... } or { id, ok: false, error }.
// If the worker can't start (an old browser), app.js runs the engine on the page instead.

import { createHost, warmUp } from './host.js';

const host = createHost();

// Warm the engine up right away (see host.js): the worker starts when the page opens, long
// before the first map is asked for. Messages that arrive meanwhile simply wait their turn.
try { warmUp(); } catch (err) { console.warn('engine warm-up failed', err); }

self.onmessage = (event) => {
  const m = event.data;
  try {
    if (m.type === 'area') {
      host.setArea(m.key, m.osm);
      self.postMessage({ id: m.id, ok: true });
    } else if (m.type === 'layers') {
      host.addLayers(m.key, m.layers);
      self.postMessage({ id: m.id, ok: true });
    } else if (m.type === 'replay') {
      const out = host.run(m.key, m.caseInput, m.events, { spotsMax: m.spotsMax });
      // The two big arrays made fresh for this answer are handed over, not copied.
      // (grid.hazardType is kept by the engine for the next replay, so it is copied.)
      self.postMessage({ id: m.id, ok: true, ...out }, [out.prediction.grid.p.buffer, out.prediction.grid.hazard.buffer]);
    } else if (m.type === 'plan') {
      // Plain data (codes and numbers, no text), copied to the page.
      self.postMessage({ id: m.id, ok: true, plan: host.plan(m.key, m.caseInput, m.events, m.searchers, m.nowMs) });
    } else {
      self.postMessage({ id: m.id, ok: false, error: 'unknown message type' });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
  }
};
