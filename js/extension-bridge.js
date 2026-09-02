'use strict';
/* =====================================================================
   extension-bridge.js — the Brick-side half of the companion-extension
   bridge. This is the stable contract: whatever the extension's own
   code ends up looking like, it should only ever need to call these
   functions, never reach into Brick's internals directly. Versioned
   explicitly (BRIDGE_VERSION) so a future incompatible change on
   either side is something that can be DETECTED, not something that
   silently produces wrong data.

   Reuses computeMirrorPlan() from backup-folder.js — the exact same
   naming/collision/path logic that governs the in-page File System
   Access sync governs whatever the extension eventually writes too.
   One mirroring algorithm, not two that could quietly drift apart.
   ===================================================================== */

const BRIDGE_VERSION = 1;
let bridgeBootComplete = false;
function markBridgeReady(){ bridgeBootComplete = true; }

window.__brickBridge = {
  version: BRIDGE_VERSION,

  /* Cheap and synchronous — safe for an extension to poll often.
     Everything else on this object assumes the app has actually
     finished booting; calling before that could hit `tree` or
     `buildExportBundle` before they're in a trustworthy state. */
  isReady(){
    return bridgeBootComplete && typeof tree === 'object' && tree !== null && typeof buildExportBundle === 'function' && typeof computeMirrorPlan === 'function';
  },

  /* A cheap structural summary + a fingerprint an extension can diff
     against what it saw last time — lets it decide "has anything
     changed" without paying for the full, IndexedDB-touching content
     build on every single poll. */
  getTreeSummary(){
    if (!this.isReady()) return { ok:false, reason:'not-ready' };
    try {
      const json = JSON.stringify(tree);
      const counts = countBundleContents(tree);
      return { ok:true, fingerprint: json, walls: counts.walls, bricks: counts.bricks, cards: counts.cards };
    } catch (err){
      return { ok:false, reason:'error', error: String(err) };
    }
  },

  /* The actual payload: one entry per Brick, `relativePath` already
     resolved through the same sanitization/collision-handling the
     in-page sync uses, `content` a complete, independently-importable
     single-Brick export — verified directly (see the test suite) by
     feeding a returned entry straight back through the real import
     path. Snapshots tree structure ONCE up front, so the file/folder
     layout returned here is internally self-consistent even though
     each file's content is still fetched one at a time against the
     live tree — a narrow, documented race (see computeMirrorPlan's
     own comment in backup-folder.js), not a hidden one. */
  async getMirrorPlan(){
    if (!this.isReady()) return { ok:false, reason:'not-ready' };
    try {
      const snapshot = JSON.parse(JSON.stringify(tree));
      const files = await computeMirrorPlan(snapshot);
      return { ok:true, files };
    } catch (err){
      return { ok:false, reason:'error', error: String(err) };
    }
  }
};
