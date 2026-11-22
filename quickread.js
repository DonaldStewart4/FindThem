// quickread.js — the report box's BACKUP reader: simple word rules that run on the phone.
//
// The report box normally sends the report to Jev (TypeSafe AI) through the proxy. When that
// isn't possible (no signal, the proxy isn't set up, Jev's key is missing, Jev is down), the
// app uses readLocally() instead, so the person still gets a filled-in draft to check
// rather than an empty form.
//
// It looks for a few kinds of words in all 5 languages (en, es, fr, zh, ja):
//   - what kind of report:  "saw" → sighting, "nobody" / "searched" → searched, else message
//   - how long ago:         "10 minutes", "half an hour", "just now", "diez minutos", "10分前" ...
//   - which way:            "heading east", "hacia el norte", "vers l'ouest", "往东", "北へ"
//   - how sure:             "maybe" → 0.3, nothing → 0.6, "definitely" → 0.9
//   - where:                a nearby place name from the map ("Paseo Padre", "Central Park")
// Anything it can't find is left empty for the person to fill in, the same rule as Jev's
// MIN_CONFIDENCE. It returns the same ReportDraft as the proxy (INTERFACES.md section 5),
// and the person still checks the form and taps the button before anything reaches the map.
//
// The words below are data for matching, not UI text (UI text lives in i18n.js).
// No DOM here, so tests/quickread.test.js and bench/jev-eval.js run it in Node.

// ---- Small helpers --------------------------------------------------------------------

