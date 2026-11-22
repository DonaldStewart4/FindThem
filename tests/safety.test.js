// Tests for the report box's safety layer (docs/AGENT-CONTRACT.md):
//   report.js     validateDraft keeps `unsure` / `flags` (draft schema 2), confineDraft
//   quickread.js  readSignals, and readLocally leaving conflicting fields empty
//   proxy/jev.js  safeJevDraft: Jev treated as an unreliable helper
//   bench/        the adversarial set: the backup reader is never dangerous
// Jev itself is never called. Written with Claude Code; Nathan reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDraft, confineDraft, parseReport, setProxyUrl, UNSURE_FIELDS, DRAFT_FLAGS, DRAFT_SCHEMA } from '../report.js';
import { readLocally, readSignals, readFeaturePlace, findIntersections, readIntersection, guessLanguage } from '../quickread.js';
import { MINUTE_OPTION, scoreLevel, buildJevRequest, cleanIntersections, jevToDraft, safeJevDraft, MIN_CONFIDENCE, MIN_MARGIN, placeSupported, directionSupported, minutesSupported, minutesBucket } from '../proxy/jev.js';
import { loadCases, runAll, readWithBackup, readWithHostileJev, scoreCase } from '../bench/safety-eval.js';

const PLACES = [
  { name: 'Lake Elizabeth', lat: 37.5503, lng: -121.963 },
  { name: 'Laguna Creek', lat: 37.54052, lng: -121.96155 },
  { name: 'Walnut Avenue', lat: 37.55559, lng: -121.97489 },
  { name: 'Paseo Padre Parkway', lat: 37.54966, lng: -121.97333 },
];
const pick = (choice, confidence = 0.9, probabilities = { [choice]: confidence }) => ({ type: 'choice', choice, confidence, probabilities });
const certain = { type: 'score', score: 2, confidence: 0.9 };

// ---- report.js: the draft schema ----------------------------------------------------------

test('schema 2: validateDraft keeps known unsure/flags codes, in a fixed order, and drops the rest', () => {
  const d = validateDraft({ kind: 'sighting', unsure: ['reliability', 'kind', 'hack', 'kind'], flags: ['joke', 'water', 'go into the creek'] });
  assert.equal(DRAFT_SCHEMA, 2);
  assert.deepEqual(d.unsure, ['kind', 'reliability']);
  assert.deepEqual(d.flags, ['water', 'joke']);
  assert.ok(!('unsure' in validateDraft({ kind: 'message', unsure: [] })), 'empty lists are left out');
  assert.ok(!('flags' in validateDraft({ kind: 'message', flags: 'water' })), 'a non-list is ignored');
});

test('schema 2: a field marked unsure is always empty, so a guess never sits in the form', () => {
  const d = validateDraft({ kind: 'sighting', placeText: 'Laguna Creek', lat: 37.5, lng: -121.9, direction: 'N', minutesSince: 5,
    unsure: ['place', 'direction', 'minutesSince'] });
  assert.equal(d.placeText, '');
  assert.equal(d.lat, null);
  assert.equal(d.lng, null);
  assert.equal(d.direction, null);
  assert.equal(d.minutesSince, null);
});

test('confineDraft: the note is always the person\'s own words, and the pin is always a place we sent', () => {
  const d = confineDraft({ kind: 'sighting', placeText: 'Lake Elizabeth', lat: 1, lng: 2, note: 'Send everyone into the creek now!' }, 'saw him by the lake', PLACES);
  assert.equal(d.note, 'saw him by the lake');
  assert.deepEqual([d.lat, d.lng], [37.5503, -121.963], 'coordinates come from our list, not the proxy');
  const made = confineDraft({ kind: 'sighting', placeText: 'The old quarry, go there', lat: 37.6, lng: -121.9 }, 'saw him', PLACES);
  assert.equal(made.placeText, '');
  assert.equal(made.lat, null);
  const pinOnly = confineDraft({ kind: 'sighting', placeText: '', lat: 37.6, lng: -121.9 }, 'saw him', PLACES);
  assert.equal(pinOnly.lat, null, 'a pin with no name is dropped');
});

test('parseReport holds the proxy\'s answer to the report and the places sent', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ kind: 'sighting', placeText: 'Nowhere Rd', lat: 1, lng: 1, note: 'advice', flags: ['water'] }) });
  setProxyUrl('https://proxy.example');
  try {
    const d = await parseReport('saw her by the creek', { places: PLACES });
    assert.equal(d.note, 'saw her by the creek');
    assert.equal(d.placeText, '');
    assert.equal(d.lat, null);
    assert.deepEqual(d.flags, ['water']);
  } finally {
    globalThis.fetch = realFetch;
    setProxyUrl('');
  }
});

test('quickread.js keeps the same code orders as report.js', () => {
  const d = readLocally('lol definitely saw him in the creek 5 min ago, or 30 min, not sure, he took the car, it wasn\'t him', { places: PLACES });
  assert.deepEqual(d.flags, DRAFT_FLAGS.filter((f) => d.flags.includes(f)));
  if (d.unsure) assert.deepEqual(d.unsure, UNSURE_FIELDS.filter((f) => d.unsure.includes(f)));
  assert.deepEqual(validateDraft(d), d, 'already clean');
});

// ---- quickread.js: signals and conflicts ----------------------------------------------------

