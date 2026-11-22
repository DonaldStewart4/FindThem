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
  /\b(il n'y a personne|n'y a personne|vu personne|trouve personne|pas vu|pas trouve|rien vu|rien trouve|aucune trace|n'est pas la|n'etait pas la|ne (le|la|les) (vois|trouve|retrouve))/,
  /(没人|没有人|不在|没看到|没看见|没有看到|没找到|没有找到)/,
  /(いなかった|いませんでした|誰もいな|見つからな|見つかりません|見なかった|見当たらな)/,
];
// "Saw him", "vi a mi papá", "je l'ai vu", "看到", "見かけた".
const SAW = [
  /\b(saw|seen|spotted|sighted|sighting|noticed|found (him|her|them)|there (he|she) is|it was (him|her|them)|looked like (him|her|them)|someone like (him|her)|(i|we) (can )?see (him|her|them)|definitely (him|her|them))\b/,
  /\b(vi|vio|vimos|vieron|visto|vista|avistamiento|encontramos|lo encontr|la encontr|era el|era ella|se parecia|lo veo|la veo)\b/,
  /\b(vu|vue|apercu|apercue|croise|croisee|trouve|c'etait lui|c'etait elle|ressemblait|je le vois|je la vois)\b/,
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

// ---- Safety signals ---------------------------------------------------------------------------
// Word rules that only ever add caution. They are shared by both readers: proxy/jev.js runs
// them on every report Jev reads, so the safety checks never depend on the AI being right.
// Each one becomes a code in the draft's `flags` (report.js DRAFT_FLAGS); the screen turns
// codes into words with i18n.js.

// Water anywhere in the report: never something to send untrained volunteers into.
const WATER = [
  /\b(creek|creeks|lake|lagoon|river|pond|water|channel|canal|stream|ditch|reservoir|flood control|culvert|marsh)\b/,
  /\b(arroyo|lago|laguna|rio|estanque|agua|canal|charco|acequia)\b/,
  /\b(ruisseau|lac|lagune|riviere|etang|eau|canal|fleuve|mare|fosse)\b/,
  /(河|湖|水|溪|池|渠|塘)/,
  /(川|湖|池|水|沼)/,
];
// A car, bus or train: the person could be far outside the walking map. Street names like
// "Civic Center Drive" and "BART Way", and "the BART station" (a place), are left out on purpose.
const VEHICLE = [
  /\b(car|cars|drove|driving|driven|drive (off|away)|bus|train|taxi|cab|uber|lyft|truck|vehicle|got a ride|(took|on|rode|riding|got on) (the )?bart)\b/,
  /\b(coche|carro|auto|autobus|camion|camioneta|tren|taxi|manejando|conduciendo)\b/,
  /\b(voiture|autobus|bus|taxi|camion|conduisait|metro|(le|un|du|au) train)\b/,
  /(车|公交|巴士|火车|地铁|出租|的士)/,
  /(車|バス|電車|タクシー|運転|乗っ|乗る|乗り)/,
];
// Hurt, fallen, in the water: call emergency services now.
const EMERGENCY = [
  /\b(hurt|injured|bleeding|fell|fallen|unconscious|not moving|not breathing|drown\w*|collapsed|face down|ambulance|in the (water|creek|lake|lagoon|river|pond|canal|channel))\b/,
  /\b(herid[oa]|sangr\w*|se cayo|inconsciente|no se mueve|no respira|ahog\w*|ambulancia)\b/,
  /\b(blesse\w*|saign\w*|tombe\w*|inconscient\w*|ne bouge (pas|plus)|ne respire|noy\w*|ambulance)\b/,
  /(受伤|摔倒|摔了|掉进|掉到|落水|流血|昏迷|不动了|没有呼吸|淹|救护车)/,
  /(怪我|けが|倒れ|落ちた|落ちて|出血|意識がな|動かな|息をして|溺れ|救急車)/,
];
// It turned out to be someone else: not a sighting of the missing person.
const OTHER_PERSON = [
  /\b(wasn'?t (him|her|them)|was not (him|her|them)|not (him|her)|not our (guy|man|lady|woman|person|dad|mom)|someone else|somebody else|different (person|man|woman|guy|lady)|wrong person|false alarm)\b/,
  /\b(no era el|no era ella|no es el|no es ella|otra persona|era otro|era otra|falsa alarma)\b/,
  /(ce n'etait pas (lui|elle)|c'etait pas (lui|elle)|pas (lui|elle)\b|quelqu'un d'autre|une autre personne|fausse alerte)/,
  /(不是他|不是她|另一个人|别人|认错|虚惊)/,
  /(彼じゃな|彼女じゃな|別の人|別人|人違い|違う人|本人じゃな|本人ではな)/,
];
// Reads like a joke or sarcasm.
const JOKE = [
  /\b(lol|lmao|rofl|haha\w*|hehe\w*|jk|just kidding|kidding|joking|yeah right)\b/,
  /\b(jaja\w*|jeje\w*|es broma|era broma|bromeando)\b/,
  /\b(mdr|ptdr|je rigole|c'est une blague|blague)\b/,
  /(哈哈|开玩笑|逗你)/,
  /(\(笑\)|笑笑|冗談|じょうだん|(^|[^a-z])ww+($|[^a-z]))/,
  /(😂|🤣|😆|😜|🙄)/u,
];
// A guess or a worry about where they might be ("I think she's in the creek"), not a sighting.
const GUESS = [
  /\b(i think (she|he|they)('s| is| are|'re| went| fell)|(she|he|they) (might|may|could) (be|have)|maybe (she|he|they)('s| is| went)|i bet|i'm worried|i am worried|what if|(she|he) (always|usually|often) (goes|walks)|(she|he) likes? to go)\b/,
  /\b(creo que (esta|se fue|se cayo|anda)|puede que (este|haya)|quizas (este|se)|tal vez (este|se)|siempre va|le gusta ir)\b/,
  /(je pense qu'(il|elle)|je crois qu'(il|elle)|(il|elle) est peut-etre|(il|elle) (doit|pourrait) etre|(il|elle) va toujours|(il|elle) aime aller)/,
  /(我觉得(他|她)在|可能在|也许在|应该在|大概在|总是去|喜欢去|会不会在)/,
  /(にいると思|にいるかも|に落ちたと思|に行ったと思|いつも.*行)/, // not plain たぶん / と思う: those are just "maybe"
];

// "I can't find him", "he's gone": the opposite of a sighting (nobody has seen them).
// Not a flag the screen shows; proxy/jev.js uses it so Jev can't call this a sighting.
const NOT_SEEN = [
  /\b(can'?t find|cannot find|can'?t see (him|her|them) anywhere|(he|she)('s| is) gone|(he|she)('s| is) missing|still missing|nowhere)\b/,
  /\b(no lo encuentro|no la encuentro|no lo encontramos|no la encontramos|no aparece|desaparecid[oa]|por ninguna parte)\b/,
  /(ne (le|la|les) (vois|trouve|retrouve)|introuvable|disparu|nulle part)/,
  /(找不到|不见了|失踪|到处都)/,
  /(どこにもいない|見つからない|いなくなった|行方不明)/,
];

// Words that mean "not sure" together with what they are about, removed before looking for
// "sure" words, so "no estoy segura" or "不确定" (which contain "segura" / "确定") aren't
// read as "certain". What is left over and still says "certain" is a real conflict.
const UNSURE_STRIP = [
  /\b(not sure|unsure|not certain|no idea)( if| whether| that)?( it was| that was)?( (him|her|them))?/g,
  /\b(no estoy segur[oa]|no se si (era|es) (el|ella))/g,
  /\b(pas sur[e]?|pas certain[e]?)/g,
  /(不确定|不太确定|不知道是不是(他|她)?)/g,
];

// Every nearby place the report names. A shorter name inside a longer one ("Central Park" in
// "Fremont Central Park") counts once, as the longer one.
export function readAllPlaces(text, places = []) {
  const l = lower(text);
  const found = []; // { place, key }
  for (const p of places) {
    if (!p || typeof p.name !== 'string' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const full = lower(p.name).trim();
    const short = full.replace(STREET_SUFFIX, '');
    const key = [full, short].find((k) => k.length >= 4 && l.includes(k));
    if (key) found.push({ place: p, key });
  }
  return found
    .filter((a) => !found.some((b) => b !== a && b.key.length > a.key.length && b.key.includes(a.key)))
    .map((a) => a.place)
    .filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i);
}

// Every direction the report gives (after a "heading" word), without repeats.
export function readAllDirections(text) {
  const forms = { plain: plain(text), lower: lower(text) };
  const out = new Set();
  for (const [re, words, form] of DIR_RULES) {
    for (const m of forms[form].matchAll(new RegExp(re.source, 'g'))) {
      const word = m[1].replace(/\s+/g, ' ');
      if (words[word]) out.add(words[word]);
    }
  }
  return [...out];
}

// Every "how long ago" the report gives, without repeats. Each phrase is cut out once it is
// read, so "half an hour" isn't also read as "an hour".
export function readAllMinutes(text) {
  let p = plain(text);
  const out = new Set();
  const phrases = [
    [/\b(just now|right now|a moment ago|ahora mismo|hace un momento|recien|a l'instant|tout de suite)\b|(刚才|刚刚|さっき|たった今|今さっき)/g, 0],
    [/\b(quarter of an hour|quarter hour|cuarto de hora|quart d'heure)\b|(一刻钟)/g, 15],
    [/\b(half an hour|half hour|media hora|demi-heure|demi heure)\b|(半小时|半个小时|半時間)/g, 30],
    [/\b(an hour|one hour|1 hour|una hora|1 hora|une heure|1 heure)\b|(一个小时|一小时|1小时|1個小時|1時間|一時間)/g, 60],
  ];
  for (const [re, minutes] of phrases) {
    if (re.test(p)) { out.add(minutes); p = p.replace(re, ' '); }
    re.lastIndex = 0;
  }
  for (const m of p.matchAll(/(\d{1,3}|[a-z-]+|[一两二三四五十]+)\s*(?:minutes?|mins?\b|minutos?|分钟|分鐘|分)/g)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    if (Number.isFinite(n) && n >= 0 && n <= MAX_MINUTES) out.add(n);
  }
  return [...out];
}

// The safety signals in a report: { flags: [...], conflicts: [...], notSeen }.
//   flags      codes from report.js DRAFT_FLAGS
//   conflicts  draft fields the report gives two different answers for: 'place' (two places),
//              'direction', 'minutesSince', or 'reliability' ("definitely" + "not sure").
//              A field in conflict is left empty (reliability goes to "maybe").
//   notSeen    true for "I can't find him", "he's gone" (nobody has seen them)
export function readSignals(text, places = []) {
  const p = plain(text);
  const l = lower(text);
  const flags = [];
  if (any(EMERGENCY, p)) flags.push('emergency');
  if (any(WATER, p)) flags.push('water');
  if (any(VEHICLE, p)) flags.push('vehicle');
  // "是不是他" ("was it him?") contains "不是他" ("not him"): take the question out first.
  if (any(OTHER_PERSON, p.replace(/是不是/g, ''))) flags.push('other_person');
  if (any(JOKE, p) || any(JOKE, l)) flags.push('joke');
  if (any(GUESS, p)) flags.push('guess');

  const conflicts = [];
  if (readAllPlaces(text, places).length > 1) conflicts.push('place');
  if (readAllDirections(text).length > 1) conflicts.push('direction');
  if (readAllMinutes(text).length > 1) conflicts.push('minutesSince');
  if (any(UNSURE, p)) {
    let rest = p;
    for (const re of UNSURE_STRIP) rest = rest.replace(re, ' ');
    const restLower = lower(text).replace(/pas s[uû]re?/g, ' ');
    if (any(CERTAIN, rest) || /\bsûre?\b/.test(restLower)) conflicts.push('reliability');
  }
  if (conflicts.length) flags.push('conflict');
  return { flags, conflicts, notSeen: any(NOT_SEEN, p) };
}

// ---- The whole draft --------------------------------------------------------------------------

// Fixed orders, the same as report.js UNSURE_FIELDS and DRAFT_FLAGS (copied here so this
// file stays free of imports; tests/safety.test.js checks they match).
const UNSURE_ORDER = ['kind', 'place', 'direction', 'minutesSince', 'reliability'];
const FLAG_ORDER = ['emergency', 'water', 'vehicle', 'conflict', 'guess', 'other_person', 'joke'];
const inOrder = (set, order) => order.filter((code) => set.has(code));

// Reads a report with the rules above. context = { places: [{ name, lat, lng }] }.
// Returns a ReportDraft (INTERFACES.md section 5; version 2 in docs/AGENT-CONTRACT.md).
// Safety first: a joke, or a sighting of someone else, is not a sighting; a field the report
// gives two answers for is left empty and listed in `unsure`.
export function readLocally(text, context = {}) {
  const note = String(text || '').trim().slice(0, 300);
  const places = context.places || [];
  const signals = readSignals(note, places);
  const flags = new Set(signals.flags);
  const conflicts = new Set(signals.conflicts);
  const unsure = new Set();

  let kind = readKind(note);
  const joke = flags.has('joke');
  if (joke) { kind = 'message'; unsure.add('kind'); }
  else if (flags.has('other_person') && kind === 'sighting') kind = 'message';

  let place = null;
  if (!joke && conflicts.has('place')) unsure.add('place');
  else if (!joke) place = readPlace(note, places);

  let direction = null;
  let minutesSince = null;
  if (kind === 'sighting') {
    if (conflicts.has('direction')) unsure.add('direction');
    else direction = readDirection(note);
    if (conflicts.has('minutesSince')) unsure.add('minutesSince');
    else minutesSince = readMinutes(note);
  }
  const reliability = conflicts.has('reliability') ? 0.3 : readReliability(note);

  const draft = {
    kind,
    placeText: place ? place.name : '',
    lat: place ? place.lat : null,
    lng: place ? place.lng : null,
    direction,
    minutesSince,
    reliability,
    note,
  };
  if (unsure.size) draft.unsure = inOrder(unsure, UNSURE_ORDER);
  if (flags.size) draft.flags = inOrder(flags, FLAG_ORDER);
  return draft;
}
