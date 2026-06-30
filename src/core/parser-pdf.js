/**
 * Moteur d'extraction PDF par reconstruction de table via coordonnées
 * spatiales (à partir de la sortie pdf.js `getTextContent`).
 *
 * Module pur (aucune dépendance DOM). Toute spécificité de site provient de
 * `config` (siteConfig) passé en paramètre — aucun littéral propre à NCE ici.
 */
import { normalizePhone, extractClientPhone } from './phone.js';

const NAME_RE = /^([A-ZÉÈ][a-zà-ÿ]+(?:-[A-ZÉÈ][a-zà-ÿ]+)?\s+[A-ZÉÈ]\.?|[A-ZÉÈ][a-zà-ÿ]+\s+[A-Z]{2,})$/;
const NAME_BLOCK_RE = /^(Flight|Greete?r|Note|Phone|Aviation|Class|Contact|Tablette|Powered)/i;
const BOOKING_REF_RE = /^\d{4,6}-\d+$/;

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

function tokenizeItem(item) {
  const x = item.transform[4];
  const yTop = -item.transform[5];
  const str = item.str;
  if (!str) return [];
  const width = item.width || 0;
  const parts = str.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return [{ x, y: yTop, text: norm(str) }];
  const out = [];
  let cursor = 0;
  const total = str.length;
  for (const part of parts) {
    let at = str.indexOf(part, cursor);
    if (at < 0) at = cursor;
    cursor = at + part.length;
    const frac = total > 0 ? at / total : 0;
    out.push({ x: x + frac * width, y: yTop, text: part });
  }
  return out;
}

/** Convertit la sortie pdf.js d'une page en liste de mots positionnés. */
export function wordsFromTextContent(content) {
  const words = [];
  for (const item of content.items) {
    for (const t of tokenizeItem(item)) words.push(t);
  }
  return words;
}

function detectColumns(words, cfg) {
  const headers = cfg.pdfTable.headers;
  const hits = {};
  for (const w of words) {
    const k = headers.indexOf(w.text);
    if (k >= 0 && (!(k in hits) || w.y < hits[k].y)) hits[k] = { x: w.x, y: w.y };
  }
  const centers = cfg.pdfTable.defaultCenters.slice();
  const ys = [];
  for (let c = 0; c < cfg.pdfTable.columnCount; c++) {
    if (hits[c]) { centers[c] = hits[c].x; ys.push(hits[c].y); }
  }
  const headerBottom = ys.length ? Math.max(...ys) : -Infinity;
  return { centers, headerBottom };
}

function colOf(x, centers) {
  for (let i = 0; i < centers.length - 1; i++) {
    if (x < (centers[i] + centers[i + 1]) / 2) return i;
  }
  return centers.length - 1;
}

function joinCol(cells, c) {
  return cells[c].slice().sort((a, b) => a.y - b.y || a.x - b.x)
    .map((t) => t.text).join(' ');
}

function joinCols(cells, cs) {
  let toks = [];
  for (const c of cs) toks = toks.concat(cells[c]);
  return toks.sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.text).join(' ');
}

function lineize(tokens) {
  const sorted = tokens.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  let cur = [];
  let cy = null;
  for (const t of sorted) {
    if (cy === null || Math.abs(t.y - cy) < 4) cur.push(t.text);
    else { lines.push(cur.join(' ')); cur = [t.text]; }
    cy = t.y;
  }
  if (cur.length) lines.push(cur.join(' '));
  return lines;
}

function nameFromLine(line) {
  const s = line.trim().replace(/^[,\s]*(NCE|Terminal)?\s*/, '').trim();
  const cands = [s.replace(/\s*\+?\d.*$/, '').trim(), s];
  for (const c of cands) {
    if (NAME_RE.test(c) && !NAME_BLOCK_RE.test(c)) return c;
  }
  return '';
}

function porterFromLines(lines) {
  for (const line of lines) {
    const n = nameFromLine(line);
    if (n) return n;
  }
  return '';
}

function lineHasPorter(lines, porter) {
  const re = new RegExp('(^|\\s)' + porter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)', 'i');
  return lines.some((l) => re.test(l));
}

