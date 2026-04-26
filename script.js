/* CardVault – File System Access API + IndexedDB handle persistence */
'use strict';

// ─── IDB for file handle ──────────────────────────────────────
const IDB_NAME = 'cardvault', IDB_STORE = 'handles', IDB_KEY = 'datafile';

function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r  = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror   = e => rej(e.target.error);
  });
}

async function idbPut(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const r  = tx.objectStore(IDB_STORE).put(val, key);
    r.onsuccess = () => res();
    r.onerror   = e => rej(e.target.error);
  });
}

// ─── State ───────────────────────────────────────────────────
let cards         = [];
let fileHandle    = null;
let showingHidden = false;
let viewMode      = localStorage.getItem('cv_view') || 'grid';
let usdRate       = null;
let rateUpdatedAt = null;

// ─── DOM ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const onboardOverlay  = $('onboard-overlay');
const onboardError    = $('onboard-error');
const btnOpenFile     = $('btn-open-file');
const btnNewFile      = $('btn-new-file');
const btnChangeFile   = $('btn-change-file');
const btnExportCsv    = $('btn-export-csv');
const btnAddCard      = $('btn-add-card');
const fileStatusEl    = $('file-status');
const fileStatusName  = $('file-status-name');
const modalOverlay    = $('modal-overlay');
const modalCloseBtn   = $('modal-close-btn');
const btnCancel       = $('btn-cancel');
const cardForm        = $('card-form');
const modalTitle      = $('modal-title');
const fName    = $('f-name');
const fNumber  = $('f-number');
const fExpiry  = $('f-expiry');
const fCvv     = $('f-cvv');
const fColor   = $('f-color');
const fBalance = $('f-balance');
const fLimit   = $('f-limit');
const fLink    = $('f-link');
const fReward  = $('f-reward');
const fNotes   = $('f-notes');
const fEditId  = $('edit-id');
const prevName   = $('prev-name');
const prevNumber = $('prev-number');
const prevExpiry = $('prev-expiry');
const prevCvv    = $('prev-cvv');
const prevCard   = $('preview-card');
const activeGrid    = $('cards-active-grid');
const hiddenGrid    = $('cards-hidden-grid');
const emptyActive   = $('empty-active');
const emptyHidden   = $('empty-hidden');
const sectionHidden = $('section-hidden');
const statTotal     = $('stat-total');
const statActive    = $('stat-active');
const statHidden    = $('stat-hidden');
const statTotalUsd  = $('stat-total-usd');
const statTotalBrl  = $('stat-total-brl');
const statCotacao   = $('stat-cotacao');
const cotacaoStatus = $('cotacao-status');
const btnToggleHidden   = $('btn-toggle-hidden');
const hiddenToggleLabel = $('hidden-toggle-label');
const viewGridBtn = $('view-grid-btn');
const viewListBtn = $('view-list-btn');
const toast       = $('toast');

// ─── File System Access ──────────────────────────────────────
const OPTS_OPEN = { types: [{ description: 'CardVault JSON', accept: { 'application/json': ['.json'] } }], multiple: false };
const OPTS_SAVE = { types: [{ description: 'CardVault JSON', accept: { 'application/json': ['.json'] } }], suggestedName: 'cardvault.json' };

async function readFromHandle(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  try { return JSON.parse(text); } catch { return []; }
}

