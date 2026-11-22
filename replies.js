// replies.js — what the search leader SAYS, in all 5 languages: the fixed templates, the checker
// for generated replies, and the phone's side of POST /say.
//
// How a reply is made (docs/REPLIES.md):
//   1. The screen calls getReply(intent, data, lang). `data` is the engine's structured payload.
//   2. For most intents the proxy (POST /say) asks a text LLM to say the fixed template's meaning
//      in its own calm words, using ONLY the facts in `data`.
//   3. checkReply() checks every generated reply, on the proxy AND again on the phone. Every number,
//      place and direction in it must come from `data`; it must not give medical advice, say where
//      the person IS, send anyone into water, roads or private property, or promise anything; it must
//      be short, one line, and in the right language.
//   4. Anything that fails, no key, no signal, or a slow proxy → the fixed template (templateReply).
//      'emergency' and 'found' ALWAYS use the fixed template: they are never generated.
//   5. Safety warnings (water, vehicle) are fixed sentences added AFTER the check, never generated.
//
// No DOM here: tests/replies.test.js and proxy/worker.js run it in Node.
// NOTE (CLAUDE.md): UI text belongs in i18n.js. These templates live here for now because the
// proxy must check replies against them and i18n.js is being edited elsewhere; the hook-up list in
// docs/REPLIES.md moves them (or makes i18n.js import them).


export const INTENTS = ['ask', 'confirm', 'abstain', 'readRoute', 'comfort', 'found', 'emergency'];
export const FIXED_INTENTS = ['emergency', 'found']; // never generated
export const LANGS = ['en', 'es', 'fr', 'zh', 'ja'];
export const ASK_FIELDS = ['lastSeen', 'minutes', 'travel', 'houseChecked', 'direction', 'mobility', 'familiar', 'description', 'confirmPlace'];
export const MAX_REPLY_CHARS = { latin: 220, cjk: 90 }; // a reply is one or two short sentences
export const MAX_SENTENCES = 2;

// ---- Words the templates fill in -------------------------------------------------------------------

