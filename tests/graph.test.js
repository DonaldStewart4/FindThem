// Tests for engine/graph.js. They check prepareArea(osm) against INTERFACES.md section 2.
// Run just these with:
//   node --test tests/graph.test.js
// (Both engine/graph.js and these tests were written with Claude Code; see README "Who built what".)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as graph from '../engine/graph.js';

// A tiny made-up area: node A at the center, B ~111 m north of A, C ~88 m east of A,
// and one creek running east-west 55 m north of A.
const CENTER = { lat: 37.5, lng: -122.0 };
const TINY = {
  center: CENTER,
  radiusM: 3200,
  nodes: [
    { id: 1, lat: 37.5, lng: -122.0 },     // A
    { id: 2, lat: 37.501, lng: -122.0 },   // B: 0.001° north ≈ 111.3 m
    { id: 3, lat: 37.5, lng: -121.999 },   // C: 0.001° east ≈ 88.3 m at this latitude
  ],
  ways: [
    { id: 100, highway: 'residential', name: 'North St', nodeIds: [1, 2] },
    { id: 200, highway: 'footway', name: null, nodeIds: [1, 3] },
  ],
  features: [
    { id: 'w9', type: 'creek', name: 'Test Creek', shape: 'line',
      points: [{ lat: 37.5005, lng: -122.002 }, { lat: 37.5005, lng: -121.998 }] },
  ],
};

const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ~${expected}, got ${actual}`);

test('prepareArea keeps the center as origin and projects nodes to meters', () => {
  const area = graph.prepareArea(TINY);
  assert.deepEqual(area.origin, CENTER);
  assert.equal(area.graph.nodes.length, 3);
  const [a, b, c] = area.graph.nodes;
  assert.equal(a.id, 1);
  near(a.x, 0, 0.01); near(a.y, 0, 0.01);       // the center is (0, 0)
  near(b.x, 0, 0.01); near(b.y, 111.32, 0.5);    // north = +y
  near(c.x, 88.32, 0.5); near(c.y, 0, 0.01);     // east = +x
  assert.equal(b.lat, 37.501);                   // lat/lng are kept for drawing
});

test('every pair of neighboring nodes in a way becomes one edge with length and bearing', () => {
  const area = graph.prepareArea(TINY);
  const { edges, nodes } = area.graph;
  assert.equal(edges.length, 2);
  const north = edges.find((e) => e.wayId === 100);
  const east = edges.find((e) => e.wayId === 200);
  assert.equal(nodes[north.a].id, 1);
  assert.equal(nodes[north.b].id, 2);
  near(north.length, 111.32, 0.5);
  near(north.bearingAB, 0, 0.5);    // A→B points north
  near(east.length, 88.32, 0.5);
  near(east.bearingAB, 90, 0.5);    // A→C points east
  assert.equal(north.name, 'North St');
  assert.equal(east.name, null);
});

test('each node lists the edges that touch it', () => {
  const area = graph.prepareArea(TINY);
  const { nodes, edges } = area.graph;
  const a = nodes.find((n) => n.id === 1);
  const b = nodes.find((n) => n.id === 2);
  assert.equal(a.edges.length, 2);  // A touches both edges
  assert.equal(b.edges.length, 1);  // B is a dead end
  for (const i of a.edges) assert.ok(edges[i].a === nodes.indexOf(a) || edges[i].b === nodes.indexOf(a));
});

test('bearings are between 0 and 360 (B→A on a north street would be 180)', () => {
  const reversed = { ...TINY, ways: [{ id: 300, highway: 'residential', name: 'South', nodeIds: [2, 1] }] };
  const area = graph.prepareArea(reversed);
  near(area.graph.edges[0].bearingAB, 180, 0.5);
  const west = { ...TINY, ways: [{ id: 400, highway: 'residential', name: 'West', nodeIds: [3, 1] }] };
  near(graph.prepareArea(west).graph.edges[0].bearingAB, 270, 0.5); // not -90
});

test('prepareArea does not change the osm data it was given', () => {
  const before = JSON.stringify(TINY);
  graph.prepareArea(TINY);
  assert.equal(JSON.stringify(TINY), before);
});

test('optional helper nearestNode(area, lat, lng) returns the closest node index',
  { skip: typeof graph.nearestNode !== 'function' && 'nearestNode not exported yet' }, () => {
    const area = graph.prepareArea(TINY);
    const i = graph.nearestNode(area, 37.50095, -122.00001); // just south of B
    assert.equal(area.graph.nodes[i].id, 2);
  });

test('optional helper nearestTrap(area, x, y, maxM) finds a creek within 30 m, and nothing farther',
  { skip: typeof graph.nearestTrap !== 'function' && 'nearestTrap not exported yet' }, () => {
    const area = graph.prepareArea(TINY);
    // The creek is ~55.7 m north of A. A point 40 m north of A is ~15.7 m from it.
    const found = graph.nearestTrap(area, 0, 40, 30);
    assert.ok(found, 'should find the creek');
    assert.equal(found.type, 'creek');
    assert.equal(found.id, 'w9');
    assert.equal(graph.nearestTrap(area, 0, 0, 30), null); // 55 m away: too far
  });

test('the real Fremont data: one edge per neighbor pair, sensible lengths, fast enough', () => {
  const osm = JSON.parse(fs.readFileSync(new URL('./fixtures/demo-area.json', import.meta.url)));
  const t0 = performance.now();
  const area = graph.prepareArea(osm);
  const ms = performance.now() - t0;
  const expectedEdges = osm.ways.reduce((sum, w) => sum + w.nodeIds.length - 1, 0);
  assert.equal(area.graph.edges.length, expectedEdges);
  assert.equal(area.graph.nodes.length, osm.nodes.length);
  for (const e of area.graph.edges) {
    assert.ok(e.length > 0 && e.length < 2000, `odd edge length ${e.length}`);
    assert.ok(e.bearingAB >= 0 && e.bearingAB < 360, `bearing out of range ${e.bearingAB}`);
  }
  assert.ok(ms < 1500, `prepareArea took ${Math.round(ms)} ms (aim for well under a second on a laptop)`);
});
