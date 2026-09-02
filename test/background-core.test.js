'use strict';
/* =====================================================================
   test/background-core.test.js — worst-case coverage for the
   extension's actual decision logic (background-core.js). No jsdom,
   no real Chrome — none of the chrome.* extension APIs exist in ANY
   environment available for automated testing here (confirmed: this
   isn't a browser-DOM concern jsdom could ever cover, it's a genuinely
   separate runtime). Every chrome.* touchpoint is behind the `api`
   parameter background-core.js already takes as dependency injection,
   so this mocks exactly that interface and runs the REAL decision
   logic against it — not a reimplementation of what it should do.
   ===================================================================== */
const assert_ = require('assert');
const path = require('path');
const Core = require(path.join(__dirname, '..', '..', 'brick-extension', 'background-core.js'));

let failures = 0;
function assert(cond, msg){
  if (cond){ console.log('PASS:', msg); }
  else { failures++; console.log('FAIL:', msg); }
}

function makeApi(overrides){
  const calls = { download: [], storageSet: [] };
  const store = {};
  const api = {
    async queryTabs(){ return [{ id:1, lastAccessed: Date.now() }]; },
    async execInPage(tabId, which){
      if (which === 'checkBridge') return { present:true, ready:true, version:1 };
      if (which === 'getMirrorPlan') return { ok:true, files:[
        { relativePath:'Wall A/Brick 1.json', content:'{"a":1}' },
        { relativePath:'Wall A/Brick 2.json', content:'{"b":2}' }
      ]};
      return null;
    },
    async download(opts){ calls.download.push(opts); },
    async storageGet(key){ return store[key]; },
    async storageSet(key, val){ calls.storageSet.push([key, val]); store[key] = val; }
  };
  Object.assign(api, overrides);
  api.__calls = calls;
  api.__store = store;
  return api;
}

