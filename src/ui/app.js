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
  todayStr, fmtTime
} from '../core/mission.js';
import { wordsFromTextContent, missionsForPorter } from '../core/parser-pdf.js';
import { extractMissions } from '../core/parser-text.js';
import { enrichWithPhones, enrichWithNotes } from '../core/enrich.js';
import { applyNoteBlock } from '../core/noteBlock.js';
import { generateReportText, resolvePlace } from '../core/report.js';
import { createSessionStore } from '../store/session.js';
import { t as translate, optionLabel, getLang, setLang, otherLang } from '../i18n/lang.js';

let missions = [];
let lastPdfPages = null;
// Langue de l'INTERFACE uniquement — n'affecte jamais les valeurs métier
// stockées dans une mission ni le rapport final généré, toujours en français.
let currentLang = getLang();
function t(key, vars){ return translate(currentLang, key, vars); }
function opt(group, value){ return optionLabel(currentLang, group, value); }

function applyStaticTranslations(){
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
  const toggle = document.getElementById('langToggle');
  if(toggle) toggle.textContent = t('header.langToggle');
}

function toggleLang(){
  syncAll();
  currentLang = otherLang(currentLang);
  setLang(currentLang);
  applyStaticTranslations();
  refreshRosterUI();
  render();
}

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

