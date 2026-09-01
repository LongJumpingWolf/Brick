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

  const scriptOrder = ['js/storage.js','js/scheduler.js','js/text-format.js','js/tree.js','js/occlusion-editor.js','js/basic-cloze.js','js/study.js','js/app.js'];
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

  // Header / Back Extra fields + name, then generate
  doc.getElementById('scrollNameInput').value = 'Generated Test Brick';
  doc.getElementById('headerInput').value = 'Test Header';
  doc.getElementById('backExtraInput').value = 'Extra context here';
  const folderBeforeGen = evalInPage('nodeById(currentFolderId).children.length');
  doc.getElementById('generateCardsBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('screenWall').classList.contains('active'), 'generating cards returns to the Wall screen');
  assert(evalInPage('nodeById(currentFolderId).children.length') === folderBeforeGen + 1, 'exactly one new brick was added');
  const newDeck = evalInPage(`nodeById(currentFolderId).children.find(c => c.name === 'Generated Test Brick')`);
  assert(!!newDeck, 'new brick has the typed name');
  assert(newDeck.cards.length === 1, 'one remaining shape produced exactly one card (got ' + (newDeck && newDeck.cards.length) + ')');
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
  doc.getElementById('gradeAgain').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('studyTitle').textContent.includes('3/3'), 'grading advances to card 3/3');
  studyStage.dispatchEvent(new window.Event('click', { bubbles:true }));
  doc.getElementById('gradeGood').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(20);
  assert(doc.getElementById('screenDone').classList.contains('active'), 'finishing the last card shows Done');
  assert(doc.getElementById('doneSummary').textContent.includes('2 good') && doc.getElementById('doneSummary').textContent.includes('1 to review again'), 'done summary correctly tallies 2 good / 1 again — got "' + doc.getElementById('doneSummary').textContent + '"');

  const savedLog = JSON.parse(window.localStorage.getItem('brickReviewLog_v1'));
  assert(savedLog.length === 3, 'all 3 review events persisted to the real review log (got ' + savedLog.length + ')');

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

  // Cancel/reopen resets editorCardType back to Occlusion and clears staged cards
  doc.getElementById('studyBackBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  doc.getElementById('newBrickBtn').dispatchEvent(new window.Event('click', { bubbles:true }));
  await sleep(10);
  assert(evalInPage('editorCardType') === 'occlusion', 'reopening New Brick always resets to the Occlusion tab');
  assert(evalInPage('basicStagedCards.length') === 0, 'reopening New Brick clears any previously staged Basic cards');
  assert(evalInPage('clozeStagedCards.length') === 0, 'reopening New Brick clears any previously staged Cloze cards');

  console.log(failures ? ('\n=== ' + failures + ' FAILURE(S) ===') : '\n=== ALL BRICK MULTI-FILE INTEGRATION TESTS PASSED ===');
  process.exit(failures ? 1 : 0);
}
main().catch(err => { console.error('SMOKE TEST CRASHED:', err); process.exit(1); });
