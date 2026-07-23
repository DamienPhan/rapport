/**
 * Moteur d'extraction « copier-coller » (texte brut du planning).
 * Heuristique de regroupement par mission, avec jugement local de propreté.
 * Module pur (aucune dépendance DOM). La spécificité de site provient de `cfg`.
 *
 * NB : ce moteur est le repli quand l'import PDF par coordonnées n'est pas
 * disponible. Le chemin PDF (parser-pdf.js) reste prioritaire et plus fiable.
 */
import { createMission, todayStr, applyPlaceDefaults } from './mission.js';

function escapeRegex(s){
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPdfjsSerialization(text){
  const lines=text.split('\n'); let mixed=0;
  for(const l of lines){
    if(/\d{4,6}-\d+/.test(l) && /(ACA \(|Monaco Mediax|WELL'COM)/.test(l) && /\+?\d{2}\s?\d/.test(l)) mixed++;
    if(mixed>=3) return true;
  }
  return false;
}

function extractMissionsPdfjs(text, porterName){
  const lines=text.split('\n');
  const NAME_TOKEN=/(^|\s)([A-ZÉÈ][a-zà-ÿ]+(?:-[A-ZÉÈ][a-zà-ÿ]+)?\s+[A-ZÉÈ]\.|[A-ZÉÈ][a-zà-ÿ]+\s+[A-Z]{3,}|[A-ZÉÈ][a-zà-ÿ]+\s+[A-Z])(\s|$)/g;
  const BLOCK=/^(Client|Flight|Note|Contact|Tablette|Greete?r|Chauff|Mission|Itin|Powered|Terminal|Bagage|Standard|Service|VIP|LIVE|Festival|Carlo|Monte|Aéroport)\b/;
  const CITY=/\b(Nice|Paris|London|Dubai|Newark|Boston|Atlanta|Zurich|Istanbul|Dulles|Doha|Naples|Amsterdam|Rome|Lille|Brussels|Sofia|Frankfurt|Philadelphia|Montreal|Tel|Aviv|Chisinau|Budapest)\b/;
  function anchorLines(){
    const a=[];
    for(let i=0;i<lines.length;i++){ let m; NAME_TOKEN.lastIndex=0;
      while((m=NAME_TOKEN.exec(lines[i]))!==null){ const n=m[2].trim();
        if(BLOCK.test(n)||CITY.test(n)) continue; a.push(i); break; } }
    return a;
  }
  function nameOnLine(line){
    const esc=porterName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp('(^|\\s)'+esc+'(\\s|$)').test(line);
  }
  const anchors=anchorLines();
  const out=[];
  for(let i=0;i<lines.length;i++){
    if(!nameOnLine(lines[i])) continue;
    let prev=-1,next=lines.length;
    for(const a of anchors){ if(a<i) prev=a; if(a>i){ next=a; break; } }
    const lo=Math.max(0, Math.max(prev+1, i-3));
    const hi=Math.min(lines.length, Math.max(next, i+3));
    const W=lines.slice(lo,hi).join('\n');

    let clientTok='',mnum='',clientRef='',booking='';
    let bestB=null,bd=1e9;
    lines.slice(lo,hi).forEach((l,k)=>{const m=l.match(/\b(\d{4,6}-\d+)\b/);if(m&&!/^20\d{2}-\d{6}$/.test(m[1])){const d=Math.abs((lo+k)-i);if(d<bd){bd=d;bestB={ref:m[1],line:lo+k};}}});
    if(bestB){booking=bestB.ref;const bl=lines[bestB.line];
      if(/ACA \(/.test(bl))clientTok='ACA';else if(/Monaco/.test(bl))clientTok='Monaco';else if(/WELL'COM/.test(bl))clientTok='WELLCOM';}
    // W_after: window starting at the porter's line — used for M#, clientRef, greeter
    // to avoid bleeding data from the PREVIOUS mission into this one.
    const W_after = lines.slice(i, hi).join('\n');
    const mM=W_after.match(/M#+\s*(\d+)/);if(mM)mnum=mM[1];
    const crM=W_after.match(/\[(20\d{2}-\d{6})\]/);if(crM){clientRef=crM[1];if(!clientTok)clientTok='AGENCY';}
    let vol='',term='';
    const vM=W.match(/N[°o]\s*Vol\s*([A-Za-z]{2,3}\s*\d{2,5}|[A-Za-z0-9]{2,7})/i);
    if(vM){vol=vM[1].replace(/\s/g,'').toUpperCase();
      const afterVol=W.slice(W.indexOf(vM[0]));
      const tail=afterVol.replace(/^.*?Terminal\s*/,'');
      let tm=afterVol.match(/Terminal\s*(T?\d{1,2}|[A-Z](?=\s))\b/);
      if(!tm) tm=afterVol.match(/Terminal\s*\n[^\n]*?\b(\d{1,2}|[A-Z])\s+[A-Z]/);
      if(!tm) tm=afterVol.match(/\b(\d{1,2})\s+[A-Z][a-z]/);
      if(tm) term=tm[1].replace(/^T/i,'');
      if(/^(Naples|Sofia|Chisinau)\b/.test(tail) && !/^\d/.test(term)) term='';
    }
    let type=''; if(/Arriv/i.test(W))type='ARR';else if(/D.?part/i.test(W))type='DEP';
    // Greeter: only search AFTER the porter line (not before) to avoid
    // bleeding the previous mission's greeter into this window.
    // (W_after already declared above — reused here)
    let greeter=''; const gm2=W_after.match(/gre{1,2}t{1,2}e?r[\s:]*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\-]*)/i);
    if(gm2){ const gn=gm2[1].trim(); if(!['a','à','venir','voir'].includes(gn.toLowerCase())) greeter=gn; }
    // WELL'COM AIR: check whole window (not just booking ref line)
    if(!clientTok && /WELL'COM\s+AIR/i.test(W)) clientTok='WELLCOM';
    const isACA=clientTok==='ACA'||(!clientTok&&mnum);
    const finalBooking=isACA?(mnum||booking):(clientRef||booking);

    // Agency client name: "M. NAME +phone" most reliable; fallback: "NAME [2026-XXXXXX]"
    let agencyClientName='', agencyClientPhone='';
    if(clientTok==='AGENCY' && clientRef){
      const mM=W.match(/M\.\s+([A-Za-z\xc0-\xff][A-Za-z\xc0-\xff.' \-]+?)(?=\s+\+\d|\s+(?:Terminal\s+)?T[12]\s+\d{2}:)/i);
      if(mM) agencyClientName=mM[1].trim();
      else {
        const bkEsc=clientRef.replace(/[-]/g,'[-]');
        const agM=W.match(new RegExp('([A-Za-z\xc0-\xff][A-Za-z\xc0-\xff.\' \\-]+?)\\s*\\['+bkEsc+'\\]'));
        if(agM) agencyClientName=agM[1].trim().replace(/^M\.\s*/,'');
      }
      const cpM=W.match(/M\.\s+[A-Za-z\xc0-\xff][A-Za-z\xc0-\xff.'\s\-]*?\s+([+]\d[\d ]{7,}\d)/);
      if(cpM) agencyClientPhone=cpM[1].replace(/\s+/g,'');
    }

    const m=createMission();
    m.prebooking='PRÉ-BOOKING';
    const dm=W.match(/(\d{2})\/(\d{2})\/\d{4}/);
    m.date = dm ? dm[1]+'/'+dm[2] : todayStr();
    m.booking=finalBooking; m.vol=vol; m.terminal=term; m.type=type;
    m.client=isACA?'ACA ETIC':clientTok==='Monaco'?'Monaco Mediax':clientTok==='WELLCOM'?"WELL'COM AIR":agencyClientName;
    m.clientPhone=agencyClientPhone;
    m.greeteur=greeter;
    // Pax: search "(N)" after the booking ref in full text (avoids bleeding from adjacent missions)
    if(finalBooking){
      const bkPos=text.indexOf(finalBooking);
      const paxWin=bkPos>=0?text.slice(bkPos,bkPos+200):'';
      const paxScM=paxWin.match(/\((\d+)\)/);
      if(paxScM) m.pax=paxScM[1];
    }
    m.greeteur=greeter;
    m.lieuDepose = type==='ARR' ? 'Tapis bagage' : 'AUTO_CHECKIN';
    if(/D[ée]pose-?\s*minute/i.test(W)) m.lieuDepose='Dépose minute';
    else if(/Parking\s*Pro/i.test(W)) m.lieuDepose='Parking pro';
    m.bookingOptions=[]; m.flightOptions=[];
    out.push(m);
  }
  const seen=new Set(); const dedup=[];
  for(const mm of out){ const k=(mm.booking||'')+'|'+(mm.vol||''); if(seen.has(k))continue; seen.add(k); dedup.push(mm); }
  return dedup;
}

function extractMissions(text, porterName, cfg){
  let r;
  if(isPdfjsSerialization(text)){
    r = extractMissionsPdfjs(text, porterName);
    if(!r.length) r = extractMissionsCopyPaste(text, porterName);
  } else {
    r = extractMissionsCopyPaste(text, porterName);
  }
  r.forEach(m => applyPlaceDefaults(m, cfg.places));
  return r;
}

function extractMissionsCopyPaste(text, porterName){
  // ---------------------------------------------------------------------------
  // Two serialisations exist:
  //  (1) "copier-coller" : columns are dumped per sub-section inside a cluster
  //      (all bookings, then all flights, then all notes/porters, then all types).
  //  (2) pdf.js          : rows are locally coherent.
  // Clean rows (one booking + one flight in the immediate row) are handled by a
  // fast-path identical to before. Scrambled clusters are resolved by RANK
  // ALIGNMENT inside the cluster: the Nth porter ↔ Nth booking/flight/type.
  // The gate trusts an assignment only when booking-rows, flights and porters
  // agree in count (these retain cancelled slots); client/type are aligned when
  // their own counts match, else derived per-row with safe fallbacks; otherwise
  // chips are shown (no silent wrong guess).
  // ---------------------------------------------------------------------------
  const found = [];

  // ---- shared helpers ----
  const HEADER = /Mission\s+Date\/Heures\s+Client/gi;

  function clusterSpans(){
    let m, H=[]; HEADER.lastIndex=0;
    while((m=HEADER.exec(text))!==null) H.push(m.index);
    return H;
  }

  function tokBookingRows(sec){
    const lines=sec.split('\n'); const out=[];
    for(let i=0;i<lines.length;i++){
      const t=lines[i].trim();
      const refs=[...t.matchAll(/(\d{4,6}-\d+)\b/g)].map(x=>x[1]).filter(r=>!/^20\d{2}-\d{6}$/.test(r));
      for(const r of refs){
        let mnum=null, clientRef=null;
        for(let k=1;k<=8 && i+k<lines.length;k++){
          const tt=lines[i+k].trim();
          // stop at the next mission row: a booking ref on any following line
          // means this row owns no M# (column-dumped Monaco rows).
          if(/^\d{4,6}-\d+/.test(tt)) break;
          if(/^\d{2}\/\d{2}\/\d{4}/.test(tt) && k>1) break;
          const md=tt.match(/^M#+\s*(\d+)$/); if(md && !mnum) mnum=md[1];
          const cr=tt.match(/\[(20\d{2}-\d{6})\]/); if(cr && !clientRef) clientRef=cr[1];
        }
        out.push({ref:r, m:mnum, clientRef});
      }
    }
    return out;
  }
  function tokClients(sec){
    const lines=sec.split('\n'); const o=[];
    for(let i=0;i<lines.length;i++){
      const t=lines[i].trim();
      if(/^ACA \(A[ée]roport/.test(t)) o.push({tok:'ACA'});
      else if(/^Monaco Mediax/.test(t)) o.push({tok:'Monaco'});
      else if(/^WELL'COM AIR/.test(t)) o.push({tok:'WELLCOM'});
      else {
        const br=t.match(/^(.+?)\s*\[(20\d{2}-\d{6})\]/);
        if(br) o.push({tok:'AGENCY', ref:br[2], name:br[1].trim()});
      }
    }
    return o;
  }
  function tokFlights(sec){
    const re=/N[°o]\s*Vol\s*([A-Za-z]{2,3}\s*\d{2,5}|[A-Za-z0-9]{2,7})[^]*?Terminal\s*(T?\d{1,2}|[A-Z](?=\s))?/gi;
    let m,o=[]; while((m=re.exec(sec))!==null) o.push({vol:m[1].replace(/\s/g,'').toUpperCase(), t:(m[2]||'').replace(/^T/i,'')});
    return o;
  }
  function tokTypes(sec){
    // One type per mission. A mission's type appears as a leading line
    // "Départ"/"Arrivée" (accent may be OCR-corrupted) followed by a continuation
    // "(Départ…" / "(Arrivée…" / "(Bagage…" / "Bagage standard", or a lone token.
    const lines=sec.split('\n');
    const o=[];
    const head=/^[ \t]*(D.?part|Arriv.?e)[ \t]*$/i;
    for(let i=0;i<lines.length;i++){
      const t=lines[i].trim();
      const hm=t.match(head);
      if(hm){
        let j=i+1; while(j<lines.length&&lines[j].trim()==='')j++;
        const nxt=j<lines.length?lines[j].trim():'';
        const isBlockHead = /^\(/.test(nxt) || /^(D.?part|Arriv.?e)\b/i.test(nxt) || /^Bagage/i.test(nxt) || /^NCE\b/.test(nxt) || nxt==='';
        let p=i-1; while(p>=0&&lines[p].trim()==='')p--;
        const prevHead = p>=0 && /^[ \t]*(D.?part|Arriv.?e)\b/i.test(lines[p].trim());
        if(isBlockHead && !prevHead){
          o.push(/arr/i.test(hm[1])?'ARR':'DEP');
        }
      }
    }
    return o;
  }
  // A line "looks like a porter name" if it matches the name shape AND is not a
  // known non-name capitalised phrase (Client VIP, Flight Class, Note au, etc.).
  const PORTER_NAME_RE=/^([A-ZÉÈ][a-zà-ÿ]+(?:-[A-ZÉÈ][a-zà-ÿ]+)?\s+[A-ZÉÈ]\.?|[A-ZÉÈ][a-zà-ÿ]+\s+[A-Z]{3,}|[A-ZÉÈ][a-zà-ÿ]+\s+[A-Z])$/;
  const PORTER_BLOCK_RE=/^(Client\b|Flight\b|Note\b|Contact\b|Tablette\b|Greete?r\b|Chauff|Mission\b|Itin|Powered\b|Terminal\b|Bagage|Standard|Services?\b|VIP\b|LIVE\b|Festival\b|Carlo\b|Monte\b)/i;
  function looksLikePorter(line){
    const t=line.trim();
    if(!PORTER_NAME_RE.test(t)) return false;
    if(PORTER_BLOCK_RE.test(t)) return false;
    return true;
  }
  function tokPorters(sec){
    const lines=sec.split('\n');const o=[];
    const ctxRe=/^[?\s]*(\+?\d|0\d|Gre{1,2}t{1,2}e?r|Tablette|Flight Class|Client|VIP|Chauff|nathan|Nathan|Contact|CXL)/i;
    for(let i=0;i<lines.length;i++){
      const t=lines[i].trim();
      if(looksLikePorter(t)){
        let j=i+1; while(j<lines.length&&lines[j].trim()==='')j++;
        if(j<lines.length&&ctxRe.test(lines[j].trim())){
          const blk=lines.slice(i, Math.min(lines.length,i+4)).join(' ');
          o.push({name:t, line:i, pos:null, cancelled:/\bCXL\b/i.test(blk)});
        }
      }
    }
    return o;
  }
  function detectClientForRow(sec, ref){
    const lines=sec.split('\n');
    for(let i=0;i<lines.length;i++){
      if(lines[i].includes(ref)){
        const w=lines.slice(i,Math.min(lines.length,i+10)).join('\n');
        if(/ACA \(A[ée]roport/.test(w)) return {tok:'ACA'};
        if(/Monaco Mediax/.test(w)) return {tok:'Monaco'};
        if(/WELL'COM AIR/.test(w)) return {tok:'WELLCOM'};
        const br=w.match(/(.+?)\s*\[(20\d{2}-\d{6})\]/); if(br) return {tok:'AGENCY', ref:br[2], name:br[1].trim().split('\n').pop()};
      }
    }
    return {tok:''};
  }
  function typeForRankWithCancellations(porters, types, r){
    const live=[]; porters.forEach((p,i)=>{ if(!p.cancelled) live.push(i); });
    const pos=live.indexOf(r);
    if(pos>=0 && pos<types.length) return types[pos];
    return '';
  }
  function inferTypeForRank(sec, r){
    const re=/N[°o]\s*Vol\s*[A-Za-z0-9]{2,7}/gi;
    let m,idxs=[]; while((m=re.exec(sec))!==null) idxs.push(m.index);
    if(r>=idxs.length) return '';
    const start=idxs[r], end=(r+1<idxs.length)?idxs[r+1]:start+400;
    const seg=sec.slice(start, Math.min(sec.length,end+200));
    if(/Arriv.?e/i.test(seg)) return 'ARR';
    if(/D.?part/i.test(seg)) return 'DEP';
    return '';
  }
  function clientLabelFromTok(c){
    if(!c) return '';
    if(c.tok==='ACA') return 'ACA ETIC';
    if(c.tok==='Monaco') return 'Monaco Mediax';
    if(c.tok==='WELLCOM') return "WELL'COM AIR";
    if(c.tok==='AGENCY') return c.name || '';
    return '';
  }
  // Greeter from the porter's contact block (scope starts at the porter name).
  // First a labelled "Greeter: X"; failing that an unlabelled "NAME +phone"
  // line (some plannings drop the label), bounded by the next porter name so a
  // neighbour's contact never bleeds in.
  function greeterFromScope(s){
    const lab = s.match(/gre{1,2}t{1,2}e?r[\s:]*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\-]*)/i);
    if(lab){ const g = lab[1].trim(); if(['a','à','venir','voir'].indexOf(g.toLowerCase())===-1) return g; }
    const lines = s.split('\n');
    for(let i=1;i<lines.length;i++){
      const t = lines[i].trim();
      if(looksLikePorter(t)) break;
      const gm = t.match(/^([A-ZÀ-Ý][A-Za-zÀ-ÿ.\-]+)\s+\+?\d/);
      if(gm && !/^(Phone|Flight|Note|Chauff|Greete?r|NCE|Terminal|Aviation)$/i.test(gm[1])) return gm[1];
    }
    return '';
  }

  // A cluster is "scrambled" (column-dumped) when two booking refs OR two porter
  // names appear consecutively with no "N° Vol" line between them. In a clean
  // cluster, every booking/porter is interleaved with its own flight. This flag
  // gates off the clean fast-path so dumped rows always go through rank alignment.
  function scrambledCluster(sec){
    const lines=sec.split('\n');
    const ctxRe=/^[?\s]*(\+?\d|0\d|Gre{1,2}t{1,2}e?r|Tablette|Flight Class|Client|VIP|Chauff|nathan|Nathan|Contact|CXL)/i;
    let flightSincePorter=true, flightSinceBooking=true;
    for(let i=0;i<lines.length;i++){
      const t=lines[i].trim();
      if(/N[°o]\s*Vol/i.test(t)){flightSincePorter=true;flightSinceBooking=true;}
      // A "Service" mission (chariot/tournage) is legitimately flightless; reset
      // the flags so it isn't mistaken for a column dump.
      if(/^Service\b/.test(t)){flightSincePorter=true;flightSinceBooking=true;}
      const refs=[...t.matchAll(/(\d{4,6}-\d+)\b/g)].map(x=>x[1]).filter(r=>!/^20\d{2}-\d{6}$/.test(r));
      if(refs.length){
        if(!flightSinceBooking) return true;
        flightSinceBooking=false;
      }
      if(looksLikePorter(t)){
        let j=i+1; while(j<lines.length&&lines[j].trim()==='')j++;
        if(j<lines.length&&ctxRe.test(lines[j].trim())){
          if(!flightSincePorter) return true;
          flightSincePorter=false;
        }
      }
    }
    return false;
  }
  const scrambledCache={};
  function isScrambledAt(pos){
    const prev=H.filter(h=>h<=pos);
    const gs=prev.length?prev[prev.length-1]:0;
    const next=H.find(h=>h>pos);
    const ge=next!==undefined?next:text.length;
    const key=gs+'_'+ge;
    if(key in scrambledCache) return scrambledCache[key];
    const v=scrambledCluster(text.slice(gs,ge));
    scrambledCache[key]=v;
    return v;
  }

  // ---- clean fast-path detection (unchanged behaviour) ----
  const bookingRe = /(\d{4,6}-\d+|20\d{2}-\d{6})/g;
  const allBookings = [];
  let bm;
  while((bm = bookingRe.exec(text)) !== null){
    const isLive = /^20\d{2}-\d{6}$/.test(bm[1]);
    let mNum = '';
    const tail = text.slice(bm.index, bm.index + 30);
    const mm = tail.match(/M#+\s*(\d+)/);
    if(mm) mNum = mm[1];
    const around = text.slice(bm.index, bm.index + 90);
    const tm = around.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const hhmm = tm ? (tm[1].padStart(2,'0') + ':' + tm[2]) : '';
    allBookings.push({pos: bm.index, num: mNum ? mNum : bm[1], time: hhmm, live: isLive});
  }
  const allFlights = [];
  let fm;
  const flightReAll = /N[°o]\s*Vol\s*([A-Za-z]{2,3}\s*\d{2,5}|[A-Za-z0-9]{2,7})[^]*?Terminal\s*(T?\d{1,2}|[A-Z](?=\s))?/gi;
  while((fm = flightReAll.exec(text)) !== null){
    allFlights.push({pos: fm.index, vol: fm[1].replace(/\s/g,'').toUpperCase(), terminal: (fm[2]||'').replace(/^T/i,'')});
  }

  const porterRe = new RegExp(escapeRegex(porterName), 'gi');
  const mentions = [];
  let pm;
  while((pm = porterRe.exec(text)) !== null) mentions.push(pm.index);

  // Pre-compute cluster spans + per-cluster rank resolution cache.
  const H = clusterSpans();
  const clusterCache = {};
  function resolveCluster(gStart, gEnd){
    const key = gStart+'_'+gEnd;
    if(clusterCache[key]) return clusterCache[key];
    const sec = text.slice(gStart, gEnd);
    const r = {
      sec,
      bk: tokBookingRows(sec),
      cli: tokClients(sec),
      fl: tokFlights(sec),
      ty: tokTypes(sec),
      po: tokPorters(sec)
    };
    clusterCache[key] = r;
    return r;
  }

  mentions.forEach((pos, mi) => {
    // nearest preceding booking → block start
    let nearestBookingPos = -1;
    for(const b of allBookings){ if(b.pos < pos) nearestBookingPos = b.pos; else break; }
    const blockStart = nearestBookingPos >= 0 ? nearestBookingPos : (mi > 0 ? mentions[mi-1] : 0);

    const blockBookings = allBookings.filter(b => b.pos >= blockStart && b.pos < pos);
    const blockFlights = allFlights.filter(f => f.pos >= blockStart && f.pos < pos);

    let scopeEnd = text.length;
    for(const bb of allBookings){ if(bb.pos > blockStart){ scopeEnd = bb.pos; break; } }
    const scopeBookings = allBookings.filter(b => b.pos >= blockStart && b.pos < scopeEnd);
    const scopeFlights = allFlights.filter(f => f.pos >= blockStart && f.pos < scopeEnd);
    const distinctFlights = [];
    const _seenFl = new Set();
    for(const f of scopeFlights){ const k = f.vol + '/' + f.terminal; if(_seenFl.has(k)) continue; _seenFl.add(k); distinctFlights.push(f); }

    // A clean row requires the porter's own booking to be the one immediately
    // preceding it. If ANOTHER porter name sits between the candidate booking
    // and this porter, the booking belongs to that other porter (the copy-paste
    // dump detached this porter's name from its real ref) → not clean → chips.
    const _selfPorter = porterName.replace(/\.$/, '');
    let otherPorterBetween = false;
    for(const ln of text.slice(blockStart, pos).split('\n')){
      const t = ln.trim();
      if(looksLikePorter(t) && t.replace(/\.$/, '') !== _selfPorter){ otherPorterBetween = true; break; }
    }

    const isClean = scopeBookings.length === 1 && distinctFlights.length === 1
                    && distinctFlights[0].pos > blockStart
                    && !otherPorterBetween;

    // date (nearest date before the porter)
    const beforeAll = text.slice(blockStart, pos);
    const dateMatches = beforeAll.match(/(\d{2})\/(\d{2})\/\d{4}/g);
    let date = todayStr();
    if(dateMatches){
      const last = dateMatches[dateMatches.length-1].match(/(\d{2})\/(\d{2})/);
      date = last[1] + '/' + last[2];
    }
    // heure : la première du bloc (comportement d'origine) ; si absente
    // (mission ACA sans ligne d'heure propre), on prend la plus proche du nom.
    const timeMatch = beforeAll.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    let sortTime;
    if(timeMatch){
      sortTime = parseInt(timeMatch[1])*60 + parseInt(timeMatch[2]);
    } else {
      const loW = Math.max(0, pos-900), hiW = Math.min(text.length, pos+120);
      const seg = text.slice(loW, hiW);
      let best=null, bestD=1e9, re=/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, mm;
      while((mm=re.exec(seg))!==null){
        const at = loW + mm.index, d = Math.abs(at - pos);
        if(d < bestD){ bestD=d; best=parseInt(mm[1])*60+parseInt(mm[2]); }
      }
      sortTime = best === null ? 9999 : best;
    }

    const mission = createMission();
    mission.date = date;
    mission.sortTime = sortTime;
    mission.srcPos = pos;
    mission.prebooking = 'PRÉ-BOOKING';

    // ---- Service mission (chariot/tournage etc.): one booking, no flight ----
    const blockEndSvc = (() => { for(const bb of allBookings){ if(bb.pos > pos) return bb.pos; } return text.length; })();
    const svcScope = text.slice(blockStart, Math.min(blockEndSvc, pos + 400));
    if(blockBookings.length >= 1 && blockFlights.length === 0 && /\bService\b/i.test(svcScope)){
      const b = blockBookings[0];
      let client='';
      const cM = text.slice(blockStart, pos).match(/(Monaco Mediax|ACA \([^)]+\)|[A-Z][A-Za-z'()\.\- ]+?SAS)/);
      if(cM){ const s=cM[1].trim();
        client = /Monaco/i.test(s)?'Monaco Mediax' : /^ACA/i.test(s)?'ACA ETIC' : s; }
      Object.assign(mission, {
        booking: b.num, type: 'Service', client, greeteur:'',
        vol:'', terminal:'', lieuDepose:'', bookingOptions:[], flightOptions:[]
      });
      found.push(mission);
      return;
    }

    if(isClean){
      // ---- clean row: take its single booking/flight directly ----
      const b = scopeBookings[0], f = distinctFlights[0];
      // search type within the whole block (up to the next booking), since
      // Parking-Pro / group rows push the Arrivée/Départ token far past pos.
      let blockEnd = text.length;
      for(const bb of allBookings){ if(bb.pos > pos){ blockEnd = bb.pos; break; } }
      const after = text.slice(pos, Math.min(blockEnd, pos + 1500));
      const before = text.slice(blockStart, pos);
      let type = '';
      if(/arriv.?e/i.test(after)) type='ARR';
      else if(/d.?part/i.test(after)) type='DEP';
      else if(/arriv.?e/i.test(before)) type='ARR';
      else if(/d.?part/i.test(before)) type='DEP';

      let client='', clientPhone='';
      const cM = before.match(/(Monaco Mediax|ACA \([^)]+\))(?![^]*(Monaco Mediax|ACA \())/);
      if(cM) client = /Monaco/i.test(cM[1]) ? 'Monaco Mediax' : 'ACA ETIC';
      else if(/^20\d{2}-/.test(b.num)){
        // Agency mission: "M. NAME +phone" is the most reliable pattern across text formats
        const scope = before + after.slice(0, 1500);
        const mM = scope.match(/M\.\s+([A-Za-z\xc0-\xff][A-Za-z\xc0-\xff.' \-]+?)(?=\s+\+\d|\s+(?:Terminal\s+)?T[12]\s+\d{2}:)/i);
        if(mM) client = mM[1].trim();
        else {
          // Fallback: "NAME [2026-XXXXXX]" (same line only, newlines excluded from name)
          const bkEsc = b.num.replace(/[-]/g, '[-]');
          const agM = text.match(new RegExp('([A-Za-z\xc0-\xff][A-Za-z\xc0-\xff.\' \\-]+?)\\s*\\[' + bkEsc + '\\]'));
          if(agM) client = agM[1].trim().replace(/^M\.\s*/, '');
        }
        const cpM = scope.match(/M\.\s+[A-Za-z\xc0-\xff][A-Za-z\xc0-\xff.'\s\-]*?\s+([+]\d[\d ]{7,}\d)/);
        if(cpM) clientPhone = cpM[1].replace(/\s+/g, '');
      }

      // Pax: search "(N)" after the booking ref (not around the porter pos, to avoid bleeding from previous missions)
      const bkIdx = text.indexOf(b.num, Math.max(0, pos - 200));
      const paxSearch = bkIdx >= 0 ? text.slice(bkIdx, bkIdx + 200) : '';
      const paxM = paxSearch.match(/\((\d+)\)/);
      const pax = paxM ? paxM[1] : '';

      const greeteur = greeterFromScope(text.slice(pos, pos + 160));

      let lieuDepose = type === 'ARR' ? 'Tapis bagage' : 'AUTO_CHECKIN';
      if(/D[ée]pose-?\s*minute/i.test(after) || /D[ée]pose-?\s*minute/i.test(before.slice(-200))) lieuDepose='Dépose minute';
      else if(/Parking\s*Pro/i.test(after) || /Parking\s*Pro/i.test(before.slice(-200))) lieuDepose='Parking pro';

      Object.assign(mission, {
        booking: b.num, type, client, clientPhone, greeteur, pax,
        vol: f.vol, terminal: f.terminal,
        lieuDepose, bookingOptions: [], flightOptions: []
      });
      found.push(mission);
      return;
    }

    // ---- scrambled: rank alignment inside the cluster ----
    const prev = H.filter(h => h <= pos);
    const gStart = prev.length ? prev[prev.length-1] : 0;
    const next = H.find(h => h > pos);
    const gEnd = next !== undefined ? next : text.length;
    const C = resolveCluster(gStart, gEnd);

    // rank = index of THIS mention among the cluster's porters.
    // Resolve by ORDINAL: the k-th occurrence of porterName among this cluster's
    // mentions maps to the k-th porter entry bearing porterName. (Position-distance
    // is unreliable when the same porter appears twice in one cluster.)
    let rank = -1;
    {
      let ordinal = 0;
      for(const mp of mentions){
        if(mp >= gStart && mp < gEnd){
          if(mp === pos) break;
          ordinal++;
        }
      }
      let seen = 0;
      for(let idx=0; idx<C.po.length; idx++){
        if(C.po[idx].name === porterName){
          if(seen === ordinal){ rank = idx; break; }
          seen++;
        }
      }
    }

    const N = C.po.length;
    const coreAligned = (C.bk.length === N && C.fl.length === N && N > 0 && rank >= 0 && rank < N);
    const clientsAligned = (C.cli.length === N);
    const typesAligned = (C.ty.length === N);

    if(coreAligned){
      const row = C.bk[rank];
      const fl = C.fl[rank];
      let c = clientsAligned ? C.cli[rank] : detectClientForRow(C.sec, row.ref);
      // Invariant: M# is only ever on ACA missions.
      if((!c || !c.tok) && row.m) c = {tok:'ACA'};
      const isACA = c && c.tok === 'ACA';
      const booking = isACA ? (row.m || row.ref) : ((c && c.ref) || row.ref);
      const isLive = false; // planning rows are PRÉ-BOOKING

      let type = typesAligned ? C.ty[rank]
               : (C.ty.length>0 ? typeForRankWithCancellations(C.po, C.ty, rank) : '');
      if(!type) type = inferTypeForRank(C.sec, rank);

      const greeteur = greeterFromScope(text.slice(pos, pos + 160));

      let lieuDepose = type === 'ARR' ? 'Tapis bagage' : 'AUTO_CHECKIN';
      const noteScope = text.slice(pos-150, pos+200);
      if(/D[ée]pose-?\s*minute/i.test(noteScope)) lieuDepose='Dépose minute';
      else if(/Parking\s*Pro/i.test(noteScope)) lieuDepose='Parking pro';

      Object.assign(mission, {
        booking, type,
        client: clientLabelFromTok(c),
        greeteur,
        vol: fl.vol, terminal: fl.t,
        lieuDepose,
        bookingOptions: [],   // resolved → no chips
        flightOptions: []
      });
      found.push(mission);
      return;
    }

    // ---- gate failed → relaxed (vol+type if they align with porters) + chips ----
    const relaxed = (C.fl.length === N && C.ty.length === N && rank >= 0 && rank < N);
    let vol='', term='', type='';
    if(relaxed){ vol=C.fl[rank].vol; term=C.fl[rank].t; type=C.ty[rank]; }

    // booking chips: unique booking rows in the cluster (with their M#/refs)
    const bSeen = new Set(); const bookingOptions = [];
    C.bk.forEach(b => {
      const num = b.m ? b.m : (b.clientRef || b.ref);
      if(bSeen.has(num)) return; bSeen.add(num);
      bookingOptions.push({num, time:'', live:false});
    });
    // flight chips: unique flights
    const fSeen = new Set(); const flightOptions = [];
    C.fl.forEach(f => { const label=f.vol+' / T'+f.t; if(fSeen.has(label))return; fSeen.add(label); flightOptions.push({label, vol:f.vol, terminal:f.t}); });

    const after = text.slice(pos, pos+220);
    if(!type){ if(/arriv.?e/i.test(after)) type='ARR'; else if(/d.?part/i.test(after)) type='DEP'; }

    const greeteur = greeterFromScope(text.slice(pos, pos + 160));

    Object.assign(mission, {
      booking: relaxed && bookingOptions.length ? '' : (bookingOptions[0] ? bookingOptions[0].num : ''),
      type,
      client: '',
      greeteur,
      vol, terminal: term,
      lieuDepose: type === 'ARR' ? 'Tapis bagage' : 'AUTO_CHECKIN',
      bookingOptions: bookingOptions.length>1 ? bookingOptions : [],
      flightOptions: (!relaxed && flightOptions.length>1) ? flightOptions : []
    });
    found.push(mission);
  });

  found.sort((a,b) => {
    const ta=a.sortTime||9999, tb=b.sortTime||9999;
    if(ta!==tb) return ta-tb;
    return (a.srcPos||0) - (b.srcPos||0);
  });
  return found;
}




export { extractMissions };
