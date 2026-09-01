'use strict';
/* =====================================================================
   scheduler.js — SM-2-style spaced repetition, same shape as Kardex's
   computeAllSRS(): ease starts at 2.5, 1-day then 6-day then
   interval*ease, a miss resets reps to 0.

   This is NOT true FSRS. If you want real FSRS stability/difficulty
   updates, that's a bigger swap — this file is the only place you'd
   need to touch to do it, since nothing else reads reviewLog directly.
   ===================================================================== */

function computeSRS(reviewLog){
  const DAY = 24*3600*1000;
  const byCard = new Map();
  reviewLog.forEach(r=>{
    if (!byCard.has(r.cardId)) byCard.set(r.cardId, []);
    byCard.get(r.cardId).push(r);
  });
  const map = new Map();
  byCard.forEach((entries, cardId)=>{
    entries.sort((a,b)=>a.ts-b.ts);
    let ease=2.5, interval=0, reps=0, dueDate=0;
    entries.forEach(r=>{
      const q = r.good ? 5 : 2;
      ease = Math.max(1.3, ease + (0.1 - (5-q)*(0.08+(5-q)*0.02)));
      if (!r.good){ reps = 0; interval = 0; }
      else {
        if (reps === 0) interval = 1;
        else if (reps === 1) interval = 6;
        else interval = Math.round(interval*ease);
        reps += 1;
      }
      dueDate = r.ts + interval*DAY;
    });
    map.set(cardId, { ease, interval, reps, dueDate });
  });
  return map;
}
function isCardDue(cardId, srsMap){
  const s = srsMap.get(cardId);
  return !s || s.dueDate <= Date.now();
}
function cardHasHistory(cardId, srsMap){ return srsMap.has(cardId); }
