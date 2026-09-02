'use strict';
/* =====================================================================
   backup-folder.js — an actual on-disk mirror of the whole Wall/Brick
   tree, one real folder per Wall and one real .json file per Brick,
   kept in sync via the File System Access API. This is what "Export"
   can't do on its own: something that happens automatically, without
   anyone remembering to click a button.

   Desktop Chrome/Edge/Opera only — the API doesn't exist in Firefox,
   Safari, or any mobile browser. Feature-detected throughout; every
   entry point no-ops cleanly where it's unsupported rather than
   throwing, so the rest of the app is completely unaffected on
   browsers that don't have it.

   Deleting something in the app moves the matching mirror file to a
   flat Trash/ folder inside the same backup root instead of leaving
   it stale where it was — real sync, not just accumulation, while
   still never actually discarding anything. Each trashed file gets a
   timestamp baked into its name, so deleting → recreating → deleting
   the same name again can never silently overwrite an earlier trashed
   copy of it. This mirrors the app's own Recycle Bin: gone from where
   it was, fully recoverable until someone actually goes and empties
   Trash/ themselves.
   ===================================================================== */

const BACKUP_FS_SUPPORTED = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
const BACKUP_HANDLE_DB_NAME = 'brickBackupFolderDb';
const BACKUP_HANDLE_STORE = 'handle';
const BACKUP_HANDLE_KEY = 'folderHandle';
const BACKUP_SYNC_INTERVAL_MS = 5 * 60 * 1000; // matches the in-browser tree-backup interval, for the same reasoning

