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
  showScreen('screenPreview');
}

let launchArmed = false, launchTimeoutId = null;
function resetLaunch(){
  launchArmed = false;
  clearTimeout(launchTimeoutId);
  document.getElementById('startScrollBtn').textContent = 'Start brick';
  document.getElementById('launchTrack').classList.remove('showing');
  document.getElementById('launchCaption').classList.remove('showing');
}

let session = null; // { deckId, order:[cardId...], pos, revealed, timedOutThisAttempt, remaining, running, tickId, correct, missed }

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
    return '<div class="' + cls + '" style="left:' + m.x + '%;top:' + m.y + '%;width:' + m.w + '%;height:' + m.h + '%;">' + label + hintOverlay + '</div>';
  }).join('');
  stage.innerHTML = (img ? img.outerHTML : '') + overlays;

  if (session.revealed && c.backExtra) document.getElementById('studyFooterText').textContent = c.backExtra;
  else document.getElementById('studyFooterText').textContent = '';
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
  document.getElementById('doneSummary').textContent =
    session.correct + ' good · ' + session.missed + ' to review again · ' + session.order.length + ' cards';
  showScreen('screenDone');
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
  document.getElementById('studyBackBtn').addEventListener('click', ()=>{ stopAnyStudyTimer(); showScreen('screenWall'); renderTree(); });

  document.getElementById('restartScrollBtn').addEventListener('click', beginStudy);
  document.getElementById('doneBackBtn').addEventListener('click', ()=>{ showScreen('screenWall'); renderTree(); });

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
}
