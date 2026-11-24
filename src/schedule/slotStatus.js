import { resolveComboDateStatus, traceRescheduleHistory } from "./rescheduleChain.js";
import { countUsedForCombo, hasSlotMoves, planSlotMove, resolveComboMoves } from "./slotMoves.js";
import { readAttendance, seriesIdOf, slotCardOn, slotClassId } from "./attendanceRead.js";
import { effectiveTimeEnd } from "./occurrenceOverrides.js";
import { normalizeDeletedDates } from "./deletedDates.js";

/*
 * Per-slot reading of a student's combo (Cobros, Mis Clases, Agenda payment chips, "Por dar").
 * BUG-AGENDA-05 stage 1 (= BUG-AGENDA-03 stage 0): the helpers below were moved VERBATIM from App.jsx (only
 * `export` added), and createSlotReader is the single entry point the consumers use, so later stages can teach
 * ONE place about per-student moves (recoveries, extensions) without touching every consumer.
 * Pure, no React. isClassDone reads the clock when called.
 */

// Check if a class date+timeEnd has passed (dynamic - called at render time)
const CLASS_DONE_MARGIN=30; // minutes after class ends before auto-realizing
export const isClassDone=(date,timeEnd)=>{
  if(!date) return false;
  const now=new Date();
  const todayStr=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
  if(date<todayStr) return true;
  if(date>todayStr) return false;
  const [eh,em]=(timeEnd||"23:59").split(":").map(Number);
  const endWithMargin=new Date(now.getFullYear(),now.getMonth(),now.getDate(),eh,em+CLASS_DONE_MARGIN);
  return now>=endWithMargin;
};

// Single interpretation of one ORIGINAL contracted date (combo.dates entry) for
// Cobros, resolved to the terminal of its reschedule chain. The row's economic
// identity stays originalDate; terminalDate/reschedulePath are information only.
// A terminal that is paused reads as Pausada (expandClasses deliberately hides
// non-live terminals from its cards, which is right for Agenda but made Cobros
// read such a chain as "A Reprogramar"). Never mutates its input.
export const interpretContractDate=(rawDateCancellations,originalDate)=>{
  // Safe class deletion: a deleted date reads with the existing semantics (src/schedule/deletedDates.js).
  const dateCancellations=normalizeDeletedDates(rawDateCancellations);
  const {terminal,cancelInfo,broken}=resolveComboDateStatus(dateCancellations,originalDate);
  const {path}=traceRescheduleHistory(dateCancellations,originalDate);
  const wasRescheduled=path.length>1;
  if(broken){
    return {originalDate,terminalDate:null,cancelInfo:null,reschedulePath:path,terminalStatus:"inconsistent",isPaused:false,isCompensated:false,isCancelled:false,isReprogrammed:false,isReprogramPending:true,wasRescheduled};
  }
  const t=cancelInfo?cancelInfo.cancelType:null;
  const isPaused=t==="paused";
  const isCancelled=t==="cancelled";
  const isReprogrammed=wasRescheduled&&cancelInfo===null;
  const isReprogramPending=t==="cancelled_reprog"||(wasRescheduled&&cancelInfo!==null&&!isPaused&&!isCancelled);
  const terminalStatus=isPaused?"paused":isCancelled?"cancelled":isReprogramPending?"pending":isReprogrammed?"reprogrammed":"normal";
  const isCompensated=isPaused&&!!(cancelInfo&&cancelInfo.compensated);
  const isDeleted=!!(cancelInfo&&cancelInfo.deleted);
  return {originalDate,terminalDate:terminal,cancelInfo,reschedulePath:path,terminalStatus,isPaused,isCompensated,isCancelled,isReprogrammed,isReprogramPending,wasRescheduled,isDeleted};
};

