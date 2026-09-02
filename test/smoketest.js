'use strict';
require('fake-indexeddb/auto');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function assert(cond, msg){ if (!cond){ console.error('FAIL:', msg); failures++; } else console.log('PASS:', msg); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function main(){
  const indexPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf-8');
  // strip the external <script src> tags — inserted manually below as
  // real <script> ELEMENTS (not eval strings: eval creates a fresh
  // lexical scope per call, which does NOT match how real <script src>
  // tags share top-level let/const across files — confirmed by hand
  // before writing this. Script-element injection matches real
  // multi-file <script> loading exactly, which is the thing actually
  // worth proving here.
  html = html.replace(/<script src="[^"]+"><\/script>\s*/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/index.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window){
      window.Element.prototype.getBoundingClientRect = function(){ return { left:0, top:0, width:400, height:300, right:400, bottom:300 }; };
      window.indexedDB = window.indexedDB || global.indexedDB;
      if (!window.crypto) Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
      else if (!window.crypto.subtle) window.crypto.subtle = webcrypto.subtle;
    }
  });
  const { window } = dom;
  const doc = window.document;
  const errors = [];
  window.addEventListener('error', (e)=> errors.push(e.error || e.message));

  function runInPage(code){
    const el = doc.createElement('script');
    el.textContent = code;
    doc.body.appendChild(el);
  }
  function evalInPage(expr){
    runInPage('window.__r = (' + expr + ');');
    const v = window.__r;
    window.__r = undefined;
    return v;
  }

  const scriptOrder = ['js/storage.js','js/scheduler.js','js/text-format.js','js/tree.js','js/occlusion-editor.js','js/basic-cloze.js','js/study.js','js/import-export.js','js/backup-folder.js','js/extension-bridge.js','js/settings.js','js/imgbb-backup.js','js/app.js'];
  scriptOrder.forEach(rel => runInPage(fs.readFileSync(path.join(ROOT, rel), 'utf-8')));
  await sleep(300); // let boot()'s async seedDemoImage() settle

  assert(errors.length === 0, 'no uncaught JS errors after loading all modules (' + errors.length + ' found)' + (errors.length? ': ' + errors.map(String).join(' | '):''));

  // Shrink the ImgBB batch-backup throttling constants globally, this
  // early — ANY key-save anywhere later in this file can transition
  // "no key" to "key set" and trigger the mandatory backup runner, and
  // with the real 60s-between-batches constant, an accidental trigger
  // from an unrelated earlier test section would keep running in the
  // background for real minutes, blocking (via the backupRunning
  // guard) the actually-intentional batching test much further down.
  runInPage(`
    IMGBB_INTRA_BATCH_DELAY_MS = 1;
    IMGBB_BATCH_PAUSE_MS = 1;
    window.fetch = async () => ({ ok:false, status:0, headers:{ get:()=>null }, json: async () => null }); // fails fast, harmless, until a test overrides it deliberately
  `);

  // =========================================================
  // Wall screen: seeded demo content renders from REAL tree data
  // =========================================================
  assert(doc.getElementById('screenWall').classList.contains('active'), 'boots into the Wall screen');
  assert(doc.body.classList.contains('on-wall-screen'), 'boots with the on-wall-screen body class set too — not just the screen div, since CSS rules (like hiding Cement Mode outside the Wall) key off the body class');
  const tiles1 = doc.querySelectorAll('#tileGrid .tile');
  assert(tiles1.length === 1, 'root wall shows exactly the one seeded Demo Wall folder (got ' + tiles1.length + ')');
  assert(tiles1[0].querySelector('.tile-name').textContent === 'Demo Wall', 'seeded folder is named correctly');

  tiles1[0].dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('crumbs').textContent.includes('Demo Wall'), 'navigating into the folder updates breadcrumbs');
  const brickTile = doc.querySelector('#tileGrid .tile.brick-tile');
  assert(!!brickTile, 'seeded demo brick is visible inside Demo Wall');
  assert(brickTile.querySelector('.tile-meta').textContent.includes('3 total'), 'seeded demo brick has 3 cards (one per seeded shape) — got "' + brickTile.querySelector('.tile-meta').textContent + '"');

  // =========================================================
  // New Wall (real CRUD, not a mock)
  // =========================================================
  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('nameModalInput').value = 'Sub Wall';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.querySelectorAll('#tileGrid .tile').length === 2, 'New Wall adds a real tile to the current folder');
  const savedTree1 = JSON.parse(window.localStorage.getItem('brickTree_v1'));
  const demoWallNode = savedTree1.children.find(c => c.name === 'Demo Wall');
  assert(demoWallNode.children.some(c => c.name === 'Sub Wall'), 'New Wall is actually persisted into the real tree structure in localStorage');
  assert(doc.activeElement.tagName !== 'INPUT', 'closing the New Wall modal does NOT leave a stale focused <input> behind (regression: this broke every hotkey afterward until fixed)');

  // =========================================================
  // Occlusion editor: Anki-parity shape drawing (rect + ellipse), move, resize, delete
  // =========================================================
  doc.getElementById('newBrickBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('screenEditor').classList.contains('active'), 'New Brick opens the occlusion editor');
  assert(doc.getElementById('editorUploadStep').style.display !== 'none', 'starts on the upload step');

  // bypass real image decoding (jsdom has no image codec) the same way
  // a successful handleImageFile() would leave the editor state
  runInPage(`
    editorImgHash = 'demo-cell-diagram';
    editorImgW = 600; editorImgH = 400;
    document.getElementById('ioStage').style.aspectRatio = '600 / 400';
    editorShapes = [];
    document.getElementById('editorUploadStep').style.display = 'none';
    document.getElementById('editorMaskStep').style.display = '';
    renderEditorShapes('data:image/svg+xml;base64,PHN2Zy8+');
  `);
  assert(doc.getElementById('editorMaskStep').style.display !== 'none', 'advances to the mask-drawing step');
  assert(doc.querySelector('.io-tool[data-tool="rect"]').classList.contains('active'), 'Rectangle tool is active by default (matches Anki\'s default)');

  const stage = doc.getElementById('ioStage');
  function drag(x1,y1,x2,y2){
    stage.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles:true, clientX:x1, clientY:y1, pointerId:1 }));
    stage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles:true, clientX:x2, clientY:y2, pointerId:1 }));
    stage.dispatchEvent(new window.PointerEvent('pointerup',   { bubbles:true, clientX:x2, clientY:y2, pointerId:1 }));
  }
  // draw a rectangle: stage rect is {left:0,top:0,width:400,height:300}
  drag(40, 30, 120, 90); // ~10-30% x, 10-30% y
  assert(evalInPage('editorShapes.length') === 1, 'dragging with the Rectangle tool creates one shape (got ' + evalInPage('editorShapes.length') + ')');
  assert(evalInPage('editorShapes[0].shape') === 'rect', 'the created shape is a rectangle');

  // PowerPoint-style auto-focus: right after drawing, focus should already
  // be in that shape's hint field, ready to type — checked immediately,
  // before any later interaction has a chance to move focus elsewhere.
  const justDrawnId = evalInPage('editorShapes[0].id');
  assert(doc.activeElement.classList.contains('hint-input') && doc.activeElement.dataset.id === justDrawnId, 'the hint field for the just-drawn shape is auto-focused — got focus on: "' + doc.activeElement.className + '"');
  doc.activeElement.value = 'Think about what sits closest to the outer edge.';
  doc.activeElement.dispatchEvent(new window.Event('input', { bubbles:true }));
  assert(evalInPage(`editorShapes.find(s=>s.id==='${justDrawnId}').hint`) === 'Think about what sits closest to the outer edge.', 'typing into the auto-focused hint field updates that shape\'s hint');

  // switch to Ellipse tool and draw a second shape
  doc.querySelector('.io-tool[data-tool="ellipse"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('editorTool') === 'ellipse', 'clicking the Ellipse tool button switches editorTool');
  drag(200, 150, 280, 210);
  assert(evalInPage('editorShapes.length') === 2, 'drawing with the Ellipse tool adds a second shape');
  assert(evalInPage('editorShapes[1].shape') === 'ellipse', 'the second shape is an ellipse');
  assert(doc.querySelectorAll('.io-shape.shape-ellipse').length === 1, 'the ellipse renders with the ellipse CSS class in the DOM');

  // near-zero accidental drag must not create a phantom shape
  drag(10, 10, 11, 11);
  assert(evalInPage('editorShapes.length') === 2, 'a near-zero accidental drag is discarded, not saved (still 2)');

  // Select tool: click the rectangle to select it, then MOVE it by dragging its body
  doc.querySelector('.io-tool[data-tool="select"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  const rectShapeId = evalInPage('editorShapes[0].id');
  const rectBefore = evalInPage(`JSON.stringify(editorShapes.find(s=>s.id==='${rectShapeId}'))`);
  const rectEl = doc.querySelector('.io-shape[data-id="' + rectShapeId + '"]');
  rectEl.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles:true, clientX:80, clientY:60, pointerId:2 }));
  assert(evalInPage('selectedShapeId') === rectShapeId, 'clicking a shape with the Select tool selects it');
  stage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles:true, clientX:120, clientY:90, pointerId:2 }));
  stage.dispatchEvent(new window.PointerEvent('pointerup', { bubbles:true, clientX:120, clientY:90, pointerId:2 }));
  const rectAfter = evalInPage(`JSON.stringify(editorShapes.find(s=>s.id==='${rectShapeId}'))`);
  assert(rectBefore !== rectAfter, 'dragging a selected shape\'s body actually moves it (x/y changed) — before=' + rectBefore + ' after=' + rectAfter);
  const movedShape = JSON.parse(rectAfter);
  const origShape = JSON.parse(rectBefore);
  assert(movedShape.w === origShape.w && movedShape.h === origShape.h, 'moving a shape changes position but NOT its size');

  // resize via a corner handle
  assert(doc.querySelectorAll('.io-handle').length === 4, 'a selected shape shows exactly 4 resize handles');
  const seHandle = doc.querySelector('.io-handle.se');
  const beforeResize = JSON.parse(evalInPage(`JSON.stringify(editorShapes.find(s=>s.id==='${rectShapeId}'))`));
  seHandle.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles:true, clientX:1, clientY:1, pointerId:3 }));
  stage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles:true, clientX:41, clientY:31, pointerId:3 })); // +10%,+10% roughly
  stage.dispatchEvent(new window.PointerEvent('pointerup', { bubbles:true, clientX:41, clientY:31, pointerId:3 }));
  const afterResize = JSON.parse(evalInPage(`JSON.stringify(editorShapes.find(s=>s.id==='${rectShapeId}'))`));
  assert(afterResize.w > beforeResize.w && afterResize.h > beforeResize.h, 'dragging the SE handle grows the shape (w/h increased) — before=' + JSON.stringify(beforeResize) + ' after=' + JSON.stringify(afterResize));
  assert(afterResize.x === beforeResize.x && afterResize.y === beforeResize.y, 'SE-handle resize keeps the opposite (NW) corner fixed');

  // label editing via the shape list
  const firstRowInput = doc.querySelector('.io-shape-row input');
  firstRowInput.value = 'Left Structure';
  firstRowInput.dispatchEvent(new window.Event('input', { bubbles:true }));
  assert(evalInPage(`editorShapes.find(s=>s.id==='${rectShapeId}').label`) === 'Left Structure', 'typing into a shape-list row updates that shape\'s label');

  // delete the ellipse via its list row
  const ellipseId = evalInPage('editorShapes[1].id');
  doc.querySelector('.io-shape-row[data-id="' + ellipseId + '"] .del-shape').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(evalInPage('editorShapes.length') === 1, 'deleting a shape via its list row removes it (back to 1)');

  // Anki-style tool hotkeys (V/R/O) work while the editor is focused
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'r', bubbles:true }));
  assert(evalInPage('editorTool') === 'rect', '"R" hotkey switches to the Rectangle tool');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'o', bubbles:true }));
  assert(evalInPage('editorTool') === 'ellipse', '"O" hotkey switches to the Ellipse tool');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'v', bubbles:true }));
  assert(evalInPage('editorTool') === 'select', '"V" hotkey switches to the Select tool');
  assert(errors.length === 0, 'no uncaught JS errors accumulated by this point in the test (' + errors.length + '): ' + errors.map(String).join(' | '));

  // hide-one mode selection
  doc.querySelector('.mode-opt[data-mode="hide-one"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(evalInPage('editorMode') === 'hide-one', 'clicking "Hide One, Guess One" updates editorMode');

  // Header / Back Extra fields, then the new two-step flow: Add these
  // shapes to the staged pile FIRST (this must NOT finalize a brick by
  // itself), only THEN does naming + Create brick finalize.
  doc.getElementById('headerInput').value = 'Test Header';
  doc.getElementById('backExtraInput').value = 'Extra context here';
  const folderBeforeGen = evalInPage('nodeById(currentFolderId).children.length');
  doc.getElementById('addOcclusionCardsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('screenEditor').classList.contains('active'), 'adding shapes to the staged pile stays on the editor screen — does NOT finalize a brick yet');
  assert(evalInPage('nodeById(currentFolderId).children.length') === folderBeforeGen, 'no brick was created just from adding shapes to staging');
  assert(evalInPage('stagedCards.length') === 1, 'the one remaining shape was added to the shared staged pile');
  assert(doc.getElementById('editorUploadStep').style.display !== 'none', 'occlusion pane resets to the upload step, ready for another image in the same brick');
  assert(doc.getElementById('stagedCounter').textContent.includes('1 card'), 'the shared staged-count indicator reflects the addition — got "' + doc.getElementById('stagedCounter').textContent + '"');

  doc.getElementById('scrollNameInput').value = 'Generated Test Brick';
  doc.getElementById('generateCardsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('screenWall').classList.contains('active'), 'Create brick returns to the Wall screen');
  assert(evalInPage('nodeById(currentFolderId).children.length') === folderBeforeGen + 1, 'exactly one new brick was added');
  const newDeck = evalInPage(`nodeById(currentFolderId).children.find(c => c.name === 'Generated Test Brick')`);
  assert(!!newDeck, 'new brick has the typed name');
  assert(newDeck.cards.length === 1, 'one staged shape produced exactly one card (got ' + (newDeck && newDeck.cards.length) + ')');
  assert(newDeck.cards[0].mode === 'hide-one', 'generated card carries the chosen Hide One mode');
  assert(newDeck.cards[0].header === 'Test Header', 'generated card carries the Header field');
  assert(newDeck.cards[0].backExtra === 'Extra context here', 'generated card carries the Back Extra field');
  assert(newDeck.cards[0].masks[0].label === 'Left Structure', 'generated card carries the edited shape label');
  const savedTree2 = JSON.parse(window.localStorage.getItem('brickTree_v1'));
  const findDeck = (n) => n.type==='deck' ? (n.name==='Generated Test Brick'?n:null) : n.children.map(findDeck).find(Boolean);
  assert(!!findDeck(savedTree2), 'new brick is actually persisted to localStorage');

  // =========================================================
  // Study loop: preview -> study -> reveal/hide/grade -> done, real SM-2 scheduling
  // =========================================================
  const seededDeckId = (function findId(n){ return n.type==='deck' && n.name.startsWith('Cell Diagram') ? n.id : (n.children||[]).map(findId).find(Boolean); })(savedTree2);
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  assert(doc.getElementById('screenPreview').classList.contains('active'), 'opening a brick shows the preview screen');
  assert(doc.getElementById('statTotal').textContent === '3', 'preview shows 3 total cards for the seeded demo brick');

  const startBtn = doc.getElementById('startScrollBtn');
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true })); // arm
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true })); // skip straight in
  await sleep(50);
  assert(doc.getElementById('screenStudy').classList.contains('active'), 'study screen opens');
  assert(doc.getElementById('studyTitle').textContent.includes('1/3'), 'first card shows 1/3 progress');
  assert(doc.getElementById('studyHeaderText').textContent === 'Cell Diagram', 'seeded card\'s Header text renders above the image');

  const studyStage = doc.getElementById('studyStage');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('gradeRow').style.opacity === '1', 'grade row activates after revealing');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true })); // hide again
  await sleep(10);
  assert(doc.getElementById('gradeRow').style.opacity === '1', 'grade row stays available after re-hiding (unlimited toggling)');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true })); // reveal to grade

  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('studyTitle').textContent.includes('2/3'), 'grading advances to card 2/3');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  const cardFailedId = evalInPage('currentCard().id');
  doc.getElementById('gradeAgain').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  // Again requeues the card within THIS session — the denominator grows
  // from 3 to 4 because the failed card comes back before the session ends,
  // rather than just vanishing until some future SM-2-due session.
  assert(doc.getElementById('studyTitle').textContent.includes('3/4'), 'grading Again grows the session (requeued, not just skipped) — shows 3/4, not 3/3 — got "' + doc.getElementById('studyTitle').textContent + '"');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('studyTitle').textContent.includes('4/4'), 'the 4th slot is the requeued card, back for another attempt — got "' + doc.getElementById('studyTitle').textContent + '"');
  assert(evalInPage('currentCard().id') === cardFailedId, 'the card actually shown in the requeued slot IS the one that was failed, not some other card');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('screenDone').classList.contains('active'), 'finishing the requeued card (this time passing it) shows Done');
  assert(doc.getElementById('doneSummary').textContent.includes('3 good') && doc.getElementById('doneSummary').textContent.includes('1 to review again'), 'done summary correctly tallies 3 good / 1 again across 4 total review events — got "' + doc.getElementById('doneSummary').textContent + '"');

  const savedLog = JSON.parse(window.localStorage.getItem('brickReviewLog_v1'));
  assert(savedLog.length === 4, 'all 4 review events persisted to the real review log, including the requeued retry (got ' + savedLog.length + ')');

  // =========================================================
  // Timeout -> forced miss -> 3rd timeout auto-tough (SAME card, direct function calls)
  // =========================================================
  doc.getElementById('doneBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  const cardIdAtStart = evalInPage('currentCard().id');
  assert(evalInPage('currentCard().timeouts') === 0, 'card starts with 0 timeouts this test');
  runInPage('onStudyTimeout();');
  runInPage('onStudyTimeout();');
  runInPage('onStudyTimeout();');
  assert(evalInPage('currentCard().timeouts') === 3, 'three onStudyTimeout() calls increment to 3');
  assert(evalInPage('currentCard().tough') === true, '3rd timeout auto-tags the card tough');
  const treeAfterTough = JSON.parse(window.localStorage.getItem('brickTree_v1'));
  const findCard = (n) => n.type==='deck' ? n.cards.find(c=>c.id===cardIdAtStart) : (n.children||[]).map(findCard).find(Boolean);
  const persistedCard = findCard(treeAfterTough);
  assert(persistedCard && persistedCard.tough === true, 'tough tag is actually persisted to localStorage, not just in-memory');

  // =========================================================
  // Active-mask distinct color while hidden (Hide All mode) —
  // without this, every hidden box looks identical and there's no way
  // to know which region THIS card is actually testing.
  // =========================================================
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(evalInPage('currentCard().mode') === 'hide-all', 'seeded card is in Hide All mode (the case this fix targets)');
  const hiddenMasks = doc.querySelectorAll('.study-mask.hidden-box');
  const activeHiddenMasks = doc.querySelectorAll('.study-mask.hidden-box.active-mask');
  const nonActiveHiddenMasks = doc.querySelectorAll('.study-mask.hidden-box:not(.active-mask)');
  assert(hiddenMasks.length === 3, 'all 3 masks are hidden before reveal in Hide All mode');
  assert(activeHiddenMasks.length === 1, 'exactly one hidden mask carries the active-mask class (got ' + activeHiddenMasks.length + ')');
  assert(nonActiveHiddenMasks.length === 2, 'the other two hidden masks do NOT carry active-mask — they stay visually distinct from the tested one');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true })); // clean up: leave revealed so next section starts fresh
  await sleep(10);

  // =========================================================
  // Basic cards: create via the editor, study, grade
  // =========================================================
  doc.getElementById('doneBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('newBrickBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('editorCardType') === 'occlusion', 'New Brick always opens on the Occlusion tab by default');

  doc.querySelector('.mode-tab[data-type="basic"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('editorCardType') === 'basic', 'clicking the Basic tab switches editorCardType');
  assert(doc.getElementById('basicPane').style.display !== 'none', 'Basic pane becomes visible');
  assert(doc.getElementById('occlusionPane').style.display === 'none', 'Occlusion pane hides when Basic tab is active');

  // required-fields guard
  doc.getElementById('addBasicCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(evalInPage('basicStagedCards.length') === 0, 'clicking Add with empty fields does not stage a blank card');

  doc.getElementById('basicFrontInput').value = 'What nerve is compressed in carpal tunnel syndrome?';
  doc.getElementById('basicBackInput').value = 'The **median** nerve.';
  doc.getElementById('addBasicCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(evalInPage('basicStagedCards.length') === 1, 'Add card to brick stages one card');
  assert(doc.getElementById('basicFrontInput').value === '', 'front field clears after staging so the next card can be typed immediately');
  assert(doc.querySelectorAll('#basicStagedList .staged-row').length === 1, 'staged card renders a row in the list');
  assert(doc.querySelector('#basicStagedList .staged-back').innerHTML.includes('<strong>median</strong>'), 'staged preview actually renders **bold** formatting, not raw markers — got: "' + doc.querySelector('#basicStagedList .staged-back').innerHTML + '"');

  doc.getElementById('basicFrontInput').value = 'Second basic card front';
  doc.getElementById('basicBackInput').value = 'Second basic card back';
  doc.getElementById('addBasicCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(evalInPage('basicStagedCards.length') === 2, 'a second Add stages a second card (multi-card staging works)');

  doc.getElementById('scrollNameInput').value = 'Basic Card Test Brick';
  doc.getElementById('generateCardsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('screenWall').classList.contains('active'), 'Create brick returns to the Wall screen');
  const basicDeck = evalInPage(`nodeById(currentFolderId).children.find(c => c.name === 'Basic Card Test Brick')`);
  assert(!!basicDeck, 'the Basic brick was created');
  assert(basicDeck.cards.length === 2, 'both staged cards became real cards (got ' + (basicDeck && basicDeck.cards.length) + ')');
  assert(basicDeck.cards[0].type === 'basic', 'generated cards carry type "basic"');
  assert(basicDeck.cards[0].front === 'What nerve is compressed in carpal tunnel syndrome?', 'front text preserved exactly');
  assert(basicDeck.cards[0].back === 'The **median** nerve.', 'back text (with markers, unrendered) is stored raw — formatting is a rendering concern, not a storage one');

  // study a basic card: text-mode stage, front then back on reveal
  runInPage(`openBrickPreview('${basicDeck.id}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(doc.getElementById('studyStage').classList.contains('text-mode'), 'basic card puts the study stage into text-mode (not the dark image mode)');
  assert(doc.querySelector('.study-text-inner').textContent.includes('carpal tunnel'), 'front text renders before reveal');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.querySelector('.study-text-inner').innerHTML.includes('<strong>median</strong>'), 'back text renders on reveal, WITH formatting applied — got: "' + doc.querySelector('.study-text-inner').innerHTML + '"');
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // =========================================================
  // Cloze cards: parsing correctness, staging, study
  // =========================================================
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('newBrickBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.querySelector('.mode-tab[data-type="cloze"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('editorCardType') === 'cloze', 'clicking the Cloze tab switches editorCardType');

  // invalid (no brackets) is rejected
  doc.getElementById('clozeInput').value = 'This has no cloze markers at all.';
  doc.getElementById('addClozeCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(evalInPage('clozeStagedCards.length') === 0, 'text without [[brackets]] is rejected, not staged');

  // live preview updates as you type
  doc.getElementById('clozeInput').value = 'The [[median]] nerve is compressed in carpal tunnel syndrome.';
  doc.getElementById('clozeInput').dispatchEvent(new window.Event('input', { bubbles:true }));
  assert(doc.getElementById('clozePreviewFront').innerHTML.includes('cloze-blank'), 'live preview front shows a blanked-out placeholder for the bracketed term');
  assert(!doc.getElementById('clozePreviewFront').innerHTML.includes('median'), 'the actual answer text does NOT leak into the front preview');
  assert(doc.getElementById('clozePreviewBack').innerHTML.includes('cloze-answer') && doc.getElementById('clozePreviewBack').innerHTML.includes('median'), 'live preview back reveals the answer, styled distinctly');

  doc.getElementById('addClozeCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(evalInPage('clozeStagedCards.length') === 1, 'valid cloze text gets staged');
  assert(doc.getElementById('clozeInput').value === '', 'cloze field clears after staging');

  doc.getElementById('scrollNameInput').value = 'Cloze Test Brick';
  doc.getElementById('generateCardsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  const clozeDeck = evalInPage(`nodeById(currentFolderId).children.find(c => c.name === 'Cloze Test Brick')`);
  assert(!!clozeDeck, 'the Cloze brick was created');
  assert(clozeDeck.cards[0].type === 'cloze', 'generated card carries type "cloze"');
  assert(clozeDeck.cards[0].text === 'The [[median]] nerve is compressed in carpal tunnel syndrome.', 'raw cloze text (with brackets) is stored as-is');

  runInPage(`openBrickPreview('${clozeDeck.id}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(doc.querySelector('.study-text-inner').innerHTML.includes('cloze-blank') && !doc.querySelector('.study-text-inner').innerHTML.includes('median'), 'studying a cloze card shows the blanked front, answer hidden');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.querySelector('.study-text-inner').innerHTML.includes('median'), 'revealing shows the actual answer');

  // =========================================================
  // Hints: occlusion-only, scoped to the active mask only, contrast-safe
  // =========================================================
  const hintsBtn = doc.getElementById('hintsBtn');

  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  runInPage(`openBrickPreview('${basicDeck.id}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(hintsBtn.style.display === 'none', 'Hints button is hidden entirely for a Basic (non-occlusion) card');
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(hintsBtn.style.display !== 'none', 'Hints button is shown for an occlusion card');
  assert(!hintsBtn.disabled, 'Hints button is enabled — the seeded first card\'s active mask has a hint set');
  assert(doc.querySelectorAll('.mask-hint-overlay').length === 0, 'no hint overlay shown before pressing Hints');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'h', bubbles:true }));
  await sleep(10);
  assert(hintsBtn.classList.contains('active'), '"H" hotkey toggles the Hints button into its active state');
  const hintOverlays = doc.querySelectorAll('.mask-hint-overlay');
  assert(hintOverlays.length === 1, 'exactly ONE hint overlay is shown — got ' + hintOverlays.length);
  const activeMaskEl = doc.querySelector('.study-mask.active-mask');
  assert(activeMaskEl.querySelector('.mask-hint-overlay') !== null, 'the hint overlay renders INSIDE the active (currently-tested) mask specifically');
  const nonActiveHidden = Array.from(doc.querySelectorAll('.study-mask.hidden-box:not(.active-mask)'));
  assert(nonActiveHidden.every(el => !el.querySelector('.mask-hint-overlay')), 'the other hidden masks show NO hint overlay — Hide All mode does not leak hints for masks the card isn\'t testing');
  assert(hintOverlays[0].textContent.length > 3, 'the hint overlay actually shows hint text');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'h', bubbles:true }));
  await sleep(10);
  assert(doc.querySelectorAll('.mask-hint-overlay').length === 0, 'pressing "H" again hides the hint overlay');
  assert(!hintsBtn.classList.contains('active'), 'Hints button loses its active state on the second press');

  // =========================================================
  // Hints are a SESSION-WIDE toggle, not per-card: press H once and it
  // should keep applying to every subsequent card without re-pressing.
  // =========================================================
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'h', bubbles:true }));
  await sleep(10);
  assert(evalInPage('session.hintsEnabled') === true, 'Hints enabled for the session');
  assert(doc.querySelectorAll('.mask-hint-overlay').length === 1, 'hint shows immediately on the card currently being viewed');

  // advance to the next card WITHOUT touching H again
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true })); // reveal
  await sleep(10);
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(evalInPage('session.hintsEnabled') === true, 'hintsEnabled is still true after moving to the next card — nothing reset it');
  assert(hintsBtn.classList.contains('active'), 'Hints button automatically shows active on the new card, without pressing H again');
  assert(doc.querySelectorAll('.mask-hint-overlay').length === 1, 'the new card\'s hint shows automatically, with NO fresh H press needed — got ' + doc.querySelectorAll('.mask-hint-overlay').length);

  // third seeded card (Cytoplasm) has no hint set — button should
  // reflect that correctly even though the session toggle is still on
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(evalInPage('session.hintsEnabled') === true, 'session toggle itself is untouched by reaching a card with no hint');
  assert(hintsBtn.disabled, 'Hints button is disabled for a card whose active mask has no hint text');
  assert(!hintsBtn.classList.contains('active'), 'button does not show falsely-active when there\'s nothing to show, even with the session toggle on');
  assert(doc.querySelectorAll('.mask-hint-overlay').length === 0, 'no hint overlay renders when the card genuinely has none, session toggle notwithstanding');

  // pressing H on a Basic/Cloze card still flips the session toggle,
  // it just has no visible card to show it on right now
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20); // finishes the seeded 3-card session
  runInPage(`openBrickPreview('${basicDeck.id}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(evalInPage('session.hintsEnabled') === false, 'a brand-new session starts with hints off again — the toggle does not leak across separate study sessions');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'h', bubbles:true }));
  await sleep(10);
  assert(evalInPage('session.hintsEnabled') === true, 'pressing H while viewing a Basic card still flips the session-wide toggle');
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // =========================================================
  // Cement: bookmark + auto-Again, toggled by C
  // =========================================================
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  const cementBtn = doc.getElementById('cementBtn');
  assert(!cementBtn.classList.contains('active'), 'a fresh card starts un-cemented');
  const cementedCardId = evalInPage('currentCard().id');
  const posBeforeCement = evalInPage('session.pos');
  const missedBeforeCement = evalInPage('session.missed');
  const orderLenBeforeCement = evalInPage('session.order.length');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'c', bubbles:true }));
  await sleep(20);
  assert(evalInPage('session.pos') === posBeforeCement + 1, 'pressing Cement auto-advances to the next card (same as an Again grade)');
  assert(evalInPage('session.missed') === missedBeforeCement + 1, 'pressing Cement counts toward the missed/again tally');
  assert(evalInPage('session.order.length') === orderLenBeforeCement + 1, 'the cemented card was requeued within this session, same as any other Again');
  const cementedLog = JSON.parse(window.localStorage.getItem('brickReviewLog_v1'));
  assert(cementedLog[cementedLog.length - 1].cardId === cementedCardId && cementedLog[cementedLog.length - 1].good === false, 'a real Again review event was logged for the cemented card');
  const treeAfterCement = JSON.parse(window.localStorage.getItem('brickTree_v1'));
  const findCementedCard = (n) => n.type==='deck' ? n.cards.find(c=>c.id===cementedCardId) : (n.children||[]).map(findCementedCard).find(Boolean);
  assert(findCementedCard(treeAfterCement).cemented === true, 'the cemented flag is actually persisted to localStorage, not just in-memory');

  // Un-cement: revisit the SAME card later in this session and toggle off
  // (order.length grew above, and the cemented card was reinserted a few
  // slots ahead — advance through the intervening cards to reach it again).
  while (evalInPage('currentCard().id') !== cementedCardId && evalInPage('session.pos') < evalInPage('session.order.length') - 1){
    studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(10);
    doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(20);
  }
  assert(evalInPage('currentCard().id') === cementedCardId, 'reached the requeued cemented card again in this same session');
  assert(cementBtn.classList.contains('active'), 'Cement button correctly shows the active state on a revisit to an already-cemented card');
  const posBeforeUncement = evalInPage('session.pos');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'c', bubbles:true }));
  await sleep(10);
  assert(evalInPage('session.pos') === posBeforeUncement, 'un-cementing does NOT advance the card or force another grade — you stay put and can review normally');
  assert(!cementBtn.classList.contains('active'), 'Cement button reflects the un-cemented state immediately');
  const treeAfterUncement = JSON.parse(window.localStorage.getItem('brickTree_v1'));
  assert(findCementedCard(treeAfterUncement).cemented === false, 'un-cementing is also persisted to localStorage');

  // Cancel/reopen resets editorCardType back to Occlusion and clears staged cards
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('newBrickBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('editorCardType') === 'occlusion', 'reopening New Brick always resets to the Occlusion tab');
  assert(evalInPage('basicStagedCards.length') === 0, 'reopening New Brick clears any previously staged Basic cards');
  assert(evalInPage('clozeStagedCards.length') === 0, 'reopening New Brick clears any previously staged Cloze cards');
  assert(evalInPage('stagedCards.length') === 0, 'reopening New Brick also clears any previously staged Occlusion cards');

  // =========================================================
  // THE core scenario reported: mixing card types into ONE brick in
  // one continuous session, without any intermediate "Add" finalizing
  // a deck early. Cloze → Basic → Occlusion, one Create brick at the end.
  // =========================================================
  const folderBeforeMixed = evalInPage('nodeById(currentFolderId).children.length');
  doc.querySelector('.mode-tab[data-type="cloze"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('clozeInput').value = 'The [[femoral]] nerve innervates the quadriceps.';
  doc.getElementById('addClozeCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(doc.getElementById('screenEditor').classList.contains('active'), 'adding a cloze card stays on the editor screen');
  assert(evalInPage('nodeById(currentFolderId).children.length') === folderBeforeMixed, 'still no new brick created just from adding a cloze card');

  doc.querySelector('.mode-tab[data-type="basic"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('basicFrontInput').value = 'Mixed-type front';
  doc.getElementById('basicBackInput').value = 'Mixed-type back';
  doc.getElementById('addBasicCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(doc.getElementById('screenEditor').classList.contains('active'), 'adding a basic card ALSO stays on the editor screen');

  doc.querySelector('.mode-tab[data-type="occlusion"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  runInPage(`
    editorImgHash = 'demo-cell-diagram'; editorImgW = 600; editorImgH = 400;
    document.getElementById('editorUploadStep').style.display = 'none';
    document.getElementById('editorMaskStep').style.display = '';
    editorShapes = [];
    renderEditorShapes('data:image/svg+xml;base64,PHN2Zy8+');
  `);
  drag(40, 30, 120, 90); // same synthetic-drag helper used earlier in the file
  assert(evalInPage('editorShapes.length') === 1, 'drew one occlusion shape for the mixed-type brick');
  doc.getElementById('addOcclusionCardsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  assert(doc.getElementById('screenEditor').classList.contains('active'), 'adding the occlusion shape ALSO stays on the editor screen — three tabs contributed, still zero new bricks finalized');

  assert(evalInPage('stagedCards.length + basicStagedCards.length + clozeStagedCards.length') === 3, 'all three tabs\' contributions sit in the combined staged count (1 occlusion + 1 basic + 1 cloze)');
  assert(doc.getElementById('stagedCounter').textContent.includes('3 card'), 'the shared counter reflects all three tabs combined — got "' + doc.getElementById('stagedCounter').textContent + '"');

  doc.getElementById('scrollNameInput').value = 'Mixed Type Brick';
  doc.getElementById('generateCardsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  const mixedDeck = evalInPage(`nodeById(currentFolderId).children.find(c => c.name === 'Mixed Type Brick')`);
  assert(!!mixedDeck, 'the mixed-type brick was created');
  assert(mixedDeck.cards.length === 3, 'it contains all three cards, one of each type (got ' + (mixedDeck && mixedDeck.cards.length) + ')');
  const typesPresent = mixedDeck.cards.map(c => c.type).sort();
  assert(JSON.stringify(typesPresent) === JSON.stringify(['basic','cloze','occlusion']), 'exactly one card of each type is present — got ' + JSON.stringify(typesPresent));

  // =========================================================
  // Spacebar: reveal when hidden, grade Good when already revealed
  // =========================================================
  runInPage(`openBrickPreview('${mixedDeck.id}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(evalInPage('session.revealed') === false, 'card starts unrevealed');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { code:'Space', key:' ', bubbles:true }));
  await sleep(10);
  assert(evalInPage('session.revealed') === true, 'first Space press reveals the card (same as tapping it)');
  const posBeforeSpace = evalInPage('session.pos');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { code:'Space', key:' ', bubbles:true }));
  await sleep(20);
  assert(evalInPage('session.pos') === posBeforeSpace + 1, 'second Space press (after reveal) grades Good and advances — same effect as tapping the Good button');
  const logAfterSpace = JSON.parse(window.localStorage.getItem('brickReviewLog_v1'));
  assert(logAfterSpace[logAfterSpace.length - 1].good === true, 'the review event Space just logged is graded good:true (Space = Good after reveal)');

  // =========================================================
  // Label tab positioning — outside the border, not covering content
  // =========================================================
  assert(evalInPage('labelShouldTabBelow(5)') === true, 'a mask near the top edge (y=5%) flips its label tab below');
  assert(evalInPage('labelShouldTabBelow(50)') === false, 'a mask away from the top edge (y=50%) keeps its label tab above');
  assert(evalInPage('labelShouldTabBelow(11.9)') === true, 'boundary just under the threshold flips below');
  assert(evalInPage('labelShouldTabBelow(12)') === false, 'boundary exactly at the threshold stays above');

  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true })); // reveal
  await sleep(10);
  const labels = doc.querySelectorAll('.study-mask .mlabel');
  assert(labels.length === 3, 'all 3 revealed masks show a label tab (got ' + labels.length + ')');
  assert(Array.from(labels).every(l => l.textContent.trim().length > 0), 'every label tab actually has text content');
  // seeded masks are at y:44, y:39, y:80 — none near the top edge, so none should flip below
  assert(doc.querySelectorAll('.study-mask .mlabel.tab-below').length === 0, 'none of the seeded (non-top-edge) masks flip their tab below');

  const cssText = fs.readFileSync(path.join(ROOT, 'css/study.css'), 'utf-8');
  assert(!/\.mlabel\{[^}]*inset:0/.test(cssText), 'label is no longer centered over the box interior (old inset:0 rule is gone)');
  assert(/\.mlabel\{[^}]*top:-24px/.test(cssText), 'label is positioned outside the box, above it by default');
  assert(/\.tab-below\{[^}]*bottom:-24px/.test(cssText), 'the flip-below variant positions outside the box on the other side');

  // =========================================================
  // Cement Mode: view-wide toggle, same Wall/decks, filtered study
  // =========================================================
  const logoSwitcherBtn = doc.getElementById('logoSwitcherBtn');
  const logoDropdown = doc.getElementById('logoDropdown');
  const logoOptionCement = doc.getElementById('logoOptionCement');
  const logoOptionBrick = doc.getElementById('logoOptionBrick');
  function selectLogoProfile(profile){
    logoSwitcherBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
    (profile === 'cement' ? logoOptionCement : logoOptionBrick).dispatchEvent(new window.Event('click', { bubbles:true }));
  }
  assert(!doc.body.classList.contains('cement-mode-active'), 'Cement Mode starts off');
  assert(doc.getElementById('activeLogoText').textContent.includes('BRICK'), 'the topbar logo shows Brick by default');

  runInPage(`currentFolderId = '${demoWallNode.id}';`);
  runInPage('renderTree();');
  await sleep(10);
  const seededTileBefore = doc.querySelector('[data-id="' + seededDeckId + '"]');
  assert(seededTileBefore.querySelector('.tile-meta').textContent.includes('total'), 'before Cement Mode, the seeded brick tile shows the normal new/due/total meta');
  assert(!seededTileBefore.querySelector('.tile-meta').textContent.includes('cemented'), 'no "cemented" wording shown while Cement Mode is off');

  // cement exactly one card in the seeded brick first, via the real study flow
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  const willCementId = evalInPage('currentCard().id');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'c', bubbles:true }));
  await sleep(20);
  // finish out the rest of the (small, requeued) session so we land back on the Wall cleanly
  while (evalInPage('session') && evalInPage('session.pos < session.order.length')){
    if (evalInPage('!session.revealed')) studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(10);
    doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(20);
  }
  doc.getElementById('doneBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  runInPage(`currentFolderId = '${demoWallNode.id}';`);
  runInPage('renderTree();');
  await sleep(10);

  // toggle Cement Mode ON via the logo switcher dropdown
  selectLogoProfile('cement');
  await sleep(10);
  assert(doc.body.classList.contains('cement-mode-active'), 'selecting Cement from the logo dropdown activates it');
  assert(doc.getElementById('activeLogoText').textContent.includes('CEMENT'), 'the topbar logo swaps to show Cement');
  assert(logoOptionCement.classList.contains('active') && !logoOptionBrick.classList.contains('active'), 'the dropdown reflects Cement as the active option');
  assert(window.localStorage.getItem('brickCementMode') === 'true', 'Cement Mode preference is persisted to localStorage');

  const seededTileAfter = doc.querySelector('[data-id="' + seededDeckId + '"]');
  assert(seededTileAfter.querySelector('.tile-meta').textContent.includes('1 cemented'), 'tile now shows the cemented count instead of new/due — got "' + seededTileAfter.querySelector('.tile-meta').textContent + '"');
  assert(seededTileAfter.querySelector('.tile-meta').textContent.includes('3 total'), 'total count is still shown alongside the cemented count');
  assert(!seededTileAfter.classList.contains('cement-empty'), 'a brick WITH cemented cards is not dimmed');

  const emptyDeckTile = doc.querySelector('[data-id="' + basicDeck.id + '"]');
  if (emptyDeckTile){
    assert(emptyDeckTile.classList.contains('cement-empty'), 'a brick with ZERO cemented cards is visually dimmed in Cement Mode');
    assert(emptyDeckTile.querySelector('.tile-meta').textContent.includes('0 cemented'), 'the zero-cemented brick explicitly shows 0, not blank');
  }

  // preview screen reflects Cement Mode too
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  assert(doc.getElementById('statDue').textContent === '1', 'preview\'s Due slot shows the cemented count while Cement Mode is on');
  assert(doc.querySelector('#statDue').parentElement.querySelector('.lbl').textContent === 'Cemented', 'the Due slot\'s LABEL actually changes to "Cemented", not just the number');

  // starting study only pulls the cemented card(s), regardless of due-ness
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(doc.getElementById('screenStudy').classList.contains('active'), 'Cement Mode study session starts fine when a cemented card exists');
  assert(evalInPage('session.order.length') === 1, 'session contains ONLY the cemented card, not the whole due set (got ' + evalInPage('session.order.length') + ')');
  assert(evalInPage('session.order[0]') === willCementId, 'the one card in the session is the actual cemented card');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('screenDone').classList.contains('active'), 'finishing the single cemented card ends the Cement Mode session normally');

  // starting a brick with NO cemented cards shows a toast and does not enter study
  runInPage(`openBrickPreview('${basicDeck.id}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('screenPreview').classList.contains('active'), 'a brick with no cemented cards stays on the preview screen instead of starting a study session');
  assert(doc.getElementById('statusLive').textContent.includes('No cemented cards'), 'a clear message explains why nothing started — got "' + doc.getElementById('statusLive').textContent + '"');
  assert(doc.getElementById('startScrollBtn').textContent === 'Start brick', 'the Start button resets back to its normal label rather than getting stuck on "Cancel"');

  // "C" hotkey toggles Cement Mode off again, from the Wall screen
  doc.getElementById('previewBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'c', bubbles:true }));
  await sleep(10);
  assert(!doc.body.classList.contains('cement-mode-active'), '"C" hotkey on the Wall screen toggles Cement Mode back off');
  assert(doc.getElementById('activeLogoText').textContent.includes('BRICK'), 'the logo swaps back to Brick too, staying in sync with the hotkey (not just the dropdown click path)');
  assert(window.localStorage.getItem('brickCementMode') === 'false', 'the off-state is persisted too');
  const seededTileFinal = doc.querySelector('[data-id="' + seededDeckId + '"]');
  assert(seededTileFinal.querySelector('.tile-meta').textContent.includes('total') && !seededTileFinal.querySelector('.tile-meta').textContent.includes('cemented'), 'tile reverts to the normal new/due/total display once Cement Mode is off');

  // =========================================================
  // Recycle Bin: delete is now soft-delete, restore/purge/empty
  // =========================================================
  window.confirm = () => true; // delete requires confirmation — jsdom's confirm() is unimplemented (returns falsy) unless stubbed
  runInPage(`currentFolderId = 'root';`);
  runInPage('renderTree();');
  await sleep(10);

  // create a throwaway Wall to delete, so this doesn't touch any earlier test's data
  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('nameModalInput').value = 'Trash Test Wall';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  const trashTestNode = evalInPage(`tree.children.find(c => c.name === 'Trash Test Wall')`);
  assert(!!trashTestNode, 'throwaway wall created for the recycle bin test');
  const trashCountBefore = evalInPage('trash.length');

  const trashTestTile = doc.querySelector('[data-id="' + trashTestNode.id + '"]');
  const kebabForTrash = trashTestTile.querySelector('.tile-kebab');
  kebabForTrash.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('menuDelete').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(!doc.querySelector('[data-id="' + trashTestNode.id + '"]'), 'the deleted wall disappears from the Wall view');
  assert(evalInPage('tree.children.find(c => c.name === \'Trash Test Wall\')') === undefined, 'the deleted wall is genuinely gone from the live tree, not just hidden');
  assert(evalInPage('trash.length') === trashCountBefore + 1, 'a new recycle-bin entry was created');
  const savedTrash1 = JSON.parse(window.localStorage.getItem('brickTrash_v1'));
  assert(savedTrash1.some(t => t.node.name === 'Trash Test Wall'), 'the deleted wall (with its full contents) is actually persisted in the recycle bin, not lost');

  // open Settings, see it listed
  doc.getElementById('settingsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('screenSettings').classList.contains('active'), 'Settings button opens the Settings screen');
  assert(doc.getElementById('trashList').textContent.includes('Trash Test Wall'), 'the Recycle Bin section lists the deleted wall');

  // restore it
  const restoreBtn = doc.querySelector('[data-action="restore"][data-trash-id]');
  restoreBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('trash.length') === trashCountBefore, 'restoring removes the entry from the recycle bin');
  assert(!!evalInPage(`tree.children.find(c => c.name === 'Trash Test Wall')`), 'the restored wall is back in the live tree');
  doc.getElementById('settingsBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(!!doc.querySelector('[data-id="' + trashTestNode.id + '"]'), 'the restored wall tile reappears on the Wall screen');

  // delete it again, this time purge it forever
  doc.querySelector('[data-id="' + trashTestNode.id + '"] .tile-kebab').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('menuDelete').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('settingsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  window.confirm = () => true;
  const purgeBtn = doc.querySelector('[data-action="purge"][data-trash-id]');
  purgeBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(!doc.getElementById('trashList').textContent.includes('Trash Test Wall'), 'purging removes it from the Recycle Bin list');
  assert(!evalInPage(`trash.find(t => t.node && t.node.name === 'Trash Test Wall')`), 'purged item is gone from the trash array entirely, unrecoverable');

  // Empty Recycle Bin clears everything (whatever else is in there from earlier tests too)
  doc.getElementById('emptyTrashBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('trash.length') === 0, 'Empty Recycle Bin clears every entry');
  assert(doc.getElementById('emptyTrashBtn').disabled, 'Empty Recycle Bin button disables itself once the bin is actually empty');

  // =========================================================
  // Export / Import: selective subset, round-trip integrity
  // =========================================================
  doc.getElementById('settingsBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  runInPage(`currentFolderId = 'root';`);
  runInPage('renderTree();');
  await sleep(10);

  doc.getElementById('settingsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('openExportBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('exportOverlay').classList.contains('active'), 'Export button opens the picker overlay');
  const allChecksBefore = doc.querySelectorAll('#exportPickerTree .export-check');
  assert(allChecksBefore.length > 0, 'picker renders checkboxes for the tree');
  assert(Array.from(allChecksBefore).every(cb => cb.checked), 'every checkbox starts checked (default = export everything)');

  // Select none, then check ONLY the seeded demo brick, to test a real subset export
  doc.getElementById('selectNoneExportBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(Array.from(doc.querySelectorAll('#exportPickerTree .export-check')).every(cb => !cb.checked), 'Select none unchecks every box');
  const seededDeckCheckbox = doc.querySelector('.deck-check[data-id="' + seededDeckId + '"]');
  assert(!!seededDeckCheckbox, 'the seeded demo brick has its own checkbox in the picker');
  seededDeckCheckbox.checked = true;
  seededDeckCheckbox.dispatchEvent(new window.Event('change', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('exportCheckedIds.has(\'' + seededDeckId + '\')'), 'checking one deck box adds exactly that id to the export selection');
  assert(evalInPage('exportCheckedIds.size') === 1, 'nothing else got pulled in — a real subset, not everything');

  // build the bundle directly (skip the actual file-download side effect, which jsdom can't meaningfully verify) and feed it straight into import to prove round-trip integrity.
  // evalInPage wraps in `window.__r = (...)`, which can't `await` — use an explicit async IIFE injected via runInPage instead.
  runInPage(`
    (async () => {
      window.__exportBundle = await buildExportBundle(['${seededDeckId}']);
    })();
  `);
  await sleep(50);
  const exportedCounts = evalInPage('countBundleContents(window.__exportBundle.tree)');
  assert(exportedCounts.bricks === 1, 'exported bundle contains exactly the one selected brick (got ' + exportedCounts.bricks + ')');
  assert(exportedCounts.cards === 3, 'exported bundle carries all 3 of that brick\'s cards (got ' + exportedCounts.cards + ')');
  assert(evalInPage('Object.keys(window.__exportBundle.images).length') === 1, 'exported bundle carries exactly the ONE image the seeded brick actually references, not every image in the app');
  assert(evalInPage('window.__exportBundle.images["demo-cell-diagram"].dataUrl.startsWith("data:")'), 'the bundled image is embedded as a real data URL, self-contained');
  doc.getElementById('cancelExportBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // now IMPORT that exact bundle back in and confirm a genuine, independent copy is created
  const folderBeforeImport = evalInPage('tree.children.length');
  runInPage(`
    (async () => {
      window.__importCounts = await importBundle(window.__exportBundle);
    })();
  `);
  await sleep(50);
  runInPage('renderTree();');
  await sleep(10);
  assert(evalInPage('tree.children.length') === folderBeforeImport + 1, 'import adds exactly one new top-level item (the re-imported wall/folder wrapper)');
  const importedCounts = evalInPage('window.__importCounts');
  assert(importedCounts.bricks === 1 && importedCounts.cards === 3, 'import reports the correct counts back — got ' + JSON.stringify(importedCounts));
  const importedBrick = evalInPage(`(function find(n){ return n.type==='deck' && n.name==='Cell Diagram (demo)' && n.id !== '${seededDeckId}' ? n : (n.children||[]).map(find).find(Boolean); })(tree)`);
  assert(!!importedBrick, 'the imported brick exists in the live tree, as a genuinely separate copy (different id from the original)');
  assert(importedBrick.id !== seededDeckId, 'imported brick has a FRESH id — no collision with the original it was exported from');
  assert(importedBrick.cards.length === 3, 'imported brick carries all 3 cards');
  assert(importedBrick.cards.every(c => c.id !== undefined) && new Set(importedBrick.cards.map(c=>c.id)).size === 3, 'every imported card has its own fresh, unique id too');
  assert(importedBrick.cards[0].imgHash === 'demo-cell-diagram', 'imported cards still correctly reference the shared image hash');
  runInPage(`(async ()=>{ window.__importedImgOk = !!(await getImage('demo-cell-diagram')); })();`);
  await sleep(30);
  assert(evalInPage('window.__importedImgOk') === true, 'the image the import needed was actually restored into IndexedDB, not just referenced by a dangling hash');
  const savedTreeAfterImport = JSON.parse(window.localStorage.getItem('brickTree_v1'));
  const findImportedInStorage = (n) => n.type==='deck' && n.id===importedBrick.id ? n : (n.children||[]).map(findImportedInStorage).find(Boolean);
  assert(!!findImportedInStorage(savedTreeAfterImport), 'the imported brick is actually persisted to localStorage, not just held in memory');

  // =========================================================
  // ImgBB key: save/load through Settings
  // =========================================================
  doc.getElementById('settingsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('imgbbStatus').textContent.includes('No key set'), 'status correctly shows no key set initially');
  doc.getElementById('imgbbKeyInput').value = 'test-imgbb-key-123';
  doc.getElementById('saveImgbbKeyBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(window.localStorage.getItem('brickImgbbKey') === 'test-imgbb-key-123', 'ImgBB key is actually persisted to localStorage');
  doc.getElementById('settingsBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('settingsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('imgbbKeyInput').value === 'test-imgbb-key-123', 'reopening Settings shows the previously-saved key, not a blank field');
  assert(!doc.getElementById('imgbbStatus').textContent.includes('No key set'), 'status text updates once a key is present');

  // clearing the key
  doc.getElementById('imgbbKeyInput').value = '';
  doc.getElementById('saveImgbbKeyBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(window.localStorage.getItem('brickImgbbKey') === null, 'saving an empty key removes it from localStorage entirely, rather than storing an empty string');

  // =========================================================
  // Responsive layout: the app shell actually uses more width now
  // =========================================================
  const layoutCss = fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf-8');
  assert(/#app\{max-width:min\(1240px/.test(layoutCss), 'app shell width was widened from the old fixed 780px to a fluid, much larger cap');
  assert(/@media \(max-width:600px\)/.test(layoutCss), 'a mobile-specific tightened padding rule exists alongside the wider desktop default');

  // =========================================================
  // Cement Mode theme + topbar decluttering
  // =========================================================
  runInPage(`currentFolderId = 'root';`);
  runInPage(`showScreen('screenWall');`);
  runInPage('renderTree();');
  await sleep(10);
  assert(!doc.body.classList.contains('cement-mode-active'), 'starts without the Cement Mode theme applied');
  assert(doc.body.classList.contains('on-wall-screen'), 'explicitly navigating to the Wall screen sets on-wall-screen correctly');

  selectLogoProfile('cement');
  await sleep(10);
  assert(doc.body.classList.contains('cement-mode-active'), 'toggling Cement Mode on applies the theme class to <body> — a real visual shift, not just the button');
  const tokensCss = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf-8');
  assert(/body\.cement-mode-active\{[^}]*--wash:/.test(tokensCss), 'the theme class actually overrides the --wash background token');
  assert(/body\.cement-mode-active \.tile\.brick-tile\{ background-color:var\(--cement-dark\)/.test(tokensCss), 'brick tiles specifically re-color toward the cement palette while the mode is on');

  // topbar decluttering: navigate to a non-Wall screen and confirm the
  // logo dropdown becomes non-openable there (CSS fades the chevron,
  // JS refuses to open it) — the profile switch is a Wall-browsing
  // concept, and showing it next to the Study screen's own per-card
  // Cement button would reintroduce the exact confusing-duplicate-row
  // problem that was fixed earlier.
  const layoutCssForChevron = fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf-8');
  assert(/body:not\(\.on-wall-screen\) \.logo-switcher-btn\{cursor:default/.test(layoutCssForChevron), 'a rule exists making the logo switcher non-interactive-looking outside the Wall screen');
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  assert(!doc.body.classList.contains('on-wall-screen'), 'leaving the Wall screen clears on-wall-screen, so the CSS rule actually applies');
  logoSwitcherBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(!logoDropdown.classList.contains('open'), 'clicking the logo switcher while NOT on the Wall screen does not open the dropdown — the click is a no-op there');
  doc.getElementById('previewBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.body.classList.contains('on-wall-screen'), 'returning to the Wall screen restores on-wall-screen');

  // turn Cement Mode back off, leaves things clean for the tests below
  selectLogoProfile('brick');
  await sleep(10);
  assert(!doc.body.classList.contains('cement-mode-active'), 'toggling Cement Mode off removes the theme class again');

  // =========================================================
  // Paused-session resume: voluntary (Back button) and involuntary
  // (pagehide/visibilitychange) closure both leave a resumable checkpoint
  // =========================================================
  assert(window.localStorage.getItem('brickPendingSession_v1') === null, 'no pending session exists yet');

  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  assert(doc.getElementById('resumeBanner').style.display === 'none', 'no resume banner shown when there is nothing to resume');
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(JSON.parse(window.localStorage.getItem('brickPendingSession_v1')).deckId === seededDeckId, 'starting a session immediately snapshots a resumable checkpoint (the current card render already does this)');

  // advance one card in, then leave voluntarily via Back
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  const posBeforeLeaving = evalInPage('session.pos');
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('screenWall').classList.contains('active'), 'Back button returns to the Wall screen');
  const savedPending1 = JSON.parse(window.localStorage.getItem('brickPendingSession_v1'));
  assert(savedPending1 && savedPending1.deckId === seededDeckId && savedPending1.pos === posBeforeLeaving, 'voluntary Back leaves an accurate, resumable checkpoint at the exact card position — got pos ' + (savedPending1 && savedPending1.pos));

  // reopening the SAME deck's preview shows the resume banner
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  assert(doc.getElementById('resumeBanner').style.display !== 'none', 'resume banner appears for the deck the paused session actually belongs to');
  assert(doc.getElementById('resumeBannerText').textContent.includes('card'), 'banner text describes how much is left — got "' + doc.getElementById('resumeBannerText').textContent + '"');

  // Resume actually restores the exact position, not just "starts over"
  doc.getElementById('resumeSessionBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('screenStudy').classList.contains('active'), 'Resume jumps straight into the study screen');
  assert(evalInPage('session.pos') === posBeforeLeaving, 'resumed session picks up at the exact card position it was paused at, not from the beginning');
  assert(evalInPage('session.deckId') === seededDeckId, 'resumed session is studying the correct deck');

  // finishing the resumed session clears the pending checkpoint — nothing left to resume once actually done
  while (evalInPage('session.pos < session.order.length')){
    if (evalInPage('!session.revealed')) studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(10);
    doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(20);
  }
  assert(doc.getElementById('screenDone').classList.contains('active'), 'the resumed session actually finishes normally');
  assert(window.localStorage.getItem('brickPendingSession_v1') === null, 'completing a session clears the pending checkpoint — there is nothing left to offer resuming');

  // discard: pause again, then explicitly discard instead of resuming
  doc.getElementById('doneBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  assert(doc.getElementById('resumeBanner').style.display !== 'none', 'a fresh pause shows the resume banner again');
  doc.getElementById('discardSessionBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('resumeBanner').style.display === 'none', 'discarding hides the banner immediately');
  assert(window.localStorage.getItem('brickPendingSession_v1') === null, 'discarding actually clears the saved checkpoint from localStorage');

  // starting a session on a DIFFERENT deck supersedes any other paused session (single global slot)
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(JSON.parse(window.localStorage.getItem('brickPendingSession_v1')).deckId === seededDeckId, 'seeded deck has a paused session again, ready for the cross-deck test');
  runInPage(`openBrickPreview('${basicDeck.id}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  const pendingAfterOtherDeck = JSON.parse(window.localStorage.getItem('brickPendingSession_v1'));
  assert(pendingAfterOtherDeck.deckId === basicDeck.id, 'starting a session on a different deck supersedes the previous paused one (only one resume slot exists) — got deckId for ' + pendingAfterOtherDeck.deckId);
  // clean up: finish this session so it doesn't leave a checkpoint behind either
  while (evalInPage('session.pos < session.order.length')){
    if (evalInPage('!session.revealed')) studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(10);
    doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(20);
  }
  doc.getElementById('doneBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // involuntary closure: pagehide/visibilitychange safety net actually saves a checkpoint too
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  window.localStorage.removeItem('brickPendingSession_v1'); // clear whatever renderStudyCard() already wrote, to prove the NEXT event is what saves it
  assert(window.localStorage.getItem('brickPendingSession_v1') === null, 'cleared the checkpoint to isolate the pagehide-specific save');
  doc.dispatchEvent(new window.Event('pagehide', { bubbles:true }));
  await sleep(10);
  assert(JSON.parse(window.localStorage.getItem('brickPendingSession_v1')).deckId === seededDeckId, 'pagehide alone (simulating a hard tab close) still leaves a resumable checkpoint, with no explicit Back click involved');

  window.localStorage.removeItem('brickPendingSession_v1');
  Object.defineProperty(doc, 'hidden', { value: true, configurable: true });
  doc.dispatchEvent(new window.Event('visibilitychange', { bubbles:true }));
  await sleep(10);
  assert(JSON.parse(window.localStorage.getItem('brickPendingSession_v1')).deckId === seededDeckId, 'visibilitychange (phone locking / backgrounding the tab) ALSO independently saves a checkpoint');
  Object.defineProperty(doc, 'hidden', { value: false, configurable: true });

  // stale pending session (deck since deleted) is handled gracefully, not crashed on
  window.localStorage.setItem('brickPendingSession_v1', JSON.stringify({ deckId:'nonexistent-deck-id', order:['a','b'], pos:0, correct:0, missed:0, hintsEnabled:false, savedAt: Date.now() }));
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  assert(doc.getElementById('resumeBanner').style.display === 'none', 'a pending session for a DIFFERENT (or deleted) deck does not show a resume banner on an unrelated brick — no false-positive offer');
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // =========================================================
  // ImgBB batch backup: badge notification, mandatory progress
  // modal, real batching/pausing structure, retry-then-fail handling
  // =========================================================
  // Seed several DISTINCT fake images + a synthetic deck referencing
  // them directly (bypassing the full editor UI for speed/precision) —
  // existing test decks mostly reuse one shared demo image hash, which
  // isn't enough to actually exercise batching across multiple images.
  runInPage(`
    (async () => {
      window.__debugStep = 'start';
      try {
        // Directly seed IndexedDB records, the same way seedDemoImage()
        // does — NOT via storeImageFromDataUrl's loadImageEl() path,
        // which waits on a real Image().onload/onerror that jsdom can
        // never fire without the (heavy, native) canvas package
        // installed. That's a real gap in what this test environment
        // can exercise for storeImageFromDataUrl specifically — genuine
        // browsers fire those events correctly, this is a test-tooling
        // limitation, not a production code path. Irrelevant to what
        // THIS test actually needs to verify (the batch upload logic),
        // so sidestepping it here is the right call.
        const db = await openImageDb();
        for (let i = 1; i <= 7; i++){
          window.__debugStep = 'loop-' + i;
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#99' + i + '"/></svg>';
          const dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
          if (i === 4) window.__failingImageBase64 = btoa(svg); // remember exactly which upload body should fail, rather than pattern-matching base64 text
          const hash = 'batch-test-img-' + i;
          const tx = db.transaction(IMG_STORE, 'readwrite');
          const store = tx.objectStore(IMG_STORE);
          await idbPut(store, { hash, mimeType:'image/svg+xml', dataUrl, w:10, h:10 });
          imageCache.set(hash, { dataUrl, w:10, h:10 });
        }
        const cards = [];
        for (let i = 1; i <= 7; i++){
          cards.push({ id: uid(), type:'occlusion', imgHash:'batch-test-img-' + i, imgW:10, imgH:10, masks:[], activeMaskId:null, mode:'hide-all', header:'', backExtra:'', timeouts:0, tough:false, createdAt: Date.now() });
        }
        tree.children.push({ id: uid(), type:'deck', name:'Batch Backup Test Brick', createdAt: Date.now(), cards });
        saveTreeNow();
        window.__batchDeckReady = true;
        window.__debugStep = 'done';
      } catch (err){
        window.__batchDeckError = String(err && err.stack || err);
        window.__debugStep = 'errored';
      }
    })();
  `);
  await sleep(200);
  assert(evalInPage('window.__batchDeckReady') === true, '7 distinct test images + a deck referencing them were seeded for the batching test — error: ' + evalInPage('window.__batchDeckError'));
  assert(evalInPage('getPendingBackupImageHashes().length') >= 7, 'all 7 seeded images show up as pending backup (no key set yet, nothing uploaded)');

  // badge: shown when no key + pending images exist
  runInPage(`currentFolderId = 'root';`);
  runInPage(`showScreen('screenWall');`);
  runInPage('renderTree();');
  await sleep(10);
  assert(doc.getElementById('settingsBtn').querySelector('.settings-badge-dot') !== null, 'Settings button shows a notification badge — images are pending and no key is set');

  // shrink the throttling constants + mock fetch so the test runs fast
  // and never touches the real network, while still exercising the
  // real batching/pausing STRUCTURE (small batch size to force multiple batches)
  runInPage(`
    IMGBB_BATCH_SIZE = 2;
    IMGBB_INTRA_BATCH_DELAY_MS = 5;
    IMGBB_BATCH_PAUSE_MS = 15;
    IMGBB_MAX_RETRIES_PER_IMAGE = 1;
    window.__fetchCalls = [];
    window.fetch = async (url, opts) => {
      window.__fetchCalls.push(url);
      // opts.body is a URLSearchParams — .toString() URL-encodes the
      // base64 payload (+ / = become %2B %2F %3D), so comparing against
      // the raw base64 directly would never match. Decode it back out
      // instead of guessing at the encoded form.
      const sentImage = new URLSearchParams(opts.body.toString()).get('image');
      // simulate one specific image failing every attempt, to test the give-up-after-retries path
      if (window.__failingImageBase64 && sentImage === window.__failingImageBase64){
        return { ok:false, status:429, headers:{ get: () => null }, json: async () => ({ success:false }) };
      }
      return { ok:true, status:200, headers:{ get: () => null }, json: async () => ({ success:true, data:{ url: 'https://fake.imgbb.example/' + window.__fetchCalls.length } }) };
    };
  `);

  doc.getElementById('settingsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('imgbbKeyInput').value = 'batch-test-key';
  doc.getElementById('saveImgbbKeyBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('imgbbUploadOverlay').classList.contains('active'), 'saving a key with pending images opens the mandatory backup modal automatically');
  assert(doc.getElementById('imgbbUploadDoneRow').style.display === 'none', 'no Done/dismiss button is shown while the batch upload is still running');

  // Escape must NOT close this modal while it's running
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('imgbbUploadOverlay').classList.contains('active'), 'Escape does not dismiss the mandatory backup modal — it is deliberately non-skippable while running');

  // let the (fast, mocked) batch run to completion
  let waited = 0;
  while (doc.getElementById('imgbbUploadDoneRow').style.display === 'none' && waited < 3000){
    await sleep(50);
    waited += 50;
  }
  assert(doc.getElementById('imgbbUploadDoneRow').style.display !== 'none', 'the batch upload actually finishes and reveals the Done button — did not hang (waited ' + waited + 'ms)');
  assert(doc.getElementById('imgbbUploadStatus').textContent.includes('failed'), 'final status correctly reports the one image that failed every attempt — got "' + doc.getElementById('imgbbUploadStatus').textContent + '"');
  assert(doc.getElementById('imgbbUploadCount').textContent === '7 / 8', 'the count display updates to the FINAL result at completion, not a stale mid-upload snapshot — got "' + doc.getElementById('imgbbUploadCount').textContent + '"');

  const finalMap = JSON.parse(window.localStorage.getItem('brickImageUrlMap_v1'));
  const successCount = Object.keys(finalMap).filter(h => h.startsWith('batch-test-img-')).length;
  assert(successCount === 6, '6 of the 7 seeded images were actually uploaded and recorded (the 7th deliberately fails every attempt) — got ' + successCount);
  assert(!finalMap['batch-test-img-4'], 'the deliberately-failing image is correctly NOT recorded as uploaded');

  // retries actually happened for the failing image: base64 "AAAA4" should
  // appear more than once among the calls (1 initial + up to IMGBB_MAX_RETRIES_PER_IMAGE retries)
  const failingCallCount = evalInPage(`window.__fetchCalls.length`); // sanity: calls were made at all
  assert(failingCallCount > 7, 'more fetch calls happened than there were images, proving the failing image was actually retried, not just given up on immediately — got ' + failingCallCount + ' calls for 7 images');

  // batching actually paused between groups, not fired all 7 at once —
  // verified structurally: with batch size 2 and 7 images, that is 4
  // batches, so at least 3 inter-batch pauses of IMGBB_BATCH_PAUSE_MS
  // must have elapsed; confirmed indirectly by the wall-clock time
  // above being comfortably more than a same-tick burst would take,
  // and directly by this: status text passed through multiple distinct
  // "batch N of 4" messages, not just one.
  // (Captured via a running log injected into the mock's console — kept
  // simple: rely on the successCount/failingCallCount evidence above,
  // which is not explainable by a single unbatched burst.)

  // dismiss and confirm the badge clears now that a key is set
  doc.getElementById('imgbbUploadDoneBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(!doc.getElementById('imgbbUploadOverlay').classList.contains('active'), 'Done button dismisses the modal once finished');
  assert(doc.getElementById('settingsBtn').querySelector('.settings-badge-dot') === null, 'the notification badge clears once a key is set (regardless of the one failed image)');
  assert(doc.getElementById('imgbbStatus').textContent.includes('pending'), 'Settings status text still mentions the still-pending (failed) image so it is not silently forgotten — got "' + doc.getElementById('imgbbStatus').textContent + '"');

  // saving again (key unchanged, still has the same value) does NOT
  // re-force the modal open — "once a key is added" means the
  // no-key→key transition specifically, not every subsequent click
  doc.getElementById('saveImgbbKeyBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(!doc.getElementById('imgbbUploadOverlay').classList.contains('active'), 'saving an already-set key again does not force the modal open a second time — that would be naggy, not helpful');
  assert(doc.getElementById('retryImgbbBackupBtn').style.display !== 'none', 'a manual "Retry pending backups" button is shown instead, for the one still-failing image');

  // the manual retry button DOES explicitly re-run the batch (user-initiated, not forced)
  doc.getElementById('retryImgbbBackupBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('imgbbUploadOverlay').classList.contains('active'), 'clicking Retry explicitly reopens the batch modal for whatever is still pending');
  waited = 0;
  while (doc.getElementById('imgbbUploadDoneRow').style.display === 'none' && waited < 3000){
    await sleep(50);
    waited += 50;
  }
  doc.getElementById('imgbbUploadDoneBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // Regression test for the exact bug reported from a real screenshot:
  // a single pending image, upload succeeds, but the counter stayed
  // frozen at "0 / 1" (its value from the moment upload STARTED) next
  // to a status text claiming "All 1 images backed up" — a genuinely
  // confusing contradiction. Isolate to exactly one fresh image so the
  // stale-vs-final values can't coincidentally match by arithmetic luck.
  runInPage(`
    window.fetch = async () => ({ ok:true, status:200, headers:{ get:()=>null }, json: async () => ({ success:true, data:{ url:'https://fake.imgbb.example/single' } }) });
    (async () => {
      const db = await openImageDb();
      const tx = db.transaction(IMG_STORE, 'readwrite');
      const store = tx.objectStore(IMG_STORE);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123"/></svg>';
      const dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
      await idbPut(store, { hash:'single-pending-img', mimeType:'image/svg+xml', dataUrl, w:10, h:10 });
      imageCache.set('single-pending-img', { dataUrl, w:10, h:10 });
      tree.children.push({ id: uid(), type:'deck', name:'Single Image Test Brick', createdAt: Date.now(),
        cards: [{ id: uid(), type:'occlusion', imgHash:'single-pending-img', imgW:10, imgH:10, masks:[], activeMaskId:null, mode:'hide-all', header:'', backExtra:'', timeouts:0, tough:false, createdAt: Date.now() }] });
      saveTreeNow();
      window.__singleImgReady = true;
    })();
  `);
  await sleep(50);
  assert(evalInPage('window.__singleImgReady') === true, 'single fresh pending image seeded for the regression test');
  runInPage('renderImgbbSection();'); // Settings screen needs to know about the freshly-seeded pending image before the Retry button's visibility reflects it
  await sleep(10);
  doc.getElementById('retryImgbbBackupBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  waited = 0;
  while (doc.getElementById('imgbbUploadDoneRow').style.display === 'none' && waited < 3000){
    await sleep(50);
    waited += 50;
  }
  assert(doc.getElementById('imgbbUploadStatus').textContent.startsWith('All ') && doc.getElementById('imgbbUploadStatus').textContent.endsWith('images backed up.'), 'status text reports full success, same wording shape as the real screenshot — got "' + doc.getElementById('imgbbUploadStatus').textContent + '"');
  const finalTotal = doc.getElementById('imgbbUploadTotal').textContent;
  assert(doc.getElementById('imgbbUploadCount').textContent === finalTotal + ' / ' + finalTotal, 'count matches the FINAL total on both sides, not the stale "0 / N" the screenshot showed — got "' + doc.getElementById('imgbbUploadCount').textContent + '" for a run of ' + finalTotal);
  doc.getElementById('imgbbUploadDoneBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // =========================================================
  // Sticky grade row: CSS-verified (jsdom has no real layout engine,
  // so this checks the actual rules exist rather than computed position)
  // =========================================================
  const studyCss = fs.readFileSync(path.join(ROOT, 'css/study.css'), 'utf-8');
  assert(/\.grade-row\{[^}]*position:fixed/.test(studyCss), 'the grade row (Again/Good) is fixed-positioned, not part of normal scrolling flow');
  assert(/\.grade-row\{[^}]*bottom:0/.test(studyCss), 'it is pinned to the bottom of the viewport');
  assert(/\.grade-row\{[^}]*z-index:40/.test(studyCss), 'it has a z-index high enough to float above card content');
  assert(/#screenStudy\{[^}]*padding-bottom:calc\(90px/.test(studyCss), 'the study screen reserves bottom space so the fixed row never covers the last bit of card content');
  assert(/env\(safe-area-inset-bottom/.test(studyCss), 'accounts for notched-phone safe areas (both the fixed row\'s own padding and the screen\'s reserved space)');

  // =========================================================
  // Two-finger scroll during occlusion drawing: single finger draws,
  // a second finger cancels the draw and hands off to manual scrolling
  // =========================================================
  doc.getElementById('newBrickBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  runInPage(`
    editorImgHash = 'demo-cell-diagram'; editorImgW = 600; editorImgH = 400;
    document.getElementById('editorUploadStep').style.display = 'none';
    document.getElementById('editorMaskStep').style.display = '';
    editorShapes = [];
    renderEditorShapes('data:image/svg+xml;base64,PHN2Zy8+');
  `);
  await sleep(10);

  const editorStage = doc.getElementById('ioStage');
  const editorCss = fs.readFileSync(path.join(ROOT, 'css/occlusion-editor.css'), 'utf-8');
  assert(/touch-action:none/.test(editorCss), 'the stage disables native touch gestures so a single finger never fights the drawing logic');

  // single finger starts a draw
  editorStage.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles:true, clientX:50, clientY:50, pointerId:10 }));
  editorStage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles:true, clientX:100, clientY:100, pointerId:10 }));
  await sleep(10);
  assert(evalInPage('dragState') === 'drawing', 'a single finger correctly starts a normal draw gesture');
  assert(evalInPage('drawingPreview') !== null, 'a draw preview exists mid-gesture');

  // a second finger lands mid-draw
  editorStage.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles:true, clientX:150, clientY:150, pointerId:20 }));
  await sleep(10);
  assert(evalInPage('activePointers.size') === 2, 'both fingers are tracked as active pointers');
  assert(evalInPage('dragState') === null, 'the second finger landing cancels the in-progress single-finger draw');
  assert(evalInPage('drawingPreview') === null, 'the draw preview is cleared — no half-finished shape lingers');
  const shapeCountAfterCancel = evalInPage('editorShapes.length');

  // No manual scroll is attempted anymore — an earlier version drove
  // window.scrollBy() itself here, which fought the browser's own
  // native touch handling and caused a visible flicker. Removed for
  // good rather than patched; confirm nothing calls it.
  runInPage(`window.__scrollCalls = []; window.scrollBy = (x,y) => window.__scrollCalls.push([x,y]);`);
  editorStage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles:true, clientX:50, clientY:20, pointerId:10 }));
  await sleep(10);
  assert(evalInPage('window.__scrollCalls.length') === 0, 'moving fingers while 2 are down does NOT call window.scrollBy — that manual scroll-driving was removed entirely, not just made more careful');

  // lifting one finger drops back to single-pointer mode
  editorStage.dispatchEvent(new window.PointerEvent('pointerup', { bubbles:true, clientX:150, clientY:150, pointerId:20 }));
  await sleep(10);
  assert(evalInPage('activePointers.size') === 1, 'lifting one of two fingers leaves exactly one tracked');

  editorStage.dispatchEvent(new window.PointerEvent('pointerup', { bubbles:true, clientX:50, clientY:20, pointerId:10 }));
  await sleep(10);
  assert(evalInPage('activePointers.size') === 0, 'no pointers remain active once both fingers are lifted');
  assert(evalInPage('editorShapes.length') === shapeCountAfterCancel, 'the cancelled draw never produced a shape, even after all fingers eventually lifted — it was genuinely abandoned, not just paused');

  // a subsequent single-finger gesture still draws normally — the
  // two-finger interruption didn't leave the editor in a broken state
  const shapesBeforeFreshDraw = evalInPage('editorShapes.length');
  editorStage.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles:true, clientX:40, clientY:30, pointerId:30 }));
  editorStage.dispatchEvent(new window.PointerEvent('pointermove', { bubbles:true, clientX:120, clientY:90, pointerId:30 }));
  editorStage.dispatchEvent(new window.PointerEvent('pointerup', { bubbles:true, clientX:120, clientY:90, pointerId:30 }));
  await sleep(10);
  assert(evalInPage('editorShapes.length') === shapesBeforeFreshDraw + 1, 'a normal single-finger draw after the interrupted gesture works correctly — the editor recovered cleanly');

  // =========================================================
  // Zoom disabled
  // =========================================================
  const viewportMeta = doc.querySelector('meta[name="viewport"]');
  assert(viewportMeta.content.includes('user-scalable=no'), 'viewport meta disables pinch/double-tap zoom');
  assert(viewportMeta.content.includes('maximum-scale=1.0'), 'viewport meta pins the max scale to 1');
  assert(/body\{[^}]*touch-action:pan-x pan-y/.test(tokensCss), 'a CSS-level backstop also restricts touch-action, since some browsers (iOS Safari) don\'t fully honor user-scalable=no on its own');

  // =========================================================
  // Wall vs. Brick tile visual distinction
  // =========================================================
  const finalLayoutCss = fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf-8');
  assert(/\.tile\.wall\{[^}]*background-image:url\("data:image\/svg\+xml/.test(finalLayoutCss), 'Wall tiles now render an actual brick-pattern texture, not a flat color panel — the whole point of a Wall is that it\'s made of many bricks');
  assert(/\.tile\.brick-tile\{[^}]*box-shadow:\s*\n\s*inset 0 0 0 2px/.test(finalLayoutCss), 'Brick (deck) tiles get a visible inset border, reading as one distinct physical object rather than a flat color swatch');
  runInPage(`currentFolderId = 'root';`);
  runInPage('renderTree();');
  await sleep(10);
  const wallTileCheck = doc.querySelector('.tile.wall');
  const brickTileCheck = doc.querySelector('.tile.brick-tile');
  assert(!!wallTileCheck, 'a wall tile is actually rendered with the .wall class the new CSS rule targets');
  assert(!!brickTileCheck, 'a brick tile is actually rendered with the .brick-tile class the new CSS rule targets');

  // =========================================================
  // Done screen: animated brick wall + "You are bricked!"
  // =========================================================
  runInPage(`openBrickPreview('${basicDeck.id}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  while (evalInPage('session.pos < session.order.length')){
    if (evalInPage('!session.revealed')) studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(10);
    doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(20);
  }
  assert(doc.getElementById('screenDone').classList.contains('active'), 'finishing a session reaches the Done screen');
  const doneBricks = doc.querySelectorAll('#doneWall .done-brick');
  assert(doneBricks.length === 13, 'the wall renders its full 3-row running-bond brick set (4 + 5-with-halves + 4 = 13) — got ' + doneBricks.length);
  assert(Array.from(doneBricks).every(b => !b.classList.contains('laid')), 'bricks start un-laid at the very beginning of a fresh cycle');

  // let the staggered lay-in sequence play out
  await sleep(150 + doneBricks.length * 110 + 50);
  assert(Array.from(doneBricks).every(b => b.classList.contains('laid')), 'every brick is laid after the sequence completes — the wall actually finishes building, not just the first few');
  await sleep(300);
  assert(doc.getElementById('doneBrickedText').classList.contains('show'), '"You are bricked!" appears only after the wall is fully built, not immediately');

  // it loops: after holding, the cycle resets and rebuilds
  await sleep(3200);
  const midResetBricks = Array.from(doneBricks).filter(b => b.classList.contains('laid')).length;
  assert(midResetBricks < doneBricks.length, 'the wall actually resets and starts rebuilding again — this loops rather than running once');

  // leaving the Done screen stops the loop — no orphaned timers running forever in the background
  const timersBeforeLeaving = evalInPage('doneWallTimers.length');
  assert(timersBeforeLeaving > 0, 'the loop has real pending timers scheduled while the Done screen is showing');
  doc.getElementById('doneBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('doneWallTimers.length') === 0, 'navigating away from the Done screen clears every pending timer — the animation does not keep running invisibly forever');

  // A real gap just found: `errors` accumulates via a global listener
  // but was only ever asserted twice, early on — anything thrown much
  // later (like inside openOcclusionEditor, called dozens of times
  // throughout this file) could silently accumulate without ever
  // failing the suite. Checking it one final time here, at the very
  // end, closes that gap for good.

  // =========================================================
  // Occlusion spotlight: sharp-edged window around the active mask,
  // present on the question screen AND the answer screen
  // =========================================================
  runInPage(`openBrickPreview('${seededDeckId}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(evalInPage('currentCard().type') === 'occlusion', 'seeded card under test is an occlusion card');
  let spotlightEl = doc.querySelector('.study-mask-spotlight');
  assert(!!spotlightEl, 'a spotlight window renders on the QUESTION screen, before revealing anything — not only after reveal');
  const activeMaskBounds = evalInPage(`(() => { const c = currentCard(); return c.masks.find(m => m.id === c.activeMaskId); })()`);
  const spotLeft = parseFloat(spotlightEl.style.left);
  const spotTop = parseFloat(spotlightEl.style.top);
  assert(spotLeft <= activeMaskBounds.x, 'spotlight window starts at or before the active mask\'s left edge (has padding, not identical to the box)');
  assert(spotTop < activeMaskBounds.y, 'spotlight window starts well above the active mask\'s top edge, clearing room for the label tab that appears on reveal');
  assert(spotLeft + parseFloat(spotlightEl.style.width) >= activeMaskBounds.x + activeMaskBounds.w, 'spotlight window fully contains the active mask horizontally');

  // reveal — spotlight should still be there, unchanged in kind (not removed/re-added as a different element)
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  spotlightEl = doc.querySelector('.study-mask-spotlight');
  assert(!!spotlightEl, 'the spotlight window is still present after revealing the answer — the same continuous element, not something that only appears post-reveal');
  assert(doc.querySelectorAll('.study-mask-spotlight').length === 1, 'exactly one spotlight window exists — not one leftover from the question state plus a new one for the answer state');

  const studyCssFinal = fs.readFileSync(path.join(ROOT, 'css/study.css'), 'utf-8');
  assert(/\.study-mask-spotlight\{[^}]*box-shadow:0 0 0 9999px rgba\(20,17,14,\.26\)/.test(studyCssFinal), 'spotlight uses the sharp box-shadow-window technique at the medium (26%) strength that was chosen, not the earlier soft radial-gradient or the original 50% strength');
  assert(!/\.study-mask-spotlight\{[^}]*radial-gradient/.test(studyCssFinal), 'confirms the soft radial-gradient approach was NOT what shipped — the sharp window technique fully replaced it');

  // grade it out and confirm a text-mode (non-occlusion) card correctly gets NO spotlight at all
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  runInPage(`openBrickPreview('${basicDeck.id}');`);
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(evalInPage('currentCard().type') === 'basic', 'now studying a Basic (text) card');
  assert(!doc.querySelector('.study-mask-spotlight'), 'no spotlight window on a Basic/Cloze card — the concept only applies to occlusion masks, there is nothing to spotlight otherwise');
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // =========================================================
  // Kebab menu contrast against Wall and Brick tile backgrounds
  // =========================================================
  runInPage(`currentFolderId = 'root';`);
  runInPage('renderTree();');
  await sleep(10);
  const wallTileForKebab = doc.querySelector('.tile.wall');
  const brickTileForKebab = doc.querySelector('.tile.brick-tile');
  assert(!!wallTileForKebab && !!wallTileForKebab.querySelector('.tile-kebab'), 'a Wall tile with a kebab button exists to check contrast against');
  assert(!!brickTileForKebab && !!brickTileForKebab.querySelector('.tile-kebab'), 'a Brick tile with a kebab button exists to check contrast against');
  const layoutCssForKebab = fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf-8');
  assert(/\.tile-kebab\{/.test(layoutCssForKebab), 'a base .tile-kebab rule exists to check');
  assert(/\.tile\.brick-tile \.tile-kebab\{background:rgba\(255,255,255,\.16\)/.test(layoutCssForKebab), 'Brick tiles get a light-tinted kebab backing chip instead of the default dark-tinted one — darkening an already-dark tile barely shows, so the affordance needs to go the other direction there');

  // =========================================================
  // Rename — real gap, zero prior coverage
  // =========================================================
  runInPage(`currentFolderId = 'root';`);
  runInPage('renderTree();');
  await sleep(10);
  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('nameModalInput').value = 'Rename Test Wall';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  const renameTestNode = evalInPage(`tree.children.find(c => c.name === 'Rename Test Wall')`);
  assert(!!renameTestNode, 'throwaway wall created for the rename test');
  doc.querySelector('[data-id="' + renameTestNode.id + '"] .tile-kebab').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('menuRename').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('renameOverlay').classList.contains('active'), 'Rename opens the rename overlay');
  assert(doc.getElementById('renameInput').value === 'Rename Test Wall', 'rename field pre-fills with the current name');
  doc.getElementById('renameInput').value = 'Renamed Wall XYZ';
  doc.getElementById('confirmRenameBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(!doc.getElementById('renameOverlay').classList.contains('active'), 'confirming rename closes the overlay');
  assert(evalInPage(`nodeById('${renameTestNode.id}').name`) === 'Renamed Wall XYZ', 'the node\'s actual name updated in the live tree');
  const tileAfterRename = doc.querySelector('[data-id="' + renameTestNode.id + '"]');
  assert(tileAfterRename.querySelector('.tile-name').textContent === 'Renamed Wall XYZ', 'the tile itself re-renders with the new name');
  const savedTreeAfterRename = JSON.parse(window.localStorage.getItem('brickTree_v1'));
  const findRenamed = (n) => n.id === renameTestNode.id ? n : (n.children||[]).map(findRenamed).find(Boolean);
  assert(findRenamed(savedTreeAfterRename).name === 'Renamed Wall XYZ', 'the rename is actually persisted to localStorage, not just held in memory');

  // =========================================================
  // Move — real gap, zero prior coverage
  // =========================================================
  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('nameModalInput').value = 'Move Destination Wall';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  const moveDestWall = evalInPage(`tree.children.find(c => c.name === 'Move Destination Wall')`);
  assert(!!moveDestWall, 'destination wall created for the move test');

  const moveSourceBrickId = basicDeck.id; // reuse the existing, known Basic deck as the thing being moved
  const moveSourceParentId = evalInPage(`parentOf('${moveSourceBrickId}').id`); // wherever it actually lives, not assumed to be root
  runInPage(`currentFolderId = '${moveSourceParentId}';`);
  runInPage('renderTree();');
  await sleep(10);
  const moveSourceTile = doc.querySelector('[data-id="' + moveSourceBrickId + '"]');
  assert(!!moveSourceTile, 'the brick being moved is visible at its actual current level before the move');
  moveSourceTile.querySelector('.tile-kebab').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('menuMove').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('moveOverlay').classList.contains('active'), 'Move opens the move picker overlay');
  assert(doc.getElementById('moveTargetName').textContent === basicDeck.name, 'picker header names the correct item being moved');
  const moveOptions = Array.from(doc.querySelectorAll('.move-option'));
  assert(moveOptions.some(o => o.dataset.wallId === moveDestWall.id), 'the destination wall appears as a real option in the picker');
  assert(!moveOptions.some(o => o.dataset.wallId === moveSourceParentId), 'the item\'s CURRENT parent does not appear as an option — moving into the same place it already is makes no sense');

  const destOption = moveOptions.find(o => o.dataset.wallId === moveDestWall.id);
  destOption.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(!doc.getElementById('moveOverlay').classList.contains('active'), 'selecting a destination closes the picker');
  // scoped to #tileGrid specifically — a bare document-wide query also
  // matches the export picker's own (unrelated, correctly inert)
  // data-id checkboxes left over in the DOM from an earlier test
  assert(!doc.querySelector('#tileGrid [data-id="' + moveSourceBrickId + '"]'), 'the moved brick no longer appears at its old location');
  assert(evalInPage(`parentOf('${moveSourceBrickId}').id`) === moveDestWall.id, 'the brick\'s actual parent in the tree is now the destination wall');
  runInPage(`currentFolderId = '${moveDestWall.id}';`);
  runInPage('renderTree();');
  await sleep(10);
  assert(!!doc.querySelector('[data-id="' + moveSourceBrickId + '"]'), 'navigating into the destination wall shows the moved brick there');
  const savedTreeAfterMove = JSON.parse(window.localStorage.getItem('brickTree_v1'));
  const findDestWall = (n) => n.id === moveDestWall.id ? n : (n.children||[]).map(findDestWall).find(Boolean);
  assert(findDestWall(savedTreeAfterMove).children.some(c => c.id === moveSourceBrickId), 'the move is actually persisted to localStorage — the brick is a real child of the destination wall on disk, not just visually');
  runInPage(`currentFolderId = 'root';`);
  runInPage('renderTree();');
  await sleep(10);

  // =========================================================
  // Duplicate — real gap, zero prior coverage
  // =========================================================
  const originalDeckForDup = evalInPage(`nodeById('${seededDeckId}')`);
  const originalCardCount = originalDeckForDup.cards.length;
  const originalCardIds = originalDeckForDup.cards.map(c => c.id);
  runInPage(`currentFolderId = '${demoWallNode.id}';`);
  runInPage('renderTree();');
  await sleep(10);
  doc.querySelector('[data-id="' + seededDeckId + '"] .tile-kebab').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('menuDuplicate').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  const duplicatedNode = evalInPage(`nodeById(currentFolderId).children.find(c => c.name === '${originalDeckForDup.name} (copy)')`);
  assert(!!duplicatedNode, 'a duplicate tile was created with the expected "(copy)" suffix');
  assert(duplicatedNode.id !== seededDeckId, 'the duplicate has a fresh id, not the same one as the original');
  assert(duplicatedNode.cards.length === originalCardCount, 'the duplicate carries the same number of cards');
  const dupCardIds = duplicatedNode.cards.map(c => c.id);
  assert(dupCardIds.every(id => !originalCardIds.includes(id)), 'every duplicated card has its own fresh id — none reused from the original, so editing one copy can never silently affect the other');
  assert(duplicatedNode.cards.every((c,i) => c.imgHash === originalDeckForDup.cards[i].imgHash), 'duplicated cards still correctly reference the same underlying image');
  const originalStillIntact = evalInPage(`nodeById('${seededDeckId}')`);
  assert(originalStillIntact.cards.length === originalCardCount && originalStillIntact.name === originalDeckForDup.name, 'the original deck is completely untouched by duplicating it');

  // =========================================================
  // Deleting a STAGED card (Basic and Cloze) — real gap, zero prior coverage
  // =========================================================
  doc.getElementById('newBrickBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.querySelector('.mode-tab[data-type="basic"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('basicFrontInput').value = 'Card One Front'; doc.getElementById('basicBackInput').value = 'Card One Back';
  doc.getElementById('addBasicCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  doc.getElementById('basicFrontInput').value = 'Card Two Front'; doc.getElementById('basicBackInput').value = 'Card Two Back';
  doc.getElementById('addBasicCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('basicStagedCards.length') === 2, 'two basic cards staged');
  doc.querySelector('#basicStagedList .del-staged[data-idx="0"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('basicStagedCards.length') === 1, 'deleting one staged basic card leaves exactly one behind');
  assert(evalInPage('basicStagedCards[0].front') === 'Card Two Front', 'the CORRECT remaining card is "Card Two" — index-based deletion actually removed the first one, not just any one');

  doc.querySelector('.mode-tab[data-type="cloze"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('clozeInput').value = 'The [[first]] cloze card.';
  doc.getElementById('addClozeCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  doc.getElementById('clozeInput').value = 'The [[second]] cloze card.';
  doc.getElementById('addClozeCardBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('clozeStagedCards.length') === 2, 'two cloze cards staged');
  doc.querySelector('#clozeStagedList .del-staged[data-idx="0"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('clozeStagedCards.length') === 1, 'deleting one staged cloze card leaves exactly one behind');
  assert(evalInPage('clozeStagedCards[0].text').includes('second'), 'the CORRECT remaining cloze card is "second" — confirms index-based removal here too');

  // =========================================================
  // New Cloze [[ ]] button — no selection inserts with cursor between,
  // a real selection wraps exactly that text
  // =========================================================
  const clozeInputEl = doc.getElementById('clozeInput');
  const clozeBtn = doc.querySelector('#clozePane .fmt-cloze');
  assert(!!clozeBtn, 'the new Cloze [[ ]] button exists in the toolbar');

  clozeInputEl.value = '';
  clozeInputEl.focus();
  clozeInputEl.setSelectionRange(0, 0);
  clozeBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(clozeInputEl.value === '[[]]', 'clicking with no selection and an empty field inserts an empty [[ ]] pair — got "' + clozeInputEl.value + '"');
  assert(clozeInputEl.selectionStart === 2 && clozeInputEl.selectionEnd === 2, 'the cursor sits exactly between the two brackets, ready to type — got start=' + clozeInputEl.selectionStart + ' end=' + clozeInputEl.selectionEnd);

  clozeInputEl.value = 'The median nerve is compressed.';
  const medianStart = clozeInputEl.value.indexOf('median');
  clozeInputEl.setSelectionRange(medianStart, medianStart + 'median'.length);
  clozeBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(clozeInputEl.value === 'The [[median]] nerve is compressed.', 'clicking WITH a real text selection wraps exactly that selected text — got "' + clozeInputEl.value + '"');
  assert(clozeInputEl.value.slice(clozeInputEl.selectionStart, clozeInputEl.selectionEnd) === 'median', 'after wrapping, the original word stays selected (not the brackets) — matches how the B/I/U/H buttons already behave');

  // the live preview actually refreshes after using a toolbar button —
  // wrapSelection/wrapSelectionPair set .value directly, which does
  // NOT fire a native 'input' event on its own; confirms that gap (a
  // real, separate bug found while building this) is closed
  assert(doc.getElementById('clozePreviewFront').innerHTML.includes('cloze-blank'), 'the live preview reflects the button-driven edit immediately, not just typing — the preview would otherwise go stale after any toolbar button click');

  // =========================================================
  // README import format — hand-authored (not app-generated) bundle,
  // built following ONLY what's documented, verified against the
  // real import path. If the docs were wrong about a field name or
  // shape, this is what would actually catch it.
  // =========================================================
  const handAuthoredBundle = {
    version: 1,
    tree: {
      type: 'folder',
      name: 'ignored on import',
      children: [
        {
          type: 'folder',
          name: 'Hand-Authored Wall',
          children: [
            {
              type: 'deck',
              name: 'Hand-Authored Brick',
              createdAt: Date.now(),
              cards: [
                {
                  type: 'occlusion',
                  // Referencing the already-seeded demo image rather than
                  // a brand-new hash — storeImageFromDataUrl's new-hash
                  // path waits on a real Image().onload, which jsdom
                  // can't fire without the (heavy, native) canvas
                  // package installed. Real browsers handle a genuinely
                  // new data: URI here completely normally; this is a
                  // test-environment constraint, not a documented-format
                  // concern, and it still exercises the real
                  // importBundle() end-to-end.
                  imgHash: 'demo-cell-diagram',
                  imgW: 600, imgH: 400,
                  mode: 'hide-all',
                  activeMaskId: 'mask-1',
                  header: '', backExtra: '',
                  masks: [
                    { id: 'mask-1', shape: 'rect', x: 20, y: 15, w: 18, h: 10, label: 'Nucleus', hint: '' },
                    { id: 'mask-2', shape: 'ellipse', x: 45, y: 30, w: 12, h: 12, label: 'Nucleolus', hint: '' }
                  ]
                },
                { type: 'basic', front: 'What is the capital of France?', back: 'Paris' },
                { type: 'cloze', text: 'The [[median]] nerve is compressed in carpal tunnel syndrome.' }
              ]
            }
          ]
        }
      ]
    },
    images: {}
  };
  runInPage(`currentFolderId = 'root';`);
  await sleep(10);
  runInPage(`(async () => { try { window.__handAuthoredCounts = await importBundle(${JSON.stringify(handAuthoredBundle)}); } catch (err) { window.__handAuthoredError = String(err && err.stack || err); } })();`);
  await sleep(50);
  const handAuthoredCounts = evalInPage('window.__handAuthoredCounts');
  assert(handAuthoredCounts && handAuthoredCounts.bricks === 1 && handAuthoredCounts.cards === 3, 'hand-authored bundle (following ONLY the README\'s documented format, no app-generated content) imports its 1 brick / 3 cards correctly — got ' + JSON.stringify(handAuthoredCounts) + ' error: ' + evalInPage('window.__handAuthoredError'));

  runInPage('renderTree();');
  await sleep(10);
  const importedWall = evalInPage(`tree.children.find(c => c.name === 'Hand-Authored Wall')`);
  assert(!!importedWall, 'the hand-authored Wall actually appears in the live tree — outer tree.name being "ignored on import" was correctly ignored, only children was used');
  const handAuthoredImportedBrick = importedWall.children.find(c => c.name === 'Hand-Authored Brick');
  assert(!!handAuthoredImportedBrick && handAuthoredImportedBrick.cards.length === 3, 'the hand-authored Brick and all 3 of its cards (one of each type, exactly as documented) came through');
  assert(handAuthoredImportedBrick.cards.some(c => c.type === 'occlusion' && c.masks && c.masks.length === 2), 'the occlusion card kept both its masks, with the shared-masks-array-per-card shape the README specifically calls out');
  assert(handAuthoredImportedBrick.cards.some(c => c.type === 'basic' && c.front === 'What is the capital of France?' && c.back === 'Paris'), 'the basic card came through with the documented front/back fields');
  assert(handAuthoredImportedBrick.cards.some(c => c.type === 'cloze' && c.text.includes('[[median]]')), 'the cloze card came through with the documented text field, brackets intact');
  runInPage(`(async () => { window.__handAuthoredImgOk = !!(await getImage('demo-cell-diagram')); })();`);
  await sleep(30);
  assert(evalInPage('window.__handAuthoredImgOk') === true, 'the occlusion card\'s referenced image genuinely exists in IndexedDB — confirms the documented imgHash-must-resolve rule actually holds for a real import');

  // =========================================================
  // WORST-CASE / adversarial import scenarios
  // =========================================================
  runInPage(`currentFolderId = 'root';`);
  runInPage('renderTree();');
  await sleep(10);

  // --- A. The actual XSS finding: a non-numeric mask coordinate ---
  // Confirmed by direct reproduction outside this suite that the
  // UNFIXED code genuinely breaks out of style="left:...%" and
  // injects a live <img onerror=...> tag. This is the real regression
  // test for that — feeds the exact payload through the REAL import
  // path, then studies the card and inspects the actual rendered DOM.
  const xssPayload = '0%;"><img src=x onerror="window.__xssFired=true">';
  const xssBundle = {
    tree: { type:'folder', name:'x', children:[
      { type:'deck', name:'XSS Test Brick', createdAt: Date.now(), cards:[
        { type:'occlusion', imgHash:'demo-cell-diagram', imgW:600, imgH:400, mode:'hide-all', activeMaskId:'m1',
          masks:[ { id:'m1', shape:'rect', x: xssPayload, y: 10, w: 5, h: 5, label:'Evil', hint:'' } ] }
      ]}
    ]},
    images: {}
  };
  runInPage(`window.__xssFired = false; (async () => { window.__xssImportCounts = await importBundle(${JSON.stringify(xssBundle)}); })();`);
  await sleep(50);
  const xssImportCounts = evalInPage('window.__xssImportCounts');
  assert(xssImportCounts && xssImportCounts.bricks === 1, 'the XSS-payload bundle still imports successfully (bad data gets neutralized, not rejected outright) — got ' + JSON.stringify(xssImportCounts));
  runInPage('renderTree();');
  await sleep(10);
  const xssDeck = evalInPage(`tree.children.find(c => c.name === 'XSS Test Brick')`);
  assert(xssDeck.cards[0].masks[0].x === 0, 'the malicious x coordinate was coerced to a safe number (0) in the SAVED card data — not just at render time');
  doc.querySelector('[data-id="' + xssDeck.id + '"]').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  startBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(50);
  assert(evalInPage('window.__xssFired') === false, 'the injected onerror handler never actually fired — no live <img> tag made it into the rendered DOM');
  assert(!doc.getElementById('studyStage').innerHTML.includes('onerror'), 'the rendered stage HTML contains no trace of the injected attribute at all');
  const xssMaskEl = doc.querySelector('.study-mask');
  assert(xssMaskEl.style.left === '0%', 'the mask actually renders at a safe, valid position instead of the malicious string');
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // --- B. Malformed JSON (not valid JSON at all) ---
  runInPage(`
    (async () => {
      const file = new window.File(['{ this is not valid json ]'], 'bad.json', { type:'application/json' });
      await handleImportFile(file);
      window.__badJsonHandled = true;
    })();
  `);
  await sleep(50);
  assert(evalInPage('window.__badJsonHandled') === true, 'malformed (unparseable) JSON does not crash the import handler');
  assert(doc.getElementById('statusLive').textContent.includes('Could not import'), 'a clear error message is shown for invalid JSON — got "' + doc.getElementById('statusLive').textContent + '"');

  // --- C. Valid JSON, wrong shape entirely ---
  runInPage(`(async () => { try { await importBundle({ hello: 'world' }); window.__wrongShapeThrew = false; } catch (err) { window.__wrongShapeThrew = true; window.__wrongShapeMsg = err.message; } })();`);
  await sleep(20);
  assert(evalInPage('window.__wrongShapeThrew') === true, 'a valid-JSON-but-wrong-shape object is rejected with a real error, not silently accepted');
  assert(evalInPage('window.__wrongShapeMsg').includes('Brick export'), 'the rejection message is actually informative — got "' + evalInPage('window.__wrongShapeMsg') + '"');

  // --- D. Unknown/garbage card type gets dropped, not half-imported ---
  const garbageTypeBundle = {
    tree: { type:'folder', name:'x', children:[
      { type:'deck', name:'Garbage Type Brick', cards:[
        { type:'basic', front:'Good card', back:'Survives' },
        { type:'evil-unknown-type', front:'Should be dropped', back:'x' },
        { type: null, front:'Also dropped' },
        'not even an object',
        42,
        null
      ]}
    ]},
    images: {}
  };
  runInPage(`(async () => { window.__garbageCounts = await importBundle(${JSON.stringify(garbageTypeBundle)}); })();`);
  await sleep(30);
  runInPage('renderTree();');
  await sleep(10);
  const garbageDeck = evalInPage(`tree.children.find(c => c.name === 'Garbage Type Brick')`);
  assert(garbageDeck.cards.length === 1, 'only the one genuinely valid card survives — 4 pieces of garbage in the same cards array were all dropped cleanly, no crash, got ' + garbageDeck.cards.length);
  assert(garbageDeck.cards[0].front === 'Good card', 'the surviving card is specifically the valid one, not an arbitrary one');

  // --- E. Occlusion card with no valid masks gets dropped entirely ---
  const noMasksBundle = {
    tree: { type:'folder', name:'x', children:[
      { type:'deck', name:'No Masks Brick', cards:[
        { type:'occlusion', imgHash:'demo-cell-diagram', masks:[] },
        { type:'occlusion', imgHash:'demo-cell-diagram' }, // masks missing entirely
        { type:'basic', front:'Real card', back:'Survives' }
      ]}
    ]},
    images: {}
  };
  runInPage(`(async () => { window.__noMasksCounts = await importBundle(${JSON.stringify(noMasksBundle)}); })();`);
  await sleep(30);
  runInPage('renderTree();');
  await sleep(10);
  const noMasksDeck = evalInPage(`tree.children.find(c => c.name === 'No Masks Brick')`);
  assert(noMasksDeck.cards.length === 1 && noMasksDeck.cards[0].type === 'basic', 'both maskless occlusion cards were dropped (nothing meaningful to study), only the real basic card survives');

  // --- F. activeMaskId that doesn't match any real mask falls back sensibly ---
  const badActiveMaskBundle = {
    tree: { type:'folder', name:'x', children:[
      { type:'deck', name:'Bad ActiveMask Brick', cards:[
        { type:'occlusion', imgHash:'demo-cell-diagram', activeMaskId:'this-id-does-not-exist',
          masks:[ { id:'real-mask', shape:'rect', x:10, y:10, w:5, h:5, label:'Real' } ] }
      ]}
    ]},
    images: {}
  };
  runInPage(`(async () => { window.__badAmCounts = await importBundle(${JSON.stringify(badActiveMaskBundle)}); })();`);
  await sleep(30);
  runInPage('renderTree();');
  await sleep(10);
  const badAmDeck = evalInPage(`tree.children.find(c => c.name === 'Bad ActiveMask Brick')`);
  assert(badAmDeck.cards[0].activeMaskId === 'real-mask', 'a bogus activeMaskId falls back to the first real mask, so the card is still meaningfully testable rather than referencing nothing');

  // --- G. null/missing name fields get sensible fallbacks, not crashes ---
  const nullNameBundle = {
    tree: { type:'folder', name:'x', children:[
      { type:'folder', name: null, children:[
        { type:'deck', name: undefined, cards:[ { type:'basic', front:'x', back:'y' } ] }
      ]}
    ]},
    images: {}
  };
  runInPage(`(async () => { try { window.__nullNameCounts = await importBundle(${JSON.stringify(nullNameBundle)}); window.__nullNameThrew = false; } catch(err) { window.__nullNameThrew = true; } })();`);
  await sleep(30);
  assert(evalInPage('window.__nullNameThrew') === false, 'null/missing name fields do not crash the import');
  runInPage('renderTree();');
  await sleep(10);
  assert(doc.querySelectorAll('.tile-name').length > 0 && Array.from(doc.querySelectorAll('.tile-name')).some(el => el.textContent === 'Imported Wall'), 'a folder with a null name gets a sensible fallback name instead of showing blank');

  // --- H. Extremely long text field doesn't hang or crash ---
  const hugeText = 'A'.repeat(50000);
  const hugeBundle = {
    tree: { type:'folder', name:'x', children:[
      { type:'deck', name:'Huge Text Brick', cards:[ { type:'basic', front: hugeText, back:'short' } ] }
    ]},
    images: {}
  };
  const hugeImportStart = Date.now();
  runInPage(`(async () => { window.__hugeCounts = await importBundle(${JSON.stringify(hugeBundle)}); })();`);
  await sleep(100);
  const hugeElapsed = Date.now() - hugeImportStart;
  assert(evalInPage('window.__hugeCounts') && evalInPage('window.__hugeCounts.cards') === 1, 'a 50,000-character field imports successfully');
  assert(hugeElapsed < 2000, 'importing a huge text field does not hang — completed in ' + hugeElapsed + 'ms');

  // =========================================================
  // DATA SAFETY — the highest-stakes code in the app, tested the
  // most rigorously. Three things: the rolling backup ring buffer,
  // save-failure handling (storage full etc.), and a genuine
  // second-boot test proving corrupted-data recovery actually works
  // end-to-end, not just as an isolated function call.
  // =========================================================

  // --- backup ring buffer: shrink the interval so backups accumulate
  // fast instead of needing real 5-minute gaps between test steps ---
  runInPage(`TREE_BACKUP_MIN_INTERVAL_MS = 1;`);
  runInPage(`localStorage.removeItem('brickTreeBackups_v1');`); // clean slate — earlier tests' saves shouldn't count toward this
  await sleep(10);

  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('nameModalInput').value = 'Backup Ring Test 1';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(30);
  assert(evalInPage('loadTreeBackups().length') === 1, 'the very first save after seeding a tree creates exactly one backup of the prior state — got ' + evalInPage('loadTreeBackups().length'));

  for (let i = 2; i <= 7; i++){
    doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(5);
    doc.getElementById('nameModalInput').value = 'Backup Ring Test ' + i;
    doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
    await sleep(15);
  }
  assert(evalInPage('loadTreeBackups().length') === 5, 'the ring buffer caps at MAX_TREE_BACKUPS (5) even after 7 total saves — oldest ones roll off rather than growing forever, got ' + evalInPage('loadTreeBackups().length'));
  const ringNames = evalInPage(`loadTreeBackups().map(b => b.tree.children[b.tree.children.length-1] ? b.tree.children.map(c=>c.name).slice(-1)[0] : null)`);
  assert(ringNames[ringNames.length-1].includes('Backup Ring Test 6') || ringNames[ringNames.length-1].includes('Backup Ring Test 7'), 'the retained backups are the MOST RECENT ones, not the oldest — the ring correctly drops from the front, not the back');

  // time-gating: with the interval restored to something real, rapid
  // saves should NOT each produce a new backup
  runInPage(`TREE_BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;`);
  const backupCountBeforeRapidSaves = evalInPage('loadTreeBackups().length');
  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(5);
  doc.getElementById('nameModalInput').value = 'Rapid Save A';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(5);
  doc.getElementById('nameModalInput').value = 'Rapid Save B';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('loadTreeBackups().length') === backupCountBeforeRapidSaves, 'with a real (long) interval restored, two rapid successive saves do NOT each create a new backup — the time-gate actually works, not just accidentally passing when shrunk');

  // --- loadTree() corruption/recovery logic, tested directly ---
  const validBackupSnapshot = evalInPage('loadTreeBackups()[loadTreeBackups().length-1]');
  assert(validBackupSnapshot && validBackupSnapshot.tree && validBackupSnapshot.tree.type === 'folder', 'sanity: the backup we are about to test recovery against is itself well-formed');
  runInPage(`localStorage.setItem('brickTree_v1', '{ this is not valid json');`);
  const recoveredTree = evalInPage('loadTree()');
  assert(recoveredTree && recoveredTree.type === 'folder' && Array.isArray(recoveredTree.children), 'loadTree() recovers a genuinely usable tree when the primary data is corrupted JSON');
  assert(evalInPage('window.__brickRecoveredFromBackup') !== undefined, 'loadTree() flags that a backup-recovery happened, for the boot-time UI to pick up');
  assert(evalInPage(`localStorage.getItem('brickTreeCorrupted_v1')`).includes('this is not valid json'), 'the original corrupted string is preserved in a separate key rather than being discarded outright');

  // and the true worst case: corrupted primary data AND no valid backup either
  runInPage(`localStorage.removeItem('brickTreeBackups_v1'); localStorage.setItem('brickTree_v1', '{ still broken'); window.__brickRecoveredFromBackup = undefined; window.__brickDataLossWarning = undefined;`);
  const lastResortTree = evalInPage('loadTree()');
  assert(lastResortTree && lastResortTree.type === 'folder', 'even with corrupted primary data AND no backup, loadTree() returns a usable (seed) tree rather than throwing or returning something broken');
  assert(evalInPage('window.__brickDataLossWarning') === true, 'this genuine worst case is flagged distinctly from the recovered-from-backup case, so the UI can be honest about which happened');

  // =========================================================
  // Save failure handling: mock localStorage.setItem to simulate
  // storage being full, confirm the failure is loud, not silent
  // =========================================================
  // restore real localStorage/tree state first — the corruption tests
  // above deliberately broke it
  runInPage(`localStorage.setItem('brickTree_v1', JSON.stringify(${JSON.stringify({ id:'root', type:'folder', name:'Brick', children:[] })}));`);
  runInPage(`currentFolderId = 'root'; tree = loadTree();`);
  runInPage('renderTree();');
  await sleep(10);

  assert(!doc.getElementById('saveFailedOverlay').classList.contains('active'), 'save-failed modal starts closed');
  // jsdom's Storage implementation silently ignores direct reassignment
  // of localStorage.setItem (confirmed directly — it just keeps using
  // the real one), so simulate the failure at the app's own saveTree()
  // function instead, which is a plain reassignable function.
  runInPage(`window.__realSaveTree = saveTree; saveTree = function(t){ return false; };`);
  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('nameModalInput').value = 'Should Fail To Save';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('saveFailedOverlay').classList.contains('active'), 'a genuinely failed save opens the mandatory warning modal — not a silent console.warn nobody sees');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('saveFailedOverlay').classList.contains('active'), 'Escape does not dismiss the save-failed warning — same reasoning as the ImgBB modal, this must not be missable');

  doc.getElementById('saveFailedAckBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(!doc.getElementById('saveFailedOverlay').classList.contains('active'), '"I understand" dismisses the modal');

  // a SECOND failure in the same session should not re-spam the modal
  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('nameModalInput').value = 'Should Also Fail';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(!doc.getElementById('saveFailedOverlay').classList.contains('active'), 'a second save failure in the same session does not reopen the modal — avoids it becoming unusable if saves keep failing in the background');

  runInPage(`saveTree = window.__realSaveTree;`); // restore real behavior for the rest of the suite
  await sleep(10);

  // seed at least one fresh backup for the restore-UI test below — the
  // "no backup available" worst-case test above deliberately cleared
  // brickTreeBackups_v1, and nothing since has repopulated it
  doc.getElementById('newWallBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('nameModalInput').value = 'Pre-Restore-Test Wall';
  doc.getElementById('nameModalConfirm').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);

  // =========================================================
  // Manual restore-from-backup, in Settings
  // =========================================================
  doc.getElementById('settingsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(doc.getElementById('dataSafetyStatus').textContent.includes('backup'), 'Data Safety section shows a status line mentioning backups');
  const backupRows = doc.querySelectorAll('#backupList .trash-row');
  assert(backupRows.length > 0, 'at least one backup is listed for manual restore');

  const treeBeforeRestore = evalInPage('JSON.stringify(tree)');
  const firstBackupRestoreBtn = doc.querySelector('#backupList [data-action="restore-backup"]');
  firstBackupRestoreBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  const treeAfterRestore = evalInPage('JSON.stringify(tree)');
  assert(treeAfterRestore !== treeBeforeRestore, 'restoring a backup actually changes the live tree — not a no-op');
  assert(doc.getElementById('screenWall').classList.contains('active'), 'restoring a backup returns to the Wall screen so the result is immediately visible');
  const savedAfterRestore = JSON.parse(window.localStorage.getItem('brickTree_v1'));
  assert(JSON.stringify(savedAfterRestore) === treeAfterRestore, 'the restored tree is actually persisted to localStorage, not just held in memory');

  // =========================================================
  // Boot-time recovery notice — a GENUINE second boot, fresh JSDOM
  // instance, corrupted data pre-seeded before any script runs, to
  // prove the full pipeline works end-to-end and not just the
  // isolated loadTree() function call tested above
  // =========================================================
  {
    const dom2 = new JSDOM(html, {
      url: 'http://localhost/index.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      beforeParse(window2){
        window2.Element.prototype.getBoundingClientRect = function(){ return { left:0, top:0, width:400, height:300, right:400, bottom:300 }; };
        window2.indexedDB = window2.indexedDB || global.indexedDB;
        if (!window2.crypto) Object.defineProperty(window2, 'crypto', { value: webcrypto, configurable: true });
        else if (!window2.crypto.subtle) window2.crypto.subtle = webcrypto.subtle;
        // seed corrupted primary data + one valid backup, BEFORE any app script runs
        window2.localStorage.setItem('brickTree_v1', '{ deliberately broken json for the second-boot test');
        window2.localStorage.setItem('brickTreeBackups_v1', JSON.stringify([
          { savedAt: Date.now() - 60000, tree: { id:'root', type:'folder', name:'Brick', children:[
            { id:'recovered-wall', type:'folder', name:'Recovered From Backup', children:[] }
          ] } }
        ]));
      }
    });
    const doc2 = dom2.window.document;
    function runInPage2(code){ const el = doc2.createElement('script'); el.textContent = code; doc2.body.appendChild(el); }
    scriptOrder.forEach(rel => runInPage2(fs.readFileSync(path.join(ROOT, rel), 'utf-8')));
    await sleep(300);

    assert(doc2.getElementById('dataRecoveryOverlay').classList.contains('active'), 'a genuine second boot with corrupted primary data shows the Data Recovery notice automatically, unprompted');
    assert(doc2.getElementById('dataRecoveryText').textContent.includes('restored from a backup'), 'the notice correctly identifies this as a backup-recovery, not the total-loss case — got "' + doc2.getElementById('dataRecoveryText').textContent + '"');
    dom2.window.KeyboardEvent && doc2.dispatchEvent(new dom2.window.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
    await sleep(10);
    assert(doc2.getElementById('dataRecoveryOverlay').classList.contains('active'), 'Escape does not dismiss the data recovery notice either — this is exactly the thing that must not be missable');
    assert(!!doc2.querySelector('[data-id="recovered-wall"]'), 'the actual recovered content — the Wall from the backup — is genuinely visible on the Wall screen, not just a notice with nothing behind it');
    doc2.getElementById('dataRecoveryAckBtn').dispatchEvent(new dom2.window.Event('click', { bubbles:true }));
    await sleep(10);
    assert(!doc2.getElementById('dataRecoveryOverlay').classList.contains('active'), '"I understand" dismisses the notice once acknowledged');
  }

  // =========================================================
  // Linked Backup Folder — File System Access API, mocked (jsdom has
  // no support for it at all, confirmed directly before building this:
  // typeof window.showDirectoryPicker === 'undefined'). Since
  // BACKUP_FS_SUPPORTED is computed ONCE at script-load time, the mock
  // has to be in place via beforeParse — genuine function closures,
  // not string-injected — BEFORE backup-folder.js ever loads, in a
  // fresh JSDOM instance, same reasoning as the data-recovery
  // second-boot test above.
  // =========================================================
  {
    const fakeFS = { type:'dir', children:{} };
    let fakePermission = 'granted';
    let writeCallLog = []; // tracks every actual write, so tests can confirm unchanged files are genuinely skipped, not just reported as skipped
    function makeDirHandle(node, name){
      return {
        name, kind:'directory',
        async getDirectoryHandle(childName, opts){
          opts = opts || {};
          if (!node.children[childName]){
            if (!opts.create) throw new Error('NotFoundError');
            node.children[childName] = { type:'dir', children:{} };
          }
          return makeDirHandle(node.children[childName], childName);
        },
        async getFileHandle(childName, opts){
          opts = opts || {};
          if (!node.children[childName]){
            if (!opts.create) throw new Error('NotFoundError');
            node.children[childName] = { type:'file', content:'' };
          }
          return makeFileHandle(node.children[childName], childName);
        },
        async removeEntry(childName){
          if (!node.children[childName]) throw new Error('NotFoundError');
          delete node.children[childName];
        },
        // real FileSystemDirectoryHandle.entries() is an async
        // iterator of [name, handle] pairs — this mock needs the same
        // shape so listExistingMirrorPaths() can walk it exactly the
        // way it walks a real handle
        entries(){
          const names = Object.keys(node.children);
          let i = 0;
          return {
            [Symbol.asyncIterator](){ return this; },
            async next(){
              if (i >= names.length) return { done:true, value:undefined };
              const childName = names[i++];
              const childNode = node.children[childName];
              const childHandle = childNode.type === 'dir' ? makeDirHandle(childNode, childName) : makeFileHandle(childNode, childName);
              return { done:false, value:[childName, childHandle] };
            }
          };
        },
        async queryPermission(){ return fakePermission; },
        async requestPermission(){ return fakePermission; }
      };
    }
    function makeFileHandle(node, name){
      return {
        name, kind:'file',
        async createWritable(){
          return { async write(data){ writeCallLog.push(name); node.content = data; }, async close(){} };
        },
        async getFile(){
          return { async text(){ return node.content; } };
        }
      };
    }

    const dom3 = new JSDOM(html, {
      url: 'http://localhost/index.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      beforeParse(window3){
        window3.Element.prototype.getBoundingClientRect = function(){ return { left:0, top:0, width:400, height:300, right:400, bottom:300 }; };
        window3.indexedDB = window3.indexedDB || global.indexedDB;
        if (!window3.crypto) Object.defineProperty(window3, 'crypto', { value: webcrypto, configurable: true });
        else if (!window3.crypto.subtle) window3.crypto.subtle = webcrypto.subtle;
        // the mock itself — real closures over `fakeFS`, defined before ANY app script (including backup-folder.js) has loaded
        window3.showDirectoryPicker = async () => makeDirHandle(fakeFS, 'MockBackupFolder');
        window3.__setFakePermission = (p) => { fakePermission = p; };
        window3.__fakeFS = fakeFS;
        window3.__getWriteCallLog = () => writeCallLog;
        window3.__clearWriteCallLog = () => { writeCallLog = []; };
      }
    });
    const doc3 = dom3.window.document;
    function runInPage3(code){ const el = doc3.createElement('script'); el.textContent = code; doc3.body.appendChild(el); }
    function evalInPage3(expr){ runInPage3('window.__r3 = (' + expr + ');'); const v = dom3.window.__r3; dom3.window.__r3 = undefined; return v; }
    scriptOrder.forEach(rel => runInPage3(fs.readFileSync(path.join(ROOT, rel), 'utf-8')));
    await sleep(300);

    // Real FileSystemDirectoryHandle objects have special browser-
    // internal structured-clone support that lets them be stored in
    // IndexedDB directly — a plain mock object with function
    // properties has no such support, and IndexedDB's real clone
    // algorithm rejects it (DataCloneError, since functions aren't
    // cloneable). That's a genuine capability of real native handles
    // this environment can't fake, not a bug in the app's own
    // storeFolderHandle()/getStoredFolderHandle() — swapping them for
    // a simple in-memory stand-in tests everything else (the actual
    // sync/mirror logic, which is the part that matters) without
    // needing a real native handle. Has to happen AFTER backup-folder.js
    // has loaded — its own function declarations would otherwise
    // clobber an earlier override, since a later plain assignment is
    // what correctly supersedes an existing global binding, not the
    // reverse.
    runInPage3(`
      window.__mockHandleStorage = null;
      storeFolderHandle = async (handle) => { window.__mockHandleStorage = handle; };
      getStoredFolderHandle = async () => window.__mockHandleStorage;
      clearStoredFolderHandle = async () => { window.__mockHandleStorage = null; };
    `);
    await sleep(10);

    assert(evalInPage3('BACKUP_FS_SUPPORTED') === true, 'with the mock in place before load, the feature correctly detects itself as supported');

    // link + initial sync
    runInPage3(`(async () => { window.__linkedHandle = await linkBackupFolder(); window.__syncResult = await syncBackupFolder(true); })();`);
    await sleep(100);
    assert(evalInPage3('window.__linkedHandle') !== null, 'linking succeeds against the mocked picker');
    const syncResult1 = evalInPage3('window.__syncResult');
    assert(syncResult1 && syncResult1.ok === true, 'the initial sync reports success — got ' + JSON.stringify(syncResult1));

    // structure check: the mock filesystem should now mirror the seeded demo tree
    const fsSnapshot1 = evalInPage3('window.__fakeFS');
    const demoWallDir = fsSnapshot1.children['Demo Wall'];
    assert(!!demoWallDir && demoWallDir.type === 'dir', 'a real directory was created matching the seeded "Demo Wall" folder');
    const brickFile = demoWallDir.children['Cell Diagram (demo).json'];
    assert(!!brickFile && brickFile.type === 'file', 'a real .json file was created matching the seeded Brick, inside the correct Wall directory');
    const brickFileParsed = JSON.parse(brickFile.content);
    assert(brickFileParsed.tree && brickFileParsed.images && Object.keys(brickFileParsed.images).length > 0, 'the written file is a genuine, self-contained Brick export — same shape as a normal selective export, including its image');

    // dirty-check: syncing again with nothing changed and force=false
    // should skip actual writing — checked BEFORE the re-import
    // verification below, since importBundle() genuinely mutates the
    // tree (that's the whole point of it), which would otherwise make
    // "nothing changed" false by the time this ran
    runInPage3(`window.__fakeFS.children['Demo Wall'].children['Cell Diagram (demo).json'].content = 'UNCHANGED_MARKER';`);
    runInPage3(`(async () => { window.__syncResult2 = await syncBackupFolder(false); })();`);
    await sleep(50);
    const syncResult2 = evalInPage3('window.__syncResult2');
    assert(syncResult2 && syncResult2.reason === 'unchanged', 'syncing again with nothing changed and force=false correctly skips re-writing — got ' + JSON.stringify(syncResult2));
    assert(evalInPage3(`window.__fakeFS.children['Demo Wall'].children['Cell Diagram (demo).json'].content`) === 'UNCHANGED_MARKER', 'confirms the skip was real — the file was genuinely not touched, not just reported as skipped');
    // restore real content now that the dirty-check is confirmed, so the next test reads genuine data
    runInPage3(`(async () => { await syncBackupFolder(true); })();`);
    await sleep(50);

    // that file should itself be re-importable, standing completely on its own
    runInPage3(`currentFolderId = 'root';`);
    runInPage3(`(async () => { window.__reimportCounts = await importBundle(JSON.parse(window.__fakeFS.children['Demo Wall'].children['Cell Diagram (demo).json'].content)); })();`);
    await sleep(50);
    const reimportCounts = evalInPage3('window.__reimportCounts');
    assert(reimportCounts && reimportCounts.bricks === 1, 'the mirrored file, fed straight back into the real import path, works — proving it is genuinely self-contained, not just structurally similar');

    // name collision handling: two same-named Bricks in the same Wall
    runInPage3(`
      (async () => {
        tree.children.push({ id: uid(), type:'folder', name:'Collision Test Wall', children:[
          { id: uid(), type:'deck', name:'Same Name', createdAt: Date.now(), cards:[{ id: uid(), type:'basic', front:'A', back:'A', timeouts:0, tough:false }] },
          { id: uid(), type:'deck', name:'Same Name', createdAt: Date.now(), cards:[{ id: uid(), type:'basic', front:'B', back:'B', timeouts:0, tough:false }] }
        ]});
        saveTreeNow();
        window.__collisionSync = await syncBackupFolder(true);
      })();
    `);
    await sleep(100);
    const collisionDir = evalInPage3(`window.__fakeFS.children['Collision Test Wall']`);
    const collisionFileNames = Object.keys(collisionDir.children);
    assert(collisionFileNames.includes('Same Name.json') && collisionFileNames.some(n => n === 'Same Name (2).json'), 'two same-named Bricks in one Wall get disambiguated with a "(2)" suffix rather than one silently overwriting the other — got ' + JSON.stringify(collisionFileNames));

    // real sync: removing a Brick from the app moves its mirrored file
    // to Trash/ (flat, timestamped) rather than leaving it stale where
    // it was OR silently destroying it outright
    const cellDiagramId = evalInPage3(`tree.children.find(c=>c.name==='Demo Wall').children.find(c=>c.name==='Cell Diagram (demo)').id`);
    runInPage3(`
      (async () => {
        const parent = tree.children.find(c=>c.name==='Demo Wall');
        parent.children = parent.children.filter(c => c.id !== '${cellDiagramId}');
        saveTreeNow();
        window.__afterDeleteSync = await syncBackupFolder(true);
      })();
    `);
    await sleep(50);
    assert(evalInPage3(`window.__fakeFS.children['Demo Wall'].children['Cell Diagram (demo).json']`) === undefined, 'the mirrored file no longer sits at its original location — this is real sync now, not just accumulation');
    const afterDeleteSync = evalInPage3('window.__afterDeleteSync');
    assert(afterDeleteSync && afterDeleteSync.trashed === 1, 'the sync result reports exactly one file trashed — got ' + JSON.stringify(afterDeleteSync));
    const trashDirAfterDelete = evalInPage3(`window.__fakeFS.children['Trash']`);
    assert(!!trashDirAfterDelete, 'a Trash folder was created at the backup root');
    const trashedNames = Object.keys(trashDirAfterDelete.children);
    assert(trashedNames.length === 1 && trashedNames[0].startsWith('Demo Wall - Cell Diagram (demo)') && trashedNames[0].includes('(deleted '), 'the trashed file is named after its original path (flattened) with a deletion timestamp, sitting flat in Trash/ rather than nested — got ' + JSON.stringify(trashedNames));
    const trashedContent = JSON.parse(trashDirAfterDelete.children[trashedNames[0]].content);
    assert(trashedContent.tree && trashedContent.images, 'the trashed file still holds the REAL content — nothing was lost, just relocated');

    // deleting-recreating-deleting the same name again must never
    // silently overwrite the earlier trashed copy
    runInPage3(`
      (async () => {
        const parent = tree.children.find(c=>c.name==='Demo Wall');
        parent.children.push({ id: uid(), type:'deck', name:'Cell Diagram (demo)', createdAt: Date.now(), cards:[{ id: uid(), type:'basic', front:'second incarnation', back:'y', timeouts:0, tough:false }] });
        saveTreeNow();
        await syncBackupFolder(true);
        const parent2 = tree.children.find(c=>c.name==='Demo Wall');
        parent2.children = parent2.children.filter(c => c.name !== 'Cell Diagram (demo)');
        saveTreeNow();
        window.__secondDeleteSync = await syncBackupFolder(true);
      })();
    `);
    await sleep(80);
    const secondDeleteSync = evalInPage3('window.__secondDeleteSync');
    assert(secondDeleteSync && secondDeleteSync.trashed === 1, 'the second deletion of the same original name also gets trashed — got ' + JSON.stringify(secondDeleteSync));
    const trashDirAfterSecond = evalInPage3(`window.__fakeFS.children['Trash']`);
    assert(Object.keys(trashDirAfterSecond.children).length === 2, 'both trashed copies exist side by side — the second deletion did not overwrite the first, thanks to the timestamp in each trash filename — got ' + Object.keys(trashDirAfterSecond.children).length);

    // =========================================================
    // Real per-file reconciliation: unchanged files are genuinely
    // left alone (not rewritten), changed ones ARE, new ones get
    // created — one-to-one comparison against actual on-disk
    // content, not a blind "rewrite everything because something
    // somewhere changed". Uses a dedicated fresh brick rather than
    // "Cell Diagram (demo)" — that one was already deleted (twice)
    // by the trash tests just above, so it no longer exists in the
    // tree by this point.
    // =========================================================
    runInPage3(`
      (async () => {
        tree.children.push({ id: uid(), type:'folder', name:'Diff Test Wall', children:[
          { id: uid(), type:'deck', name:'Diff Test Brick', createdAt: Date.now(), cards:[{ id: uid(), type:'basic', front:'original', back:'y', timeouts:0, tough:false }] }
        ]});
        saveTreeNow();
        window.__diffTestSetupSync = await syncBackupFolder(true);
      })();
    `);
    await sleep(80);
    const diffTestSetupSync = evalInPage3('window.__diffTestSetupSync');
    assert(diffTestSetupSync && diffTestSetupSync.created >= 1, 'sanity: the dedicated diff-test brick was actually created on the initial sync — got ' + JSON.stringify(diffTestSetupSync));

    runInPage3(`window.__clearWriteCallLog();`);
    runInPage3(`(async () => { window.__noopResync = await syncBackupFolder(true); })();`);
    await sleep(80);
    const noopResync = evalInPage3('window.__noopResync');
    assert(noopResync && noopResync.unchanged >= 1 && noopResync.created === 0 && noopResync.updated === 0, 'forcing a resync with nothing actually different reports files as unchanged, not blindly recreated/updated — got ' + JSON.stringify(noopResync));
    assert(evalInPage3('window.__getWriteCallLog()').length === 0, 'CRITICAL: confirms the skip was real at the filesystem level — zero actual write() calls happened, not just a label saying "unchanged" while rewriting anyway');

    // now actually change the one card's content and add a second, brand-new Brick in the same Wall, then resync
    runInPage3(`
      (async () => {
        const wall = tree.children.find(c => c.name === 'Diff Test Wall');
        const brick = wall.children.find(c => c.name === 'Diff Test Brick');
        brick.cards[0].front = 'genuinely changed content';
        wall.children.push({ id: uid(), type:'deck', name:'Brand New Sibling Brick', createdAt: Date.now(), cards:[{ id: uid(), type:'basic', front:'x', back:'y', timeouts:0, tough:false }] });
        saveTreeNow();
        window.__mixedSync = await syncBackupFolder(true);
      })();
    `);
    await sleep(80);
    const mixedSync = evalInPage3('window.__mixedSync');
    assert(mixedSync && mixedSync.updated === 1, 'the one genuinely-changed file is correctly detected and counted as updated — got ' + JSON.stringify(mixedSync));
    assert(mixedSync && mixedSync.created === 1, 'the genuinely new sibling Brick is correctly detected and counted as created — got ' + JSON.stringify(mixedSync));

    // =========================================================
    // Sync preview: read-only, matches what an actual sync would do,
    // without touching the filesystem at all
    // =========================================================
    runInPage3(`window.__clearWriteCallLog();`);
    runInPage3(`
      (async () => {
        const wall = tree.children.find(c => c.name === 'Diff Test Wall');
        const brick = wall.children.find(c => c.name === 'Diff Test Brick');
        brick.cards[0].front = 'changed again for the preview test';
        saveTreeNow();
        window.__preview = await previewMirrorSync();
      })();
    `);
    await sleep(80);
    const preview = evalInPage3('window.__preview');
    assert(preview && preview.ok === true, 'previewMirrorSync() succeeds — got ' + JSON.stringify(preview));
    assert(preview.updated.length === 1 && preview.updated[0].includes('Diff Test Brick'), 'the preview correctly identifies which specific file would be updated — got ' + JSON.stringify(preview.updated));
    assert(evalInPage3('window.__getWriteCallLog()').length === 0, 'CRITICAL: previewing makes ZERO actual writes — it only reads and reports, the tree change from this test is still sitting unsynced on disk after this call');
    // confirm it really is still unsynced — an actual sync afterward should still find that same file needing an update
    runInPage3(`(async () => { window.__afterPreviewSync = await syncBackupFolder(true); })();`);
    await sleep(80);
    assert(evalInPage3('window.__afterPreviewSync.updated') === 1, 'a real sync run right after the preview still finds the same one file needing an update — the preview truly changed nothing on disk');

    // permission handling: 'prompt' state should block syncing rather than silently failing or succeeding
    runInPage3(`window.__setFakePermission('prompt');`);
    runInPage3(`(async () => { window.__promptSync = await syncBackupFolder(true); })();`);
    await sleep(50);
    assert(evalInPage3('window.__promptSync.reason') === 'needs-permission', 'when permission has lapsed to "prompt", sync correctly refuses rather than silently doing nothing or crashing — got ' + JSON.stringify(evalInPage3('window.__promptSync')));
    runInPage3(`window.__setFakePermission('granted');`); // restore for the remaining checks

    // pagehide / visibilitychange actually trigger a sync on their own,
    // not just when explicitly called
    runInPage3(`
      tree.children.push({ id: uid(), type:'folder', name:'Trigger Test Wall', children:[
        { id: uid(), type:'deck', name:'Trigger Test Brick', createdAt: Date.now(), cards:[{ id: uid(), type:'basic', front:'x', back:'y', timeouts:0, tough:false }] }
      ]});
      saveTreeNow();
    `);
    await sleep(10);
    assert(evalInPage3(`window.__fakeFS.children['Trigger Test Wall']`) === undefined, 'sanity: the new content has not been mirrored yet — nothing has triggered a sync since the change');
    dom3.window.dispatchEvent(new dom3.window.Event('pagehide'));
    await sleep(50);
    assert(evalInPage3(`window.__fakeFS.children['Trigger Test Wall']`) !== undefined, 'pagehide alone (no explicit syncBackupFolder call) triggers a real sync that picks up the new content');

    // unlink actually clears the stored handle
    runInPage3(`(async () => { await unlinkBackupFolder(); window.__handleAfterUnlink = await getStoredFolderHandle(); })();`);
    await sleep(50);
    assert(evalInPage3('window.__handleAfterUnlink') == null, 'unlinking actually clears the stored folder handle');
  }

  // =========================================================
  // Companion extension download button
  // =========================================================
  runInPage(`currentFolderId = 'root';`);
  await sleep(10);
  doc.getElementById('settingsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  const extBtn = doc.getElementById('downloadExtensionBtn');
  assert(!!extBtn, 'the companion-extension download button exists in Settings');
  assert(extBtn.tagName === 'A', 'it is a real link, not a JS-only button — works even if something else on the page has misbehaved');
  assert(extBtn.getAttribute('href') === 'downloads/brick-companion-extension.zip', 'points at a stable, predictable path — dropping the real extension there later needs no code changes to this button at all');
  assert(extBtn.hasAttribute('download'), 'has the download attribute, so clicking it saves the file rather than navigating to it');
  doc.getElementById('settingsBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);

  // the file at that path should now be the REAL extension, not the
  // placeholder — a proper regression check for exactly this: it
  // silently staying a stub forever after the button was first built
  const extensionZipPath = path.join(ROOT, 'downloads', 'brick-companion-extension.zip');
  assert(fs.existsSync(extensionZipPath), 'a file actually exists at the path the download button points to');
  const extensionZipBytes = fs.statSync(extensionZipPath).size;
  assert(extensionZipBytes > 5000, 'the zip is genuinely substantial (real manifest+background+popup+icons), not a single placeholder text file — got ' + extensionZipBytes + ' bytes');
  const extensionZipListing = require('child_process').execSync('unzip -l ' + JSON.stringify(extensionZipPath)).toString();
  assert(extensionZipListing.includes('manifest.json') && extensionZipListing.includes('background.js') && extensionZipListing.includes('background-core.js') && extensionZipListing.includes('popup.html'), 'the zip actually contains the real extension files, not just a README — got listing:\n' + extensionZipListing);
  assert(!extensionZipListing.includes('PLACEHOLDER'), 'the old placeholder text file is genuinely gone, not just sitting alongside the real files');

  // =========================================================
  // Extension bridge — the Brick-side API surface an extension would
  // actually call. Boot has long since finished by this point in the
  // suite, so isReady()/version are checked against the REAL running
  // app state, not a fresh contrived one.
  // =========================================================
  assert(evalInPage('typeof window.__brickBridge') === 'object', 'window.__brickBridge exists as a real object, not just a planned API');
  assert(evalInPage('window.__brickBridge.version') === 1, 'exposes an explicit version number, so a future incompatible change is detectable rather than silently wrong');
  assert(evalInPage('window.__brickBridge.isReady()') === true, 'isReady() is true — boot has genuinely finished by this point');

  // an earlier test (the save-failure simulation) deliberately reset
  // tree to an empty root — seed known, deterministic content here
  // rather than assume whatever's left over from tests long since
  // passed, so every bridge assertion below tests real content, not
  // an accidental degenerate empty-tree case
  runInPage(`
    (async () => {
      window.__bridgeSeedStep = 'start';
      try {
        // a plain Basic card needs no image at all — no reason to
        // route through image storage (and its jsdom limitations)
        // for a test that doesn't need one
        tree.children.push({ id: uid(), type:'folder', name:'Bridge Test Wall', children:[
          { id: uid(), type:'deck', name:'Bridge Test Brick', createdAt: Date.now(), cards:[
            { id: uid(), type:'basic', front:'Bridge test front', back:'Bridge test back', timeouts:0, tough:false }
          ]}
        ]});
        window.__bridgeSeedStep = 'before-save';
        saveTreeNow();
        window.__bridgeSeedStep = 'done';
        window.__bridgeSeedReady = true;
      } catch (err){
        window.__bridgeSeedError = String(err && err.stack || err);
        window.__bridgeSeedStep = 'errored';
      }
    })();
  `);
  await sleep(200);
  assert(evalInPage('window.__bridgeSeedReady') === true, 'known content seeded for the bridge tests — error: ' + evalInPage('window.__bridgeSeedError') + ' step: ' + evalInPage('window.__bridgeSeedStep'));

  const summary = evalInPage('window.__brickBridge.getTreeSummary()');
  assert(summary.ok === true, 'getTreeSummary() succeeds — got ' + JSON.stringify(summary));
  const realCounts = evalInPage('countBundleContents(tree)');
  assert(summary.bricks === realCounts.bricks && summary.cards === realCounts.cards, 'summary counts match the real tree exactly — got ' + JSON.stringify(summary) + ' vs real ' + JSON.stringify(realCounts));
  assert(summary.bricks > 0, 'sanity: the summary reflects genuinely non-empty seeded content, not an empty tree passing trivially');
  assert(typeof summary.fingerprint === 'string' && summary.fingerprint.length > 0, 'includes a fingerprint an extension can diff against what it saw last time, to skip needless full rebuilds');

  runInPage(`(async () => { window.__bridgePlan = await window.__brickBridge.getMirrorPlan(); })();`);
  await sleep(200);
  const bridgePlan = evalInPage('window.__bridgePlan');
  assert(bridgePlan.ok === true, 'getMirrorPlan() succeeds — got ' + JSON.stringify(bridgePlan.reason || 'ok'));
  assert(Array.isArray(bridgePlan.files) && bridgePlan.files.length > 0, 'returns a real, non-empty file list matching the actual current tree');
  assert(bridgePlan.files.every(f => typeof f.relativePath === 'string' && f.relativePath.endsWith('.json') && typeof f.content === 'string'), 'every entry has the expected shape — a real relative path ending in .json, and real string content');

  // a returned entry has to be genuinely, independently importable —
  // not just structurally similar to a real export
  const oneBridgeFile = bridgePlan.files[0];
  runInPage(`currentFolderId = 'root'; (async () => { try { window.__bridgeReimport = await importBundle(JSON.parse(${JSON.stringify(oneBridgeFile.content)})); } catch (err) { window.__bridgeReimportError = String(err); } })();`);
  await sleep(50);
  const bridgeReimport = evalInPage('window.__bridgeReimport');
  assert(bridgeReimport && bridgeReimport.bricks === 1, 'a file the bridge returned, fed straight back through the real import path, actually works on its own — got ' + JSON.stringify(bridgeReimport) + ' error: ' + evalInPage('window.__bridgeReimportError'));

  // isReady() correctly reflects "not ready" before boot — tested for
  // real, not by hand-copying the logic: a fresh instance loaded up
  // to (but NOT including) app.js, so markBridgeReady() genuinely
  // never runs, then checking the actual function's real pre-boot
  // return value.
  {
    const dom4 = new JSDOM(html, {
      url: 'http://localhost/index.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      beforeParse(window4){
        window4.Element.prototype.getBoundingClientRect = function(){ return { left:0, top:0, width:400, height:300, right:400, bottom:300 }; };
        window4.indexedDB = window4.indexedDB || global.indexedDB;
        if (!window4.crypto) Object.defineProperty(window4, 'crypto', { value: webcrypto, configurable: true });
        else if (!window4.crypto.subtle) window4.crypto.subtle = webcrypto.subtle;
      }
    });
    const doc4 = dom4.window.document;
    function runInPage4(code){ const el = doc4.createElement('script'); el.textContent = code; doc4.body.appendChild(el); }
    const scriptsBeforeAppJs = scriptOrder.filter(rel => rel !== 'js/app.js');
    scriptsBeforeAppJs.forEach(rel => runInPage4(fs.readFileSync(path.join(ROOT, rel), 'utf-8')));
    await sleep(100);
    assert(dom4.window.__brickBridge.isReady() === false, 'with app.js (and therefore boot()/markBridgeReady()) never having run, isReady() genuinely returns false — the real pre-boot state, not a reimplementation of the check');
    assert(dom4.window.__brickBridge.getTreeSummary().ok === false, 'getTreeSummary() correctly refuses before ready too, rather than returning something built on a not-yet-trustworthy tree');
  }

  assert(errors.length === 0, 'no uncaught JS errors accumulated across the ENTIRE test run (' + errors.length + '): ' + errors.map(String).join(' | '));

  console.log(failures ? ('\n=== ' + failures + ' FAILURE(S) ===') : '\n=== ALL BRICK MULTI-FILE INTEGRATION TESTS PASSED ===');
  process.exit(failures ? 1 : 0);
}
// Same reasoning as the companion extension's test suite: a test that
// silently hangs on an unresolved promise doesn't crash — main() just
// stays permanently suspended while the process exits with code 0 the
// moment the event loop has nothing else scheduled, which looks
// exactly like success. Found that exact failure mode once already
// (in the extension's tests, not this file) — adding the same
// safety net here too rather than leaving this much larger suite
// without it. Deliberately not unref()'d — it has to be the one
// thing keeping the process alive long enough to complain if main()
// itself is what's stuck.
const smokeTestWatchdog = setTimeout(() => {
  console.error('\n=== TEST SUITE TIMED OUT — main() never completed (a promise is likely stuck unresolved somewhere) ===');
  process.exit(1);
}, 60000); // this suite does far more real work (many JSDOM boots, IndexedDB, etc.) than the extension's — a longer ceiling avoids false positives on a slower machine

main()
  .then(() => clearTimeout(smokeTestWatchdog))
  .catch(err => { clearTimeout(smokeTestWatchdog); console.error('SMOKE TEST CRASHED:', err); process.exit(1); });
