'use strict';
/* =====================================================================
   occlusion-editor.js — the image occlusion mask editor.

   Modeled on Anki's actual Image Occlusion editor: a Select tool plus
   Rectangle and Ellipse draw tools, shapes you can drag to move and
   resize via corner handles, "Hide All, Guess One" / "Hide One, Guess
   One" modes, and the same Header / Back Extra fields Anki's IO note
   type ships with.

   Deliberately NOT copied: Anki also has a Polygon tool, a Text tool,
   per-shape color, and shape grouping. Scoped out here to keep this
   file's interaction logic reliable rather than exhaustive — see
   README.md for the full list of intentional gaps.
   ===================================================================== */

let editorImgHash = null, editorImgW = 0, editorImgH = 0;
let editorShapes = [];       // [{id, shape:'rect'|'ellipse', x,y,w,h (percent), label}]
let editorTool = 'rect';     // 'select' | 'rect' | 'ellipse'
let editorMode = 'hide-all'; // 'hide-all' | 'hide-one'
let selectedShapeId = null;
let editorTargetFolderId = 'root';

let dragState = null;        // 'drawing' | 'moving' | 'resizing' | null
let dragHandle = null;       // 'nw'|'ne'|'sw'|'se' when resizing
let dragStartPct = null;     // {x,y} at pointerdown
let dragOrigShape = null;    // snapshot of the shape being moved/resized
let drawingPreview = null;   // {x,y,w,h} while actively drawing a new shape

/* Tracks how many fingers are actually down. Used only so a second
   finger landing mid-draw cleanly cancels the single-finger gesture
   (no half-finished shape left behind) — NOT to drive scrolling
   manually. An earlier attempt at that (computing scroll deltas from
   the average pointer position and calling window.scrollBy) fought
   the browser's own native touch handling whenever the second finger
   didn't land precisely on the stage, causing a visible flicker as
   two separate things tried to scroll the page at once. Removed for
   good rather than patched — touch-action:none on the stage already
   correctly stops a single finger from fighting the drawing gesture;
   scrolling while actively touching the stage just isn't available,
   the same unsurprising limitation most drawing/annotation surfaces
   have. Lift your finger and scroll from anywhere else on the page. */
let activePointers = new Map(); // pointerId -> {x,y}

function openOcclusionEditor(folderId){
  editorTargetFolderId = folderId;
  editorImgHash = null; editorShapes = []; editorTool = 'rect'; editorMode = 'hide-all'; selectedShapeId = null;
  activePointers = new Map(); // stale multi-touch tracking shouldn't leak into a fresh session
  document.getElementById('editorUploadStep').style.display = '';
  document.getElementById('editorMaskStep').style.display = 'none';
  document.getElementById('scrollNameInput').value = '';
  document.getElementById('headerInput').value = '';
  document.getElementById('backExtraInput').value = '';
  setEditorTool('rect');
  document.querySelectorAll('.mode-opt').forEach(b=>b.classList.toggle('active', b.dataset.mode==='hide-all'));
  resetBasicClozeState(); // also resets the Basic/Cloze tabs and lands on the Occlusion tab
  showScreen('screenEditor');
}

/* ---------- upload ---------- */
async function handleImageFile(file){
  try {
    const { hash, w, h } = await storeImageFile(file);
    editorImgHash = hash; editorImgW = w; editorImgH = h;
    const rec = await getImage(hash);
    const stage = document.getElementById('ioStage');
    stage.style.aspectRatio = w + ' / ' + h;
    editorShapes = [];
    selectedShapeId = null;
    renderEditorShapes();
    stage.querySelector('img') || (stage.innerHTML = '<img alt="">' + stage.innerHTML);
    document.getElementById('editorUploadStep').style.display = 'none';
    document.getElementById('editorMaskStep').style.display = '';
    renderEditorShapes(rec.dataUrl);
  } catch (err){
    console.error(err);
    announce('Could not read that image — try a different file.');
  }
}