// Shared by getAccountCounters and PagoModal.buildAllDates so list and counters
// can never disagree. The series row is found via combo.sourceClassId (expanded
// cards keep the series id in `id`, plus `_seriesId`); a card without
// dateCancellations (legacy/single class) keeps the previous top-level-flags
// reading, and so does any date the series has no entry for.
export const resolveContractSlotStatus=(myClasses,combo,originalDate,clsForDate)=>{
  const series=(combo&&combo.sourceClassId!==undefined)?myClasses.find(cl=>cl.id===combo.sourceClassId||cl._seriesId===combo.sourceClassId):undefined;
  const dc=(series&&series.dateCancellations)||(clsForDate&&clsForDate.dateCancellations)||null;
  if(dc){
    const r=interpretContractDate(dc,originalDate);
    if(r.terminalStatus!=="normal"){
      // A paused terminal is "compensated" once a resume replaced it: its dateCancellations
      // entry says so (compensated), and so does the combo's resumeOperations[].pausedDates —
      // either is enough, so a lost compensatedBy never hides the fact.
      const compensatedByOps=r.isPaused&&(combo&&combo.resumeOperations||[]).some(op=>(op.pausedDates||[]).includes(r.terminalDate));
      return {...r,isCompensated:r.isCompensated||!!compensatedByOps,isReprogWithDate:r.isReprogrammed,isReprogNoDate:r.isReprogramPending,rescheduledTo:r.isReprogrammed?r.terminalDate:null,
        fulfillCancelled:r.isCancelled||r.isReprogrammed||r.isReprogramPending,
        fulfillCancelType:r.isCancelled?"cancelled":(r.isReprogrammed||r.isReprogramPending)?"cancelled_reprog":null};
    }
  }
  const cancelled=clsForDate?clsForDate.cancelled:undefined;
  const cancelType=clsForDate?clsForDate.cancelType:undefined;
  const rescheduledTo=clsForDate?clsForDate.rescheduledTo:undefined;
  const isCancelled=!!(cancelled&&cancelType==="cancelled");
  const isReprogWithDate=!!(cancelled&&cancelType==="cancelled_reprog"&&rescheduledTo);
  const isReprogNoDate=!!(cancelled&&cancelType==="cancelled_reprog"&&!rescheduledTo);
  const isPaused=!!((clsForDate&&clsForDate.paused)||cancelType==="paused");
  return {originalDate,terminalDate:isReprogWithDate?rescheduledTo:originalDate,cancelInfo:null,reschedulePath:isReprogWithDate?[originalDate,rescheduledTo]:[originalDate],
    terminalStatus:isPaused?"paused":isCancelled?"cancelled":isReprogNoDate?"pending":isReprogWithDate?"reprogrammed":"normal",
    isPaused,isCompensated:false,isCancelled,isReprogrammed:isReprogWithDate,isReprogramPending:isReprogNoDate,wasRescheduled:isReprogWithDate,
    isReprogWithDate,isReprogNoDate,rescheduledTo:rescheduledTo||null,fulfillCancelled:cancelled,fulfillCancelType:cancelType};
};

/**
 * Whether one reading (readAttendance) consumes the class: explicit Presente / Ausente – Dada yes; explicit Ausente –
 * No dada or an entry without the student no; an advance notice Ausente – Dada only once the class has happened
 * (date + end time, like every time-based reading); a notice Ausente – No dada never. null = nothing recorded.
 */
export const givenByReading=(r,date,timeEnd)=>{
  if(!r||!r.source) return null;
  if(r.source==="attendance") return r.state==="present"||r.state==="ausente_dada";
  if(r.source==="notice") return r.state==="ausente_dada"&&isClassDone(date,timeEnd);
  return null;
};

// Shared "was this contractual slot delivered" rule (Cobros counters and getClaseRem):
// evaluated on the effective fulfillment date, never on both original and destination.
// A paused slot is never delivered; a definitively-cancelled Combo slot is billed and
// consumed like a delivered one (Individual is deliberately not extended).
// Stage 2.0 (BUG-AGENDA-05): classId = the slot's own class; its attendance is read only there (readAttendance), never
// from another class of the student on the same date. Without a known class (a legacy slot with no card) the previous
// date-only reading is kept.
export const resolveSlotGiven=(slot,packType,originalDate,timeEnd,myClasses,studentId,classId)=>{
  if(slot.isPaused) return false;
  if(slot.isCancelled) return packType==="combo";
  const fulfillmentDate=getSlotFulfillmentDate(originalDate,slot.fulfillCancelled,slot.fulfillCancelType,slot.rescheduledTo);
  if(!fulfillmentDate) return false;
  if(classId!==undefined&&classId!==null){
    const given=givenByReading(readAttendance({classes:myClasses,classId,date:fulfillmentDate,studentId}),fulfillmentDate,timeEnd);
    if(given!==null) return given;
    return isClassDone(fulfillmentDate,timeEnd);
  }
  const att=myClasses.flatMap(cls=>cls.attendanceLog||[]).find(e=>e.date===fulfillmentDate);
  if(att) return (att.present||[]).includes(studentId)||(att.ausente_dada||[]).includes(studentId);
  return isClassDone(fulfillmentDate,timeEnd);
};

