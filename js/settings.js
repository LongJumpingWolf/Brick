'use strict';
/* =====================================================================
   settings.js — Settings screen UI: Recycle Bin, Export picker,
   Import, ImgBB key. The actual bundle build/parse logic lives in
   import-export.js; this file is just the screen's DOM wiring.
   ===================================================================== */

function openSettings(){
  renderTrashList();
  renderImgbbSection();
  showScreen('screenSettings');
}

/* ---------- Recycle Bin ---------- */
function timeAgo(ts){
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s/60); if (m < 60) return m + ' min ago';
  const h = Math.floor(m/60); if (h < 24) return h + ' hr ago';
  const d = Math.floor(h/24); return d + ' day' + (d===1?'':'s') + ' ago';
}
function renderTrashList(){
  const list = document.getElementById('trashList');
  document.getElementById('emptyTrashBtn').disabled = trash.length === 0;
  if (!trash.length){
    list.innerHTML = '<p class="io-hint" style="margin:0;">Recycle bin is empty.</p>';
    return;
  }
  list.innerHTML = trash.slice().sort((a,b)=>b.deletedAt-a.deletedAt).map(entry=>{
    const icon = entry.node.type === 'folder' ? '🧱' : '🧱';
    const kindLabel = entry.node.type === 'folder' ? 'Wall' : 'Brick';
    return '<div class="trash-row" data-trash-id="' + entry.trashId + '">' +
      '<div class="trash-info"><div class="trash-name">' + escapeHtml(entry.node.name) + '</div>' +
      '<div class="trash-meta">' + kindLabel + ' · deleted ' + timeAgo(entry.deletedAt) + '</div></div>' +
      '<div class="trash-actions">' +
      '<button type="button" class="mini-btn" data-action="restore" data-trash-id="' + entry.trashId + '">Restore</button>' +
      '<button type="button" class="mini-btn danger" data-action="purge" data-trash-id="' + entry.trashId + '">Delete forever</button>' +
      '</div></div>';
  }).join('');
  list.querySelectorAll('[data-action="restore"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      restoreFromTrash(btn.dataset.trashId);
      renderTrashList();
    });
  });
  list.querySelectorAll('[data-action="purge"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const entry = trash.find(t => t.trashId === btn.dataset.trashId);
      if (entry && confirm('Permanently delete "' + entry.node.name + '"? This cannot be undone.')){
        permanentlyDeleteFromTrash(btn.dataset.trashId);
        renderTrashList();
      }
    });
  });
}

/* ---------- Export picker ---------- */
let exportCheckedIds = new Set();
function allDeckIds(node, out){
  out = out || [];
  if (node.type === 'deck') out.push(node.id);
  else node.children.forEach(c => allDeckIds(c, out));
  return out;
}
function buildPickerRowsHtml(node, depth){
  if (node.type === 'deck'){
    return '<label class="export-row" style="padding-left:' + (depth*18) + 'px">' +
      '<input type="checkbox" class="export-check deck-check" data-id="' + node.id + '" checked>' +
      ' 🧱 ' + escapeHtml(node.name) + ' <span class="export-meta">(' + node.cards.length + ' card' + (node.cards.length===1?'':'s') + ')</span></label>';
  }
  const childrenHtml = node.children.map(c => buildPickerRowsHtml(c, depth+1)).join('');
  return '<label class="export-row export-folder-row" style="padding-left:' + (depth*18) + 'px">' +
    '<input type="checkbox" class="export-check folder-check" data-folder-id="' + node.id + '" checked>' +
    ' 🗂 ' + escapeHtml(node.name) + '</label>' + childrenHtml;
}
function openExportPicker(){
  exportCheckedIds = new Set(allDeckIds(tree));
  const wrap = document.getElementById('exportPickerTree');
  wrap.innerHTML = tree.children.map(c => buildPickerRowsHtml(c, 0)).join('') || '<p class="io-hint" style="margin:0;">Nothing to export yet.</p>';
  wireExportCheckboxes();
  openOverlay('exportOverlay', document.getElementById('confirmExportBtn'));
}
function wireExportCheckboxes(){
  const wrap = document.getElementById('exportPickerTree');
  wrap.querySelectorAll('.deck-check').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      if (cb.checked) exportCheckedIds.add(cb.dataset.id);
      else exportCheckedIds.delete(cb.dataset.id);
      syncFolderCheckboxStates();
    });
  });
  wrap.querySelectorAll('.folder-check').forEach(cb=>{
    cb.addEventListener('click', ()=>{
      const folderNode = nodeById(cb.dataset.folderId);
      const descendantDeckIds = allDeckIds(folderNode);
      descendantDeckIds.forEach(id => { if (cb.checked) exportCheckedIds.add(id); else exportCheckedIds.delete(id); });
      // reflect the cascade in the actual deck checkboxes too, not just the data
      descendantDeckIds.forEach(id=>{
        const deckCb = wrap.querySelector('.deck-check[data-id="' + id + '"]');
        if (deckCb) deckCb.checked = cb.checked;
      });
      syncFolderCheckboxStates();
    });
  });
}
/* A folder's own checkbox reflects the state of its descendants: fully
   checked only if EVERY descendant deck is checked, unchecked if NONE
   are, indeterminate (that middle dash state) otherwise — so partial
   selections inside a folder are visible at a glance without having to
   expand and inspect every row. */
