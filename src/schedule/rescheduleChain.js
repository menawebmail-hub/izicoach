// Reschedule chains over a series' dateCancellations (pure, no React). Moved verbatim from
// App.jsx so pure modules and tests share the one walk Agenda, Cobros, pauses and resumes use.

// Follows a chain of dateCancellations rescheduledTo pointers (a class
// reprogrammed more than once, e.g. X→Y→Z) to its terminal date. Shared by
// expandClasses (display: what date is this occurrence actually happening on)
// and the pause interceptor in handleSaveClass (which future dates count as
// this student's remaining contracted sessions) — both must agree on the walk,
// or Agenda and the pause could disagree about where a rescheduled class
// actually lands. `visited` bounds the walk naturally — it can grow at most
// Object.keys(dateCancellations).length+1 times before either running out of
// chain (clean terminal) or hitting a repeat (cycle) — no arbitrary max needed.
// Returns {date:terminal,cancelInfo,broken:false} on a clean walk (cancelInfo
// is whatever dateCancellations entry, if any, exists AT the terminal — e.g. a
// further pending "sin fecha" reprogram, or null for a genuinely live date),
// or {cancelInfo,broken:true} if the chain cycles (X→Y→X or self-reference).
export const resolveRescheduleChain=(dateCancellations,startDate)=>{
  const dc=dateCancellations||{};
  let current=startDate;
  const visited=new Set([startDate]);
  while(dc[current]&&dc[current].cancelType==="cancelled_reprog"&&dc[current].rescheduledTo){
    const next=dc[current].rescheduledTo;
    if(visited.has(next)) return {cancelInfo:dc[current],broken:true};
    visited.add(next);
    current=next;
  }
  return {date:current,cancelInfo:dc[current]||null,broken:false};
};

// Resolves ONE contracted date to its full status via resolveRescheduleChain:
// the effective terminal of its reschedule chain (if any), whatever
// dateCancellations entry (if any) sits AT that terminal, and whether the
// chain was unresolvable (cycle). Unlike resolveEffectiveComboDates below
// (which discards any terminal that isn't a clean live date — built for the
// pause interceptor's c.occurrences matching), this exposes the terminal's
// own cancelInfo untouched: a caller like ResumeModal needs to tell "this
// contracted session's terminal is now paused" apart from "it's a live
// upcoming class" apart from "still pending reprogramming", which a filter
// that already discards non-clean terminals can't do.
export const resolveComboDateStatus=(dateCancellations,originalDate)=>{
  const {date,cancelInfo,broken}=resolveRescheduleChain(dateCancellations,originalDate);
  if(broken) return {original:originalDate,terminal:null,cancelInfo:null,broken:true};
  return {original:originalDate,terminal:date,cancelInfo,broken:false};
};

// Read-only trace of a contracted date's full reschedule history, for Cobros:
// [originalDate, ...every destination in order]. Same walk and cycle guard as
// resolveRescheduleChain (deliberately not changed — Agenda depends on it); a
// cyclic/self-referential chain stops before revisiting a date and reports
// broken, still returning the reachable path.
export const traceRescheduleHistory=(dateCancellations,startDate)=>{
  const dc=dateCancellations||{};
  const path=[startDate];
  const visited=new Set([startDate]);
  let current=startDate;
  while(dc[current]&&dc[current].cancelType==="cancelled_reprog"&&dc[current].rescheduledTo){
    const next=dc[current].rescheduledTo;
    if(visited.has(next)) return {path,broken:true};
    visited.add(next);
    path.push(next);
    current=next;
  }
  return {path,broken:false};
};