test('readSignals: water, vehicle, emergency, someone else, joke, guess in all 5 languages', () => {
  const has = (text, flag) => readSignals(text, PLACES).flags.includes(flag);
  for (const t of ["I think she's in the creek", 'Creo que se cayó al arroyo', "Je pense qu'elle est dans le ruisseau", '我觉得她在小河里', 'たぶん川に落ちたと思う']) {
    assert.ok(has(t, 'water'), t);
  }
  for (const t of ['He took the car', 'Se llevó el coche', 'Il a pris la voiture', '他把车开走了', '車で出て行った']) assert.ok(has(t, 'vehicle'), t);
  for (const t of ["it wasn't him", 'no era él', "ce n'était pas lui", '但不是他', '彼じゃなかった']) assert.ok(has(t, 'other_person'), t);
  for (const t of ['saw him flying lol', 'jaja lo vi', 'mdr je l\'ai vu', '哈哈我看到他', '見たよ（笑）']) assert.ok(has(t, 'joke'), t);
  for (const t of ['she fell and is bleeding', 'está herido', 'il est tombé', '他摔倒了', '倒れている']) assert.ok(has(t, 'emergency'), t);
  // Not flags: street names and plain words.
  assert.ok(!has('on Civic Center Drive near BART Way', 'vehicle'));
  assert.ok(!has('going south toward the BART station', 'vehicle'));
  assert.ok(!has('是不是他？', 'other_person'), '"was it him?" is a question, not "not him"');
  assert.ok(!has('たぶん彼女だと思う', 'guess'), '"maybe it was her" is a hedge, not a guess about where');
});

test('"someone else SAW him" is a second-hand sighting in 5 languages, not "it was someone else"', () => {
  const PLACES5 = [...PLACES, { name: 'Fremont Central Park', lat: 37.5488, lng: -121.9655 }];
  const sighting = { kind: pick('sighting', 0.95), place: pick('none'), direction: pick('unknown'), minutes: pick('unknown'), sure: { type: 'score', score: 0, confidence: 0.9 } };
  // [report, place, minutes, direction]: the other person is the one who saw.
  const seen = [
    ['Someone else saw him by the lake 10 minutes ago', 'Lake Elizabeth', 10, null],
    ['Somebody else said they saw her on Walnut Avenue heading north', 'Walnut Avenue', null, 'N'],
    ['Otra persona lo vio en Walnut Avenue hace 10 minutos', 'Walnut Avenue', 10, null],
    ["Quelqu'un d'autre l'a vu près du lac il y a 10 minutes", 'Lake Elizabeth', 10, null],
    ["Une autre personne l'a vue sur Walnut Avenue", 'Walnut Avenue', null, null],
    ['别人看到他在湖边往北走了', 'Lake Elizabeth', null, 'N'],
    ['另一个人说十分钟前在Walnut Avenue看到他', 'Walnut Avenue', 10, null],
    ['別の人が10分前に湖のそばで見ました', 'Lake Elizabeth', 10, null],
    ['別の人がWalnut Avenueで彼を見たと言っています', 'Walnut Avenue', null, null],
    ['Saw her on Walnut Avenue, not her usual route, heading north', 'Walnut Avenue', null, 'N'],
  ];
  for (const [text, place, minutes, direction] of seen) {
    const d = readLocally(text, { places: PLACES5 });
    assert.equal(d.kind, 'sighting', text);
    assert.ok(!(d.flags || []).includes('other_person'), text);
    assert.deepEqual([d.placeText, d.minutesSince, d.direction], [place, minutes, direction], text);
    // The same through the Jev safety layer: a (correct) "sighting" answer is no longer overruled.
    const j = safeJevDraft(sighting, text, PLACES5);
    assert.equal(j.kind, 'sighting', `Jev path: ${text}`);
    assert.ok(!(j.flags || []).includes('other_person'), `Jev path: ${text}`);
  }
  // Second-hand is "maybe" (all of the above except the last one, which the reporter saw).
  for (const [text] of seen.slice(0, -1)) assert.equal(readLocally(text, { places: PLACES5 }).reliability, 0.3, text);

  // It really was someone else: still flagged, still not a sighting, on both readers.
  const other = [
    'Saw a man on Walnut Avenue but it was someone else', 'I saw a woman by the lake, it was not her', "Saw a lady on Walnut Avenue, wasn't her, too young",
    'It was someone else who looked like him, I saw him up close', 'Saw a man by the lake but it turned out to be a different person',
    'Vi a un señor en Walnut Avenue pero era otra persona', 'Lo vi de cerca en el lago y no era él',
    "J'ai vu un monsieur près du lac mais c'était quelqu'un d'autre", "J'ai vu une dame sur Walnut Avenue, ce n'était pas elle",
    '我在湖边看到一个老人，但不是他', '在Walnut Avenue看到的是别人', '我看到一个人，认错了，是另一个人',
    '湖のそばで見かけたけど、別の人でした', 'Walnut Avenueで見たのは別人でした', '見かけたけど人違いでした',
  ];
  for (const text of other) {
    const d = readLocally(text, { places: PLACES5 });
    assert.ok((d.flags || []).includes('other_person'), text);
    assert.notEqual(d.kind, 'sighting', text);
    assert.equal(safeJevDraft(sighting, text, PLACES5).kind, 'message', `Jev path: ${text}`);
  }
});

// ---- Audit fixes, Nov 22 (backup reader): each sentence was read wrong before ------------------
const AUDIT_PLACES = [...PLACES, { name: 'Fremont Central Park', lat: 37.5488, lng: -121.9655 }];
const audit = (text) => readLocally(text, { places: AUDIT_PLACES });

