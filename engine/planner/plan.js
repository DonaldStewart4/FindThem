// engine/planner/plan.js — who should search where next.
//
// planSearch(world, segs, input) → Plan. Pure: no clock of its own (the time comes in with the
// input), no random numbers, so every phone works out the same plan from the same events.
//
//   input = {
//     p,              Float64Array: probability per 10 m square, summing to 1 − restOfWorld
//     restOfWorld,    probability that the person is not on this map
//     hazard,         optional Float32Array per square: the engine's hazard layer
//     searchers,      [ { id, lat, lng (or x, y), mode: 'foot' | 'car', updatedAgoMin } ]
//     events,         assigned / released / completed events (others are ignored)
//     clock,          { nowMs, minutesSinceLastSeen, night? }
//   }
//
// The steps, in order:
//   1. Read the events: which tasks are done, who holds what.
//   2. Bayes: completed tasks that found nobody lower the map where they looked.
//   3. Work in progress lowers the map the OTHER searchers are scored on (no pile-ups).
//   4. For each searcher, build candidate tasks with a real route from where they stand.
//   5. Assign: hazard pairs first (the hazard-first rule), then greedy by gain per minute,
//      then let each searcher move to their own best option until nobody moves. Searchers
//      holding a task keep it unless something is clearly better.
//   6. Report up to three options each, as data: POS gain, minutes, danger, reasons.
//   7. Measures: cumulative POS, remaining probability, rest-of-world trend, "expand" signal.
//
// Probability and danger are separate numbers and are never combined into one score.

import { withParams, V, HW, mobileShare } from './params.js';
import {
  FOOT, CAR, RAIL_X, nearestNode, shortestCached, pathTo, trackOfEdges, footprint,
  toLatLng, toXY,
} from './world.js';
import {
  coverageOfWork, trackCoverage, canvassCoverage, mergeCoverage, parkSweep, sweepCoverage,
  postCoverage, gainOn, paceSpeed, isNight, sweepWidths, lookProbability,
} from './detect.js';
import { postmanTour, openTour, orienteer, localGraph } from './routes.js';

const compareIds = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const PACE_OF = { hasty: 'hasty', drive: 'drive' };

function typeFromId(taskId) {
  const id = String(taskId);
  if (id.startsWith('hasty:')) return 'hasty';
  if (id.startsWith('drive:')) return 'drive';
  return { y: 'yards', p: 'park', h: 'hazard_check', c: 'containment' }[id[0]] || 'walk';
}

function cachesOf(world) {
  if (!world.planner) {
    const total = world.n * world.n;
    world.planner = {
      eventCov: new Map(),
      // Whole-map working arrays, reused by every re-plan so nothing big is allocated each time.
      post: new Float64Array(total), plain: new Float64Array(total), res: new Float64Array(total),
      credit: new Float64Array(total),
    };
  }
  return world.planner;
}

// ---- 1. Events ---------------------------------------------------------------------------------------

// Sorts the planner's events (by time, then id, like the engine) and works out:
//   active  Map(searcherId → their 'assigned' event), not released, completed or expired
//   done    pieces of finished work to count as searched: [{ id, taskId, at, track, fraction }]
export function readEvents(events, nowMs) {
  const ordered = [...(events || [])]
    .filter((e) => e && (e.type === 'assigned' || e.type === 'released' || e.type === 'completed'))
    .sort((a, b) => (Number(a.at) - Number(b.at)) || compareIds(a.id, b.id));
  const active = new Map();
  const done = [];
  for (const ev of ordered) {
    const who = String(ev.searcherId);
    if (ev.type === 'assigned') { active.set(who, ev); continue; }
    const current = active.get(who);
    const matches = current && String(current.taskId) === String(ev.taskId);
    if (matches) active.delete(who);
    // A pair walks together: the partner's copy of the same work is one look, not two.
    const partner = String(ev.partnerId ?? (matches ? current.partnerId ?? '' : ''));
    if (partner && done.some((d) => !d.partial && d.taskId === String(ev.taskId) && d.searcherId === partner && d.partnerId === who)) continue;
    if (ev.type === 'completed') {
      done.push({
        id: String(ev.id), taskId: String(ev.taskId), at: Number(ev.at), searcherId: who,
        partnerId: partner,
        track: ev.track || (matches ? current.track : null) || null, fraction: 1,
        canvass: (ev.canvass ?? (matches ? current.canvass : undefined)) !== false,
      });
    } else if (ev.track || Number(ev.fraction) > 0) {
      // Released part-way, with the trail walked so far (or the share of a park swept).
      done.push({
        id: String(ev.id), taskId: String(ev.taskId), at: Number(ev.at), searcherId: who, partnerId: '',
        track: ev.track || null, fraction: Math.min(1, Number(ev.fraction) || 1), partial: true, canvass: false,
      });
    }
  }
  for (const [who, ev] of active) if (Number(ev.expiresAt) <= nowMs) active.delete(who);
  return { active, done };
}

// ---- 2. Bayes: what finished work did to the map --------------------------------------------------------

