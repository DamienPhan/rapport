/**
 * Génération du rapport de mission au format texte.
 * Module pur : prend un objet mission, retourne une chaîne.
 */

/**
 * Résout un lieu : si 'Autre', utilise le champ libre ; si 'AUTO_CHECKIN',
 * compose « Check-in + n° de vol ».
 * @param {object} m mission
 * @param {'lieuRencontre'|'lieuDepose'} field
 */
export function resolvePlace(m, field) {
  const v = m[field];
  if (v === 'Autre') return m[field + 'Autre'] || 'Autre';
  if (v === 'AUTO_CHECKIN') return m.vol ? `Check-in vol ${m.vol}` : 'Check-in';
  return v || '';
}

/**
 * Génère le rapport texte d'une mission.
 * @param {object} m mission (valeurs déjà synchronisées depuis l'UI)
 * @returns {string}
 */
export function generateReportText(m) {
  const hfN = parseInt(m.bagHorsFormat, 10) || 0;
  const caN = parseInt(m.bagCage, 10) || 0;
  const hfDisp = hfN > 0 ? String(hfN) : 'N/A';
  const caDisp = caN > 0 ? String(caN) : 'N/A';
  const total = (parseInt(m.bagStandard, 10) || 0) + hfN + caN;
  const lieuRencontre = resolvePlace(m, 'lieuRencontre');
  const lieuDepose = resolvePlace(m, 'lieuDepose');
  const clientLine = m.greeteur ? `${m.client} - Greeteur : ${m.greeteur}` : m.client;

  return `1. Informations générales
Booking : #${m.booking}
Date : ${m.date}
Client : ${clientLine}
Pré-booking ou Live : ${m.prebooking}
Type de service : ${m.type}
Vol - code IATA : ${m.vol}
Terminal : ${m.terminal}
Nombre de passagers : ${m.pax}

2. Bagages
Nombre de bagages Standard : ${m.bagStandard}
Hors format : ${hfDisp}
Cage animal : ${caDisp}

Total Bagages pris en charge : ${total}

3. Service
Détaxe : ${m.detaxe}
Lieu de rencontre : ${lieuRencontre}
Lieu de dépose : ${lieuDepose}

4. Un problème rencontré ?
${m.probleme || 'Aucun problème'}

5. Ressources
Nombre de porteurs : ${m.porteurs}

6. Qualité
Satisfaction client : ${m.satisfaction}`;
}