const DIRECTION_NAMES = {
  en: { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' },
  es: { N: 'el norte', NE: 'el noreste', E: 'el este', SE: 'el sureste', S: 'el sur', SW: 'el suroeste', W: 'el oeste', NW: 'el noroeste' },
  fr: { N: 'le nord', NE: 'le nord-est', E: "l'est", SE: 'le sud-est', S: 'le sud', SW: 'le sud-ouest', W: "l'ouest", NW: 'le nord-ouest' },
  zh: { N: '北', NE: '东北', E: '东', SE: '东南', S: '南', SW: '西南', W: '西', NW: '西北' },
  ja: { N: '北', NE: '北東', E: '東', SE: '南東', S: '南', SW: '南西', W: '西', NW: '北西' },
};
const TRAVEL_NAMES = {
  en: { walking: 'walking', car: 'maybe by car', bus: 'maybe by bus', unknown: 'travel not sure' },
  es: { walking: 'a pie', car: 'quizás en coche', bus: 'quizás en autobús', unknown: 'transporte no seguro' },
  fr: { walking: 'à pied', car: 'peut-être en voiture', bus: 'peut-être en bus', unknown: 'transport incertain' },
  zh: { walking: '步行', car: '可能开车', bus: '可能坐公交', unknown: '出行方式不确定' },
  ja: { walking: '徒歩', car: '車の可能性', bus: 'バスの可能性', unknown: '移動手段は不明' },
};
const MOBILITY_NAMES = {
  en: { normal: 'walks normally', slow: 'walks slowly', walker: 'uses a walker or cane' },
  es: { normal: 'camina normal', slow: 'camina despacio', walker: 'usa andador o bastón' },
  fr: { normal: 'marche normalement', slow: 'marche lentement', walker: 'utilise un déambulateur ou une canne' },
  zh: { normal: '走路正常', slow: '走得慢', walker: '用助行器或拐杖' },
  ja: { normal: '普通に歩く', slow: 'ゆっくり歩く', walker: '歩行器か杖を使う' },
};
const FIELD_NAMES = { // for "I wasn't sure about: ..."
  en: { kind: 'what kind of report', place: 'where', direction: 'which way', minutesSince: 'when', reliability: 'how sure' },
  es: { kind: 'qué tipo de aviso', place: 'dónde', direction: 'hacia dónde', minutesSince: 'cuándo', reliability: 'qué tan seguro' },
  fr: { kind: 'le type de signalement', place: 'où', direction: 'dans quelle direction', minutesSince: 'quand', reliability: 'le degré de certitude' },
  zh: { kind: '报告类型', place: '地点', direction: '方向', minutesSince: '时间', reliability: '有多确定' },
  ja: { kind: '報告の種類', place: '場所', direction: '方向', minutesSince: '時間', reliability: '確かさ' },
};
const LIST_JOIN = { en: ', ', es: ', ', fr: ', ', zh: '、', ja: '、' };
const DECIMAL = { en: '.', es: ',', fr: ',', zh: '.', ja: '.' };

// ---- The fixed templates (5 languages). These are AI-drafted and need a native speaker's check. ----

const T = {
  en: {
    ask: {
      lastSeen: 'Where were they last seen? Say an address or a place, or tap the map.',
      minutes: 'About how long ago?',
      travel: 'Could they have driven or taken a bus?',
      houseChecked: 'Have you checked inside the house, garage, cars and yard?',
      direction: 'Do you know which way they went? A doorbell camera often shows it.',
      mobility: 'How do they walk?',
      familiar: 'Is there a place they might try to go: an old home, work, church?',
      description: 'What are they wearing? The top color matters most.',
      confirmPlace: 'Did you mean {place}?',
    },
    confirmCase: 'Here is what I have: {summary}. Tap anything to change it.',
    confirmChange: 'Changed to {value}.',
    confirmClue: 'This would move about {pct}% of the chance toward {place}. Add it?',
    abstainFields: "I wasn't sure about: {fields}. Please check them.",
    abstainNone: "I'm not sure. Please check this yourself.",
    route: 'Your area: {streets}. About {distance}, {minutes} minutes.',
    routePros: 'This area is for professionals, not volunteers.',
    comfort: "You're doing the right things. Keep going, one step at a time.",
    found: "They've been found. Thank you, everyone. Please stop searching.",
    emergency: 'Call {number} now.',
    seenAt: 'seen at {place}', ago: '{minutes} min ago', heading: 'heading {direction}', minutesValue: '{minutes} minutes',
    flagWater: "Check from the bank or path. Don't go into the water.",
    flagVehicle: 'A car sighting goes to the police. The map is for walking.',
    routeWater: 'There is water in this area: stay on the paths.',
  },
  es: {
    ask: {
      lastSeen: '¿Dónde lo vieron por última vez? Diga una dirección o un lugar, o toque el mapa.',
      minutes: '¿Hace cuánto, más o menos?',
      travel: '¿Pudo haberse ido en coche o en autobús?',
      houseChecked: '¿Ya revisó dentro de la casa, el garaje, los coches y el patio?',
      direction: '¿Sabe hacia dónde se fue? Una cámara de timbre a menudo lo muestra.',
      mobility: '¿Cómo camina?',
      familiar: '¿Hay algún lugar al que podría intentar ir: una casa antigua, el trabajo, la iglesia?',
      description: '¿Qué ropa lleva? El color de arriba es lo más importante.',
      confirmPlace: '¿Quiso decir {place}?',
    },
    confirmCase: 'Esto es lo que tengo: {summary}. Toque cualquier dato para cambiarlo.',
    confirmChange: 'Cambiado a {value}.',
    confirmClue: 'Esto movería cerca del {pct}% de la probabilidad hacia {place}. ¿Lo agrego?',
    abstainFields: 'No estaba seguro de: {fields}. Por favor, revíselo.',
    abstainNone: 'No estoy seguro. Por favor, revíselo usted.',
    route: 'Su zona: {streets}. Unos {distance}, {minutes} minutos.',
    routePros: 'Esta zona es para profesionales, no para voluntarios.',
    comfort: 'Está haciendo lo correcto. Sigamos, paso a paso.',
    found: 'Ya apareció. Gracias a todos. Por favor, dejen de buscar.',
    emergency: 'Llame al {number} ahora.',
    seenAt: 'visto en {place}', ago: 'hace {minutes} min', heading: 'hacia {direction}', minutesValue: '{minutes} minutos',
    flagWater: 'Revise desde la orilla o el sendero. No entre al agua.',
    flagVehicle: 'Un avistamiento en coche es para la policía. El mapa es para quien camina.',
    routeWater: 'Hay agua en esta zona: quédese en los senderos.',
  },
  fr: {
    ask: {
      lastSeen: "Où la personne a-t-elle été vue pour la dernière fois ? Dites une adresse ou un lieu, ou touchez la carte.",
      minutes: 'Il y a combien de temps, à peu près ?',
      travel: 'A-t-elle pu partir en voiture ou en bus ?',
      houseChecked: 'Avez-vous vérifié dans la maison, le garage, les voitures et le jardin ?',
      direction: "Savez-vous dans quelle direction elle est partie ? Une caméra de sonnette le montre souvent.",
      mobility: 'Comment marche-t-elle ?',
      familiar: "Y a-t-il un endroit où elle pourrait essayer d'aller : une ancienne maison, le travail, une église ?",
      description: "Que porte-t-elle ? La couleur du haut compte le plus.",
      confirmPlace: 'Vous voulez dire {place} ?',
    },
    confirmCase: "Voici ce que j'ai : {summary}. Touchez un élément pour le modifier.",
    confirmChange: 'Changé en {value}.',
    confirmClue: 'Cela déplacerait environ {pct} % des chances vers {place}. L’ajouter ?',
    abstainFields: "Je n'étais pas sûr de : {fields}. Merci de vérifier.",
    abstainNone: "Je ne suis pas sûr. Merci de vérifier vous-même.",
    route: 'Votre zone : {streets}. Environ {distance}, {minutes} minutes.',
    routePros: 'Cette zone est pour les professionnels, pas pour les bénévoles.',
    comfort: 'Vous faites ce qu’il faut. Continuons, une étape à la fois.',
    found: 'La personne a été retrouvée. Merci à tous. Vous pouvez arrêter de chercher.',
    emergency: 'Appelez le {number} maintenant.',
    seenAt: 'vue à {place}', ago: 'il y a {minutes} min', heading: 'vers {direction}', minutesValue: '{minutes} minutes',
    flagWater: "Regardez depuis la berge ou le chemin. N'entrez pas dans l'eau.",
    flagVehicle: 'Une observation en voiture va à la police. La carte est pour la marche.',
    routeWater: "Il y a de l'eau dans cette zone : restez sur les chemins.",
  },
  zh: {
    ask: {
      lastSeen: '最后在哪里见到他们？说一个地址或地点，或点一下地图。',
      minutes: '大约多久以前？',
      travel: '他们有可能开车或坐公交吗？',
      houseChecked: '您检查过屋里、车库、车里和院子了吗？',
      direction: '您知道他们往哪个方向走了吗？门铃摄像头常常能看到。',
      mobility: '他们走路怎么样？',
      familiar: '有没有他们可能想去的地方：以前的家、单位、教堂？',
      description: '他们穿着什么？上衣颜色最重要。',
      confirmPlace: '您是说{place}吗？',
    },
    confirmCase: '我记下的是：{summary}。点任何一项都可以修改。',
    confirmChange: '已改为{value}。',
    confirmClue: '这会把大约{pct}%的可能性移向{place}。要加上吗？',
    abstainFields: '我不确定：{fields}。请检查一下。',
    abstainNone: '我不确定。请您自己检查一下。',
    route: '您的区域：{streets}。大约{distance}，{minutes}分钟。',
    routePros: '这个区域需要专业人员，不适合志愿者。',
    comfort: '您做得对。我们一步一步来。',
    found: '人已经找到了。谢谢大家。请停止搜索。',
    emergency: '请立即拨打{number}。',
    seenAt: '在{place}见到', ago: '{minutes}分钟前', heading: '往{direction}', minutesValue: '{minutes}分钟',
    flagWater: '请在岸边或小路上查看。不要下水。',
    flagVehicle: '车辆线索请交给警察。地图是为步行准备的。',
    routeWater: '这个区域有水：请留在小路上。',
  },
  ja: {
    ask: {
      lastSeen: '最後に見かけたのはどこですか？住所か場所を言うか、地図をタップしてください。',
      minutes: 'どのくらい前ですか？',
      travel: '車やバスで移動した可能性はありますか？',
      houseChecked: '家の中、車庫、車、庭は確認しましたか？',
      direction: 'どちらへ行ったか分かりますか？玄関カメラに映っていることがよくあります。',
      mobility: 'どのように歩きますか？',
      familiar: '行こうとしそうな場所はありますか：昔の家、職場、教会など？',
      description: '何を着ていますか？上着の色が一番大事です。',
      confirmPlace: '{place}のことですか？',
    },
    confirmCase: '今の内容：{summary}。タップすると変更できます。',
    confirmChange: '{value}に変更しました。',
    confirmClue: 'これで可能性の約{pct}%が{place}の方へ移ります。追加しますか？',
    abstainFields: '{fields}について確かではありません。確認してください。',
    abstainNone: '確かではありません。ご自身で確認してください。',
    route: 'あなたの区域：{streets}。約{distance}、{minutes}分。',
    routePros: 'この区域は専門家向けです。ボランティアは入らないでください。',
    comfort: '正しいことをしています。一歩ずつ進みましょう。',
    found: '見つかりました。皆さん、ありがとうございます。捜索を終えてください。',
    emergency: '今すぐ{number}に電話してください。',
    seenAt: '{place}で目撃', ago: '{minutes}分前', heading: '{direction}へ', minutesValue: '{minutes}分',
    flagWater: '岸か小道から確認してください。水には入らないでください。',
    flagVehicle: '車での目撃は警察へ。地図は徒歩のためのものです。',
    routeWater: 'この区域には水辺があります。小道を歩いてください。',
  },
};

// ---- Cleaning the request: only known fields, short values, nothing that breaks the rules -------------

const short = (v, max = 80) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// A text from `data` is only used if it has no advice, promise, medical or "where they are" words
// and no link (so a "place name" can't smuggle in "he's in the creek, go in"). Place names may of
// course contain "Lake" or "Street": the water / road / property rules are for the reply itself.
const DATA_RULES = ['medical', 'whereTheyAre', 'promise', 'self'];
function cleanText(v, max = 80) {
  const s = short(v, max);
  return s && !bannedReason(s, { only: DATA_RULES }) && !/https?:|www\.|[<>{}`*#@]|\b(go|enter|wade|swim|cross|climb)\b/i.test(s) ? s : '';
}

// The facts a reply may use, per intent. Unknown fields are dropped. Returns null for a bad intent.
export function cleanSayData(intent, data) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const number = /^\d{2,6}$/.test(String(d.number || '')) ? String(d.number) : '911';
  switch (intent) {
    case 'ask': {
      const field = ASK_FIELDS.includes(d.field) ? d.field : null;
      if (!field) return null;
      const place = cleanText(d.place);
      if (field === 'confirmPlace' && !place) return null;
      return { field, place };
    }
    case 'confirm': {
      if (d.kind === 'clue') {
        const place = cleanText(d.place);
        const pct = num(d.pct, 1, 100);
        return place && pct !== null ? { kind: 'clue', place, pct: Math.round(pct) } : null;
      }
      if (d.kind === 'change') {
        const minutes = num(d.minutes, 0, 1440);
        return minutes !== null ? { kind: 'change', minutes: Math.round(minutes) } : null;
      }
      return {
        kind: 'case',
        place: cleanText(d.place),
        minutes: num(d.minutes, 0, 1440) === null ? null : Math.round(d.minutes),
        travel: ['walking', 'car', 'bus', 'unknown'].includes(d.travel) ? d.travel : null,
        mobility: ['normal', 'slow', 'walker'].includes(d.mobility) ? d.mobility : null,
        direction: DIRS.includes(d.direction) ? d.direction : null,
        description: cleanText(d.description, 60),
      };
    }
    case 'abstain':
      return {
        fields: (Array.isArray(d.fields) ? d.fields : []).filter((f) => Object.keys(FIELD_NAMES.en).includes(f)).slice(0, 5),
        flags: (Array.isArray(d.flags) ? d.flags : []).filter((f) => ['water', 'vehicle'].includes(f)),
      };
    case 'readRoute': {
      const streets = (Array.isArray(d.streets) ? d.streets : []).map((s) => cleanText(s)).filter(Boolean).slice(0, 4);
      return {
        streets,
        lengthM: num(d.lengthM, 0, 50000),
        minutes: num(d.minutes, 0, 600) === null ? null : Math.round(d.minutes),
        units: d.units === 'imperial' ? 'imperial' : 'metric',
        professionalsOnly: d.professionalsOnly === true || streets.length === 0,
        hazard: d.hazard === true,
      };
    }
    case 'comfort': return {};
    case 'found': return {};
    case 'emergency': return { number };
    default: return null;
  }
}

// ---- Filling a template ---------------------------------------------------------------------------------

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined || v[k] === null ? '' : String(v[k])));

function distanceText(lengthM, units, lang) {
  if (lengthM === null) return null;
  const dec = (x) => String(x).replace('.', DECIMAL[lang]);
  if (units === 'imperial') {
    const mi = Math.round((lengthM / 1609.34) * 10) / 10;
    return mi >= 0.1 ? `${dec(mi)} mi` : `${Math.round(lengthM * 3.28084 / 10) * 10} ft`;
  }
  if (lengthM < 1000) return `${Math.round(lengthM / 10) * 10} m`;
  return `${dec(Math.round(lengthM / 100) / 10)} km`;
}

// The display values for an intent: used by the template, given to the LLM, and the ONLY numbers,
// places and directions a generated reply may contain.
export function replyFacts(intent, data, lang) {
  const t = T[lang];
  switch (intent) {
    case 'ask': return { question: t.ask[data.field], place: data.place || null };
    case 'confirm':
      if (data.kind === 'clue') return { place: data.place, pct: data.pct };
      if (data.kind === 'change') return { value: fill(t.minutesValue, { minutes: data.minutes }), minutes: data.minutes };
      return {
        place: data.place || null, minutes: data.minutes, direction: data.direction,
        travel: data.travel ? TRAVEL_NAMES[lang][data.travel] : null,
        mobility: data.mobility ? MOBILITY_NAMES[lang][data.mobility] : null,
        description: data.description || null,
      };
    case 'abstain': return { fields: data.fields.map((f) => FIELD_NAMES[lang][f]) };
    case 'readRoute': return {
      streets: data.streets, distance: distanceText(data.lengthM, data.units, lang), minutes: data.minutes,
      professionalsOnly: data.professionalsOnly,
    };
    case 'emergency': return { number: data.number };
    default: return {};
  }
}

// The fixed sentence for an intent (always valid; used whenever a generated reply can't be).
export function templateReply(intent, data, lang = 'en') {
  const L = LANGS.includes(lang) ? lang : 'en';
  const t = T[L];
  const f = replyFacts(intent, data, L);
  switch (intent) {
    case 'ask': return data.field === 'confirmPlace' ? fill(t.ask.confirmPlace, { place: data.place }) : t.ask[data.field];
    case 'confirm': {
      if (data.kind === 'clue') return fill(t.confirmClue, f);
      if (data.kind === 'change') return fill(t.confirmChange, f);
      const parts = [];
      if (f.place) parts.push(fill(t.seenAt, f));
      if (f.minutes !== null && f.minutes !== undefined) parts.push(fill(t.ago, f));
      if (f.travel) parts.push(f.travel);
      if (f.mobility) parts.push(f.mobility);
      if (f.direction) parts.push(fill(t.heading, { direction: DIRECTION_NAMES[L][f.direction] }));
      if (f.description) parts.push(f.description);
      return fill(t.confirmCase, { summary: parts.join(' · ') || '—' });
    }
    case 'abstain': return f.fields.length ? fill(t.abstainFields, { fields: f.fields.join(LIST_JOIN[L]) }) : t.abstainNone;
    case 'readRoute': {
      if (f.professionalsOnly) return t.routePros;
      return fill(t.route, { streets: f.streets.join(LIST_JOIN[L]), distance: f.distance || '—', minutes: f.minutes ?? '—' });
    }
    case 'comfort': return t.comfort;
    case 'found': return t.found;
    case 'emergency': return fill(t.emergency, f);
    default: return t.abstainNone;
  }
}

// Fixed warning sentences added after the reply (never generated, never checked against the LLM rules).
export function warningLines(intent, data, lang = 'en') {
  const t = T[LANGS.includes(lang) ? lang : 'en'];
  const out = [];
  if (intent === 'abstain') {
    if (data.flags.includes('water')) out.push(t.flagWater);
    if (data.flags.includes('vehicle')) out.push(t.flagVehicle);
  }
  if (intent === 'readRoute' && data.hazard && !data.professionalsOnly) out.push(t.routeWater);
  return out;
}

// ---- The checker ------------------------------------------------------------------------------------------

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
const CJK = /[぀-ヿ㐀-鿿]/;
const KANA = /[぀-ヿ]/;

// Content no reply may have, in 5 languages. `allowProperty` lets the "house, garage, yard" question
// talk about the person's own home.
const BANNED = {
  medical: [
    /\b(medic\w*|medication|pills?|dose|dosage|insulin|cpr|first aid|chest compressions?|recovery position|blood sugar|diagnos\w*|seizure|stroke|heart attack|hypotherm\w*|dehydrat\w*|give (him|her|them) (water|food|sugar|juice))\b/,
    /\b(medicament\w*|medicina|pastilla\w*|dosis|insulina|rcp|primeros auxilios|azucar|deshidrat\w*|hipoterm\w*|convulsion\w*|infarto)\b/,
    /\b(medicament\w*|pilule\w*|insuline|rcr|premiers secours|massage cardiaque|deshydrat\w*|hypotherm\w*|convulsion\w*|avc)\b/,
    /(药|剂量|胰岛素|心肺复苏|急救|血糖|脱水|失温|中风|抽搐)/,
    /(薬|服用|インスリン|心肺蘇生|応急処置|血糖|脱水|低体温|脳卒中|けいれん)/,
  ],
  whereTheyAre: [
    /\b(he|she|they|your (mom|mother|dad|father|grandpa|grandma|husband|wife|loved one)|the (person|missing person))('s| is| are|'re| will be| must be| should be| might be| may be| could be| is probably| is likely| is most likely| is still)\s+(at|in|on|near|by|inside|around|there|probably|likely|safe|ok|okay|fine)\b/,
    /\b(most likely|probably|likely) (at|in|near|by|there)\b|\b(they|he|she) (went|walked|headed) to\b/,
    /\b(el|ella|su (mama|papa|madre|padre|abuel[oa]))\s+(esta|estara|debe estar|podria estar|seguramente esta|probablemente esta)\b|\b(probablemente|seguramente) (esta|este) en\b/,
    /\b(il|elle)\s+(est|sera|doit etre|pourrait etre|se trouve)\s+(a|au|dans|pres|sur|la|la-bas|ici|probablement|surement|sans doute|en securite)\b|\bse trouve (a|au|dans|pres)\b/,
    /((他|她|他们|您的(父亲|母亲|家人))(一定|应该|可能|大概|肯定)?(就)?在)/,
    /((は|が)[^。！？]{0,12}(にいます|にいる|にいるはず|にいるでしょう|にいると思))/,
  ],
  // Water bodies, roads and traffic, and other people's property: a generated reply never talks
  // about them (the fixed warning lines do). Place names from `data` are taken out first.
  water: [
    /\b(water|creek|lake|river|lagoon|pond|channel|canal|stream|ditch|shore|bank|wade|swim\w*)\b/,
    /\b(agua|arroyo|lago|rio|laguna|estanque|canal|orilla|nadar)\b/,
    /\b(eau|ruisseau|lac|riviere|lagune|etang|canal|berge|rive|nager)\b/,
    /(水|河|湖|溪|池|渠|塘|岸)/,
    /(水|川|湖|池|沼|岸)/,
  ],
  road: [
    /\b(road|highway|freeway|traffic|intersection|crosswalk|rail(road|way)?|tracks)\b/,
    /\b(carretera|autopista|trafico|vias del tren)\b/,
    /\b(autoroute|circulation|voie ferree|rails)\b/,
    /(马路|公路|高速|车流|铁轨|横穿)/,
    /(道路|車道|高速|線路|横断)/,
  ],
  property: [
    /\b(yards?|backyards?|garages?|property|properties|fences?|trespass\w*|someone'?s (house|home)|private|neighbou?rs?'?s?|other people'?s)\b/,
    /\b(patios?|garajes?|propiedad\w*|cercas?|privad[oa]s?|vecin[oa]s?)\b/,
    /\b(jardins?|garages?|propriete\w*|clotures?|prive\w*|voisin\w*)\b/,
    /(院子|车库|私人|私宅|围栏|邻居)/,
    /(庭|車庫|私有地|敷地|フェンス|隣の家|近所の家|隣人)/,
  ],
  promise: [
    /\b(will (be )?find|we'?ll find|will be found|will (be|turn out) (ok|okay|fine|safe|all right)|promise\w*|guarantee\w*|for sure|definitely|certainly|i'?m sure|no doubt|don'?t worry|nothing to worry|everything will|bound to|surely)\b/,
    /\b(lo encontraremos|la encontraremos|lo vamos a encontrar|la vamos a encontrar|aparecera|estara bien|prometo|garantiz\w*|seguro que|sin duda|no se preocupe|todo saldra bien|todo va a estar bien)\b/,
    /(nous (le|la) (re)?trouverons|on va (le|la) (re)?trouver|(il|elle) va bien|ira bien|je (vous )?promets|garanti\w*|c'est sur|sans aucun doute|ne vous inquietez pas)/,
    /(一定会找到|肯定会找到|会找到的|保证|放心|没事的|一定没事|肯定没事|不用担心|别担心)/,
    /(必ず|きっと|見つかります|約束|保証|大丈夫|心配(しないで|いりません|ない))/,
  ],
  self: [/\b(chatbot|chat bot|language model)\b/, /(聊天机器人|机器人|人工智能|チャットボット|ロボット)/],
};

// The reason a text breaks the content rules, or null. Words the fixed template itself uses
// (`allowedText`, e.g. "garage" in the house question) don't count.
export function bannedReason(text, { allowProperty = false, allowedText = '', only = null } = {}) {
  const t = norm(text);
  const okText = norm(allowedText);
  for (const [rule, patterns] of Object.entries(BANNED)) {
    if (only && !only.includes(rule)) continue;
    if (rule === 'property' && allowProperty) continue;
    if (patterns.some((re) => hits(re, t, okText))) return rule;
  }
  return null;
}

// true if `re` matches somewhere in `t` with a word that `okText` doesn't also contain.
function hits(re, t, okText = '') {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of t.matchAll(g)) if (!okText || !okText.includes(m[0])) return true;
  return false;
}

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100, half: 0.5,
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, media: 0.5,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, demi: 0.5, 'demi-heure': 30,
};
const CJK_NUMERALS = /[一二两三四五六七八九十百半]+/g;
const UNIT_AFTER = /^\s*(minutes?|mins?|hours?|hrs?|km|kilomet\w*|miles?|mi|meters?|metres?|m\b|feet|ft|percent|%|minutos?|horas?|kilometros?|millas?|metros?|pies|por ciento|heures?|kilometres?|milles?|pour cent|分钟|分|小时|小時|時間|公里|キロ|米|メートル|英里|マイル|英尺|フィート)/;

// Every number in a text (digits, and number words or Chinese/Japanese numerals followed by a unit).
export function numbersIn(text) {
  const t = norm(text);
  const out = [];
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) out.push(Number(m[0].replace(',', '.')));
  for (const m of t.matchAll(/[a-z-]+/g)) if (NUMBER_WORDS[m[0]] !== undefined && UNIT_AFTER.test(t.slice(m.index + m[0].length))) out.push(NUMBER_WORDS[m[0]]);
  for (const m of t.matchAll(CJK_NUMERALS)) if (UNIT_AFTER.test(t.slice(m.index + m[0].length)) || /^[分]/.test(t.slice(m.index + m[0].length))) out.push(m[0]);
  return out;
}

// Compass words → compass points, per language (French "sur" is "on" and "est" is "is"; Spanish
// "este" is "this": only "al este", "l'est" count). Turns are phrases ("turn right", "a la
// izquierda"), so "the right things" is not a direction.
const COMPASS = {
  en: [[/\bnorth[- ]?east\w*/g, 'NE'], [/\bnorth[- ]?west\w*/g, 'NW'], [/\bsouth[- ]?east\w*/g, 'SE'], [/\bsouth[- ]?west\w*/g, 'SW'],
    [/\bnorth\w*/g, 'N'], [/\bsouth\w*/g, 'S'], [/\beast\w*/g, 'E'], [/\bwest\w*/g, 'W'],
    [/\b(turn|go|bear|keep|stay) (left|right)\b|\b(to|on) (the|your) (left|right)\b|\b(left|right) (on|at|onto|into)\b/g, 'TURN']],
  es: [[/\bnoreste\b|\bnordeste\b/g, 'NE'], [/\bnoroeste\b/g, 'NW'], [/\bsureste\b|\bsudeste\b/g, 'SE'], [/\bsuroeste\b|\bsudoeste\b/g, 'SW'],
    [/\bnorte\b/g, 'N'], [/\b(al|el|hacia el|del) sur\b/g, 'S'], [/\b(al|el|hacia el|del) este\b/g, 'E'], [/\boeste\b/g, 'W'],
    [/\b(a la|hacia la) (izquierda|derecha)\b|\bgire\b|\bdoble\b/g, 'TURN']],
  fr: [[/\bnord-est\b/g, 'NE'], [/\bnord-ouest\b/g, 'NW'], [/\bsud-est\b/g, 'SE'], [/\bsud-ouest\b/g, 'SW'],
    [/\bnord\b/g, 'N'], [/\bsud\b/g, 'S'], [/\b(l'|a l'|vers l'|de l')est\b/g, 'E'], [/\bouest\b/g, 'W'],
    [/\b(a|vers la) (gauche|droite)\b|\btournez\b/g, 'TURN']],
  zh: [[/东北/g, 'NE'], [/西北/g, 'NW'], [/东南/g, 'SE'], [/西南/g, 'SW'], [/北/g, 'N'], [/南/g, 'S'], [/东/g, 'E'], [/西/g, 'W'],
    [/(左转|右转|向左|向右|往左|往右|左边|右边|左拐|右拐)/g, 'TURN']],
  ja: [[/北東/g, 'NE'], [/北西/g, 'NW'], [/南東/g, 'SE'], [/南西/g, 'SW'], [/北/g, 'N'], [/南/g, 'S'], [/東/g, 'E'], [/西/g, 'W'],
    [/(左へ|右へ|左に|右に|左折|右折|左側|右側)/g, 'TURN']],
};
export function directionsIn(text, lang = 'en') {
  let t = norm(text).replace(/东西/g, ' '); // 东西 = "things"
  const out = [];
  for (const [re, code] of COMPASS[LANGS.includes(lang) ? lang : 'en']) {
    if (t.match(re)) out.push(code);
    t = t.replace(re, ' ');
  }
  return out;
}

// Common words of en / es / fr, for telling a short reply's language (no one-letter words, which
// the languages share). A reply fails if another language clearly has more of them.
const LANG_WORDS = {
  en: ['you', 'are', 'the', 'is', 'and', 'to', 'of', 'in', 'it', 'that', 'we', 'your', 'this', 'be', 'for', 'on', 'with', 'at', 'keep', 'going', 'doing', 'please', 'let', 'us', 'can', 'will', 'have', 'not', 'do', 'did', 'was', 'they', 'what', 'where', 'how', 'about', 'right', 'here', 'there', 'now', 'well', 'great', 'thank', 'check'],
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'en', 'un', 'una', 'es', 'esta', 'por', 'para', 'con', 'su', 'lo', 'no', 'se', 'del', 'al', 'usted', 'sigamos', 'gracias', 'muy', 'bien', 'haciendo', 'como', 'donde', 'cuando', 'zona', 'unos', 'revise', 'favor', 'esto', 'hace', 'hacia', 'quiso', 'decir', 'juntos'],
  fr: ['le', 'la', 'les', 'de', 'des', 'et', 'en', 'un', 'une', 'est', 'vous', 'nous', 'pour', 'avec', 'que', 'qui', 'pas', 'ne', 'ce', 'il', 'elle', 'merci', 'votre', 'faites', 'continuons', 'bien', 'tres', 'environ', 'zone', 'ici', 'dans', 'sur', 'du', 'au', 'ensemble', 'cela', 'voulez', 'dire', 'merci'],
};
function languageScores(text) {
  const words = norm(text).split(/[^a-z']+/).flatMap((w) => w.split("'")).filter((w) => w.length > 1);
  return Object.fromEntries(Object.entries(LANG_WORDS).map(([lang, list]) => [lang, words.filter((w) => list.includes(w)).length]));
}

// Checks a generated reply → { ok: true } or { ok: false, why }. `facts` = replyFacts(...).
export function checkReply(text, { intent, data, lang }) {
  if (typeof text !== 'string') return { ok: false, why: 'not_text' };
  const reply = text.trim();
  if (!reply) return { ok: false, why: 'empty' };
  if (/[\r\n]/.test(reply)) return { ok: false, why: 'more_than_one_line' };
  if (/https?:|www\.|[<>{}`*#@\[\]|_~]/i.test(reply)) return { ok: false, why: 'markup_or_link' };
  const cjk = lang === 'zh' || lang === 'ja';
  const facts = replyFacts(intent, data, lang);
  const names = [facts.place, ...(facts.streets || []), facts.description].filter(Boolean).sort((a, b) => b.length - a.length);
  // Length and sentences are counted with each allowed name as one character, and "1.2" as a number.
  let shape = reply;
  for (const name of names) shape = shape.split(name).join('•');
  if (shape.length > (cjk ? MAX_REPLY_CHARS.cjk : MAX_REPLY_CHARS.latin)) return { ok: false, why: 'too_long' };
  const sentences = shape.replace(/(\d)[.,](\d)/g, '$1$2').split(/[.!?。！？]+/).filter((x) => x.trim()).length;
  if (sentences > MAX_SENTENCES) return { ok: false, why: 'too_many_sentences' };

  // Language: the right script, and for en / es / fr no clear majority of another language's words.
  if (lang === 'ja' && !KANA.test(shape)) return { ok: false, why: 'wrong_language' };
  if (lang === 'zh' && (KANA.test(shape) || !CJK.test(shape))) return { ok: false, why: 'wrong_language' };
  if (!cjk && CJK.test(shape)) return { ok: false, why: 'wrong_language' };
  if (!cjk) {
    const scores = languageScores(shape);
    if (['en', 'es', 'fr'].some((other) => other !== lang && scores[other] >= 2 && scores[other] > scores[lang])) return { ok: false, why: 'wrong_language' };
  }

  // Take out the place names (and the description) the facts allow; what's left must name nothing new.
  let rest = norm(reply);
  for (const name of names.map(norm)) rest = rest.split(name).join(' ');

  // Content rules (words the fixed template itself uses are fine: it says the same thing).
  const template = templateReply(intent, data, lang);
  const why = bannedReason(rest, { allowedText: template });
  if (why) return { ok: false, why: `banned_${why}` };

  // Numbers: each one must be a number of the facts.
  const allowedNumbers = new Set();
  const addNumbers = (v) => {
    if (typeof v === 'number') allowedNumbers.add(v);
    else if (typeof v === 'string') for (const n of numbersIn(v)) allowedNumbers.add(n);
  };
  for (const v of Object.values(facts)) (Array.isArray(v) ? v : [v]).forEach(addNumbers);
  for (const n of numbersIn(rest)) if (!allowedNumbers.has(n)) return { ok: false, why: 'invented_number' };

  // Directions: only the case's own direction, and no turns.
  const allowedDir = facts.direction ? [facts.direction] : [];
  for (const d of directionsIn(rest, lang)) if (!allowedDir.includes(d)) return { ok: false, why: 'invented_direction' };

  // Places: no place word left after the allowed names (unless the template uses it), and in
  // en / es / fr no other capitalized name inside a sentence.
  const templateNorm = norm(template);
  if (PLACE_WORD.some((re) => hits(re, rest, templateNorm))) return { ok: false, why: 'invented_place' };
  if (!cjk) {
    let original = reply;
    for (const name of [facts.place, ...(facts.streets || []), facts.description].filter(Boolean)) original = original.split(name).join(' ');
    const templateWords = new Set(template.split(/[^A-Za-zÀ-ÿ']+/));
    const capitalized = original.split(/(?<=[.!?])\s+/).flatMap((sentence) => sentence.replace(/^[\s¿¡"'«]+/, '').split(/\s+/).slice(1))
      .map((w) => w.replace(/[^A-Za-zÀ-ÿ']/g, ''))
      .filter((w) => /^[A-ZÀ-Ý][a-zà-ÿ]/.test(w) && !NAME_ALLOW.has(w) && !templateWords.has(w));
    if (capitalized.length) return { ok: false, why: 'invented_place' };
  }
  return { ok: true };
}

const PLACE_WORD = [
  /\b(street|st|avenue|ave|boulevard|blvd|drive|dr|lane|ln|road|rd|way|parkway|pkwy|court|place|square|plaza|park|school|library|station|church|mall|store|shop|market|center|centre|bridge|trail|hospital|museum|stadium|campus|hotel|restaurant|cafe|bar)\b/,
  /\b(calle|avenida|bulevar|camino|parque|plaza|escuela|biblioteca|estacion|iglesia|tienda|mercado|centro|puente|sendero|hospital|museo)\b/,
  /\b(rue|avenue|boulevard|chemin|parc|place|ecole|bibliotheque|gare|eglise|magasin|marche|centre|pont|sentier|hopital|musee)\b/,
  /(街|路|道|公园|广场|学校|图书馆|站|教堂|商店|市场|中心|桥|医院|博物馆)/,
  /(通り|公園|広場|学校|図書館|駅|教会|店|市場|センター|橋|病院|博物館|町|丁目)/,
];
// Capitalized words that are not names.
const NAME_ALLOW = new Set(['I', 'OK', 'Ok', 'Please', 'Por', 'Gracias', 'Merci', 'Start', 'Add', 'Edit', 'Discard', 'Yes', 'No', 'Sí', 'Oui', 'Non']);

// ---- The phone's side: get a reply ------------------------------------------------------------------------

export const SAY_TIMEOUT_MS = 2500; // a slow reply is worse than the template

// The reply to show (and maybe speak): { text, source: 'llm' | 'template', warnings: [...] }.
// Never throws; any problem gives the fixed template. Pass proxyUrl '' to stay offline.
export async function getReply(intent, rawData, lang = 'en', { proxyUrl = '', fetchFn = globalThis.fetch } = {}) {
  const L = LANGS.includes(lang) ? lang : 'en';
  const data = INTENTS.includes(intent) ? cleanSayData(intent, rawData) : null;
  if (!data) return { text: templateReply('abstain', { fields: [], flags: [] }, L), source: 'template', warnings: [] };
  const template = { text: templateReply(intent, data, L), source: 'template', warnings: warningLines(intent, data, L) };
  if (FIXED_INTENTS.includes(intent) || !proxyUrl || typeof fetchFn !== 'function') return template;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return template;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), SAY_TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(`${proxyUrl.replace(/\/$/, '')}/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent, data: rawData, lang: L }),
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) return template;
    const body = await res.json();
    // The phone checks again: a broken or tampered proxy can't put anything on screen.
    if (body && body.source === 'llm' && checkReply(body.text, { intent, data, lang: L }).ok) {
      return { text: body.text.trim(), source: 'llm', warnings: template.warnings };
    }
    return template;
  } catch (err) {
    return template;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
