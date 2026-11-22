// Tests for the categories of report-reading problems found on bench/blind-dev.json (Nov 22).
// The examples here are NEW sentences written for the tests, not copies of the blind reports, so
// they check that each fix works for the whole category, not for one report.
// Written with Claude Code; Nathan reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocally, readSignals, readAllPlaces, hasWord, readFound, readSecondHand, readKind } from '../quickread.js';
import { safeJevDraft, placeSupported, MINUTE_OPTION } from '../proxy/jev.js';
import { scoreDraft } from '../bench/eval.js';

const PLACES = [
  { name: 'Lake Elizabeth', lat: 37.5503, lng: -121.963 },
  { name: 'Walnut Avenue', lat: 37.5556, lng: -121.9749 },
  { name: 'Kearney Street', lat: 37.5489, lng: -121.9749 },
  { name: 'Liberty Street', lat: 37.5464, lng: -121.9724 },
  { name: 'BART Way', lat: 37.5567, lng: -121.9769 },
];
const pick = (choice, confidence = 0.95) => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } });
const sightingAnswers = (place = 'none') => ({ kind: pick('sighting'), place: pick(place), direction: pick('unknown'), minutes: pick('unknown'), sure: { score: 2, confidence: 0.9 } });

test('found: "we found him" is a message in all 5 languages, for both readers', () => {
  for (const text of ['Good news, we found her, she is safe', 'La encontraron en la tienda, ya apareció', "On l'a retrouvé, il est sain et sauf",
    '已经找到他了，平安无事', '父が見つかりました']) {
    assert.ok(readFound(text), text);
    assert.equal(readLocally(text, { places: PLACES }).kind, 'message', text);
    assert.equal(safeJevDraft(sightingAnswers(), text, PLACES).kind, 'message', `${text} (Jev said sighting)`);
  }
  assert.ok(!readFound('我们找过了，没找到'), '"没找到" (not found) is not "found"');
  assert.ok(!readFound('見つかりませんでした'));
});

test('second-hand and far away are "maybe" (0.3), in both readers', () => {
  for (const text of ['A jogger told me she saw him on Liberty Street', 'Mi tío dice que la vio en Liberty Street', 'Une voisine dit avoir vu un monsieur sur Liberty Street',
    '有人说在Liberty Street看到他', 'Liberty Streetで見たって近所の人が', 'I saw someone by the lake but it was far away']) {
    assert.equal(readLocally(text, { places: PLACES }).reliability, 0.3, text);
    assert.equal(safeJevDraft(sightingAnswers(), text, PLACES).reliability, 0.3, `${text} (Jev said certain)`);
  }
});

test('a question ending in "?" is a message, not "searched"', () => {
  for (const text of ['Did anybody check Kearney Street yet?', '¿Ya revisaron Kearney Street?', 'Quelqu\'un a vérifié Kearney Street ?', 'Kearney Street有人查过吗？']) {
    assert.equal(readLocally(text, { places: PLACES }).kind, 'message', text);
  }
});

test('vehicles: a bus stop is a place; a car report with no "saw" words is a message, never "searched"', () => {
  assert.ok(!readSignals('He is standing at the bus stop on Walnut Avenue right now', PLACES).flags.includes('vehicle'));
  assert.ok(!readSignals('Está en la parada de autobús de Walnut Avenue', PLACES).flags.includes('vehicle'));
  assert.ok(!readSignals('Walnut Avenueのバス停にいます', PLACES).flags.includes('vehicle'));
  const car = readLocally('The car is gone and it is not in the garage', { places: PLACES });
  assert.equal(car.kind, 'message');
  assert.ok(car.flags.includes('vehicle'));
});

test('sightings told without a "saw" verb are sightings (backup reader)', () => {
  for (const text of ['An old woman is sitting on the steps at Liberty Street', 'Una señora está sentada en Liberty Street', 'Une vieille dame est assise sur Liberty Street',
    '有个老太太坐在Liberty Street的长椅上', 'Liberty Streetにおばあさんが座っています']) {
    const d = readLocally(text, { places: PLACES });
    assert.equal(d.kind, 'sighting', text);
    assert.equal(d.placeText, 'Liberty Street', text);
  }
  // But not a guess, someone else, or "can't find him".
  assert.equal(readLocally('I think she is sitting at home', { places: PLACES }).kind, 'message');
  assert.equal(readLocally('An old man is sitting on Walnut Avenue but it is not him', { places: PLACES }).kind, 'message');
});