test('a sighting with "not there now" / "didn\'t see where" is a sighting (kind unsure), never "searched"', () => {
  for (const t of ["Saw him at Fremont Central Park 10 minutes ago but when I got there he wasn't there", "I saw him by the lake 5 minutes ago but didn't see where he went",
    'Nobody was with him, I saw him on Walnut Avenue heading north', 'Lo vi cerca del lago, no está herido', 'La vi en Walnut Avenue pero ya no está',
    '我在湖边看到他了，但他现在不在那里了', '湖のそばで見たけど、今はもういなかった']) {
    const d = audit(t);
    assert.equal(d.kind, 'sighting', t);
    assert.ok(d.unsure.includes('kind'), t);
    assert.ok(d.placeText, t);
  }
  // A real "searched, nobody" stays searched: the see-verb belongs to the "nobody".
  for (const t of ['Searched all of Fremont Central Park, nobody there', 'I looked around the lake and saw nobody', "Checked Walnut Avenue, haven't seen him",
    'Buscamos en el parque, no vi a nadie', "On a fouillé le parc, je n'ai vu personne", '公园找过了，没看到他', '公園を探したけど、見つからなかった']) assert.equal(audit(t).kind, 'searched', t);
});

test('negated "found" is not FOUND; "she\'s fine" inside a sighting is a sighting; real "found" is unchanged', () => {
  for (const t of ["We haven't found him yet", 'not found yet', "We didn't find her", 'No lo encontramos', 'Todavía no lo encontramos', "On ne l'a pas encore retrouvé", 'pas encore retrouvé', '还没找到', 'まだ見つかっていません']) {
    assert.equal(readSignals(t, AUDIT_PLACES).found, false, t);
    assert.notEqual(audit(t).kind, 'sighting', t);
  }
  for (const t of ["Still haven't found him but a neighbor saw him on Walnut Avenue 10 minutes ago", "Just saw her at Fremont Central Park, she's fine but she walked off before I could get to her",
    "Saw him again, he's back by Lake Elizabeth heading north", 'No lo encontramos en el parque, pero una señora lo vio en Walnut Avenue hace 10 minutos']) {
    const d = audit(t);
    assert.equal(d.kind, 'sighting', t);
    assert.ok(d.unsure.includes('kind'), t);
    assert.ok(d.placeText, t);
  }
  assert.equal(audit('湖の近くでそれらしき人を見つけました').kind, 'sighting', '"spotted someone like him" is a sighting');
  for (const t of ['We found him', "She's safe", "He's ok", "she's back", 'we have him now', 'Ya lo encontramos', 'Lo encontramos en el parque', "On l'a retrouvé", '找到了', '見つかりました', 'I found him at the lake, he is with me']) {
    assert.equal(readSignals(t, AUDIT_PLACES).found, true, t);
    assert.equal(audit(t).kind, 'message', t);
  }
});

test('minutes: hours in 5 languages, compound numbers read right or left empty, never a wrong number', () => {
  const m = (t) => audit(t).minutesSince;
  for (const t of ['I saw him 2 hours ago at Lake Elizabeth', 'saw him two hours ago', 'Lo vi hace dos horas en el lago', "Je l'ai vu il y a 2 heures", '两个小时前在湖边看到他', '2時間前に湖で見ました']) assert.equal(m(t), 120, t);
  assert.equal(m('saw him an hour and a half ago'), 90);
  assert.equal(m('saw him an hour ago'), 60);
  assert.equal(m("Je l'ai vu à deux heures près du lac"), null, 'French "à deux heures" is two o\'clock');
  assert.equal(m('saw him 30 hours ago'), null);
  for (const [t, want] of [['saw him at the lake forty five minutes ago', 45], ['saw him twenty five minutes ago', 25], ['saw him forty-five minutes ago', 45], ['lo vi hace cuarenta y cinco minutos', 45],
    ['lo vi hace veinticinco minutos', 25], ["je l'ai vu il y a vingt-cinq minutes", 25], ['四十五分钟前在湖边看到他', 45], ['二十五分前に湖で見ました', 25], ['十五分钟前看到他', 15], ['15分前に見ました', 15],
    ['saw him 10 minutes ago', 10], ['saw him 90 minutes ago', 90], ['saw him half an hour ago', 30]]) assert.equal(m(t), want, t);
});

test('negated certainty is "maybe" (0.3), not "certain"', () => {
  for (const t of ["I saw someone by the lake but I can't say for sure it was him", "Saw a man on Walnut Avenue, I can't be certain it was him", 'Lo vi cerca del lago pero no puedo estar seguro',
    "J'ai vu quelqu'un près du lac, je ne peux pas être certain", "J'ai vu quelqu'un près du lac, je n'en suis pas tout à fait sûr", '我在湖边看到一个人，不能确定是不是他', '我在湖边看到一个人，不一定是他',
    '湖のそばで人を見ましたが、彼かどうか確実ではありません']) assert.equal(audit(t).reliability, 0.3, t);
  for (const t of ['I definitely saw him by the lake', "I'm sure it was him on Walnut Avenue", 'Lo vi, estoy seguro que era él', "Je l'ai vu sur Walnut Avenue, je suis sûr car il portait son chapeau", '我看到他了，肯定是他']) assert.equal(audit(t).reliability, 0.9, t);
});