// Single source of truth for "which date decides whether a combo slot is fulfilled" —
// shared by getAccountCounters, isComboClosed and the renewal checks (PaymentCard,
// Dashboard) so none of them re-implement a different rule for the same slot. A slot
// reprogrammed with a rescheduledTo is fulfilled by that new date, never by its
// original one; a slot still pending reprogramming (no rescheduledTo yet) is never
// fulfilled.
export function getSlotFulfillmentDate(originalDate, cancelled, cancelType, rescheduledTo) {
  if(cancelled&&cancelType==="cancelled_reprog") return rescheduledTo||null;
  return originalDate;
}

/**
 * Where one slot of `combo` is for `studentId` WITHOUT student moves (its base terminal, read exactly like Cobros)
 * and whether it is pending for this student there: a class-level "A Reprogramar" (or inconsistent chain), or an
 * explicit Ausente – No dada at its live terminal. `lookup` must hold the attendance of that class (cards or rows).
 */
export function slotBaseLocator({ classes, lookup, combo, studentId }) {
  const list = classes || [];
  const all = lookup || list;
  return (date) => {
    const card = slotCardOn(list, combo, date);
    const s = resolveContractSlotStatus(list, combo, date, card);
    const classId = slotClassId(list, combo, date);
    if (classId === undefined) return null;
    if (s.terminalStatus === "pending" || s.terminalStatus === "inconsistent") return { classId, date: s.terminalDate || date, pending: true };
    if (s.terminalStatus === "paused" || s.terminalStatus === "cancelled" || !s.terminalDate) return { classId, date: s.terminalDate || date, pending: false };
    const pending = readAttendance({ classes: all, classId, date: s.terminalDate, studentId }).state === "ausente_reprog";
    return { classId, date: s.terminalDate, pending };
  };
}

/**
 * The shared reader of one combo's slots for one student: exactly resolveContractSlotStatus + resolveSlotGiven as
 * Cobros has always composed them (the card of a date is the first of `classes` on that date; its timeEnd, else
 * "23:59"), with the slot reading memoized per date for the duration of one reading. Read-only.
 *   status(date)    -> resolveContractSlotStatus(classes, combo, date, card)
 *   isGiven(date)   -> resolveSlotGiven(status(date), combo.packType, date, timeEnd, classes, studentId)
 *   cardFor(date), timeEndFor(date)
 * Stage 1d: a combo with `slotMoves` (src/schedule/slotMoves.js; nothing writes them yet) reads its validly moved slots
 * at their destination, found in `allClasses` (default `classes`): status(date) keeps the slot's base fields and its
 * position, and reads as a reprogramming with date to the destination (or "A Reprogramar" again when the recovery was
 * missed), with `studentMoves`, `terminalClassId` and `recoveryState` added; isGiven(date) is true only for an explicit
 * Presente / Ausente – Dada there. A combo without slotMoves takes the exact previous path (no extra work).
 *   moves() -> { bySlot, conflicts } (resolveComboMoves)
 */
