'use strict';
/* =====================================================================
   imgbb-backup.js — the mandatory batch-backup flow.

   ImgBB's own API docs (api.imgbb.com) publish no numeric rate limit
   at all — no requests-per-minute, no requests-per-hour, nothing.
   Third-party sources only say "expect rate limits, use a queue" with
   no figures either. With no published ceiling to calibrate against,
   these constants are deliberately conservative rather than tuned —
   small batches, real pauses between them, and a real pause between
   individual uploads within a batch too, so nothing here ever looks
   like a burst even to an aggressive per-IP limiter.

   These are `let`, not `const`, on purpose: the test suite shrinks
   them to near-zero so it can verify the batching/pausing STRUCTURE
   deterministically without actually waiting a real minute per batch.
   ===================================================================== */

let IMGBB_BATCH_SIZE = 5;              // images per batch
let IMGBB_INTRA_BATCH_DELAY_MS = 2000; // pause between each image within a batch
let IMGBB_BATCH_PAUSE_MS = 60000;      // pause between batches
let IMGBB_MAX_RETRIES_PER_IMAGE = 2;   // extra attempts before giving up on one image

function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

/* ---------- which images actually need backing up ---------- */
function getAllReferencedImageHashes(){
  const hashes = new Set();
  (function walk(n){
    if (n.type === 'deck') n.cards.forEach(c => { if (c.type === 'occlusion' && c.imgHash) hashes.add(c.imgHash); });
    else n.children.forEach(walk);
  })(tree);
  return hashes;
}
function getPendingBackupImageHashes(){
  const all = getAllReferencedImageHashes();
  const map = loadImageUrlMap();
  return Array.from(all).filter(h => !map[h]);
}

/* ---------- topbar badge: a standing notification that backup would
   help, shown whenever there's no key yet AND there's something to
   back up — doesn't nag with a popup, just stays visible until acted on ---------- */
function updateSettingsBadge(){
  const btn = document.getElementById('settingsBtn');
  if (!btn) return;
  const hasKey = !!loadImgbbKey();
  const pendingCount = getPendingBackupImageHashes().length;
  const shouldShow = !hasKey && pendingCount > 0;
  let dot = btn.querySelector('.settings-badge-dot');
  if (shouldShow){
    if (!dot){
      dot = document.createElement('span');
      dot.className = 'settings-badge-dot';
      btn.appendChild(dot);
    }
    btn.setAttribute('aria-label', 'Settings — ' + pendingCount + ' image' + (pendingCount===1?'':'s') + ' could be backed up to ImgBB');
  } else if (dot){
    dot.remove();
    btn.setAttribute('aria-label', 'Settings');
  }
}

/* ---------- the mandatory batch runner ---------- */
let backupRunning = false;
async function runMandatoryImgbbBackup(){
  const pending = getPendingBackupImageHashes();
  if (!pending.length || backupRunning) return;
  backupRunning = true;

  const total = pending.length;
  let done = 0, failed = 0;
  openImgbbUploadModal(total);

  for (let i = 0; i < pending.length; i += IMGBB_BATCH_SIZE){
    const batch = pending.slice(i, i + IMGBB_BATCH_SIZE);
    const batchNum = Math.floor(i / IMGBB_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(pending.length / IMGBB_BATCH_SIZE);

    for (let b = 0; b < batch.length; b++){
      const hash = batch[b];
      updateImgbbUploadProgress(done + failed, total, 'Uploading ' + (done + failed + 1) + ' of ' + total + '… (batch ' + batchNum + ' of ' + totalBatches + ')');
      const ok = await uploadOneWithRetries(hash);
      if (ok) done++; else failed++;
      if (b < batch.length - 1) await sleep(IMGBB_INTRA_BATCH_DELAY_MS);
    }

    const isLastBatch = (i + IMGBB_BATCH_SIZE) >= pending.length;
    if (!isLastBatch){
      updateImgbbUploadProgress(done + failed, total, 'Pausing before the next batch, to stay safely under ImgBB\'s usage limits…');
      await sleep(IMGBB_BATCH_PAUSE_MS);
    }
  }

  backupRunning = false;
  finishImgbbUploadModal(done, failed, total);
  updateSettingsBadge();
}

async function uploadOneWithRetries(hash){
  const rec = await getImage(hash);
  if (!rec) return false;
  let attempt = 0;
  while (attempt <= IMGBB_MAX_RETRIES_PER_IMAGE){
    const result = await uploadImageToImgbbDetailed(hash, rec.dataUrl);
    if (result.ok) return true;
    attempt++;
    if (attempt > IMGBB_MAX_RETRIES_PER_IMAGE) return false;
    // Respect a real Retry-After if the server sent one; otherwise just
    // use the same conservative intra-batch delay as a generic backoff.
    await sleep(result.retryAfter || IMGBB_INTRA_BATCH_DELAY_MS);
  }
  return false;
}

/* ---------- modal UI ---------- */
function openImgbbUploadModal(total){
  document.getElementById('imgbbUploadTotal').textContent = total;
  document.getElementById('imgbbUploadStatus').textContent = 'Starting…';
  document.getElementById('imgbbUploadBarFill').style.width = '0%';
  document.getElementById('imgbbUploadDoneRow').style.display = 'none';
  document.getElementById('imgbbUploadOverlay').classList.add('active');
}
function updateImgbbUploadProgress(completed, total, statusText){
  const pct = total ? Math.round((completed / total) * 100) : 0;
  document.getElementById('imgbbUploadBarFill').style.width = pct + '%';
  document.getElementById('imgbbUploadStatus').textContent = statusText;
  document.getElementById('imgbbUploadCount').textContent = completed + ' / ' + total;
}
function finishImgbbUploadModal(done, failed, total){
  document.getElementById('imgbbUploadBarFill').style.width = '100%';
  document.getElementById('imgbbUploadStatus').textContent =
    failed ? (done + ' of ' + total + ' backed up — ' + failed + ' failed and can be retried later.') : ('All ' + total + ' images backed up.');
  document.getElementById('imgbbUploadDoneRow').style.display = '';
  announce(failed ? (done + ' of ' + total + ' images backed up to ImgBB, ' + failed + ' failed') : ('All ' + total + ' images backed up to ImgBB'));
}

function initImgbbBackup(){
  document.getElementById('imgbbUploadDoneBtn').addEventListener('click', ()=>{
    document.getElementById('imgbbUploadOverlay').classList.remove('active');
    renderImgbbSection();
  });
  updateSettingsBadge();
}
