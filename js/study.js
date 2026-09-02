'use strict';
/* =====================================================================
   study.js — Brick preview screen + the actual study/review loop.
   ===================================================================== */

let reviewLog = loadLog();
function saveLogNow(){ saveLog(reviewLog); }

let previewDeckId = null;
let studyTimePerCard = 20;

function openBrickPreview(deckId){
  previewDeckId = deckId;
  const deck = nodeById(deckId);
  if (!deck) return;
  const total = deck.cards.length;
  document.getElementById('previewTitle').textContent = deck.name;
  document.getElementById('previewSub').textContent = total + ' card' + (total===1?'':'s');
  document.getElementById('statTotal').textContent = total;
  if (cementMode){
    const cemented = deck.cards.filter(c => c.cemented).length;
    document.getElementById('statDue').textContent = cemented;
    document.querySelector('#statDue').parentElement.querySelector('.lbl').textContent = 'Cemented';
    document.getElementById('statNew').textContent = 0;
    document.querySelector('#statNew').parentElement.querySelector('.lbl').textContent = 'New';
  } else {
    const srsMap = computeSRS(reviewLog);
    const due = deck.cards.filter(c => isCardDue(c.id, srsMap)).length;
    const isNew = deck.cards.filter(c => !cardHasHistory(c.id, srsMap)).length;
    document.getElementById('statDue').textContent = due;
    document.querySelector('#statDue').parentElement.querySelector('.lbl').textContent = 'Due';
    document.getElementById('statNew').textContent = isNew;
  }
  resetLaunch();
  renderResumeBanner();
  showScreen('screenPreview');
}

/* ---------- paused-session resume banner ----------
   Only ever one paused session at a time (a single global slot, same
   simplification Kardex's own pending-session system makes) — if it
   belongs to whichever brick you're now previewing, offer to pick it
   back up instead of silently only ever offering "start fresh". */
function renderResumeBanner(){
  const banner = document.getElementById('resumeBanner');
  const snap = loadPendingSession();
  if (!snap || snap.deckId !== previewDeckId){ banner.style.display = 'none'; return; }
  const deck = nodeById(snap.deckId);
  const stillValidIds = deck ? snap.order.filter(id => deck.cards.some(c => c.id === id)) : [];
  if (!deck || !stillValidIds.length){
    clearPendingSession();
    banner.style.display = 'none';
    return;
  }
  const left = stillValidIds.length - Math.min(snap.pos, stillValidIds.length - 1);
  document.getElementById('resumeBannerText').textContent =
    'Paused — ' + left + ' card' + (left===1?'':'s') + ' left in this session.';
  banner.style.display = '';
}
function resumeSession(){
  const snap = loadPendingSession();
  if (!snap) return;
  const deck = nodeById(snap.deckId);
  if (!deck){ clearPendingSession(); renderResumeBanner(); announce('That brick no longer exists — nothing to resume.'); return; }
  const validOrder = snap.order.filter(id => deck.cards.some(c => c.id === id));
  if (!validOrder.length){ clearPendingSession(); renderResumeBanner(); announce('Those cards no longer exist — nothing to resume.'); return; }
  const pos = Math.min(snap.pos, validOrder.length - 1);
  session = {
    deckId: snap.deckId, order: validOrder, pos,
    revealed:false, timedOutThisAttempt:false, remaining:0, running:false, tickId:null,
    correct: snap.correct || 0, missed: snap.missed || 0,
    hintsEnabled: !!snap.hintsEnabled
  };
  showScreen('screenStudy');
  renderStudyCard();
}
function discardPendingSession(){
  clearPendingSession();
  renderResumeBanner();
  announce('Discarded the paused session.');
}

/* Snapshot the resumable parts of the session — deliberately NOT the
   live timer/tickId/revealed state, which aren't meaningful to restore
   (resuming always shows a fresh, unrevealed front — a safe default
   either way). Called on every card transition AND as a safety net on
   pagehide/visibilitychange, so a hard tab-close or the phone locking
   mid-review still leaves a checkpoint from at most one card ago. */
function snapshotPendingSession(){
  if (!session) return;
  savePendingSession({
    deckId: session.deckId,
    order: session.order,
    pos: session.pos,
    correct: session.correct,
    missed: session.missed,
    hintsEnabled: session.hintsEnabled,
    savedAt: Date.now()
  });
}

let launchArmed = false, launchTimeoutId = null;
function resetLaunch(){
  launchArmed = false;
  clearTimeout(launchTimeoutId);
  document.getElementById('startScrollBtn').textContent = 'Start brick';
  document.getElementById('launchTrack').classList.remove('showing');
  document.getElementById('launchCaption').classList.remove('showing');
}

