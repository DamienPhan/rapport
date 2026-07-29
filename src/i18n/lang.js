/**
 * Détection et persistance de la langue de l'interface (FR/EN).
 * Touche `navigator`/`localStorage` (comme `store/session.js`) mais jamais
 * `document` — l'application des traductions au DOM reste dans `ui/app.js`,
 * seule couche autorisée à toucher le DOM (voir CLAUDE.md).
 *
 * N'affecte QUE l'interface. Les valeurs métier stockées dans une mission et
 * le rapport final généré restent toujours en français (voir translations.js).
 */
import { translations } from './translations.js';

const STORAGE_KEY = 'appLang';
const SUPPORTED = ['fr', 'en'];
const DEFAULT_LANG = 'fr';

/**
 * Langue suggérée d'après celle du téléphone/navigateur.
 * Repli sur le français pour toute langue autre que l'anglais — usage
 * interne à une équipe francophone, l'anglais est la seule alternative utile.
 */
export function detectLang() {
  const langs = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  for (const l of langs) {
    if (typeof l === 'string' && l.toLowerCase().startsWith('en')) return 'en';
  }
  return DEFAULT_LANG;
}

/** Langue actuelle : préférence enregistrée (choix explicite du bouton) sinon détection. */
export function getLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.includes(saved)) return saved;
  } catch (e) { /* localStorage indisponible (navigation privée...) */ }
  return detectLang();
}

/** Enregistre un choix explicite de langue (bouton de bascule). */
export function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
}

/** Langue vers laquelle bascule le bouton (l'autre langue supportée). */
export function otherLang(lang) {
  return lang === 'en' ? 'fr' : 'en';
}

/**
 * Traduit une clé en chemin pointé ("section.field") pour la langue donnée.
 * La valeur peut être une chaîne fixe ou une fonction(vars) pour les cas
 * dynamiques (interpolation, pluriel). Repli sur le français si la clé est
 * absente de la langue demandée (filet de sécurité, ne devrait pas arriver).
 * @param {string} lang
 * @param {string} key
 * @param {object} [vars]
 */
export function t(lang, key, vars) {
  const dict = translations[lang] || translations[DEFAULT_LANG];
  const value = key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict)
    ?? key.split('.').reduce((o, k) => (o == null ? o : o[k]), translations[DEFAULT_LANG]);
  if (typeof value === 'function') return value(vars || {});
  return value ?? key;
}

/** Texte affiché d'une <option> métier (valeur toujours en français, jamais traduite). */
export function optionLabel(lang, group, value) {
  const dict = translations[lang] || translations[DEFAULT_LANG];
  return dict.optionLabels?.[group]?.[value] ?? value;
}
