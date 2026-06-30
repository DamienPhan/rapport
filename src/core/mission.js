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
 * Valeurs par défaut d'une mission, mutées par l'UI via syncDefaults.
 * NB : bagStandard et probleme NE lisent jamais ces défauts (voir createMission).
 */
export const defaults = {
  prebooking: 'PRÉ-BOOKING',
  detaxe: 'Non',
  lieuRencontre: 'Dépose minute',
  lieuRencontreAutre: '',
  lieuDepose: 'Tapis bagage',
  lieuDeposeAutre: '',
  probleme: 'Non',
  porteurs: '1',
  satisfaction: 'Excellente',
  bagStandard: '1',
  bagHorsFormat: '0',
  bagCage: '0',
};

/** Met à jour les valeurs par défaut (préférences glissantes de l'UI). */
export function syncDefaults(partial) {
  Object.assign(defaults, partial);
}

/**
 * Crée une mission vierge.
 * bagStandard='1' et probleme='' sont volontairement HARDCODÉS (jamais hérités
 * de `defaults`) : sinon une nouvelle mission hériterait du dernier nombre de
 * bagages saisi, ce qui est faux (le PDF n'indique jamais le nombre réel).
 */
export function createMission() {
  return {
    booking: '', date: todayStr(), vol: '', terminal: '', type: 'DEP',
    client: '', clientPhone: '', greeteur: '', greeteurPhone: '', contactPhone: '', pax: '',
    prebooking: defaults.prebooking,
    detaxe: defaults.detaxe,
    lieuRencontre: defaults.lieuRencontre,
    lieuRencontreAutre: defaults.lieuRencontreAutre,
    lieuDepose: 'AUTO_CHECKIN',
    lieuDeposeAutre: defaults.lieuDeposeAutre,
    probleme: '',
    porteurs: defaults.porteurs,
    satisfaction: defaults.satisfaction,
    bagStandard: '1',
    bagHorsFormat: defaults.bagHorsFormat,
    bagCage: defaults.bagCage,
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