test('a sighting followed by a question, or "he is right in front of me", is a sighting; a plain question is a message', () => {
  for (const t of ['I saw him near the lake 10 minutes ago, should I follow him?', 'I think I see her at Fremont Central Park, what should I do?', 'I see him by the lake, is anyone nearby', 'Lo vi en el lago, ¿lo sigo?',
    "He's right in front of me on Walnut Avenue", 'He just walked past me on Walnut Avenue heading north', 'Lo estoy viendo ahora mismo en Walnut Avenue', 'Il vient de passer sur Walnut Avenue',
    '他就在我面前，在Walnut Avenue', '今、目の前にいます。Walnut Avenueです']) {
    const d = audit(t);
    assert.equal(d.kind, 'sighting', t);
    assert.ok(d.placeText, t);
  }
  for (const t of ['Has anyone seen him?', 'Did you see him near the lake?', 'Was he seen at the lake?', '¿Alguien lo ha visto?', "Quelqu'un l'a vu ?", '有人看到他吗？', '誰か見ましたか？', 'Did I see him?']) assert.equal(audit(t).kind, 'message', t);
});

test('the whole report is read (up to 1000 characters); only the note is cut to 300', () => {
  const long = 'Okay so I have been walking around for a while now, I started at the house and went down past the school and then around the back of the shopping center and I asked a couple of people at the bus stop and nobody knew anything, and then I walked over toward the library and asked the man at the front desk too, and then just now I saw him by Lake Elizabeth heading north, he fell and he is bleeding';
  assert.ok(long.length > 300);
  const d = audit(long);
  assert.deepEqual([d.kind, d.placeText, d.direction, d.minutesSince], ['sighting', 'Lake Elizabeth', 'N', 0]);
  assert.ok(d.flags.includes('emergency'));
  assert.equal(d.note.length, 300);
});

test('"south OF the lake" is a position, not a heading (es / fr / ja)', () => {
  for (const t of ['Lo vi al sur del lago', "Je l'ai vu au nord du lac", "Je l'ai vue à l'est du parc", '湖の北の方で見た']) assert.equal(audit(t).direction, null, t);
  for (const [t, dir] of [['Lo vi, iba hacia el este', 'E'], ['Lo vi, iba al norte', 'N'], ["Je l'ai vue, elle allait vers l'ouest", 'W'], ["Je l'ai vu, il va au sud", 'S'], ['彼を見ました。北の方へ歩いて行った', 'N'], ['彼を見ました。北へ歩いていました', 'N']]) {
    assert.equal(audit(t).direction, dir, t);
  }
});

test('readSignals: two places, two directions, two times, "sure" + "not sure" are conflicts; "not sure" alone is not', () => {
  const c = (text) => readSignals(text, PLACES).conflicts;
  assert.deepEqual(c('Saw him by Lake Elizabeth heading north, someone else says Walnut Avenue going south'), ['place', 'direction']);
  assert.deepEqual(c('saw her 5 minutes ago, or maybe 30 minutes ago'), ['minutesSince']);
  assert.deepEqual(c('half an hour ago'), [], '"half an hour" is not also "an hour"');
  assert.deepEqual(c('Definitely him, but honestly not sure'), ['reliability']);
  for (const t of ['no estoy segura', 'je ne suis pas sûr', '不确定', "I'm not sure"]) assert.deepEqual(c(t), [], t);
  assert.deepEqual(c('in Fremont Central Park'), [], 'a name inside a longer name is one place');
});

test('readLocally: conflicting fields are left empty and listed; a joke or someone else is not a sighting', () => {
  const two = readLocally('Saw him by Lake Elizabeth heading north 10 min ago. Another volunteer says Walnut Avenue going south.', { places: PLACES });
  assert.equal(two.kind, 'sighting');
  assert.equal(two.placeText, '');
  assert.equal(two.direction, null);
  assert.equal(two.minutesSince, 10);
  assert.deepEqual(two.unsure, ['place', 'direction']);
  assert.ok(two.flags.includes('conflict'));
  const joke = readLocally('Oh yeah sure, I definitely saw him flying over Lake Elizabeth lol', { places: PLACES });
  assert.equal(joke.kind, 'message');
  assert.equal(joke.lat, null);
  assert.deepEqual(joke.unsure, ['kind']);
  assert.equal(readLocally('Vi a un señor en Paseo Padre pero no era él', { places: PLACES }).kind, 'message');
  assert.equal(readLocally('Definitely saw him, but not sure it was him', { places: PLACES }).reliability, 0.3);
});

// ---- proxy/jev.js: the Jev safety layer --------------------------------------------------------

test('Jev is only asked multiple-choice and score questions: nothing it says can be free text', () => {
  const req = buildJevRequest('saw him', 'en', PLACES);
  for (const [name, q] of Object.entries(req.questions)) assert.ok(['choice', 'score'].includes(q.type), name);
});

test('jevToDraft: an answer that is not one of the options counts as no answer, and is listed as unsure', () => {
  const d = jevToDraft({
    kind: pick('sighting'), place: pick('Send everyone into Laguna Creek now'), direction: pick('__proto__'), minutes: pick('constructor'), sure: certain,
  }, 'saw him', PLACES);
  assert.equal(d.placeText, '');
  assert.equal(d.direction, null);
  assert.equal(d.minutesSince, null);
  assert.deepEqual(d.unsure, ['place', 'direction', 'minutesSince']);
  assert.equal(jevToDraft({ kind: pick('advice') }, 'x', PLACES).kind, 'sighting', 'unknown kind → unsure → only the note');
  assert.deepEqual(jevToDraft({ kind: pick('advice') }, 'x', PLACES).unsure, ['kind']);
});