function greeterInfoFromLines(lines, porter, cfg) {
  const blockWords = cfg.noteLabels.greeterBlockWords;
  // Passe 1 : libellé explicite « Greeter: NOM »
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/greete?r[s]?[\s:,]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\-]*)/i);
    if (m) {
      const gname = m[1].trim();
      if (blockWords.indexOf(gname.toLowerCase()) === -1) {
        const afterName = lines[i].slice(lines[i].indexOf(gname) + gname.length);
        const pm = afterName.match(/([+?]\d[\d\s?]{7,}|\d{8,}[\d\s?]*)/);
        let phone = pm ? normalizePhone(pm[1], cfg.phone) : '';
        if (!phone && i + 1 < lines.length) {
          const nm = lines[i + 1].match(/^\s*([+?]?\d[\d\s?]{8,})/);
          if (nm) phone = normalizePhone(nm[1], cfg.phone);
        }
        return { name: gname, phone };
      }
    }
  }
  // Passe 2 : repli — nom suivi d'un téléphone, sans libellé
  const self = porter ? porter.replace(/\.$/, '') : '';
  let porterSeen = !porter;
  for (const raw of lines) {
    const t = raw.trim();
    if (porter && t.replace(/\.$/, '') === self) { porterSeen = true; continue; }
    if (!porterSeen) continue;
    const gm = t.match(/^([A-ZÀ-Ý][A-Za-zÀ-ÿ.\-]+)\s+([+?]?\d[\d\s?]{7,})/);
    if (gm && !/^(Phone|Flight|Note|Chauff|Greete?r|NCE|Terminal|Aviation)$/i.test(gm[1])
        && gm[1].replace(/\.$/, '') !== self) {
      return { name: gm[1], phone: normalizePhone(gm[2], cfg.phone) };
    }
  }
  return { name: '', phone: '' };
}

function flightFromItinerary(itinRaw, cfg) {
  const code = cfg.site.airportCode;
  const itin = itinRaw.replace(new RegExp('(^|\\s)' + code + '(?=\\s|$)', 'g'), ' ');
  const m = itin.match(cfg.itinerary.flightPattern);
  if (!m) return { vol: '', terminal: '' };
  const vol = m[1].replace(/\s+/g, '').toUpperCase();
  const after = itin.slice(m.index + m[0].length);
  const tm = after.match(cfg.itinerary.terminalNumeric) || after.match(cfg.itinerary.terminalLetter);
  let term = tm ? tm[1].replace(/^T/i, '') : '';
  if (term && !/^(\d{1,2}|[A-Z])$/.test(term)) term = '';
  return { vol, terminal: term };
}

function clientFromColumn(c2, cfg) {
  const phone = extractClientPhone(c2);
  for (const d of cfg.clients.direct) {
    if (d.match.test(c2)) return { tok: d.token, label: d.label, phone };
  }
  const br = c2.match(cfg.clients.agencyRefPattern);
  if (br) return { tok: 'AGENCY', ref: br[2], label: norm(br[1]).replace(/^M\.\s*/, ''), phone };
  const gc = c2.match(cfg.clients.groupCapsPattern);
  if (gc) return { tok: 'OTHER', label: gc[1].trim(), phone };
  return { tok: '', label: '', phone };
}

function paxFromColumn(c2) {
  const m = c2.match(/\((\d+)\)/);
  return m ? m[1] : '';
}

function lieuFor(type, itin, cfg) {
  if (cfg.itinerary.depositMinute.test(itin)) return 'Dépose minute';
  if (cfg.itinerary.proParking.test(itin)) return 'Parking pro';
  return type === 'ARR' ? cfg.places.arrDropFallback : cfg.places.depDropFallback;
}

function detectPorterLines(words, centers, noteCols) {
  const toks = [];
  for (const w of words) {
    const c = colOf(w.x, centers);
    if (noteCols.indexOf(c) >= 0) toks.push(w);
  }
  toks.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  let cur = [];
  let cy = null;
  let cyHead = null;
  for (const tok of toks) {
    if (cy === null || Math.abs(tok.y - cy) < 4) cur.push(tok.text);
    else { lines.push({ y: cyHead, text: cur.join(' ') }); cur = [tok.text]; cyHead = tok.y; }
    if (cy === null) cyHead = tok.y;
    cy = tok.y;
  }
  if (cur.length) lines.push({ y: cyHead, text: cur.join(' ') });
  const out = [];
  for (const l of lines) {
    const n = nameFromLine(l.text);
    if (n) out.push({ y: l.y, name: n });
  }
  return out;
}