/* ---------- tool switching ---------- */
function setEditorTool(tool){
  editorTool = tool;
  if (tool !== 'select') selectedShapeId = null;
  document.querySelectorAll('.io-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  const stage = document.getElementById('ioStage');
  stage.classList.remove('tool-select','tool-rect','tool-ellipse');
  stage.classList.add('tool-' + tool);
  renderEditorShapes();
}

/* ---------- coordinate helpers ---------- */
function stagePct(clientX, clientY){
  const stage = document.getElementById('ioStage');
  const r = stage.getBoundingClientRect();
  const w = r.width || 1, h = r.height || 1;
  return {
    x: clamp(((clientX - r.left) / w) * 100, 0, 100),
    y: clamp(((clientY - r.top) / h) * 100, 0, 100)
  };
}
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
/* Coerces to a real finite number before clamping — critically, this
   is what stands between a malformed/malicious mask coordinate (from
   a hand-authored or corrupted import file) and a broken-out-of-the-
   attribute HTML injection. A non-numeric string like
   '0%;"><img src=x onerror=alert(1)' concatenated raw into a
   style="left:...%" attribute string genuinely closes the quote and
   injects a live tag — confirmed by direct reproduction while auditing
   this. Number() coercion turns anything non-numeric into NaN, which
   Number.isFinite() catches, so it can never reach the template string. */
function safePct(n){
  const num = Number(n);
  return Number.isFinite(num) ? clamp(num, 0, 100) : 0;
}

/* ---------- rendering ---------- */
function renderEditorShapes(imgSrc){
  const stage = document.getElementById('ioStage');
  const existingImg = stage.querySelector('img');
  const src = imgSrc || (existingImg ? existingImg.getAttribute('src') : '');
  let html = '<img alt="" src="' + (src || '') + '">';

  editorShapes.forEach((s, i)=>{
    const isSelected = s.id === selectedShapeId;
    const cls = 'io-shape shape-' + s.shape + (isSelected ? ' selected' : '');
    html += '<div class="' + cls + '" data-id="' + s.id + '" style="left:' + safePct(s.x) + '%;top:' + safePct(s.y) + '%;width:' + safePct(s.w) + '%;height:' + safePct(s.h) + '%;">' +
      '<span class="io-shape-num">' + (i+1) + '</span></div>';
  });

  if (drawingPreview){
    const cls = 'io-shape shape-' + editorTool + ' drawing';
    html += '<div class="' + cls + '" style="left:' + safePct(drawingPreview.x) + '%;top:' + safePct(drawingPreview.y) + '%;width:' + safePct(drawingPreview.w) + '%;height:' + safePct(drawingPreview.h) + '%;"></div>';
  }

  stage.innerHTML = html;

  // resize handles for the selected shape, select tool only
  if (selectedShapeId && editorTool === 'select'){
    const s = editorShapes.find(x => x.id === selectedShapeId);
    if (s){
      const corners = [
        { cls:'nw', left:s.x, top:s.y },
        { cls:'ne', left:s.x+s.w, top:s.y },
        { cls:'sw', left:s.x, top:s.y+s.h },
        { cls:'se', left:s.x+s.w, top:s.y+s.h },
      ];
      corners.forEach(c=>{
        const h = document.createElement('div');
        h.className = 'io-handle ' + c.cls;
        h.dataset.handle = c.cls;
        h.style.left = c.left + '%';
        h.style.top = c.top + '%';
        stage.appendChild(h);
      });
    }
  }

  renderShapeList();
}
function renderShapeList(){
  const list = document.getElementById('ioShapeList');
  if (!editorShapes.length){
    list.innerHTML = '<p class="io-hint" style="margin:0;">no shapes yet — pick Rectangle or Ellipse and drag on the image above</p>';
    return;
  }
  list.innerHTML = editorShapes.map((s,i)=>
    '<div class="io-shape-row' + (s.id===selectedShapeId?' selected':'') + '" data-id="' + s.id + '">' +
    '<span class="snum-badge' + (s.shape==='ellipse'?' ellipse':'') + '">' + (i+1) + '</span>' +
    '<div class="io-shape-row-fields">' +
      '<input type="text" class="label-input" value="' + escapeHtml(s.label) + '" data-id="' + s.id + '" placeholder="Label (shown on reveal)…">' +
      '<input type="text" class="hint-input" value="' + escapeHtml(s.hint || '') + '" data-id="' + s.id + '" placeholder="Hint (optional, shown on request while hidden)…">' +
    '</div>' +
    '<button type="button" class="del-shape" data-id="' + s.id + '" title="Delete">✕</button>' +
    '</div>'
  ).join('');
  list.querySelectorAll('.label-input').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const s = editorShapes.find(x => x.id === inp.dataset.id);
      if (s) s.label = inp.value;
    });
  });
  list.querySelectorAll('.hint-input').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const s = editorShapes.find(x => x.id === inp.dataset.id);
      if (s) s.hint = inp.value;
    });
  });
  list.querySelectorAll('.del-shape').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      editorShapes = editorShapes.filter(s => s.id !== btn.dataset.id);
      if (selectedShapeId === btn.dataset.id) selectedShapeId = null;
      renderEditorShapes();
    });
  });
  list.querySelectorAll('.io-shape-row').forEach(row=>{
    row.addEventListener('click', (e)=>{
      if (e.target.closest('input') || e.target.closest('.del-shape')) return;
      setEditorTool('select');
      selectedShapeId = row.dataset.id;
      renderEditorShapes();
    });
  });
}