async function writeToHandle(handle, data) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function verifyPermission(handle, write = true) {
  const opts = { mode: write ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

function setFileReady(handle, name) {
  fileHandle = handle;
  fileStatusName.textContent = name;
  fileStatusEl.classList.remove('hidden');
  btnChangeFile.classList.remove('hidden');
  btnAddCard.disabled = false;
  onboardOverlay.classList.add('hidden');
}

async function saveCards() {
  if (!fileHandle) return;
  try { await writeToHandle(fileHandle, cards); }
  catch (e) { showToast('Erro ao salvar arquivo.', 'error'); }
}

// ─── Onboarding ───────────────────────────────────────────────
async function tryRestoreHandle() {
  try {
    const h = await idbGet(IDB_KEY);
    if (!h) return false;
    if (await verifyPermission(h, true)) {
      const data = await readFromHandle(h);
      cards = Array.isArray(data) ? data : [];
      setFileReady(h, h.name);
      return true;
    }
  } catch {}
  return false;
}

btnOpenFile.addEventListener('click', async () => {
  try {
    const [handle] = await window.showOpenFilePicker(OPTS_OPEN);
    if (!(await verifyPermission(handle, true))) { showOnboardError('Permissão negada.'); return; }
    const data = await readFromHandle(handle);
    cards = Array.isArray(data) ? data : [];
    await idbPut(IDB_KEY, handle);
    setFileReady(handle, handle.name);
    render();
  } catch (e) { if (e.name !== 'AbortError') showOnboardError('Erro ao abrir arquivo.'); }
});

btnNewFile.addEventListener('click', async () => {
  try {
    const handle = await window.showSaveFilePicker(OPTS_SAVE);
    if (!(await verifyPermission(handle, true))) { showOnboardError('Permissão negada.'); return; }
    cards = [];
    await writeToHandle(handle, cards);
    await idbPut(IDB_KEY, handle);
    setFileReady(handle, handle.name);
    render();
  } catch (e) { if (e.name !== 'AbortError') showOnboardError('Erro ao criar arquivo.'); }
});

btnChangeFile.addEventListener('click', async () => {
  try {
    const [handle] = await window.showOpenFilePicker(OPTS_OPEN);
    if (!(await verifyPermission(handle, true))) { showToast('Permissão negada.', 'error'); return; }
    const data = await readFromHandle(handle);
    cards = Array.isArray(data) ? data : [];
    await idbPut(IDB_KEY, handle);
    setFileReady(handle, handle.name);
    render();
    showToast('Arquivo alterado!');
  } catch (e) { if (e.name !== 'AbortError') showToast('Erro ao trocar arquivo.', 'error'); }
});

function showOnboardError(msg) {
  onboardError.textContent = msg;
  onboardError.classList.remove('hidden');
}

// ─── CSV Export ───────────────────────────────────────────────
btnExportCsv.addEventListener('click', () => {
  const header = ['id','name','number','expiry','cvv','color','balance','limit','link','reward','notes','hidden','created','updated'];
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = cards.map(c => header.map(k => esc(c[k])).join(','));
  const csv  = [header.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cardvault_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado!');
});

// ─── Exchange Rate ────────────────────────────────────────────
async function fetchRate() {
  try {
    const res  = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
    const data = await res.json();
    const bid  = parseFloat(data.USDBRL.bid);
    if (!isNaN(bid) && bid > 0) {
      usdRate = bid; rateUpdatedAt = new Date();
      const fmt = bid.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
      statCotacao.textContent = `R$ ${fmt}`;
      const h = rateUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      cotacaoStatus.textContent = `atualizado ${h}`;
      renderTotals(); render();
    }
  } catch { cotacaoStatus.textContent = 'sem conexão'; }
}

// ─── Utility ─────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const formatNumber = r => r.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim();
const maskNumber   = n => { const c=n.replace(/\s/g,''); return c.length<4?'•••• •••• •••• ••••':`•••• •••• •••• ${c.slice(-4)}`; };
const parseUsd     = v => { if(v==null||v==='') return null; const n=parseFloat(String(v).replace(',','.')); return isNaN(n)?null:n; };
const fmtUsd = n => n.toLocaleString('en-US',{style:'currency',currency:'USD'});
const fmtBrl = n => n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const shortenUrl = url => { try { let h=new URL(url).hostname.replace(/^www\./,''); return h.length>28?h.slice(0,26)+'…':h; } catch { return url.length>30?url.slice(0,28)+'…':url; } };
const escHtml = s => { const d=document.createElement('div'); d.textContent=String(s||''); return d.innerHTML; };

function showToast(msg, type='success') {
  toast.textContent=msg; toast.className=`toast show ${type}`;
  clearTimeout(toast._t); toast._t=setTimeout(()=>{toast.className='toast';},3000);
}

// ─── Totals ───────────────────────────────────────────────────
function renderTotals() {
  const active = cards.filter(c=>!c.hidden);
  let total=0, has=false;
  for(const c of active){ const b=parseUsd(c.balance); if(b!==null){total+=b;has=true;} }
  statTotalUsd.textContent = has ? fmtUsd(total) : '—';
  statTotalBrl.textContent = has && usdRate ? fmtBrl(total*usdRate) : '—';
}

// ─── Copy ─────────────────────────────────────────────────────
function copyNumber(id) {
  const c = cards.find(x=>x.id===id); if(!c) return;
  const clean = c.number.replace(/\s/g,'');
  const done  = ()=>showToast('Número copiado! 📋');
  if(navigator.clipboard) navigator.clipboard.writeText(clean).then(done).catch(()=>fallback(clean,done));
  else fallback(clean,done);
}
function fallback(text,cb){
  const ta=document.createElement('textarea'); ta.value=text;
  Object.assign(ta.style,{position:'fixed',opacity:'0'});
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); cb();
}

// ─── Modal ────────────────────────────────────────────────────
function openModal(id=null) {
  resetForm();
  if(id){
    const c=cards.find(x=>x.id===id); if(!c) return;
    modalTitle.textContent='Editar Cartão';
    fEditId.value=c.id; fName.value=c.name||''; fNumber.value=c.number||'';
    fExpiry.value=c.expiry||''; fCvv.value=c.cvv||''; fColor.value=c.color||'blue';
    fBalance.value=c.balance||''; fLimit.value=c.limit||'';
    fLink.value=c.link||''; fReward.value=c.reward||''; fNotes.value=c.notes||'';
    syncPreview();
  } else { modalTitle.textContent='Novo Cartão'; }
  modalOverlay.classList.add('open'); fName.focus();
}
function closeModal(){ modalOverlay.classList.remove('open'); resetForm(); }
function resetForm(){ cardForm.reset(); fEditId.value=''; fColor.value='blue'; syncPreview(); }

// ─── Preview ─────────────────────────────────────────────────
function syncPreview(){
  prevName.textContent   = fName.value.trim().toUpperCase()||'SEU NOME';
  prevNumber.textContent = fNumber.value.trim()?formatNumber(fNumber.value):'•••• •••• •••• ••••';
  prevExpiry.textContent = fExpiry.value.trim()||'MM/AA';
  prevCvv.textContent    = fCvv.value.trim()||'•••';
  prevCard.className     = `credit-card preview-card ${fColor.value||'blue'}`;
}
fName.addEventListener('input',syncPreview);
fExpiry.addEventListener('input',syncPreview);
fCvv.addEventListener('input',syncPreview);
fColor.addEventListener('change',syncPreview);
fNumber.addEventListener('input',function(){
  this.value=this.value.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim(); syncPreview();
});
fExpiry.addEventListener('input',function(){
  let v=this.value.replace(/\D/g,'').slice(0,4);
  if(v.length>=3) v=v.slice(0,2)+'/'+v.slice(2); this.value=v; syncPreview();
});

// ─── CRUD ─────────────────────────────────────────────────────
cardForm.addEventListener('submit', async function(e){
  e.preventDefault();
  const id=fEditId.value;
  const card={
    id:id||uid(), name:fName.value.trim().toUpperCase(), number:fNumber.value.trim(),
    expiry:fExpiry.value.trim(), cvv:fCvv.value.trim(), color:fColor.value,
    balance:fBalance.value.trim(), limit:fLimit.value.trim(),
    link:fLink.value.trim(), reward:fReward.value.trim(), notes:fNotes.value.trim(),
    hidden:false,
    created:id?(cards.find(c=>c.id===id)?.created||new Date().toISOString()):new Date().toISOString(),
    updated:new Date().toISOString(),
  };
  if(!card.name){showToast('Informe o titular.','error');fName.focus();return;}
  if(!card.number){showToast('Informe o número.','error');fNumber.focus();return;}
  if(id){ const i=cards.findIndex(c=>c.id===id); if(i!==-1){card.hidden=cards[i].hidden;cards[i]=card;} showToast('Cartão atualizado!'); }
  else  { cards.push(card); showToast('Cartão adicionado!'); }
  await saveCards(); closeModal(); render();
});

async function hideCard(id){
  const c=cards.find(x=>x.id===id); if(c){c.hidden=true;c.updated=new Date().toISOString();}
  await saveCards(); showToast('Cartão ocultado.'); render();
}
async function restoreCard(id){
  const c=cards.find(x=>x.id===id); if(c){c.hidden=false;c.updated=new Date().toISOString();}
  await saveCards(); showToast('Cartão restaurado.'); render();
}
async function deleteCard(id){
  if(!confirm('Excluir permanentemente? Não pode ser desfeito.')) return;
  cards=cards.filter(c=>c.id!==id);
  await saveCards(); showToast('Cartão excluído.','error'); render();
}

// ─── Build card HTML ──────────────────────────────────────────
function buildCardHTML(c){
  const numDisplay=maskNumber(c.number), fullNumber=formatNumber(c.number);
  const linkHTML=c.link?`<a href="${escHtml(c.link)}" target="_blank" rel="noopener">${escHtml(shortenUrl(c.link))}</a>`:'<span style="opacity:.4">—</span>';
  const rewardHTML=c.reward?`<span class="mono">${escHtml(c.reward)}</span>`:'<span style="opacity:.4">—</span>';
  const balUsd=parseUsd(c.balance), limUsd=parseUsd(c.limit);
  const balCls=balUsd===0?'empty':(c.limit&&balUsd<parseUsd(c.limit)*0.2?'warn':'');
  const balHTML=balUsd!==null?`<span class="balance-badge ${balCls}">${fmtUsd(balUsd)}</span>`:'<span style="opacity:.4">—</span>';
  const balBrl=usdRate&&balUsd!==null?`<span class="brl-badge">≈${fmtBrl(balUsd*usdRate)}</span>`:'';
  const limHTML=limUsd!==null?escHtml(fmtUsd(limUsd)):'—';
  const limBrl=usdRate&&limUsd!==null?`<span class="brl-badge">≈${fmtBrl(limUsd*usdRate)}</span>`:'';
  const notesHTML=c.notes?`<div class="card-meta-row"><div class="meta-field" style="flex:1"><span class="meta-label">Observações</span><span class="meta-value">${escHtml(c.notes)}</span></div></div>`:'';
  const copyBtn=`<button class="action-btn copy" onclick="copyNumber('${c.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copiar nº</button>`;
  const editBtn=`<button class="action-btn edit" onclick="openModal('${c.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Editar</button>`;
  const hideBtn=`<button class="action-btn hide" onclick="hideCard('${c.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>Ocultar</button>`;
  const restoreBtn=`<button class="action-btn restore" onclick="restoreCard('${c.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Restaurar</button>`;
  const deleteBtn=`<button class="action-btn hide" onclick="deleteCard('${c.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>Excluir</button>`;
  const actions=c.hidden?`${restoreBtn}${deleteBtn}`:`${copyBtn}${editBtn}${hideBtn}`;

  return `<div class="card-wrapper" id="card-${c.id}">
    <div class="credit-card ${escHtml(c.color||'blue')}">
      <div class="card-shine"></div>
      <div class="card-top">
        <div class="card-chip"><div class="chip-lines"></div></div>
        <div class="card-brand"><svg class="visa-logo" viewBox="0 0 60 20" xmlns="http://www.w3.org/2000/svg"><text x="0" y="18" font-family="Arial" font-size="22" font-weight="bold" font-style="italic" fill="white">VISA</text></svg></div>
      </div>
      <div class="card-number-display">${escHtml(numDisplay)}</div>
      <div class="card-bottom">
        <div class="card-info-group"><span class="card-label">Titular</span><span class="card-value">${escHtml(c.name)}</span></div>
        <div class="card-info-group"><span class="card-label">Validade</span><span class="card-value">${escHtml(c.expiry)}</span></div>
        <div class="card-info-group cvv-group"><span class="card-label">CVV</span><span class="card-value">${escHtml(c.cvv)}</span></div>
      </div>
    </div>
    <div class="card-meta">
      <div class="card-meta-row"><div class="meta-field" style="flex:1"><span class="meta-label">Número Completo</span><span class="meta-value mono">${escHtml(fullNumber)}</span></div></div>
      <div class="card-meta-row">
        <div class="meta-field" style="flex:1"><span class="meta-label">Saldo (USD)</span><span class="meta-value">${balHTML} ${balBrl}</span></div>
        <div class="meta-field" style="flex:1"><span class="meta-label">Limite (USD)</span><span class="meta-value mono">${limHTML} ${limBrl}</span></div>
      </div>
      <div class="card-meta-row">
        <div class="meta-field" style="flex:1"><span class="meta-label">Link</span><span class="meta-value">${linkHTML}</span></div>
        <div class="meta-field" style="flex:1"><span class="meta-label">Reward ID</span><span class="meta-value">${rewardHTML}</span></div>
      </div>
      ${notesHTML}
    </div>
    <div class="card-actions">${actions}</div>
  </div>`;
}

// ─── Render ───────────────────────────────────────────────────
function applyViewMode(){
  activeGrid.classList.toggle('list-view', viewMode==='list');
  hiddenGrid.classList.toggle('list-view', viewMode==='list');
  viewGridBtn.classList.toggle('active', viewMode==='grid');
  viewListBtn.classList.toggle('active', viewMode==='list');
  localStorage.setItem('cv_view', viewMode);
}

function render(){
  const active=cards.filter(c=>!c.hidden), hidden=cards.filter(c=>c.hidden);
  statTotal.textContent=cards.length; statActive.textContent=active.length; statHidden.textContent=hidden.length;
  if(active.length===0){ activeGrid.innerHTML=''; activeGrid.appendChild(emptyActive); emptyActive.classList.remove('hidden'); }
  else { emptyActive.classList.add('hidden'); activeGrid.innerHTML=active.map(buildCardHTML).join(''); }
  if(hidden.length===0){ hiddenGrid.innerHTML=''; hiddenGrid.appendChild(emptyHidden); emptyHidden.classList.remove('hidden'); }
  else { emptyHidden.classList.add('hidden'); hiddenGrid.innerHTML=hidden.map(buildCardHTML).join(''); }
  hiddenToggleLabel.textContent=showingHidden?'Ocultar cartões usados':`Ver cartões ocultos${hidden.length?` (${hidden.length})`:''}`;
  sectionHidden.classList.toggle('hidden',!showingHidden);
  applyViewMode(); renderTotals();
}

// ─── Events ──────────────────────────────────────────────────
viewGridBtn.addEventListener('click',()=>{viewMode='grid';applyViewMode();});
viewListBtn.addEventListener('click',()=>{viewMode='list';applyViewMode();});
btnToggleHidden.addEventListener('click',()=>{
  showingHidden=!showingHidden; render();
  if(showingHidden) sectionHidden.scrollIntoView({behavior:'smooth',block:'start'});
});
btnAddCard.addEventListener('click',()=>openModal());
modalCloseBtn.addEventListener('click',closeModal);
btnCancel.addEventListener('click',closeModal);
modalOverlay.addEventListener('click',e=>{if(e.target===modalOverlay)closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modalOverlay.classList.contains('open'))closeModal();});

// ─── Expose ───────────────────────────────────────────────────
window.openModal=openModal; window.hideCard=hideCard;
window.restoreCard=restoreCard; window.deleteCard=deleteCard; window.copyNumber=copyNumber;

// ─── Init ─────────────────────────────────────────────────────
(async()=>{
  if(!window.showOpenFilePicker){
    onboardError.textContent='⚠️ Seu navegador não suporta File System Access API. Use Chrome ou Edge.';
    onboardError.classList.remove('hidden');
    btnOpenFile.disabled=true; btnNewFile.disabled=true;
    return;
  }
  const restored = await tryRestoreHandle();
  if(restored){ render(); }
  // else: onboarding remains visible
  fetchRate();
  setInterval(fetchRate, 5*60*1000);
})();
