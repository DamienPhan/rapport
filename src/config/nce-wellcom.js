/**
 * Configuration du site « NCE / Well'Com Air ».
 *
 * ⭐ FICHIER CLÉ POUR L'UPSCALING.
 * Toute la spécificité d'un aéroport / d'une agence est concentrée ici.
 * Pour déployer sur un autre site avec le même format de PDF :
 *   1. Copier ce fichier (ex. `cdg-autreagence.js`)
 *   2. Ajuster les valeurs ci-dessous
 *   3. Pointer l'import dans `src/ui/app.js` vers le nouveau fichier
 * Le code de `src/core/` ne doit JAMAIS contenir de valeur propre à un site.
 *
 * @typedef {Object} SiteConfig
 */
export const siteConfig = {
  /** Identifiant et libellés d'affichage du site. */
  site: {
    id: 'nce-wellcom',
    airportName: "Aéroport Nice Côte d'Azur",
    airportCode: 'NCE',
    agencyName: "Well'Com Air",
  },

  /**
   * Géométrie du tableau PDF (reconstruction par coordonnées).
   * `headers` : les 7 en-têtes de colonnes, dans l'ordre, tels qu'ils
   *   apparaissent en haut de chaque page du PDF. Servent à recaler
   *   dynamiquement les centres de colonnes.
   * `defaultCenters` : positions X de repli (px) si la détection d'en-tête
   *   échoue. À ajuster si un autre site a une mise en page différente.
   * `columnCount` : nombre de colonnes (doit valoir headers.length).
   */
  pdfTable: {
    headers: ['Mission', 'Date/Heures', 'Client', 'Itinéraire', 'Véhicule', 'Note', 'Type'],
    defaultCenters: [41, 88, 174, 376, 538, 622, 716],
    columnCount: 7,
    /** Index des colonnes contenant la note au porteur (nom du greeter, etc.). */
    noteColumns: [4, 5],
    /**
     * Marge (px) tolérée au-delà de la frontière géométrique entre la
     * dernière colonne note et la colonne suivante (Type), pour récupérer un
     * mot qui déborde légèrement (nom de Greet Sign long, note libre — voir
     * `isNoteCol` dans parser-pdf.js). Mesuré sur un cas réel : débordement
     * à x≈676-678, contenu Type légitime le plus proche à x≈703 (marge >25px)
     * — 25 laisse une marge de sécurité sans jamais capturer de texte Type.
     */
    noteOverflowMargin: 25,
    /**
     * Marge (px) au-delà de la frontière géométrique entre l'Itinéraire et
     * la première colonne note (Véhicule), à l'intérieur de laquelle un mot
     * est EXCLU du texte note/porteur plutôt qu'inclus (sens inverse de
     * `noteOverflowMargin` ci-dessus) — un résidu d'itinéraire wrap (ville,
     * numéro de terminal) peut retomber juste après ce midpoint sans être
     * du contenu Véhicule/Note réel. Mesuré sur un cas réel : résidu à
     * x≈476-491, contenu Véhicule/Note légitime le plus proche à x≈538-546
     * (marge >45px) — 45 laisse une marge de sécurité sans jamais exclure
     * de contenu Véhicule/Note réel.
     */
    itineraryBleedGuard: 45,
    /** Index de la colonne « booking / mission ». */
    bookingColumn: 0,
    /** Index de la colonne client. */
    clientColumn: 2,
  },

  /**
   * Reconnaissance des clients dans la colonne Client.
   * `direct` : clients « en propre » identifiés par un motif fixe → libellé.
   * `agencyRefPattern` : motif de référence agence `[YYYY-NNNNNN]`.
   * `groupCapsPattern` : clients groupe en MAJUSCULES (sans réf agence).
   */
  clients: {
    direct: [
      { match: /ACA \(A[ée]roport/, token: 'ACA', label: 'ACA ETIC' },
      { match: /Monaco Mediax/, token: 'Monaco', label: 'Monaco Mediax' },
      { match: /WELL'COM/, token: 'WELLCOM', label: "WELL'COM AIR" },
    ],
    agencyRefPattern: /^(.*?)\s*\[(20\d{2}-\d{6})\]/,
    groupCapsPattern: /^([A-Z][A-Z0-9\s'.&\-]{3,}[A-Z0-9])(?=\s*[(\d]|\s*$)/,
    /** Le client réputé « aéroport » (sans téléphone propre, greeter présent). */
    airportToken: 'ACA',
    airportLabel: 'ACA ETIC',
  },

  /**
   * Libellés et motifs présents dans la note au porteur.
   * Adapter si un autre site utilise une terminologie différente.
   */
  noteLabels: {
    // [\s:,]+ : au moins un séparateur entre le libellé et le nom, mais pas
    // forcément ':' — le planning omet parfois les deux-points (« Greeter NOM »).
    // Pas de tiret dans cette classe : un greeter non assigné rendu
    // « Greeter -  » suivi du mot suivant (type de service, etc.) capturerait
    // ce mot comme faux nom si le tiret était accepté ici (trouvé en revue,
    // jamais observé dans un planning réel — pas de raison de prendre le risque).
    greeter: /greete?r[s]?[\s:,]+/i,
    contactDriver: /contact\s+chauffeur/i,
    /** Mots qui ne sont jamais un nom de greeter (faux positifs à exclure). */
    greeterBlockWords: ['a', 'à', 'venir', 'voir'],
    /**
     * Bloc « services » généré par le système de booking, présent dans la
     * note au porteur des missions agence (réservation directe). Absent des
     * missions ACA classiques (simple greeter+tel) — voir CLAUDE.md racine.
     */
    greetSign: /greet\s*sign\s*:?\s*/i,
    /** Nom capturé après `greetSign` jusqu'à l'une de ces bornes (jamais avalé). */
    greetSignStop: /flight\s*class|={5,}/i,
    /** Confirme la présence du bloc bagages structuré (sinon `bagSupplementaire` seul n'a pas de sens). */
    bagStandardBlock: /x\s*bagage\s*standard/i,
    bagSupplementaire: /(\d+)\s*x\s*bagage\s*suppl[ée]mentaire/i,
    /** Item distinct de bagSupplementaire (prix différent, +15€ vs +10€/piece) — pas ajouté au total bagStandard. */
    bagHorsFormat: /(\d+)\s*x\s*bagage\s*hors\s*format/i,
    assistanceDetaxe: /assistance\s*d[ée]taxe/i,
    parkingProfessionnel: /parking\s*professionnel/i,
    parkingPublic: /parking\s*public/i,
    deposeMinuteService: /d[ée]pose-?\s*minute/i,
    /**
     * Note libre avant `Greet Sign:` confirmant le total prépayé (« N bags
     * payé (si supp bags = a régler avec le porteur) ») — distincte du
     * panneau d'accueil, capturée telle quelle (voir noteBlock.js). Bornée
     * par la première occurrence de `)` OU du libellé `Greet Sign`/`====`
     * (jamais l'un après l'autre — la note précède toujours Greet Sign dans
     * le bloc), pas par `\n` seul : la note peut elle-même être coupée sur
     * plusieurs lignes PDF (« ...si supp\nbags = a régler... »), un simple
     * saut de ligne ne doit donc pas tronquer la capture avant la parenthèse
     * fermante réelle. Tolère aussi l'absence totale de parenthèse (texte
     * variable comme « 15 bags payé » seul) sans perdre toute la note faute
     * de `)` à matcher, et sans jamais avaler le contenu après Greet Sign.
     */
    porterPaidBagsNote: /\d+\s*bags?\s*pay[ée][\s\S]*?(?:\)|(?=greet\s*sign|={5,}))/i,
  },

  /** Règles bagages propres au forfait Well'Com Air (voir bloc « services » ci-dessus). */
  baggage: {
    /** Nombre de bagages standard inclus dans le forfait, avant supplément. */
    includedInPackage: 4,
  },

  /**
   * Extraction du vol et du terminal depuis la colonne Itinéraire.
   * `flightPattern` doit capturer le code IATA en groupe 1.
   */
  itinerary: {
    flightPattern: /N[°o]\s*Vol\s*([A-Za-z]{1,3}\s*\d{1,5}[A-Za-z]?|[A-Za-z0-9]{2,7})/i,
    terminalNumeric: /Terminal\s*(T?\d{1,2})(?![\d:])/,
    terminalLetter: /Terminal\s*([A-Z])(?=\s)/,
    depositMinute: /D[ée]pose-?\s*minute/i,
    proParking: /Parking\s*Pro/i,
  },

  /**
   * Règles métier de lieu de rencontre / dépose par type de mission.
   * AUTO_CHECKIN = calculé dynamiquement (check-in + n° de vol).
   */
  places: {
    ARR: { meet: 'Tapis bagage', drop: 'Parking pro' },
    DEP: { meet: 'Linéaire Professionnel', drop: 'AUTO_CHECKIN' },
    TRS: { meet: '', drop: '' },
    /** Repli au niveau du parser PDF (avant application des défauts UI). */
    arrDropFallback: 'Tapis bagage',
    depDropFallback: 'AUTO_CHECKIN',
  },

  /**
   * Options affichées dans les <select> lieu de rencontre/dépose,
   * restreintes par type de mission (ARR/DEP) — décision explicite de
   * Damien : les lieux réellement possibles diffèrent selon le sens de la
   * mission (ex. « Linéaire Professionnel » n'a de sens qu'au départ,
   * « Tapis bagage » qu'à l'arrivée). Chaque liste inclut 'N/A' (utilisé par
   * NO SHOW) et 'Autre' (champ libre). TRS et « Service » (extraction sans
   * vol) n'ont pas de liste dédiée — l'UI (`src/ui/app.js`) leur affiche
   * l'union de toutes les valeurs ci-dessous plutôt qu'une liste vide.
   */
  placeOptions: {
    ARR: {
      meet: ['Tapis bagage', 'Hélicoptères', 'Terminal affaires', 'Autre', 'N/A'],
      drop: ['Dépose minute', 'Parking pro', 'Parking public', 'Gare routière', 'Loueurs', 'Taxis', 'Hélicoptères', 'Terminal affaires', 'Autre', 'N/A'],
    },
    DEP: {
      meet: ['Dépose minute', 'Linéaire Professionnel', 'Loueurs', 'Gare routière (BUS)', 'Terminal affaires', 'Parking public', 'Autre', 'N/A'],
      drop: ['AUTO_CHECKIN', 'Hélicoptères', 'Terminal affaires', 'Loueurs', 'Autre', 'N/A'],
    },
  },

  /** Téléphone : doit commencer par + ou 0, longueur minimale. */
  phone: {
    minDigits: 9,
    leadingPattern: /^[+0]/,
  },
};

export default siteConfig;
