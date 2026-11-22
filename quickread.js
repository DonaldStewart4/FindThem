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
  /\b(searched|checked|looked (in|at|around|through)|went through|swept|cleared|walked (all of|the whole|the length of|up and down|every))\b/,
  /\b(buscamos|busque|revisamos|revise|recorrimos|recorri|caminamos todo|caminamos toda)\b/,
  /\b(cherche|fouille|verifie|inspecte|parcouru|ratisse)\b/,
  /(找过|搜过|搜了|找了|查过|查了|检查了|检查过|走遍|从头到尾)/,
  /(探した|捜した|探しました|捜しました|確認した|確認しました|見回った|端から端まで|歩いたけど|を一周)/,
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

// "We found him", "ya la encontramos", "找到了", "見つかりました": the search is over. A message
// for everyone, never a sighting. (The "not found" words are taken out first: "没找到" has "找到".)
const FOUND = [
  /\b(we found (him|her|them)|found (him|her|them)|(he|she)('s| is) (ok|okay|safe|fine|home|back)|(he|she) (has|have) been found|(he|she) was found|is safe now|we have (him|her) now)\b/,
  /\b(ya (lo|la) (encontramos|encontraron|tenemos)|(lo|la) (encontramos|encontraron)|ya aparecio|aparecio sano|aparecio sana)\b/,
  /(on (l'a|les a) (re)?trouvee?s?|nous l'avons (re)?trouvee?|(il|elle) est (sain et sauf|saine et sauve|en securite)|(il|elle) a ete (re)?trouvee?)/,
  /(找到了|找到他了|找到她了|已经找到|平安无事|他没事|她没事)/,
  /(見つかりました|見つかった|見つけました|保護され|無事です|無事でした)/,
];
export function readFound(text) {
  const p = plain(text).replace(/(没找到|没有找到|找不到|找到不)/g, ' ');
  return any(FOUND, p);
}

export function readKind(text) {
  const p = plain(text);
  const l = lower(text);
  if (readFound(text)) return 'message';
  // A question ("¿...?", "...?", "...？") is a message to the others, not a report.
  if (any(QUESTION, p) || /[?？]\s*$/.test(l) || /^\s*¿/.test(l)) return 'message';
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
  /\b(maybe|might|not sure|unsure|possibly|perhaps|could have been|could be|not certain|hard to tell|far away|too far|from a distance|from far)\b/,
  /\b(quizas|quiza|tal vez|a lo mejor|no estoy segur|puede que|posiblemente|lejos)/,
  /\b(peut-etre|peut etre|pas sur|pas certain|possible|il me semble|de loin|trop loin)/,
  /(可能|也许|不确定|不太确定|好像|不知道是不是|很远|离得远|太远)/,
  /(かもしれ|たぶん|多分|自信がない|ような気がする|わからない|遠く|遠くて)/,
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
  /\b(seguro|segura|segurisim|definitivamente|sin duda|era el|era ella|estoy segur)/,
  /\b(certain|certaine|c'etait lui|c'etait elle|sans aucun doute)\b/,
  /(肯定|确定|一定是|就是他|就是她)/,
  /(間違いない|間違いなく|確かに|絶対|確実)/,
];

// "The mailman says he saw her", "la vecina dice que lo vio", "un monsieur dit avoir vu",
// "邮递员说...看到", "見たって": someone else saw them. Second-hand is "maybe" (0.3).
const SECOND_HAND = [
  /\b(says|said|told (me|us)|according to|apparently|i heard|reportedly)\b/,
  /\b(dice que|dijo que|dicen que|me dijo|me dijeron|segun|al parecer)\b/,
  /(dit avoir vu|dit qu|m'a dit|on m'a dit|selon|apparemment|aurait vu)/,
  /(说|听说|据说|据)/,
  /(って言|と言って|そうです|らしい|だって|によると|見たって)/,
];
// Someone other than the reporter is the one who saw: "the mailman saw her", "posted they saw",
// "he was seen", Spanish "vio / vieron" (he / they saw; "vi" is I saw), French "l'a vue" ("je
// l'ai vue" is I saw), "邻居…看到", "近所の人が…見た".
const THIRD_PERSON_SEER = [
  /\b((someone|somebody|a (neighbor|neighbour|man|woman|lady|guy|jogger|driver|mailman|postman|kid|friend|cashier)|my (neighbor|neighbour|son|daughter|friend|wife|husband|brother|sister|mom|dad|uncle|aunt)|the (mailman|postman|neighbor|neighbour|driver|guard|cashier|bus driver)|people|others)\b[^.!?]{0,40}\b(saw|seen|spotted|noticed)\b|\b(was|were) (seen|spotted)\b|\b(posted|texted|messaged)\b)/,
  /\b(vio|vieron|lo vio|la vio|lo vieron|la vieron|ha visto|han visto)\b/,
  /((il|elle|on|quelqu'un|le facteur|la factrice|un voisin|une voisine|un monsieur|une dame|mon voisin|ma voisine|les gens) (l'a|les a|a) (vu|vue|apercu|apercue)|\bl'a (vu|vue)\b)/,
  /((邻居|邮递员|快递员|有人|别人|朋友|他们|保安|司机|店员|路人)[^，。！？,.!?]{0,30}(看到|看见|见到))/,
  /((さん|屋さん|の人|誰か|友達|息子|娘|夫|妻|運転手|店員)(が|も)[^。！!]{0,20}(見|目撃))/,
];
// The reporter's own seeing: "I saw", "vi", "j'ai vu", "我看到", "私が見た".
const FIRST_PERSON_SEER = [
  /\b(i|we|i've|we've|i have|we have)( just| also)? (saw|seen|see|spotted|noticed|found)\b/,
  /\b(vi|vimos|lo vi|la vi|lo veo|la veo|acabo de ver|he visto|hemos visto)\b/,
  /(j'ai vu|je l'ai vu|je l'ai vue|nous avons vu|je (le|la) vois|j'ai apercu)/,
  /((我|我们)[^，。！？,.!?]{0,30}(看到|看见|见到|发现))/,
  /((私|僕|俺|わたし|自分)(が|は|も))/,
];
export function readSecondHand(text) {
  const p = plain(text);
  const saw = any(SAW, p) || any(SAW, lower(text)) || any(THIRD_PERSON_SEER, p);
  if (!saw) return false;
  return any(SECOND_HAND, p) || (any(THIRD_PERSON_SEER, p) && !any(FIRST_PERSON_SEER, p));
}

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
// Evidence that something was searched: a search verb ("searched", "buscamos", "找过", "探した"), or
// a named place or one-of-a-kind place ("no sign of him on Kearney Street", "nobody at the lake").
export function hasSearchEvidence(text, places = []) {
  if (any(SEARCHED, plain(text)) || any(SEARCHED, lower(text))) return true;
  return readAllPlaces(text, places).length > 0 || Boolean(readFeaturePlace(text, places));
}

// How strong the evidence for a named place is. Strong: the full name ("Walnut Avenue"), a short
// name of 7+ letters ("Stevenson", "Paseo Padre"), or a short name next to a street word ("calle
// Walnut", "Walnut St", "Walnut街"). Weak: a short, everyday word alone ("walnut", "bart"): it is
// left empty and marked unsure, for the person to pin (caution rule, Nathan, Nov 22).
const STREET_WORD_AFTER = /^\s*(st\b|street|ave\b|avenue|blvd|boulevard|rd\b|road|dr\b|drive|way\b|pkwy|parkway|calle\b|街|路|通り|大道|大街)/;
const STREET_WORD_BEFORE = /(\b(calle|avenida|av|rue|boulevard|bd)\.?\s*)$/;
export function placeIsStrong(text, place) {
  const l = plain(text);
  return placeMentions(text, [place]).some((m) => {
    const full = plain(place.name).trim();
    if (m.key === full || m.key.length >= 7) return true;
    return STREET_WORD_AFTER.test(l.slice(m.at + m.key.length)) || STREET_WORD_BEFORE.test(l.slice(0, m.at));
  });
}

// (Only places where the person was count: not "toward X" or "from X", see placeMentions.)
export function readPlace(text, places = []) {
  const found = readAllPlaces(text, places);
  if (!found.length) return null;
  const keyLength = (p) => Math.max(...placeMentions(text, [p]).map((m) => m.key.length));
  return found.reduce((best, p) => (keyLength(p) > keyLength(best) ? p : best));
}

// ---- Places by kind ("the lake") ----------------------------------------------------------------

// Words in place names → the same idea in the 5 languages. Also used by proxy/jev.js to check
// that Jev's place has words in the report to back it.
export const PLACE_WORDS = {
  lake: ['lake', 'pond', 'lago', 'estanque', 'lac', 'etang', '湖', '池'],
  creek: ['creek', 'stream', 'arroyo', 'riachuelo', 'ruisseau', '溪', '小河', '河', '川'],
  lagoon: ['lagoon', 'laguna', 'lagune', '潟湖', '泻湖', 'ラグーン'],
  river: ['river', 'rio', 'riviere', 'fleuve', '河', '江', '川'],
  park: ['park', 'parque', 'parc', '公园', '公園'],
  street: ['street', 'calle', 'rue', '街', '路', '通り'],
  avenue: ['avenue', 'avenida', '大道', '街', '通り'],
  boulevard: ['boulevard', 'bulevar', '大道', '通り'],
  drive: ['drive', 'calle', 'rue', '路', '通り'],
  parkway: ['parkway', 'avenida', 'avenue', '大道', '通り'],
  way: ['calle', 'rue', '路', '通り'],
};
// Only these kinds of place can be found from the word alone ("the lake" → Lake Elizabeth),
// and only when exactly ONE nearby place is of that kind. "The street" names nothing.
const FEATURE_KINDS = ['lake', 'creek', 'lagoon', 'river', 'park'];

const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// true if `word` is in `text`: as a whole word for letters ("lac" is not in "place"),
// anywhere for Chinese / Japanese characters. Both should already be plain() text.
export function hasWord(text, word) {
  if (/[぀-ヿ㐀-鿿]/.test(word)) return text.includes(word);
  // The edges are "not a Latin letter or digit": a Chinese or Japanese character next to the
  // word ("在Lake Elizabeth附近") is an edge too.
  return new RegExp(`(^|[^a-z0-9\\u00c0-\\u024f])${escapeRe(word)}($|[^a-z0-9\\u00c0-\\u024f])`).test(text);
}

// "By the lake", "junto al lago", "湖边": the one nearby place of that kind, or null if there
// are none or several (then the person taps the map).
export function readFeaturePlace(text, places = []) {
  const t = plain(text);
  const kinds = FEATURE_KINDS.filter((k) => PLACE_WORDS[k].some((w) => hasWord(t, w)));
  if (!kinds.length) return null;
  const found = [];
  for (const p of places) {
    if (!p || typeof p.name !== 'string' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const words = plain(p.name).split(/[^\p{L}\p{N}]+/u);
    // "Quarry Lakes" is a lake too: a plural name must count, or two lakes would look like one.
    if (kinds.some((k) => words.includes(k) || words.includes(`${k}s`)) && !found.some((q) => q.name === p.name)) found.push(p);
  }
  return found.length === 1 ? found[0] : null;
}

// ---- Street corners ("Paseo Padre and Stevenson") -------------------------------------------------
// The phone works out where the nearby streets cross from the map it downloaded
// (findIntersections) and sends that list with the report. A report that names two streets
// joined by "and" / "y" / "et" / "和" / "と", or with a corner word ("corner", "esquina",
// "coin", "路口", "交差点"), is pinned to where those two streets cross. If they don't cross,
// or cross in two different places, nothing is pinned: two places stay a conflict.

export const MAX_INTERSECTIONS = 30;
const SAME_CORNER_M = 120; // a divided road crosses at up to 4 nodes, all within this of each other

// Meters between two { lat, lng } (equirectangular: fine at these distances).
function meters(a, b) {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return 6371000 * Math.hypot(x, y);
}

// Where the named streets cross: [{ name: 'A & B', streets: ['A', 'B'], lat, lng }], nearest
// to `near` first. osm = OsmData (INTERFACES.md §1); streetNames = the names the phone sends.
// The streets of a pair are in alphabetical order, and so is the name.
export function findIntersections(osm, streetNames = [], near = null, limit = MAX_INTERSECTIONS) {
  if (!osm || !Array.isArray(osm.ways) || !Array.isArray(osm.nodes)) return [];
  const wanted = new Set(streetNames);
  const namesAt = new Map(); // node id → Set of street names through it
  for (const w of osm.ways) {
    if (!w || !wanted.has(w.name) || !Array.isArray(w.nodeIds)) continue;
    for (const id of w.nodeIds) {
      if (!namesAt.has(id)) namesAt.set(id, new Set());
      namesAt.get(id).add(w.name);
    }
  }
  const nodeById = new Map(osm.nodes.map((n) => [n.id, n]));
  const pairs = new Map(); // 'A\u0000B' → [node, ...]
  for (const [id, names] of namesAt) {
    const n = nodeById.get(id);
    if (names.size < 2 || !n) continue;
    const list = [...names].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}\u0000${list[j]}`;
        if (!pairs.has(key)) pairs.set(key, []);
        pairs.get(key).push(n);
      }
    }
  }
  const out = [];
  for (const [key, nodes] of pairs) {
    // The same two streets crossing in two places is ambiguous: leave that pair out.
    if (nodes.some((a) => nodes.some((b) => meters(a, b) > SAME_CORNER_M))) continue;
    const lat = nodes.reduce((sum, n) => sum + n.lat, 0) / nodes.length;
    const lng = nodes.reduce((sum, n) => sum + n.lng, 0) / nodes.length;
    const streets = key.split('\u0000');
    out.push({ name: streets.join(' & '), streets, lat, lng, d: near ? meters(near, { lat, lng }) : 0 });
  }
  out.sort((a, b) => a.d - b.d || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out.slice(0, limit).map(({ d, ...corner }) => corner);
}

const CORNER_WORDS = /\b(corner|intersection|crossing|cross street|esquina|cruce|interseccion|coin|angle|carrefour|croisement)\b|(路口|交叉口|十字路口|交界|交差点|角)/;
const JOINER = /^[\s,]*(and|&|\/|at|y|con|et|和|与|跟|及|と)[\s,]*$/;

// Where in the report a place's name appears: its index, or -1 (the same keys as readAllPlaces).
function nameAt(l, name) {
  const full = lower(name).trim();
  const short = full.replace(STREET_SUFFIX, '');
  for (const key of [full, short]) {
    if (key.length >= 4 && l.includes(key)) return { at: l.indexOf(key), end: l.indexOf(key) + key.length };
  }
  return null;
}

// The street corner the report names, or null. It must be in `intersections`, both streets
// must be among the places the phone sent, and the report must name no other place.
export function readIntersection(text, places = [], intersections = []) {
  if (!Array.isArray(intersections) || !intersections.length) return null;
  const l = lower(text);
  const named = readAllPlaces(text, places).map((p) => p.name);
  const found = [];
  for (const c of intersections) {
    if (!c || !Array.isArray(c.streets) || c.streets.length !== 2 || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    if (!c.streets.every((s) => named.includes(s)) || !named.every((n) => c.streets.includes(n))) continue;
    const [a, b] = c.streets.map((s) => nameAt(l, s)).sort((x, y) => x.at - y.at);
    if (!a || !b) continue;
    const between = l.slice(a.end, b.at);
    if (JOINER.test(between) || CORNER_WORDS.test(plain(text))) found.push(c);
  }
  return found.length === 1 ? found[0] : null;
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
// These words are only looked for in the report's own language (guessLanguage), because the
// same letters mean different things: French "car" is "because", Spanish "van" is "they go".
const VEHICLE = {
  en: /\b(car|cars|drove|driving|driven|drive (off|away)|bus|train|taxi|cab|uber|lyft|truck|vehicle|got a ride|(took|on|rode|riding|got on) (the )?bart)\b/,
  es: /\b(coche|carro|auto|autobus|bus|camion|camioneta|tren|taxi|uber|manejando|conduciendo)\b/,
  fr: /\b(voiture|autobus|bus|taxi|uber|camion|conduisait|metro|(le|un|du|au) train)\b/,
  zh: /(车|公交|巴士|火车|地铁|出租|的士)/,
  ja: /(車|バス|電車|タクシー|運転|乗っ|乗る|乗り)/,
};

// Common short words of each language that writes with letters.
const STOPWORDS = {
  en: ['the', 'he', 'she', 'him', 'her', 'is', 'was', 'and', 'saw', 'on', 'at', 'in', 'to', 'of', 'it', 'by', 'ago', 'his', 'took', 'with', 'near', 'my', 'i'],
  es: ['el', 'la', 'los', 'las', 'lo', 'es', 'y', 'en', 'que', 'se', 'un', 'una', 'del', 'al', 'hace', 'hacia', 'por', 'con', 'esta', 'no', 'mi', 'su', 'vi', 'llevo'],
  fr: ['le', 'la', 'les', 'il', 'elle', 'est', 'et', 'je', 'un', 'une', 'des', 'du', 'dans', 'sur', 'vers', 'pas', 'ce', 'a', 'au', 'avec', 'pris', 'vu', 'ai', 'mais'], // not 'car': in a short report it is English
};
export const LANGS = ['en', 'es', 'fr', 'zh', 'ja'];

// The report's language, from its own words: Japanese if it has kana, Chinese if it has Han
// characters, else whichever of en / es / fr has the most common words. `fallback` (the app's
// language) only breaks ties, because people don't always type in the app's language.
export function guessLanguage(text, fallback = 'en') {
  const fb = LANGS.includes(fallback) ? fallback : 'en';
  const t = lower(text);
  if (/[\u3040-\u30ff]/.test(t)) return 'ja';
  if (/[\u3400-\u9fff]/.test(t)) return 'zh';
  const words = plain(text).split(/[^a-z]+/).filter(Boolean);
  const score = {};
  for (const lang of ['en', 'es', 'fr']) score[lang] = words.filter((w) => STOPWORDS[lang].includes(w)).length;
  const best = Math.max(score.en, score.es, score.fr);
  if (best === 0) return fb;
  const tied = ['en', 'es', 'fr'].filter((lang) => score[lang] === best);
  return tied.includes(fb) ? fb : tied[0];
}
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
  // "It wasn't Dad / Mom / Grandpa...", in all 5 languages.
  /\b((wasn'?t|was not|isn'?t|is not|not) (my |our )?(dad|mom|mum|father|mother|grandpa|grandma|grandfather|grandmother|husband|wife))\b/,
  /\b(no (era|es) (mi |nuestro |nuestra )?(papa|mama|padre|madre|abuelo|abuela|esposo|esposa))\b/,
  /(ce n'etait pas|c'etait pas|ce n'est pas|c'est pas) (mon |ma |notre )?(pere|mere|papa|maman|grand-pere|grand-mere|mari|femme)/,
  /(不是(我|我们)?(爸|妈|爸爸|妈妈|父亲|母亲|爷爷|奶奶|外公|外婆|老公|老婆))/,
  /((父|母|祖父|祖母|おじいちゃん|おばあちゃん|お父さん|お母さん|夫|妻)(じゃな|ではな|ではありま))/,
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
// What a place is in the report: where they were ('at'), a landmark next to it ('near'), where
// they were going ('toward'), or where a searched stretch started ('from'). Only 'at' places (or,
// if there are none, 'near' places) are where the person was: "walking up Walnut toward the
// BART" is on Walnut. A street's short name followed by "station" is the station, not the street
// ("BART station", "BART駅" is not BART Way).
const BEFORE_TOWARD = /(\b(toward|towards|heading to|headed to|going to|on (his|her|their) way to|in the direction of|hacia|rumbo a|camino a|en direccion a|vers|en direction de|direction)(\s+(the|el|la|al|le|du|l'))?\s*|(往|朝|向|去))$/;
const AFTER_TOWARD = /^\s*(へ|に向か|の方|方面)/;
const BEFORE_FROM = /(\b(from|desde|depuis)(\s+(the|el|la|le|l'))?\s*|(从))$/;
const AFTER_FROM = /^\s*(から)/;
const BEFORE_NEAR = /(\b(near|by|next to|close to|beside|cerca de|cerca del|junto a|junto al|pres de|pres du|a cote de)(\s+(the|el|la|le|l'))?\s*)$/;
const AFTER_NEAR = /^\s*(附近|旁边|の近く|のそば|近く)/;
const AFTER_STATION = /^\s*(station|stop|estacion|parada|gare|arret|駅|站|车站)/;

export function placeMentions(text, places = []) {
  const l = plain(text);
  const found = []; // { place, key, at, role }
  for (const p of places) {
    if (!p || typeof p.name !== 'string' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const full = plain(p.name).trim();
    const short = full.replace(STREET_SUFFIX, '');
    for (const key of full === short ? [full] : [full, short]) {
      if (key.length < 4) continue;
      const at = l.indexOf(key);
      if (at < 0) continue;
      const before = l.slice(0, at);
      const after = l.slice(at + key.length);
      if (key === short && key !== full && AFTER_STATION.test(after)) continue; // the station, not the street
      let role = 'at';
      if (BEFORE_TOWARD.test(before) || AFTER_TOWARD.test(after)) role = 'toward';
      else if (BEFORE_FROM.test(before) || AFTER_FROM.test(after)) role = 'from';
      else if (BEFORE_NEAR.test(before) || AFTER_NEAR.test(after)) role = 'near';
      found.push({ place: p, key, at, role });
      break;
    }
  }
  // A shorter name inside a longer one ("Central Park" in "Fremont Central Park") is the longer one.
  const kept = found.filter((a) => !found.some((b) => b !== a && b.key.length > a.key.length && b.key.includes(a.key)));
  // "Near X" is only a landmark when it comes right after another place in the same clause
  // ("Walnut near the BART"). Otherwise "by Lake Elizabeth" is where they were.
  for (const m of kept) {
    if (m.role !== 'near') continue;
    const landmark = kept.some((o) => o !== m && o.at < m.at && m.at - (o.at + o.key.length) <= 30
      && !/[.!?;。！？；]/.test(l.slice(o.at + o.key.length, m.at)));
    if (!landmark) m.role = 'at';
  }
  return kept;
}

// The places where the report says the person WAS (see placeMentions), without repeats.
export function readAllPlaces(text, places = []) {
  const mentions = placeMentions(text, places);
  const at = mentions.filter((m) => m.role === 'at');
  const chosen = at.length ? at : mentions.filter((m) => m.role === 'near');
  return chosen.map((m) => m.place).filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i);
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
// options = { intersections, lang }: the street corners the phone sent, and the app's language.
//   flags      codes from report.js DRAFT_FLAGS
//   conflicts  draft fields the report gives two different answers for: 'place' (two places),
//              'direction', 'minutesSince', or 'reliability' ("definitely" + "not sure").
//              A field in conflict is left empty (reliability goes to "maybe").
//   notSeen    true for "I can't find him", "he's gone" (nobody has seen them)
//   found      true for "we found him" (the search is over: a message)
//   secondHand true for "the mailman says he saw her" (reliability "maybe")
export function readSignals(text, places = [], { intersections = [], lang = 'en' } = {}) {
  const p = plain(text);
  const l = lower(text);
  const flags = [];
  if (any(EMERGENCY, p)) flags.push('emergency');
  if (any(WATER, p)) flags.push('water');
  // "Bus stop", "parada de autobús", "バス停" are places, not vehicles.
  const noStops = p.replace(/\b(bus stop|bus station|bus shelter|parada de(l)? (autobus|bus)|arret de bus|arret du bus)\b|(公交车站|公交站|巴士站|バス停)/g, ' ');
  if (VEHICLE[guessLanguage(text, lang)].test(noStops)) flags.push('vehicle');
  // "是不是他" ("was it him?") contains "不是他" ("not him"): take the question out first.
  if (any(OTHER_PERSON, p.replace(/是不是/g, ''))) flags.push('other_person');
  if (any(JOKE, p) || any(JOKE, l)) flags.push('joke');
  if (any(GUESS, p)) flags.push('guess');

  const conflicts = [];
  // Two places, unless they are the two streets of a corner the report names.
  if (readAllPlaces(text, places).length > 1 && !readIntersection(text, places, intersections)) conflicts.push('place');
  if (readAllDirections(text).length > 1) conflicts.push('direction');
  if (readAllMinutes(text).length > 1) conflicts.push('minutesSince');
  if (any(UNSURE, p)) {
    let rest = p;
    for (const re of UNSURE_STRIP) rest = rest.replace(re, ' ');
    const restLower = lower(text).replace(/pas s[uû]re?/g, ' ');
    if (any(CERTAIN, rest) || /\bsûre?\b/.test(restLower)) conflicts.push('reliability');
  }
  if (conflicts.length) flags.push('conflict');
  return { flags, conflicts, notSeen: any(NOT_SEEN, p), found: readFound(text), secondHand: readSecondHand(text) };
}

// A sighting told without a "saw" verb: someone is somewhere right now, or "it's him".
const PRESENCE = [
  /\b((he|she|someone|somebody|an old (man|woman|lady|guy)|a (man|woman|lady|guy)|an elderly (man|woman)|old (man|woman|lady)) (is|was|'s) (sitting|standing|walking|waiting|lying|wandering|at the|on the|in the|by the|near the)|matching the (photo|description)|it'?s (definitely )?(him|her)|that'?s (him|her))\b/,
  /\b((el|ella|alguien|un senor|una senora|un anciano|una anciana|una viejita|un viejito) (esta|estaba) (sentad[oa]|parad[oa]|caminando|esperando|en el|en la|junto)|es (el|ella)|es mi (papa|mama|abuel[oa]))\b/,
  /\b((il|elle|quelqu'un|un monsieur|une dame|une vieille dame|un vieux monsieur) (est|etait) (assise?|debout|en train de|sur le|sur la|au|a la|pres)|quelqu'un dans l'eau|c'est (lui|elle))/,
  /((有个|有一个|一个)(老人|老太太|老爷爷|老奶奶|人)|(他|她)(正)?(站在|坐在|躺在)|就是(他|她)|是(他|她)没错)/,
  /((が|は)(立って|座って|歩いて|しゃがんで)|(母|父|祖母|祖父|彼|彼女|本人)(です|でした|だと思う|っぽい)|間違いなく)/,
];
export function readPresence(text) {
  return any(PRESENCE, plain(text));
}

// ---- The whole draft --------------------------------------------------------------------------

// Fixed orders, the same as report.js UNSURE_FIELDS and DRAFT_FLAGS (copied here so this
// file stays free of imports; tests/safety.test.js checks they match).
const UNSURE_ORDER = ['kind', 'place', 'direction', 'minutesSince', 'reliability'];
const FLAG_ORDER = ['emergency', 'water', 'vehicle', 'conflict', 'guess', 'other_person', 'joke'];
const inOrder = (set, order) => order.filter((code) => set.has(code));

// Reads a report with the rules above. context = { places: [{ name, lat, lng }],
// intersections: [{ name, streets, lat, lng }] (findIntersections), lang: the app's language }.
// Returns a ReportDraft (INTERFACES.md section 5; version 2 in docs/AGENT-CONTRACT.md).
// Safety first: a joke, or a sighting of someone else, is not a sighting; a field the report
// gives two answers for is left empty and listed in `unsure`.
export function readLocally(text, context = {}) {
  const note = String(text || '').trim().slice(0, 300);
  const places = context.places || [];
  const intersections = context.intersections || [];
  const signals = readSignals(note, places, { intersections, lang: context.lang });
  const flags = new Set(signals.flags);
  const conflicts = new Set(signals.conflicts);
  const unsure = new Set();

  let kind = readKind(note);
  const joke = flags.has('joke');
  const sawWords = kind === 'sighting';
  if (joke) { kind = 'message'; unsure.add('kind'); }
  else if (flags.has('other_person') && kind === 'sighting') kind = 'message';
  // "He took the car" with no "saw" words is for the police: a message, never "searched".
  else if (flags.has('vehicle') && !sawWords && !signals.found) kind = 'message';
  // A sighting told without a "saw" word: "he was sitting on a bench", "間違いなく母です".
  else if (kind === 'message' && !signals.found && !signals.notSeen && !flags.has('guess')
    && !flags.has('other_person') && !flags.has('vehicle') && readPresence(note)) kind = 'sighting';

  // Where: a street corner, else a place by name, else the one place of a kind ("the lake").
  // A water word only adds the water flag: it never stops a sighting from being pinned.
  let place = null;
  if (!joke && conflicts.has('place')) unsure.add('place');
  else if (!joke) {
    const corner = readIntersection(note, places, intersections);
    const named = corner ? null : readPlace(note, places);
    place = corner || (named && placeIsStrong(note, named) ? named : null) || (named ? null : readFeaturePlace(note, places));
    if (named && !place) unsure.add('place'); // a weak name ("walnut" alone): the person pins it
  }

  // Caution: "searched" needs real evidence, a search verb or "not found" at a named place.
  // "She's gone, she's not here" is panic, not a search: a message.
  if (kind === 'searched' && !hasSearchEvidence(note, places)) { kind = 'message'; unsure.add('kind'); }
  // Caution: a sighting told without a "saw" verb is marked unsure, for the person to check.
  if (kind === 'sighting' && !sawWords) unsure.add('kind');

  let direction = null;
  let minutesSince = null;
  if (kind === 'sighting') {
    if (conflicts.has('direction')) unsure.add('direction');
    else direction = readDirection(note);
    if (conflicts.has('minutesSince')) unsure.add('minutesSince');
    else minutesSince = readMinutes(note);
  } else if (kind === 'searched' && !conflicts.has('minutesSince')) {
    minutesSince = readMinutes(note); // for a searched report: how long they searched ("40分かけて")
  }
  // Second-hand ("the mailman says he saw her") or far away is "maybe".
  const reliability = conflicts.has('reliability') || signals.secondHand ? 0.3 : readReliability(note);

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
