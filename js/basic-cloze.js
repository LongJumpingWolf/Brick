'use strict';
/* =====================================================================
   basic-cloze.js — the other two card types, AND the shared staging
   pile all three tabs feed into.

   Nothing finalizes a brick on its own anymore: Occlusion's "Add these
   shapes", and Basic/Cloze's "Add card to brick", all push into the
   one `stagedCards` array below. You can freely switch tabs — add a
   cloze card, flip to Occlusion and mask an image, flip to Basic and
   add a front/back — and NONE of it commits until you explicitly hit
   the single shared "Create brick" button. That button used to be
   type-specific and finalized immediately on the first card, which
   made it impossible to mix card types into one brick.
   ===================================================================== */

let editorCardType = 'occlusion';
let stagedCards = [];          // fully-formed card objects, any type, in the order added
let basicStagedCards = [];     // raw {front,back} — kept separately so the Basic tab can preview/delete by content
let clozeStagedCards = [];     // raw {text} — same reasoning for Cloze
let lastFocusedEditorField = 'basicFrontInput';

function resetBasicClozeState(){
  editorCardType = 'occlusion';
  stagedCards = [];
  basicStagedCards = [];
  clozeStagedCards = [];
  document.getElementById('basicFrontInput').value = '';
  document.getElementById('basicBackInput').value = '';
  document.getElementById('clozeInput').value = '';
  updateClozePreview();
  renderBasicStagedList();
  renderClozeStagedList();
  updateStagedCounter();
  setEditorCardType('occlusion');
}

function setEditorCardType(type){
  editorCardType = type;
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  document.getElementById('occlusionPane').style.display = type === 'occlusion' ? '' : 'none';
  document.getElementById('basicPane').style.display = type === 'basic' ? '' : 'none';
  document.getElementById('clozePane').style.display = type === 'cloze' ? '' : 'none';
}

function updateStagedCounter(){
  const total = stagedCards.length + basicStagedCards.length + clozeStagedCards.length;
  const el = document.getElementById('stagedCounter');
  el.textContent = total === 0 ? 'no cards staged yet' : total + ' card' + (total===1?'':'s') + ' staged for this brick';
  el.classList.toggle('has-cards', total > 0);
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
      updateStagedCounter();
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
  updateStagedCounter();
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
      updateStagedCounter();
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
  updateStagedCounter();
}

/* ---------- shared finalize: combines everything staged across ALL
   three tabs into one deck, in one shot ---------- */
function createBrickFromAllStaged(){
  const combined = [
    ...stagedCards,
    ...basicStagedCards.map(c => ({ id: uid(), type:'basic', front:c.front, back:c.back, timeouts:0, tough:false, createdAt: Date.now() })),
    ...clozeStagedCards.map(c => ({ id: uid(), type:'cloze', text:c.text, timeouts:0, tough:false, createdAt: Date.now() })),
  ];
  if (!combined.length){ announce('Add at least one card first — on any tab.'); return; }
  const name = document.getElementById('scrollNameInput').value.trim();
  if (!name){ announce('Give this brick a name.'); document.getElementById('scrollNameInput').focus(); return; }

  const folder = nodeById(editorTargetFolderId) || nodeById('root');
  const deck = { id: uid(), type:'deck', name, createdAt: Date.now(), cards: combined };
  folder.children.push(deck);
  saveTreeNow();
  currentFolderId = folder.id;
  announce('Brick forged — ' + combined.length + ' card' + (combined.length===1?'':'s') + '.');
  showScreen('screenWall');
  renderTree();
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
    btn.addEventListener('click', ()=>{
      if (btn.dataset.open !== undefined) wrapSelectionPair('clozeInput', btn.dataset.open, btn.dataset.close);
      else wrapSelection('clozeInput', btn.dataset.w);
      // wrapSelection/wrapSelectionPair set .value directly, which does
      // NOT fire a native 'input' event — without this, the live
      // preview goes stale after using any of these buttons.
      updateClozePreview();
    });
  });
  document.getElementById('generateCardsBtn').addEventListener('click', createBrickFromAllStaged);
}