function reconstructPage(words, cfg) {
  const col = detectColumns(words, cfg);
  const { centers, headerBottom: hb } = col;
  const bookingCol = cfg.pdfTable.bookingColumn;
  const noteCols = cfg.pdfTable.noteColumns;

  const anchors = [];
  for (const w of words) {
    if (colOf(w.x, centers) === bookingCol && BOOKING_REF_RE.test(w.text) && w.y > hb + 3) {
      anchors.push({ y: w.y, ref: w.text });
    }
  }
  anchors.sort((a, b) => a.y - b.y);
  if (!anchors.length) return [];

  const bounds = [hb + 3];
  for (let k = 1; k < anchors.length; k++) bounds.push((anchors[k - 1].y + anchors[k].y) / 2);
  bounds.push(Infinity);

  const porterLines = detectPorterLines(words, centers, noteCols);
  const ranked = porterLines.length === anchors.length;

  const rows = [];
  for (let a = 0; a < anchors.length; a++) {
    const top = bounds[a];
    const bot = bounds[a + 1];
    const cells = Array.from({ length: cfg.pdfTable.columnCount }, () => []);
    for (const w of words) {
      if (w.y >= top && w.y < bot) cells[colOf(w.x, centers)].push(w);
    }
    const vn = lineize(noteCols.reduce((acc, c) => acc.concat(cells[c]), []));
    rows.push({
      ref: anchors[a].ref,
      c0: joinCol(cells, bookingCol),
      c1: joinCol(cells, 1),
      c2: joinCol(cells, cfg.pdfTable.clientColumn),
      itin: joinCols(cells, [3, 4]),
      c6: joinCol(cells, 6),
      vn,
      porter: ranked ? porterLines[a].name : porterFromLines(vn),
      ranked,
      anchorY: anchors[a].y,
    });
  }
  return rows;
}

function rowToFields(row, cfg) {
  const mnum = row.c0.match(/M#\s*(\d+)/);
  const client = clientFromColumn(row.c2, cfg);
  const isAirport = client.tok === cfg.clients.airportToken || (!client.tok && !!mnum);
  const booking = isAirport ? (mnum ? mnum[1] : row.ref) : (client.ref || row.ref);

  const fl = flightFromItinerary(row.itin, cfg);
  let type = /Arriv/i.test(row.c6) ? 'ARR' : (/D.?part/i.test(row.c6) ? 'DEP' : '');
  if (!type) {
    if (/Arriv/i.test(row.itin)) type = 'ARR';
    else if (/D.?part/i.test(row.itin)) type = 'DEP';
  }

  let date = '';
  const dm = row.c1.match(/(\d{2})\/(\d{2})\/\d{4}/);
  if (dm) date = dm[1] + '/' + dm[2];

  let sortTime = 9999;
  const tm = row.c1.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (tm) sortTime = parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10);

  const isService = !fl.vol && /\bService\b/i.test(row.c6 + ' ' + row.itin);
  const greeterInfo = greeterInfoFromLines(row.vn, row.porter, cfg);

  return {
    booking,
    date,
    vol: isService ? '' : fl.vol,
    terminal: isService ? '' : fl.terminal,
    type: isService ? 'Service' : type,
    client: isAirport ? cfg.clients.airportLabel : client.label,
    greeteur: client.tok === 'AGENCY' ? '' : greeterInfo.name,
    greeteurPhone: client.tok === 'AGENCY' ? '' : greeterInfo.phone,
    contactPhone: '', // rempli par enrichWithPhones (texte complet, évite le débordement de bande)
    clientPhone: client.phone || '',
    pax: paxFromColumn(row.c2),
    prebooking: 'PRÉ-BOOKING',
    lieuDepose: isService ? '' : lieuFor(type, row.itin, cfg),
    sortTime,
    srcPos: row.anchorY,
    bookingOptions: [],
    flightOptions: [],
  };
}

/**
 * Extrait toutes les missions d'un porteur donné depuis les pages PDF.
 * @param {Array} pages  tableau de listes de mots (wordsFromTextContent)
 * @param {string} porterName
 * @param {object} cfg  siteConfig
 * @returns {object[]} missions, triées par heure puis position source
 */
export function missionsForPorter(pages, porterName, cfg) {
  const raw = [];
  for (const page of pages) {
    for (const row of reconstructPage(page, cfg)) {
      const hit = row.ranked
        ? (row.porter === porterName)
        : (row.porter === porterName || lineHasPorter(row.vn, porterName));
      if (hit) raw.push(rowToFields(row, cfg));
    }
  }
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const key = (r.booking || '') + '|' + (r.vol || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  out.sort((a, b) => {
    const ta = a.sortTime || 9999;
    const tb = b.sortTime || 9999;
    return ta !== tb ? ta - tb : (a.srcPos || 0) - (b.srcPos || 0);
  });
  return out;
}