test('place roles: a destination, a starting point or "the BART station" is not where the person was', () => {
  const where = (text) => readAllPlaces(text, PLACES).map((p) => p.name);
  assert.deepEqual(where('walking down Liberty Street toward Kearney Street'), ['Liberty Street']);
  assert.deepEqual(where('caminaba por Liberty Street hacia Kearney Street'), ['Liberty Street']);
  assert.deepEqual(where('we walked Kearney Street from Walnut Avenue to the end'), ['Kearney Street']);
  assert.deepEqual(where('on Walnut Avenue near the BART station'), ['Walnut Avenue']);
  assert.deepEqual(where('Walnut AvenueのBART駅の近く'), ['Walnut Avenue']);
  assert.deepEqual(where('on Walnut Avenue near Liberty Street'), ['Walnut Avenue'], 'a landmark right after the place');
  assert.deepEqual(where('Seen by Lake Elizabeth. Later someone saw him on Walnut Avenue.').sort(), ['Lake Elizabeth', 'Walnut Avenue'], 'two separate places stay a conflict');
});

test('Latin place names inside Chinese and Japanese text count as whole words', () => {
  assert.ok(hasWord('在lake elizabeth附近', 'lake'));
  assert.ok(hasWord('lake elizabethの近く', 'elizabeth'));
  assert.ok(!hasWord('in a parking place', 'lac'));
  assert.ok(placeSupported('Lake Elizabeth', '十分钟前在Lake Elizabeth附近看到他'));
  const d = safeJevDraft(sightingAnswers('Lake Elizabeth'), '十分钟前在Lake Elizabeth附近看到他', PLACES);
  assert.equal(d.placeText, 'Lake Elizabeth');
});

test('searched reports: the time is how long they searched, from the word rules, never Jev\'s "seen" time', () => {
  const text = 'Searched Kearney Street for 30 minutes, nobody there';
  assert.equal(readLocally(text, { places: PLACES }).minutesSince, 30);
  const jev = { kind: pick('searched'), place: pick('Kearney Street'), direction: pick('unknown'), minutes: pick(MINUTE_OPTION[60]), sure: { score: 1, confidence: 0.9 } };
  assert.equal(safeJevDraft(jev, text, PLACES).minutesSince, 30, 'not Jev\'s "seen an hour ago"');
  assert.equal(safeJevDraft(jev, 'Searched Kearney Street, nobody there', PLACES).minutesSince, null);
});

test('scorer: acceptable answers count as right; buckets; a message\'s fields never count as dangerous', () => {
  const c = { expect: { kind: 'sighting', place: null, direction: 'E', minutes: 20, reliability: 0.6 }, acceptable: { place: ['Walnut Avenue'] }, danger: 'high' };
  const draft = { kind: 'sighting', placeText: 'Walnut Avenue', lat: 1, lng: 1, direction: 'E', minutesSince: 15, reliability: 0.6 };
  const s = scoreDraft(c, draft);
  assert.deepEqual(s.fields, { kind: 'right', place: 'right', direction: 'right', minutes: 'right', reliability: 'right' });
  assert.equal(scoreDraft(c, { ...draft, direction: 'W' }).level, 'high', 'a blind case counts at its own level');
  assert.equal(scoreDraft(c, { ...draft, kind: 'message', direction: 'W' }).level, null, 'a message moves nothing');
  const searched = { expect: { kind: 'searched', place: 'Kearney Street', direction: null, minutes: 40, reliability: null }, danger: 'medium' };
  assert.equal(scoreDraft(searched, { kind: 'searched', placeText: 'Kearney Street', lat: 1, lng: 1, direction: null, minutesSince: 30, reliability: 0.6 }).fields.minutes, 'right', '40 and 30 are both the 30 bucket');
});

