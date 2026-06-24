(function (global) {
  'use strict';

  var HEADERS = ['Mission', 'Date/Heures', 'Client', 'Itinéraire', 'Véhicule', 'Note', 'Type'];
  var DEFAULT_CENTERS = [41, 88, 174, 376, 538, 622, 716];

  var NAME_RE = /^([A-ZÉÈ][a-zà-ÿ]+(?:-[A-ZÉÈ][a-zà-ÿ]+)?\s+[A-ZÉÈ]\.?|[A-ZÉÈ][a-zà-ÿ]+\s+[A-Z]{2,})$/;
  var NAME_BLOCK_RE = /^(Flight|Greete?r|Note|Phone|Aviation|Class|Contact|Tablette|Powered)/i;
  var BOOKING_REF_RE = /^\d{4,6}-\d+$/;

  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  function tokenizeItem(item) {
    var x = item.transform[4];
    var yTop = -item.transform[5];
    var str = item.str;
    if (!str) return [];
    var width = item.width || 0;
    var parts = str.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return [{ x: x, y: yTop, text: norm(str) }];
    var out = [], cursor = 0, total = str.length;
    for (var i = 0; i < parts.length; i++) {
      var at = str.indexOf(parts[i], cursor);
      if (at < 0) at = cursor;
      cursor = at + parts[i].length;
      var frac = total > 0 ? at / total : 0;
      out.push({ x: x + frac * width, y: yTop, text: parts[i] });
    }
    return out;
  }

  function wordsFromTextContent(content) {
    var words = [];
    for (var i = 0; i < content.items.length; i++) {
      var t = tokenizeItem(content.items[i]);
      for (var j = 0; j < t.length; j++) words.push(t[j]);
    }
    return words;
  }

  function detectColumns(words) {
    var hits = {};
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var k = HEADERS.indexOf(w.text);
      if (k >= 0 && (!(k in hits) || w.y < hits[k].y)) hits[k] = { x: w.x, y: w.y };
    }
    var centers = DEFAULT_CENTERS.slice();
    var ys = [];
    for (var c = 0; c < 7; c++) if (hits[c]) { centers[c] = hits[c].x; ys.push(hits[c].y); }
    var headerBottom = ys.length ? Math.max.apply(null, ys) : -Infinity;
    return { centers: centers, headerBottom: headerBottom };
  }

  function colOf(x, centers) {
    for (var i = 0; i < centers.length - 1; i++) {
      if (x < (centers[i] + centers[i + 1]) / 2) return i;
    }
    return centers.length - 1;
  }

  function joinCol(cells, c) {
    return cells[c].slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; })
      .map(function (t) { return t.text; }).join(' ');
  }

  function joinCols(cells, cs) {
    var toks = [];
    for (var i = 0; i < cs.length; i++) toks = toks.concat(cells[cs[i]]);
    return toks.sort(function (a, b) { return a.y - b.y || a.x - b.x; })
      .map(function (t) { return t.text; }).join(' ');
  }

  function lineize(tokens) {
    var sorted = tokens.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var lines = [], cur = [], cy = null;
    for (var i = 0; i < sorted.length; i++) {
      var t = sorted[i];
      if (cy === null || Math.abs(t.y - cy) < 4) cur.push(t.text);
      else { lines.push(cur.join(' ')); cur = [t.text]; }
      cy = t.y;
    }
    if (cur.length) lines.push(cur.join(' '));
    return lines;
  }

  function nameFromLine(line) {
    var s = line.trim().replace(/^[,\s]*(NCE|Terminal)?\s*/, '').trim();
    var cands = [s.replace(/\s*\+?\d.*$/, '').trim(), s];
    for (var j = 0; j < cands.length; j++) {
      var c = cands[j];
      if (NAME_RE.test(c) && !NAME_BLOCK_RE.test(c)) return c;
    }
    return '';
  }

  function porterFromLines(lines) {
    for (var i = 0; i < lines.length; i++) {
      var n = nameFromLine(lines[i]);
      if (n) return n;
    }
    return '';
  }

  function lineHasPorter(lines, porter) {
    var re = new RegExp('(^|\\s)' + porter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)', 'i');
    for (var i = 0; i < lines.length; i++) if (re.test(lines[i])) return true;
    return false;
  }

  function phoneNorm(s) {
    var c = (s || '').replace(/[^\d+]/g, '');
    // Must start with + or 0 (rejects false positives like "20486466" from timestamps)
    if (!/^[+0]/.test(c)) return '';
    return c.length >= 9 ? c : '';
  }

  function greeterInfoFromLines(lines, porter) {
    // Pass 1: explicit "Greeter: NAME" label
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/greete?r[s]?[\s:,]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\-]*)/i);
      if (m) {
        var gname = m[1].trim();
        if (['a', 'à', 'venir', 'voir'].indexOf(gname.toLowerCase()) === -1) {
          // Phone: inline (rest of line after name) or next line
          var afterName = lines[i].slice(lines[i].indexOf(gname) + gname.length);
          var pm = afterName.match(/([+?]\d[\d\s?]{7,}|\d{8,}[\d\s?]*)/);
          var phone = pm ? phoneNorm(pm[1]) : '';
          if (!phone && i + 1 < lines.length) {
            var nm = lines[i + 1].match(/^\s*([+?]?\d[\d\s?]{8,})/);
            if (nm) phone = phoneNorm(nm[1]);
          }
          return { name: gname, phone: phone };
        }
      }
    }
    // Pass 2: fallback — name followed by phone (no "Greeter:" label)
    var self = porter ? porter.replace(/\.$/, '') : '';
    var porterSeen = !porter;
    for (var j = 0; j < lines.length; j++) {
      var t = lines[j].trim();
      if (porter && t.replace(/\.$/, '') === self) { porterSeen = true; continue; }
      if (!porterSeen) continue;
      var gm = t.match(/^([A-ZÀ-Ý][A-Za-zÀ-ÿ.\-]+)\s+([+?]?\d[\d\s?]{7,})/);
      if (gm && !/^(Phone|Flight|Note|Chauff|Greete?r|NCE|Terminal|Aviation)$/i.test(gm[1]) && gm[1].replace(/\.$/, '') !== self) {
        return { name: gm[1], phone: phoneNorm(gm[2]) };
      }
    }
    return { name: '', phone: '' };
  }

  function contactPhoneFrom(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (/contact\s+chauffeur/i.test(lines[i])) {
        // Phone inline on same line
        var rm = lines[i].match(/contact\s+chauffeur[^+\d\n]{0,15}([+?]?\d[\d\s?]{8,})/i);
        if (rm) return phoneNorm(rm[1]);
        // Phone on next line
        if (i + 1 < lines.length) {
          var nm = lines[i + 1].match(/([+?]?\d[\d\s?]{8,})/);
          if (nm) return phoneNorm(nm[1]);
        }
      }
    }
    return '';
  }

  function flightFromItinerary(itinRaw) {
    var itin = itinRaw.replace(/(^|\s)NCE(?=\s|$)/g, ' ');
    // Accept: letter(s) + optional space + digits (covers "BA 328") OR plain alphanumeric up to 7 chars
    var m = itin.match(/N[°o]\s*Vol\s*([A-Za-z]{1,3}\s*\d{1,5}[A-Za-z]?|[A-Za-z0-9]{2,7})/i);
    if (!m) return { vol: '', terminal: '' };
    var vol = m[1].replace(/\s+/g, '').toUpperCase();
    var after = itin.slice(m.index + m[0].length);
    // Negative lookahead (?![\d:]) prevents matching timestamps like "19:00:00" as terminal "19"
    var tm = after.match(/Terminal\s*(T?\d{1,2})(?![\d:])/) || after.match(/Terminal\s*([A-Z])(?=\s)/);
    var term = tm ? tm[1].replace(/^T/i, '') : '';
    if (term && !/^(\d{1,2}|[A-Z])$/.test(term)) term = '';
    return { vol: vol, terminal: term };
  }

  function clientFromColumn(c2) {
    if (/ACA \(A[ée]roport/.test(c2)) return { tok: 'ACA', label: 'ACA ETIC' };
    if (/Monaco Mediax/.test(c2)) return { tok: 'Monaco', label: 'Monaco Mediax' };
    if (/WELL'COM/.test(c2)) return { tok: 'WELLCOM', label: "WELL'COM AIR" };
    var br = c2.match(/^(.*?)\s*\[(20\d{2}-\d{6})\]/);
    if (br) return { tok: 'AGENCY', ref: br[2], label: norm(br[1]).replace(/^M\.\s*/, '') };
    // ALL-CAPS group clients: "GM FINANCIAL CHILE (3)…", "WD CONSEILS (1)…"
    var gc = c2.match(/^([A-Z][A-Z0-9\s'.&\-]{3,}[A-Z0-9])(?=\s*[\(\d]|\s*$)/);
    if (gc) return { tok: 'OTHER', label: gc[1].trim() };
    return { tok: '', label: '' };
  }

  function paxFromColumn(c2) {
    var m = c2.match(/\((\d+)\)/);
    return m ? m[1] : '';
  }

  function lieuFor(type, itin) {
    if (/D[ée]pose-?\s*minute/i.test(itin)) return 'Dépose minute';
    if (/Parking\s*Pro/i.test(itin)) return 'Parking pro';
    return type === 'ARR' ? 'Tapis bagage' : 'AUTO_CHECKIN';
  }

  function detectPorterLines(words, centers) {
    var toks = [];
    for (var i = 0; i < words.length; i++) {
      var c = colOf(words[i].x, centers);
      if (c === 4 || c === 5) toks.push(words[i]);
    }
    toks.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var lines = [], cur = [], cy = null, cyHead = null;
    for (var t = 0; t < toks.length; t++) {
      if (cy === null || Math.abs(toks[t].y - cy) < 4) cur.push(toks[t].text);
      else { lines.push({ y: cyHead, text: cur.join(' ') }); cur = [toks[t].text]; cyHead = toks[t].y; }
      if (cy === null) cyHead = toks[t].y;
      cy = toks[t].y;
    }
    if (cur.length) lines.push({ y: cyHead, text: cur.join(' ') });
    var out = [];
    for (var k = 0; k < lines.length; k++) {
      var n = nameFromLine(lines[k].text);
      if (n) out.push({ y: lines[k].y, name: n });
    }
    return out;
  }

  function reconstructPage(words) {
    var col = detectColumns(words);
    var centers = col.centers, hb = col.headerBottom;
    var anchors = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (colOf(w.x, centers) === 0 && BOOKING_REF_RE.test(w.text) && w.y > hb + 3) {
        anchors.push({ y: w.y, ref: w.text });
      }
    }
    anchors.sort(function (a, b) { return a.y - b.y; });
    if (!anchors.length) return [];

    var bounds = [hb + 3];
    for (var k = 1; k < anchors.length; k++) bounds.push((anchors[k - 1].y + anchors[k].y) / 2);
    bounds.push(Infinity);

    var porterLines = detectPorterLines(words, centers);
    var ranked = porterLines.length === anchors.length;

    var rows = [];
    for (var a = 0; a < anchors.length; a++) {
      var top = bounds[a], bot = bounds[a + 1];
      var cells = [[], [], [], [], [], [], []];
      for (var n = 0; n < words.length; n++) {
        var ww = words[n];
        if (ww.y >= top && ww.y < bot) cells[colOf(ww.x, centers)].push(ww);
      }
      var vn = lineize(cells[4].concat(cells[5]));
      rows.push({
        ref: anchors[a].ref,
        c0: joinCol(cells, 0),
        c1: joinCol(cells, 1),
        c2: joinCol(cells, 2),
        itin: joinCols(cells, [3, 4]),
        c6: joinCol(cells, 6),
        vn: vn,
        porter: ranked ? porterLines[a].name : porterFromLines(vn),
        ranked: ranked,
        anchorY: anchors[a].y
      });
    }
    return rows;
  }

  function rowToFields(row) {
    var mnum = row.c0.match(/M#\s*(\d+)/);
    var client = clientFromColumn(row.c2);
    var isACA = client.tok === 'ACA' || (!client.tok && !!mnum);
    var booking = isACA ? (mnum ? mnum[1] : row.ref)
      : (client.ref || row.ref);

    var fl = flightFromItinerary(row.itin);
    var type = /Arriv/i.test(row.c6) ? 'ARR' : (/D.?part/i.test(row.c6) ? 'DEP' : '');
    if (!type) { if (/Arriv/i.test(row.itin)) type = 'ARR'; else if (/D.?part/i.test(row.itin)) type = 'DEP'; }

    var date = '';
    var dm = row.c1.match(/(\d{2})\/(\d{2})\/\d{4}/);
    if (dm) date = dm[1] + '/' + dm[2];

    var sortTime = 9999;
    var tm = row.c1.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (tm) sortTime = parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10);

    var isService = !fl.vol && /\bService\b/i.test(row.c6 + ' ' + row.itin);

    var greeterInfo = greeterInfoFromLines(row.vn, row.porter);
    return {
      booking: booking,
      date: date,
      vol: isService ? '' : fl.vol,
      terminal: isService ? '' : fl.terminal,
      type: isService ? 'Service' : type,
      client: isACA ? 'ACA ETIC' : client.label,
      greeteur: client.tok === 'AGENCY' ? '' : greeterInfo.name,
      greeteurPhone: client.tok === 'AGENCY' ? '' : greeterInfo.phone,
      contactPhone: '',  // filled by enrichMissionsWithPhones (full-text search, avoids band-bleed)
      pax: paxFromColumn(row.c2),
      prebooking: 'PRÉ-BOOKING',
      lieuDepose: isService ? '' : lieuFor(type, row.itin),
      sortTime: sortTime,
      srcPos: row.anchorY,
      bookingOptions: [],
      flightOptions: []
    };
  }

  function fromPages(pages, porterName) {
    var raw = [];
    for (var p = 0; p < pages.length; p++) {
      var rows = reconstructPage(pages[p]);
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var hit = row.ranked ? (row.porter === porterName)
          : (row.porter === porterName || lineHasPorter(row.vn, porterName));
        if (hit) raw.push(rowToFields(row));
      }
    }
    var seen = {}, out = [];
    for (var i = 0; i < raw.length; i++) {
      var key = (raw[i].booking || '') + '|' + (raw[i].vol || '');
      if (seen[key]) continue;
      seen[key] = 1; out.push(raw[i]);
    }
    out.sort(function (a, b) {
      var ta = a.sortTime || 9999, tb = b.sortTime || 9999;
      return ta !== tb ? ta - tb : (a.srcPos || 0) - (b.srcPos || 0);
    });
    return out;
  }

  global.MissionParser = {
    wordsFromTextContent: wordsFromTextContent,
    fromPages: fromPages
  };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