/* ---------- pointer interaction: draw / select / move / resize ---------- */
function cancelSingleFingerAction(){
  dragState = null; dragHandle = null; dragStartPct = null; dragOrigShape = null; drawingPreview = null;
  renderEditorShapes();
}
function initOcclusionEditor(){
  const stage = document.getElementById('ioStage');

  stage.addEventListener('pointerdown', (e)=>{
    if (!editorImgHash) return;
    activePointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
    if (activePointers.size >= 2){
      // A second finger just landed — cancel whatever single-finger
      // draw/move/resize was mid-flight, so no half-finished shape
      // lingers. Scrolling itself is left to happen (or not) on its
      // own; nothing here tries to drive it.
      cancelSingleFingerAction();
      return;
    }
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported — degrade gracefully */ }
    const p = stagePct(e.clientX, e.clientY);
    const handleEl = e.target.closest('.io-handle');
    const shapeEl = e.target.closest('.io-shape:not(.drawing)');

    if (handleEl && selectedShapeId){
      dragState = 'resizing';
      dragHandle = handleEl.dataset.handle;
      dragStartPct = p;
      dragOrigShape = { ...editorShapes.find(s => s.id === selectedShapeId) };
      return;
    }
    if (shapeEl && editorTool === 'select'){
      selectedShapeId = shapeEl.dataset.id;
      dragState = 'moving';
      dragStartPct = p;
      dragOrigShape = { ...editorShapes.find(s => s.id === selectedShapeId) };
      renderEditorShapes();
      return;
    }
    if (editorTool === 'select'){
      selectedShapeId = null;
      renderEditorShapes();
      return;
    }
    // rect/ellipse tool clicked on empty stage — start drawing a new shape
    dragState = 'drawing';
    dragStartPct = p;
    drawingPreview = { x:p.x, y:p.y, w:0, h:0 };
    renderEditorShapes();
  });

  stage.addEventListener('pointermove', (e)=>{
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
    if (activePointers.size >= 2) return; // 2+ fingers down — the draw was already cancelled on pointerdown, nothing to do here
    if (!dragState) return;
    const p = stagePct(e.clientX, e.clientY);

    if (dragState === 'drawing'){
      const x = Math.min(dragStartPct.x, p.x), y = Math.min(dragStartPct.y, p.y);
      const w = Math.abs(p.x - dragStartPct.x), h = Math.abs(p.y - dragStartPct.y);
      drawingPreview = { x, y, w, h };
      renderEditorShapes();
    } else if (dragState === 'moving'){
      const dx = p.x - dragStartPct.x, dy = p.y - dragStartPct.y;
      const s = editorShapes.find(x => x.id === selectedShapeId);
      if (s){
        s.x = clamp(dragOrigShape.x + dx, 0, 100 - dragOrigShape.w);
        s.y = clamp(dragOrigShape.y + dy, 0, 100 - dragOrigShape.h);
        renderEditorShapes();
      }
    } else if (dragState === 'resizing'){
      const dx = p.x - dragStartPct.x, dy = p.y - dragStartPct.y;
      const s = editorShapes.find(x => x.id === selectedShapeId);
      if (s){
        let { x, y, w, h } = dragOrigShape;
        if (dragHandle === 'nw'){ x += dx; y += dy; w -= dx; h -= dy; }
        else if (dragHandle === 'ne'){ y += dy; w += dx; h -= dy; }
        else if (dragHandle === 'sw'){ x += dx; w -= dx; h += dy; }
        else if (dragHandle === 'se'){ w += dx; h += dy; }
        const MIN = 2;
        if (w < MIN){ if (dragHandle==='nw'||dragHandle==='sw') x -= (MIN-w); w = MIN; }
        if (h < MIN){ if (dragHandle==='nw'||dragHandle==='ne') y -= (MIN-h); h = MIN; }
        x = clamp(x, 0, 100 - w);
        y = clamp(y, 0, 100 - h);
        w = Math.min(w, 100 - x);
        h = Math.min(h, 100 - y);
        s.x = x; s.y = y; s.w = w; s.h = h;
        renderEditorShapes();
      }
    }
  });

  stage.addEventListener('pointerup', (e)=>{
    activePointers.delete(e.pointerId);
    if (activePointers.size >= 1) return; // still mid a multi-finger gesture — don't finalize a shape from a leftover finger lifting
    let justDrewShapeId = null;
    if (dragState === 'drawing' && drawingPreview){
      if (drawingPreview.w >= 2 && drawingPreview.h >= 2){
        const newShape = { id: uid(), shape: editorTool, x:drawingPreview.x, y:drawingPreview.y, w:drawingPreview.w, h:drawingPreview.h, label: 'Region ' + (editorShapes.length+1), hint: '' };
        editorShapes.push(newShape);
        justDrewShapeId = newShape.id;
      }
      drawingPreview = null;
    }
    dragState = null; dragHandle = null; dragStartPct = null; dragOrigShape = null;
    renderEditorShapes();
    if (justDrewShapeId){
      // The PowerPoint-style "just drew a text box, cursor's ready to
      // type" feel — jump straight into the hint field for the shape
      // you just finished drawing instead of leaving focus nowhere.
      const hintInput = document.querySelector('.hint-input[data-id="' + justDrewShapeId + '"]');
      if (hintInput) hintInput.focus();
    }
  });
  stage.addEventListener('pointercancel', (e)=>{
    activePointers.delete(e.pointerId);
    cancelSingleFingerAction();
  });

  document.getElementById('uploadZone').addEventListener('click', ()=> document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0];
    if (file) handleImageFile(file);
    e.target.value = '';
  });
  document.addEventListener('paste', (e)=>{
    if (!document.getElementById('screenEditor').classList.contains('active')) return;
    if (document.getElementById('editorUploadStep').style.display === 'none') return;
    const items = (e.clipboardData || {}).items || [];
    for (const item of items){
      if (item.type && item.type.startsWith('image/')){
        const file = item.getAsFile();
        if (file) handleImageFile(file);
        break;
      }
    }
  });

  document.querySelectorAll('.io-tool').forEach(btn=>{
    btn.addEventListener('click', ()=> setEditorTool(btn.dataset.tool));
  });
  document.getElementById('ioDeleteShapeBtn').addEventListener('click', ()=>{
    if (!selectedShapeId) return;
    editorShapes = editorShapes.filter(s => s.id !== selectedShapeId);
    selectedShapeId = null;
    renderEditorShapes();
  });

  document.getElementById('modeChoice').addEventListener('click', (e)=>{
    const btn = e.target.closest('.mode-opt'); if (!btn) return;
    editorMode = btn.dataset.mode;
    document.querySelectorAll('.mode-opt').forEach(b=>b.classList.toggle('active', b===btn));
  });

  document.getElementById('editorBackBtn').addEventListener('click', ()=>{ showScreen('screenWall'); renderTree(); });
  document.getElementById('addOcclusionCardsBtn').addEventListener('click', addOcclusionShapesToStaged);

  // Anki-style tool hotkeys, active only while this screen is showing and no field has focus
  document.addEventListener('keydown', (e)=>{
    if (!document.getElementById('screenEditor').classList.contains('active')) return;
    if (document.getElementById('editorMaskStep').style.display === 'none') return;
    const typing = ['INPUT','TEXTAREA'].includes(document.activeElement.tagName);
    if (typing) return;
    if (e.key === 'v' || e.key === 'V'){ e.preventDefault(); setEditorTool('select'); }
    else if (e.key === 'r' || e.key === 'R'){ e.preventDefault(); setEditorTool('rect'); }
    else if (e.key === 'o' || e.key === 'O'){ e.preventDefault(); setEditorTool('ellipse'); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeId){
      e.preventDefault();
      editorShapes = editorShapes.filter(s => s.id !== selectedShapeId);
      selectedShapeId = null;
      renderEditorShapes();
    }
    else if (e.key === 'Escape' && selectedShapeId){
      e.preventDefault();
      selectedShapeId = null;
      renderEditorShapes();
    }
  });
}