function coverageOfDone(world, segs, rec, clock, P, canvass) {
  const cache = cachesOf(world).eventCov;
  const key = `${rec.id}:${canvass ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const task = segs.tasks.get(rec.taskId) || null;
  const type = task ? task.type : typeFromId(rec.taskId);
  let track = rec.track;
  if (!track && !rec.partial && task && (type === 'yards' || type === 'hazard_check')) {
    const tour = postmanTour(world, task);
    track = tour ? trackOfEdges(world, tour.edges, tour.nodes[0]) : null;
  }
  const nightThen = isNight(rec.at, world.origin.lat, world.origin.lng, P);
  const minutesThen = Math.max(0, clock.minutesSinceLastSeen - (clock.nowMs - rec.at) / 60000);
  const cov = coverageOfWork(world, { type, task, track: track || [], fraction: rec.fraction, canvass }, nightThen, minutesThen, P);
  cov.minutesThen = minutesThen;
  cache.set(key, cov);
  return cov;
}

// The map after every completed task that found nobody. Returns:
//   post            Float64Array, the new map; post + restOfWorld sums to 1
//   restOfWorld     "not on this map", raised by the empty searches
//   cumulativePOS   chance the searches so far would have found a person who stayed put
//   history         [{ at, cumulativePOS, restOfWorld }] after each completed task, in order
// If the person may still be walking, an old search says less about now: its effect fades by
// the share still mobile at the time (params.js MOBILE_SHARE) over AGE_TAU_MIN. cumulativePOS
// and the history ignore that fading, so they never go down.
export function posterior(world, segs, input, P, buffers = null) {
  const { p } = input;
  const row = Math.max(0, Number(input.restOfWorld) || 0);
  const clock = input.clock;
  const done = input.done || readEvents(input.events, clock.nowMs).done;
  const post = buffers ? buffers.post : new Float64Array(p.length);
  post.set(p);
  let mapMass = 0;
  for (let i = 0; i < post.length; i++) mapMass += post[i];
  const start = mapMass + row;
  const history = [];
  if (done.length === 0) return finish(post, mapMass, row, 0, history, start);

  const plain = buffers ? buffers.plain : new Float64Array(p.length); // the same updates with no fading, for cumulative POS
  plain.set(p);
  let plainMass = mapMass;
  const knocked = new Map(); // taskId → when its doors were last knocked on
  for (const rec of done) {
    // A block's doors count once per CANVASS_REPEAT_MIN; a repeat is only a walk past.
    const last = knocked.get(rec.taskId);
    const canvass = rec.canvass && !(last !== undefined && (rec.at - last) / 60000 < P.CANVASS_REPEAT_MIN);
    if (canvass) knocked.set(rec.taskId, rec.at);
    const cov = coverageOfDone(world, segs, rec, clock, P, canvass);
    const age = Math.max(0, (clock.nowMs - rec.at) / 60000);
    const fade = P.AGE_TAU_MIN > 0 ? 1 - mobileShare(cov.minutesThen, P) * (1 - Math.exp(-age / P.AGE_TAU_MIN)) : 1;
    for (let i = 0; i < cov.cells.length; i++) {
      const c = cov.cells[i];
      const d = cov.det[i];
      mapMass -= post[c] * d * fade; post[c] *= 1 - d * fade;
      plainMass -= plain[c] * d; plain[c] *= 1 - d;
    }
    history.push({ at: rec.at, cumulativePOS: 1 - (plainMass + row) / start, restOfWorld: row / (plainMass + row) });
  }
  const out = finish(post, mapMass, row, 1 - (plainMass + row) / start, history, start);
  out.knocked = knocked;
  return out;
}

function finish(post, mapMass, row, cumulativePOS, history, start) {
  const total = mapMass + row;
  if (total > 0 && Math.abs(total - 1) > 1e-12) for (let i = 0; i < post.length; i++) post[i] /= total;
  return { post, restOfWorld: total > 0 ? row / total : 0, cumulativePOS, history, startTotal: start };
}

// ---- The planner ---------------------------------------------------------------------------------------

export function planSearch(world, segs, input, overrides) {
  const P = withParams(overrides);
  const caches = cachesOf(world);
  const { n, vis } = world;
  const g = world.g;
  const clock = input.clock;
  const nowMs = clock.nowMs;
  const sinceMin = Math.max(0, Number(clock.minutesSinceLastSeen) || 0);
  const night = clock.night ?? isNight(nowMs, world.origin.lat, world.origin.lng, P);
  const nightKey = night ? 1 : 0;
  const state = readEvents(input.events, nowMs);
  // Optional debugging hook: a page or test can set globalThis.__plannerTimer = (label) => ...
  // to see how long each step takes. The planner itself never reads a clock.
  const tick = globalThis.__plannerTimer || null;
  if (tick) tick('start');
  const bayes = posterior(world, segs, { ...input, done: state.done }, P, caches);
  const post = bayes.post;
  if (tick) tick('bayes');

  // ---- Searchers: where they stand on the street graph, and how far everything is from there ----
  const searchers = [...(input.searchers || [])].map((raw) => {
    const xy = raw.x !== undefined ? { x: raw.x, y: raw.y } : toXY(world, raw.lat, raw.lng);
    const car = raw.mode === 'car';
    const bit = car ? CAR : FOOT;
    const node = nearestNode(world, xy.x, xy.y, bit);
    return {
      id: String(raw.id), x: xy.x, y: xy.y, car, bit, node,
      offsetM: node >= 0 ? Math.hypot(g.nx[node] - xy.x, g.ny[node] - xy.y) : Infinity,
      reachM: car ? P.MAX_DRIVE_TRAVEL_M : P.MAX_TRAVEL_M,
      run: node >= 0 ? shortestCached(world, node, bit, car ? P.MAX_DRIVE_TRAVEL_M : P.MAX_TRAVEL_M) : null,
      travelSpeed: car ? P.DRIVE_TRAVEL_MPS : P.TRAVEL_SPEED_MPS,
      updatedAgoMin: Math.max(0, Number(raw.updatedAgoMin) || 0),
      cands: [], claim: null, assigned: null, switching: false,
    };
  }).sort((a, b) => compareIds(a.id, b.id));
  const byId = new Map(searchers.map((s) => [s.id, s]));

  // ---- 3. Work in progress ----------------------------------------------------------------------------
  // Each active assignment's route lowers the map by CLAIM_CREDIT × its detection (less if the
  // searcher has gone quiet). A pair holding the same task is one look.
  const claims = [];
  const claimOf = new Map(); // searcherId → claim
  for (const who of [...state.active.keys()].sort(compareIds)) {
    const ev = state.active.get(who);
    const partner = ev.partnerId !== undefined && ev.partnerId !== null ? String(ev.partnerId) : null;
    const partnerClaim = partner ? claimOf.get(partner) : null;
    if (partnerClaim && partnerClaim.taskId === String(ev.taskId)) { partnerClaim.team.push(who); claimOf.set(who, partnerClaim); continue; }
    const task = segs.tasks.get(String(ev.taskId)) || null;
    const type = task ? task.type : typeFromId(ev.taskId);
    const knocks = type === 'yards' && ev.canvass !== false;
    const key = `claim:${ev.id}:${nightKey}`;
    let cov = caches.eventCov.get(key);
    if (!cov) {
      let track = ev.track || null;
      if (!track && task && (type === 'yards' || type === 'hazard_check')) {
        const tour = postmanTour(world, task);
        track = tour ? trackOfEdges(world, tour.edges, tour.nodes[0]) : null;
      }
      cov = coverageOfWork(world, { type, task, track: track || [], fraction: 1, canvass: knocks }, night, sinceMin, P);
      caches.eventCov.set(key, cov);
    }
    const s = byId.get(who);
    const quiet = s ? s.updatedAgoMin : Math.max(0, (nowMs - Number(ev.at)) / 60000);
    const weight = P.CLAIM_CREDIT * (quiet > P.STALE_MIN ? Math.exp(-(quiet - P.STALE_MIN) / P.STALE_FADE_MIN) : 1);
    const claim = { taskId: String(ev.taskId), task, type, ev, cov, weight, team: [who], knocks };
    claims.push(claim);
    claimOf.set(who, claim);
  }
  const apply = (map, cov, w) => { for (let i = 0; i < cov.cells.length; i++) map[cov.cells[i]] *= 1 - w * cov.det[i]; };
  const unapply = (map, cov, w) => { for (let i = 0; i < cov.cells.length; i++) map[cov.cells[i]] /= Math.max(1e-9, 1 - w * cov.det[i]); };
  const res = caches.res; // the map still to be found, given everyone's claims
  res.set(post);
  for (const claim of claims) apply(res, claim.cov, claim.weight);
  const heldTasks = new Map(); // taskId → searcher ids holding it
  for (const claim of claims) heldTasks.set(claim.taskId, claim.team);
  // Door-knocking counts once per block: who is doing it now, who was just given it in this
  // plan, and when it was last finished.
  const knockHeld = new Map();
  for (const claim of claims) if (claim.knocks) knockHeld.set(claim.taskId, claim.team);
  const knockGiven = new Map(); // taskId → searcher id
  const knockBusy = (taskId, s) => {
    const held = knockHeld.get(taskId);
    if (held && !held.includes(s.id)) return true;
    const given = knockGiven.get(taskId);
    if (given !== undefined && given !== s.id) return true;
    const last = (bayes.knocked || new Map()).get(taskId);
    return last !== undefined && (nowMs - last) / 60000 < P.CANVASS_REPEAT_MIN;
  };
  // The option as it stands right now: a block whose doors are spoken for becomes a walk past.
  const live = (o, s) => {
    if (o.task.type !== 'yards' || !knockBusy(o.task.id, s)) return o;
    if (!o.walkOnly) {
      const searchMin = o.route.open.length / P.SEARCH_SPEED_MPS / 60;
      o.walkOnly = { ...o, cov: walkCoverage(o.task), searchMin, totalMin: o.travelMin + searchMin, canvass: false, walkOnly: null };
    }
    return o.walkOnly;
  };

  // ---- 4. Candidates ------------------------------------------------------------------------------------
  // Quick score of every block and park: probability left there × a rough chance of spotting it.
  const canvass = night ? P.NIGHT_CANVASS_FACTOR : 1;
  const widths = sweepWidths('search', night, P);
  const roughYards = [0.5, 0.2, P.POD_CANVASS_YARD * canvass, P.POD_CANVASS_BUILDING * canvass, 0.15, 0]
    .map((v, k) => (k < 2 || k === 4 ? v * Math.min(1, widths[k] / 30) : v));
  const sweepP = 1 - Math.exp(-P.PARK_COVERAGE);
  const areaScore = new Float64Array(segs.areas.length);
  const isYards = Uint8Array.from(segs.areas, (t) => (t.type === 'yards' ? 1 : 0));
  for (let c = 0; c < res.length; c++) {
    const a = segs.label[c];
    if (a >= 0 && res[c] > 0) areaScore[a] += res[c] * (isYards[a] ? roughYards[vis[c]] : sweepP);
  }
  // Each hazard stretch's score on the hazard layer (how much probability is near it).
  const hazardScore = segs.hazards.map((task) => {
    let best = 0;
    if (input.hazard) { for (const c of task.cells) if (input.hazard[c] > best) best = input.hazard[c]; return best; }
    if (!task.nearCells) task.nearCells = footprint(world, task.cells).cells; // no layer given: within 40 m
    for (const c of task.nearCells) best += post[c];
    return best;
  });

  const tourTrack = (task, tour) => task.tourTrack || (task.tourTrack = trackOfEdges(world, tour.edges, tour.nodes[0]));
  // The coverage of doing a whole task, kept per task (it only depends on day or night).
  const taskCoverage = (task) => {
    if (!task.cov) task.cov = new Map();
    const key = task.type === 'containment' ? `${nightKey}:${Math.round(sinceMin / 5)}` : nightKey;
    let cov = task.cov.get(key);
    if (cov) return cov;
    if (task.type === 'park') cov = sweepCoverage(task, parkSweep(task, night, P).coverage);
    else if (task.type === 'containment') cov = postCoverage(world, task, night, sinceMin, P);
    else {
      const walked = trackCoverage(world, tourTrack(task, postmanTour(world, task)), 'search', night, P);
      cov = task.type === 'yards' ? mergeCoverage(world, [walked, canvassCoverage(world, task, night, P)]) : walked;
    }
    if (task.cov.size > 8) task.cov.clear();
    task.cov.set(key, cov);
    return cov;
  };
  const walkCoverage = (task) => {
    if (!task.covWalk) task.covWalk = [null, null];
    if (!task.covWalk[nightKey]) task.covWalk[nightKey] = trackCoverage(world, tourTrack(task, postmanTour(world, task)), 'search', night, P);
    return task.covWalk[nightKey];
  };
  const option = (s, task, cov, travelMin, searchMin, route, extra) => ({
    s, task, cov, travelMin, searchMin, totalMin: travelMin + searchMin, route, needsPair: false, ...extra,
  });

  // "Search this block" / "check this creek from the bank": the closed tour, started at the
  // corner nearest the searcher.
  const tourOption = (s, task) => {
    const tour = postmanTour(world, task);
    if (!tour || !s.run) return null;
    let at = -1; let best = Infinity;
    for (let i = 0; i < tour.edges.length; i++) { const d = s.run.dist[tour.nodes[i]]; if (d < best) { best = d; at = i; } }
    if (at < 0) return null;
    if (!task.open) task.open = new Map();
    let open = task.open.get(at);
    if (!open) { open = openTour(world, tour, at); task.open.set(at, open); }
    const searchMin = open.length / P.SEARCH_SPEED_MPS / 60 + (task.doors || 0) * P.KNOCK_MIN;
    return option(s, task, taskCoverage(task), (best + s.offsetM) / s.travelSpeed / 60, searchMin,
      { kind: 'tour', entry: tour.nodes[at], open }, { needsPair: task.type === 'hazard_check' });
  };
  const parkOption = (s, task) => {
    let entry = -1; let best = Infinity;
    for (const e of task.edges) {
      for (const v of [g.ea[e], g.eb[e]]) { const d = s.run.dist[v]; if (d < best || (d === best && v < entry)) { best = d; entry = v; } }
    }
    if (entry < 0 || best === Infinity) return null;
    const sweep = parkSweep(task, night, P);
    if (sweep.minutes < P.TASK_MIN_MIN) return null;
    return option(s, task, taskCoverage(task), (best + s.offsetM) / s.travelSpeed / 60, sweep.minutes, { kind: 'sweep', entry });
  };
  const postOption = (s, task) => {
    const d = s.run.dist[task.node];
    if (d === Infinity) return null;
    return option(s, task, taskCoverage(task), (d + s.offsetM) / s.travelSpeed / 60, P.POST_MIN, { kind: 'post', entry: task.node });
  };

  // Prizes for the orienteering routes: what a look along each street piece would find now.
  const prizeCache = new Map();
  const prizesOf = (task, pace) => {
    if (prizeCache.has(task.id)) return prizeCache.get(task.id);
    const w = sweepWidths(pace, night, P);
    const shared = sharedGraph(task.type);
    const prize = new Float64Array(shared.K); // 0 for pieces outside this task
    // Every piece's reach (squares and detection), laid end to end once per task and pace, so
    // the prizes are one tight loop over two arrays.
    if (!task.reach) task.reach = [null, null];
    let reach = task.reach[nightKey];
    if (!reach) {
      const off = new Int32Array(task.edges.length + 1);
      const cells = []; const det = [];
      for (let j = 0; j < task.edges.length; j++) {
        const e = task.edges[j];
        const fp = footprint(world, g.ecells.subarray(g.cellOff[e], g.cellOff[e + 1]));
        for (let i = 0; i < fp.cells.length; i++) {
          const d = lookProbability(fp.dist[i], w[vis[fp.cells[i]]], P);
          if (d >= 0.02) { cells.push(fp.cells[i]); det.push(d); }
        }
        off[j + 1] = cells.length;
      }
      reach = { off, cells: Int32Array.from(cells), det: Float32Array.from(det) };
      task.reach[nightKey] = reach;
    }
    const values = new Float64Array(task.edges.length);
    for (let j = 0; j < task.edges.length; j++) {
      let sum = 0;
      for (let i = reach.off[j]; i < reach.off[j + 1]; i++) sum += res[reach.cells[i]] * reach.det[i];
      prize[task.slots[j]] = sum;
      values[j] = sum;
    }
    const top = values.sort().subarray(Math.max(0, values.length - 60)).reduce((a, b) => a + b, 0);
    const out = { prize, top };
    prizeCache.set(task.id, out);
    return out;
  };
  // The network a hasty walker (or a driver) may move on, shared by all wedges (quadrants).
  const sharedGraph = (type) => {
    const key = type === 'drive' ? 'driveGraph' : 'walkGraph';
    if (!segs[key]) segs[key] = localGraph(world, type === 'drive' ? segs.driveEdges : segs.walkEdges);
    return segs[key];
  };
  const walkOption = (s, task) => {
    const pace = PACE_OF[task.type];
    const speed = paceSpeed(pace, P);
    const found = orienteer(world, sharedGraph(task.type), prizesOf(task, pace).prize, s.run, {
      budgetM: task.baseMin * 60 * speed, travelFactor: speed / s.travelSpeed, offsetM: s.offsetM,
    });
    if (!found || found.edges.length === 0) return null;
    const track = trackOfEdges(world, found.edges, found.startNode);
    return option(s, task, trackCoverage(world, track, pace, night, P), found.travelM / s.travelSpeed / 60,
      found.searchM / speed / 60, { kind: 'walk', entry: found.startNode, travel: found.travel, edges: found.edges, nodes: found.nodes, track });
  };

  const postMass = new Map(); // probability near each containment point, worked out once a plan
  const candidatesFor = (s) => {
    const out = [];
    if (!s.run) return out;
    const add = (o) => { if (o && o.totalMin > 0) out.push(o); };
    const straightMin = (t) => (Math.hypot(t.x - s.x, t.y - s.y) * 1.3) / s.travelSpeed / 60;
    const inReach = (t) => Math.hypot(t.x - s.x, t.y - s.y) <= s.reachM;
    const best = (list, score, count, make) => {
      const ranked = [];
      list.forEach((t, k) => {
        if (!inReach(t)) return;
        const v = score(t, k);
        if (v > 0) ranked.push({ t, v: v / (Math.max(t.baseMin, 1) + straightMin(t)) });
      });
      ranked.sort((a, b) => (b.v - a.v) || compareIds(a.t.id, b.t.id));
      let made = 0;
      for (const r of ranked) { if (made >= count) break; const o = make(s, r.t); if (o) { add(o); made += 1; } }
    };
    if (!s.car) {
      const usable = (t) => t.edges.length > 0 && t.baseMin >= P.TASK_MIN_MIN;
      best(segs.areas, (t, k) => (t.type === 'yards' && usable(t) ? areaScore[k] : 0), P.BLOCK_CANDIDATES, tourOption);
      best(segs.areas, (t, k) => (t.type === 'park' && t.edges.length > 0 ? areaScore[k] : 0), P.PARK_CANDIDATES, parkOption);
      best(segs.hazards, (t, k) => (usable(t) ? hazardScore[k] : 0), P.HAZARD_CANDIDATES, tourOption);
      // Hasty routes are built for free searchers only: they matter in the first minutes, when
      // nobody holds a task yet, and they are the costly ones to build.
      if (!s.claim) best(segs.hasty, (t) => prizesOf(t, 'hasty').top, P.HASTY_CANDIDATES, walkOption);
    } else {
      best(segs.drive, (t) => prizesOf(t, 'drive').top, 2, walkOption);
    }
    if (P.CONTAINMENT) {
      const share = mobileShare(sinceMin, P) * P.PASS_SHARE * P.POD_POST;
      best(segs.posts, (t) => {
        if (!postMass.has(t.id)) {
          if (!t.catch) t.catch = postCoverage(world, t, false, 0, P).cells;
          let mass = 0;
          for (const c of t.catch) mass += res[c];
          postMass.set(t.id, mass);
        }
        return postMass.get(t.id) * share;
      }, P.POST_CANDIDATES, postOption);
    }
    return out;
  };

  // How much joining a task that someone else holds (or was just given) is marked down.
  const taken = new Map(); // taskId → searcher ids given it in this plan
  const crowd = (o, s) => {
    const held = heldTasks.get(o.task.id);
    const given = taken.get(o.task.id);
    return (held && !held.includes(s.id)) || (given && given.some((id) => id !== s.id)) ? P.DOUBLE_UP_FACTOR : 1;
  };

  // A containment point needs one watcher: a second person there sees nothing more.
  const postTaken = (o, s) => {
    if (o.task.type !== 'containment') return false;
    const held = heldTasks.get(o.task.id);
    const given = taken.get(o.task.id);
    return Boolean((held && !held.includes(s.id)) || (given && given.some((id) => id !== s.id)));
  };

  if (tick) tick('scores');
  // ---- 5a. Searchers who hold a task: keep it unless something is clearly better ---------------------
  for (const s of searchers) {
    const claim = claimOf.get(s.id);
    if (!claim) continue;
    s.claim = claim;
    if (claim.team.length > 1) { s.cands = []; continue; } // a pair stays together until done
    unapply(res, claim.cov, claim.weight);
    s.cands = candidatesFor(s);
    const searchMin = Math.max(1, Number(claim.ev.searchMin) || (claim.task ? claim.task.baseMin : 30));
    const currentRate = gainOn(res, claim.cov) / searchMin; // travel is already behind them
    let bestOther = 0;
    for (const raw of s.cands) {
      if (raw.task.id === claim.taskId || raw.needsPair || postTaken(raw, s)) continue;
      const o = live(raw, s);
      const rate = gainOn(res, o.cov) / o.totalMin / crowd(o, s);
      if (rate > bestOther) bestOther = rate;
    }
    if (bestOther > P.SWITCH_FACTOR * currentRate && bestOther >= P.MIN_USEFUL_RATE) {
      s.switching = true; // their claim stays off the map: they are free again
      heldTasks.delete(claim.taskId);
      knockHeld.delete(claim.taskId);
    } else {
      apply(res, claim.cov, claim.weight);
    }
  }
  const free = searchers.filter((s) => !s.claim || s.switching);
  for (const s of free) if (!s.switching) s.cands = candidatesFor(s);

  if (tick) tick('candidates');
  // ---- 5b. Hazard pairs ------------------------------------------------------------------------------------
  const unfilled = [];
  const recentlyChecked = new Set();
  for (const rec of state.done) if (!rec.partial && (nowMs - rec.at) / 60000 <= P.HAZARD_RECHECK_MIN) recentlyChecked.add(rec.taskId);
  const freeFoot = () => free.filter((s) => !s.car && !s.assigned && s.run);
  const give = (s, o, flags) => {
    s.assigned = { o, ...flags };
    if (o.task.type === 'yards' && o.canvass !== false && !knockGiven.has(o.task.id)) knockGiven.set(o.task.id, s.id);
    if (!taken.has(o.task.id)) taken.set(o.task.id, []);
    taken.get(o.task.id).push(s.id);
  };
  const pairFor = (task, people) => {
    const made = people.map((s) => s.cands.find((c) => c.task === task) || tourOption(s, task)).filter(Boolean)
      .sort((a, b) => (a.travelMin - b.travelMin) || compareIds(a.s.id, b.s.id));
    if (made.length < 2) return null;
    // Both walk the lead's route; the partner's travel is to the lead's starting corner.
    const lead = made[0];
    const mate = made[1];
    const toStart = mate.s.run.dist[lead.route.entry];
    const mateTravel = toStart < Infinity ? (toStart + mate.s.offsetM) / mate.s.travelSpeed / 60 : mate.travelMin;
    return [lead, { ...lead, s: mate.s, travelMin: mateTravel, totalMin: mateTravel + lead.searchMin }];
  };
  const heldHazards = claims.filter((c) => c.type === 'hazard_check').length;
  let forced = 0;
  const hazardOrder = segs.hazards.map((task, k) => ({ task, score: hazardScore[k] }))
    .filter((h) => h.score >= P.HAZARD_MIN_CHANCE && !heldTasks.has(h.task.id) && !recentlyChecked.has(h.task.id))
    .sort((a, b) => (b.score - a.score) || compareIds(a.task.id, b.task.id));
  for (const { task, score } of hazardOrder) {
    if (task.edges.length === 0 || !postmanTour(world, task)) { unfilled.push({ taskId: task.id, type: task.type, reason: 'no_public_view', hazardScore: score }); continue; }
    if (!P.HAZARD_FIRST) continue;
    if (forced + heldHazards >= Math.max(1, Math.floor(searchers.length / P.HAZARD_TEAM_DIVISOR))) continue;
    const people = freeFoot().filter((s) => Math.hypot(task.x - s.x, task.y - s.y) <= s.reachM);
    const pair = people.length >= 2 ? pairFor(task, people) : null;
    if (!pair) {
      // Only worth a warning if the check would have been sent: look at what one person would find.
      const lone = freeFoot().map((s) => tourOption(s, task)).find(Boolean);
      if (!lone || gainOn(res, lone.cov) >= P.HAZARD_MIN_POS) unfilled.push({ taskId: task.id, type: task.type, reason: 'needs_partner', hazardScore: score });
      continue;
    }
    if (gainOn(res, pair[0].cov) < P.HAZARD_MIN_POS) continue; // the bank check itself must be worth it
    give(pair[0].s, pair[0], { forced: true, partner: pair[1].s.id });
    give(pair[1].s, pair[1], { forced: true, partner: pair[0].s.id });
    apply(res, pair[0].cov, 1);
    forced += 1;
  }
  // Other hazard tasks compete on their numbers: a pair goes when its two shares beat what the
  // two would get apart.
  const bestSingle = (s) => {
    let rate = 0;
    for (const raw of s.cands) {
      if (raw.needsPair || postTaken(raw, s)) continue;
      const o = live(raw, s);
      rate = Math.max(rate, gainOn(res, o.cov) / o.totalMin / crowd(o, s));
    }
    return rate;
  };
  for (let round = 0; round < searchers.length; round++) {
    const people = freeFoot();
    if (people.length < 2) break;
    const alone = new Map(people.map((s) => [s.id, bestSingle(s)]));
    const seen = new Set();
    let pick = null;
    for (const s of people) {
      for (const o of s.cands) {
        if (!o.needsPair || seen.has(o.task.id) || heldTasks.has(o.task.id) || taken.has(o.task.id)) continue;
        seen.add(o.task.id);
        const pair = pairFor(o.task, people);
        if (!pair) continue;
        const gain = gainOn(res, pair[0].cov);
        const edge = gain / 2 / pair[0].totalMin + gain / 2 / pair[1].totalMin - alone.get(pair[0].s.id) - alone.get(pair[1].s.id);
        if (edge > 0 && (!pick || edge > pick.edge)) pick = { edge, pair };
      }
    }
    if (!pick) break;
    give(pick.pair[0].s, pick.pair[0], { partner: pick.pair[1].s.id });
    give(pick.pair[1].s, pick.pair[1], { partner: pick.pair[0].s.id });
    apply(res, pick.pair[0].cov, 1);
  }

  // ---- 5c. Everyone else: greedy by gain per minute, then improve the team score ------------------------
  if (tick) tick('pairs');
  const singles = free.filter((s) => !s.assigned);
  const waiting = new Set(singles);
  while (waiting.size) {
    let pick = null;
    for (const s of singles) {
      if (!waiting.has(s)) continue;
      for (const raw of s.cands) {
        if (raw.needsPair || postTaken(raw, s)) continue;
        const o = live(raw, s);
        const rate = gainOn(res, o.cov) / o.totalMin;
        const value = rate / crowd(o, s);
        if (value > 0 && (!pick || value > pick.value)) pick = { s, o, value, rate };
      }
    }
    if (!pick || pick.rate < P.MIN_USEFUL_RATE * 0.01) break;
    give(pick.s, pick.o, {});
    waiting.delete(pick.s);
    apply(res, pick.o.cov, 1);
  }
  // Improve: each searcher in turn moves to whatever gives THEM the most gain per minute, given
  // where everyone else now is (what a route adds beyond the others' routes). Repeat until
  // nobody moves. Search theory's rule for dividing effort is exactly this: put each bit of
  // effort where the return on it is highest (Koopman; Stone 1975). With equal task times every
  // such move raises the team's joint chance of finding the person, so it can only get better.
  const team = singles.filter((s) => s.assigned);
  for (let pass = 0; pass < P.IMPROVE_PASSES && team.length > 1; pass++) {
    let moved = false;
    for (const s of team) {
      const mine = s.assigned.o;
      unapply(res, mine.cov, 1);
      taken.set(mine.task.id, taken.get(mine.task.id).filter((id) => id !== s.id));
      if (taken.get(mine.task.id).length === 0) taken.delete(mine.task.id);
      if (knockGiven.get(mine.task.id) === s.id) knockGiven.delete(mine.task.id);
      let best = mine;
      let bestValue = gainOn(res, mine.cov) / mine.totalMin / crowd(mine, s);
      for (const raw of s.cands) {
        if (raw.needsPair || postTaken(raw, s)) continue;
        const o = live(raw, s);
        if (o === mine) continue;
        const value = gainOn(res, o.cov) / o.totalMin / crowd(o, s);
        if (value > bestValue * (1 + 1e-9)) { best = o; bestValue = value; }
      }
      give(s, best, {});
      apply(res, best.cov, 1);
      if (best !== mine) moved = true;
    }
    if (!moved) break;
  }

  // ---- 6. Options, as data ---------------------------------------------------------------------------------
  const point = (v) => toLatLng(world, g.nx[v], g.ny[v]);
  const boundsOf = (task) => {
    if (task.bounds) return task.bounds;
    let rMin = Infinity; let rMax = -1; let cMin = Infinity; let cMax = -1;
    for (const c of task.cells) {
      const r = Math.floor(c / n); const col = c % n;
      if (r < rMin) rMin = r; if (r > rMax) rMax = r; if (col < cMin) cMin = col; if (col > cMax) cMax = col;
    }
    const sw = toLatLng(world, cMin * world.cellM - world.half, rMin * world.cellM - world.half);
    const ne = toLatLng(world, (cMax + 1) * world.cellM - world.half, (rMax + 1) * world.cellM - world.half);
    task.bounds = [[sw.lat, sw.lng], [ne.lat, ne.lng]];
    return task.bounds;
  };
  const mainLevel = (e) => (g.etype[e] === HW.primary ? 2 : g.etype[e] === HW.secondary ? 1 : 0);
  // Danger: its own number (0–3) and a list of warning codes. Never mixed into the ranking.
  const dangerOf = (o, edges, nodes) => {
    const warnings = new Set();
    let level = 0;
    const raise = (code, to) => { warnings.add(code); if (to > level) level = to; };
    let besideWater = 0; // squares of the route within WATER_NEAR_CELLS of water
    if (night) raise('night', 1);
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (g.eflags[e] & RAIL_X) raise('rail_crossing', 2);
      if (!o.s.car) {
        if (mainLevel(e)) raise('along_high_traffic', 1);
        for (let k = g.cellOff[e]; k < g.cellOff[e + 1]; k++) besideWater += world.nearWater[g.ecells[k]];
        if (i > 0 && !mainLevel(e) && !mainLevel(edges[i - 1])) {
          // Walking from one side street to another across a main road.
          const v = nodes[i];
          let cross = 0;
          for (let k = g.adjOff[v]; k < g.adjOff[v + 1]; k++) cross = Math.max(cross, mainLevel(g.adjEdge[k]));
          if (cross) raise('high_traffic_crossing', cross);
        }
      }
    }
    if (besideWater * world.cellM >= P.WATER_NEAR_MIN_M) raise('water_nearby', 1);
    if (o.task.type === 'hazard_check') { raise('do_not_enter_water', 3); raise('stay_on_path', 3); }
    if (o.task.type === 'containment' && world.nearWater[o.task.cell]) raise('water_nearby', 1);
    return { level, warnings: [...warnings].sort() };
  };
  const describe = (o, s, flags = {}) => {
    const travel = o.route.travel || pathTo(world, s.run, o.route.entry) || { edges: [], nodes: [o.route.entry] };
    const search = o.route.kind === 'tour' ? o.route.open : o.route.kind === 'walk' ? { edges: o.route.edges, nodes: o.route.nodes } : { edges: [], nodes: [] };
    const edges = [...travel.edges, ...search.edges];
    const nodes = [...travel.nodes, ...search.nodes.slice(1)];
    let lengthM = s.offsetM;
    for (const e of edges) lengthM += g.elen[e];
    const track = o.route.kind === 'tour' ? trackOfEdges(world, search.edges, search.nodes[0])
      : o.route.kind === 'walk' ? o.route.track : o.route.kind === 'post' ? [o.task.cell] : [];
    const gain = flags.gain !== undefined ? flags.gain : gainOn(res, o.cov);
    const alone = gainOn(post, o.cov);
    let inReach = 0;
    for (let i = 0; i < o.cov.cells.length; i++) inReach += post[o.cov.cells[i]];
    const people = flags.partner ? 2 : 1;
    const reasons = [
      { code: 'probability_in_reach', value: inReach },
      { code: 'chance_to_spot', value: inReach > 0 ? alone / inReach : 0 },
    ];
    if (alone - gain > 1e-9) reasons.push({ code: 'teammates_cover', value: alone - gain });
    if (o.task.doors) reasons.push({ code: 'doors', value: o.task.doors });
    if (o.task.type === 'containment') reasons.push({ code: 'still_walking', value: mobileShare(sinceMin, P) });
    if (flags.forced) reasons.push({ code: 'hazard_first' });
    if (night) reasons.push({ code: 'night' });
    return {
      taskId: o.task.id, type: o.task.type, kind: o.task.kind || null,
      posGain: gain, posGainAlone: alone,
      travelMin: o.travelMin, searchMin: o.searchMin,
      // For a pair, the rate is per searcher-minute: two people's time for one look.
      ratePerMin: gain / o.totalMin / people,
      danger: dangerOf(o, edges, nodes),
      reasons,
      route: {
        pattern: o.route.kind === 'tour' || o.route.kind === 'walk' ? (s.car ? 'drive' : 'walk') : o.route.kind,
        points: [toLatLng(world, s.x, s.y), ...nodes.map(point)],
        searchFrom: travel.nodes.length, // index in points where the searching starts
        lengthM, track,
        area: o.task.cells.length > 1 ? { center: toLatLng(world, o.task.x, o.task.y), bounds: boundsOf(o.task) } : null,
        lineSpacingM: o.route.kind === 'sweep' ? widths[V.OPEN] : null,
      },
      // 'ask': knock and ask to check the yard. A block whose doors someone else is doing (or
      // did within CANVASS_REPEAT_MIN) is only walked past: nothing private is entered or asked.
      permission: o.task.type === 'yards' && o.canvass !== false ? 'ask' : 'none',
      canvass: o.task.type === 'yards' && o.canvass !== false,
      needsPair: o.needsPair, partnerId: flags.partner || null,
      urgent: Boolean(flags.forced), keep: false,
      expiresInMin: Math.ceil(o.totalMin * P.EXPIRE_FACTOR + P.EXPIRE_MARGIN_MIN),
    };
  };

  // The POS gain shown for an assigned route counts what teammates who FINISH EARLIER would not
  // already have found (work in progress first, then routes by their minutes). Added up over
  // the team, these gains are exactly the chance that someone finds the person.
  if (tick) tick('assign');
  const credit = caches.credit;
  credit.set(post);
  for (const claim of claims) if (!claim.team.some((id) => byId.get(id) && byId.get(id).switching)) apply(credit, claim.cov, claim.weight);
  const credited = new Map(); // coverage → gain
  searchers.filter((s) => s.assigned).sort((a, b) => (a.assigned.o.totalMin - b.assigned.o.totalMin) || compareIds(a.id, b.id)).forEach((s) => {
    const cov = s.assigned.o.cov;
    if (credited.has(cov) && s.assigned.partner) return; // the partner of a pair: the same look
    credited.set(cov, (credited.get(cov) || 0) + gainOn(credit, cov));
    s.assigned.gain = gainOn(credit, cov);
    apply(credit, cov, 1);
  });
  for (const s of searchers) if (s.assigned && s.assigned.gain === undefined) s.assigned.gain = byId.get(s.assigned.partner).assigned.gain;

  let bestRate = 0;
  const out = searchers.map((s) => {
    const kept = s.claim && !s.switching ? s.claim : null;
    const mine = kept ? { cov: kept.cov, w: kept.weight } : s.assigned ? { cov: s.assigned.o.cov, w: 1 } : null;
    // A pair's look is shared, so it is only lifted off the map once, for both.
    if (mine) unapply(res, mine.cov, mine.w);
    let primary = null;
    if (kept) {
      const gain = gainOn(res, kept.cov);
      const searchMin = Math.max(1, Number(kept.ev.searchMin) || (kept.task ? kept.task.baseMin : 30));
      primary = {
        taskId: kept.taskId, type: kept.type, kind: kept.task ? kept.task.kind || null : null,
        posGain: gain, posGainAlone: gainOn(post, kept.cov), travelMin: 0, searchMin,
        ratePerMin: gain / searchMin / kept.team.length,
        danger: { level: kept.type === 'hazard_check' ? 3 : night ? 1 : 0, warnings: night ? ['night'] : [] },
        reasons: [{ code: 'kept' }],
        route: { pattern: 'held', points: [], searchFrom: 0, lengthM: 0, track: kept.ev.track || [], area: null, lineSpacingM: null },
        permission: kept.knocks ? 'ask' : 'none', canvass: Boolean(kept.knocks),
        needsPair: kept.type === 'hazard_check', partnerId: kept.team.find((id) => id !== s.id) || null,
        urgent: false, keep: true,
        expiresInMin: Math.max(0, Math.ceil((Number(kept.ev.expiresAt) - nowMs) / 60000)),
      };
    } else if (s.assigned) {
      primary = describe(s.assigned.o, s, { forced: s.assigned.forced, partner: s.assigned.partner, gain: s.assigned.gain });
    }
    const others = s.cands
      .filter((o) => (!primary || o.task.id !== primary.taskId) && !postTaken(o, s))
      .map((raw) => live(raw, s))
      .map((o) => ({ o, value: gainOn(res, o.cov) / o.totalMin / (o.needsPair ? 2 : 1) / crowd(o, s) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => (b.value - a.value) || compareIds(a.o.task.id, b.o.task.id))
      .slice(0, Math.max(0, P.OPTIONS - (primary ? 1 : 0)))
      .map((x) => describe(x.o, s));
    if (mine) apply(res, mine.cov, mine.w);
    const options = primary ? [primary, ...others] : others;
    for (const o of options) if (o.ratePerMin > bestRate) bestRate = o.ratePerMin;
    return {
      searcherId: s.id, mode: s.car ? 'car' : 'foot',
      keep: Boolean(kept), switchSuggested: s.switching,
      primary, options,
      hold: primary ? null : s.node < 0 ? 'no_street_nearby' : 'nothing_useful',
    };
  });

  if (tick) tick('options');
  // ---- 7. Measures ----------------------------------------------------------------------------------------
  const history = bayes.history;
  const hourAgo = nowMs - 3600000;
  let before = history.length ? null : bayes.restOfWorld;
  for (const h of history) if (h.at <= hourAgo) before = h.restOfWorld;
  if (before === null) before = Math.max(0, Number(input.restOfWorld) || 0) / bayes.startTotal;
  const reasons = [];
  if (bayes.restOfWorld >= P.ROW_EXPAND) reasons.push('rest_of_world_high');
  if (searchers.length > 0 && bestRate < P.MIN_USEFUL_RATE) reasons.push('map_exhausted');
  if (unfilled.length) reasons.push('hazard_unchecked');
  return {
    night,
    searchers: out,
    unfilled,
    measures: {
      cumulativePOS: bayes.cumulativePOS,
      remaining: 1 - bayes.restOfWorld,     // probability still on the map
      restOfWorld: bayes.restOfWorld,
      rowTrend: { perHour: bayes.restOfWorld - before, history },
      bestRatePerMin: bestRate,
      expand: { signal: reasons.length > 0, reasons },
    },
  };
}

// The event to send when a searcher accepts an option (the screen adds the id).
export function assignedEvent(option, searcherId, nowMs) {
  return {
    type: 'assigned', searcherId: String(searcherId), taskId: option.taskId, at: nowMs,
    expiresAt: nowMs + option.expiresInMin * 60000,
    track: option.route.track, searchMin: option.searchMin,
    ...(option.type === 'yards' ? { canvass: option.canvass } : {}),
    ...(option.partnerId ? { partnerId: option.partnerId } : {}),
  };
}

