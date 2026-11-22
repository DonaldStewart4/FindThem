// Tests for quickread.js: the report box's backup reader (simple word rules on the phone,
// used when Jev can't answer). Runs with `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLocally, readKind, readMinutes, readDirection, readReliability, readPlace } from '../quickread.js';
import { validateDraft } from '../report.js';

const places = [
  { name: 'Paseo Padre Parkway', lat: 37.54966, lng: -121.97333 },
  { name: 'Fremont Central Park', lat: 37.55673, lng: -121.96241 },
  { name: 'Central Park', lat: 37.55, lng: -121.96 },
  { name: 'East Plaza', lat: 37.55742, lng: -121.97622 },
];

test('a typical English sighting fills every field', () => {
  const d = readLocally('I saw him by Paseo Padre 10 minutes ago walking east, blue coat', { places });
  assert.deepEqual(d, {
    kind: 'sighting', placeText: 'Paseo Padre Parkway', lat: 37.54966, lng: -121.97333,
    direction: 'E', minutesSince: 10, reliability: 0.6,
    note: 'I saw him by Paseo Padre 10 minutes ago walking east, blue coat',
  });
});

test('kind: not found beats saw, questions are messages', () => {
  assert.equal(readKind("Checked the park, didn't see him"), 'searched');
  assert.equal(readKind('Revisamos todo, no hay nadie'), 'searched');
  assert.equal(readKind("On a fouillé, il n'y a personne"), 'searched');
  assert.equal(readKind('我们找过了，没有人'), 'searched');
  assert.equal(readKind('誰もいませんでした'), 'searched');
  assert.equal(readKind('Has anyone seen him?'), 'message');
  assert.equal(readKind('¿Alguien ha visto a mi papá?'), 'message');
  assert.equal(readKind('Lo vi en el parque'), 'sighting');
  assert.equal(readKind('看到他了'), 'sighting');
  assert.equal(readKind("I'm heading to the library"), 'message');
});

test('minutes in all 5 languages', () => {
  assert.equal(readMinutes('about 15 min ago'), 15);
  assert.equal(readMinutes('ten minutes ago'), 10);
  assert.equal(readMinutes('hace diez minutos'), 10);
  assert.equal(readMinutes("il y a un quart d'heure"), 15);
  assert.equal(readMinutes('半小时前'), 30);
  assert.equal(readMinutes('十分钟前'), 10);
  assert.equal(readMinutes('10分前'), 10);   // full-width digits work too
  assert.equal(readMinutes('just now'), 0);
  assert.equal(readMinutes('an hour ago'), 60);
  assert.equal(readMinutes('he had a blue coat'), null);
  assert.equal(readMinutes('route 999 minutes'), null); // too big to be "minutes ago"
});

test('direction needs a "heading" word, so place names and "este" (this) are not directions', () => {
  assert.equal(readDirection('walking north-east'), 'NE');
  assert.equal(readDirection('southbound on Paseo Padre'), 'S');
  assert.equal(readDirection('iba hacia el sur'), 'S');
  assert.equal(readDirection("il allait vers l'ouest"), 'W');
  assert.equal(readDirection('往东走了'), 'E');
  assert.equal(readDirection('北へ歩いていた'), 'N');
  assert.equal(readDirection('near East Plaza'), null);
  assert.equal(readDirection('lo vi en este parque'), null);
});

test('reliability: "not sure" beats "sure", "I think" is in the middle', () => {
  assert.equal(readReliability("I'm not sure it was him"), 0.3);
  assert.equal(readReliability('I think it was him'), 0.6);
  assert.equal(readReliability('It was definitely him'), 0.9);
  assert.equal(readReliability('Estoy segura'), 0.9);
  assert.equal(readReliability('Il était sur le pont'), 0.6); // "sur" = "on", not "sûr"
  assert.equal(readReliability('たぶん彼女'), 0.3);           // voiced kana survive accent stripping
});

test('place: the longest matching name wins, street suffix optional', () => {
  assert.equal(readPlace('in Fremont Central Park', places).name, 'Fremont Central Park');
  assert.equal(readPlace('on paseo padre', places).name, 'Paseo Padre Parkway');
  assert.equal(readPlace('somewhere else', places), null);
});

test('every test-set report gives a draft that passes validateDraft, and most fields are right', () => {
  const data = JSON.parse(readFileSync(new URL('../bench/jev-cases.json', import.meta.url), 'utf8'));
  let kindsRight = 0;
  for (const c of data.cases) {
    const raw = readLocally(c.text, { places: data.places });
    assert.deepEqual(validateDraft(raw), raw, c.text); // already clean
    if (raw.kind === c.expect.kind) kindsRight += 1;
  }
  assert.ok(kindsRight / data.cases.length >= 0.85, `kind right for ${kindsRight}/${data.cases.length}`);
});