// ---- Categories found on blind-test (opened after it was spent, Nov 22) ------------------------

test('panic is not a search: "she\'s gone, she\'s not here" is a message, for both readers', () => {
  const searchedJev = { kind: pick('searched'), place: pick('none'), direction: pick('unknown'), minutes: pick('unknown'), sure: { score: 1, confidence: 0.9 } };
  for (const text of ["HE'S GONE, HE WAS ON THE COUCH AND NOW HE'S NOT HERE", 'Se fue, no está en la casa, ayúdenme', "Elle a disparu, elle n'est pas là", '他不见了，不在家里', 'いなくなった、家にいない']) {
    const d = readLocally(text, { places: PLACES });
    assert.equal(d.kind, 'message', text);
    assert.equal(safeJevDraft(searchedJev, text, PLACES).kind, 'message', `${text} (Jev said searched)`);
  }
  // A real search still counts, with or without a named place.
  assert.equal(readLocally('Searched the whole house and the garage, nothing', { places: PLACES }).kind, 'searched');
  assert.equal(readLocally('No sign of him on Kearney Street', { places: PLACES }).kind, 'searched');
  assert.equal(readLocally('We walked all of Liberty Street, nobody', { places: PLACES }).kind, 'searched');
  assert.equal(readKind('リバティ通りを端から端まで歩いたけど誰もいない'), 'searched');
  assert.notEqual(readKind('一周前に家を出た'), 'searched', 'Chinese/Japanese 一周 (a week / one lap) alone is not a search');
});

test('second-hand includes someone else as the seer, without a "says" word', () => {
  for (const text of ['The bus driver saw her near Liberty Street', 'Someone posted on the group chat that they saw an old man by the lake', 'He was seen on Walnut Avenue',
    'El cartero la vio en Liberty Street', 'Une voisine l\'a vue sur Liberty Street', '快递员在Liberty Street看到她', '近所の人がリバティ通りで見かけた']) {
    assert.ok(readSecondHand(text), text);
    assert.equal(readLocally(text, { places: PLACES }).reliability, 0.3, text);
  }
  for (const text of ['I saw her on Liberty Street', 'La vi en Liberty Street', "Je l'ai vue sur Liberty Street", '我在Liberty Street看到她']) {
    assert.ok(!readSecondHand(text), text);
  }
});

test('"it wasn\'t Dad / Mom / Grandpa" in 5 languages means someone else', () => {
  for (const text of ['Saw an old man by the lake but it was not my dad', 'Vi a una señora en el parque pero no era mi mamá', "J'ai vu un monsieur au parc mais ce n'était pas mon père",
    '在公园看到一个老人，但不是我爸', '公園でおばあさんを見かけたけど、母じゃなかった']) {
    assert.ok(readSignals(text, PLACES).flags.includes('other_person'), text);
    assert.equal(readLocally(text, { places: PLACES }).kind, 'message', text);
  }
});

test('caution: a place or kind is filled only on strong evidence; otherwise empty and marked unsure', () => {
  // A short everyday word alone is weak: left for the person.
  const weak = readLocally('I saw her walking on walnut', { places: PLACES });
  assert.equal(weak.placeText, '');
  assert.ok(weak.unsure.includes('place'));
  // The full name, a long short-name, or a short name next to a street word is strong.
  assert.equal(readLocally('I saw her on Walnut Avenue', { places: PLACES }).placeText, 'Walnut Avenue');
  assert.equal(readLocally('I saw her on Kearney', { places: PLACES }).placeText, 'Kearney Street');
  assert.equal(readLocally('La vi en la calle Walnut', { places: PLACES }).placeText, 'Walnut Avenue');
  // A sighting with no "saw" verb is kept, but the kind is marked unsure.
  const presence = readLocally('An old woman is sitting on the steps at Liberty Street', { places: PLACES });
  assert.equal(presence.kind, 'sighting');
  assert.ok(presence.unsure.includes('kind'));
  assert.ok(!(readLocally('I saw her on Liberty Street', { places: PLACES }).unsure || []).includes('kind'));
});
