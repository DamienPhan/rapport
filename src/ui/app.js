/**
 * Couche UI : orchestration, rendu DOM, événements.
 * SEULE couche autorisée à toucher `document`. Importe toute la logique
 * métier depuis core/ et store/. Le jour du passage natif, c'est ce fichier
 * (et lui seul) qui sera réécrit ; core/ et store/ restent intacts.
 */
import { siteConfig as CFG } from '../config/nce-wellcom.js';
import {
  createMission, createManualMission, applyPlaceDefaults,
  markNoShow as coreMarkNoShow, validateMission as coreValidate,
  syncDefaults, todayStr, fmtTime
} from '../core/mission.js';
import { wordsFromTextContent, missionsForPorter } from '../core/parser-pdf.js';
import { extractMissions } from '../core/parser-text.js';
import { enrichWithPhones } from '../core/enrich.js';
import { generateReportText, resolvePlace } from '../core/report.js';
import { createSessionStore } from '../store/session.js';
import { defaults } from '../core/mission.js';

let missions = [];
let lastPdfPages = null;

function togglePorterCustom(){
  const sel = document.getElementById('porterSelect');
  document.getElementById('porterCustomField').style.display = sel.value === 'custom' ? 'block' : 'none';
}

function getPorterName(){
  const sel = document.getElementById('porterSelect');
  if(sel.value === 'custom'){
    return document.getElementById('porterCustom').value.trim();
  }
  return sel.value;
}

function openPdfPicker(){
  const input = document.getElementById('pdfInput');
  if(input) input.click();
}

function readPdfFile(file){
  if(file && typeof file.arrayBuffer === 'function'){
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Impossible de lire le fichier.'));
    reader.readAsArrayBuffer(file);
  });
}

// Recharge automatiquement les missions du porteur sélectionné depuis la
// dernière source chargée (PDF en priorité, sinon texte collé). Ne fait rien
// si aucun planning n'a encore été chargé, pour ne pas vider l'écran.
function reloadForPorter(){
  const porter = getPorterName();
  if(!porter) return;
  const text = document.getElementById('planningInput').value;
  let extracted = [];
  if(lastPdfPages){
    extracted = missionsForPorter(lastPdfPages, porter, CFG).map(r => {
      const m = createMission();
      Object.assign(m, r);
      if(!r.date) m.date = todayStr();
      return applyPlaceDefaults(m, CFG.places);
    });
    if(extracted.length && text) enrichWithPhones(extracted, text, CFG);
    if(!extracted.length && text) extracted = extractMissions(text, porter, CFG);
  } else if(text){
    extracted = extractMissions(text, porter, CFG);
    if(extracted.length) enrichWithPhones(extracted, text, CFG);
  } else {
    return; // rien de chargé
  }
  if(missions.length) pushUndo();
  if(extracted.length){
    missions = extracted;
    render();
  } else {
    missions = [];
    document.getElementById('missionsContainer').innerHTML =
      '<div class="empty">Aucune mission trouvée pour « ' + porter + ' ».</div>' +
      '<button class="btn full-ghost" onclick="addManualMission()">+ Ajouter une mission manuelle</button>';
  }
  saveState();
}

