/**
 * Renseignement des téléphones (greeter, contact chauffeur) depuis le texte
 * complet du planning. Module pur (aucune dépendance DOM) — appelé après
 * l'extraction PDF et l'extraction copier-coller.
 *
 * Ported depuis l'ancien `enrichMissionsWithPhones` (index.html v1) : le
 * numéro chauffeur dépend du texte aplati plutôt que des coordonnées PDF
 * (voir CLAUDE.md §3.1 / §7 — la note « Contact Chauffeur » déborde souvent
 * la bande Y de sa mission dans le chemin par coordonnées).
 */
import { normalizePhone } from './phone.js';

/** Réf booking générique (`nnnnn-n`), utilisée pour borner les fenêtres de recherche ci-dessous. */
const BOOKING_REF_RE = /\b\d{4,6}-\d+\b/;

/**
 * @param {object[]} missions
 * @param {string} fullText  texte brut complet du planning (PDF aplati ou collé)
 * @param {import('../config/nce-wellcom.js').SiteConfig} cfg
 */
export function enrichWithPhones(missions, fullText, cfg) {
  missions.forEach((m) => {
    if (!m.greeteurPhone && m.greeteur) {
      const esc = m.greeteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const r = fullText.match(new RegExp(cfg.noteLabels.greeter.source + esc, 'i'));
      if (r) {
        // Fenêtre bornée à 200 caractères ET à la prochaine réf booking
        // (comme contactPhone ci-dessous) : sans borne, un greeter sans
        // téléphone propre (label présent mais rien après) récupérait le
        // numéro de la mission suivante — ex. « Greeter: Antoine » (pas de
        // tel) suivi 150 caractères plus loin par « Bryan L 06 10 88 78 90 »,
        // faussement assigné à Antoine. Le slice de 200 caractères est fait
        // AVANT la recherche de réf (pas après) pour ne jamais scanner au-delà
        // sur un gros planning (8 pages / 40+ missions).
        const afterMatch = fullText.slice(r.index + r[0].length, r.index + r[0].length + 200);
        const nextRef = afterMatch.match(BOOKING_REF_RE);
        // Aplatit les caractères après le nom (numéros scindés sur 2 lignes, ex. "+33 6 47\n48 64 66")
        const flat = afterMatch.slice(0, nextRef ? nextRef.index : undefined).replace(/\n/g, ' ');
        const pm = flat.match(/([+?]?\d[\d\s?]{8,})/);
        if (pm) m.greeteurPhone = normalizePhone(pm[1], cfg.phone);
      }
    }
    if (!m.contactPhone) {
      const bk = m.booking || '';
      const idx = bk ? fullText.indexOf(bk) : -1;
      if (idx >= 0) {
        // Fenêtre bornée : de la réf booking à la réf booking suivante (évite de déborder
        // sur la mission voisine). Une réf trouvée à <150 caractères est la référence de
        // planification agence de la mission elle-même, pas un voisin — on saute au suivant.
        const after = fullText.slice(idx + bk.length);
        let nb = after.match(BOOKING_REF_RE);
        if (nb && nb.index < 150) {
          const after2 = after.slice(nb.index + nb[0].length);
          const nb2 = after2.match(BOOKING_REF_RE);
          nb = nb2 ? { index: nb.index + nb[0].length + nb2.index } : null;
        }
        const end = nb ? idx + bk.length + nb.index : Math.min(idx + 2500, fullText.length);
        const slice = fullText.slice(idx, end);
        const contactRe = cfg.noteLabels.contactDriver.source;
        let r = slice.match(new RegExp(contactRe + '[^+\\d\\n]{0,15}([+?]?\\d[\\d\\s?]{8,})', 'i'));
        if (!r) r = slice.match(new RegExp(contactRe + '[^\\n]*\\n\\s*([+?]?\\d[\\d\\s?]{8,})', 'i'));
        if (r) m.contactPhone = normalizePhone(r[1], cfg.phone);
      }
    }
  });
}