// Construit une mission depuis les champs bruts extraits par coordonnées
// (missionsForPorter/rowToFields) : defaults -> overlay -> lieux par type
// -> lieu réel signalé dans le bloc note (Parking pro/public, Dépose-minute),
// qui doit être réappliqué APRÈS applyPlaceDefaults (celui-ci écrase
// inconditionnellement lieuRencontre/lieuDepose selon le type — voir
// parser-pdf.js `rowToFields`). `noteBlock` est un champ intermédiaire,
// jamais un champ de mission : retiré avant de renvoyer l'objet.
function missionFromRow(r){
  const m = createMission();
  Object.assign(m, r);
  if(!r.date) m.date = todayStr();
  applyPlaceDefaults(m, CFG.places);
  if(r.noteBlock) applyNoteBlock(m, r.noteBlock, { onlyIfEmpty: false });
  delete m.noteBlock;
  return m;
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
    extracted = missionsForPorter(lastPdfPages, porter, CFG).map(missionFromRow);
    // Chemin coordonnées : greetSign/bagStandard/détaxe/lieux déjà fiables
    // (voir handler PDF ci-dessous), seul enrichWithPhones reste nécessaire
    // (contactPhone n'est jamais posé par coordonnées, voir parser-pdf.js).
    if(extracted.length && text) enrichWithPhones(extracted, text, CFG);
    if(!extracted.length && text){
      extracted = extractMissions(text, porter, CFG);
      if(extracted.length){ enrichWithPhones(extracted, text, CFG); enrichWithNotes(extracted, text, CFG); }
    }
  } else if(text){
    extracted = extractMissions(text, porter, CFG);
    if(extracted.length){ enrichWithPhones(extracted, text, CFG); enrichWithNotes(extracted, text, CFG); }
  } else {
    return; // rien de chargé
  }
  if(missions.length) pushUndo();
  if(extracted.length){
    extracted.forEach(m => {
      if((m.bookingOptions||[]).length > 1 || (m.flightOptions||[]).length > 1) m.expanded = true;
    });
    missions = extracted;
    render();
  } else {
    missions = [];
    document.getElementById('missionsContainer').innerHTML =
      `<div class="empty">${escHtml(t('missions.emptyForPorter', { porter }))}</div>` +
      `<button class="btn full-ghost" onclick="addManualMission()">${t('missions.addManual')}</button>`;
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
    const line = raw.trim();
    const g = line.match(/greete?r[\s:]*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\-]*)/i);
    if(g){ const n = g[1].trim(); if(['a','à','venir','voir'].indexOf(n.toLowerCase()) === -1) greeters.add(n); }
    const c = line.replace(/^NCE\s+/, '').replace(/\s*\+?\d.*$/, '').trim();
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
  sel.innerHTML = merged.map(n=>`<option>${escHtml(n)}</option>`).join('') + `<option value="custom">${escHtml(t('porter.other'))}</option>`;
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
  let html = `<div class="candidates"><div class="clabel">${t('candidates.warning')}</div>`;
  if(bOpts.length > 1){
    html += `<div class="csub">${t('candidates.bookingSub')}</div>`;
    html += '<div class="chips">';
    html += bOpts.map(b => `<span class="chip ${b.num===m.booking?'active':''}" data-num="${b.num}" data-live="${b.live?'1':'0'}" onclick="pickBooking(${idx}, this)">${b.time ? b.time + ' · ' : ''}${b.num}${b.live?t('candidates.live'):''}</span>`).join('');
    html += '</div>';
  }
  if(fOpts.length > 1){
    html += `<div class="csub">${t('candidates.flightSub')}</div>`;
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
    const time = missions[idx] ? fmtTime(missions[idx].sortTime) : '';
    titleEl.innerHTML = el.getAttribute('data-num') + (time ? ' <span class="mtime">· ' + time + '</span>' : '');
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

// T1/T2 ont chacun leur propre couleur pour se distinguer d'un coup d'œil ;
// tout autre numéro (repli) garde le style neutre d'origine.
function terminalBadgeClass(term){
  return { '1': 'badge-terminal-1', '2': 'badge-terminal-2' }[term] || 'badge-terminal';
}

// Terminal et type ont déjà leur propre badge (ligne 2) : pas besoin de les
// répéter ici, juste de quoi identifier le client/la mission d'un coup d'œil.
function missionSummary(m){
  const bits = [];
  if(m.client) bits.push(m.client);
  if(m.vol) bits.push(m.vol);
  return bits.join(' · ');
}

function renderMission(m, idx){
  const total = (parseInt(m.bagStandard)||0) + (parseInt(m.bagHorsFormat)||0) + (parseInt(m.bagCage)||0);
  const isOpen = !!m.expanded;
  const summary = missionSummary(m);
  return `
  <div class="mission${isOpen?' open':''}" data-idx="${idx}">
    <div class="mission-head" onclick="toggleMission(${idx})">
      <div class="mhead-top">
        <div class="mhead-main">
          <strong>${m.booking || t('missions.newMission')}${fmtTime(m.sortTime) ? ' <span class="mtime">· ' + fmtTime(m.sortTime) + '</span>' : ''}</strong>
          ${summary ? `<span class="mhead-summary">${escHtml(summary)}</span>` : ''}
        </div>
        <div class="mhead-controls">
          <button class="del" onclick="event.stopPropagation();removeMission(${idx})" title="${t('mission.deleteTitle')}">✕</button>
          <span class="chevron">▾</span>
        </div>
      </div>
      <div class="mhead-tags">
        <button class="btn-noshow" onclick="event.stopPropagation();markNoShow(${idx})" title="${t('mission.markNoShowTitle')}">${t('mission.noShow')}</button>
        <div class="mhead-badges">
          <span class="badge badge-${m.type||'Service'}">${typeIcon(m.type)}${m.type || '—'}</span>
          ${m.terminal ? `<span class="badge ${terminalBadgeClass(m.terminal)}">T${escHtml(m.terminal)}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="mission-body">
      ${renderCandidates(m, idx)}
      ${m.greetSign ? `<div class="note-banner">🪧 ${t('note.greetSign')} : <strong>${escHtml(m.greetSign)}</strong></div>` : ''}

      <div class="section">
        <div class="section-title">${t('section.identity')}</div>
        <div class="grid">
          <div class="field"><label>${t('field.booking')}</label><input id="${fieldId(idx,'booking')}" value="${m.booking}"></div>
          <div class="field"><label>${t('field.date')}</label><input id="${fieldId(idx,'date')}" value="${m.date}"></div>
          <div class="field full"><label>${t('field.client')}</label><input id="${fieldId(idx,'client')}" value="${m.client}" oninput="this.value=this.value.toUpperCase()">
          ${m.clientPhone ? `<div class="tel-row"><a href="tel:${m.clientPhone}" class="tel-chip">📞 ${m.clientPhone}</a></div>` : ''}
          </div>
          <div class="field full"><label>${t('field.greeter')}</label><input id="${fieldId(idx,'greeteur')}" list="greetersList" value="${m.greeteur}" placeholder="${t('field.greeterPlaceholder')}" oninput="this.value=this.value.toUpperCase()">
          ${m.greeteurPhone ? `<div class="tel-row"><a href="tel:${m.greeteurPhone}" class="tel-chip">📞 ${m.greeteurPhone}</a></div>` : ''}
          </div>
          ${m.contactPhone ? `<div class="field full"><label>${t('field.contactDriver')}</label><div class="tel-row"><a href="tel:${m.contactPhone}" class="tel-chip">📞 ${m.contactPhone}</a></div></div>` : ''}
          <div class="field">
            <label>${t('field.prebooking')}</label>
            <select id="${fieldId(idx,'prebooking')}">
              <option value="PRÉ-BOOKING" ${m.prebooking==='PRÉ-BOOKING'?'selected':''}>${opt('prebooking','PRÉ-BOOKING')}</option>
              <option value="LIVE" ${m.prebooking==='LIVE'?'selected':''}>${opt('prebooking','LIVE')}</option>
            </select>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">${t('section.flight')}</div>
        <div class="grid">
          <div class="field">
            <label>${t('field.serviceType')}</label>
            <select id="${fieldId(idx,'type')}" onchange="updateTypeBadge(${idx})">
              <option value="DEP" ${m.type==='DEP'?'selected':''}>🛫 DEP</option>
              <option value="ARR" ${m.type==='ARR'?'selected':''}>🛬 ARR</option>
              <option value="TRS" ${m.type==='TRS'?'selected':''}>🔁 TRS</option>
            </select>
          </div>
          <div class="field"><label>${t('field.pax')}</label><input id="${fieldId(idx,'pax')}" value="${m.pax}" inputmode="numeric"></div>
          <div class="field"><label>${t('field.flight')}</label>
            <div class="input-copy-row">
              <input id="${fieldId(idx,'vol')}" value="${m.vol}" oninput="this.value=this.value.toUpperCase()">
              <button type="button" class="copy-icon-btn" id="${fieldId(idx,'volCopyBtn')}" onclick="copyFlight(${idx})" title="${t('field.copyFlightTitle')}">📋</button>
            </div>
          </div>
          <div class="field"><label>${t('field.terminal')}</label><input id="${fieldId(idx,'terminal')}" value="${m.terminal}" inputmode="numeric" oninput="this.value=this.value.replace(/\D/g,'')"></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">${t('section.bags')}</div>
        <div class="grid">
          <div class="field"><label>${t('field.bagStandard')}</label><input id="${fieldId(idx,'bagStandard')}" value="${m.bagStandard}" inputmode="numeric" oninput="updateTotal(${idx})">
          ${m.bagExpected ? `<div class="hint">${t('field.bagExpectedHint', { n: m.bagExpected })}</div>` : ''}
          </div>
          <div class="field"><label>${t('field.bagOversize')}</label><input id="${fieldId(idx,'bagHorsFormat')}" value="${m.bagHorsFormat}" inputmode="numeric" oninput="updateTotal(${idx})"></div>
          <div class="field full"><label>${t('field.bagCage')}</label><input id="${fieldId(idx,'bagCage')}" value="${m.bagCage}" inputmode="numeric" oninput="updateTotal(${idx})"></div>
        </div>
        <div class="total-row">
          <span>${t('field.bagTotal')}</span>
          <strong id="${fieldId(idx,'total')}">${total}</strong>
        </div>
      </div>

      <div class="section">
        <div class="section-title">${t('section.places')}</div>
        <div class="grid">
          <div class="field">
            <label>${t('field.detax')}</label>
            <select id="${fieldId(idx,'detaxe')}">
              <option value="Non" ${m.detaxe==='Non'?'selected':''}>${opt('detaxe','Non')}</option>
              <option value="Oui" ${m.detaxe==='Oui'?'selected':''}>${opt('detaxe','Oui')}</option>
              <option value="N/A" ${m.detaxe==='N/A'?'selected':''}>${opt('detaxe','N/A')}</option>
            </select>
          </div>
          <div class="field">
            <label>${t('field.porters')}</label>
            <input id="${fieldId(idx,'porteurs')}" value="${m.porteurs}">
          </div>

          <div class="field">
            <label>${t('field.meetPlace')}</label>
            <select id="${fieldId(idx,'lieuRencontre')}" onchange="toggleAutre(${idx},'lieuRencontre')">
              <option value="Dépose minute" ${m.lieuRencontre==='Dépose minute'?'selected':''}>${opt('places','Dépose minute')}</option>
              <option value="Tapis bagage" ${m.lieuRencontre==='Tapis bagage'?'selected':''}>${opt('places','Tapis bagage')}</option>
              <option value="Parking pro" ${m.lieuRencontre==='Parking pro'?'selected':''}>${opt('places','Parking pro')}</option>
              <option value="Parking public" ${m.lieuRencontre==='Parking public'?'selected':''}>${opt('places','Parking public')}</option>
              <option value="Linéaire Professionnel" ${m.lieuRencontre==='Linéaire Professionnel'?'selected':''}>${opt('places','Linéaire Professionnel')}</option>
              <option value="Gare routière (BUS)" ${m.lieuRencontre==='Gare routière (BUS)'?'selected':''}>${opt('places','Gare routière (BUS)')}</option>
              <option value="Loueurs" ${m.lieuRencontre==='Loueurs'?'selected':''}>${opt('places','Loueurs')}</option>
              <option value="Vol privé" ${m.lieuRencontre==='Vol privé'?'selected':''}>${opt('places','Vol privé')}</option>
              <option value="Autre" ${m.lieuRencontre==='Autre'?'selected':''}>${opt('places','Autre')}</option>
              <option value="N/A" ${m.lieuRencontre==='N/A'?'selected':''}>${opt('places','N/A')}</option>
            </select>
            <input class="autre-input" id="${fieldId(idx,'lieuRencontreAutre')}" placeholder="${t('field.placeOtherPlaceholder')}" value="${m.lieuRencontreAutre||''}" style="display:${m.lieuRencontre==='Autre'?'block':'none'}">
          </div>

          <div class="field">
            <label>${t('field.dropPlace')}</label>
            <select id="${fieldId(idx,'lieuDepose')}" onchange="toggleAutre(${idx},'lieuDepose')">
              <option value="AUTO_CHECKIN" ${m.lieuDepose==='AUTO_CHECKIN'?'selected':''}>${t('field.autoCheckin', { vol: m.vol })}</option>
              <option value="Dépose minute" ${m.lieuDepose==='Dépose minute'?'selected':''}>${opt('places','Dépose minute')}</option>
              <option value="Tapis bagage" ${m.lieuDepose==='Tapis bagage'?'selected':''}>${opt('places','Tapis bagage')}</option>
              <option value="Parking pro" ${m.lieuDepose==='Parking pro'?'selected':''}>${opt('places','Parking pro')}</option>
              <option value="Parking public" ${m.lieuDepose==='Parking public'?'selected':''}>${opt('places','Parking public')}</option>
              <option value="Gare routière (BUS)" ${m.lieuDepose==='Gare routière (BUS)'?'selected':''}>${opt('places','Gare routière (BUS)')}</option>
              <option value="Loueurs" ${m.lieuDepose==='Loueurs'?'selected':''}>${opt('places','Loueurs')}</option>
              <option value="Vol privé" ${m.lieuDepose==='Vol privé'?'selected':''}>${opt('places','Vol privé')}</option>
              <option value="Autre" ${m.lieuDepose==='Autre'?'selected':''}>${opt('places','Autre')}</option>
              <option value="N/A" ${m.lieuDepose==='N/A'?'selected':''}>${opt('places','N/A')}</option>
            </select>
            <input class="autre-input" id="${fieldId(idx,'lieuDeposeAutre')}" placeholder="${t('field.placeOtherPlaceholder')}" value="${m.lieuDeposeAutre||''}" style="display:${m.lieuDepose==='Autre'?'block':'none'}">
          </div>

          <div class="field full"><label>${t('field.problem')}</label><textarea class="small" id="${fieldId(idx,'probleme')}">${m.probleme}</textarea></div>

          <div class="field full">
            <label>${t('field.satisfaction')}</label>
            <select id="${fieldId(idx,'satisfaction')}">
              <option value="Excellente" ${m.satisfaction==='Excellente'?'selected':''}>${opt('satisfaction','Excellente')}</option>
              <option value="Très bien" ${m.satisfaction==='Très bien'?'selected':''}>${opt('satisfaction','Très bien')}</option>
              <option value="Bonne" ${m.satisfaction==='Bonne'?'selected':''}>${opt('satisfaction','Bonne')}</option>
              <option value="Moyenne" ${m.satisfaction==='Moyenne'?'selected':''}>${opt('satisfaction','Moyenne')}</option>
              <option value="Mauvaise" ${m.satisfaction==='Mauvaise'?'selected':''}>${opt('satisfaction','Mauvaise')}</option>
              <option value="N/A" ${m.satisfaction==='N/A'?'selected':''}>${opt('satisfaction','N/A')}</option>
            </select>
          </div>
        </div>
      </div>

      <div class="actions-row">
        <button class="btn secondary" style="width:auto;flex:1" onclick="generateReport(${idx})">${t('report.generate')}</button>
        <span class="copy-feedback" id="${fieldId(idx,'feedback')}">${t('report.copied')}</span>
      </div>
      <div class="output" id="${fieldId(idx,'output')}" style="display:none">
        <pre id="${fieldId(idx,'pre')}"></pre>
        <button class="btn ghost" onclick="copyReport(${idx})">${t('report.copyText')}</button>
      </div>
    </div>
  </div>`;
}

function render(){
  const container = document.getElementById('missionsContainer');
  let html = '';
  if(missions.length === 0){
    html += `<div class="empty">${t('missions.empty')}</div>`;
  } else {
    html += `<button class="btn full-ghost" onclick="addManualMission()" style="margin-bottom:10px">${t('missions.addManual')}</button>`;
    html += missions.map((m,i)=>renderMission(m,i)).join('');
  }
  html += `<button class="btn full-ghost" onclick="addManualMission()">${t('missions.addManual')}</button>`;
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
  const m = createManualMission();
  m.expanded = true;
  missions.unshift(m);
  render();
  saveState();
}

function toggleMission(idx){
  const m = missions[idx];
  if(!m) return;
  m.expanded = !m.expanded;
  const card = document.querySelector(`.mission[data-idx="${idx}"]`);
  if(card) card.classList.toggle('open', m.expanded);
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
    const labels = { booking:t('validation.booking'), vol:t('validation.flight'), terminal:t('validation.terminal'), pax:t('validation.pax') };
    const list = missing.map(f => labels[f] || f).join(', ');
    const fb = document.getElementById(fieldId(idx,'feedback'));
    if(fb){
      fb.textContent = t('validation.missingFields') + list;
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

  copyReport(idx);
}

async function writeClipboard(text){
  if(navigator.clipboard && window.isSecureContext){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    }catch(e){ /* repli ci-dessous */ }
  }

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
  let ok = false;
  try{ ok = document.execCommand('copy'); }catch(e){ ok = false; }
  document.body.removeChild(ta);
  return ok;
}

async function copyReport(idx){
  const text = document.getElementById(fieldId(idx,'pre')).textContent;
  const ok = await writeClipboard(text);

  const fb = document.getElementById(fieldId(idx,'feedback'));
  if(ok){
    fb.textContent = t('report.copied');
    fb.classList.remove('err');
    fb.classList.add('show');
    setTimeout(()=>fb.classList.remove('show'), 1500);
  }else{
    fb.textContent = t('report.copyFailed');
    fb.classList.add('err', 'show');
    setTimeout(()=>{ fb.classList.remove('show'); }, 3000);
  }
  return ok;
}

async function copyFlight(idx){
  const input = document.getElementById(fieldId(idx,'vol'));
  const text = input.value.trim();
  if(!text) return false;
  const ok = await writeClipboard(text);

  const btn = document.getElementById(fieldId(idx,'volCopyBtn'));
  if(btn){
    const original = btn.textContent;
    btn.textContent = ok ? '✓' : '✕';
    setTimeout(()=>{ btn.textContent = original; }, 1200);
  }
  return ok;
}

// Exposition des handlers appelés en inline (onclick=...) :
window.togglePorterCustom = togglePorterCustom;
window.reloadForPorter = reloadForPorter;
window.addManualMission = addManualMission;
window.removeMission = removeMission;
window.toggleMission = toggleMission;
window.markNoShow = markNoShow;
window.toggleAutre = toggleAutre;
window.updateTotal = updateTotal;
window.updateTypeBadge = updateTypeBadge;
window.resolveLieu = resolveLieu;
window.generateReport = generateReport;
window.copyReport = copyReport;
window.copyFlight = copyFlight;
window.pickBooking = pickBooking;
window.pickFlight = pickFlight;
window.undoMissions = undoMissions;
window.clearPlanningInput = clearPlanningInput;
window.clearState = clearState;
window.openPdfPicker = openPdfPicker;
window.toggleLang = toggleLang;


document.getElementById('extractBtn').addEventListener('click', () => {
  syncAll();
  const porter = getPorterName();
  if(!porter){
    alert(t('alert.needPorter'));
    return;
  }
  const text = document.getElementById('planningInput').value;
  harvestRoster(text);
  // Si des pages PDF sont en cache → parseur coordonnées (100 % fiable).
  // Sinon → moteur heuristique copier-coller.
  reloadForPorter();
});

applyStaticTranslations();
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
    if(!porter){ alert(t('alert.needPorterPdf')); this.value=''; return; }

    status.style.display = 'block';
    status.style.color = '';
    status.textContent = t('pdf.reading');

    try {
      if(typeof pdfjsLib === 'undefined') throw new Error(t('pdf.notLoaded'));
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

      let extracted = missionsForPorter(pages, porter, CFG).map(missionFromRow);

      // Le chemin coordonnées (missionsForPorter/rowToFields) renseigne déjà
      // greetSign/bagStandard/détaxe/lieux de façon fiable (bande Y par
      // mission) — enrichWithNotes (texte aplati, moins fiable sur les notes
      // très hautes qui s'entrelacent entre missions) ne s'applique qu'au
      // repli texte, jamais en plus du chemin coordonnées.
      if(extracted.length === 0){
        extracted = extractMissions(fullText, porter, CFG);
        if(extracted.length) enrichWithNotes(extracted, fullText, CFG);
      }
      if(extracted.length) enrichWithPhones(extracted, fullText, CFG);

      if(extracted.length === 0){
        missions = [];
        document.getElementById('missionsContainer').innerHTML =
          `<div class="empty">${escHtml(t('missions.emptyForPorterPdf', { porter }))}</div>` +
          `<button class="btn full-ghost" onclick="addManualMission()">${t('missions.addManual')}</button>`;
        status.textContent = t('pdf.noMissions', { porter });
        status.style.color = '#c0392b';
        this.value = '';
        return;
      }

      missions = extracted;
      render();
      saveState();
      const n = extracted.length;
      status.textContent = t('pdf.success', { n, pages: pdf.numPages });
      status.style.color = '#27ae60';
    } catch(e) {
      status.textContent = t('pdf.error', { message: e.message });
      status.style.color = '#c0392b';
    }
    this.value = '';
  });
})();
