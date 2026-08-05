/**
 * Lecture du bloc « services » généré par le système de booking, présent
 * dans la note au porteur des missions agence (réservation directe) —
 * absent des missions ACA classiques (simple greeter+tel). Module pur,
 * partagé entre `parser-pdf.js` (texte de colonne fiable par coordonnées,
 * `row.vn`) et `enrich.js` (repli texte aplati pour le chemin copier-coller).
 *
 * Bloc type (voir CLAUDE.md racine) :
 *   Greet Sign: NOM (ou "null")
 *   Flight Class : business
 *   ==============================
 *   1 x BAGAGE STANDARD inclus dans le forfait ... dans la limite de 4 bagages...
 *   ------------------------------
 *   N x BAGAGE SUPPLÉMENTAIRE +10€/piece      (optionnel)
 *   ------------------------------
 *   1 x DÉPOSE-MINUTE / PARKING PROFESSIONNEL VTC & TAXI / PARKING PUBLIC
 *   ------------------------------
 *   1 x ASSISTANCE DÉTAXE                      (optionnel)
 */

/**
 * @param {string} text  texte du bloc note, scopé à une seule mission
 * @param {import('../config/nce-wellcom.js').SiteConfig} cfg
 * @returns {{greetSign: string, bagStandard: number|null, detaxe: boolean, place: string|null}}
 */
export function parseNoteBlock(text, cfg) {
  const labels = cfg.noteLabels;
  const result = { greetSign: '', bagStandard: null, detaxe: false, place: null };
  if (!text) return result;

  const gm = text.match(labels.greetSign);
  if (gm) {
    const after = text.slice(gm.index + gm[0].length, gm.index + gm[0].length + 120);
    const stop = after.search(labels.greetSignStop);
    const raw = (stop >= 0 ? after.slice(0, stop) : after).replace(/\s+/g, ' ').trim();
    if (raw && raw.toLowerCase() !== 'null') result.greetSign = raw;
  }

  if (labels.bagStandardBlock.test(text)) {
    const extra = text.match(labels.bagSupplementaire);
    result.bagStandard = cfg.baggage.includedInPackage + (extra ? parseInt(extra[1], 10) || 0 : 0);
  }

  if (labels.assistanceDetaxe.test(text)) result.detaxe = true;

  if (labels.parkingProfessionnel.test(text)) result.place = 'Parking pro';
  else if (labels.parkingPublic.test(text)) result.place = 'Parking public';
  else if (labels.deposeMinuteService.test(text)) result.place = 'Dépose minute';

  return result;
}

/**
 * Applique le résultat de `parseNoteBlock` à une mission, en respectant la
 * convention lieu de rencontre (départ) / lieu de dépose (arrivée) déjà
 * utilisée par `applyPlaceDefaults`.
 *
 * `greetSign` et `bagExpected` (nombre de bagages attendu selon la note) ne
 * sont jamais posés dans un champ éditable du formulaire — ce sont de
 * simples notes de référence affichées à côté (voir `src/ui/app.js`) ;
 * `bagStandard` (le champ éditable) reste toujours à la valeur saisie par
 * le porteur, jamais écrasée silencieusement par la note.
 * @param {object} mission
 * @param {{greetSign: string, bagStandard: number|null, detaxe: boolean, place: string|null}} parsed
 * @param {object} [opts]
 * @param {boolean} [opts.onlyIfEmpty]  n'écrit que si le champ est encore à sa valeur de repli (repli texte, ne doit jamais écraser une extraction PDF déjà posée)
 */
export function applyNoteBlock(mission, parsed, opts = {}) {
  const onlyIfEmpty = !!opts.onlyIfEmpty;
  if (parsed.greetSign && (!onlyIfEmpty || !mission.greetSign)) mission.greetSign = parsed.greetSign;
  if (parsed.bagStandard != null && (!onlyIfEmpty || !mission.bagExpected)) {
    mission.bagExpected = String(parsed.bagStandard);
  }
  if (parsed.detaxe && (!onlyIfEmpty || mission.detaxe === 'Non')) mission.detaxe = 'Oui';
  if (parsed.place === 'Parking pro' || parsed.place === 'Parking public') {
    if (mission.type === 'ARR' && (!onlyIfEmpty || mission.lieuDepose === 'Parking pro')) mission.lieuDepose = parsed.place;
  } else if (parsed.place === 'Dépose minute') {
    if (mission.type === 'DEP' && (!onlyIfEmpty || mission.lieuRencontre === 'Dépose minute')) mission.lieuRencontre = parsed.place;
    else if (mission.type === 'ARR' && (!onlyIfEmpty || mission.lieuDepose === 'Parking pro')) mission.lieuDepose = parsed.place;
  }
  return mission;
}
