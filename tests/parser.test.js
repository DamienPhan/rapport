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

console.log('\n── Tests d\'intégration (PDF de référence) ───────────');

const fixturesDir = join(__dirname, 'fixtures');
const fixtures = [
  { file: 'Mission-2026-06-22_22_11.pdf', porter: 'Yaris K.', expect: { count: 3, firstVol: 'DL0028' } },
  { file: 'planning-30.pdf', porter: 'Damien P.', expect: { hasClient: 'MY FRENCH RIVIERA', clientPhone: '+966505609430' } },
  { file: 'planning-30.pdf', porter: 'Yanis P.', expect: { hasClient: 'DC Aviation G-OPS' } },
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
    const missions = missionsForPorter(pages, fx.porter, siteConfig);
    test(`${fx.file} / ${fx.porter}`, () => {
      if (fx.expect.count != null) assert.strictEqual(missions.length, fx.expect.count);
      if (fx.expect.firstVol) assert.strictEqual(missions[0].vol, fx.expect.firstVol);
      if (fx.expect.hasClient) {
        const m = missions.find((x) => x.client === fx.expect.hasClient);
        assert.ok(m, `client ${fx.expect.hasClient} introuvable`);
        if (fx.expect.clientPhone) assert.strictEqual(m.clientPhone, fx.expect.clientPhone);
      }
    });
  }
}

await runPdfTests();

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);
