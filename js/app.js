'use strict';
/* =====================================================================
   app.js — shared shell helpers + boot. Loaded LAST (see index.html)
   so every function it calls from the other modules already exists.
   Everything in here is generic UI plumbing, not feature logic — a
   feature module (tree.js, occlusion-editor.js, study.js) should never
   need to be touched to change how overlays or hotkeys behave globally.
   ===================================================================== */

function escapeHtml(s){ return (s == null ? '' : String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ---------- logo profile switcher: Brick / Cement ---------- */
const BRICK_LOGO_SVG = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
  '<rect x="2" y="6" width="13" height="8" rx="1.5" fill="#B54B36" stroke="#8B3526" stroke-width="1"/>' +
  '<rect x="17" y="6" width="13" height="8" rx="1.5" fill="#D0664E" stroke="#8B3526" stroke-width="1"/>' +
  '<rect x="9" y="16" width="13" height="8" rx="1.5" fill="#8B3526" stroke="#5c211d" stroke-width="1"/>' +
  '<rect x="2" y="16" width="5" height="8" rx="1.5" fill="#B54B36" stroke="#5c211d" stroke-width="1"/>' +
  '<rect x="24" y="16" width="6" height="8" rx="1.5" fill="#B54B36" stroke="#5c211d" stroke-width="1"/></svg>';
const CEMENT_LOGO_SVG = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
  '<rect x="3" y="4" width="26" height="11" rx="1.5" fill="#A8ACA6" stroke="#6E7268" stroke-width="1"/>' +
  '<rect x="3" y="17" width="26" height="11" rx="1.5" fill="#8F938A" stroke="#6E7268" stroke-width="1"/>' +
  '<rect x="7" y="6.5" width="6" height="6" rx="1" fill="#4A4D46"/>' +
  '<rect x="19" y="6.5" width="6" height="6" rx="1" fill="#4A4D46"/>' +
  '<rect x="7" y="19.5" width="6" height="6" rx="1" fill="#3E413B"/>' +
  '<rect x="19" y="19.5" width="6" height="6" rx="1" fill="#3E413B"/></svg>';

function initLogoSwitcher(){
  const btn = document.getElementById('logoSwitcherBtn');
  const dropdown = document.getElementById('logoDropdown');
  function closeDropdown(){ dropdown.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
  function openDropdown(){ dropdown.classList.add('open'); btn.setAttribute('aria-expanded','true'); }
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    // Switching profiles is a Wall-browsing concept, same reasoning as
    // why the old standalone Cement Mode button was Wall-screen-only —
    // toggling it mid-study-session would reintroduce the exact
    // "two things called Cement in different rows" confusion that was
    // fixed earlier. The logo itself still always shows the current
    // profile everywhere; only the ability to CHANGE it is gated.
    if (!document.body.classList.contains('on-wall-screen')) return;
    if (dropdown.classList.contains('open')) closeDropdown(); else openDropdown();
  });
  document.addEventListener('click', (e)=>{
    if (dropdown.classList.contains('open') && !dropdown.contains(e.target) && !btn.contains(e.target)) closeDropdown();
  });
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && dropdown.classList.contains('open')) closeDropdown();
  });
  dropdown.querySelectorAll('.logo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      const wantsCement = opt.dataset.profile === 'cement';
      if (wantsCement !== cementMode) toggleCementMode();
      closeDropdown();
    });
  });
}

/* ---------- Cement Mode: a view-wide toggle, same shape as it would
   work in Kardex's own Tough Mode — the Wall stays exactly the same
   (every folder and brick still there, still navigable), but studying
   a brick only pulls its cemented cards, and tiles show a cemented
   count instead of the usual new/due breakdown while it's on. A real
   theme shift (cooler background, grey brick tiles) makes it obvious
   at a glance that the mode is on, not just a small button tint you
   can miss and then get confused by the filtered counts. The topbar
   logo itself doubles as the switcher — no separate button needed. ---------- */
