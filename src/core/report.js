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
/** Affiche la valeur, ou 'N/A' si vide/absente (champs non optionnels du rapport). */
function naIfEmpty(v) {
  return String(v ?? '').trim() || 'N/A';
}

export function generateReportText(m) {
  const hfN = parseInt(m.bagHorsFormat, 10) || 0;
  const caN = parseInt(m.bagCage, 10) || 0;
  const hfDisp = hfN > 0 ? String(hfN) : 'N/A';
  const caDisp = caN > 0 ? String(caN) : 'N/A';
  const total = (parseInt(m.bagStandard, 10) || 0) + hfN + caN;
  const lieuRencontre = naIfEmpty(resolvePlace(m, 'lieuRencontre'));
  const lieuDepose = naIfEmpty(resolvePlace(m, 'lieuDepose'));
  // Greeteur reste optionnel : simplement omis quand vide, jamais 'N/A'.
  const clientLine = m.greeteur ? `${naIfEmpty(m.client)} - Greeteur : ${m.greeteur}` : naIfEmpty(m.client);
  const bookingDisp = String(m.booking ?? '').trim() ? `#${m.booking}` : 'N/A';

  return `**TOTAL BAGAGES PRIS EN CHARGE : ${total}**

1. Informations générales
Booking : ${bookingDisp}
Date : ${naIfEmpty(m.date)}
Client : ${clientLine}
Pré-booking ou Live : ${naIfEmpty(m.prebooking)}
Type de service : ${naIfEmpty(m.type)}
Vol - code IATA : ${naIfEmpty(m.vol)}
Terminal : ${naIfEmpty(m.terminal)}
Nombre de passagers : ${naIfEmpty(m.pax)}

2. Bagages
Nombre de bagages Standard : ${naIfEmpty(m.bagStandard)}
Hors format : ${hfDisp}
Cage animal : ${caDisp}

Total Bagages pris en charge : ${total}

3. Service
Détaxe : ${naIfEmpty(m.detaxe)}
Lieu de rencontre : ${lieuRencontre}
Lieu de dépose : ${lieuDepose}

4. Un problème rencontré ?
${m.probleme || 'Aucun problème'}

5. Ressources
Nombre de porteurs : ${naIfEmpty(m.porteurs)}

6. Qualité
Satisfaction client : ${naIfEmpty(m.satisfaction)}`;
}