export function createSlotReader({ classes, combo, studentId, allClasses }) {
  const list = classes || [];
  const memo = new Map();
  // Stage 2.0: the card of the slot's own class on that date (a legacy combo keeps the first card on that date).
  const cardFor = (date) => slotCardOn(list, combo, date);
  const timeEndFor = (date) => {
    const card = cardFor(date);
    return (card && card.timeEnd) || "23:59";
  };
  const baseStatus = (date) => {
    if (!memo.has(date)) memo.set(date, resolveContractSlotStatus(list, combo, date, cardFor(date)));
    return memo.get(date);
  };
  const withMoves = hasSlotMoves(combo);
  let resolved = null;
  const moves = () => {
    if (!resolved) {
      resolved = withMoves
        ? resolveComboMoves({ combo, studentId, classes: allClasses || list, baseOf: slotBaseLocator({ classes: list, lookup: allClasses || list, combo, studentId }) })
        : { bySlot: new Map(), conflicts: [] };
    }
    return resolved;
  };
  const overlay = new Map();
  const status = (date) => {
    const base = baseStatus(date);
    if (!withMoves) return base;
    const m = moves().bySlot.get(date);
    if (!m) return base;
    if (!overlay.has(date)) {
      const loc = m.location;
      const again = loc.state === "missed";
      overlay.set(date, {
        ...base,
        terminalDate: loc.date,
        terminalClassId: loc.classId,
        reschedulePath: [...(base.reschedulePath && base.reschedulePath.length ? base.reschedulePath : [date]), ...m.moves.map((x) => x.to.date)],
        terminalStatus: again ? "pending" : "reprogrammed",
        isPaused: false, isCompensated: false, isCancelled: false,
        isReprogrammed: !again, isReprogramPending: again, wasRescheduled: true,
        isReprogWithDate: !again, isReprogNoDate: again,
        rescheduledTo: again ? null : loc.date,
        fulfillCancelled: true, fulfillCancelType: "cancelled_reprog",
        studentMoves: m.history,
        recoveryState: loc.state,
      });
    }
    return overlay.get(date);
  };
  const isGiven = (date) => {
    if (withMoves) {
      const m = moves().bySlot.get(date);
      if (m) return m.location.state === "given";
    }
    return resolveSlotGiven(baseStatus(date), combo.packType, date, timeEndFor(date), list, studentId, slotClassId(list, combo, date));
  };
  return { status, isGiven, cardFor, timeEndFor, moves };
}

/** planSlotMove wired to the Cobros base reading (expanded Agenda cards in `classes`). Not used by any UI yet. */
export function planStudentSlotMove({ classes, student, combo, slot, to, kind, id, at }) {
  const baseOfFor = (c) => slotBaseLocator({ classes: (classes || []).filter((cl) => cl.students && cl.students.includes(student.id)), lookup: classes, combo: c, studentId: student.id });
  return planSlotMove({ student, combo, slot, to, kind, classes, baseOfFor, id, at });
}

// ---- `used` and advance notices (BUG-AGENDA-05 stage 2.1 review) ----
const sameSeries = (c, id) => String(seriesIdOf(c)) === String(id);

/**
 * Slots of `combo` consumed ONLY by an advance Ausente – Dada notice of its own class whose class has already happened
 * (no attendance of the student that day): exactly what explicit-attendance `used` cannot see. Each terminal once;
 * paused / cancelled / pending terminals never. A legacy combo without sourceClassId has no notices -> 0.
 */
export function dueDadaNoticeCount({ combo, studentId, classes }) {
  if (!combo || combo.sourceClassId === undefined) return 0;
  const rows = (classes || []).filter((c) => sameSeries(c, combo.sourceClassId));
  if (rows.length === 0 || !rows.some((c) => c.attendanceNotices && Object.keys(c.attendanceNotices).length)) return 0;
  const dc = rows[0].dateCancellations || {};
  const seen = new Set();
  for (const d of new Set(combo.dates || [])) {
    const r = resolveComboDateStatus(dc, d);
    if (r.broken || !r.terminal || seen.has(r.terminal) || r.cancelInfo) continue;
    const reading = readAttendance({ classes: rows, classId: combo.sourceClassId, date: r.terminal, studentId });
    // stage 2.2: the end time of THAT date (its own override, else the series)
    if (reading.source === "notice" && reading.state === "ausente_dada" && isClassDone(r.terminal, effectiveTimeEnd(rows[0], r.terminal))) seen.add(r.terminal);
  }
  return seen.size;
}

/**
 * The `used` to read for a combo: the stored value, unless due Ausente – Dada notices exist — then the explicit
 * attendance count plus those notices, never below the stored value. Without due notices it IS combo.used.
 */
export function effectiveComboUsed({ combo, studentId, classes }) {
  const stored = Number((combo && combo.used) || 0);
  const due = dueDadaNoticeCount({ combo, studentId, classes });
  if (!due) return stored;
  const rows = (classes || []).filter((c) => sameSeries(c, combo.sourceClassId));
  const byDate = new Map();
  for (const c of rows) for (const e of c.attendanceLog || []) if (e && !byDate.has(e.date)) byDate.set(e.date, e);
  const explicit = countUsedForCombo({ combo, studentId, dc: rows[0].dateCancellations || {}, attendanceLog: [...byDate.values()], baseClassId: combo.sourceClassId, classes });
  return Math.max(stored, explicit + due);
}
