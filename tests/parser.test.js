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
import { generateReportText } from '../src/core/report.js';
import { normalizePhone, extractClientPhone } from '../src/core/phone.js';
import { enrichWithPhones, enrichWithNotes } from '../src/core/enrich.js';
import { applyNoteBlock } from '../src/core/noteBlock.js';
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
  assert.strictEqual(m2.lieuRencontre, 'Dépose minute');
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
    { booking: '11894-1', type: 'DEP', greetSign: '', bagStandard: '1', detaxe: 'Non', lieuRencontre: 'Dépose minute', lieuDepose: 'AUTO_CHECKIN' },
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
      if (r.noteBlock) applyNoteBlock(m, r.noteBlock, { onlyIfEmpty: false });
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
  }
}

await runPdfTests();

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);