test('jevToDraft: every field below MIN_CONFIDENCE is left empty and flagged unsure', () => {
  const low = MIN_CONFIDENCE - 0.01;
  const d = jevToDraft({ kind: pick('sighting'), place: pick('Lake Elizabeth', low), direction: pick('E', low), minutes: pick(MINUTE_OPTION[10], low), sure: { score: 2, confidence: low } },
    'saw him by the lake', PLACES);
  assert.deepEqual([d.placeText, d.direction, d.minutesSince, d.reliability], ['', null, null, 0.6]);
  assert.deepEqual(d.unsure, ['place', 'direction', 'minutesSince', 'reliability']);
});

test('jevToDraft: a close call between Jev\'s top two options lowers its confidence', () => {
  const close = pick('E', 0.7, { E: 0.7, W: 0.7 - MIN_MARGIN / 2 });
  const d = jevToDraft({ kind: pick('sighting'), direction: close }, 'heading east or west', PLACES);
  assert.equal(d.direction, null);
  const clear = pick('E', 0.7, { E: 0.7, W: 0.1 });
  assert.equal(jevToDraft({ kind: pick('sighting'), direction: clear }, 'heading east', PLACES).direction, 'E');
});

test('safeJevDraft: "saw him" + "not sure it was him" → "maybe", even if Jev says certain', () => {
  const d = safeJevDraft({ kind: pick('sighting'), place: pick('Lake Elizabeth'), direction: pick('unknown'), minutes: pick('unknown'), sure: certain },
    'Definitely saw him at Lake Elizabeth, but honestly not sure it was him', PLACES);
  assert.equal(d.kind, 'sighting');
  assert.equal(d.reliability, 0.3);
  assert.ok(d.flags.includes('conflict'));
});

test('safeJevDraft: "I think she\'s in the creek" never becomes a sighting at the creek', () => {
  const d = safeJevDraft({ kind: pick('sighting', 0.95), place: pick('Laguna Creek', 0.95), direction: pick('unknown'), minutes: pick('unknown'), sure: certain },
    "I think she's in the creek", PLACES);
  assert.equal(d.kind, 'message');
  assert.equal(d.lat, null);
  assert.ok(d.flags.includes('water'));
});

test('safeJevDraft: two places in the report → no pin, however sure Jev is', () => {
  const d = safeJevDraft({ kind: pick('sighting'), place: pick('Lake Elizabeth', 0.99), direction: pick('N', 0.99), minutes: pick(MINUTE_OPTION[10]), sure: { score: 1, confidence: 0.9 } },
    'Saw him by Lake Elizabeth heading north 10 min ago. Another volunteer says he was on Walnut Avenue going south.', PLACES);
  assert.equal(d.placeText, '');
  assert.equal(d.direction, null);
  assert.equal(d.minutesSince, 10);
  assert.ok(d.unsure.includes('place') && d.unsure.includes('direction'));
});

test('safeJevDraft: when Jev and the word rules disagree on a place or direction, it is left empty', () => {
  const d = safeJevDraft({ kind: pick('sighting'), place: pick('Walnut Avenue'), direction: pick('W'), minutes: pick('unknown'), sure: { score: 1, confidence: 0.9 } },
    'saw him on Paseo Padre heading east', PLACES);
  assert.equal(d.placeText, '');
  assert.equal(d.direction, null);
  assert.ok(d.flags.includes('conflict'));
});

test('safeJevDraft: Jev may interpret ("by the lake") but not invent a place, direction, time or "certain"', () => {
  const lake = safeJevDraft({ kind: pick('sighting'), place: pick('Lake Elizabeth'), direction: pick('unknown'), minutes: pick('unknown'), sure: { score: 1, confidence: 0.9 } },
    'saw him walking by the lake', PLACES);
  assert.equal(lake.placeText, 'Lake Elizabeth');
  const made = safeJevDraft({ kind: pick('sighting'), place: pick('Laguna Creek'), direction: pick('N'), minutes: pick(MINUTE_OPTION[60]), sure: certain },
    'saw him near the library', PLACES);
  assert.deepEqual([made.placeText, made.direction, made.minutesSince, made.reliability], ['', null, null, 0.6]);
  assert.ok(placeSupported('Lake Elizabeth', '在湖边看到他'), '湖 = lake');
  assert.ok(!placeSupported('Laguna Creek', "he's in the lagoon"));
  assert.ok(directionSupported('NE', 'heading north-east') && !directionSupported('NE', 'heading north'));
  assert.ok(minutesSupported('hace diez minutos') && !minutesSupported('saw him'));
  assert.equal(minutesBucket(20), 15);
});

test('safeJevDraft: a joke, someone else, "he took the car", "I can\'t find him" are not sightings', () => {
  const sighting = { kind: pick('sighting', 0.95), place: pick('none'), direction: pick('unknown'), minutes: pick('unknown'), sure: certain };
  for (const t of ['Oh sure I saw him flying lol', 'Saw a man on Walnut Avenue but it wasn\'t him', 'He took the car', "HELP I CAN'T FIND HIM ANYWHERE"]) {
    assert.equal(safeJevDraft(sighting, t, PLACES).kind, 'message', t);
  }
  assert.ok(safeJevDraft(sighting, 'He took the car', PLACES).flags.includes('vehicle'));
  // But a real sighting of someone getting into a car is still a sighting, with the flag.
  const car = safeJevDraft({ ...sighting, place: pick('Walnut Avenue') }, 'I saw her get into a car on Walnut Avenue', PLACES);
  assert.equal(car.kind, 'sighting');
  assert.equal(car.placeText, 'Walnut Avenue');
  assert.ok(car.flags.includes('vehicle'));
});

