/**
 * Tests de non-régression du moteur d'extraction.
 *
 * Exécution : `node tests/parser.test.js` (Node 18+, ESM).
 * Nécessite pdfjs-dist et les PDF de référence dans tests/fixtures/.
 *
 * Ces tests garantissent que toute modification du parser produit toujours
 * le même résultat sur les plannings de référence. Lancer après CHAQUE
 * changement touchant src/core/parser-*.js ou la config.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

import { siteConfig } from '../src/config/nce-wellcom.js';
import { wordsFromTextContent, missionsForPorter } from '../src/core/parser-pdf.js';
import { createMission, applyPlaceDefaults, validateMission, markNoShow } from '../src/core/mission.js';
import { generateReportText, resolvePlace } from '../src/core/report.js';
import { normalizePhone, extractClientPhone } from '../src/core/phone.js';
import { enrichWithPhones, enrichWithNotes } from '../src/core/enrich.js';
import { parseNoteBlock, applyNoteBlock } from '../src/core/noteBlock.js';
import { translations } from '../src/i18n/translations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✅', name); }
  catch (e) { failed++; console.log('  ❌', name, '\n     ', e.message); }
}

console.log('\n── Tests unitaires (core, sans PDF) ─────────────────');

test('normalizePhone rejette les faux positifs', () => {
  assert.strictEqual(normalizePhone('20486466', siteConfig.phone), '');
  assert.strictEqual(normalizePhone('+33 6 47 48 64 66', siteConfig.phone), '+33647486466');
  assert.strictEqual(normalizePhone('06 12 34 56 78', siteConfig.phone), '0612345678');
});

test('extractClientPhone lit "M. NOM +phone"', () => {
  assert.strictEqual(
    extractClientPhone('MY FRENCH RIVIERA [2026-001260] (1) M. MY FRENCH RIVIERA +966505609430'),
    '+966505609430'
  );
});

test('validateMission exige vol+terminal pour ARR/DEP', () => {
  const m = createMission(); m.type = 'ARR'; m.booking = 'X';
  assert.deepStrictEqual(validateMission(m).sort(), ['pax', 'terminal', 'vol']);
});

test('validateMission n\'exige pas vol pour TRS', () => {
  const m = createMission(); m.type = 'TRS'; m.booking = 'X'; m.pax = '1';
  assert.deepStrictEqual(validateMission(m), []);
});

test('markNoShow garde l\'identité, met le reste à N/A', () => {
  const m = createMission();
  Object.assign(m, { booking: '10743-1', vol: 'AF123', terminal: '2', type: 'ARR', pax: '3' });
  markNoShow(m);
  assert.strictEqual(m.vol, 'AF123');
  assert.strictEqual(m.pax, 'N/A');
  assert.strictEqual(m.probleme, 'NO SHOW');
});

test('markNoShow vide aussi les repères de note (greetSign/bagExpected/bagHorsFormatExpected/porterNote)', () => {
  const m = createMission();
  Object.assign(m, {
    booking: '10743-1', vol: 'AF123', terminal: '2', type: 'ARR', pax: '3',
    greetSign: 'Moshe Benish', bagExpected: '12', bagHorsFormatExpected: '3',
    porterNote: '15 bags payé (si supp bags = a régler avec le porteur)',
  });
  markNoShow(m);
  // Pas de bannière de note périmée pour un client qui ne s'est jamais présenté.
  assert.strictEqual(m.greetSign, '');
  assert.strictEqual(m.bagExpected, '');
  assert.strictEqual(m.bagHorsFormatExpected, '');
  assert.strictEqual(m.porterNote, '');
});

test('createMission ne fait jamais hériter aucun champ d\'une mission précédente (bagages, détaxe, lieux, porteurs, satisfaction...)', () => {
  const m1 = createMission();
  Object.assign(m1, {
    bagHorsFormat: '3', bagCage: '2', detaxe: 'Oui',
    lieuRencontre: 'Autre', lieuRencontreAutre: 'Parking B',
    lieuDepose: 'Autre', lieuDeposeAutre: 'Terminal 3',
    porteurs: '4', satisfaction: 'Mauvaise', prebooking: 'LIVE',
  });

  // Une nouvelle mission (extraction, changement de porteur, ajout manuel...)
  // doit toujours repartir des mêmes valeurs de repli fixes, jamais de celles
  // saisies sur m1 — il n'existe plus d'état mutable partagé entre missions.
  const m2 = createMission();
  assert.strictEqual(m2.bagHorsFormat, '0');
  assert.strictEqual(m2.bagCage, '0');
  assert.strictEqual(m2.detaxe, 'Non');
  assert.strictEqual(m2.lieuRencontre, 'Linéaire Professionnel');
  assert.strictEqual(m2.lieuRencontreAutre, '');
  assert.strictEqual(m2.lieuDepose, 'AUTO_CHECKIN');
  assert.strictEqual(m2.lieuDeposeAutre, '');
  assert.strictEqual(m2.porteurs, '1');
  assert.strictEqual(m2.satisfaction, 'Excellente');
  assert.strictEqual(m2.prebooking, 'PRÉ-BOOKING');
});

test('applyPlaceDefaults applique la table de config', () => {
  const m = createMission(); m.type = 'ARR';
  applyPlaceDefaults(m, siteConfig.places);
  assert.strictEqual(m.lieuRencontre, 'Tapis bagage');
  assert.strictEqual(m.lieuDepose, 'Parking pro');

  const dep = createMission(); dep.type = 'DEP';
  applyPlaceDefaults(dep, siteConfig.places);
  assert.strictEqual(dep.lieuRencontre, 'Linéaire Professionnel');
  assert.strictEqual(dep.lieuDepose, 'AUTO_CHECKIN');
});

test('generateReportText affiche N/A pour hors-format/cage vides', () => {
  const m = createMission();
  Object.assign(m, { booking: 'B', date: '30/06', client: 'C', vol: 'V', terminal: '1', type: 'ARR', pax: '1' });
  const txt = generateReportText(m);
  assert.ok(txt.includes('Hors format : N/A'));
  assert.ok(txt.includes('Cage animal : N/A'));
});

test('generateReportText affiche N/A pour les champs non optionnels vides', () => {
  const m = createMission();
  Object.assign(m, { booking: '', date: '', client: '', vol: '', terminal: '', type: 'TRS', pax: '1', porteurs: '', lieuRencontre: '', lieuDepose: '' });
  const txt = generateReportText(m);
  assert.ok(txt.includes('Booking : N/A'));
  assert.ok(txt.includes('Date : N/A'));
  assert.ok(txt.includes('Client : N/A'));
  assert.ok(txt.includes('Vol - code IATA : N/A'));
  assert.ok(txt.includes('Terminal : N/A'));
  assert.ok(txt.includes('Lieu de rencontre : N/A'));
  assert.ok(txt.includes('Lieu de dépose : N/A'));
  assert.ok(txt.includes('Nombre de porteurs : N/A'));
});

test('generateReportText omet le greeteur (optionnel) sans afficher N/A', () => {
  const m = createMission();
  Object.assign(m, { booking: 'B', date: '30/06', client: 'C', vol: 'V', terminal: '1', type: 'ARR', pax: '1', greeteur: '' });
  const txt = generateReportText(m);
  assert.ok(!txt.includes('Greeteur'));
});

test('resolvePlace complète "Parking public" avec le nom donné, comme "Autre"', () => {
  const withName = { lieuDepose: 'Parking public', lieuDeposeAutre: 'Parking Azur' };
  assert.strictEqual(resolvePlace(withName, 'lieuDepose'), 'Parking public : Parking Azur');

  const withoutName = { lieuDepose: 'Parking public', lieuDeposeAutre: '' };
  assert.strictEqual(resolvePlace(withoutName, 'lieuDepose'), 'Parking public');
});

test('enrichWithPhones trouve le téléphone du greeter sans ":" (« Greeter NOM »)', () => {
  const missions = [{ booking: '31224', greeteur: 'Louane', greeteurPhone: '' }];
  const fullText = 'NCE Falco P. +33 6 67 45 94 86 Greeter Louane +33 7 60 29 35 81 Arrivée\n11483-460 M#29999 ...';
  enrichWithPhones(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].greeteurPhone, '+33760293581');
});

test('enrichWithPhones ne déborde pas sur le téléphone de la mission suivante quand le greeter n\'a pas de numéro propre', () => {
  const missions = [{ booking: '10723-53', greeteur: 'Antoine', greeteurPhone: '' }];
  // « Antoine » n'a pas de numéro : le prochain numéro dans le texte appartient
  // au porteur de la mission suivante (bornée par la réf booking « 11483-466 »).
  const fullText = 'Falco P. +33 6 67 45 94 86 Greeter: Antoine Arrivée\n11483-466 M#29733 ...NCE Bryan L 06 10 88 78 90 Greeter\n';
  enrichWithPhones(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].greeteurPhone, '');
});

// Bloc « services » réel (voir CLAUDE.md racine, missions agence réservation
// directe) : nom pour le panneau d'accueil, bagages inclus + supplémentaires,
// assistance détaxe prépayée, lieu réel de prise en charge/dépose.
test('enrichWithNotes lit le panneau d\'accueil, ignore "null"', () => {
  const missions = [
    { booking: '11780-1', type: 'DEP', greetSign: '', bagStandard: '1', bagExpected: '', detaxe: 'Non', lieuRencontre: 'Dépose minute', lieuDepose: 'AUTO_CHECKIN' },
    { booking: '11942-1', type: 'ARR', greetSign: '', bagStandard: '1', bagExpected: '', detaxe: 'Non', lieuRencontre: 'Tapis bagage', lieuDepose: 'Parking pro' },
  ];
  const fullText = `
11780-1
Bounmy S
+33 6 99 02 29 57
Greet Sign: Kristi
Tsolakaki
Flight Class : business
==============================
1 x BAGAGE STANDARD
inclus dans le forfait
------------------------------
1 x DÉPOSE-MINUTE
------------------------------
11942-1
François L.
+33 7 83 20 84 42
Greet Sign: null
Flight Class : business
==============================
`;
  enrichWithNotes(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].greetSign, 'Kristi Tsolakaki');
  assert.strictEqual(missions[1].greetSign, '');
});

test('enrichWithNotes calcule bagExpected (4 inclus + N supplémentaires), sans toucher bagStandard', () => {
  const missions = [
    { booking: '11835-1', type: 'DEP', greetSign: '', bagStandard: '1', bagExpected: '', detaxe: 'Non', lieuRencontre: 'Dépose minute', lieuDepose: 'AUTO_CHECKIN' },
    { booking: '11780-1', type: 'DEP', greetSign: '', bagStandard: '1', bagExpected: '', detaxe: 'Non', lieuRencontre: 'Dépose minute', lieuDepose: 'AUTO_CHECKIN' },
  ];
  const fullText = `
11835-1
1 x BAGAGE STANDARD
inclus dans le forfait
------------------------------
8 x BAGAGE
SUPPLÉMENTAIRE
+10 € / piece
------------------------------
11780-1
1 x BAGAGE STANDARD
inclus dans le forfait
------------------------------
1 x DÉPOSE-MINUTE
------------------------------
`;
  enrichWithNotes(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].bagExpected, '12'); // 4 inclus + 8 supplémentaires
  assert.strictEqual(missions[0].bagStandard, '1'); // jamais écrasé, reste au champ saisi par le porteur
  assert.strictEqual(missions[1].bagExpected, '4'); // 4 inclus, aucun supplémentaire listé
  assert.strictEqual(missions[1].bagStandard, '1');
});

test('enrichWithNotes calcule bagHorsFormatExpected sans toucher bagHorsFormat', () => {
  const missions = [
    { booking: '12160-1', type: 'ARR', greetSign: '', bagStandard: '1', bagExpected: '', bagHorsFormat: '0', bagHorsFormatExpected: '', detaxe: 'Non', lieuRencontre: 'Tapis bagage', lieuDepose: 'Parking pro' },
    { booking: '12160-2', type: 'ARR', greetSign: '', bagStandard: '1', bagExpected: '', bagHorsFormat: '0', bagHorsFormatExpected: '', detaxe: 'Non', lieuRencontre: 'Tapis bagage', lieuDepose: 'Parking pro' },
  ];
  const fullText = `
12160-1
1 x BAGAGE STANDARD
inclus dans le forfait
------------------------------
3 x BAGAGE
HORS FORMAT
+15€/piece
------------------------------
12160-2
1 x BAGAGE STANDARD
inclus dans le forfait
------------------------------
`;
  enrichWithNotes(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].bagHorsFormatExpected, '3');
  assert.strictEqual(missions[0].bagHorsFormat, '0'); // jamais écrasé, reste au champ saisi par le porteur
  assert.strictEqual(missions[1].bagHorsFormatExpected, ''); // absent du bloc, pas de valeur imposée
});

test('enrichWithNotes capture la note libre au porteur ("N bags payé") avant Greet Sign', () => {
  const missions = [
    { booking: '12160-1', type: 'ARR', greetSign: '', porterNote: '', bagStandard: '1', detaxe: 'Non', lieuRencontre: 'Tapis bagage', lieuDepose: 'Parking pro' },
    { booking: '12160-2', type: 'ARR', greetSign: '', porterNote: '', bagStandard: '1', detaxe: 'Non', lieuRencontre: 'Tapis bagage', lieuDepose: 'Parking pro' },
  ];
  const fullText = `
12160-1
Stéphane M.
+33 6 00 00 00 00
15 bags payé (si supp bags = a régler avec le porteur)
Greet Sign: Moshe Benish
Flight Class : business
==============================
12160-2
Gabriel K
+33 6 00 00 00 01
Greet Sign: Randa Mudarris
Flight Class : business
==============================
`;
  enrichWithNotes(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].porterNote, '15 bags payé (si supp bags = a régler avec le porteur)');
  assert.strictEqual(missions[0].greetSign, 'Moshe Benish');
  assert.strictEqual(missions[1].porterNote, ''); // pas de note libre pour cette mission, greetSign non affecté
  assert.strictEqual(missions[1].greetSign, 'Randa Mudarris');
});

test('parseNoteBlock : porterPaidBagsNote reste correct quand la note est coupée sur deux lignes PDF', () => {
  // Cas réel (planning-04-hors-format-note.pdf) : la ligne PDF "(si supp
  // bags..." est coupée en deux mots de colonne, donc `\n` retombe AVANT la
  // parenthèse fermante — un simple `[^)\n]*` la tronquerait (régression
  // détectée en revue, voir CLAUDE.md racine §5 point 35/36).
  const text = '15 bags payé (si supp\nbags = a régler avec le porteur)\nGreet Sign: Moshe Benish\nFlight Class : business';
  const parsed = parseNoteBlock(text, siteConfig);
  assert.strictEqual(parsed.porterNote, '15 bags payé (si supp bags = a régler avec le porteur)');
});

test('parseNoteBlock : porterPaidBagsNote tolère une note sans parenthèse fermante, bornée à Greet Sign', () => {
  const text = '15 bags payé\nGreet Sign: Moshe Benish\nFlight Class : business';
  const parsed = parseNoteBlock(text, siteConfig);
  assert.strictEqual(parsed.porterNote, '15 bags payé');
  assert.strictEqual(parsed.greetSign, 'Moshe Benish'); // non contaminé par la note
});

test('parseNoteBlock : porterPaidBagsNote ne déborde pas sur une parenthèse lointaine après Greet Sign', () => {
  // Une parenthèse existe plus loin dans le texte (ex. contenu Type-column
  // "Arrivée (jusqu'à 4 bagages inclus)") — la capture doit s'arrêter à
  // "Greet Sign", jamais courir jusqu'à cette parenthèse lointaine.
  const text = '15 bags payé\nGreet Sign: Moshe Benish\nFlight Class : business\n==============================\nArrivée (jusqu’à 4 bagages inclus)';
  const parsed = parseNoteBlock(text, siteConfig);
  assert.strictEqual(parsed.porterNote, '15 bags payé');
});

test('enrichWithNotes détecte l\'assistance détaxe prépayée', () => {
  const missions = [{ booking: '11899-1', type: 'DEP', greetSign: '', bagStandard: '1', detaxe: 'Non', lieuRencontre: 'Dépose minute', lieuDepose: 'AUTO_CHECKIN' }];
  const fullText = `
11899-1
1 x BAGAGE STANDARD
------------------------------
1 x DÉPOSE-MINUTE
------------------------------
1 x ASSISTANCE
DÉTAXE
undefined
------------------------------
`;
  enrichWithNotes(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].detaxe, 'Oui');
});

test('enrichWithNotes n\'écrit pas détaxe=Oui si le libellé est absent', () => {
  const missions = [{ booking: '11780-1', type: 'DEP', greetSign: '', bagStandard: '1', detaxe: 'Non', lieuRencontre: 'Dépose minute', lieuDepose: 'AUTO_CHECKIN' }];
  const fullText = '\n11780-1\n1 x BAGAGE STANDARD\n------------------------------\n1 x DÉPOSE-MINUTE\n------------------------------\n';
  enrichWithNotes(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].detaxe, 'Non');
});

test('enrichWithNotes affine le lieu réel (Parking pro/public, Dépose-minute) selon le type', () => {
  const missions = [
    { booking: '11878-1', type: 'ARR', greetSign: '', bagStandard: '1', detaxe: 'Non', lieuRencontre: 'Tapis bagage', lieuDepose: 'Parking pro' },
    { booking: '11855-1', type: 'ARR', greetSign: '', bagStandard: '1', detaxe: 'Non', lieuRencontre: 'Tapis bagage', lieuDepose: 'Parking pro' },
    // 'Linéaire Professionnel' : défaut réel DEP (cfg.places.DEP.meet), pas
    // 'Dépose minute' — c'est ce que produirait `applyPlaceDefaults` avant
    // `enrichWithNotes` sur une vraie mission DEP, et c'est nécessaire pour
    // exercer réellement le guard `onlyIfEmpty` d'`applyNoteBlock` (sinon le
    // test passe même si l'assignation ne s'exécute jamais, faute de mieux
    // distinguer « valeur écrasée » de « valeur jamais touchée »).
    { booking: '11894-1', type: 'DEP', greetSign: '', bagStandard: '1', detaxe: 'Non', lieuRencontre: 'Linéaire Professionnel', lieuDepose: 'AUTO_CHECKIN' },
  ];
  const fullText = `
11878-1
1 x BAGAGE STANDARD
------------------------------
1 x PARKING
PROFESSIONNEL
VTC & TAXI
------------------------------
11855-1
1 x BAGAGE STANDARD
------------------------------
1 x PARKING PUBLIC
------------------------------
11894-1
1 x BAGAGE STANDARD
------------------------------
1 x DÉPOSE-MINUTE
------------------------------
`;
  enrichWithNotes(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].lieuDepose, 'Parking pro');
  assert.strictEqual(missions[1].lieuDepose, 'Parking public');
  assert.strictEqual(missions[2].lieuRencontre, 'Dépose minute');
});

test('enrichWithNotes ne touche pas une mission ACA classique (sans bloc services)', () => {
  const missions = [{ booking: '11483-500', type: 'DEP', greetSign: '', bagStandard: '1', detaxe: 'Non', lieuRencontre: 'Dépose minute', lieuDepose: 'AUTO_CHECKIN' }];
  const fullText = '\n11483-500\nTom C\n+33 6 12 39 18 67\nGREETER : Roxane\n+33651144301\nSurement au dépose minute\n11483-501\n';
  enrichWithNotes(missions, fullText, siteConfig);
  assert.strictEqual(missions[0].greetSign, '');
  assert.strictEqual(missions[0].bagStandard, '1');
  assert.strictEqual(missions[0].detaxe, 'Non');
  assert.strictEqual(missions[0].lieuRencontre, 'Dépose minute');
});

function leafKeyPaths(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return (v && typeof v === 'object' && !Array.isArray(v)) ? leafKeyPaths(v, path) : [path];
  });
}

test('translations.js : fr et en exposent exactement les mêmes clés', () => {
  const frKeys = leafKeyPaths(translations.fr).sort();
  const enKeys = leafKeyPaths(translations.en).sort();
  assert.deepStrictEqual(enKeys, frKeys);
});

console.log('\n── Tests d\'intégration (PDF de référence) ───────────');

const fixturesDir = join(__dirname, 'fixtures');
const fixtures = [
  { file: 'Mission-2026-06-22_22_11.pdf', porter: 'Yaris K.', expect: { count: 3, firstVol: 'DL0028' } },
  { file: 'planning-30.pdf', porter: 'Damien P.', expect: { hasClient: 'MY FRENCH RIVIERA', clientPhone: '+966505609430' } },
  { file: 'planning-30.pdf', porter: 'Yanis P.', expect: { hasClient: 'DC Aviation G-OPS' } },
  { file: 'planning-23-double-hash.pdf', porter: 'Damien P.', expect: { hasVol: 'EJU1687', booking: '31309' } },
  { file: 'planning-24-greeter-no-colon.pdf', porter: 'Falco P.', expect: { hasVol: 'EY37', greeteur: 'Louane' } },
  { file: 'planning-25-services-block.pdf', porter: 'François L.', expect: { hasVol: 'AC0815', booking: '31106' } },
  { file: 'planning-04-hors-format-note.pdf', porter: 'Stéphane M.', expect: { hasVol: 'AF7314', booking: '2026-002605' } },
  { file: 'planning-04-hors-format-note.pdf', porter: 'Thomas C.', expect: { hasVol: 'AZ354', booking: '2026-002628' } },
  { file: 'planning-04-hors-format-note.pdf', porter: 'Bastien D', expect: { hasVol: 'TK1815', booking: '2026-002596' } },
  { file: 'planning-09-greet-sign-porter-collision.pdf', porter: 'Thomas C.', expect: { hasVol: 'LH1059', booking: '2026-002795' } },
  { file: 'planning-09-greet-sign-porter-collision.pdf', porter: 'Yaris K.', expect: { hasVol: 'GF24', booking: '32180' } },
  { file: 'planning-12-itinerary-name-bleed.pdf', porter: 'Ghassan S.', expect: { hasVol: 'GF0025', booking: '32314' } },
  { file: 'planning-12-itinerary-name-bleed.pdf', porter: 'Bounmy S', expect: { hasVol: 'LY223', booking: '2026-002916' } },
];

async function runPdfTests() {
  let pdfjs;
  try {
    const mod = await import('pdfjs-dist/legacy/build/pdf.js');
    pdfjs = mod.getDocument ? mod : mod.default;
  }
  catch (e) { console.log('  ⚠️  pdfjs-dist absent — tests PDF ignorés (npm i pdfjs-dist)'); return; }

  // Localise les polices standard de pdfjs (évite les warnings et les pertes de glyphes)
  let fontUrl;
  try {
    const pdfjsPath = fileURLToPath(import.meta.resolve('pdfjs-dist/legacy/build/pdf.js'));
    fontUrl = join(dirname(pdfjsPath), '..', '..', 'standard_fonts') + '/';
  } catch (e) { fontUrl = undefined; }

  for (const fx of fixtures) {
    const path = join(fixturesDir, fx.file);
    if (!existsSync(path)) { console.log(`  ⚠️  fixture absente : ${fx.file} — ignoré`); continue; }
    const data = new Uint8Array(readFileSync(path));
    const doc = await pdfjs.getDocument({ data, standardFontDataUrl: fontUrl }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      pages.push(wordsFromTextContent(await pg.getTextContent()));
    }
    const rawMissions = missionsForPorter(pages, fx.porter, siteConfig);
    // Reproduit `missionFromRow` (src/ui/app.js) : defaults -> overlay ->
    // lieux par type -> lieu réel du bloc note appliqué APRÈS (voir
    // parser-pdf.js `rowToFields` / noteBlock.js).
    const missions = rawMissions.map((r) => {
      const m = createMission();
      Object.assign(m, r);
      applyPlaceDefaults(m, siteConfig.places);
      if (r.noteBlock) applyNoteBlock(m, r.noteBlock, siteConfig, { onlyIfEmpty: false });
      delete m.noteBlock;
      return m;
    });
    test(`${fx.file} / ${fx.porter}`, () => {
      if (fx.expect.count != null) assert.strictEqual(missions.length, fx.expect.count);
      if (fx.expect.firstVol) assert.strictEqual(missions[0].vol, fx.expect.firstVol);
      if (fx.expect.hasClient) {
        const m = missions.find((x) => x.client === fx.expect.hasClient);
        assert.ok(m, `client ${fx.expect.hasClient} introuvable`);
        if (fx.expect.clientPhone) assert.strictEqual(m.clientPhone, fx.expect.clientPhone);
      }
      if (fx.expect.hasVol) {
        const m = missions.find((x) => x.vol === fx.expect.hasVol);
        assert.ok(m, `vol ${fx.expect.hasVol} introuvable`);
        if (fx.expect.booking) assert.strictEqual(m.booking, fx.expect.booking);
        if (fx.expect.greeteur) assert.strictEqual(m.greeteur, fx.expect.greeteur);
      }
    });

    // Bloc « services » (missions agence) : vérifié uniquement sur le
    // fixture qui le contient — voir CLAUDE.md racine.
    if (fx.file === 'planning-25-services-block.pdf') {
      test(`${fx.file} / ${fx.porter} : bloc services (greetSign/bagages/détaxe/lieu réel)`, () => {
        // 11893-1 : Départ, "1 x BAGAGE STANDARD" (aucun supplémentaire),
        // Greet Sign "null", "1 x DÉPOSE-MINUTE", "1 x ASSISTANCE DÉTAXE".
        const depose = missions.find((m) => m.vol === 'AF7305');
        assert.ok(depose, 'mission AF7305 introuvable');
        assert.strictEqual(depose.greetSign, '');
        assert.strictEqual(depose.bagExpected, '4');
        assert.strictEqual(depose.bagStandard, '1'); // jamais écrasé, note affichée à part (voir CLAUDE.md §5 point 33)
        assert.strictEqual(depose.detaxe, 'Oui');
        assert.strictEqual(depose.lieuRencontre, 'Dépose minute');

        // 11878-1 : Arrivée, "1 x BAGAGE SUPPLÉMENTAIRE" (donc 4+1=5), Greet
        // Sign "Bader Alosaimi", "1 x PARKING PROFESSIONNEL VTC & TAXI".
        const arrivee = missions.find((m) => m.vol === 'KU181' && m.client === 'Bader Alosaimi');
        assert.ok(arrivee, 'mission Bader Alosaimi introuvable');
        assert.strictEqual(arrivee.greetSign, 'Bader Alosaimi');
        assert.strictEqual(arrivee.bagExpected, '5');
        assert.strictEqual(arrivee.bagStandard, '1');
        assert.strictEqual(arrivee.lieuDepose, 'Parking pro');
      });
    }

    // Bagages hors format + note libre au porteur ("N bags payé...") avant
    // Greet Sign — voir CLAUDE.md racine. Ce fixture contient aussi le cas de
    // régression du débordement de colonne (nom de Greet Sign long dont le
    // dernier mot dépasse la frontière col5/col6, voir `isNoteCol` dans
    // parser-pdf.js) : "Moshe Benish" et "Salame prince Bassam Omar" doivent
    // être capturés en entier, pas tronqués au premier mot.
    if (fx.file === 'planning-04-hors-format-note.pdf' && fx.porter === 'Stéphane M.') {
      test(`${fx.file} / ${fx.porter} : bagage hors format + note libre porteur`, () => {
        const m = missions.find((x) => x.vol === 'AF7314');
        assert.ok(m, 'mission AF7314 introuvable');
        assert.strictEqual(m.greetSign, 'Moshe Benish'); // nom complet malgré le débordement de colonne
        assert.strictEqual(m.bagExpected, '12'); // 4 inclus + 8 supplémentaires
        assert.strictEqual(m.bagHorsFormatExpected, '3');
        assert.strictEqual(m.bagStandard, '1'); // jamais écrasé
        assert.strictEqual(m.bagHorsFormat, '0'); // jamais écrasé
        assert.strictEqual(m.porterNote, '15 bags payé (si supp bags = a régler avec le porteur)');
      });
    }
    if (fx.file === 'planning-04-hors-format-note.pdf' && fx.porter === 'Thomas C.') {
      test(`${fx.file} / ${fx.porter} : nom de Greet Sign long capturé en entier`, () => {
        const m = missions.find((x) => x.vol === 'AZ354');
        assert.ok(m, 'mission AZ354 introuvable');
        assert.strictEqual(m.greetSign, 'Salame prince Bassam Omar');
        assert.strictEqual(m.bagExpected, '4');
        assert.strictEqual(m.bagHorsFormatExpected, '');
      });
    }
    if (fx.file === 'planning-04-hors-format-note.pdf' && fx.porter === 'Bastien D') {
      test(`${fx.file} / ${fx.porter} : bagage hors format non perdu par débordement Itinéraire→Véhicule`, () => {
        // Régression réelle (signalée par l'utilisateur) : sur cette mission
        // à itinéraire deux-étapes ("18:25 - ... N° Vol TK1815 , ...\n21:25 -
        // Parking Pro"), le code de vol et la virgule qui suit "N° Vol"
        // retombent côté colonne Véhicule (colOf() coupe la phrase en plein
        // milieu) et se retrouvaient intercalés dans noteBlockText entre
        // "HORS" et "FORMAT", cassant bagHorsFormat (voir CLAUDE.md racine
        // §5, stripLeakedFlightCode dans parser-pdf.js).
        const m = missions.find((x) => x.vol === 'TK1815');
        assert.ok(m, 'mission TK1815 introuvable');
        assert.strictEqual(m.greetSign, 'ZAIDAN');
        assert.strictEqual(m.bagExpected, '12'); // 4 inclus + 8 supplémentaires
        assert.strictEqual(m.bagHorsFormatExpected, '1'); // avant fix : '' (perdu)
        assert.strictEqual(m.lieuDepose, 'Parking pro');
      });
    }

    // Régression grave (signalée par l'utilisateur, « ça revient encore et
    // encore ») : le nom du CLIENT dans « Greet Sign: NOM » (bloc services)
    // peut avoir exactement la forme d'un nom de porteur (« Prénom SURNOM »
    // en majuscules, ex. « Christopher COMSTOCK ») et se faire compter à
    // tort comme porteur par `detectPorterLines` — gonflant son compte d'une
    // unité, cassant `ranked` (porterLines.length !== anchors.length) pour
    // TOUTE la page, et faisant retomber l'attribution de CHAQUE mission de
    // la page sur le repli fragile par bande. Résultat observé : la mission
    // de Yaris K. (booking 32180) était volée par Thomas C., avec le
    // panneau d'accueil de Thomas C. (Christopher Comstock) collé dessus.
    // Voir CLAUDE.md racine — `detectPorterLines` exclut désormais toute
    // ligne comprise entre « Greet Sign: » et sa borne de fin.
    if (fx.file === 'planning-09-greet-sign-porter-collision.pdf' && fx.porter === 'Thomas C.') {
      test(`${fx.file} / ${fx.porter} : le nom du client (Greet Sign) n'est jamais compté comme porteur`, () => {
        const m = missions.find((x) => x.vol === 'LH1059');
        assert.ok(m, 'mission LH1059 introuvable');
        assert.strictEqual(m.booking, '2026-002795');
        assert.strictEqual(m.client, 'EXCELLENCE AIRPORT');
        assert.strictEqual(m.greetSign, 'M. Christopher COMSTOCK');
        // La mission de Yaris K. (32180) ne doit jamais apparaître pour Thomas C.
        assert.ok(!missions.some((x) => x.booking === '32180'), 'mission 32180 volée à Yaris K.');
      });
    }
    if (fx.file === 'planning-09-greet-sign-porter-collision.pdf' && fx.porter === 'Yaris K.') {
      test(`${fx.file} / ${fx.porter} : garde sa propre mission, pas contaminée par le Greet Sign voisin`, () => {
        const m = missions.find((x) => x.vol === 'GF24');
        assert.ok(m, 'mission GF24 introuvable');
        assert.strictEqual(m.booking, '32180');
        assert.strictEqual(m.client, 'ACA ETIC');
        assert.strictEqual(m.greetSign, ''); // mission ACA classique, pas de bloc services
        // La mission de Thomas C. (Christopher Comstock) ne doit jamais apparaître pour Yaris K.
        assert.ok(!missions.some((x) => x.booking === '2026-002795'), 'mission de Thomas C. volée par Yaris K.');
      });
    }

    // Régression symétrique au point 39 (nom du client compté comme
    // porteur) : ici c'est un résidu d'Itinéraire (ville de destination,
    // numéro de terminal débordant en colonne Véhicule) qui se chaîne avec
    // le nom du porteur suivant sur la même bande Y et casse NAME_RE — le
    // porteur DISPARAÎT de porterLines au lieu qu'un client y soit ajouté
    // en trop, mais l'effet sur `ranked` (et donc sur l'attribution de
    // TOUTE la page) est le même. Voir CLAUDE.md racine.
    if (fx.file === 'planning-12-itinerary-name-bleed.pdf' && fx.porter === 'Ghassan S.') {
      test(`${fx.file} / ${fx.porter} : nom de porteur non perdu par débordement Itinéraire→Véhicule`, () => {
        const m = missions.find((x) => x.vol === 'GF0025');
        assert.ok(m, 'mission GF0025 introuvable (Ghassan S. non détecté comme porteur)');
        assert.strictEqual(m.booking, '32314');
        assert.strictEqual(m.greetSign, ''); // mission ACA classique, jamais contaminée par le Greet Sign voisin (Bounmy S / Naomi Tours)
      });
    }
    if (fx.file === 'planning-12-itinerary-name-bleed.pdf' && fx.porter === 'Bounmy S') {
      test(`${fx.file} / ${fx.porter} : garde son propre Greet Sign, pas volé par le porteur voisin`, () => {
        const m = missions.find((x) => x.vol === 'LY223');
        assert.ok(m, 'mission LY223 introuvable');
        assert.strictEqual(m.booking, '2026-002916');
        assert.strictEqual(m.client, 'Naomi Tours');
        assert.strictEqual(m.greetSign, 'Naomi Tours');
        // La mission de Ghassan S. ne doit jamais apparaître pour Bounmy S.
        assert.ok(!missions.some((x) => x.booking === '32314'), 'mission 32314 volée à Ghassan S.');
      });
    }
  }
}

await runPdfTests();

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);