// Lowercase, full-width digits → normal digits (NFKC), with accents kept ("sûr").
function lower(text) {
  return String(text || '').normalize('NFKC').toLowerCase();
}
// The same, with accents removed ("vió" → "vio", "aperçu" → "apercu"), for es/fr words.
function plain(text) {
  // NFC at the end puts Japanese voiced kana back together (NFD splits "ぶ" into "ふ" + a mark).
  return lower(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
}

// ---- What kind of report ---------------------------------------------------------------

// "Nobody there", "didn't see him": checked a place and did NOT find the person.
const NOT_FOUND = [
  /\b(nobody|no one|noone|no sign|not there|wasn'?t there|isn'?t there|not here|didn'?t see|did not see|haven'?t seen|not found|didn'?t find|did not find|all clear)\b/,
  /\b(nadie|no esta|no estaba|no lo vi|no la vi|no lo vimos|no la vimos|no lo encontr|no la encontr|ni rastro)/,
  /\b(il n'y a personne|n'y a personne|vu personne|trouve personne|pas vu|pas trouve|rien vu|rien trouve|aucune trace|n'est pas la|n'etait pas la)/,
  /(没人|没有人|不在|没看到|没看见|没有看到|没找到|没有找到)/,
  /(いなかった|いませんでした|誰もいな|見つからな|見つかりません|見なかった|見当たらな)/,
];
// "Saw him", "vi a mi papá", "je l'ai vu", "看到", "見かけた".
const SAW = [
  /\b(saw|seen|spotted|sighted|sighting|noticed|found (him|her|them)|there (he|she) is|it was (him|her|them)|looked like (him|her|them)|someone like (him|her))\b/,
  /\b(vi|vio|vimos|vieron|visto|vista|avistamiento|encontramos|lo encontr|la encontr|era el|era ella|se parecia)\b/,
  /\b(vu|vue|apercu|apercue|croise|croisee|trouve|c'etait lui|c'etait elle|ressemblait)\b/,
  /(看到|看见|见到|瞧见|发现|像他|像她|是他|是她)/,
  /(見た|見ました|見かけ|見つけ|目撃|らしき人|似た人|っぽい人)/,
];
// "Searched the park", "revisamos", "on a fouillé": a place was checked.
const SEARCHED = [
  /\b(searched|checked|looked (in|at|around|through)|went through|swept|cleared)\b/,
  /\b(buscamos|busque|revisamos|revise|recorrimos)\b/,
  /\b(cherche|fouille|verifie|inspecte)\b/,
  /(找过|搜过|搜了|找了|查过|查了|检查了|检查过)/,
  /(探した|捜した|探しました|捜しました|確認した|確認しました|見回った)/,
];

// "Has anyone seen him?": a question to the others, not a sighting.
const QUESTION = [
  /\b(has anyone|have you|did anyone|anyone seen|anybody seen|has anybody|is anyone|where is|where are)\b/,
  /\b(alguien (ha )?visto|alguien lo vio|alguien la vio|donde esta|donde estan)/,
  /\b(quelqu'un a vu|quelqu'un l'a vu|vous l'avez vu|ou est|ou sont)/,
  /(有人看到|有没有人|谁看到|在哪)/,
  /(誰か見|見ませんでしたか|どこにいます|どこですか)/,
];

const any = (patterns, text) => patterns.some((re) => re.test(text));

export function readKind(text) {
  const p = plain(text);
  const l = lower(text);
  if (any(QUESTION, p)) return 'message';
  if (any(NOT_FOUND, p) || any(NOT_FOUND, l)) return 'searched';
  if (any(SAW, p) || any(SAW, l)) return 'sighting';
  if (any(SEARCHED, p) || any(SEARCHED, l)) return 'searched';
  return 'message';
}

// ---- How long ago -----------------------------------------------------------------------

const NUMBER_WORDS = {
  // en
  one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, 'twenty-five': 25, thirty: 30, 'forty-five': 45, forty: 40,
  // es
  uno: 1, dos: 2, tres: 3, cinco: 5, diez: 10, quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40,
  // fr
  deux: 2, trois: 3, cinq: 5, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40,
  // zh / ja (written with characters)
  '一': 1, '两': 2, '二': 2, '三': 3, '五': 5, '十': 10, '十五': 15, '二十': 20, '三十': 30, '四十': 40, '四十五': 45,
};
const MAX_MINUTES = 180; // a bigger number is probably not "minutes ago"

export function readMinutes(text) {
  const p = plain(text);
  // "just now", "ahora mismo", "à l'instant", "刚才", "さっき"
  if (/\b(just now|right now|a moment ago|just saw|ahora mismo|hace un momento|recien|a l'instant|tout de suite)\b/.test(p)
    || /(刚才|刚刚|さっき|たった今|今さっき)/.test(p)) return 0;
  // a quarter of an hour
  if (/\b(quarter of an hour|quarter hour|cuarto de hora|quart d'heure)\b/.test(p) || /(一刻钟|十五分|15分)/.test(p)) return 15;
  // half an hour
  if (/\b(half an hour|half hour|media hora|demi-heure|demi heure)\b/.test(p) || /(半小时|半个小时|半時間)/.test(p)) return 30;
  // an hour
  if (/\b(an hour|one hour|1 hour|una hora|1 hora|une heure|1 heure)\b/.test(p) || /(一个小时|一小时|1小时|1個小時|1時間|一時間)/.test(p)) return 60;
  // a number before a minutes word: "10 min", "diez minutos", "十分钟", "10分前"
  const m = p.match(/(\d{1,3}|[a-z-]+|[一两二三四五十]+)\s*(?:minutes?|mins?\b|minutos?|分钟|分鐘|分)/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    if (Number.isFinite(n) && n >= 0 && n <= MAX_MINUTES) return n;
  }
  // "a few minutes", "unos minutos", "quelques minutes", "几分钟", "数分"
  if (/\b(a few minutes|few minutes|unos minutos|pocos minutos|quelques minutes)\b/.test(p) || /(几分钟|数分)/.test(p)) return 5;
  return null;
}

// ---- Which way ----------------------------------------------------------------------------

const EN_DIR = { 'north east': 'NE', northeast: 'NE', 'north-east': 'NE', 'north west': 'NW', northwest: 'NW', 'north-west': 'NW',
  'south east': 'SE', southeast: 'SE', 'south-east': 'SE', 'south west': 'SW', southwest: 'SW', 'south-west': 'SW',
  north: 'N', south: 'S', east: 'E', west: 'W' };
const ES_DIR = { noreste: 'NE', noroeste: 'NW', sureste: 'SE', sudeste: 'SE', suroeste: 'SW', sudoeste: 'SW', norte: 'N', sur: 'S', este: 'E', oeste: 'W' };
const FR_DIR = { 'nord-est': 'NE', 'nord-ouest': 'NW', 'sud-est': 'SE', 'sud-ouest': 'SW', nord: 'N', sud: 'S', est: 'E', ouest: 'W' };
const ZH_DIR = { '东北': 'NE', '西北': 'NW', '东南': 'SE', '西南': 'SW', '北': 'N', '南': 'S', '东': 'E', '西': 'W' };
const JA_DIR = { '北東': 'NE', '北西': 'NW', '南東': 'SE', '南西': 'SW', '北': 'N', '南': 'S', '東': 'E', '西': 'W' };

// A direction word only counts after a "heading" word, so place names like "East Plaza"
// or Spanish "este" ("this") aren't read as a direction.
const DIR_RULES = [
  [/\b(?:head(?:ing|ed|s)?|go(?:ing|es)?|went|walk(?:ing|ed|s)?|mov(?:ing|ed)|runn?(?:ing)?|ran|toward|towards|wander(?:ing|ed)?|drift(?:ing|ed)?|limp(?:ing|ed)?|stroll(?:ing|ed)?|to the|in the direction of)\s+(?:the\s+|due\s+)?(north[- ]?east|north[- ]?west|south[- ]?east|south[- ]?west|north|south|east|west)\b/, EN_DIR, 'plain'],
  [/\b(north[- ]?east|north[- ]?west|south[- ]?east|south[- ]?west|north|south|east|west)(?:bound|ward|wards)\b/, EN_DIR, 'plain'],
  [/\b(?:hacia el|hacia|rumbo al|rumbo a|en direccion al|en direccion a|direccion|camino al|para el|al)\s+(noreste|noroeste|sureste|sudeste|suroeste|sudoeste|norte|sur|este|oeste)\b/, ES_DIR, 'plain'],
  [/\b(?:vers le|vers l'|vers|en direction du|en direction de l'|direction|au|a l')\s*(nord-est|nord-ouest|sud-est|sud-ouest|nord|sud|est|ouest)\b/, FR_DIR, 'plain'],
  [/(?:往|向|朝|向着|朝着)(东北|西北|东南|西南|北|南|东|西)/, ZH_DIR, 'lower'],
  [/(北東|北西|南東|南西|北|南|東|西)(?:へ|に向|の方|方向|方面)/, JA_DIR, 'lower'],
];

export function readDirection(text) {
  const forms = { plain: plain(text), lower: lower(text) };
  for (const [re, words, form] of DIR_RULES) {
    const m = forms[form].match(re);
    if (m) {
      const word = m[1].replace(/\s+/g, ' ');
      if (words[word]) return words[word];
    }
  }
  return null;
}

// ---- How sure -------------------------------------------------------------------------------

// Checked in this order: "not sure" must win over "sure".
const UNSURE = [
  /\b(maybe|might|not sure|unsure|possibly|perhaps|could have been|could be|not certain|hard to tell)\b/,
  /\b(quizas|quiza|tal vez|a lo mejor|no estoy segur|puede que|posiblemente)/,
  /\b(peut-etre|peut etre|pas sur|pas certain|possible|il me semble)/,
  /(可能|也许|不确定|不太确定|好像|不知道是不是)/,
  /(かもしれ|たぶん|多分|自信がない|ような気がする|わからない)/,
];
// "I think it was him": fairly sure (0.6), checked before the "certain" words.
const FAIRLY = [
  /\b(i think|i believe|probably|pretty sure|fairly sure|likely)\b/,
  /\b(creo|probablemente|me parece)\b/,
  /\b(je crois|je pense|probablement)\b/,
  /(我觉得|我认为|应该是|大概)/,
  /(と思う|と思います|おそらく)/,
];
const CERTAIN = [
  /\b(definitely|for sure|i'm sure|i am sure|certain|certainly|absolutely|100%|no doubt|it was (him|her|them))\b/,
  /\b(seguro|segura|definitivamente|sin duda|era el|era ella|estoy segur)/,
  /\b(certain|certaine|c'etait lui|c'etait elle|sans aucun doute)\b/,
  /(肯定|确定|一定是|就是他|就是她)/,
  /(間違いない|確かに|絶対|確実)/,
];

export function readReliability(text) {
  const p = plain(text);
  if (any(UNSURE, p)) return 0.3;
  if (any(FAIRLY, p)) return 0.6;
  // French "sûr" keeps its accent here: without it, "sur" just means "on".
  if (any(CERTAIN, p) || /\bsûre?\b/.test(lower(text))) return 0.9;
  return 0.6;
}

// ---- Where ------------------------------------------------------------------------------------

// Street-type words people often leave out: "Paseo Padre" for "Paseo Padre Parkway".
const STREET_SUFFIX = /\s+(parkway|pkwy|street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|way|court|ct|lane|ln|terrace|common|circle|place|pl)\.?$/i;

// The nearby place whose name appears in the report (the longest match wins, so
// "Fremont Central Park" beats "Central Park"). places = [{ name, lat, lng }].
export function readPlace(text, places = []) {
  const l = lower(text);
  let best = null;
  let bestLen = 0;
  for (const p of places) {
    if (!p || typeof p.name !== 'string' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const full = lower(p.name).trim();
    const short = full.replace(STREET_SUFFIX, '');
    for (const key of [full, short]) {
      if (key.length < 4 || key.length <= bestLen) continue;
      if (l.includes(key)) { best = p; bestLen = key.length; }
    }
  }
  return best;
}

// ---- The whole draft --------------------------------------------------------------------------

// Reads a report with the rules above. context = { places: [{ name, lat, lng }] }.
// Returns a ReportDraft (INTERFACES.md section 5).
export function readLocally(text, context = {}) {
  const note = String(text || '').trim().slice(0, 300);
  const kind = readKind(note);
  const place = readPlace(note, context.places || []);
  return {
    kind,
    placeText: place ? place.name : '',
    lat: place ? place.lat : null,
    lng: place ? place.lng : null,
    direction: kind === 'sighting' ? readDirection(note) : null,
    minutesSince: kind === 'sighting' ? readMinutes(note) : null,
    reliability: readReliability(note),
    note,
  };
}
