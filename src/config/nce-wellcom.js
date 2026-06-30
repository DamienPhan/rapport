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
    greeter: /greete?r[s]?[\s:,]+/i,
    contactDriver: /contact\s+chauffeur/i,
    /** Mots qui ne sont jamais un nom de greeter (faux positifs à exclure). */
    greeterBlockWords: ['a', 'à', 'venir', 'voir'],
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
    DEP: { meet: 'Dépose minute', drop: 'AUTO_CHECKIN' },
    TRS: { meet: '', drop: '' },
    /** Repli au niveau du parser PDF (avant application des défauts UI). */
    arrDropFallback: 'Tapis bagage',
    depDropFallback: 'AUTO_CHECKIN',
  },

  /** Téléphone : doit commencer par + ou 0, longueur minimale. */
  phone: {
    minDigits: 9,
    leadingPattern: /^[+0]/,
  },
};

export default siteConfig;
