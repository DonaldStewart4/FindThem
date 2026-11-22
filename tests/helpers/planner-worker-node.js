// Runs engine/planner/worker.js inside a real Node worker thread, for tests and the benchmark.
// A browser's Web Worker has `self.onmessage` / `self.postMessage`; this gives the same two to
// the worker file, wired to Node's parentPort. It also times the work itself (workMs), so a
// test can tell the planner's time from the time spent copying messages between threads.
import { parentPort } from 'node:worker_threads';

let started = 0;
globalThis.self = { postMessage: (message) => parentPort.postMessage({ ...message, workMs: performance.now() - started }), onmessage: null };
await import('../../engine/planner/worker.js');
parentPort.on('message', (data) => { started = performance.now(); globalThis.self.onmessage({ data }); });
