// Tests for report.js: draft checking and draft -> Event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, draftToEvent, parseReport, isVoiceSupported } from '../report.js';

test('validateDraft cleans bad values', () => {
  const d = validateDraft({ kind: 'hack', lat: '37.5', lng: 'x', direction: 'east', minutesSince: -5, reliability: 0.8, note: 5 });
  assert.deepEqual(d, { kind: 'message', placeText: '', lat: null, lng: null, direction: null, minutesSince: 0, reliability: 0.9, note: '' });
});

test('validateDraft keeps good values', () => {
  const d = validateDraft({ kind: 'sighting', placeText: ' the lake ', lat: 37.5, lng: -121.9, direction: 'e', minutesSince: 10.4, reliability: 0.3, note: 'blue coat' });
  assert.equal(d.placeText, 'the lake');
  assert.equal(d.direction, 'E');
  assert.equal(d.minutesSince, 10);
  assert.equal(d.reliability, 0.3);
});

test('validateDraft rejects non-objects', () => {
  for (const v of [null, 'x', 3, []]) assert.equal(validateDraft(v), null);
});

test('draftToEvent: sighting', () => {
  const e = draftToEvent({ kind: 'sighting', lat: 37.5, lng: -121.9, direction: null, minutesSince: null, reliability: 0.6, note: 'hat' }, { by: 'Ana', at: 1000 });
  assert.deepEqual(e, { type: 'sighting', lat: 37.5, lng: -121.9, direction: null, minutesSince: 0, reliability: 0.6, note: 'hat', by: 'Ana', at: 1000 });
});

test('draftToEvent: sighting without a pin returns null', () => {
  assert.equal(draftToEvent({ kind: 'sighting', lat: null, lng: null }), null);
});

test('draftToEvent: message and searched', () => {
  assert.deepEqual(draftToEvent({ kind: 'message', note: 'I have the park' }, { by: 'Bo', at: 5 }), { type: 'message', text: 'I have the park', by: 'Bo', at: 5 });
  assert.equal(draftToEvent({ kind: 'searched', placeText: 'park' }), null);
});

test('parseReport without PROXY_URL throws proxy_error', async () => {
  await assert.rejects(parseReport('hi', {}), { message: 'proxy_error' });
});

test('no voice in node', () => assert.equal(isVoiceSupported(), false));
