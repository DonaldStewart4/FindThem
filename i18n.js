// i18n.js — every piece of text the user sees, in 5 languages, plus
// emergency numbers, units (miles or km) and distance formatting.
//
// How to use it:
//   t('run')                         → "Run search prediction" (in the current language)
//   t('usingSaved', { date: '...' }) → fills in {date}
//   In index.html, an element with data-i18n="run" gets its text filled in by applyTranslations().
//
// Adding a string: add the key to ALL FIVE languages below. If a language is missing a
// key, English is shown instead (and a warning appears in the console).
// The translations were written by an AI and still need a check by native speakers.

export const LANGUAGES = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  zh: '中文',
  ja: '日本語',
};

const STRINGS = {
  en: {
    callFirst: 'CALL {number} FIRST',
    lastSeenTitle: 'Where were they last seen?',
    setLastSeen: 'Set last-seen point',
    tapLastSeen: 'Tap the map where they were last seen',
    lastSeenSet: 'Last-seen point set. Tap "Set last-seen point" to move it.',
    minutesLabel: 'Minutes since last seen',
    directionLabel: 'Direction they were heading',
    dirUnknown: 'Unknown',
    dir_N: 'North', dir_NE: 'Northeast', dir_E: 'East', dir_SE: 'Southeast',
    dir_S: 'South', dir_SW: 'Southwest', dir_W: 'West', dir_NW: 'Northwest',
    mobilityLabel: 'How do they walk?',
    mob_normal: 'Normal pace',
    mob_slow: 'Slowly',
    mob_walker: 'Walker or cane',
    familiarLabel: 'Familiar places (up to 3)',
    familiarHint: 'Old home, old job, church, a favorite store…',
    addFamiliar: 'Add a familiar place',
    tapFamiliar: 'Tap the map on a familiar place',
    familiarName: 'Name of this place',
    familiarDefault: 'Familiar place {n}',
    remove: 'Remove',
    maxFamiliar: 'You can add up to 3 familiar places.',
    run: 'Run search prediction',
    demo: 'Demo',
    loadingData: 'Loading streets and creeks… busy map servers can take up to a minute.',
    calculating: 'Working out where they may be…',
    usingSaved: 'Using map data saved on {date}.',
    needLastSeen: 'First tap the map where they were last seen.',
    needMinutes: 'Enter how many minutes ago they were last seen.',
    dataError: "Couldn't load map data. Check your signal and try again.",
    checkFirst: 'Check these first',
    showMore: 'Show {n} more',
    showLess: 'Show fewer',
    guideNote: 'This is a guide to help focus the search, not a guarantee.',
    fakeEngine: "Practice results: the real prediction engine isn't connected yet.",
    spotTrapStreet: '{trap} {dist} off {street}',
    spotStreet: 'Near {street}',
    spotUnnamed: 'Spot with no street name',
    spotShare: '{pct} of walkers',
    hazard: 'Water: leave this to professionals',
    trap_creek: 'Creek', trap_river: 'River', trap_water: 'Pond or lake', trap_wetland: 'Wetland',
    trap_woods: 'Woods', trap_brush: 'Brush', trap_grass: 'Open grass', trap_park: 'Park',
    language: 'Language',
    units: 'Units',
    hidePanel: 'Hide panel',
    showPanel: 'Show panel',
    lastSeenMarker: 'Last seen here',
  },

  es: {
    callFirst: 'LLAME PRIMERO AL {number}',
    lastSeenTitle: '¿Dónde se le vio por última vez?',
    setLastSeen: 'Marcar último lugar visto',
    tapLastSeen: 'Toque el mapa donde se le vio por última vez',
    lastSeenSet: 'Punto marcado. Toque "Marcar último lugar visto" para moverlo.',
    minutesLabel: 'Minutos desde que se le vio',
    directionLabel: 'Dirección en la que iba',
    dirUnknown: 'No se sabe',
    dir_N: 'Norte', dir_NE: 'Noreste', dir_E: 'Este', dir_SE: 'Sureste',
    dir_S: 'Sur', dir_SW: 'Suroeste', dir_W: 'Oeste', dir_NW: 'Noroeste',
    mobilityLabel: '¿Cómo camina?',
    mob_normal: 'Ritmo normal',
    mob_slow: 'Despacio',
    mob_walker: 'Con andadera o bastón',
    familiarLabel: 'Lugares conocidos (hasta 3)',
    familiarHint: 'Casa anterior, antiguo trabajo, iglesia, una tienda favorita…',
    addFamiliar: 'Añadir lugar conocido',
    tapFamiliar: 'Toque el mapa en un lugar conocido',
    familiarName: 'Nombre del lugar',
    familiarDefault: 'Lugar conocido {n}',
    remove: 'Quitar',
    maxFamiliar: 'Puede añadir hasta 3 lugares conocidos.',
    run: 'Calcular dónde buscar',
    demo: 'Demostración',
    loadingData: 'Cargando calles y arroyos… si los servidores están ocupados puede tardar un minuto.',
    calculating: 'Calculando dónde puede estar…',
    usingSaved: 'Usando datos del mapa guardados el {date}.',
    needLastSeen: 'Primero toque el mapa donde se le vio por última vez.',
    needMinutes: 'Escriba hace cuántos minutos se le vio por última vez.',
    dataError: 'No se pudieron cargar los datos del mapa. Revise su señal e inténtelo de nuevo.',
    checkFirst: 'Revise primero aquí',
    showMore: 'Mostrar {n} más',
    showLess: 'Mostrar menos',
    guideNote: 'Esto es una guía para enfocar la búsqueda, no una garantía.',
    fakeEngine: 'Resultados de práctica: el motor de predicción real aún no está conectado.',
    spotTrapStreet: '{trap} a {dist} de {street}',
    spotStreet: 'Cerca de {street}',
    spotUnnamed: 'Lugar sin nombre de calle',
    spotShare: '{pct} de los caminantes',
    hazard: 'Agua: déjelo a los profesionales',
    trap_creek: 'Arroyo', trap_river: 'Río', trap_water: 'Estanque o lago', trap_wetland: 'Humedal',
    trap_woods: 'Bosque', trap_brush: 'Matorral', trap_grass: 'Pasto abierto', trap_park: 'Parque',
    language: 'Idioma',
    units: 'Unidades',
    hidePanel: 'Ocultar panel',
    showPanel: 'Mostrar panel',
    lastSeenMarker: 'Visto aquí por última vez',
  },

  fr: {
    callFirst: "APPELEZ D'ABORD LE {number}",
    lastSeenTitle: 'Où la personne a-t-elle été vue pour la dernière fois ?',
    setLastSeen: 'Placer le dernier lieu vu',
    tapLastSeen: 'Touchez la carte là où la personne a été vue pour la dernière fois',
    lastSeenSet: 'Point placé. Touchez « Placer le dernier lieu vu » pour le déplacer.',
    minutesLabel: 'Minutes depuis la dernière fois vue',
    directionLabel: 'Direction prise',
    dirUnknown: 'Inconnue',
    dir_N: 'Nord', dir_NE: 'Nord-est', dir_E: 'Est', dir_SE: 'Sud-est',
    dir_S: 'Sud', dir_SW: 'Sud-ouest', dir_W: 'Ouest', dir_NW: 'Nord-ouest',
    mobilityLabel: 'Comment marche-t-elle ?',
    mob_normal: 'Allure normale',
    mob_slow: 'Lentement',
    mob_walker: 'Déambulateur ou canne',
    familiarLabel: "Lieux familiers (jusqu'à 3)",
    familiarHint: 'Ancien domicile, ancien travail, église, un magasin préféré…',
    addFamiliar: 'Ajouter un lieu familier',
    tapFamiliar: 'Touchez la carte sur un lieu familier',
    familiarName: 'Nom de ce lieu',
    familiarDefault: 'Lieu familier {n}',
    remove: 'Retirer',
    maxFamiliar: "Vous pouvez ajouter jusqu'à 3 lieux familiers.",
    run: 'Lancer la prédiction',
    demo: 'Démo',
    loadingData: "Chargement des rues et des ruisseaux… si les serveurs sont occupés, cela peut prendre une minute.",
    calculating: 'Calcul des endroits probables…',
    usingSaved: 'Données de carte enregistrées le {date}.',
    needLastSeen: "Touchez d'abord la carte là où la personne a été vue pour la dernière fois.",
    needMinutes: 'Indiquez il y a combien de minutes la personne a été vue.',
    dataError: 'Impossible de charger la carte. Vérifiez votre réseau et réessayez.',
    checkFirst: "Vérifiez d'abord ici",
    showMore: 'Afficher {n} de plus',
    showLess: 'Afficher moins',
    guideNote: "C'est un guide pour orienter les recherches, pas une garantie.",
    fakeEngine: "Résultats d'entraînement : le vrai moteur de prédiction n'est pas encore branché.",
    spotTrapStreet: '{trap} à {dist} de {street}',
    spotStreet: 'Près de {street}',
    spotUnnamed: 'Lieu sans nom de rue',
    spotShare: '{pct} des marcheurs',
    hazard: 'Eau : à laisser aux professionnels',
    trap_creek: 'Ruisseau', trap_river: 'Rivière', trap_water: 'Étang ou lac', trap_wetland: 'Zone humide',
    trap_woods: 'Bois', trap_brush: 'Broussailles', trap_grass: 'Pelouse ouverte', trap_park: 'Parc',
    language: 'Langue',
    units: 'Unités',
    hidePanel: 'Masquer le panneau',
    showPanel: 'Afficher le panneau',
    lastSeenMarker: 'Vue ici pour la dernière fois',
  },

  zh: {
    callFirst: '请先拨打 {number}',
    lastSeenTitle: '最后一次在哪里看到他/她？',
    setLastSeen: '标记最后出现地点',
    tapLastSeen: '在地图上点一下最后看到他/她的地方',
    lastSeenSet: '已标记。点“标记最后出现地点”可以重新放置。',
    minutesLabel: '距最后一次看到已过（分钟）',
    directionLabel: '走的方向',
    dirUnknown: '不知道',
    dir_N: '北', dir_NE: '东北', dir_E: '东', dir_SE: '东南',
    dir_S: '南', dir_SW: '西南', dir_W: '西', dir_NW: '西北',
    mobilityLabel: '他/她走路怎么样？',
    mob_normal: '正常速度',
    mob_slow: '走得慢',
    mob_walker: '用助行器或拐杖',
    familiarLabel: '熟悉的地方（最多 3 个）',
    familiarHint: '以前的家、以前的单位、教堂、常去的商店…',
    addFamiliar: '添加熟悉的地方',
    tapFamiliar: '在地图上点一下熟悉的地方',
    familiarName: '这个地方的名字',
    familiarDefault: '熟悉的地方 {n}',
    remove: '删除',
    maxFamiliar: '最多可以添加 3 个熟悉的地方。',
    run: '开始预测搜索范围',
    demo: '演示',
    loadingData: '正在加载街道和溪流… 地图服务器繁忙时可能需要一分钟。',
    calculating: '正在计算他/她可能在哪里…',
    usingSaved: '正在使用 {date} 保存的地图数据。',
    needLastSeen: '请先在地图上点出最后看到他/她的地方。',
    needMinutes: '请输入最后一次看到他/她是多少分钟以前。',
    dataError: '无法加载地图数据。请检查信号后再试。',
    checkFirst: '先找这些地方',
    showMore: '再显示 {n} 个',
    showLess: '少显示一些',
    guideNote: '这只是帮助集中搜索的参考，不能保证结果。',
    fakeEngine: '练习结果：真正的预测引擎还没有接入。',
    spotTrapStreet: '{street}旁 {dist} 处的{trap}',
    spotStreet: '{street}附近',
    spotUnnamed: '没有街道名称的地点',
    spotShare: '{pct} 的模拟行人',
    hazard: '有水：请交给专业人员',
    trap_creek: '小溪', trap_river: '河', trap_water: '池塘或湖', trap_wetland: '湿地',
    trap_woods: '树林', trap_brush: '灌木丛', trap_grass: '空旷草地', trap_park: '公园',
    language: '语言',
    units: '单位',
    hidePanel: '隐藏面板',
    showPanel: '显示面板',
    lastSeenMarker: '最后在这里出现',
  },

  ja: {
    callFirst: 'まず {number} に通報してください',
    lastSeenTitle: '最後に見かけたのはどこですか？',
    setLastSeen: '最後に見た場所を指定',
    tapLastSeen: '最後に見かけた場所を地図でタップしてください',
    lastSeenSet: '指定しました。動かすには「最後に見た場所を指定」をタップ。',
    minutesLabel: '最後に見てからの時間（分）',
    directionLabel: '向かった方向',
    dirUnknown: '不明',
    dir_N: '北', dir_NE: '北東', dir_E: '東', dir_SE: '南東',
    dir_S: '南', dir_SW: '南西', dir_W: '西', dir_NW: '北西',
    mobilityLabel: '歩き方は？',
    mob_normal: '普通の速さ',
    mob_slow: 'ゆっくり',
    mob_walker: '歩行器・杖を使う',
    familiarLabel: 'なじみの場所（3か所まで）',
    familiarHint: '以前の家、以前の職場、教会、よく行く店…',
    addFamiliar: 'なじみの場所を追加',
    tapFamiliar: 'なじみの場所を地図でタップしてください',
    familiarName: 'この場所の名前',
    familiarDefault: 'なじみの場所 {n}',
    remove: '削除',
    maxFamiliar: 'なじみの場所は3か所まで追加できます。',
    run: '捜索予測を開始',
    demo: 'デモ',
    loadingData: '道路と川を読み込み中… 地図サーバーが混んでいると1分ほどかかります。',
    calculating: 'いそうな場所を計算中…',
    usingSaved: '{date} に保存した地図データを使用しています。',
    needLastSeen: 'まず最後に見かけた場所を地図でタップしてください。',
    needMinutes: '最後に見てから何分たったか入力してください。',
    dataError: '地図データを読み込めませんでした。電波を確認して、もう一度お試しください。',
    checkFirst: 'まずここを探す',
    showMore: 'あと {n} 件表示',
    showLess: '表示を減らす',
    guideNote: 'これは捜索を絞り込むための目安で、保証ではありません。',
    fakeEngine: '練習用の結果です。本物の予測エンジンはまだ接続されていません。',
    spotTrapStreet: '{street}から {dist} の{trap}',
    spotStreet: '{street}付近',
    spotUnnamed: '通り名のない場所',
    spotShare: '模擬歩行者の {pct}',
    hazard: '水辺：専門家に任せてください',
    trap_creek: '小川', trap_river: '川', trap_water: '池・湖', trap_wetland: '湿地',
    trap_woods: '林', trap_brush: 'やぶ', trap_grass: '広い草地', trap_park: '公園',
    language: '言語',
    units: '単位',
    hidePanel: 'パネルを隠す',
    showPanel: 'パネルを表示',
    lastSeenMarker: 'ここで最後に目撃',
  },
};