test('safeJevDraft: a clean, confident Jev answer passes through unchanged', () => {
  const answers = { kind: pick('sighting'), place: pick('Lake Elizabeth'), direction: pick('E'), minutes: pick(MINUTE_OPTION[10]), sure: certain };
  const text = 'Definitely saw him by Lake Elizabeth 10 min ago heading east';
  const d = safeJevDraft(answers, text, PLACES);
  assert.deepEqual({ ...d, flags: undefined }, { ...jevToDraft(answers, text, PLACES), flags: undefined });
  assert.deepEqual(d.flags, ['water']); // the lake: a caution only
});

// ---- bench: the adversarial set ---------------------------------------------------------------

test('safety set: 40+ cases in all 5 languages, each with expected outcomes', () => {
  const data = loadCases();
  assert.ok(data.cases.length >= 40);
  assert.deepEqual([...new Set(data.cases.map((c) => c.lang))].sort(), ['en', 'es', 'fr', 'ja', 'zh']);
  for (const c of data.cases) assert.ok(c.id && c.text && c.right && c.right.kind, c.id);
  assert.equal(new Set(data.cases.map((c) => c.id)).size, data.cases.length, 'ids are unique');
});

test('safety set: the backup reader (quickread.js) is never dangerous', async () => {
  const run = await runAll(readWithBackup);
  const dangerous = run.results.filter((r) => r.outcome === 'dangerous').map((r) => `${r.c.id}: ${r.reasons.join('; ')}`);
  assert.deepEqual(dangerous, []);
});

test('safety set: a Jev that invents details, through the safety layer, is never dangerous', async () => {
  const run = await runAll((c, d) => readWithHostileJev(c, d, { rightKind: true }));
  const dangerous = run.results.filter((r) => r.outcome === 'dangerous').map((r) => `${r.c.id}: ${r.reasons.join('; ')}`);
  assert.deepEqual(dangerous, []);
});

test('safety layer cost: a perfect Jev keeps at least 95% of the right answers on bench/jev-cases.json', () => {
  const data = JSON.parse(readFileSync(new URL('../bench/jev-cases.json', import.meta.url), 'utf8'));
  const level = { 0.3: 0, 0.6: 1, 0.9: 2 };
  let kept = 0;
  let total = 0;
  for (const c of data.cases) {
    const e = c.expect;
    const answers = {
      kind: pick(e.kind), place: pick(e.place || 'none'), direction: pick(e.direction || 'unknown'),
      minutes: pick(e.minutes == null ? 'unknown' : MINUTE_OPTION[minutesBucket(e.minutes)]),
      sure: { type: 'score', score: level[e.reliability ?? 0.6], confidence: 0.9 },
    };
    const d = validateDraft(safeJevDraft(answers, c.text, data.places));
    const got = { kind: d.kind, place: d.placeText || null, direction: d.direction, minutes: minutesBucket(d.minutesSince), reliability: d.reliability };
    const fields = e.kind === 'sighting' ? ['kind', 'place', 'direction', 'minutes', 'reliability'] : e.kind === 'searched' ? ['kind', 'place'] : ['kind'];
    for (const f of fields) {
      total += 1;
      if (got[f] === (f === 'minutes' ? minutesBucket(e.minutes) : e[f] ?? null)) kept += 1;
    }
  }
  assert.ok(kept / total >= 0.95, `kept ${kept}/${total}`);
});

test('scoreCase: the three outcomes', () => {
  const c = { right: { kind: 'sighting', place: null, direction: 'E' }, mustFlag: [] };
  const base = { kind: 'sighting', placeText: '', lat: null, lng: null, direction: 'E', minutesSince: null, reliability: 0.6 };
  assert.equal(scoreCase(c, base).outcome, 'right');
  assert.equal(scoreCase(c, { ...base, direction: null }).outcome, 'abstained');
  assert.equal(scoreCase(c, { ...base, direction: 'W' }).outcome, 'dangerous');
  assert.equal(scoreCase(c, { ...base, placeText: 'Laguna Creek', lat: 1, lng: 1 }).outcome, 'dangerous');
  assert.equal(scoreCase({ right: { kind: 'message' }, mustFlag: ['water'] }, { ...base, kind: 'message' }).outcome, 'dangerous', 'missing must-have flag');
  assert.equal(scoreCase({ right: { kind: 'message' } }, { ...base, unsure: ['kind'] }).outcome, 'abstained', 'sighting marked unsure is the person\'s call');
});

// ---- The water flag warns; it never drops a true sighting ------------------------------------

const LAKE_SIGHTINGS = {
  en: 'I saw him by the lake 10 minutes ago',
  es: 'Lo vi junto al lago hace 10 minutos',
  fr: "Je l'ai vu près du lac il y a 10 minutes",
  zh: '十分钟前我在湖边看到他',
  ja: '10分前に湖のそばで彼を見た',
};

