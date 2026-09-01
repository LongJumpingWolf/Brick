'use strict';
/* =====================================================================
   tree.js — the Wall/Brick file manager: navigation, CRUD, kebab menu,
   drag-drop, search, keyboard nav. Everything specific to the tree
   SCREEN lives here. Shared helpers (announce/openOverlay/showScreen)
   come from app.js, loaded before this file calls them.
   ===================================================================== */

let tree = loadTree();
let currentFolderId = 'root';

function saveTreeNow(){ saveTree(tree); }

/* ---------- tree walking ---------- */
function nodeById(id, node){
  node = node || tree;
  if (node.id === id) return node;
  if (node.type === 'folder'){
    for (const c of node.children){
      const found = nodeById(id, c);
      if (found) return found;
    }
  }
  return null;
}
function parentOf(id, node){
  node = node || tree;
  if (node.type !== 'folder') return null;
  for (const c of node.children){
    if (c.id === id) return node;
    if (c.type === 'folder'){
      const found = parentOf(id, c);
      if (found) return found;
    }
  }
  return null;
}
function pathToNode(id){
  const path = [];
  let cur = nodeById(id);
  if (!cur) return path;
  path.push(cur);
  let p = parentOf(id);
  while (p){ path.unshift(p); p = parentOf(p.id); }
  return path;
}
function allFolders(node, out){
  node = node || tree; out = out || [];
  if (node.type === 'folder'){ out.push(node); node.children.forEach(c => allFolders(c, out)); }
  return out;
}

/* ---------- rendering ---------- */
const dojoIcon = '<svg class="tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="8" height="6" rx="1"/><rect x="13" y="4" width="8" height="6" rx="1"/><rect x="8" y="12" width="8" height="6" rx="1"/><rect x="3" y="12" width="3" height="6" rx="1"/><rect x="18" y="12" width="3" height="6" rx="1"/></svg>';
const brickIcon = '<svg class="tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="8" width="18" height="8" rx="1.5"/></svg>';

function renderCrumbs(){
  const path = pathToNode(currentFolderId);
  const el = document.getElementById('crumbs');
  el.innerHTML = path.map((n, i)=>{
    const isLast = i === path.length-1;
    return (i>0 ? '<span class="crumb-sep">›</span>' : '') +
      '<button type="button" class="crumb' + (isLast?' current':'') + '" data-id="' + n.id + '">' + escapeHtml(n.name) + '</button>';
  }).join('');
  el.querySelectorAll('.crumb').forEach(c=>{
    c.addEventListener('click', ()=>{ currentFolderId = c.dataset.id; renderTree(); });
  });
}
function countBricks(node){
  let n = 0;
  node.children.forEach(c => { if (c.type==='deck') n++; else n += countBricks(c); });
  return n;
}
function renderTree(){
  renderCrumbs();
  const folder = nodeById(currentFolderId);
  const grid = document.getElementById('tileGrid');
  if (!folder || !folder.children.length){
    grid.innerHTML = '<div class="empty-state">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg>' +
      '<p>Empty wall. Start a new brick, or add a sub-wall to organize.</p></div>';
    return;
  }
  const srsMap = computeSRS(reviewLog);
  grid.innerHTML = folder.children.map(n=>{
    if (n.type === 'folder'){
      const bricks = countBricks(n);
      return '<button type="button" class="tile wall" data-id="' + n.id + '" tabindex="-1" aria-label="' + escapeHtml(n.name) + ', ' + bricks + ' bricks, folder">' +
        dojoIcon +
        '<div class="tile-name">' + escapeHtml(n.name) + '</div>' +
        '<div class="tile-meta"><span>' + bricks + ' brick' + (bricks===1?'':'s') + '</span></div>' +
        '<button type="button" class="tile-kebab" tabindex="-1" aria-label="More options for ' + escapeHtml(n.name) + '">⋮</button>' +
        '</button>';
    }
    const total = n.cards.length;
    const due = n.cards.filter(c => isCardDue(c.id, srsMap)).length;
    const newCount = n.cards.filter(c => !cardHasHistory(c.id, srsMap)).length;
    const cemented = n.cards.filter(c => c.cemented).length;
    if (cementMode){
      const emptyCls = cemented === 0 ? ' cement-empty' : '';
      return '<button type="button" class="tile brick-tile' + emptyCls + '" draggable="true" data-id="' + n.id + '" tabindex="-1" aria-label="' + escapeHtml(n.name) + ', ' + cemented + ' cemented of ' + total + ' total, brick, draggable">' +
        brickIcon +
        '<div class="tile-name">' + escapeHtml(n.name) + '</div>' +
        '<div class="tile-meta"><span class="cemented-count">' + cemented + ' cemented</span><span>' + total + ' total</span></div>' +
        '<button type="button" class="tile-kebab" tabindex="-1" aria-label="More options for ' + escapeHtml(n.name) + '">⋮</button>' +
        '</button>';
    }
    return '<button type="button" class="tile brick-tile" draggable="true" data-id="' + n.id + '" tabindex="-1" aria-label="' + escapeHtml(n.name) + ', ' + newCount + ' new, ' + due + ' due of ' + total + ' total, brick, draggable">' +
      brickIcon +
      '<div class="tile-name">' + escapeHtml(n.name) + '</div>' +
      '<div class="tile-meta"><span class="new-count">' + newCount + ' new</span><span class="due">' + due + ' due</span><span>' + total + ' total</span></div>' +
      '<button type="button" class="tile-kebab" tabindex="-1" aria-label="More options for ' + escapeHtml(n.name) + '">⋮</button>' +
      '</button>';
  }).join('');

  const grid2 = document.getElementById('tileGrid');
  grid2.querySelectorAll('.tile').forEach(wireTile);
  const visible = tiles();
  if (visible.length) visible[0].tabIndex = 0;
  applySearchFilter();
}

