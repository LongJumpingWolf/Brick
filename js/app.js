'use strict';
/* =====================================================================
   app.js — shared shell helpers + boot. Loaded LAST (see index.html)
   so every function it calls from the other modules already exists.
   Everything in here is generic UI plumbing, not feature logic — a
   feature module (tree.js, occlusion-editor.js, study.js) should never
   need to be touched to change how overlays or hotkeys behave globally.
   ===================================================================== */

function escapeHtml(s){ return (s == null ? '' : String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ---------- Cement Mode: a view-wide toggle, same shape as it would
   work in Kardex's own Tough Mode — the Wall stays exactly the same
   (every folder and brick still there, still navigable), but studying
   a brick only pulls its cemented cards, and tiles show a cemented
   count instead of the usual new/due breakdown while it's on. ---------- */
let cementMode = localStorage.getItem('brickCementMode') === 'true';
function toggleCementMode(){
  cementMode = !cementMode;
  localStorage.setItem('brickCementMode', String(cementMode));
  document.getElementById('cementModeBtn').classList.toggle('active', cementMode);
  announce(cementMode ? 'Cement Mode on — bricks now show only cemented cards' : 'Cement Mode off');
  renderTree();
}

/* ---------- screens ---------- */
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ---------- status live region + toast ---------- */
let statusTimeout = null;
function announce(msg){
  const el = document.getElementById('statusLive');
  el.textContent = msg;
  el.classList.add('showing');
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(()=>el.classList.remove('showing'), 2600);
}

/* ---------- overlay open/close with focus management ---------- */
let lastFocusedBeforeOverlay = null;
function openOverlay(id, focusEl){
  lastFocusedBeforeOverlay = document.activeElement;
  const ov = document.getElementById(id);
  ov.classList.add('active');
  (focusEl || ov.querySelector('button, input')).focus();
}
function closeOverlay(id){
  document.getElementById(id).classList.remove('active');
  // The element that had focus before the overlay opened might no
  // longer be a valid target by the time we close — e.g. a tile that
  // was focused, then immediately removed from the DOM by a re-render
  // (like navigating into a folder). Calling .focus() on something
  // non-focusable or detached silently no-ops in browsers, which would
  // leave the overlay's own (now-hidden) input still focused. Blur
  // explicitly in that case rather than trusting the fallback blindly.
  const fallback = lastFocusedBeforeOverlay;
  const viable = fallback && fallback !== document.body && document.contains(fallback);
  if (viable) fallback.focus();
  else if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
}

/* ---------- generic "type a name" modal — used by New Wall, and
   available for anything else that just needs one text field.
   Routed through openOverlay/closeOverlay so it gets the same
   focus-restoration guarantee as every other overlay in the app —
   without that, the input stays document.activeElement after closing
   and every subsequent single-letter hotkey gets misread as "typing". ---------- */
function openNameModal(title, initialVal, onConfirm){
  document.getElementById('nameModalTitle').textContent = title;
  const input = document.getElementById('nameModalInput');
  input.value = initialVal || '';
  input.style.boxShadow = '';
  openOverlay('nameOverlay', input);
  input.select();
  const confirmBtn = document.getElementById('nameModalConfirm');
  const handler = ()=>{
    const val = input.value.trim();
    if (!val){ input.style.boxShadow = '0 0 0 2px var(--clay)'; return; }
    closeOverlay('nameOverlay');
    confirmBtn.removeEventListener('click', handler);
    onConfirm(val);
  };
  const fresh = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(fresh, confirmBtn);
  fresh.addEventListener('click', handler);
  input.onkeydown = (e)=>{ if (e.key === 'Enter') fresh.click(); };
}

/* ---------- shortcuts overlay ---------- */
function initShortcutsOverlay(){
  document.getElementById('shortcutsBtn').addEventListener('click', ()=> openOverlay('shortcutsOverlay'));
  document.getElementById('closeShortcutsBtn').addEventListener('click', ()=> closeOverlay('shortcutsOverlay'));
  document.getElementById('nameOverlay').querySelector('.cancel')?.addEventListener('click', ()=> closeOverlay('nameOverlay'));
}

/* ---------- global hotkeys (Wall screen only — the editor has its
   own local hotkey listener in occlusion-editor.js) ---------- */
function initGlobalHotkeys(){
  const searchInput = document.getElementById('searchInput');
  document.getElementById('cementModeBtn').addEventListener('click', toggleCementMode);
  document.getElementById('cementModeBtn').classList.toggle('active', cementMode); // reflect a persisted-on state at boot
  document.addEventListener('keydown', (e)=>{
    // A field left focused on a DIFFERENT, currently-hidden screen (the
    // editor's fields, say) stays document.activeElement forever once
    // this app's screens are just display:none-toggled, not removed
    // from the DOM. Rather than trust offsetParent for "is this
    // actually visible" (jsdom has no real layout engine and always
    // reports it as null, so that check can't be verified by the test
    // suite at all), this checks the concrete thing that's actually
    // true here: is the focused field inside the currently ACTIVE
    // .screen, or some other one you've since navigated away from.
    const focusedScreen = document.activeElement.closest ? document.activeElement.closest('.screen') : null;
    const staleFocus = focusedScreen && !focusedScreen.classList.contains('active');
    const typing = ['INPUT','TEXTAREA'].includes(document.activeElement.tagName) && !staleFocus;
    const anyOverlayOpen = document.querySelector('.overlay.active');
    const menuOpen = typeof isTileMenuOpen === 'function' && isTileMenuOpen();
    const onWallScreen = document.getElementById('screenWall').classList.contains('active');

    if (e.key === 'Escape'){
      if (anyOverlayOpen){ closeOverlay(anyOverlayOpen.id); return; }
      if (menuOpen){ closeTileMenu(); return; }
      if (document.activeElement === searchInput){ searchInput.blur(); return; }
    }
    if (anyOverlayOpen || menuOpen || !onWallScreen) return;
    if (e.key === '?' && !typing){ e.preventDefault(); openOverlay('shortcutsOverlay'); }
    else if (e.key === '/' && !typing){ e.preventDefault(); searchInput.focus(); }
    else if ((e.key === 'n' || e.key === 'N') && !typing){ e.preventDefault(); openOcclusionEditor(currentFolderId); }
    else if ((e.key === 'w' || e.key === 'W') && !typing){ e.preventDefault(); document.getElementById('newWallBtn').click(); }
    else if ((e.key === 'c' || e.key === 'C') && !typing){ e.preventDefault(); toggleCementMode(); } // "C" here = Cement MODE; on the Study screen, "C" cements the current CARD instead — different screens, no collision
  });
}

/* ---------- boot ---------- */
async function boot(){
  try { await seedDemoImage(); } catch (err){ console.warn('Demo seed image failed (non-fatal)', err); }
  initTreeScreen();
  initOcclusionEditor();
  initBasicClozeEditor();
  initStudyScreens();
  initSettingsScreen();
  initShortcutsOverlay();
  initGlobalHotkeys();
}
boot();
