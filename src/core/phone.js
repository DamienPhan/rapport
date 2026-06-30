/**
 * Normalisation et extraction de numéros de téléphone.
 * Module pur (aucune dépendance DOM) — réutilisable côté natif.
 */

/**
 * Normalise un numéro : ne garde que `+` et chiffres, rejette les faux
 * positifs (doit commencer par + ou 0, longueur minimale configurable).
 * @param {string} s
 * @param {{minDigits:number, leadingPattern:RegExp}} phoneCfg
 * @returns {string} numéro normalisé ou '' si invalide
 */
export function normalizePhone(s, phoneCfg) {
  const c = (s || '').replace(/[^\d+]/g, '');
  if (!phoneCfg.leadingPattern.test(c)) return '';
  return c.length >= phoneCfg.minDigits ? c : '';
}

/**
 * Extrait le téléphone client d'une chaîne « M. NOM +phone ».
 * @param {string} text  contenu de la colonne client
 * @returns {string} numéro brut (espaces retirés) ou ''
 */
export function extractClientPhone(text) {
  const pm = text.match(/M\.\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'\s\-]*?\s+([+]\d[\d ]{7,}\d)/);
  return pm ? pm[1].replace(/\s+/g, '') : '';
}