/* ---------- roving-tabindex grid navigation ---------- */
function tiles(){
  const grid = document.getElementById('tileGrid');
  return Array.from(grid.querySelectorAll('.tile')).filter(t => t.style.display !== 'none');
}
function setActiveTile(tile){
  tiles().forEach(t => t.tabIndex = -1);
  tile.tabIndex = 0;
  tile.focus();
}
function tileRows(){
  const list = tiles();
  const rows = [];
  list.forEach(t=>{
    const top = t.offsetTop;
    let row = rows.find(r => Math.abs(r.top - top) < 4);
    if (!row){ row = { top, items: [] }; rows.push(row); }
    row.items.push(t);
  });
  rows.sort((a,b)=>a.top-b.top);
  rows.forEach(r => r.items.sort((a,b)=>a.offsetLeft-b.offsetLeft));
  return rows;
}
function nodeNameFor(tile){ const n = nodeById(tile.dataset.id); return n ? n.name : ''; }

function gridKeydownHandler(e){
  const current = document.activeElement;
  if (!current.classList || !current.classList.contains('tile')) return;
  const rows = tileRows();
  const ri = rows.findIndex(r => r.items.includes(current));
  const ci = ri >= 0 ? rows[ri].items.indexOf(current) : -1;
  if (ri < 0) return;

  if (e.key === 'ArrowRight'){ e.preventDefault(); const next = rows[ri].items[ci+1]; if (next) setActiveTile(next); }
  else if (e.key === 'ArrowLeft'){ e.preventDefault(); const prev = rows[ri].items[ci-1]; if (prev) setActiveTile(prev); }
  else if (e.key === 'ArrowDown'){ e.preventDefault(); const row = rows[ri+1]; if (row) setActiveTile(row.items[Math.min(ci, row.items.length-1)]); }
  else if (e.key === 'ArrowUp'){ e.preventDefault(); const row = rows[ri-1]; if (row) setActiveTile(row.items[Math.min(ci, row.items.length-1)]); }
  else if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openTile(current); }
  else if (e.key === 'M' && e.shiftKey){ e.preventDefault(); openTileMenu(current.querySelector('.tile-kebab'), current); }
  else if (e.key === 'm'){ e.preventDefault(); openMovePicker(current); }
  else if (e.key === 'r' || e.key === 'R'){ e.preventDefault(); openRename(current); }
  else if (e.key === 'Delete' || e.key === 'Backspace'){
    e.preventDefault();
    if (confirm('Delete "' + nodeNameFor(current) + '"?')) removeTile(current);
  }
}

/* ---------- open (navigate into folder / go study a brick) ---------- */
function openTile(tile){
  const node = nodeById(tile.dataset.id);
  if (!node) return;
  if (node.type === 'folder'){ currentFolderId = node.id; renderTree(); announce('Opened ' + node.name); }
  else { openBrickPreview(node.id); }
}

