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
  const srsMap = computeSRS(reviewLog);
  const total = deck.cards.length;
  const due = deck.cards.filter(c => isCardDue(c.id, srsMap)).length;
  const isNew = deck.cards.filter(c => !cardHasHistory(c.id, srsMap)).length;
  document.getElementById('previewTitle').textContent = deck.name;
  document.getElementById('previewSub').textContent = total + ' card' + (total===1?'':'s');
  document.getElementById('statDue').textContent = due;
  document.getElementById('statNew').textContent = isNew;
  document.getElementById('statTotal').textContent = total;
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
  const srsMap = computeSRS(reviewLog);
  let order = deck.cards.filter(c => isCardDue(c.id, srsMap)).map(c => c.id);
  if (!order.length) order = deck.cards.map(c => c.id);
  session = { deckId: deck.id, order, pos:0, revealed:false, timedOutThisAttempt:false, remaining:0, running:false, tickId:null, correct:0, missed:0 };
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
  const rec = await getImage(c.imgHash);
  const stage = document.getElementById('studyStage');
  stage.style.aspectRatio = c.imgW + ' / ' + c.imgH;
  stage.innerHTML = '<img alt="" src="' + (rec ? rec.dataUrl : '') + '">';

  document.getElementById('studyHeaderText').textContent = c.header || '';
  document.getElementById('studyFooterText').textContent = '';

  session.revealed = false;
  session.timedOutThisAttempt = false;
  document.getElementById('gradeRow').style.opacity = '0';
  document.getElementById('gradeRow').style.pointerEvents = 'none';
  setTapHint('tap image to reveal');
  paintMasks(c);
  session.remaining = studyTimePerCard;
  startOrResumeTimer();
}
function paintMasks(c){
  const stage = document.getElementById('studyStage');
  const img = stage.querySelector('img');
  const overlays = c.masks.map(m=>{
    const isActive = m.id === c.activeMaskId;
    let hidden;
    if (c.mode === 'hide-all') hidden = !session.revealed;
    else hidden = isActive && !session.revealed; // hide-one, guess one: only the active shape is ever hidden
    const shapeCls = m.shape === 'ellipse' ? ' shape-ellipse' : '';
    const cls = (hidden ? 'study-mask hidden-box' : 'study-mask revealed-box' + (isActive ? ' active-mask' : '')) + shapeCls;
    const label = hidden ? '' : '<span class="mlabel">' + escapeHtml(m.label || '?') + '</span>';
    return '<div class="' + cls + '" style="left:' + m.x + '%;top:' + m.y + '%;width:' + m.w + '%;height:' + m.h + '%;">' + label + '</div>';
  }).join('');
  stage.innerHTML = (img ? img.outerHTML : '') + overlays;

  if (session.revealed && c.backExtra) document.getElementById('studyFooterText').textContent = c.backExtra;
  else document.getElementById('studyFooterText').textContent = '';
}
function setTapHint(text, warn){
  const el = document.getElementById('studyTapHint');
  el.textContent = text;
  el.classList.toggle('warn', !!warn);
}

function toggleReveal(){
  const c = currentCard();
  session.revealed = !session.revealed;
  paintMasks(c);
  if (session.revealed){
    pauseTimer();
    setTapHint(session.timedOutThisAttempt ? "time's up earlier — here's the answer" : 'tap image to hide again');
    document.getElementById('gradeRow').style.opacity = '1';
    document.getElementById('gradeRow').style.pointerEvents = 'auto';
  } else {
    setTapHint('tap image to reveal');
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
  if (!session.revealed){ session.revealed = true; paintMasks(c); }
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
  document.getElementById('studyBackBtn').addEventListener('click', ()=>{ stopAnyStudyTimer(); showScreen('screenWall'); renderTree(); });

  document.getElementById('restartScrollBtn').addEventListener('click', beginStudy);
  document.getElementById('doneBackBtn').addEventListener('click', ()=>{ showScreen('screenWall'); renderTree(); });
}
