'use strict';
/* =====================================================================
   storage.js — everything that touches localStorage / IndexedDB.
   Nothing here knows about the DOM or rendering. Edit this file when
   you need to change how data is persisted, not how it looks.
   ===================================================================== */

const TREE_KEY = 'brickTree_v1';
const TREE_BACKUP_KEY = 'brickTreeBackups_v1';
const TREE_CORRUPTED_KEY = 'brickTreeCorrupted_v1'; // last-resort: whatever unparseable data was found, kept around rather than discarded
const LOG_KEY  = 'brickReviewLog_v1';
const PENDING_SESSION_KEY = 'brickPendingSession_v1';
const TRASH_KEY = 'brickTrash_v1';
const IMGBB_KEY_STORAGE = 'brickImgbbKey';
const IMAGE_URL_MAP_KEY = 'brickImageUrlMap_v1';
const IMG_DB_NAME = 'brickImages';
const IMG_STORE = 'images';
const IMAGE_MAX_DIM = 1600;

function uid(){ return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

/* ---------- IndexedDB image store (content-hash deduped) ---------- */
let imageDbPromise = null;
function openImageDb(){
  if (imageDbPromise) return imageDbPromise;
  imageDbPromise = new Promise((resolve, reject)=>{
    const req = indexedDB.open(IMG_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IMG_STORE)) db.createObjectStore(IMG_STORE, { keyPath:'hash' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open image store'));
  });
  return imageDbPromise;
}
function idbGet(store, key){
  return new Promise((resolve, reject)=>{
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbPut(store, val){
  return new Promise((resolve, reject)=>{
    const r = store.put(val);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function computeSha256(buffer){
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function compressImageFile(file){
  try {
    if (!('createImageBitmap' in window)) return { blob:file, mimeType:file.type||'image/png' };
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(width, height));
    width = Math.max(1, Math.round(width*scale));
    height = Math.max(1, Math.round(height*scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    if (file.type === 'image/gif') return { blob:file, mimeType:file.type, width, height };
    const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', 0.86));
    if (!blob) return { blob:file, mimeType:file.type||'image/png', width, height };
    return { blob, mimeType:'image/webp', width, height };
  } catch (err){
    console.warn('Image compression skipped, using original', err);
    return { blob:file, mimeType:file.type||'image/png' };
  }
}
function readBlobAsDataUrl(blob){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read image'));
    r.readAsDataURL(blob);
  });
}
function loadImageEl(src){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}
async function storeImageFile(file){
  const { blob, mimeType, width, height } = await compressImageFile(file);
  const dataUrl = await readBlobAsDataUrl(blob);
  const buffer = await blob.arrayBuffer();
  const hash = await computeSha256(buffer);
  let w = width, h = height;
  if (!w || !h){
    const el = await loadImageEl(dataUrl);
    w = el.naturalWidth; h = el.naturalHeight;
  }
  const db = await openImageDb();
  const tx = db.transaction(IMG_STORE, 'readwrite');
  const store = tx.objectStore(IMG_STORE);
  const existing = await idbGet(store, hash);
  if (!existing) await idbPut(store, { hash, mimeType, dataUrl, w, h });
  return { hash, w, h, dataUrl };
}
async function storeImageFromDataUrl(dataUrl, mimeType, hash){
  const db = await openImageDb();
  const tx = db.transaction(IMG_STORE, 'readwrite');
  const store = tx.objectStore(IMG_STORE);
  const existing = await idbGet(store, hash);
  if (!existing){
    const el = await loadImageEl(dataUrl);
    await idbPut(store, { hash, mimeType, dataUrl, w: el.naturalWidth, h: el.naturalHeight });
  }
  imageCache.delete(hash); // force a fresh read next getImage() call, in case this hash existed with different bytes
  return hash;
}
const imageCache = new Map();
async function getImage(hash){
  if (imageCache.has(hash)) return imageCache.get(hash);
  const db = await openImageDb();
  const tx = db.transaction(IMG_STORE, 'readonly');
  const rec = await idbGet(tx.objectStore(IMG_STORE), hash);
  if (rec) imageCache.set(hash, rec);
  return rec || null;
}
async function seedDemoImage(){
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
      <rect width="600" height="400" fill="#EDE6D6"/>
      <circle cx="300" cy="200" r="150" fill="#F4C9A8" stroke="#8f7040" stroke-width="3"/>
      <circle cx="300" cy="200" r="70" fill="#7FA6A0" stroke="#1F4E44" stroke-width="3"/>
      <circle cx="300" cy="140" r="16" fill="#9B3B34" stroke="#5c211d" stroke-width="2"/>
      <text x="300" y="204" font-family="Georgia,serif" font-size="15" fill="#1F4E44" text-anchor="middle">Nucleus</text>
      <text x="300" y="330" font-family="Georgia,serif" font-size="15" fill="#5c4425" text-anchor="middle">Cytoplasm</text>
      <text x="300" y="118" font-family="Georgia,serif" font-size="13" fill="#5c211d" text-anchor="middle">Nucleolus</text>
    </svg>`;
  const dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
  const hash = 'demo-cell-diagram';
  const db = await openImageDb();
  const tx = db.transaction(IMG_STORE, 'readwrite');
  const store = tx.objectStore(IMG_STORE);
  const existing = await idbGet(store, hash);
  if (!existing) await idbPut(store, { hash, mimeType:'image/svg+xml', dataUrl, w:600, h:400 });
  imageCache.set(hash, { dataUrl, w:600, h:400 });
  return hash;
}

/* ---------- Wall/Brick tree (localStorage) ---------- */
function seedTree(){
  const maskA = { id:uid(), shape:'ellipse', x:44, y:44, w:24, h:16, label:'Nucleolus', hint:'A small dense body inside the nucleus itself.' };
  const maskB = { id:uid(), shape:'ellipse', x:33, y:39, w:34, h:23, label:'Nucleus', hint:'The largest membrane-bound structure in the cell.' };
  const maskC = { id:uid(), shape:'rect', x:2, y:80, w:96, h:14, label:'Cytoplasm', hint:'' };
  const masks = [maskA, maskB, maskC];
  const cards = masks.map(m => ({
    id: uid(), type:'occlusion', imgHash:'demo-cell-diagram', imgW:600, imgH:400,
    masks, activeMaskId: m.id, mode:'hide-all',
    header:'Cell Diagram', backExtra:'',
    timeouts:0, tough:false, createdAt: Date.now()
  }));
  return {
    id:'root', type:'folder', name:'Brick', children:[
      { id:uid(), type:'folder', name:'Demo Wall', children:[
        { id:uid(), type:'deck', name:'Cell Diagram (demo)', createdAt: Date.now(), cards }
      ]}
    ]
  };
}
/* =====================================================================
   DATA SAFETY — the tree is the one thing in this app that actually
   matters: every Wall, every Brick, every card. Losing it silently is
   unacceptable, so this section treats every failure mode as
   something to actively recover from or loudly surface, never quietly
   swallow.

   Three layers:
   1. A rolling backup — before writing a new tree, the PREVIOUS valid
      on-disk state gets snapshotted (time-gated so it doesn't happen
      on every single keystroke-triggered save, but still frequent
      enough to matter — up to a few hours of history typically).
   2. Real structural validation on load, not just "did JSON.parse not
      throw" — a parsed-but-garbage-shaped object is treated the same
      as corrupted data.
   3. If the primary data IS unusable: try the most recent valid
      backup first. Only fall back to the empty demo seed as an
      absolute last resort, and either way, flag it so the UI can tell
      the person plainly what happened rather than pretend nothing did.
      The original corrupted string is preserved in a separate key
      rather than discarded, in case there's still something worth
      digging out of it by hand later.
   ===================================================================== */
const MAX_TREE_BACKUPS = 5;
let TREE_BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between backup snapshots — `let`, not `const`, so tests can shrink this rather than needing to wait 5 real minutes

function isValidTreeShape(t){
  return !!t && typeof t === 'object' && t.type === 'folder' && Array.isArray(t.children);
}
function loadTreeBackups(){
  try { const raw = localStorage.getItem(TREE_BACKUP_KEY); const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed : []; }
  catch (err){ return []; }
}
function mostRecentValidBackup(){
  const backups = loadTreeBackups();
  for (let i = backups.length - 1; i >= 0; i--){
    if (backups[i] && isValidTreeShape(backups[i].tree)) return backups[i];
  }
  return null;
}
/* For the Settings screen's manual "restore a backup" list — a
   deliberate rollback the person chooses, distinct from the automatic
   corruption-recovery loadTree() does on its own. */
function restoreTreeFromBackupIndex(index){
  const backups = loadTreeBackups();
  const entry = backups[index];
  if (!entry || !isValidTreeShape(entry.tree)) return null;
  return entry.tree;
}
/* Best-effort — a failure here must never be the reason an actual
   save fails. Skips silently (not even a console.warn) if storage is
   already tight, since saveTree()'s own failure handling covers that
   case with something the user actually sees. */
function maybeBackupCurrentTree(){
  try {
    let backups = loadTreeBackups();
    const last = backups[backups.length - 1];
    if (last && (Date.now() - last.savedAt) < TREE_BACKUP_MIN_INTERVAL_MS) return;
    const prevRaw = localStorage.getItem(TREE_KEY);
    if (!prevRaw) return;
    let prevTree;
    try { prevTree = JSON.parse(prevRaw); } catch (e){ return; } // don't back up data that was already corrupt
    if (!isValidTreeShape(prevTree)) return;
    backups.push({ savedAt: Date.now(), tree: prevTree });
    if (backups.length > MAX_TREE_BACKUPS) backups = backups.slice(backups.length - MAX_TREE_BACKUPS);
    localStorage.setItem(TREE_BACKUP_KEY, JSON.stringify(backups));
  } catch (err){ /* non-fatal, deliberately silent — see comment above */ }
}

function loadTree(){
  try {
    const raw = localStorage.getItem(TREE_KEY);
    if (raw){
      const parsed = JSON.parse(raw);
      if (isValidTreeShape(parsed)) return parsed;
      throw new Error('saved tree has an invalid shape');
    }
  } catch (err){
    console.warn('Could not read saved tree — attempting recovery', err);
    try {
      const raw = localStorage.getItem(TREE_KEY);
      if (raw) localStorage.setItem(TREE_CORRUPTED_KEY, raw); // preserved, not discarded
    } catch (e){ /* even this best-effort preservation can fail if storage is completely full — nothing more to do */ }
    const backup = mostRecentValidBackup();
    if (backup){
      window.__brickRecoveredFromBackup = { savedAt: backup.savedAt };
      return backup.tree;
    }
    window.__brickDataLossWarning = true;
  }
  return seedTree();
}
function saveTree(tree){
  try {
    maybeBackupCurrentTree();
    localStorage.setItem(TREE_KEY, JSON.stringify(tree));
    return true;
  } catch (err){
    console.warn('Could not save — local storage may be full', err);
    return false;
  }
}

/* ---------- review log ---------- */
function loadLog(){
  try { const raw = localStorage.getItem(LOG_KEY); return raw ? JSON.parse(raw) : []; }
  catch (err){ return []; }
}
function saveLog(log){
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); return true; }
  catch (err){ console.warn('Could not save review log', err); return false; }
}

/* ---------- pending (paused) study session ----------
   Covers both voluntary pausing (tapping Back mid-session) and
   involuntary closure (tab close, crash, phone locking the browser,
   navigating away) — the session snapshot is written on every card
   transition AND on pagehide, so whichever way the app actually stops
   running, there's a resumable checkpoint from at most one card ago. */
function loadPendingSession(){
  try { const raw = localStorage.getItem(PENDING_SESSION_KEY); return raw ? JSON.parse(raw) : null; }
  catch (err){ return null; }
}
function savePendingSession(snapshot){
  try { localStorage.setItem(PENDING_SESSION_KEY, JSON.stringify(snapshot)); return true; }
  catch (err){ console.warn('Could not save pending session', err); return false; }
}
function clearPendingSession(){
  try { localStorage.removeItem(PENDING_SESSION_KEY); return true; }
  catch (err){ return false; }
}

/* ---------- recycle bin ---------- */
function loadTrash(){
  try { const raw = localStorage.getItem(TRASH_KEY); return raw ? JSON.parse(raw) : []; }
  catch (err){ return []; }
}
function saveTrash(trash){
  try { localStorage.setItem(TRASH_KEY, JSON.stringify(trash)); return true; }
  catch (err){ console.warn('Could not save recycle bin', err); return false; }
}

/* ---------- ImgBB key + optional URL backup map (client-only, no
   server relay in this build — see README for the security tradeoff) ---------- */
function loadImgbbKey(){
  try { return localStorage.getItem(IMGBB_KEY_STORAGE) || ''; } catch (err){ return ''; }
}
function saveImgbbKey(key){
  try { if (key) localStorage.setItem(IMGBB_KEY_STORAGE, key); else localStorage.removeItem(IMGBB_KEY_STORAGE); return true; }
  catch (err){ return false; }
}
function loadImageUrlMap(){
  try { const raw = localStorage.getItem(IMAGE_URL_MAP_KEY); return raw ? JSON.parse(raw) : {}; }
  catch (err){ return {}; }
}
function saveImageUrlMap(map){
  try { localStorage.setItem(IMAGE_URL_MAP_KEY, JSON.stringify(map)); return true; }
  catch (err){ return false; }
}
/* Fire-and-forget upload straight from the browser using a
   user-supplied key — no serverless relay exists in this static
   deploy, so the key IS visible in the outgoing network request.
   Acceptable for a personal single-user key, not for anything shared;
   flagged clearly in the Settings screen and README. */
async function uploadImageToImgbb(hash, dataUrl){
  const result = await uploadImageToImgbbDetailed(hash, dataUrl);
  return result.url;
}
/* Same upload, but reports enough detail (status code, Retry-After) for
   the batch backup runner's retry/backoff logic — the plain version
   above stays a simple null-or-url contract for anything that just
   wants a fire-and-forget single upload. */
async function uploadImageToImgbbDetailed(hash, dataUrl){
  const key = loadImgbbKey();
  if (!key) return { ok:false, status:0, url:null, retryAfter:null, reason:'no-key' };
  const map = loadImageUrlMap();
  if (map[hash]) return { ok:true, status:200, url:map[hash], retryAfter:null, reason:'already-uploaded' };
  try {
    const base64 = (dataUrl.split(',')[1]) || '';
    if (!base64) return { ok:false, status:0, url:null, retryAfter:null, reason:'bad-data-url' };
    const res = await fetch('https://api.imgbb.com/1/upload?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ image: base64 })
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.success && data.data && data.data.url){
      map[hash] = data.data.url;
      saveImageUrlMap(map);
      return { ok:true, status:res.status, url:data.data.url, retryAfter:null, reason:'uploaded' };
    }
    const retryAfterHeader = res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
    return { ok:false, status:res.status, url:null, retryAfter: retryAfterHeader ? parseInt(retryAfterHeader,10)*1000 : null, reason:'http-'+res.status };
  } catch (err){
    console.warn('ImgBB upload failed', err);
    return { ok:false, status:0, url:null, retryAfter:null, reason:'network-error' };
  }
}
