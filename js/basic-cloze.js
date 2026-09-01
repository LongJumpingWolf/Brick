'use strict';
/* =====================================================================
   basic-cloze.js — the other two card types. Occlusion generates all
   its cards in one shot from drawn shapes; Basic/Cloze instead let you
   stage several cards (Add card to brick, repeatedly) before naming
   the brick and creating it, which is the more natural authoring flow
   for plain text cards. Both feed into the same tree.js deck creation
   as occlusion does — see finishBrickCreation().
   ===================================================================== */

let editorCardType = 'occlusion';
let basicStagedCards = [];
let clozeStagedCards = [];
let lastFocusedEditorField = 'basicFrontInput';

function resetBasicClozeState(){
  editorCardType = 'occlusion';
  basicStagedCards = [];
  clozeStagedCards = [];
  document.getElementById('basicFrontInput').value = '';
  document.getElementById('basicBackInput').value = '';
  document.getElementById('clozeInput').value = '';
  updateClozePreview();
  renderBasicStagedList();
  renderClozeStagedList();
  setEditorCardType('occlusion');
}

function setEditorCardType(type){
  editorCardType = type;
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  document.getElementById('occlusionPane').style.display = type === 'occlusion' ? '' : 'none';
  document.getElementById('basicPane').style.display = type === 'basic' ? '' : 'none';
  document.getElementById('clozePane').style.display = type === 'cloze' ? '' : 'none';
}

/* ---------- Basic ---------- */
function renderBasicStagedList(){
  const list = document.getElementById('basicStagedList');
  if (!basicStagedCards.length){ list.innerHTML = '<p class="io-hint" style="margin:0;">no cards added yet</p>'; return; }
  list.innerHTML = basicStagedCards.map((c,i) =>
    '<div class="staged-row">' +
    '<span class="staged-num">' + (i+1) + '</span>' +
    '<div class="staged-preview"><div class="staged-front">' + formatInline(c.front) + '</div><div class="staged-back">' + formatInline(c.back) + '</div></div>' +
    '<button type="button" class="del-staged" data-idx="' + i + '" title="Delete">✕</button>' +
    '</div>'
  ).join('');
  list.querySelectorAll('.del-staged').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      basicStagedCards.splice(parseInt(btn.dataset.idx, 10), 1);
      renderBasicStagedList();
    });
  });
}
function addBasicCard(){
  const front = document.getElementById('basicFrontInput').value.trim();
  const back = document.getElementById('basicBackInput').value.trim();
  if (!front || !back){ announce('Front and back are both required.'); return; }
  basicStagedCards.push({ front, back });
  document.getElementById('basicFrontInput').value = '';
  document.getElementById('basicBackInput').value = '';
  document.getElementById('basicFrontInput').focus();
  renderBasicStagedList();
}
function generateBasicCards(){
  if (!basicStagedCards.length){ announce('Add at least one card first.'); return; }
  const name = document.getElementById('scrollNameInput').value.trim();
  if (!name){ announce('Give this brick a name.'); document.getElementById('scrollNameInput').focus(); return; }
  const cards = basicStagedCards.map(c => ({ id: uid(), type:'basic', front:c.front, back:c.back, timeouts:0, tough:false, createdAt: Date.now() }));
  finishBrickCreation(name, cards);
}

/* ---------- Cloze ---------- */
function updateClozePreview(){
  const text = document.getElementById('clozeInput').value;
  const { front, back } = clozeFrontBack(text);
  document.getElementById('clozePreviewFront').innerHTML = front;
  document.getElementById('clozePreviewBack').innerHTML = back;
}
function renderClozeStagedList(){
  const list = document.getElementById('clozeStagedList');
  if (!clozeStagedCards.length){ list.innerHTML = '<p class="io-hint" style="margin:0;">no cards added yet</p>'; return; }
  list.innerHTML = clozeStagedCards.map((c,i)=>{
    const fb = clozeFrontBack(c.text);
    return '<div class="staged-row">' +
      '<span class="staged-num">' + (i+1) + '</span>' +
      '<div class="staged-preview"><div class="staged-front">' + fb.front + '</div></div>' +
      '<button type="button" class="del-staged" data-idx="' + i + '" title="Delete">✕</button>' +
      '</div>';
  }).join('');
  list.querySelectorAll('.del-staged').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      clozeStagedCards.splice(parseInt(btn.dataset.idx, 10), 1);
      renderClozeStagedList();
    });
  });
}
function addClozeCard(){
  const text = document.getElementById('clozeInput').value.trim();
  if (!clozeIsValid(text)){ announce('Wrap the hidden part in [[double brackets]].'); return; }
  clozeStagedCards.push({ text });
  document.getElementById('clozeInput').value = '';
  updateClozePreview();
  document.getElementById('clozeInput').focus();
  renderClozeStagedList();
}
function generateClozeCards(){
  if (!clozeStagedCards.length){ announce('Add at least one card first.'); return; }
  const name = document.getElementById('scrollNameInput').value.trim();
  if (!name){ announce('Give this brick a name.'); document.getElementById('scrollNameInput').focus(); return; }
  const cards = clozeStagedCards.map(c => ({ id: uid(), type:'cloze', text:c.text, timeouts:0, tough:false, createdAt: Date.now() }));
  finishBrickCreation(name, cards);
}

/* ---------- shared finalize step (occlusion's generateOcclusionCards
   duplicates this last part rather than calling it, since it also
   needs the header/backExtra fields which don't apply here) ---------- */
function finishBrickCreation(name, cards){
  const folder = nodeById(editorTargetFolderId) || nodeById('root');
  const deck = { id: uid(), type:'deck', name, createdAt: Date.now(), cards };
  folder.children.push(deck);
  saveTreeNow();
  currentFolderId = folder.id;
  announce('Brick forged — ' + cards.length + ' card' + (cards.length===1?'':'s') + '.');
  showScreen('screenWall');
  renderTree();
}

function generateCardsForActiveTab(){
  if (editorCardType === 'occlusion') generateOcclusionCards();
  else if (editorCardType === 'basic') generateBasicCards();
  else generateClozeCards();
}

function initBasicClozeEditor(){
  document.querySelectorAll('.mode-tab').forEach(btn=>{
    btn.addEventListener('click', ()=> setEditorCardType(btn.dataset.type));
  });
  document.getElementById('addBasicCardBtn').addEventListener('click', addBasicCard);
  document.getElementById('addClozeCardBtn').addEventListener('click', addClozeCard);
  document.getElementById('clozeInput').addEventListener('input', updateClozePreview);
  document.getElementById('basicFrontInput').addEventListener('focus', ()=>{ lastFocusedEditorField='basicFrontInput'; document.getElementById('basicFmtHint').textContent='applies to: Front'; });
  document.getElementById('basicBackInput').addEventListener('focus', ()=>{ lastFocusedEditorField='basicBackInput'; document.getElementById('basicFmtHint').textContent='applies to: Back'; });
  document.querySelectorAll('#basicPane .fmt-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> wrapSelection(lastFocusedEditorField, btn.dataset.w));
  });
  document.querySelectorAll('#clozePane .fmt-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> wrapSelection('clozeInput', btn.dataset.w));
  });
  // The one "Create brick" button is shared across all three tabs —
  // bound here (not in occlusion-editor.js) since this is the module
  // that knows which tab is actually active.
  document.getElementById('generateCardsBtn').addEventListener('click', generateCardsForActiveTab);
}