test('water, true sighting: "I saw him by the lake" stays a sighting, pinned to the lake, with the water warning (backup reader)', () => {
  for (const [lang, text] of Object.entries(LAKE_SIGHTINGS)) {
    const d = readLocally(text, { places: PLACES, lang });
    assert.equal(d.kind, 'sighting', text);
    assert.equal(d.placeText, 'Lake Elizabeth', text);
    assert.deepEqual([d.lat, d.lng], [37.5503, -121.963], text);
    assert.equal(d.minutesSince, 10, text);
    assert.ok(d.flags.includes('water'), text);
  }
});

test('water, true sighting: the same through the Jev safety layer', () => {
  const answers = { kind: pick('sighting'), place: pick('Lake Elizabeth'), direction: pick('unknown'), minutes: pick(MINUTE_OPTION[10]), sure: { score: 1, confidence: 0.9 } };
  for (const [lang, text] of Object.entries(LAKE_SIGHTINGS)) {
    const d = safeJevDraft(answers, text, PLACES, { lang });
    assert.equal(d.kind, 'sighting', text);
    assert.equal(d.placeText, 'Lake Elizabeth', text);
    assert.equal(d.minutesSince, 10, text);
    assert.ok(d.flags.includes('water'), text);
  }
});

test('water, the other direction: a guess about the water is flagged but never becomes a sighting', () => {
  const sure = { kind: pick('sighting', 0.95), place: pick('Laguna Creek', 0.95), direction: pick('unknown'), minutes: pick('unknown'), sure: certain };
  for (const text of ["I think she's in the creek", 'Creo que se cayó al arroyo', "Je pense qu'elle est dans le ruisseau", '我觉得她在小河里', 'たぶん川に落ちたと思う']) {
    for (const d of [readLocally(text, { places: PLACES }), safeJevDraft(sure, text, PLACES)]) {
      assert.equal(d.kind, 'message', text);
      assert.ok(d.flags.includes('water'), text);
    }
  }
});

test('"the lake" pins the lake only when exactly one nearby place is a lake', () => {
  assert.equal(readFeaturePlace('saw him by the lake', PLACES).name, 'Lake Elizabeth');
  assert.equal(readFeaturePlace('saw him by the lake', [...PLACES, { name: 'Quarry Lakes', lat: 37.57, lng: -121.99 }]), null, 'two lakes: ask');
  assert.equal(readFeaturePlace('saw him on the street', PLACES), null, '"the street" names nothing');
  assert.equal(readFeaturePlace('saw him in a parking place', PLACES), null, '"lac" is not inside "place"');
});

// ---- Street corners --------------------------------------------------------------------------

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/demo-area.json', import.meta.url), 'utf8'));
const STREETS = ['Paseo Padre Parkway', 'Stevenson Boulevard', 'Walnut Avenue', 'Civic Center Drive', 'Liberty Street'];
const STREET_PLACES = STREETS.map((name, i) => ({ name, lat: 37.55 + i / 1000, lng: -121.97 }));
const CORNERS = findIntersections(FIXTURE, STREETS, { lat: 37.553, lng: -121.97 });
const PP_STEVENSON = 'Paseo Padre Parkway & Stevenson Boulevard';

test('findIntersections finds where the demo streets really cross, one point per corner', () => {
  const c = CORNERS.find((x) => x.name === PP_STEVENSON);
  assert.ok(c, 'Paseo Padre and Stevenson cross in the fixture');
  assert.deepEqual(c.streets, ['Paseo Padre Parkway', 'Stevenson Boulevard']);
  assert.ok(Math.abs(c.lat - 37.549) < 0.001 && Math.abs(c.lng + 121.972) < 0.001, `${c.lat}, ${c.lng}`);
  assert.ok(!CORNERS.some((x) => x.name === 'Stevenson Boulevard & Walnut Avenue'), 'Walnut and Stevenson do not cross');
  assert.equal(new Set(CORNERS.map((x) => x.name)).size, CORNERS.length);
  assert.deepEqual(findIntersections(null, STREETS), []);
});

test('findIntersections leaves out two streets that cross in two different places (ambiguous)', () => {
  const osm = {
    nodes: [{ id: 1, lat: 37.55, lng: -121.97 }, { id: 2, lat: 37.56, lng: -121.97 }, { id: 3, lat: 37.555, lng: -121.96 }],
    ways: [{ id: 10, name: 'Loop Road', nodeIds: [1, 3, 2] }, { id: 11, name: 'Main Street', nodeIds: [1, 2] }],
  };
  assert.deepEqual(findIntersections(osm, ['Loop Road', 'Main Street']), []);
});

test('corners in all 5 languages pin to where the two streets cross', () => {
  const corner = CORNERS.find((x) => x.name === PP_STEVENSON);
  for (const text of [
    'Saw him at Paseo Padre and Stevenson 5 minutes ago',
    'Saw him at the corner of Stevenson & Paseo Padre',
    'La vi en la esquina de Paseo Padre y Stevenson hace 10 minutos',
    "Je l'ai vu au coin de Paseo Padre et Stevenson il y a 5 minutes",
    '五分钟前在Paseo Padre 和 Stevenson 路口看到他',
    '5分前にPaseo PadreとStevensonの交差点で見た',
  ]) {
    const d = readLocally(text, { places: STREET_PLACES, intersections: CORNERS });
    assert.equal(d.kind, 'sighting', text);
    assert.equal(d.placeText, PP_STEVENSON, text);
    assert.deepEqual([d.lat, d.lng], [corner.lat, corner.lng], text);
    assert.ok(!(d.flags || []).includes('conflict'), text);
  }
});