/* ---------- delete / move / rename / duplicate ---------- */
function removeTile(tile){
  const id = tile.dataset.id;
  const node = nodeById(id);
  if (!node) return;
  const parent = parentOf(id);
  if (!parent) return;
  const name = node.name;
  const list = tiles();
  const idx = list.indexOf(tile);
  parent.children = parent.children.filter(c => c.id !== id);
  saveTreeNow();
  renderTree();
  announce('Deleted ' + name);
  const remaining = tiles();
  if (remaining.length) setActiveTile(remaining[Math.min(idx, remaining.length-1)]);
}

let moveTargetId = null;
function openMovePicker(tile){
  moveTargetId = tile.dataset.id;
  const node = nodeById(moveTargetId);
  document.getElementById('moveTargetName').textContent = node.name;
  const list = document.getElementById('moveOptionList');
  const folders = allFolders().filter(f => f.id !== moveTargetId && f.id !== parentOf(moveTargetId).id);
  if (!folders.length){
    list.innerHTML = '<p class="io-hint" style="margin:0;">No other walls to move into yet.</p>';
  } else {
    list.innerHTML = folders.map(f => '<button type="button" class="move-option" data-wall-id="' + f.id + '">🧱 ' + escapeHtml(f.name) + '</button>').join('');
    list.querySelectorAll('.move-option').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const targetFolder = nodeById(btn.dataset.wallId);
        const node2 = nodeById(moveTargetId);
        const parent = parentOf(moveTargetId);
        if (targetFolder && node2 && parent){
          parent.children = parent.children.filter(c => c.id !== moveTargetId);
          targetFolder.children.push(node2);
          saveTreeNow();
          renderTree();
          announce('Moved ' + node2.name + ' into ' + targetFolder.name);
        }
        closeOverlay('moveOverlay');
      });
    });
  }
  openOverlay('moveOverlay', list.querySelector('.move-option') || document.getElementById('cancelMoveBtn'));
}

let renameTargetId = null;
function openRename(tile){
  renameTargetId = tile.dataset.id;
  const node = nodeById(renameTargetId);
  const input = document.getElementById('renameInput');
  input.value = node.name;
  openOverlay('renameOverlay', input);
  input.select();
}
function confirmRename(){
  const val = document.getElementById('renameInput').value.trim();
  const node = nodeById(renameTargetId);
  if (!val || !node){ closeOverlay('renameOverlay'); return; }
  const oldName = node.name;
  node.name = val;
  saveTreeNow();
  renderTree();
  announce('Renamed "' + oldName + '" to "' + val + '"');
  closeOverlay('renameOverlay');
}

function deepCloneWithNewIds(node){
  if (node.type === 'deck'){
    return { ...node, id: uid(), cards: node.cards.map(c => ({ ...c, id: uid() })) };
  }
  return { ...node, id: uid(), children: node.children.map(deepCloneWithNewIds) };
}
function duplicateTile(tile){
  const node = nodeById(tile.dataset.id);
  const parent = parentOf(tile.dataset.id);
  if (!node || !parent) return;
  const clone = deepCloneWithNewIds(node);
  clone.name = node.name + ' (copy)';
  const idx = parent.children.indexOf(node);
  parent.children.splice(idx+1, 0, clone);
  saveTreeNow();
  renderTree();
  announce('Duplicated "' + node.name + '" as "' + clone.name + '"');
  const newTile = document.querySelector('[data-id="' + clone.id + '"]');
  if (newTile) setActiveTile(newTile);
}

/* ---------- kebab dropdown menu ---------- */
const tileMenuEl = () => document.getElementById('tileMenu');
let menuTargetTile = null, menuAnchorEl = null;
function openTileMenu(anchorBtn, tile){
  menuTargetTile = tile;
  menuAnchorEl = anchorBtn;
  const r = anchorBtn.getBoundingClientRect();
  const menu = tileMenuEl();
  menu.style.top = (r.bottom + 4) + 'px';
  menu.style.left = Math.max(8, r.right - 168) + 'px';
  menu.classList.add('active');
  menu.querySelector('button').focus();
}
function closeTileMenu(){
  tileMenuEl().classList.remove('active');
  if (menuAnchorEl) menuAnchorEl.focus();
}
function isTileMenuOpen(){ return tileMenuEl().classList.contains('active'); }