let session = null; // { deckId, order:[cardId...], pos, revealed, timedOutThisAttempt, remaining, running, tickId, correct, missed, hintsEnabled }

function beginStudy(){
  const deck = nodeById(previewDeckId);
  if (!deck || !deck.cards.length) return;
  let order;
  if (cementMode){
    order = deck.cards.filter(c => c.cemented).map(c => c.id);
    if (!order.length){ announce('No cemented cards in this brick yet.'); resetLaunch(); return; }
  } else {
    const srsMap = computeSRS(reviewLog);
    order = deck.cards.filter(c => isCardDue(c.id, srsMap)).map(c => c.id);
    if (!order.length) order = deck.cards.map(c => c.id);
  }
  clearPendingSession(); // only one paused-session slot exists — starting fresh (on any deck) always supersedes it
  // hintsEnabled lives on the session, initialized ONCE here — not
  // reset per card in renderStudyCard() — so pressing H sticks for the
  // rest of this session's cards until you press it again, rather than
  // needing a fresh press on every single card.
  session = { deckId: deck.id, order, pos:0, revealed:false, timedOutThisAttempt:false, remaining:0, running:false, tickId:null, correct:0, missed:0, hintsEnabled:false };
  showScreen('screenStudy');
  renderStudyCard();
}
function stopAnyStudyTimer(){ if (session && session.tickId) clearInterval(session.tickId); }

function currentCard(){
  const deck = nodeById(session.deckId);
  const id = session.order[session.pos];
  return deck.cards.find(c => c.id === id);
}
async function renderStudyCard(){
  const c = currentCard();
  const deck = nodeById(session.deckId);
  document.getElementById('studyTitle').textContent = deck.name + ' · ' + (session.pos+1) + '/' + session.order.length;

  const stage = document.getElementById('studyStage');
  if (c.type === 'occlusion'){
    const rec = await getImage(c.imgHash);
    stage.style.aspectRatio = c.imgW + ' / ' + c.imgH;
    stage.innerHTML = '<img alt="" src="' + (rec ? rec.dataUrl : '') + '">';
  } else {
    stage.style.aspectRatio = '';
  }

  document.getElementById('studyHeaderText').textContent = c.header || '';
  document.getElementById('studyFooterText').textContent = '';

  session.revealed = false;
  session.timedOutThisAttempt = false;
  document.getElementById('gradeRow').style.opacity = '0';
  document.getElementById('gradeRow').style.pointerEvents = 'none';
  setTapHint('tap ' + (c.type === 'occlusion' ? 'image' : 'card') + ' to reveal');
  updateCementBtn(c);
  updateHintsBtnVisibility(c);
  paintCardContent(c);
  session.remaining = studyTimePerCard;
  startOrResumeTimer();
  snapshotPendingSession();
}
/* Dispatches to the right renderer by card type — occlusion draws mask
   overlays on an image; basic/cloze show plain front/back text. Both
   share the same #studyStage element and the same reveal/timer/grade
   mechanics, which don't care what's inside the stage. */
function paintCardContent(c){
  const stage = document.getElementById('studyStage');
  if (c.type === 'occlusion'){
    stage.classList.remove('text-mode');
    paintMasks(c);
  } else {
    stage.classList.add('text-mode');
    paintTextCard(c);
  }
}
function paintTextCard(c){
  const stage = document.getElementById('studyStage');
  let html;
  if (c.type === 'cloze'){
    const fb = clozeFrontBack(c.text);
    html = session.revealed ? fb.back : fb.front;
  } else {
    html = session.revealed ? formatInline(c.back) : formatInline(c.front);
  }
  stage.innerHTML = '<div class="study-text-card"><div class="study-text-inner">' + html + '</div></div>';
}
/* Tabs pointing upward off a mask near the top edge would get clipped
   by the stage's overflow:hidden — this threshold decides when to flip
   the label below the box instead. Extracted as its own function so
   the boundary condition is directly testable, not buried in a
   template string. */
function labelShouldTabBelow(maskY){ return maskY < 12; }