/* ---------- generate cards: one per shape, shared image + shape set ---------- */
/* Adds the currently-drawn shapes as cards to the SHARED staged pile
   for this brick (see basic-cloze.js) rather than finalizing a deck
   immediately — you can keep adding more occlusion images, or switch
   to the Basic/Cloze tab, and everything accumulates until you
   explicitly hit "Create brick". After adding, resets back to the
   upload step so a second image can be occluded into the same brick. */
function addOcclusionShapesToStaged(){
  if (!editorImgHash){ announce('Upload an image first.'); return; }
  if (!editorShapes.length){ announce('Draw at least one shape.'); return; }

  const header = document.getElementById('headerInput').value.trim();
  const backExtra = document.getElementById('backExtraInput').value.trim();
  const shapesSnapshot = editorShapes.map(s => ({ ...s }));
  const cards = shapesSnapshot.map(s => ({
    id: uid(), type:'occlusion', imgHash: editorImgHash, imgW: editorImgW, imgH: editorImgH,
    masks: shapesSnapshot, activeMaskId: s.id, mode: editorMode,
    header, backExtra,
    timeouts: 0, tough: false, createdAt: Date.now()
  }));
  stagedCards.push(...cards);
  announce(cards.length + ' card' + (cards.length===1?'':'s') + ' added — ' + stagedCards.length + ' staged for this brick so far.');
  updateStagedCounter();

  // back to a clean upload step, ready for another image if wanted
  editorImgHash = null; editorShapes = []; selectedShapeId = null;
  document.getElementById('headerInput').value = '';
  document.getElementById('backExtraInput').value = '';
  document.getElementById('editorUploadStep').style.display = '';
  document.getElementById('editorMaskStep').style.display = 'none';
}