// ---- Language ------------------------------------------------------------------

let currentLang = 'en';

// Picks the first of the phone's languages that we support, e.g. "es-MX" → "es".
export function detectLanguage() {
  const prefs = navigator.languages || [navigator.language || 'en'];
  for (const tag of prefs) {
    const code = tag.toLowerCase().split('-')[0];
    if (STRINGS[code]) return code;
  }
  return 'en';
}

export function setLanguage(code) {
  currentLang = STRINGS[code] ? code : 'en';
  document.documentElement.lang = currentLang;
}

export function getLanguage() {
  return currentLang;
}

// Looks up a string and fills in {placeholders}.
export function t(key, vars = {}) {
  let text = STRINGS[currentLang][key];
  if (text === undefined) {
    console.warn(`Missing translation "${key}" for ${currentLang}`);
    text = STRINGS.en[key] ?? key;
  }
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`));
}

// Fills in every element marked in index.html:
//   data-i18n="key"             → the element's text
//   data-i18n-placeholder="key" → an input's placeholder
//   data-i18n-aria="key"        → the label screen readers read out
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

// ---- Region: emergency number and units ------------------------------------------

// The phone's region, e.g. "US", from settings like "en-US". Null if the phone doesn't say.
export function detectRegion() {
  const tags = [...(navigator.languages || []), navigator.language, Intl.DateTimeFormat().resolvedOptions().locale];
  for (const tag of tags) {
    const match = /[-_]([A-Za-z]{2})\b/.exec(tag || '');
    if (match) return match[1].toUpperCase();
  }
  return null;
}

// Police / emergency number to call for a missing person. Unknown regions get 911.
const EMERGENCY_NUMBERS = {
  '911': ['US', 'CA', 'MX', 'PR', 'GU', 'VI', 'PH', 'AR', 'CR', 'PA', 'SV', 'UY'],
  '112': ['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'PT', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'SK',
          'HU', 'RO', 'BG', 'GR', 'IE', 'LU', 'SI', 'HR', 'EE', 'LV', 'LT', 'IS', 'IN', 'KR', 'TR', 'UA'],
  '999': ['GB', 'HK', 'SG', 'MY', 'MO'],
  '000': ['AU'],
  '111': ['NZ'],
  '110': ['JP', 'CN', 'TW'],
  '190': ['BR'],
  '10111': ['ZA'],
};

export function emergencyNumber(region) {
  for (const [number, regions] of Object.entries(EMERGENCY_NUMBERS)) {
    if (regions.includes(region)) return number;
  }
  return '911';
}

// Only these countries use miles and feet day to day. Unknown regions use miles,
// to match the 911 default. The mi/km button can always switch.
const IMPERIAL_REGIONS = ['US', 'LR', 'MM'];

export function defaultUnits(region) {
  if (!region) return 'imperial';
  return IMPERIAL_REGIONS.includes(region) ? 'imperial' : 'metric';
}

// ---- Formatting numbers --------------------------------------------------------------

const M_PER_MILE = 1609.344;
const FT_PER_M = 3.28084;

function num(x, decimals) {
  return new Intl.NumberFormat(currentLang, { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(x);
}

// 40 → "130 ft" or "40 m";  2400 → "1.5 mi" or "2.4 km".
export function formatDistance(meters, units) {
  if (units === 'imperial') {
    if (meters < 0.1 * M_PER_MILE) return `${num(Math.round((meters * FT_PER_M) / 10) * 10, 0)} ft`;
    return `${num(meters / M_PER_MILE, 1)} mi`;
  }
  if (meters < 1000) return `${num(Math.round(meters / 10) * 10, 0)} m`;
  return `${num(meters / 1000, 1)} km`;
}

// 0.123 → "12%".
export function formatPercent(fraction) {
  return new Intl.NumberFormat(currentLang, { style: 'percent', maximumFractionDigits: 0 }).format(fraction);
}

// A short date + time in the current language.
export function formatDateTime(isoString) {
  return new Intl.DateTimeFormat(currentLang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoString));
}

// Used by tools/check-i18n: every language must have every English key.
export function missingKeys() {
  const out = {};
  for (const code of Object.keys(STRINGS)) {
    const missing = Object.keys(STRINGS.en).filter((k) => !(k in STRINGS[code]));
    if (missing.length) out[code] = missing;
  }
  return out;
}
