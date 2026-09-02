'use strict';
/* =====================================================================
   text-format.js — the only place that knows how the bold/italic/
   underline/highlight markers render, and how [[cloze]] brackets split
   into front/back. Both the editor's live preview and study.js's card
   rendering call into this, so formatting only ever needs to be gotten
   right in one spot.
   ===================================================================== */

function formatInline(str){
  let html = escapeHtml(str || '');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
             .replace(/__(.+?)__/g, '<u>$1</u>')
             .replace(/\*(.+?)\*/g, '<em>$1</em>')
             .replace(/==(.+?)==/g, '<span class="highlight">$1</span>');
  return html.replace(/\n/g, '<br>');
}

function clozeIsValid(text){ return !!text && /\[\[.+?\]\]/.test(text); }

/* Token-based split rather than regex-substitution-on-already-escaped-
   HTML: extracting [[...]] spans BEFORE formatting each surrounding
   text segment avoids the escaping/re-matching pitfalls of trying to
   inject HTML into a string that's already been through escapeHtml(). */
function clozeFrontBack(rawText){
  rawText = rawText || '';
  const parts = [];
  let idx = 0;
  const re = /\[\[(.+?)\]\]/g;
  let m;
  while ((m = re.exec(rawText))){
    if (m.index > idx) parts.push({ type:'text', value: rawText.slice(idx, m.index) });
    parts.push({ type:'cloze', value: m[1] });
    idx = re.lastIndex;
  }
  if (idx < rawText.length) parts.push({ type:'text', value: rawText.slice(idx) });
  if (!parts.length) return { front:'', back:'' };

  const front = parts.map(p => p.type === 'text' ? formatInline(p.value) : '<span class="cloze-blank">[...]</span>').join('');
  const back = parts.map(p => p.type === 'text' ? formatInline(p.value) : '<span class="cloze-answer">' + formatInline(p.value) + '</span>').join('');
  return { front, back };
}

/* Generic selection-wrapping for the format toolbar buttons — works on
   any textarea by id, so Basic's front/back fields and Cloze's single
   field can all share the same four buttons' worth of logic. */
function wrapSelection(textareaId, marker){
  const el = document.getElementById(textareaId);
  if (!el) return;
  const s = el.selectionStart, e = el.selectionEnd;
  const val = el.value;
  el.value = val.slice(0, s) + marker + val.slice(s, e) + marker + val.slice(e);
  el.focus();
  el.selectionStart = s + marker.length;
  el.selectionEnd = e + marker.length;
}
/* Same idea as wrapSelection, but for an asymmetric pair like [[ ]]
   (cloze syntax) where the open and close markers differ — a single
   shared `marker` string can't express that. No selection: inserts
   both markers with the cursor sitting between them, ready to type.
   A selection exists: wraps exactly that text and keeps it selected,
   same behavior wrapSelection already has for B/I/U/H. */
function wrapSelectionPair(textareaId, openMarker, closeMarker){
  const el = document.getElementById(textareaId);
  if (!el) return;
  const s = el.selectionStart, e = el.selectionEnd;
  const val = el.value;
  el.value = val.slice(0, s) + openMarker + val.slice(s, e) + closeMarker + val.slice(e);
  el.focus();
  if (s === e){
    el.selectionStart = el.selectionEnd = s + openMarker.length;
  } else {
    el.selectionStart = s + openMarker.length;
    el.selectionEnd = e + openMarker.length;
  }
}