async function main(){
  console.log('=== Extension core sync logic — worst-case permutations ===\n');

  // ---------- 1. No matching tab open ----------
  {
    const api = makeApi({ async queryTabs(){ return []; } });
    const result = await Core.runSync(api, {});
    assert(result.ok === false && result.reason === 'no-tab', 'no Brick tab open → ok:false, reason:no-tab — got ' + JSON.stringify(result));
    assert(api.__calls.download.length === 0, 'no download calls were made when there was nothing to sync from');
  }

  // ---------- 2. Multiple tabs — picks the most recently active ----------
  {
    let capturedTabId = null;
    const api = makeApi({
      async queryTabs(){ return [
        { id:1, lastAccessed: 1000 },
        { id:2, lastAccessed: 5000 }, // most recent
        { id:3, lastAccessed: 2000 }
      ]; },
      async execInPage(tabId, which){
        capturedTabId = tabId;
        if (which === 'checkBridge') return { present:true, ready:true, version:1 };
        return { ok:true, files:[] };
      }
    });
    await Core.runSync(api, {});
    assert(capturedTabId === 2, 'with multiple Brick tabs open, the most recently active one (id 2) is the one actually used — got tab ' + capturedTabId);
  }
  {
    const picked = Core.pickBrickTab([{ id:5, lastAccessed:10 }, { id:6, lastAccessed:99 }, { id:7, lastAccessed:50 }]);
    assert(picked.id === 6, 'pickBrickTab() directly: picks the highest lastAccessed — got id ' + picked.id);
    assert(Core.pickBrickTab([]) === null, 'pickBrickTab() with an empty list returns null, not throwing or picking undefined');
    assert(Core.pickBrickTab(null) === null, 'pickBrickTab(null) is handled gracefully too');
  }

  // ---------- 3. Bridge not present at all (old Brick version, or page not loaded) ----------
  {
    const api = makeApi({ async execInPage(){ return { present:false }; } });
    const result = await Core.runSync(api, {});
    assert(result.ok === false && result.reason === 'bridge-missing', 'bridge absent entirely → bridge-missing, not a crash — got ' + JSON.stringify(result));
  }

  // ---------- 4. Bridge present but not ready (app still booting) ----------
  {
    const api = makeApi({ async execInPage(tabId, which){ if (which==='checkBridge') return { present:true, ready:false, version:1 }; return null; } });
    const result = await Core.runSync(api, {});
    assert(result.ok === false && result.reason === 'not-ready', 'bridge present but not ready → not-ready, does not attempt to read a possibly-inconsistent tree — got ' + JSON.stringify(result));
  }

  // ---------- 5. Bridge version mismatch — attempts anyway, doesn't refuse outright ----------
  {
    const api = makeApi({ async execInPage(tabId, which){
      if (which === 'checkBridge') return { present:true, ready:true, version:99 };
      return { ok:true, files:[{ relativePath:'x.json', content:'{}' }] };
    }});
    const result = await Core.runSync(api, {});
    assert(result.ok === true, 'a version mismatch does not block the sync outright — a design choice (best-effort attempt), not a crash — got ' + JSON.stringify(result));
    assert(result.log.some(l => l.includes('version mismatch')), 'the mismatch is at least logged, so it is discoverable via the popup, not silently ignored');
  }

  // ---------- 6. getMirrorPlan() itself reports failure ----------
  {
    const api = makeApi({ async execInPage(tabId, which){
      if (which === 'checkBridge') return { present:true, ready:true, version:1 };
      return { ok:false, reason:'error', error:'IndexedDB read failed' };
    }});
    const result = await Core.runSync(api, {});
    assert(result.ok === false && result.reason === 'plan-failed', 'the bridge itself failing to build a plan is handled, not crashed on — got ' + JSON.stringify(result));
  }

  // ---------- 7. Empty tree — nothing to sync, not an error ----------
  {
    const api = makeApi({ async execInPage(tabId, which){
      if (which === 'checkBridge') return { present:true, ready:true, version:1 };
      return { ok:true, files:[] };
    }});
    const result = await Core.runSync(api, {});
    assert(result.ok === true && result.reason === 'nothing-to-sync', 'a genuinely empty tree is a SUCCESS with nothing to do, not a failure — got ' + JSON.stringify(result));
  }

  // ---------- 8. Normal success ----------
  {
    const api = makeApi();
    const result = await Core.runSync(api, { force:true });
    assert(result.ok === true && result.reason === 'synced' && result.written === 2 && result.failed === 0, 'a clean run writes every file and reports success — got ' + JSON.stringify(result));
    assert(api.__calls.download.length === 2, 'exactly 2 real download calls were made, matching the 2 files in the plan');
    assert(api.__calls.download[0].filename === 'BrickBackups/Wall A/Brick 1.json', 'filenames are prefixed with the subfolder and preserve the full relative path — got ' + api.__calls.download[0].filename);
    assert(api.__calls.storageSet.length === 1 && api.__calls.storageSet[0][0] === 'lastSyncedFingerprint', 'the fingerprint is persisted after a fully successful sync, for the dirty-check to use next time');
  }

  // ---------- 9. PARTIAL failure — one file fails, the rest still get written ----------
  {
    let callCount = 0;
    const api = makeApi({
      async download(opts){
        callCount++;
        if (opts.filename.includes('Brick 1')) throw new Error('disk full (simulated)');
      }
    });
    const result = await Core.runSync(api, { force:true });
    assert(result.ok === false && result.reason === 'partial-failure', 'a single file failing to write is reported as a partial failure, not silently swallowed — got ' + JSON.stringify(result));
    assert(result.written === 1 && result.failed === 1, 'exactly the ONE failing file is counted as failed, the other genuinely succeeded — got written=' + result.written + ' failed=' + result.failed);
    assert(callCount === 2, 'the batch did NOT abort after the first file failed — it kept going and attempted the second file too');
    assert(api.__calls.storageSet.length === 0, 'the fingerprint is deliberately NOT saved after a partial failure — a real, unsynced change must not get skipped by the dirty-check on the next attempt');
  }

  // ---------- 10. Dirty-check: unchanged since last sync, force=false → skip, zero downloads ----------
  {
    const api = makeApi();
    const first = await Core.runSync(api, { force:true });
    assert(first.ok === true, 'sanity: the priming sync succeeds');
    const downloadCountAfterFirst = api.__calls.download.length;
    const second = await Core.runSync(api, { force:false });
    assert(second.ok === true && second.reason === 'unchanged', 'a second sync with nothing changed and force:false correctly skips — got ' + JSON.stringify(second));
    assert(api.__calls.download.length === downloadCountAfterFirst, 'confirms the skip was real — zero NEW download calls were made on the unchanged second run');
  }

  // ---------- 11. force:true bypasses the dirty-check even with nothing changed ----------
  {
    const api = makeApi();
    await Core.runSync(api, { force:true });
    const afterFirst = api.__calls.download.length;
    await Core.runSync(api, { force:true });
    assert(api.__calls.download.length === afterFirst * 2, 'force:true re-syncs even when nothing changed — a manual "Sync now" click should always actually do something, not silently no-op');
  }

  // ---------- 12. queryTabs() itself throws ----------
  {
    const api = makeApi({ async queryTabs(){ throw new Error('permission revoked (simulated)'); } });
    const result = await Core.runSync(api, {});
    assert(result.ok === false && result.reason === 'tab-query-failed', 'a thrown tab query is caught cleanly, not an uncaught rejection — got ' + JSON.stringify(result));
  }

  // ---------- 13. execInPage() throws (e.g. host permission missing for that tab) ----------
  {
    const api = makeApi({ async execInPage(){ throw new Error('Cannot access contents of the page (simulated)'); } });
    const result = await Core.runSync(api, {});
    assert(result.ok === false && result.reason === 'exec-failed', 'a thrown script-injection call is caught cleanly — got ' + JSON.stringify(result));
  }

  // ---------- 14. Overlapping calls — a second sync while one is already in flight ----------
  {
    let releaseFirst;
    const gate = new Promise(resolve => { releaseFirst = resolve; });
    const api = makeApi({
      async execInPage(tabId, which){
        if (which === 'checkBridge'){ await gate; return { present:true, ready:true, version:1 }; }
        return { ok:true, files:[] };
      }
    });
    const firstPromise = Core.runSync(api, {}); // deliberately not awaited yet — still "in flight"
    await new Promise(r => setTimeout(r, 10)); // let the first call actually start and hit the gate
    const secondResult = await Core.runSync(api, {}); // fires WHILE the first is still blocked
    assert(secondResult.ok === false && secondResult.reason === 'already-in-progress', 'a second sync call while one is genuinely still in flight is refused outright, not allowed to run concurrently and interleave writes — got ' + JSON.stringify(secondResult));
    releaseFirst();
    const firstResult = await firstPromise;
    assert(firstResult.reason === 'nothing-to-sync', 'the FIRST call, once actually allowed to finish, completes normally and unaffected by the second call being rejected');
  }

  // ---------- 15. storageGet() throwing doesn't block the sync — just disables the dirty-check gracefully ----------
  {
    const api = makeApi({ async storageGet(){ throw new Error('storage unavailable (simulated)'); } });
    const result = await Core.runSync(api, {});
    assert(result.ok === true && result.reason === 'synced', 'a broken storageGet does not block the actual sync — it just means the dirty-check optimization is unavailable for this run, not a hard failure — got ' + JSON.stringify(result));
  }

  console.log(failures ? ('\n=== ' + failures + ' FAILURE(S) ===') : '\n=== ALL EXTENSION CORE-LOGIC TESTS PASSED ===');
  process.exit(failures ? 1 : 0);
}
main().catch(err => { console.error('EXTENSION CORE TEST CRASHED:', err); process.exit(1); });