let backupHandleDbPromise = null;
function openBackupHandleDb(){
  if (backupHandleDbPromise) return backupHandleDbPromise;
  backupHandleDbPromise = new Promise((resolve, reject)=>{
    const req = indexedDB.open(BACKUP_HANDLE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BACKUP_HANDLE_STORE)) db.createObjectStore(BACKUP_HANDLE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open backup-folder handle store'));
  });
  return backupHandleDbPromise;
}
async function getStoredFolderHandle(){
  try {
    const db = await openBackupHandleDb();
    const tx = db.transaction(BACKUP_HANDLE_STORE, 'readonly');
    return await idbGetWithKey(tx.objectStore(BACKUP_HANDLE_STORE), BACKUP_HANDLE_KEY);
  } catch (err){ return null; }
}
async function clearStoredFolderHandle(){
  try {
    const db = await openBackupHandleDb();
    const tx = db.transaction(BACKUP_HANDLE_STORE, 'readwrite');
    tx.objectStore(BACKUP_HANDLE_STORE).delete(BACKUP_HANDLE_KEY);
  } catch (err){ /* nothing to clean up if this fails — non-fatal either way */ }
}
// idbPut()/idbGet() elsewhere in the app assume an in-line keyPath;
// this store uses an explicit out-of-line key instead, so it needs
// its own tiny get/put pair rather than reusing those as-is.
function idbPutWithKey(store, val, key){
  return new Promise((resolve, reject)=>{
    const r = store.put(val, key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbGetWithKey(store, key){
  return new Promise((resolve, reject)=>{
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function storeFolderHandle(handle){
  const db = await openBackupHandleDb();
  const tx = db.transaction(BACKUP_HANDLE_STORE, 'readwrite');
  await idbPutWithKey(tx.objectStore(BACKUP_HANDLE_STORE), handle, BACKUP_HANDLE_KEY);
}

/* ---------- linking / permission ---------- */
async function linkBackupFolder(){
  if (!BACKUP_FS_SUPPORTED) return null;
  try {
    const handle = await window.showDirectoryPicker({ mode:'readwrite' });
    await storeFolderHandle(handle);
    return handle;
  } catch (err){
    // most commonly the person just closed the picker — not an error
    // worth surfacing as a failure
    return null;
  }
}
async function unlinkBackupFolder(){
  await clearStoredFolderHandle();
}
async function checkFolderPermission(handle){
  if (!handle || typeof handle.queryPermission !== 'function') return 'denied';
  try { return await handle.queryPermission({ mode:'readwrite' }); }
  catch (err){ return 'denied'; }
}
/* Must be called from a real user gesture (a click) — the browser
   requires that for re-granting file system permission, so this
   can't happen silently on boot no matter how automatic the rest of
   the sync is. */
async function reconnectBackupFolder(handle){
  if (!handle || typeof handle.requestPermission !== 'function') return false;
  try { return (await handle.requestPermission({ mode:'readwrite' })) === 'granted'; }
  catch (err){ return false; }
}

/* ---------- filesystem-safe naming ---------- */
function sanitizeFilename(name){
  const cleaned = String(name || 'Untitled').replace(/[\/\\:*?"<>|]/g, '-').trim();
  return cleaned || 'Untitled';
}
/* Two Bricks (or Walls) with the same name in the same directory would
   otherwise silently overwrite each other — disambiguate with a short
   id suffix the second time a name is seen within one sync pass. */
function uniqueName(base, usedNames){
  let candidate = base;
  let n = 2;
  while (usedNames.has(candidate)){
    candidate = base + ' (' + n + ')';
    n++;
  }
  usedNames.add(candidate);
  return candidate;
}

/* ---------- the actual mirror sync ----------
   Structure-computation (which folders/files should exist, with what
   names, collision-disambiguated) is split from the actual writing —
   the structure+content computation (computeMirrorPlan) is shared
   with the companion-extension bridge (extension-bridge.js), so the
   exact same naming/collision/path logic governs both the in-page
   File System Access sync AND whatever the extension eventually
   writes via chrome.downloads. One mirroring algorithm, two writers,
   not two independently-maintained copies that could quietly drift
   apart from each other. */
let lastSyncedTreeJson = null;
let backupSyncInFlight = false;
async function syncBackupFolder(force){
  if (!BACKUP_FS_SUPPORTED || backupSyncInFlight) return { ok:false, reason:'unsupported-or-busy' };
  const handle = await getStoredFolderHandle();
  if (!handle) return { ok:false, reason:'not-linked' };
  const permission = await checkFolderPermission(handle);
  if (permission !== 'granted') return { ok:false, reason:'needs-permission' };

  const currentJson = JSON.stringify(tree);
  if (!force && currentJson === lastSyncedTreeJson) return { ok:true, reason:'unchanged' };

  backupSyncInFlight = true;
  try {
    const snapshot = JSON.parse(currentJson);
    const plan = await computeMirrorPlan(snapshot);
    const freshPaths = new Set(plan.map(e => e.relativePath));

    // computed BEFORE writing the fresh plan, so a file that's simply
    // being updated (still present, content changed) is never
    // mistaken for something that was removed from the app
    const existingPaths = await listExistingMirrorPaths(handle, '');
    let trashed = 0;
    for (const existingPath of existingPaths){
      if (!freshPaths.has(existingPath)){
        await moveToTrashFSA(handle, existingPath);
        trashed++;
      }
    }

    await writeMirrorPlanToFSA(handle, plan);
    lastSyncedTreeJson = currentJson;
    localStorage.setItem('brickBackupFolderLastSync_v1', JSON.stringify({ syncedAt: Date.now() }));
    return { ok:true, reason:'synced', trashed };
  } catch (err){
    console.warn('Backup folder sync failed (non-fatal — the in-browser backups and manual Export are unaffected)', err);
    return { ok:false, reason:'error', error: String(err) };
  } finally {
    backupSyncInFlight = false;
  }
}

/* Structure only — which relative paths should exist, and which Brick
   id each one corresponds to. Cheap and synchronous; doesn't touch
   IndexedDB, so both the FSA sync and the bridge's cheap "has anything
   changed" check can use this without paying for full content-building
   every time. */
function computeMirrorStructure(treeSnapshot){
  const entries = [];
  (function walk(node, pathPrefix, usedNames){
    node.children.forEach(child => {
      if (child.type === 'folder'){
        const name = uniqueName(sanitizeFilename(child.name), usedNames);
        walk(child, pathPrefix + name + '/', new Set());
      } else if (child.type === 'deck'){
        const name = uniqueName(sanitizeFilename(child.name), usedNames) + '.json';
        entries.push({ relativePath: pathPrefix + name, brickId: child.id, brickName: child.name });
      }
    });
  })(treeSnapshot, '', new Set());
  return entries;
}
/* Structure + actual content, one independently-importable Brick
   export per file. Takes an explicit snapshot rather than reading the
   live `tree` repeatedly — the structural decisions (which paths
   exist) are then guaranteed self-consistent for this one call, even
   though each individual file's CONTENT still goes through
   buildExportBundle() against the live tree (unavoidable without a
   much larger rewrite — that function is shared with, and already
   well-tested via, ordinary selective Export). In the narrow window
   where something really did change mid-computation, a since-deleted
   Brick would just resolve to an empty/near-empty file rather than
   crash — self-correcting on the next sync, which recomputes
   structure fresh. Documented, not hidden. */
async function computeMirrorPlan(treeSnapshot){
  const structure = computeMirrorStructure(treeSnapshot);
  const plan = [];
  for (const entry of structure){
    const bundle = await buildExportBundle([entry.brickId]);
    plan.push({ relativePath: entry.relativePath, content: JSON.stringify(bundle) });
  }
  return plan;
}
async function writeMirrorPlanToFSA(rootHandle, plan){
  for (const entry of plan){
    const segments = entry.relativePath.split('/');
    const fileName = segments.pop();
    let dirHandle = rootHandle;
    for (const seg of segments){
      dirHandle = await dirHandle.getDirectoryHandle(seg, { create:true });
    }
    const fileHandle = await dirHandle.getFileHandle(fileName, { create:true });
    const writable = await fileHandle.createWritable();
    await writable.write(entry.content);
    await writable.close();
  }
}

/* ---------- trash: real sync, not just accumulation ----------
   Flat, not nested — every trashed file lands directly in Trash/,
   with its original path folded into the filename (slashes become
   " - ") plus a timestamp, rather than replicating the Wall folder
   structure inside Trash/ too. Keeps Trash/ simple to actually look
   through, and makes the timestamp-uniqueness guarantee trivial —
   no risk of two different original paths colliding on the way in. */
async function listExistingMirrorPaths(dirHandle, prefix){
  let paths = [];
  for await (const [name, entryHandle] of dirHandle.entries()){
    if (prefix === '' && name === 'Trash') continue; // never treat Trash/ itself as mirror content to diff against
    const relPath = prefix + name;
    if (entryHandle.kind === 'directory'){
      paths = paths.concat(await listExistingMirrorPaths(entryHandle, relPath + '/'));
    } else if (entryHandle.kind === 'file'){
      paths.push(relPath);
    }
  }
  return paths;
}
function trashFileName(relativePath){
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const flat = relativePath.replace(/\//g, ' - ').replace(/\.json$/, '');
  return flat + ' (deleted ' + stamp + ').json';
}
async function moveToTrashFSA(rootHandle, relativePath){
  const segments = relativePath.split('/');
  const fileName = segments.pop();
  let dirHandle = rootHandle;
  for (const seg of segments) dirHandle = await dirHandle.getDirectoryHandle(seg);
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  const content = await file.text();

  const trashDir = await rootHandle.getDirectoryHandle('Trash', { create:true });
  const trashFile = await trashDir.getFileHandle(trashFileName(relativePath), { create:true });
  const writable = await trashFile.createWritable();
  await writable.write(content);
  await writable.close();

  await dirHandle.removeEntry(fileName);
}

/* ---------- triggers: periodic timer + tab close/hide ----------
   Both, not just one — a timer alone misses "closed the tab a minute
   after the last sync"; close-events alone miss "left the tab open
   for hours without ever formally closing it, then the browser
   crashed". Together, the gap between "last real sync" and "worst
   case data loss" stays small regardless of how the session actually
   ends. Gated on the dirty-check inside syncBackupFolder() itself, so
   firing often costs nothing when nothing's actually changed. */
let backupSyncTimer = null;
function initBackupFolderTriggers(){
  if (!BACKUP_FS_SUPPORTED) return;
  backupSyncTimer = setInterval(()=> syncBackupFolder(false), BACKUP_SYNC_INTERVAL_MS);
  window.addEventListener('pagehide', ()=> syncBackupFolder(false));
  document.addEventListener('visibilitychange', ()=>{ if (document.hidden) syncBackupFolder(false); });
}