// ---- Référentiels auto-alimentés (porteurs + greeters) ----------------------
// La liste de base reste dans le HTML. Tout planning chargé/collé en extrait les
// porteurs et greeters et les ajoute en local : un nouveau collègue ou greeter
// apparaît automatiquement au collage suivant, sans redéploiement.
function escHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function rosterLoad(key){ try{ return JSON.parse(localStorage.getItem(key)) || []; }catch(e){ return []; } }
function rosterMerge(key, names){
  const cur = new Set(rosterLoad(key));
  let changed = false;
  names.forEach(n=>{ if(n && !cur.has(n)){ cur.add(n); changed = true; } });
  if(changed) localStorage.setItem(key, JSON.stringify([...cur]));
  return changed;
}
const PORTER_HARVEST_RE = /^([A-ZÉÈ][a-zà-ÿ]+(?:-[A-ZÉÈ][a-zà-ÿ]+)?\s+[A-ZÉÈ]\.?|[A-ZÉÈ][a-zà-ÿ]+\s+[A-Z]{1,}\.?)$/;
const PORTER_HARVEST_BLOCK = /^(Flight|Greete?r|Note|Phone|Aviation|Class|Contact|Terminal|D[ée]pose|Arriv|D[ée]part|Mission|Date|Client|Itin|V[ée]hic|Service|Powered|Aéroport|Parking|Bagage)/i;
function harvestRoster(text){
  if(!text) return;
  const porters = new Set(), greeters = new Set();
  for(const raw of text.split('\n')){
    const t = raw.trim();
    const g = t.match(/greete?r[\s:]*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\-]*)/i);
    if(g){ const n = g[1].trim(); if(['a','à','venir','voir'].indexOf(n.toLowerCase()) === -1) greeters.add(n); }
    const c = t.replace(/^NCE\s+/, '').replace(/\s*\+?\d.*$/, '').trim();
    if(PORTER_HARVEST_RE.test(c) && !PORTER_HARVEST_BLOCK.test(c)) porters.add(c);
  }
  const ch = rosterMerge('customPorters', porters) | rosterMerge('customGreeters', greeters);
  if(ch) refreshRosterUI();
}
function refreshRosterUI(){
  const sel = document.getElementById('porterSelect');
  if(!window._basePorters) window._basePorters = [...sel.options].filter(o=>o.value!=='custom').map(o=>o.textContent);
  const dl = document.getElementById('greetersList');
  if(!window._baseGreeters) window._baseGreeters = [...dl.options].map(o=>o.value);

  const prev = sel.value;
  const customs = rosterLoad('customPorters').filter(n=>!window._basePorters.includes(n)).sort((a,b)=>a.localeCompare(b,'fr'));
  const merged = window._basePorters.concat(customs);
  sel.innerHTML = merged.map(n=>`<option>${escHtml(n)}</option>`).join('') + '<option value="custom">Autre...</option>';
  if([...sel.options].some(o=>o.value===prev)) sel.value = prev;

  const gc = rosterLoad('customGreeters').filter(n=>!window._baseGreeters.includes(n));
  const gall = window._baseGreeters.concat(gc).sort((a,b)=>a.localeCompare(b,'fr'));
  dl.innerHTML = gall.map(g=>`<option value="${escHtml(g)}"></option>`).join('');
}


function fieldId(idx, name){ return `m${idx}_${name}`; }

