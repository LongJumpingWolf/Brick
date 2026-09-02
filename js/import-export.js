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

/* Sanitizing on the way in — not just assigning fresh ids the way
   deepCloneWithNewIds does for internal Duplicate — is what actually
   matters for an import path that has to treat its input as
   untrusted. A hand-authored or corrupted file can put anything in
   these fields; without this, a non-numeric mask coordinate reaches
   a raw style="left:...%" string concatenation in study.js and
   genuinely breaks out of the attribute (confirmed by direct
   reproduction: a crafted `x` value produced a real injected
   <img onerror=...> tag). study.js also now defends itself at the
   point of use — this is the other half: reject bad data before it
   ever becomes a saved card at all, rather than relying solely on
   every future render site remembering to re-guard itself. */
const VALID_CARD_TYPES = ['occlusion', 'basic', 'cloze'];
const VALID_MASK_SHAPES = ['rect', 'ellipse'];
const VALID_OCCLUSION_MODES = ['hide-all', 'hide-one'];
function sanitizeString(v, fallback){
  return typeof v === 'string' ? v : (fallback !== undefined ? fallback : '');
}
function sanitizeFiniteNumber(v, fallback){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function sanitizeImportedMask(m){
  if (!m || typeof m !== 'object') return null;
  return {
    id: sanitizeString(m.id) || uid(),
    shape: VALID_MASK_SHAPES.includes(m.shape) ? m.shape : 'rect',
    x: safePct(m.x), y: safePct(m.y), w: safePct(m.w), h: safePct(m.h),
    label: sanitizeString(m.label),
    hint: sanitizeString(m.hint)
  };
}
function sanitizeImportedCard(c){
  if (!c || typeof c !== 'object' || !VALID_CARD_TYPES.includes(c.type)) return null; // unrecognized/malformed card type — dropped, not silently half-imported
  const base = { id: uid(), timeouts: sanitizeFiniteNumber(c.timeouts, 0), tough: !!c.tough, createdAt: Date.now() };
  if (c.type === 'occlusion'){
    const masks = Array.isArray(c.masks) ? c.masks.map(sanitizeImportedMask).filter(Boolean) : [];
    if (!masks.length) return null; // an occlusion card with nothing valid to occlude isn't a meaningfully studyable card
    const activeMaskId = masks.some(m => m.id === c.activeMaskId) ? c.activeMaskId : masks[0].id;
    return {
      ...base, type:'occlusion',
      imgHash: sanitizeString(c.imgHash),
      imgW: sanitizeFiniteNumber(c.imgW, 600), imgH: sanitizeFiniteNumber(c.imgH, 400),
      mode: VALID_OCCLUSION_MODES.includes(c.mode) ? c.mode : 'hide-all',
      activeMaskId, header: sanitizeString(c.header), backExtra: sanitizeString(c.backExtra),
      masks
    };
  }
  if (c.type === 'basic') return { ...base, type:'basic', front: sanitizeString(c.front), back: sanitizeString(c.back) };
  return { ...base, type:'cloze', text: sanitizeString(c.text) }; // cloze
}
function sanitizeImportedNode(node){
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'deck'){
    const cards = Array.isArray(node.cards) ? node.cards.map(sanitizeImportedCard).filter(Boolean) : [];
    return { id: uid(), type:'deck', name: sanitizeString(node.name, 'Imported Brick'), createdAt: Date.now(), cards };
  }
  if (node.type === 'folder'){
    const children = Array.isArray(node.children) ? node.children.map(sanitizeImportedNode).filter(Boolean) : [];
    return { id: uid(), type:'folder', name: sanitizeString(node.name, 'Imported Wall'), children };
  }
  return null; // unrecognized node type at the tree level — dropped
}

async function importBundle(bundle){
  if (!validateBundle(bundle)) throw new Error('That file doesn\'t look like a Brick export.');

  // store every image the bundle carries BEFORE touching the tree, so a
  // card never ends up pointing at a hash that isn't in IndexedDB yet
  const hashEntries = Object.entries(bundle.images || {});
  for (const [hash, img] of hashEntries){
    if (!img || typeof img.dataUrl !== 'string') continue; // malformed image entry — skip rather than crash the whole import
    await storeImageFromDataUrl(img.dataUrl, img.mimeType, hash);
  }

  // sanitize AND assign fresh ids in one pass — every field gets
  // validated/coerced to a safe type and range, so this replaces the
  // plain deepCloneWithNewIds() call Duplicate uses internally (that
  // one only needs fresh ids, since its input is already trusted,
  // in-app-generated data — import's input is not)
  const cloned = bundle.tree.children.map(sanitizeImportedNode).filter(Boolean);
  const target = nodeById(currentFolderId) || nodeById('root');
  target.children.push(...cloned);
  saveTreeNow();

  const counts = countBundleContents({ type:'folder', children: cloned });
  return counts;
}
