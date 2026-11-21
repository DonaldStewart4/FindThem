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
    // Screen B
    firstSteps: 'First steps',
    call911Title: '1. Call {number} now',
    call911Tell: 'Tell the dispatcher:',
    script_dementia: 'The person has dementia and is missing.',
    script_who: 'Their name, age and what they look like.',
    script_clothes: 'What they are wearing.',
    script_lastSeen: 'Where and when they were last seen.',
    script_medical: 'Medical needs (medicines, diabetes, heart problems).',
    script_phone: 'Your phone number. Keep your phone with you.',
    houseTitle: '2. Check the house and yard (2 minutes)',
    houseHint: 'Many people are found close to home, even inside it.',
    check_closets: 'Closets and wardrobes',
    check_beds: 'Under beds',
    check_bathrooms: 'Bathrooms and showers',
    check_garage: 'Garage, attic and basement',
    check_cars: 'Inside parked cars',
    check_yard: 'Yard, shed and bushes',
    check_neighbors: "Neighbors' yards and porches",
    nextAreasTitle: 'Next areas to search',
    nextAreasHint: 'Best areas for the next searcher, highest chance first.',
    areaLabel: 'Area {n}',
    areaChance: '{pct} chance they are here',
    routeInfo: 'Walking route: {dist}, about {min} min',
    noRoute: 'No streets here: leave this area to professionals.',
    markSearched: 'Searched, nobody found',
    minutesSpent: 'Minutes spent searching',
    searchedDone: 'Marked as searched. The map has been updated.',
    searchedMinutes: 'Searched for {min} min',
    sightingStart: 'Report a sighting',
    tapSighting: 'Tap the map where they were seen',
    sightingPlaced: 'Place set. Fill in the rest below.',
    sightingMinutes: 'How many minutes ago?',
    sightingDirection: 'Which way were they going?',
    sightingSure: 'How sure are you?',
    sure_low: 'Maybe',
    sure_mid: 'Probably',
    sure_high: 'Sure',
    sightingNote: 'Anything else (clothing, who saw them)?',
    sightingSave: 'Add sighting to the map',
    cancel: 'Cancel',
    sightingAdded: 'Sighting added. The map has been updated.',
    needSightingPlace: 'First tap the map where they were seen.',
    needRunFirst: 'Run the search prediction first.',
    sightingMarker: 'Reported sighting',
    ringLabel: '{dist} from last seen',
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
    // Screen B
    firstSteps: 'Primeros pasos',
    call911Title: '1. Llame al {number} ahora',
    call911Tell: 'Dígale a la operadora:',
    script_dementia: 'La persona tiene demencia y está desaparecida.',
    script_who: 'Su nombre, edad y cómo es físicamente.',
    script_clothes: 'Qué ropa lleva puesta.',
    script_lastSeen: 'Dónde y cuándo se le vio por última vez.',
    script_medical: 'Necesidades médicas (medicinas, diabetes, problemas del corazón).',
    script_phone: 'Su número de teléfono. Mantenga el teléfono con usted.',
    houseTitle: '2. Revise la casa y el patio (2 minutos)',
    houseHint: 'Muchas personas aparecen cerca de casa, incluso dentro.',
    check_closets: 'Clósets y armarios',
    check_beds: 'Debajo de las camas',
    check_bathrooms: 'Baños y duchas',
    check_garage: 'Garaje, ático y sótano',
    check_cars: 'Dentro de los autos estacionados',
    check_yard: 'Patio, cobertizo y arbustos',
    check_neighbors: 'Patios y porches de los vecinos',
    nextAreasTitle: 'Próximas zonas para buscar',
    nextAreasHint: 'Las mejores zonas para el siguiente buscador, de más a menos probable.',
    areaLabel: 'Zona {n}',
    areaChance: '{pct} de probabilidad de que esté aquí',
    routeInfo: 'Ruta a pie: {dist}, unos {min} min',
    noRoute: 'Aquí no hay calles: deje esta zona a los profesionales.',
    markSearched: 'Buscado, no se encontró a nadie',
    minutesSpent: 'Minutos de búsqueda',
    searchedDone: 'Marcado como buscado. El mapa se actualizó.',
    searchedMinutes: 'Buscado durante {min} min',
    sightingStart: 'Reportar un avistamiento',
    tapSighting: 'Toque el mapa donde le vieron',
    sightingPlaced: 'Lugar marcado. Complete el resto abajo.',
    sightingMinutes: '¿Hace cuántos minutos?',
    sightingDirection: '¿Hacia dónde iba?',
    sightingSure: '¿Qué tan seguro está?',
    sure_low: 'Tal vez',
    sure_mid: 'Probablemente',
    sure_high: 'Seguro',
    sightingNote: '¿Algo más (ropa, quién le vio)?',
    sightingSave: 'Añadir avistamiento al mapa',
    cancel: 'Cancelar',
    sightingAdded: 'Avistamiento añadido. El mapa se actualizó.',
    needSightingPlace: 'Primero toque el mapa donde le vieron.',
    needRunFirst: 'Primero calcule dónde buscar.',
    sightingMarker: 'Avistamiento reportado',
    ringLabel: 'a {dist} del último lugar visto',
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
    // Screen B
    firstSteps: 'Premières étapes',
    call911Title: '1. Appelez le {number} maintenant',
    call911Tell: "Dites à l'opérateur :",
    script_dementia: 'La personne est atteinte de démence et a disparu.',
    script_who: 'Son nom, son âge et son apparence.',
    script_clothes: 'Comment elle est habillée.',
    script_lastSeen: 'Où et quand elle a été vue pour la dernière fois.',
    script_medical: 'Besoins médicaux (médicaments, diabète, problèmes cardiaques).',
    script_phone: 'Votre numéro de téléphone. Gardez votre téléphone sur vous.',
    houseTitle: '2. Fouillez la maison et le jardin (2 minutes)',
    houseHint: 'Beaucoup de personnes sont retrouvées près de chez elles, parfois à l’intérieur.',
    check_closets: 'Placards et armoires',
    check_beds: 'Sous les lits',
    check_bathrooms: 'Salles de bain et douches',
    check_garage: 'Garage, grenier et sous-sol',
    check_cars: 'Dans les voitures garées',
    check_yard: 'Jardin, abri et buissons',
    check_neighbors: 'Jardins et porches des voisins',
    nextAreasTitle: 'Prochaines zones à fouiller',
    nextAreasHint: 'Les meilleures zones pour le prochain chercheur, de la plus probable à la moins probable.',
    areaLabel: 'Zone {n}',
    areaChance: '{pct} de chances qu’elle soit ici',
    routeInfo: 'Itinéraire à pied : {dist}, environ {min} min',
    noRoute: 'Pas de rues ici : laissez cette zone aux professionnels.',
    markSearched: 'Fouillée, personne trouvé',
    minutesSpent: 'Minutes de recherche',
    searchedDone: 'Marquée comme fouillée. La carte a été mise à jour.',
    searchedMinutes: 'Fouillée pendant {min} min',
    sightingStart: 'Signaler un témoignage',
    tapSighting: 'Touchez la carte là où la personne a été vue',
    sightingPlaced: 'Lieu placé. Complétez la suite ci-dessous.',
    sightingMinutes: 'Il y a combien de minutes ?',
    sightingDirection: 'Dans quelle direction allait-elle ?',
    sightingSure: 'Quelle est votre certitude ?',
    sure_low: 'Peut-être',
    sure_mid: 'Probablement',
    sure_high: 'Certain',
    sightingNote: 'Autre chose (vêtements, qui l’a vue) ?',
    sightingSave: 'Ajouter le témoignage à la carte',
    cancel: 'Annuler',
    sightingAdded: 'Témoignage ajouté. La carte a été mise à jour.',
    needSightingPlace: 'Touchez d’abord la carte là où la personne a été vue.',
    needRunFirst: 'Lancez d’abord la prédiction.',
    sightingMarker: 'Témoignage signalé',
    ringLabel: 'à {dist} du dernier lieu vu',
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
    // Screen B
    firstSteps: '第一步',
    call911Title: '1. 现在拨打 {number}',
    call911Tell: '告诉接线员：',
    script_dementia: '这个人患有失智症，现在走失了。',
    script_who: '他/她的名字、年龄和长相。',
    script_clothes: '他/她穿着什么衣服。',
    script_lastSeen: '最后一次在哪里、什么时候看到他/她。',
    script_medical: '医疗需要（药物、糖尿病、心脏问题）。',
    script_phone: '您的电话号码。手机随身带着。',
    houseTitle: '2. 检查家里和院子（2 分钟）',
    houseHint: '很多人就在家附近被找到，甚至就在家里。',
    check_closets: '壁橱和衣柜',
    check_beds: '床底下',
    check_bathrooms: '浴室和淋浴间',
    check_garage: '车库、阁楼和地下室',
    check_cars: '停着的车里',
    check_yard: '院子、棚子和灌木丛',
    check_neighbors: '邻居的院子和门廊',
    nextAreasTitle: '接下来搜索的区域',
    nextAreasHint: '最适合下一位搜索者的区域，可能性高的在前。',
    areaLabel: '区域 {n}',
    areaChance: '在这里的可能性 {pct}',
    routeInfo: '步行路线：{dist}，约 {min} 分钟',
    noRoute: '这里没有街道：请交给专业人员。',
    markSearched: '已搜索，没有找到',
    minutesSpent: '搜索了多少分钟',
    searchedDone: '已标记为搜索过。地图已更新。',
    searchedMinutes: '已搜索 {min} 分钟',
    sightingStart: '报告目击',
    tapSighting: '在地图上点一下看到他/她的地方',
    sightingPlaced: '地点已标记。请在下面填写其余信息。',
    sightingMinutes: '多少分钟以前？',
    sightingDirection: '他/她往哪个方向走？',
    sightingSure: '您有多确定？',
    sure_low: '也许',
    sure_mid: '很可能',
    sure_high: '确定',
    sightingNote: '其他信息（衣着、谁看到的）？',
    sightingSave: '把目击添加到地图',
    cancel: '取消',
    sightingAdded: '目击已添加。地图已更新。',
    needSightingPlace: '请先在地图上点出看到他/她的地方。',
    needRunFirst: '请先开始预测搜索范围。',
    sightingMarker: '报告的目击地点',
    ringLabel: '距最后出现地点 {dist}',
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
    // Screen B
    firstSteps: '最初にすること',
    call911Title: '1. 今すぐ {number} に通報',
    call911Tell: '通報先に伝えること：',
    script_dementia: '認知症の人が行方不明になっていること。',
    script_who: '名前、年齢、外見。',
    script_clothes: '服装。',
    script_lastSeen: '最後に見かけた場所と時刻。',
    script_medical: '医療上の注意（薬、糖尿病、心臓の病気など）。',
    script_phone: 'あなたの電話番号。電話は手元に置いてください。',
    houseTitle: '2. 家の中と庭を確認（2分）',
    houseHint: '自宅の近く、ときには家の中で見つかる人も多くいます。',
    check_closets: 'クローゼット・押し入れ',
    check_beds: 'ベッドの下',
    check_bathrooms: '浴室・トイレ',
    check_garage: '車庫・屋根裏・地下室',
    check_cars: '停めてある車の中',
    check_yard: '庭・物置・植え込み',
    check_neighbors: '近所の庭や玄関先',
    nextAreasTitle: '次に探すエリア',
    nextAreasHint: '次の捜索者に最適なエリア（可能性の高い順）。',
    areaLabel: 'エリア {n}',
    areaChance: 'ここにいる可能性 {pct}',
    routeInfo: '徒歩ルート：{dist}、約 {min} 分',
    noRoute: 'ここには道がありません。専門家に任せてください。',
    markSearched: '捜索済み・見つからず',
    minutesSpent: '捜索した時間（分）',
    searchedDone: '捜索済みにしました。地図を更新しました。',
    searchedMinutes: '{min} 分捜索済み',
    sightingStart: '目撃を報告',
    tapSighting: '見かけた場所を地図でタップしてください',
    sightingPlaced: '場所を指定しました。下の項目を入力してください。',
    sightingMinutes: '何分前ですか？',
    sightingDirection: 'どちらへ向かっていましたか？',
    sightingSure: 'どのくらい確かですか？',
    sure_low: 'たぶん',
    sure_mid: 'おそらく',
    sure_high: '確か',
    sightingNote: 'ほかに（服装、誰が見たか）',
    sightingSave: '目撃を地図に追加',
    cancel: 'キャンセル',
    sightingAdded: '目撃を追加しました。地図を更新しました。',
    needSightingPlace: 'まず見かけた場所を地図でタップしてください。',
    needRunFirst: 'まず捜索予測を開始してください。',
    sightingMarker: '報告された目撃地点',
    ringLabel: '最後の目撃地点から {dist}',
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
