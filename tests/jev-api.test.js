// Checks proxy/jev.js against TypeSafe's published API (docs.typesafe.ai, read Nov 22, 2026):
//   POST https://api.typesafe.ai/v1/systemone, Bearer key, body { model, state, questions };
//   question types "choice" (criteria = object of options, at most 255), "score" (criteria = ordered
//   array, 2 to 10 levels) and "noul" (TypeSafe's yes/no type; Vercel's AI SDK calls it "boolean",
//   which the HTTP API does not know); answers { model, answers: { id: { type, choice | score | noul,
//   confidence, probabilities } }, usage }. A score is the probability-weighted mean of the levels.
// Jev itself is never called. Written with Claude Code; Nathan reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JEV_URL, JEV_MODEL, buildJevRequest, jevToDraft, scoreLevel, MINUTE_OPTION } from '../proxy/jev.js';

const PLACES = [{ name: 'Lake Elizabeth', lat: 37.5503, lng: -121.963 }, { name: 'Walnut Avenue', lat: 37.5556, lng: -121.9749 }];
const CORNERS = [{ name: 'Paseo Padre Parkway & Stevenson Boulevard', streets: ['Paseo Padre Parkway', 'Stevenson Boulevard'], lat: 37.549, lng: -121.972 }];

test('request: the documented endpoint, model and top-level fields', () => {
  assert.equal(JEV_URL, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(JEV_MODEL, 'jev-latest');
  const req = buildJevRequest('saw him by the lake', 'en', PLACES, CORNERS);
  assert.deepEqual(Object.keys(req).sort(), ['model', 'questions', 'state']);
});

test('request: only documented question types, never Vercel\'s "boolean", within the documented limits', () => {
  const req = buildJevRequest('saw him', 'en', PLACES, CORNERS);
  const wire = JSON.parse(JSON.stringify(req));
  for (const [id, q] of Object.entries(wire.questions)) {
    assert.ok(['choice', 'score', 'noul'].includes(q.type), `${id}: ${q.type}`);
    assert.equal(typeof q.instructions, 'string', id);
    if (q.type === 'choice') {
      assert.ok(q.criteria && !Array.isArray(q.criteria) && typeof q.criteria === 'object', id);
      assert.ok(Object.keys(q.criteria).length <= 255, id);
    }
    if (q.type === 'score') assert.ok(Array.isArray(q.criteria) && q.criteria.length >= 2 && q.criteria.length <= 10, id);
  }
  assert.ok(!JSON.stringify(wire).includes('"boolean"'));
});

test('request: every choice lists its safe "not stated" option first, as sent on the wire', () => {
  // TypeSafe docs, "Choice option order": Jev leans toward the first option.
  const wire = JSON.parse(JSON.stringify(buildJevRequest('saw him', 'en', PLACES, CORNERS)));
  assert.equal(Object.keys(wire.questions.kind.criteria)[0], 'message');
  assert.equal(Object.keys(wire.questions.direction.criteria)[0], 'unknown');
  assert.equal(Object.keys(wire.questions.minutes.criteria)[0], 'unknown');
  assert.equal(Object.keys(wire.questions.place.criteria)[0], 'none');
  for (const q of Object.values(wire.questions)) {
    if (q.type === 'choice') for (const option of Object.keys(q.criteria)) assert.ok(!/^\d+$/.test(option), `number-like option "${option}" would be reordered first`);
  }
});

test('response: the documented shape (model, answers with probabilities and legend, usage) becomes a draft', () => {
  const response = {
    model: 'jev-1.14.0',
    answers: {
      kind: { type: 'choice', choice: 'sighting', confidence: 0.93, probabilities: { message: 0.03, searched: 0.01, sighting: 0.96 } },
      direction: { type: 'choice', choice: 'E', confidence: 0.88, probabilities: { unknown: 0.04, N: 0, NE: 0.02, E: 0.92, SE: 0.02, S: 0, SW: 0, W: 0, NW: 0 } },
      minutes: { type: 'choice', choice: MINUTE_OPTION[10], confidence: 0.81, probabilities: { unknown: 0.05, [MINUTE_OPTION[10]]: 0.9, [MINUTE_OPTION[15]]: 0.05 } },
      place: { type: 'choice', choice: 'Lake Elizabeth', confidence: 0.86, probabilities: { none: 0.06, 'Lake Elizabeth': 0.94 } },
      sure: { type: 'score', score: 0.67, confidence: 0.5, legend: { 0: 'unsure', 1: 'fairly sure', 2: 'certain' }, probabilities: { 0: 0.33, 1: 0.67, 2: 0 } },
    },
    usage: { input_tokens: 812, output_tokens: 61 },
  };
  const d = jevToDraft(response.answers, 'saw him by the lake 10 minutes ago walking east', PLACES);
  assert.deepEqual([d.kind, d.placeText, d.direction, d.minutesSince, d.reliability], ['sighting', 'Lake Elizabeth', 'E', 10, 0.6]);
});

test('score: the most likely level, never above the rounded mean, ties to the lower level', () => {
  assert.equal(scoreLevel({ score: 0.67, probabilities: { 0: 0.33, 1: 0.67, 2: 0 } }, 3), 1); // the docs' example
  assert.equal(scoreLevel({ score: 1.43, probabilities: { 0: 0, 1: 0.57, 2: 0.43 } }, 3), 1); // the docs' split example
  assert.equal(scoreLevel({ score: 1.2, probabilities: { 0: 0.4, 1: 0, 2: 0.6 } }, 3), 1, '40% maybe / 60% certain is not "certain"');
  assert.equal(scoreLevel({ score: 1.0, probabilities: { 0: 0.45, 1: 0.1, 2: 0.45 } }, 3), 0, 'a tie goes to the lower level');
  assert.equal(scoreLevel({ score: 2.2 }, 3), 2, 'no probabilities: the rounded mean, capped');
});
