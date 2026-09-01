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

  const scriptOrder = ['js/storage.js','js/scheduler.js','js/text-format.js','js/tree.js','js/occlusion-editor.js','js/basic-cloze.js','js/study.js','js/import-export.js','js/settings.js','js/app.js'];
  scriptOrder.forEach(rel => runInPage(fs.readFileSync(path.join(ROOT, rel), 'utf-8')));
  await sleep(300); // let boot()'s async seedDemoImage() settle

  assert(errors.length === 0, 'no uncaught JS errors after loading all modules (' + errors.length + ' found)' + (errors.length? ': ' + errors.map(String).join(' | '):''));

  // =========================================================
  // Wall screen: seeded demo content renders from REAL tree data
  // =========================================================
  assert(doc.getElementById('screenWall').classList.contains('active'), 'boots into the Wall screen');
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
  const cementModeBtn = doc.getElementById('cementModeBtn');
  assert(!cementModeBtn.classList.contains('active'), 'Cement Mode starts off');

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

  // toggle Cement Mode ON via the topbar button
  cementModeBtn.dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(cementModeBtn.classList.contains('active'), 'clicking the Cement Mode button activates it');
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
  assert(!cementModeBtn.classList.contains('active'), '"C" hotkey on the Wall screen toggles Cement Mode back off');
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

  console.log(failures ? ('\n=== ' + failures + ' FAILURE(S) ===') : '\n=== ALL BRICK MULTI-FILE INTEGRATION TESTS PASSED ===');
  process.exit(failures ? 1 : 0);
}
main().catch(err => { console.error('SMOKE TEST CRASHED:', err); process.exit(1); });
