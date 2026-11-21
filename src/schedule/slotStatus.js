import { resolveComboDateStatus, traceRescheduleHistory } from "./rescheduleChain.js";

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
export const interpretContractDate=(dateCancellations,originalDate)=>{
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
  return {originalDate,terminalDate:terminal,cancelInfo,reschedulePath:path,terminalStatus,isPaused,isCompensated,isCancelled,isReprogrammed,isReprogramPending,wasRescheduled};
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

// Shared "was this contractual slot delivered" rule (Cobros counters and getClaseRem):
// evaluated on the effective fulfillment date, never on both original and destination.
// A paused slot is never delivered; a definitively-cancelled Combo slot is billed and
// consumed like a delivered one (Individual is deliberately not extended).
export const resolveSlotGiven=(slot,packType,originalDate,timeEnd,myClasses,studentId)=>{
  if(slot.isPaused) return false;
  if(slot.isCancelled) return packType==="combo";
  const fulfillmentDate=getSlotFulfillmentDate(originalDate,slot.fulfillCancelled,slot.fulfillCancelType,slot.rescheduledTo);
  if(!fulfillmentDate) return false;
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
 * The shared reader of one combo's slots for one student: exactly resolveContractSlotStatus + resolveSlotGiven as
 * Cobros has always composed them (the card of a date is the first of `classes` on that date; its timeEnd, else
 * "23:59"), with the slot reading memoized per date for the duration of one reading. Read-only.
 *   status(date)    -> resolveContractSlotStatus(classes, combo, date, card)
 *   isGiven(date)   -> resolveSlotGiven(status(date), combo.packType, date, timeEnd, classes, studentId)
 *   cardFor(date), timeEndFor(date)
 */
export function createSlotReader({ classes, combo, studentId }) {
  const list = classes || [];
  const memo = new Map();
  const cardFor = (date) => list.find((cl) => cl.date === date);
  const timeEndFor = (date) => {
    const card = cardFor(date);
    return (card && card.timeEnd) || "23:59";
  };
  const status = (date) => {
    if (!memo.has(date)) memo.set(date, resolveContractSlotStatus(list, combo, date, cardFor(date)));
    return memo.get(date);
  };
  const isGiven = (date) => resolveSlotGiven(status(date), combo.packType, date, timeEndFor(date), list, studentId);
  return { status, isGiven, cardFor, timeEndFor };
}