function paintMasks(c){
  const stage = document.getElementById('studyStage');
  const img = stage.querySelector('img');
  const activeMask = c.masks.find(m => m.id === c.activeMaskId);
  const overlays = c.masks.map(m=>{
    const isActive = m.id === c.activeMaskId;
    let hidden;
    if (c.mode === 'hide-all') hidden = !session.revealed;
    else hidden = isActive && !session.revealed; // hide-one, guess one: only the active shape is ever hidden
    const shapeCls = m.shape === 'ellipse' ? ' shape-ellipse' : '';
    const cls = 'study-mask' + (hidden ? ' hidden-box' : ' revealed-box') + (isActive ? ' active-mask' : '') + shapeCls;
    const tabCls = labelShouldTabBelow(m.y) ? ' tab-below' : '';
    const label = hidden ? '' : '<span class="mlabel' + tabCls + '">' + escapeHtml(m.label || '?') + '</span>';
    // Hints only ever apply to the ONE mask this card is actually
    // testing — in Hide All mode every box is hidden identically, but
    // showing a hint for every one of them would just be handing out
    // every answer on the card at once, not a hint for the specific
    // thing being asked. Hide One mode already only hides the active
    // box, so this restriction falls out naturally there too.
    const showHint = hidden && isActive && session.hintsEnabled && m.hint;
    const hintOverlay = showHint ? '<div class="mask-hint-overlay">' + formatInline(m.hint) + '</div>' : '';
    return '<div class="' + cls + '" style="left:' + safePct(m.x) + '%;top:' + safePct(m.y) + '%;width:' + safePct(m.w) + '%;height:' + safePct(m.h) + '%;">' + label + hintOverlay + '</div>';
  }).join('');
  const spotlight = activeMask ? renderMaskSpotlight(activeMask) : '';
  stage.innerHTML = (img ? img.outerHTML : '') + spotlight + overlays;

  if (session.revealed && c.backExtra) document.getElementById('studyFooterText').textContent = c.backExtra;
  else document.getElementById('studyFooterText').textContent = '';
}
/* A sharp-edged spotlight window around the active mask — present on
   the question screen too, not only after reveal, so the eye is drawn
   to the right region even before tapping. Sized a bit larger than
   the mask itself, with extra room on top to clear the label tab that
   sits above the box once revealed. A hard box-shadow window rather
   than a radial-gradient blend — prototyped both, the gradient read as
   vague/brushed, this reads as a clean, immediate cutout. */
function renderMaskSpotlight(m){
  const padX = 2, padTop = 7, padBottom = 2;
  const mx = safePct(m.x), my = safePct(m.y), mw = safePct(m.w), mh = safePct(m.h);
  const left = clamp(mx - padX, 0, 100);
  const top = clamp(my - padTop, 0, 100);
  const right = clamp(mx + mw + padX, 0, 100);
  const bottom = clamp(my + mh + padBottom, 0, 100);
  return '<div class="study-mask-spotlight" style="left:' + left + '%;top:' + top + '%;width:' + (right-left) + '%;height:' + (bottom-top) + '%;"></div>';
}
function toggleHints(){
  const c = currentCard();
  // Session-wide, not per-card: toggling flips it for every card from
  // here on, of whichever type actually has hints (occlusion). If the
  // CURRENT card happens to be Basic/Cloze, the toggle still flips —
  // it'll just take visible effect the next time an occlusion card
  // with a hint comes up, rather than doing nothing.
  session.hintsEnabled = !session.hintsEnabled;
  if (c.type === 'occlusion') paintCardContent(c);
  updateHintsBtnVisibility(c);
  announce(session.hintsEnabled ? 'Hints on for the rest of this session' : 'Hints off');
}
function updateHintsBtnVisibility(c){
  const btn = document.getElementById('hintsBtn');
  const hasHint = c.type === 'occlusion' && c.masks.find(m => m.id === c.activeMaskId && m.hint);
  btn.style.display = c.type === 'occlusion' ? '' : 'none';
  btn.disabled = !hasHint;
  btn.classList.toggle('active', session.hintsEnabled && !!hasHint);
  btn.title = hasHint ? 'Hints for this session (H)' : 'No hint set for this occlusion';
}

/* Cement: bookmark the current card AND, on the transition to cemented,
   treat it the same as pressing Again — logged as a miss, requeued
   within this session, advances on. Un-cementing (pressing again on an
   already-cemented card) just clears the flag; it doesn't force a
   second miss on top of the first. */
function toggleCement(){
  const c = currentCard();
  c.cemented = !c.cemented;
  saveTreeNow();
  if (c.cemented){
    announce('Cemented — logged as Again, you\'ll see it again this session');
    gradeCurrent(false); // also advances to the next card
  } else {
    announce('Un-cemented');
    updateCementBtn(c);
  }
}
function updateCementBtn(c){
  document.getElementById('cementBtn').classList.toggle('active', !!c.cemented);
}

function setTapHint(text, warn){
  const el = document.getElementById('studyTapHint');
  el.textContent = text;
  el.classList.toggle('warn', !!warn);
}

