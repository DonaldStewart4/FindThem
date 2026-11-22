// engine/planner/worker.js — the planner (and the engine it needs) in a Web Worker.
// The page starts it with  new Worker('engine/planner/worker.js', { type: 'module' })  and sends:
//   { id, type: 'area', key, osm }                                  a new map area
//   { id, type: 'warm', key, caseInput }                            build the planner's world now
//   { id, type: 'plan', key, caseInput, events, searchers, nowMs }  who should search where
// Every message is answered with { id, ok: true, ... } or { id, ok: false, error }.
// The clock (nowMs) always comes from the page: the worker never reads the time itself.

import { createPlannerHost } from './host.js';

const host = createPlannerHost();

self.onmessage = (event) => {
  const m = event.data;
  try {
    if (m.type === 'area') {
      host.setArea(m.key, m.osm);
      self.postMessage({ id: m.id, ok: true });
    } else if (m.type === 'warm') {
      host.warm(m.key, m.caseInput);
      self.postMessage({ id: m.id, ok: true });
    } else if (m.type === 'plan') {
      const out = host.plan(m.key, m.caseInput, m.events, m.searchers, m.nowMs, m.params);
      self.postMessage({ id: m.id, ok: true, ...out });
    } else {
      self.postMessage({ id: m.id, ok: false, error: 'unknown message type' });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
  }
};
