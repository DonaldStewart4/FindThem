// engine/worker.js — the engine in a Web Worker (a background thread of the page).
// app.js starts it with  new Worker('engine/worker.js', { type: 'module' })  and sends:
//   { id, type: 'area',   key, osm }                       a new map area
//   { id, type: 'layers', key, layers }                    that area's buildings etc. arrived
//   { id, type: 'replay', key, caseInput, events, spotsMax }
// Every message is answered with { id, ok: true, ... } or { id, ok: false, error }.
// If the worker can't start (an old browser), app.js runs the engine on the page instead.

import { createHost } from './host.js';

const host = createHost();

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
    } else {
      self.postMessage({ id: m.id, ok: false, error: 'unknown message type' });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
  }
};