function syncFolderCheckboxStates(){
  const wrap = document.getElementById('exportPickerTree');
  wrap.querySelectorAll('.folder-check').forEach(cb=>{
    const folderNode = nodeById(cb.dataset.folderId);
    const ids = allDeckIds(folderNode);
    const checkedCount = ids.filter(id => exportCheckedIds.has(id)).length;
    cb.checked = ids.length > 0 && checkedCount === ids.length;
    cb.indeterminate = checkedCount > 0 && checkedCount < ids.length;
  });
}
function selectAllExport(){
  document.querySelectorAll('#exportPickerTree .export-check').forEach(cb => cb.checked = true);
  exportCheckedIds = new Set(allDeckIds(tree));
  syncFolderCheckboxStates();
}
function selectNoneExport(){
  document.querySelectorAll('#exportPickerTree .export-check').forEach(cb => { cb.checked = false; cb.indeterminate = false; });
  exportCheckedIds = new Set();
}

/* ---------- Import ---------- */
async function handleImportFile(file){
  try {
    const text = await file.text();
    const bundle = JSON.parse(text);
    const counts = await importBundle(bundle);
    renderTree();
    announce('Imported ' + counts.bricks + ' brick' + (counts.bricks===1?'':'s') + ', ' + counts.cards + ' card' + (counts.cards===1?'':'s') + '.');
  } catch (err){
    console.error(err);
    announce('Could not import that file — ' + (err.message || 'it may not be a valid Brick export.'));
  }
}

/* ---------- ImgBB key ---------- */
function renderImgbbSection(){
  const key = loadImgbbKey();
  document.getElementById('imgbbKeyInput').value = key;
  const map = loadImageUrlMap();
  const backedUpCount = Object.keys(map).length;
  const pendingCount = getPendingBackupImageHashes().length;
  const retryBtn = document.getElementById('retryImgbbBackupBtn');
  if (key){
    document.getElementById('imgbbStatus').textContent = pendingCount
      ? (backedUpCount + ' image' + (backedUpCount===1?'':'s') + ' backed up so far — ' + pendingCount + ' still pending')
      : (backedUpCount + ' image' + (backedUpCount===1?'':'s') + ' backed up to ImgBB');
    retryBtn.style.display = pendingCount ? '' : 'none';
  } else {
    document.getElementById('imgbbStatus').textContent = pendingCount
      ? ('No key set — ' + pendingCount + ' image' + (pendingCount===1?'':'s') + ' stored locally only. Adding a key backs them up automatically.')
      : 'No key set — occlusion images stay local-only';
    retryBtn.style.display = 'none';
  }
}

function initSettingsScreen(){
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('settingsBackBtn').addEventListener('click', ()=>{ showScreen('screenWall'); renderTree(); });

  document.getElementById('emptyTrashBtn').addEventListener('click', ()=>{
    if (!trash.length) return;
    if (confirm('Permanently delete all ' + trash.length + ' item' + (trash.length===1?'':'s') + ' in the recycle bin? This cannot be undone.')){
      emptyTrash();
      renderTrashList();
    }
  });

  document.getElementById('openExportBtn').addEventListener('click', openExportPicker);
  document.getElementById('cancelExportBtn').addEventListener('click', ()=> closeOverlay('exportOverlay'));
  document.getElementById('selectAllExportBtn').addEventListener('click', selectAllExport);
  document.getElementById('selectNoneExportBtn').addEventListener('click', selectNoneExport);
  document.getElementById('confirmExportBtn').addEventListener('click', async ()=>{
    await exportSelected(Array.from(exportCheckedIds));
    closeOverlay('exportOverlay');
  });

  document.getElementById('importFileInput').addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0];
    if (file) handleImportFile(file);
    e.target.value = '';
  });
  document.getElementById('importBtn').addEventListener('click', ()=> document.getElementById('importFileInput').click());

  document.getElementById('saveImgbbKeyBtn').addEventListener('click', ()=>{
    const val = document.getElementById('imgbbKeyInput').value.trim();
    const hadKeyBefore = !!loadImgbbKey();
    saveImgbbKey(val);
    announce(val ? 'ImgBB key saved' : 'ImgBB key cleared');
    renderImgbbSection();
    updateSettingsBadge();
    // "Once a key is added" means exactly that — the transition from no
    // key to a real one. Re-saving an already-set key on every click
    // would force this modal open repeatedly for anything that failed
    // last time, which is naggy rather than helpful; retryPendingImgbbBackup()
    // below gives an explicit, user-initiated way to retry those instead.
    if (val && !hadKeyBefore) runMandatoryImgbbBackup();
  });
  document.getElementById('retryImgbbBackupBtn').addEventListener('click', runMandatoryImgbbBackup);
}