function renderCandidates(m, idx){
  const bOpts = m.bookingOptions || [];
  const fOpts = m.flightOptions || [];
  if(bOpts.length <= 1 && fOpts.length <= 1) return '';
  let html = '<div class="candidates"><div class="clabel">⚠ Plusieurs missions à la même heure ici — touche celle qui te concerne</div>';
  if(bOpts.length > 1){
    html += '<div class="csub">1. Ton numéro de booking (avec l\'heure) :</div>';
    html += '<div class="chips">';
    html += bOpts.map(b => `<span class="chip ${b.num===m.booking?'active':''}" data-num="${b.num}" data-live="${b.live?'1':'0'}" onclick="pickBooking(${idx}, this)">${b.time ? b.time + ' · ' : ''}${b.num}${b.live?' (LIVE)':''}</span>`).join('');
    html += '</div>';
  }
  if(fOpts.length > 1){
    html += '<div class="csub">2. Ton vol :</div>';
    html += '<div class="chips">';
    html += fOpts.map(f => `<span class="chip ${f.vol===m.vol?'active':''}" data-vol="${f.vol}" data-term="${f.terminal}" onclick="pickFlight(${idx}, this)">${f.label}</span>`).join('');
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function pickBooking(idx, el){
  document.getElementById(fieldId(idx,'booking')).value = el.getAttribute('data-num');
  const pb = document.getElementById(fieldId(idx,'prebooking'));
  if(pb) pb.value = el.getAttribute('data-live') === '1' ? 'LIVE' : 'PRÉ-BOOKING';
  const titleEl = document.querySelector(`.mission[data-idx="${idx}"] .mission-head strong`);
  if(titleEl){
    const t = missions[idx] ? fmtTime(missions[idx].sortTime) : '';
    titleEl.innerHTML = 'Booking ' + el.getAttribute('data-num') + (t ? ' <span class="mtime">· ' + t + '</span>' : '');
  }
  const parent = el.parentNode;
  parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function pickFlight(idx, el){
  document.getElementById(fieldId(idx,'vol')).value = el.getAttribute('data-vol');
  document.getElementById(fieldId(idx,'terminal')).value = el.getAttribute('data-term');
  const parent = el.parentNode;
  parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function typeIcon(type){
  return { ARR: '🛬 ', DEP: '🛫 ', TRS: '🔁 ' }[type] || '🧳 ';
}

function renderMission(m, idx){
  const total = (parseInt(m.bagStandard)||0) + (parseInt(m.bagHorsFormat)||0) + (parseInt(m.bagCage)||0);
  return `
  <div class="mission" data-idx="${idx}">
    <div class="mission-head">
      <strong>${m.booking ? 'Booking ' + m.booking : 'Nouvelle mission'}${fmtTime(m.sortTime) ? ' <span class="mtime">· ' + fmtTime(m.sortTime) + '</span>' : ''}</strong>
      <div class="right">
        <button class="btn-noshow" onclick="markNoShow(${idx})" title="Marquer comme NO SHOW">NO SHOW</button>
        <span class="badge badge-${m.type||'Service'}">${typeIcon(m.type)}${m.type || '—'}</span>
        <button class="del" onclick="removeMission(${idx})" title="Supprimer">✕</button>
      </div>
    </div>
    <div class="mission-body">
      ${renderCandidates(m, idx)}
      <div class="grid">
        <div class="field"><label>🔖 Booking #</label><input id="${fieldId(idx,'booking')}" value="${m.booking}"></div>
        <div class="field"><label>📅 Date</label><input id="${fieldId(idx,'date')}" value="${m.date}"></div>
        <div class="field full"><label>👤 Client</label><input id="${fieldId(idx,'client')}" value="${m.client}" oninput="this.value=this.value.toUpperCase()">
        ${m.clientPhone ? `<div class="tel-row"><a href="tel:${m.clientPhone}" class="tel-chip">📞 ${m.clientPhone}</a></div>` : ''}
        </div>
        <div class="field full"><label>🙋 Greeteur (optionnel)</label><input id="${fieldId(idx,'greeteur')}" list="greetersList" value="${m.greeteur}" placeholder="ex: Linda.K" oninput="this.value=this.value.toUpperCase()">
        ${m.greeteurPhone ? `<div class="tel-row"><a href="tel:${m.greeteurPhone}" class="tel-chip">📞 ${m.greeteurPhone}</a></div>` : ''}
        </div>
        ${m.contactPhone ? `<div class="field full"><label>🚗 Contact chauffeur</label><div class="tel-row"><a href="tel:${m.contactPhone}" class="tel-chip">📞 ${m.contactPhone}</a></div></div>` : ''}
        <div class="field">
          <label>🕒 Pré-booking / Live</label>
          <select id="${fieldId(idx,'prebooking')}">
            <option ${m.prebooking==='PRÉ-BOOKING'?'selected':''}>PRÉ-BOOKING</option>
            <option ${m.prebooking==='LIVE'?'selected':''}>LIVE</option>
          </select>
        </div>
        <div class="field">
          <label>🛠️ Type de service</label>
          <select id="${fieldId(idx,'type')}" onchange="updateTypeBadge(${idx})">
            <option value="DEP" ${m.type==='DEP'?'selected':''}>🛫 DEP</option>
            <option value="ARR" ${m.type==='ARR'?'selected':''}>🛬 ARR</option>
            <option value="TRS" ${m.type==='TRS'?'selected':''}>🔁 TRS</option>
          </select>
        </div>
        <div class="field"><label>✈️ Vol - code IATA</label><input id="${fieldId(idx,'vol')}" value="${m.vol}" oninput="this.value=this.value.toUpperCase()"></div>
        <div class="field"><label>🏢 Terminal</label><input id="${fieldId(idx,'terminal')}" value="${m.terminal}" inputmode="numeric" oninput="this.value=this.value.replace(/\D/g,'')"></div>
        <div class="field"><label>👥 Nombre de passagers</label><input id="${fieldId(idx,'pax')}" value="${m.pax}" inputmode="numeric"></div>
      </div>

      <div class="grid">
        <div class="field"><label>🧳 Bagages standard</label><input id="${fieldId(idx,'bagStandard')}" value="${m.bagStandard}" inputmode="numeric" oninput="updateTotal(${idx})"></div>
        <div class="field"><label>📦 Hors format</label><input id="${fieldId(idx,'bagHorsFormat')}" value="${m.bagHorsFormat}" inputmode="numeric" oninput="updateTotal(${idx})"></div>
        <div class="field full"><label>🐾 Cage animal</label><input id="${fieldId(idx,'bagCage')}" value="${m.bagCage}" inputmode="numeric" oninput="updateTotal(${idx})"></div>
      </div>
      <div class="total-row">
        <span>Total bagages pris en charge</span>
        <strong id="${fieldId(idx,'total')}">${total}</strong>
      </div>

      <div class="grid">
        <div class="field">
          <label>💶 Détaxe</label>
          <select id="${fieldId(idx,'detaxe')}">
            <option ${m.detaxe==='Non'?'selected':''}>Non</option>
            <option ${m.detaxe==='Oui'?'selected':''}>Oui</option>
            <option ${m.detaxe==='N/A'?'selected':''}>N/A</option>
          </select>
        </div>
        <div class="field">
          <label>🧑‍🤝‍🧑 Nombre de porteurs</label>
          <input id="${fieldId(idx,'porteurs')}" value="${m.porteurs}">
        </div>

        <div class="field">
          <label>📍 Lieu de rencontre</label>
          <select id="${fieldId(idx,'lieuRencontre')}" onchange="toggleAutre(${idx},'lieuRencontre')">
            <option ${m.lieuRencontre==='Dépose minute'?'selected':''}>Dépose minute</option>
            <option ${m.lieuRencontre==='Tapis bagage'?'selected':''}>Tapis bagage</option>
            <option ${m.lieuRencontre==='Parking pro'?'selected':''}>Parking pro</option>
            <option ${m.lieuRencontre==='Linéaire Professionnel'?'selected':''}>Linéaire Professionnel</option>
            <option ${m.lieuRencontre==='Gare routière (BUS)'?'selected':''}>Gare routière (BUS)</option>
            <option ${m.lieuRencontre==='Loueurs'?'selected':''}>Loueurs</option>
            <option ${m.lieuRencontre==='Vol privé'?'selected':''}>Vol privé</option>
            <option value="Autre" ${m.lieuRencontre==='Autre'?'selected':''}>Autre...</option>
            <option ${m.lieuRencontre==='N/A'?'selected':''}>N/A</option>
          </select>
          <input class="autre-input" id="${fieldId(idx,'lieuRencontreAutre')}" placeholder="Précise le lieu" value="${m.lieuRencontreAutre||''}" style="display:${m.lieuRencontre==='Autre'?'block':'none'}">
        </div>

        <div class="field">
          <label>🏁 Lieu de dépose</label>
          <select id="${fieldId(idx,'lieuDepose')}" onchange="toggleAutre(${idx},'lieuDepose')">
            <option value="AUTO_CHECKIN" ${m.lieuDepose==='AUTO_CHECKIN'?'selected':''}>Check-in + vol (${m.vol || '...'})</option>
            <option ${m.lieuDepose==='Dépose minute'?'selected':''}>Dépose minute</option>
            <option ${m.lieuDepose==='Tapis bagage'?'selected':''}>Tapis bagage</option>
            <option ${m.lieuDepose==='Parking pro'?'selected':''}>Parking pro</option>
            <option ${m.lieuDepose==='Gare routière (BUS)'?'selected':''}>Gare routière (BUS)</option>
            <option ${m.lieuDepose==='Loueurs'?'selected':''}>Loueurs</option>
            <option ${m.lieuDepose==='Vol privé'?'selected':''}>Vol privé</option>
            <option value="Autre" ${m.lieuDepose==='Autre'?'selected':''}>Autre...</option>
            <option ${m.lieuDepose==='N/A'?'selected':''}>N/A</option>
          </select>
          <input class="autre-input" id="${fieldId(idx,'lieuDeposeAutre')}" placeholder="Précise le lieu" value="${m.lieuDeposeAutre||''}" style="display:${m.lieuDepose==='Autre'?'block':'none'}">
        </div>

        <div class="field full"><label>⚠️ Problème rencontré ?</label><textarea class="small" id="${fieldId(idx,'probleme')}">${m.probleme}</textarea></div>

        <div class="field full">
          <label>⭐ Satisfaction client</label>
          <select id="${fieldId(idx,'satisfaction')}">
            <option ${m.satisfaction==='Excellente'?'selected':''}>Excellente</option>
            <option ${m.satisfaction==='Très bien'?'selected':''}>Très bien</option>
            <option ${m.satisfaction==='Bonne'?'selected':''}>Bonne</option>
            <option ${m.satisfaction==='Moyenne'?'selected':''}>Moyenne</option>
            <option ${m.satisfaction==='Mauvaise'?'selected':''}>Mauvaise</option>
            <option ${m.satisfaction==='N/A'?'selected':''}>N/A</option>
          </select>
        </div>
      </div>

      <div class="actions-row">
        <button class="btn secondary" style="width:auto;flex:1" onclick="generateReport(${idx})">Générer le rapport</button>
        <span class="copy-feedback" id="${fieldId(idx,'feedback')}">Copié ✓</span>
      </div>
      <div class="output" id="${fieldId(idx,'output')}" style="display:none">
        <pre id="${fieldId(idx,'pre')}"></pre>
        <button class="btn ghost" onclick="copyReport(${idx})">Copier le texte</button>
      </div>
    </div>
  </div>`;
}

function render(){
  const container = document.getElementById('missionsContainer');
  let html = '';
  if(missions.length === 0){
    html += '<div class="empty">Aucune mission pour l\'instant. Extrais le planning ou ajoute une mission manuelle.</div>';
  } else {
    html += '<button class="btn full-ghost" onclick="addManualMission()" style="margin-bottom:10px">+ Ajouter une mission manuelle</button>';
    html += missions.map((m,i)=>renderMission(m,i)).join('');
  }
  html += '<button class="btn full-ghost" onclick="addManualMission()">+ Ajouter une mission manuelle</button>';
  container.innerHTML = html;
}

function syncAll(){
  missions.forEach((m, idx) => {
    for(const key of Object.keys(m)){
      const el = document.getElementById(fieldId(idx, key));
      if(el) m[key] = el.value;
    }
  });
}

// ── SAUVEGARDE LOCALE (sur le téléphone, rien n'est envoyé en ligne) ─────────
// Restaure automatiquement le porteur, le texte collé et les missions au
// rechargement. Les données d'un autre jour sont purgées automatiquement.

// ── Persistance (déléguée à store/session.js) ───────────────────────────────
const sessionStore = createSessionStore();
function todayKey(){ return sessionStore.todayKey(); }
function saveState(){
  syncAll();
  const sel = document.getElementById('porterSelect');
  sessionStore.save({
    porterSelect: sel ? sel.value : '',
    porterCustom: (document.getElementById('porterCustom')||{}).value || '',
    planning: (document.getElementById('planningInput')||{}).value || '',
    missions
  });
}
function restoreState(){
  const state = sessionStore.restore();
  if(!state) return false;
  const sel = document.getElementById('porterSelect');
  if(sel && state.porterSelect){ sel.value = state.porterSelect; togglePorterCustom(); }
  if(state.porterCustom){ const pc=document.getElementById('porterCustom'); if(pc) pc.value = state.porterCustom; }
  if(state.planning){ const pi=document.getElementById('planningInput'); if(pi) pi.value = state.planning; }
  if(Array.isArray(state.missions) && state.missions.length){ missions = state.missions; render(); return true; }
  return false;
}
function clearState(){
  sessionStore.clearToday();
  missions = [];
  const pi=document.getElementById('planningInput'); if(pi) pi.value='';
  render();
}

// ── Annuler (retour en arrière) & vider le copier-coller ─────────────────────
let undoStack = [];
function pushUndo(){
  try{ syncAll(); }catch(e){}
  undoStack.push(JSON.stringify(missions));
  if(undoStack.length > 20) undoStack.shift();
  const b=document.getElementById('undoBtn'); if(b) b.disabled = undoStack.length===0;
}
function undoMissions(){
  if(!undoStack.length) return;
  const prev = undoStack.pop();
  try{ missions = JSON.parse(prev); }catch(e){ missions = []; }
  const b=document.getElementById('undoBtn'); if(b) b.disabled = undoStack.length===0;
  render();
  saveState();
}
function clearPlanningInput(){
  const pi=document.getElementById('planningInput'); if(pi) pi.value='';
  saveState();
}

function addManualMission(){
  pushUndo();
  syncAll();
  missions.unshift(createManualMission());
  render();
  saveState();
}

function removeMission(idx){
  pushUndo();
  syncAll();
  missions.splice(idx,1);
  render();
  saveState();
}

function markNoShow(idx){
  pushUndo();
  syncAll(); // capture les éditions manuelles avant transformation
  const m = missions[idx];
  if(!m) return;
  coreMarkNoShow(m);
  render();
  saveState();
}

function updateTypeBadge(idx){
  const type = document.getElementById(fieldId(idx,'type')).value;
  const badge = document.querySelector(`.mission[data-idx="${idx}"] .mission-head .badge`);
  if(badge){
    badge.className = `badge badge-${type||'Service'}`;
    badge.textContent = typeIcon(type) + (type || '—');
  }
}

function toggleAutre(idx, field){
  const sel = document.getElementById(fieldId(idx, field));
  const inp = document.getElementById(fieldId(idx, field+'Autre'));
  inp.style.display = sel.value === 'Autre' ? 'block' : 'none';
}

function updateTotal(idx){
  const s = parseInt(document.getElementById(fieldId(idx,'bagStandard')).value)||0;
  const h = parseInt(document.getElementById(fieldId(idx,'bagHorsFormat')).value)||0;
  const c = parseInt(document.getElementById(fieldId(idx,'bagCage')).value)||0;
  document.getElementById(fieldId(idx,'total')).textContent = s+h+c;
}

function val(idx,name){
  const el = document.getElementById(fieldId(idx,name));
  return el ? el.value.trim() : '';
}

function resolveLieu(idx, field){
  const selVal = val(idx, field);
  if(selVal === 'Autre'){
    return val(idx, field+'Autre');
  }
  if(selVal === 'AUTO_CHECKIN'){
    const vol = val(idx,'vol');
    return vol ? `Check in ${vol}` : 'Check in';
  }
  return selVal;
}

function validateMission(idx){
  // Lit les valeurs DOM dans la mission, délègue la liste des manquants au core,
  // puis applique le retour visuel (bordure rouge) sur les champs concernés.
  syncAll();
  const missing = coreValidate(missions[idx]);
  ['booking','pax','vol','terminal'].forEach(f => {
    const el = document.getElementById(fieldId(idx, f));
    if(el) el.classList.toggle('field-error', missing.includes(f));
  });
  return missing;
}

function generateReport(idx){
  const missing = validateMission(idx);
  if(missing.length){
    const labels = { booking:'Booking #', vol:'Vol', terminal:'Terminal', pax:'Nombre de passagers' };
    const list = missing.map(f => labels[f] || f).join(', ');
    const fb = document.getElementById(fieldId(idx,'feedback'));
    if(fb){
      fb.textContent = 'Champs manquants : ' + list;
      fb.classList.add('err', 'show');
      setTimeout(()=>fb.classList.remove('show'), 3500);
    }
    const first = document.getElementById(fieldId(idx, missing[0]));
    if(first) first.focus();
    return;
  }
  syncAll();
  const report = generateReportText(missions[idx]);

  document.getElementById(fieldId(idx,'pre')).textContent = report;
  document.getElementById(fieldId(idx,'output')).style.display = 'block';

  const m = missions[idx];
  syncDefaults({
    prebooking: m.prebooking, detaxe: m.detaxe,
    lieuRencontre: m.lieuRencontre, lieuRencontreAutre: m.lieuRencontreAutre,
    lieuDepose: m.lieuDepose, lieuDeposeAutre: m.lieuDeposeAutre,
    probleme: m.probleme, porteurs: m.porteurs, satisfaction: m.satisfaction,
    bagStandard: m.bagStandard, bagHorsFormat: m.bagHorsFormat, bagCage: m.bagCage
  });

  copyReport(idx);
}

async function copyReport(idx){
  const text = document.getElementById(fieldId(idx,'pre')).textContent;
  let ok = false;

  if(navigator.clipboard && window.isSecureContext){
    try{
      await navigator.clipboard.writeText(text);
      ok = true;
    }catch(e){ ok = false; }
  }

  if(!ok){
    // iOS Safari fallback: textarea must be visible, non-readonly, and selected via range
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent);
    if(isIOS){
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, text.length);
    }else{
      ta.select();
    }
    try{ ok = document.execCommand('copy'); }catch(e){ ok = false; }
    document.body.removeChild(ta);
  }

  const fb = document.getElementById(fieldId(idx,'feedback'));
  if(ok){
    fb.textContent = 'Copié ✓';
    fb.classList.remove('err');
    fb.classList.add('show');
    setTimeout(()=>fb.classList.remove('show'), 1500);
  }else{
    fb.textContent = 'Échec — sélectionne et copie à la main';
    fb.classList.add('err', 'show');
    setTimeout(()=>{ fb.classList.remove('show'); }, 3000);
  }
  return ok;
}

// Exposition des handlers appelés en inline (onclick=...) :
window.togglePorterCustom = togglePorterCustom;
window.reloadForPorter = reloadForPorter;
window.addManualMission = addManualMission;
window.removeMission = removeMission;
window.markNoShow = markNoShow;
window.toggleAutre = toggleAutre;
window.updateTotal = updateTotal;
window.updateTypeBadge = updateTypeBadge;
window.resolveLieu = resolveLieu;
window.generateReport = generateReport;
window.copyReport = copyReport;
window.pickBooking = pickBooking;
window.pickFlight = pickFlight;
window.undoMissions = undoMissions;
window.clearPlanningInput = clearPlanningInput;
window.clearState = clearState;
window.openPdfPicker = openPdfPicker;


document.getElementById('extractBtn').addEventListener('click', () => {
  syncAll();
  const porter = getPorterName();
  if(!porter){
    alert('Indique un nom de porteur.');
    return;
  }
  const text = document.getElementById('planningInput').value;
  harvestRoster(text);
  // Si des pages PDF sont en cache → parseur coordonnées (100 % fiable).
  // Sinon → moteur heuristique copier-coller.
  reloadForPorter();
});

render();

// Restaure la session du jour, puis sauvegarde à chaque modification.
restoreState();
refreshRosterUI();
let _saveTimer=null;
function saveStateDebounced(){ clearTimeout(_saveTimer); _saveTimer=setTimeout(saveState, 600); }
document.addEventListener('input', (e)=>{
  if(e.target.classList && e.target.classList.contains('field-error') && String(e.target.value).trim()){
    e.target.classList.remove('field-error');
  }
  if(e.target.closest && (e.target.closest('#missionsContainer')||e.target.id==='planningInput'||e.target.id==='porterCustom')) saveStateDebounced();
});
document.addEventListener('change', ()=>{ saveStateDebounced(); });
window.addEventListener('beforeunload', saveState);
window.addEventListener('pagehide', saveState);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') saveState(); });

// ── PDF IMPORT ──────────────────────────────────────────────────────────────
(function(){
  const input = document.getElementById('pdfInput');
  const status = document.getElementById('pdfStatus');
  if(!input) return;

  input.addEventListener('change', async function(){
    const file = this.files[0];
    if(!file) return;
    const porter = getPorterName();
    if(!porter){ alert('Indique un nom de porteur avant de charger le PDF.'); this.value=''; return; }

    status.style.display = 'block';
    status.style.color = '';
    status.textContent = '⏳ Lecture du PDF…';

    try {
      if(typeof pdfjsLib === 'undefined') throw new Error('pdf.js non chargé — vérifie ta connexion.');
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      const buf = await readPdfFile(file);
      const pdf = await pdfjsLib.getDocument({data: buf}).promise;
      const pages = [];
      let fullText = '';

      for(let p = 1; p <= pdf.numPages; p++){
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        pages.push(wordsFromTextContent(content));

        const rows = new Map();
        for(const item of content.items){
          const x = item.transform[4];
          const y = Math.round(item.transform[5] / 3) * 3;
          if(!rows.has(y)) rows.set(y, []);
          rows.get(y).push({x, text: item.str});
        }
        const sorted = [...rows.entries()].sort((a,b) => b[0] - a[0]);
        for(const [, items] of sorted){
          items.sort((a,b) => a.x - b.x);
          const line = items.map(i => i.text).join(' ').trim();
          if(line) fullText += line + '\n';
        }
        fullText += '\n';
      }

      document.getElementById('planningInput').value = fullText;
      lastPdfPages = pages;
      harvestRoster(fullText);
      if(missions.length) pushUndo();

      let extracted = missionsForPorter(pages, porter, CFG).map(r => {
        const m = createMission();
        Object.assign(m, r);
        if(!r.date) m.date = todayStr();
        return applyPlaceDefaults(m, CFG.places);
      });

      if(extracted.length === 0) extracted = extractMissions(fullText, porter, CFG);
      if(extracted.length) enrichWithPhones(extracted, fullText, CFG);

      if(extracted.length === 0){
        missions = [];
        document.getElementById('missionsContainer').innerHTML =
          '<div class="empty">Aucune mission trouvée pour "' + porter + '" dans ce PDF. Vérifie le nom du porteur.</div>' +
          '<button class="btn full-ghost" onclick="addManualMission()">+ Ajouter une mission manuelle</button>';
        status.textContent = '⚠️ Aucune mission pour « ' + porter + ' ».';
        status.style.color = '#c0392b';
        this.value = '';
        return;
      }

      missions = extracted;
      render();
      saveState();
      const n = extracted.length;
      status.textContent = `✅ ${n} mission${n>1?'s':''} extraite${n>1?'s':''} (${pdf.numPages} page${pdf.numPages>1?'s':''}).`;
      status.style.color = '#27ae60';
    } catch(e) {
      status.textContent = '❌ Erreur : ' + e.message;
      status.style.color = '#c0392b';
    }
    this.value = '';
  });
})();