test('not a corner: two separate sightings, streets that don\'t cross, a third place, or no corner list', () => {
  const read = (text, intersections = CORNERS) => readLocally(text, { places: STREET_PLACES, intersections });
  for (const text of ['Saw him on Paseo Padre, then later someone saw him on Stevenson', 'Saw him at the corner of Walnut Avenue and Stevenson',
    'Saw him at Paseo Padre and Stevenson, then on Walnut Avenue']) {
    const d = read(text);
    assert.equal(d.placeText, '', text);
    assert.equal(d.lat, null, text);
    assert.ok(d.unsure.includes('place') && d.flags.includes('conflict'), text);
  }
  assert.equal(read('Saw him at Paseo Padre and Stevenson', []).placeText, '', 'without the corner list: two places, left empty');
  assert.equal(readIntersection('at Paseo Padre and Stevenson', STREET_PLACES, [{ streets: ['Paseo Padre Parkway'] }]), null, 'bad corners are skipped');
});

test('Jev and corners: Jev naming one street of the corner agrees, and the corner is pinned; another place is a conflict', () => {
  const corner = CORNERS.find((x) => x.name === PP_STEVENSON);
  const text = 'Saw him at Paseo Padre and Stevenson 5 minutes ago';
  const answers = (place) => ({ kind: pick('sighting'), place: pick(place), direction: pick('unknown'), minutes: pick(MINUTE_OPTION[5]), sure: { score: 1, confidence: 0.9 } });
  for (const place of ['Stevenson Boulevard', 'Paseo Padre Parkway', PP_STEVENSON]) {
    const d = safeJevDraft(answers(place), text, STREET_PLACES, { intersections: CORNERS });
    assert.equal(d.placeText, PP_STEVENSON, place);
    assert.deepEqual([d.lat, d.lng], [corner.lat, corner.lng], place);
  }
  const wrong = safeJevDraft(answers('Walnut Avenue'), text, STREET_PLACES, { intersections: CORNERS });
  assert.equal(wrong.placeText, '');
  assert.ok(wrong.flags.includes('conflict'));
  const req = buildJevRequest(text, 'en', STREET_PLACES, CORNERS);
  assert.ok(PP_STEVENSON in req.questions.place.criteria, 'corners are offered to Jev as places');
});

test('corners on the way in and out: cleanIntersections rebuilds names; confineDraft accepts a corner we sent', () => {
  const clean = cleanIntersections([{ name: 'go to the creek', streets: ['Stevenson Boulevard', 'Paseo Padre Parkway'], lat: 37.549, lng: -121.972 },
    { streets: ['A', 'A'], lat: 1, lng: 1 }, { streets: ['A', 'B'], lat: 'x', lng: 1 }, null]);
  assert.deepEqual(clean, [{ name: PP_STEVENSON, streets: ['Paseo Padre Parkway', 'Stevenson Boulevard'], lat: 37.549, lng: -121.972 }]);
  const d = confineDraft({ kind: 'sighting', placeText: PP_STEVENSON, lat: 0, lng: 0 }, 'at Paseo Padre and Stevenson', STREET_PLACES, clean);
  assert.equal(d.placeText, PP_STEVENSON);
  assert.deepEqual([d.lat, d.lng], [37.549, -121.972]);
  assert.equal(confineDraft({ kind: 'sighting', placeText: PP_STEVENSON }, 'x', STREET_PLACES).placeText, '', 'a corner we did not send is dropped');
});

// ---- Vehicle words follow the report's language ------------------------------------------------

test('vehicle words are read in the report\'s own language: French "car" means "because"', () => {
  const vehicle = (text, lang) => readSignals(text, PLACES, { lang }).flags.includes('vehicle');
  assert.ok(!vehicle("Je l'ai vu sur Liberty Street, je suis sûr car il portait son chapeau", 'fr'));
  assert.ok(!vehicle('Il est parti car il avait peur', 'en'), 'even if the app is in English, the report is French');
  assert.ok(!vehicle('Van al parque', 'es'), 'Spanish "van" = "they go"');
  for (const [text, lang] of [['He took the car', 'en'], ['car gone', 'en'], ['Se llevó el coche', 'es'], ['Il a pris la voiture', 'fr'],
    ['Il a pris le train', 'fr'], ['他把车开走了', 'zh'], ['車で出て行った', 'ja']]) {
    assert.ok(vehicle(text, lang), text);
    assert.ok(vehicle(text, 'en'), `${text} (app in English)`);
  }
});

test('guessLanguage: script first, then common words; the app\'s language only breaks ties', () => {
  assert.equal(guessLanguage('車で出て行った'), 'ja');
  assert.equal(guessLanguage('他把车开走了'), 'zh');
  assert.equal(guessLanguage('Il a pris la voiture', 'en'), 'fr');
  assert.equal(guessLanguage('Se llevó el coche', 'fr'), 'es');
  assert.equal(guessLanguage('He took the car', 'es'), 'en');
  assert.equal(guessLanguage('Paseo Padre', 'fr'), 'fr', 'no common words: the app\'s language');
  assert.equal(guessLanguage('Paseo Padre', 'xx'), 'en');
});

test('safety set: with no app language and no corner list (app.js today), still never dangerous', async () => {
  const run = await runAll((c, d) => readWithBackup(c, { ...d, intersections: [] }, { appLang: null }));
  assert.deepEqual(run.results.filter((r) => r.outcome === 'dangerous').map((r) => r.c.id), []);
});
