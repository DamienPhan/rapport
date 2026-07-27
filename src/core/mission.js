/**
 * Modèle de mission et règles métier associées.
 * Module pur (aucune dépendance DOM).
 */

/** Date du jour au format JJ/MM. */
export function todayStr() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/** Minutes depuis minuit → "HH:MM" ; '' si inconnu (>=9999). */
export function fmtTime(mins) {
  if (mins == null || mins >= 9999 || mins < 0) return '';
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Crée une mission vierge.
 *
 * Tous les champs ci-dessous sont des constantes fixes, JAMAIS lues depuis
 * un état mutable partagé entre missions (il n'existe plus d'objet
 * `defaults`/`syncDefaults` — supprimé : voir CLAUDE.md §5 point 27/28).
 * Une mission nouvellement extraite ou ajoutée manuellement ne doit jamais
 * hériter d'une valeur saisie sur une AUTRE mission, quel que soit le champ
 * (bug signalé deux fois : d'abord sur les bagages, puis demandé pour
 * « tous les champs » — détaxe, lieux, nombre de porteurs, satisfaction...).
 * Aucun moteur d'extraction (PDF ou copier-coller) ne renseigne jamais ces
 * champs, d'où des valeurs de repli plutôt qu'une extraction réelle.
 */
export function createMission() {
  return {
    booking: '', date: todayStr(), vol: '', terminal: '', type: 'DEP',
    client: '', clientPhone: '', greeteur: '', greeteurPhone: '', contactPhone: '', pax: '',
    prebooking: 'PRÉ-BOOKING',
    detaxe: 'Non',
    lieuRencontre: 'Dépose minute',
    lieuRencontreAutre: '',
    lieuDepose: 'AUTO_CHECKIN',
    lieuDeposeAutre: '',
    probleme: '',
    porteurs: '1',
    satisfaction: 'Excellente',
    bagStandard: '1',
    bagHorsFormat: '0',
    bagCage: '0',
    sortTime: 9999,
    bookingOptions: [],
    flightOptions: [],
  };
}

/**
 * Applique les lieux de rencontre/dépose par défaut selon le type, à partir
 * de la table de config du site. Appliqué une fois à l'extraction.
 * @param {object} mission
 * @param {object} placesCfg  siteConfig.places
 */
export function applyPlaceDefaults(mission, placesCfg) {
  const rule = placesCfg[mission.type];
  if (rule) {
    mission.lieuRencontre = rule.meet;
    mission.lieuDepose = rule.drop;
  }
  return mission;
}

/** Crée une mission manuelle (LIVE, booking pré-rempli). */
export function createManualMission() {
  const m = createMission();
  m.prebooking = 'LIVE';
  m.booking = '2026-';
  return m;
}

/**
 * Transforme une mission en NO SHOW : conserve l'identité, met le reste à N/A.
 */
export function markNoShow(mission) {
  mission.pax = 'N/A';
  mission.bagStandard = 'N/A';
  mission.bagHorsFormat = 'N/A';
  mission.bagCage = 'N/A';
  mission.detaxe = 'N/A';
  mission.lieuRencontre = 'N/A';
  mission.lieuRencontreAutre = '';
  mission.lieuDepose = 'N/A';
  mission.lieuDeposeAutre = '';
  mission.satisfaction = 'N/A';
  mission.probleme = 'NO SHOW';
  return mission;
}

/**
 * Valide les champs obligatoires d'une mission.
 * @returns {string[]} liste des clés manquantes
 */
export function validateMission(mission) {
  const required = ['booking', 'pax'];
  if (mission.type === 'ARR' || mission.type === 'DEP') required.push('vol', 'terminal');
  return required.filter((f) => !String(mission[f] ?? '').trim());
}