let cementMode = localStorage.getItem('brickCementMode') === 'true';
function applyCementModeTheme(){
  document.body.classList.toggle('cement-mode-active', cementMode);
  const mark = document.getElementById('activeLogoMark');
  const text = document.getElementById('activeLogoText');
  if (mark) mark.innerHTML = cementMode ? CEMENT_LOGO_SVG : BRICK_LOGO_SVG;
  if (text) text.innerHTML = cementMode ? 'CEMENT<span class="k">.</span>' : 'BRICK<span class="k">.</span>';
  const optBrick = document.getElementById('logoOptionBrick');
  const optCement = document.getElementById('logoOptionCement');
  if (optBrick) optBrick.classList.toggle('active', !cementMode);
  if (optCement) optCement.classList.toggle('active', cementMode);
}
function toggleCementMode(){
  cementMode = !cementMode;
  localStorage.setItem('brickCementMode', String(cementMode));
  applyCementModeTheme();
  announce(cementMode ? 'Cement Mode on — bricks now show only cemented cards' : 'Cement Mode off');
  renderTree();
}

/* ---------- screens ---------- */
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // The Cement Mode toggle is a Wall-browsing concept — showing it
  // alongside the Study screen's own per-card Cement button (same
  // cinder-block icon, different meaning) read as two confusingly
  // similar rows stacked on top of each other. It only makes sense
  // to show one Cement control at a time, and the per-card one is
  // the relevant one once you're actually studying.
  document.body.classList.toggle('on-wall-screen', id === 'screenWall');
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
  applyCementModeTheme(); // reflect a persisted-on state (theme + logo display) at boot, not just an isolated button
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
      // Data-safety modals are deliberately not dismissable via
      // Escape either — same reasoning as the ImgBB backup modal.
      if (anyOverlayOpen && ['imgbbUploadOverlay','dataRecoveryOverlay','saveFailedOverlay'].includes(anyOverlayOpen.id)) return;
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
/* ---------- data safety: save failures + boot-time recovery notice ---------- */
let saveFailureWarnedThisSession = false;
function handleSaveFailure(){
  if (saveFailureWarnedThisSession){
    // already shown the full modal once this session — don't spam it
    // on every subsequent failed save, just keep the status visible
    // wherever Settings already shows it (renderTrashList-adjacent
    // Data Safety section, if Settings happens to be open)
    if (typeof renderBackupList === 'function') renderBackupList();
    return;
  }
  saveFailureWarnedThisSession = true;
  openOverlay('saveFailedOverlay', document.getElementById('saveFailedAckBtn'));
}
function checkDataRecoveryNoticeAtBoot(){
  if (window.__brickRecoveredFromBackup){
    const when = new Date(window.__brickRecoveredFromBackup.savedAt).toLocaleString();
    document.getElementById('dataRecoveryText').textContent =
      'Your saved data looked corrupted when this page loaded, so it was automatically restored from a backup taken ' + when + '. Anything changed after that point may be gone. Please export a fresh backup now, just in case.';
    openOverlay('dataRecoveryOverlay', document.getElementById('dataRecoveryAckBtn'));
  } else if (window.__brickDataLossWarning){
    document.getElementById('dataRecoveryText').textContent =
      'Your saved data looked corrupted when this page loaded, and no usable backup was found to restore from — starting from the demo content instead. If you\'ve exported a backup file before, use Settings → Import to bring it back.';
    openOverlay('dataRecoveryOverlay', document.getElementById('dataRecoveryAckBtn'));
  }
}

async function boot(){
  try { await seedDemoImage(); } catch (err){ console.warn('Demo seed image failed (non-fatal)', err); }
  document.body.classList.add('on-wall-screen'); // the initial screen is Wall, set directly in the HTML — showScreen() is never called for it, so this has to be set explicitly here too
  initTreeScreen();
  initOcclusionEditor();
  initBasicClozeEditor();
  initStudyScreens();
  initSettingsScreen();
  initImgbbBackup();
  initShortcutsOverlay();
  initLogoSwitcher();
  initGlobalHotkeys();

  document.getElementById('dataRecoveryAckBtn').addEventListener('click', ()=> closeOverlay('dataRecoveryOverlay'));
  document.getElementById('dataRecoveryExportBtn').addEventListener('click', ()=>{ closeOverlay('dataRecoveryOverlay'); openSettings(); openExportPicker(); });
  document.getElementById('saveFailedAckBtn').addEventListener('click', ()=> closeOverlay('saveFailedOverlay'));
  document.getElementById('saveFailedExportBtn').addEventListener('click', ()=>{ closeOverlay('saveFailedOverlay'); openSettings(); openExportPicker(); });
  checkDataRecoveryNoticeAtBoot();
}
boot();
