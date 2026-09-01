'use strict';
/* =====================================================================
   import-export.js — the actual bundle format + serialize/parse logic.
   Settings-screen wiring (the picker UI, buttons) lives in settings.js;
   this file only knows how to build a bundle from a set of chosen node
   ids, and how to merge a parsed bundle back into the live tree.
   ===================================================================== */

const EXPORT_VERSION = 1;

/* Walks the real tree, keeping only DECKS whose id is in `checkedIds`.
   Folders are purely organizational here — a folder is included
   automatically if it ends up with at least one selected deck inside
   it (at any depth), and pruned entirely otherwise. This way checking
   an individual nested Brick doesn't require separately remembering to
   also check every ancestor Wall's own checkbox. */
function filterTreeForExport(node, checkedIds){
  if (node.type === 'deck') return checkedIds.has(node.id) ? node : null;
  const kids = node.children.map(c => filterTreeForExport(c, checkedIds)).filter(Boolean);
  if (!kids.length) return null;
  return { id: node.id, type:'folder', name: node.name, children: kids };
}

function collectImageHashes(node, out){
  out = out || new Set();
  if (node.type === 'deck'){
    node.cards.forEach(c => { if (c.type === 'occlusion' && c.imgHash) out.add(c.imgHash); });
  } else {
    node.children.forEach(c => collectImageHashes(c, out));
  }
  return out;
}

async function buildExportBundle(checkedIds){
  const checkedSet = new Set(checkedIds);
  const filteredTop = tree.children.map(c => filterTreeForExport(c, checkedSet)).filter(Boolean);  const exportRoot = { type:'folder', name:'Brick Export', children: filteredTop };

  const hashes = collectImageHashes(exportRoot);
  const images = {};
  for (const hash of hashes){
    const rec = await getImage(hash);
    if (rec) images[hash] = { dataUrl: rec.dataUrl, mimeType: rec.mimeType, w: rec.w, h: rec.h };
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    tree: exportRoot,
    images
  };
}

function countBundleContents(bundleTree){
  let walls = 0, bricks = 0, cards = 0;
  (function walk(n){
    if (n.type === 'deck'){ bricks++; cards += n.cards.length; }
    else { n.children.forEach(walk); }
  })(bundleTree);
  // top-level folders under the synthetic export root count as Walls;
  // nested sub-folders are still folders, just not counted separately here
  walls = bundleTree.children.filter(c => c.type === 'folder').length;
  return { walls, bricks, cards };
}

function downloadJson(obj, filename){
  const blob = new Blob([JSON.stringify(obj)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportSelected(checkedIds){
  if (!checkedIds.length){ announce('Select at least one Wall or Brick to export.'); return; }
  const bundle = await buildExportBundle(checkedIds);
  const counts = countBundleContents(bundle.tree);
  if (!counts.bricks){ announce('Nothing to export — the selection has no bricks in it.'); return; }
  const ts = new Date().toISOString().slice(0,10);
  downloadJson(bundle, 'brick-export-' + ts + '.json');
  announce('Exported ' + counts.bricks + ' brick' + (counts.bricks===1?'':'s') + ', ' + counts.cards + ' card' + (counts.cards===1?'':'s') + '.');
}

/* ---------- import ---------- */
function validateBundle(obj){
  return obj && typeof obj === 'object' && obj.tree && obj.tree.type === 'folder' && Array.isArray(obj.tree.children) && typeof obj.images === 'object';
}

async function importBundle(bundle){
  if (!validateBundle(bundle)) throw new Error('That file doesn\'t look like a Brick export.');

  // store every image the bundle carries BEFORE touching the tree, so a
  // card never ends up pointing at a hash that isn't in IndexedDB yet
  const hashEntries = Object.entries(bundle.images || {});
  for (const [hash, img] of hashEntries){
    await storeImageFromDataUrl(img.dataUrl, img.mimeType, hash);
  }

  // fresh ids for everything imported — reuses the exact same cloning
  // logic Duplicate already relies on, so imported content can never
  // collide with (or silently overwrite) anything already in the tree
  const cloned = bundle.tree.children.map(deepCloneWithNewIds);
  const target = nodeById(currentFolderId) || nodeById('root');
  target.children.push(...cloned);
  saveTreeNow();

  const counts = countBundleContents({ type:'folder', children: cloned });
  return counts;
}