/* ---------- per-tile wiring (used for initial render AND duplicates) ---------- */
function wireTile(tile){
  tile.addEventListener('click', (e)=>{
    if (e.target.closest('.tile-kebab')) return;
    setActiveTile(tile);
    openTile(tile);
  });
  const kebab = tile.querySelector('.tile-kebab');
  if (kebab) kebab.addEventListener('click', (e)=>{ e.stopPropagation(); openTileMenu(kebab, tile); });

  if (tile.classList.contains('brick-tile')){
    tile.addEventListener('dragstart', (e)=>{
      tile.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tile.dataset.id);
    });
    tile.addEventListener('dragend', ()=> tile.classList.remove('dragging'));
  }
  if (tile.classList.contains('wall')){
    tile.addEventListener('dragover', (e)=>{ e.preventDefault(); tile.classList.add('drop-target'); });
    tile.addEventListener('dragleave', ()=> tile.classList.remove('drop-target'));
    tile.addEventListener('drop', (e)=>{
      e.preventDefault();
      tile.classList.remove('drop-target');
      const draggedId = e.dataTransfer.getData('text/plain');
      const draggedNode = nodeById(draggedId);
      const draggedParent = parentOf(draggedId);
      const targetFolder = nodeById(tile.dataset.id);
      if (draggedNode && draggedParent && targetFolder && draggedParent.id !== targetFolder.id){
        draggedParent.children = draggedParent.children.filter(c => c.id !== draggedId);
        targetFolder.children.push(draggedNode);
        saveTreeNow();
        renderTree();
        announce('Moved ' + draggedNode.name + ' into ' + targetFolder.name);
      }
    });
  }
}

/* ---------- search filter ---------- */
function applySearchFilter(){
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  document.querySelectorAll('#tileGrid .tile').forEach(t=>{
    const name = nodeNameFor(t).toLowerCase();
    t.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

/* ---------- init: attach everything that only needs to happen once ---------- */
function initTreeScreen(){
  document.getElementById('homeBtn').addEventListener('click', ()=>{ currentFolderId = 'root'; showScreen('screenWall'); renderTree(); });

  document.getElementById('newWallBtn').addEventListener('click', ()=>{
    openNameModal('New Wall', '', (name)=>{
      const folder = nodeById(currentFolderId);
      folder.children.push({ id:uid(), type:'folder', name, children:[] });
      saveTreeNow();
      renderTree();
      announce('Created wall "' + name + '"');
    });
  });
  document.getElementById('newBrickBtn').addEventListener('click', ()=> openOcclusionEditor(currentFolderId));

  document.getElementById('confirmRenameBtn').addEventListener('click', confirmRename);
  document.getElementById('cancelRenameBtn').addEventListener('click', ()=> closeOverlay('renameOverlay'));
  document.getElementById('renameInput').addEventListener('keydown', (e)=>{ if (e.key === 'Enter'){ e.preventDefault(); confirmRename(); } });
  document.getElementById('cancelMoveBtn').addEventListener('click', ()=> closeOverlay('moveOverlay'));

  const grid = document.getElementById('tileGrid');
  grid.addEventListener('keydown', gridKeydownHandler);

  document.getElementById('menuOpen').addEventListener('click', ()=>{ const t=menuTargetTile; closeTileMenu(); if (t){ setActiveTile(t); openTile(t); } });
  document.getElementById('menuRename').addEventListener('click', ()=>{ const t=menuTargetTile; closeTileMenu(); if (t) openRename(t); });
  document.getElementById('menuMove').addEventListener('click', ()=>{ const t=menuTargetTile; closeTileMenu(); if (t) openMovePicker(t); });
  document.getElementById('menuDuplicate').addEventListener('click', ()=>{ const t=menuTargetTile; closeTileMenu(); if (t) duplicateTile(t); });
  document.getElementById('menuDelete').addEventListener('click', ()=>{
    const t = menuTargetTile; closeTileMenu();
    if (t && confirm('Delete "' + nodeNameFor(t) + '"?')) removeTile(t);
  });
  document.addEventListener('click', (e)=>{
    const menu = tileMenuEl();
    if (menu.classList.contains('active') && !menu.contains(e.target) && !e.target.closest('.tile-kebab')) closeTileMenu();
  });

  document.getElementById('searchInput').addEventListener('input', applySearchFilter);

  renderTree();
}