function toggleReveal(){
  const c = currentCard();
  session.revealed = !session.revealed;
  paintCardContent(c);
  const noun = c.type === 'occlusion' ? 'image' : 'card';
  if (session.revealed){
    pauseTimer();
    setTapHint(session.timedOutThisAttempt ? "time's up earlier — here's the answer" : 'tap ' + noun + ' to hide again');
    document.getElementById('gradeRow').style.opacity = '1';
    document.getElementById('gradeRow').style.pointerEvents = 'auto';
  } else {
    setTapHint('tap ' + noun + ' to reveal');
    if (!session.timedOutThisAttempt && studyTimePerCard) startOrResumeTimer();
  }
}

function startOrResumeTimer(){
  const fill = document.getElementById('timerFill');
  clearInterval(session.tickId);
  if (!studyTimePerCard){
    fill.classList.remove('paused','danger');
    fill.style.width = '100%';
    return;
  }
  fill.classList.remove('paused');
  session.running = true;
  session.tickId = setInterval(tickTimer, 100);
  paintTimerBar();
}
function pauseTimer(){
  clearInterval(session.tickId);
  session.running = false;
  if (studyTimePerCard) document.getElementById('timerFill').classList.add('paused');
}
function tickTimer(){
  session.remaining = Math.max(0, session.remaining - 0.1);
  paintTimerBar();
  if (session.remaining <= 0){
    clearInterval(session.tickId);
    session.running = false;
    onStudyTimeout();
  }
}
function paintTimerBar(){
  const fill = document.getElementById('timerFill');
  const pct = studyTimePerCard ? (session.remaining / studyTimePerCard) * 100 : 100;
  fill.style.width = pct + '%';
  fill.classList.toggle('danger', studyTimePerCard>0 && session.remaining>0 && session.remaining <= Math.min(5, studyTimePerCard*0.3));
}
function onStudyTimeout(){
  const c = currentCard();
  session.timedOutThisAttempt = true;
  c.timeouts = (c.timeouts||0) + 1;
  if (!session.revealed){ session.revealed = true; paintCardContent(c); }
  document.getElementById('timerFill').classList.add('paused');
  setTapHint("time's up — this counts as a miss", true);
  document.getElementById('gradeRow').style.opacity = '1';
  document.getElementById('gradeRow').style.pointerEvents = 'auto';
  if (c.timeouts > 2 && !c.tough){
    c.tough = true;
    saveTreeNow();
    announce('3 timeouts on this card — auto-tagged Tough');
  } else {
    announce('Timed out — logged as a miss');
  }
}

function gradeCurrent(goodTapped){
  const c = currentCard();
  const good = session.timedOutThisAttempt ? false : goodTapped; // timeout always forces a miss
  reviewLog.push({ cardId: c.id, good, ts: Date.now() });
  saveLogNow();
  if (good) session.correct++; else session.missed++;
  if (session.timedOutThisAttempt && goodTapped) announce('Logged as a miss (timed out earlier)');
  clearInterval(session.tickId);
  if (!good){
    // Requeue within THIS session — SM-2 marking it due-now only matters
    // for some FUTURE study session; without this, "Again" behaved
    // identically to "Good" as far as the current run was concerned,
    // since the card just vanished until you manually restarted.
    const insertAt = Math.min(session.order.length, session.pos + 1 + 3);
    session.order.splice(insertAt, 0, c.id);
  }
  session.pos++;
  if (session.pos >= session.order.length) finishStudy();
  else renderStudyCard();
}
function finishStudy(){
  stopAnyStudyTimer();
  saveTreeNow(); // persists any timeouts/tough tags picked up this run
  clearPendingSession(); // completed — nothing left to resume
  document.getElementById('doneSummary').textContent =
    session.correct + ' good · ' + session.missed + ' to review again · ' + session.order.length + ' cards';
  showScreen('screenDone');
  runDoneWallLoop();
}

/* ---------- animated brick wall on the Done screen ----------
   Bricks lay in one at a time (bottom row, then the offset middle
   row, then the top row — real running-bond order), "You are
   bricked!" appears once the wall is fully built, everything holds a
   beat, then fades and the cycle repeats for as long as the Done
   screen is showing. Timers are tracked and explicitly cleared on the
   way out (Back to wall / Lay it again) — a setTimeout-driven loop
   left running after navigating away would just keep firing forever
   in the background for no visible reason, wasting cycles. */
let doneWallTimers = [];
function clearDoneWallTimers(){ doneWallTimers.forEach(t => clearTimeout(t)); doneWallTimers = []; }
function runDoneWallLoop(){
  clearDoneWallTimers();
  const bricks = Array.from(document.querySelectorAll('#doneWall .done-brick'));
  const text = document.getElementById('doneBrickedText');
  function cycle(){
    bricks.forEach(b => b.classList.remove('laid'));
    text.classList.remove('show');
    bricks.forEach((b, i) => {
      doneWallTimers.push(setTimeout(() => b.classList.add('laid'), 150 + i * 110));
    });
    const allLaidAt = 150 + bricks.length * 110;
    doneWallTimers.push(setTimeout(() => text.classList.add('show'), allLaidAt + 250));
    doneWallTimers.push(setTimeout(cycle, allLaidAt + 3200)); // hold built + text, then restart the loop
  }
  cycle();
}

function initStudyScreens(){
  document.getElementById('previewBackBtn').addEventListener('click', ()=>{ showScreen('screenWall'); renderTree(); });
  document.getElementById('previewTimeChips').addEventListener('click', (e)=>{
    const btn = e.target.closest('.time-chip'); if (!btn) return;
    document.querySelectorAll('#previewTimeChips .time-chip').forEach(c=>c.classList.remove('active'));
    btn.classList.add('active');
    studyTimePerCard = parseInt(btn.dataset.secs, 10);
  });
  document.getElementById('startScrollBtn').addEventListener('click', ()=>{
    if (launchArmed){ clearTimeout(launchTimeoutId); beginStudy(); return; }
    launchArmed = true;
    document.getElementById('startScrollBtn').textContent = 'Cancel';
    const track = document.getElementById('launchTrack'), fill = document.getElementById('launchFill'), cap = document.getElementById('launchCaption');
    track.classList.add('showing'); cap.classList.add('showing');
    fill.style.transition = 'none'; fill.style.width = '100%';
    requestAnimationFrame(()=>{ fill.style.transition = 'width 1.1s linear'; fill.style.width = '0%'; });
    launchTimeoutId = setTimeout(beginStudy, 1100);
  });

  document.getElementById('studyStage').addEventListener('click', ()=>{ if (session) toggleReveal(); });
  document.getElementById('gradeAgain').addEventListener('click', ()=>gradeCurrent(false));
  document.getElementById('gradeGood').addEventListener('click', ()=>gradeCurrent(true));
  document.getElementById('cementBtn').addEventListener('click', ()=>{ if (session) toggleCement(); });
  document.getElementById('hintsBtn').addEventListener('click', ()=>{ if (session) toggleHints(); });
  document.getElementById('studyBackBtn').addEventListener('click', ()=>{
    // Voluntary pause: leaving mid-session does NOT discard progress —
    // the most recent renderStudyCard() already snapshotted this exact
    // position, so this is just an extra explicit checkpoint on top.
    if (session) snapshotPendingSession();
    stopAnyStudyTimer();
    showScreen('screenWall');
    renderTree();
  });
  document.getElementById('resumeSessionBtn').addEventListener('click', resumeSession);
  document.getElementById('discardSessionBtn').addEventListener('click', discardPendingSession);

  document.getElementById('restartScrollBtn').addEventListener('click', ()=>{ clearDoneWallTimers(); beginStudy(); });
  document.getElementById('doneBackBtn').addEventListener('click', ()=>{ clearDoneWallTimers(); showScreen('screenWall'); renderTree(); });

  // Space: reveal when hidden, grade Good when already revealed.
  // C: toggle Cement (bookmark + auto-Again). H: toggle Hints (occlusion only).
  document.addEventListener('keydown', (e)=>{
    if (!document.getElementById('screenStudy').classList.contains('active')) return;
    if (!session) return;
    if (e.code === 'Space' || e.key === ' '){
      e.preventDefault();
      if (!session.revealed) toggleReveal();
      else gradeCurrent(true);
    } else if (e.key === 'c' || e.key === 'C'){
      e.preventDefault();
      toggleCement();
    } else if (e.key === 'h' || e.key === 'H'){
      e.preventDefault();
      toggleHints();
    }
  });

  // Involuntary closure safety net — a hard tab close, browser crash,
  // or the phone locking mid-review doesn't fire any of the "leaving
  // on purpose" handlers above. pagehide and visibilitychange are the
  // two events that most reliably still fire in those cases (unlike
  // beforeunload, which mobile browsers routinely skip), so both are
  // wired to the same snapshot — redundant on desktop, meaningfully
  // more reliable on mobile.
  window.addEventListener('pagehide', ()=>{ if (session) snapshotPendingSession(); });
  document.addEventListener('visibilitychange', ()=>{ if (document.hidden && session) snapshotPendingSession(); });
}
