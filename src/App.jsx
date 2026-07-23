import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  'https://eerocqdoawrciatvqnof.supabase.co',
  'sb_publishable_DHrf_q9EoNFkYnhIaameuw_LVfnGXvG'
);
window.supabase=supabase;

// Inject Inter font
if(typeof document!=="undefined"){
  const link=document.createElement("link");
  link.rel="stylesheet";
  link.href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap";
  document.head.appendChild(link);
  document.body.style.fontFamily="'Inter', system-ui, sans-serif";
}

const C = {
  blue:"#0D1B4B",      // deep navy-indigo for headers
  blue2:"#1A3DB5",     // royal blue primary
  blue3:"#2C5EF7",     // bright royal blue
  blueL:"#EEF2FF",     // very light blue background tint
  white:"#FFFFFF",
  whiteA:"rgba(255,255,255,0.15)",
  whiteB:"rgba(255,255,255,0.25)",
  text:"#0D1B4B",      // deep navy text
  muted:"rgba(255,255,255,0.70)",
  mutedDark:"#6B7BAD", // muted blue-grey
  bg:"#e0e6f5",        // soft blue-white background
  card:"#FFFFFF",
  border:"rgba(13,27,75,0.10)",
  green:"#65CE5A",     // brand green accent
  greenL:"#EDFBEC",    // light green
};


const TODAY_DATE=(()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");})();
const WEEK_AGO=(()=>{const d=new Date();d.setDate(d.getDate()-7);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");})();

// Check if a class date+timeEnd has passed (dynamic - called at render time)
const isClassDone=(date,timeEnd)=>{
  if(!date) return false;
  const now=new Date();
  const todayStr=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
  if(date<todayStr) return true;
  if(date>todayStr) return false;
  const nowTime=String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
  const endTime=timeEnd||"23:59";
  return nowTime>=endTime;
};

// Currency formatting
const _cur={v:"₲"};
const formatNum=(n,cur)=>{
  const abs=Math.floor(Math.abs(parseInt(n)||0));
  const str=abs.toString();
  const sep=["₲","R$","€","$U","S/"].includes(cur)?".":","
  return str.replace(/\B(?=(\d{3})+(?!\d))/g,sep);
};
const getCUR=()=>_cur.v;
const setCUR=(v)=>{_cur.v=v;};
const fmtMoney=(amount)=>{const c=_cur.v;return c+" "+formatNum(amount,c);};
const fmtMoneyShort=(amount)=>{const c=_cur.v;return c+" "+formatNum(amount,c);};

// Money input that formats as you type
function MoneyInput({value, onChange, placeholder, style}) {
  const cur=getCUR();
  const formatted=value?formatNum(value,cur):"";
  const [display,setDisplay]=useState(formatted);
  const [lastValue,setLastValue]=useState(value);
  // Sync when value changes externally
  if(value!==lastValue){
    setLastValue(value);
    setDisplay(formatted);
  }
  const handleChange=(e)=>{
    const raw=e.target.value.replace(/[^0-9]/g,"");
    const num=parseInt(raw)||0;
    setDisplay(raw===""?"":formatNum(num,cur));
    onChange(num);
  };
  return <input type="text" inputMode="numeric" value={display} onChange={handleChange} placeholder={placeholder||"0"} style={style}/>;
}

// Hide number input spinners globally
const styleEl=document.createElement('style');
styleEl.textContent='input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}*{font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}';
document.head.appendChild(styleEl);

const ALL_DAYS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const DAY_LABELS = ["L","M","M","J","V","S","D"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const INIT_STUDENTS = [];
const INIT_CLASSES = [];

const _nowM=(()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");})();
const EXPENSES = [];

// Global date formatter: "Martes 21 Jul"
const _wDFull=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const _mNShort=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const fmtDate=(ds)=>{const d=new Date(ds+"T12:00:00");return _wDFull[d.getDay()]+" "+d.getDate()+" "+_mNShort[d.getMonth()];};

// Expand recurring classes into per-date virtual instances for display
// Expand recurring classes into per-date virtual instances for display
// NEW format: single object with occurrences + cancelledDates + rescheduledDates
// LEGACY format: one object per date, may have occurrences copied from spread — ignore it
const expandClasses=(classes)=>{
  const result=[];
  for(const c of classes){
    // New format classes have cancelledDates (added by new handleSaveClass)
    const isNewFormat=c.hasOwnProperty("cancelledDates");
    if(isNewFormat&&c.occurrences&&c.occurrences.length>0){
      const dc=c.dateCancellations||{};
      // Collect rescheduled-to dates that aren't already in occurrences
      const reschDates=new Set();
      Object.values(dc).forEach(info=>{if(info.rescheduledTo&&!c.occurrences.includes(info.rescheduledTo))reschDates.add(info.rescheduledTo);});
      // Expand regular occurrences
      for(const date of c.occurrences){
        const log=(c.attendanceLog||[]).find(e=>e.date===date);
        const cancelInfo=dc[date]||null;
        result.push({
          ...c,
          _seriesId:c.id,
          _virtualId:c.id+"_"+date,
          date,
          cancelled:!!(cancelInfo&&cancelInfo.cancelType!=="paused"),
          cancelType:cancelInfo?.cancelType||null,
          rescheduledTo:cancelInfo?.rescheduledTo||null,
          rescheduled:!!(cancelInfo?.rescheduledTo),
          paused:!!(cancelInfo&&cancelInfo.cancelType==="paused"),
          attendanceLog:log?[log]:[],
        });
      }
      // Expand rescheduled-to dates (new class instances on the new day)
      for(const date of reschDates){
        const log=(c.attendanceLog||[]).find(e=>e.date===date);
        result.push({
          ...c,
          _seriesId:c.id,
          _virtualId:c.id+"_"+date,
          date,
          cancelled:false,
          cancelType:null,
          rescheduledTo:null,
          rescheduled:false,
          _isRescheduledInstance:true,
          attendanceLog:log?[log]:[],
        });
      }
    } else {
      // Legacy or single class — use as-is, strip occurrences to avoid confusion
      result.push({...c,_seriesId:c.id,_virtualId:c.id+"_"+(c.date||"")});
    }
  }
  return result;
};

function getCombo(s) {
  const combos=s.combos||[];
  // Prefer last combo with total>0 (individual or combo clases)
  const withTotal=combos.filter(x=>x.total>0);
  if(withTotal.length>0) return withTotal[withTotal.length-1];
  // Then mensual (total=null but has payment info)
  const mensual=combos.filter(x=>x.total===null&&(x.paid||x.payDate||x.date)&&x.packType!=="individual");
  if(mensual.length>0) return mensual[mensual.length-1];
  return combos[combos.length-1]||null;
}
function getEffectiveTotal(s, c, classes=[]) {
  if(!c||!c.total) return c?.total||0;
  const myClasses=classes.filter(cls=>cls.students&&cls.students.includes(s.id));
  const comboDates=c.dates||[];
  // Only subtract cancelled dates that are NOT rescheduled
  const cancelledCount=comboDates.filter(ds=>myClasses.some(cls=>cls.date===ds&&cls.cancelled&&!cls.rescheduled)).length;
  return Math.max(1, c.total - cancelledCount);
}
// Check if a class date is beyond the active combo (combo done, next unpaid)
function isNextComboPending(cls, students) {
  // Rescheduled instances are always covered (they replace a combo date)
  if(cls._isRescheduledInstance) return false;
  const clsStudents=(cls.students||[]).map(id=>students.find(s=>s.id===id)).filter(Boolean);
  if(clsStudents.length===0) return false;
  return clsStudents.some(s=>{
    const combos=(s.combos||[]).filter(c=>c.total>0||(c.packType&&c.packType!=="mensual"));
    if(combos.length===0) return false;
    // Check if this class date is covered by ANY combo's dates
    const coveredDates=new Set(combos.flatMap(c=>c.dates||[]));
    if(coveredDates.has(cls.date)) return false; // covered
    // Check if date is beyond last combo's last date
    const allDates=combos.flatMap(c=>c.dates||[]).sort();
    const lastDate=allDates[allDates.length-1]||"";
    if(!lastDate) return false;
    // Gray if date is beyond all combo dates
    return cls.date>lastDate||(!coveredDates.has(cls.date)&&cls.date>allDates[0]);
  });
}
function getRem(s, classes=[]) {
  const combos=s.combos||[];
  // All combos that are "clases" type (total>0 OR packType individual/combo)
  const classCombos=combos.filter(x=>{
    if(x.total>0) return true;
    if(x.packType==="individual"||x.packType==="combo") return true;
    // Legacy individual: null total but has a specific class date (not mensual)
    if(x.total===null&&x.date&&x.packType!=="mensual"&&!x.payDate) return true;
    return false;
  });
  if(classCombos.length===0) return null;
  let totalUnpaid=0;
  let totalPorDar=0;
  let anyActive=false;
  classCombos.forEach(c=>{
    const effectiveTotal=c.total>0?getEffectiveTotal(s,c,classes):(c.total||1);
    const paidCount=c.paidCount!==undefined?c.paidCount:(c.paid?effectiveTotal:0);
    const unpaid=Math.max(0,effectiveTotal-paidCount);
    // Past dates count as given UNLESS marked as "ausente - no dada" (ausente_reprog)
    const studentClasses=classes.filter(cls=>cls.students&&cls.students.includes(s.id));
    const pastGiven=(c.dates||[c.date]).filter(d=>{
      if(!d||d>=TODAY_DATE) return false;
      const attEntry=studentClasses.flatMap(cls=>cls.attendanceLog||[]).find(e=>e.date===d);
      if(attEntry&&(attEntry.ausente_reprog||[]).includes(s.id)) return false; // not given
      return true; // past + no record OR present OR ausente_dada = given
    }).length;
    const effectiveUsed=Math.max(c.used||0,pastGiven);
    const porDar=Math.max(0,paidCount-effectiveUsed);
    const lastDate=c.dates&&c.dates.length>0?c.dates[c.dates.length-1]:"";
    const cycleOpen=!(porDar===0&&unpaid===0&&lastDate&&lastDate<TODAY_DATE);
    if(cycleOpen) anyActive=true;
    totalUnpaid+=unpaid;
    totalPorDar+=porDar;
  });
  if(!anyActive){
    // If we had class combos but none are active, the cycle is complete — return 0 (al día)
    if(classCombos.length>0) return 0;
    return null;
  }
  if(totalUnpaid>0) return -totalUnpaid;
  return totalPorDar;
}

function IziLogoBlack({ height=34 }) {
  return (
    <img src="data:image/png;base64,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" alt="izicoach" style={{height:height,objectFit:"contain"}}/>
  );
}

function WhiteCard({ children, style, onClick }) {
  return <div onClick={onClick} style={{background:C.white,borderRadius:16,padding:"14px 16px",boxShadow:"0 2px 12px rgba(44,94,247,0.08)",border:"1px solid rgba(44,94,247,0.06)",marginBottom:10,...style}}>{children}</div>;
}

function PullRefresh({ onRefresh, children, style }) {
  const [pulling,setPulling]=useState(false);
  const [pullY,setPullY]=useState(0);
  const [refreshing,setRefreshing]=useState(false);
  const startY=useRef(0);
  const scrollRef=useRef(null);
  const threshold=60;
  const onTouchStart=(e)=>{if(scrollRef.current&&scrollRef.current.scrollTop===0){startY.current=e.touches[0].clientY;setPulling(true);}};
  const onTouchMove=(e)=>{if(!pulling) return;const dy=e.touches[0].clientY-startY.current;if(dy>0&&scrollRef.current&&scrollRef.current.scrollTop===0){setPullY(Math.min(dy*0.4,80));e.preventDefault();}else{setPulling(false);setPullY(0);}};
  const onTouchEnd=async()=>{if(pullY>=threshold&&!refreshing){setRefreshing(true);setPullY(threshold);try{await onRefresh();}catch{}setTimeout(()=>{setRefreshing(false);setPullY(0);setPulling(false);},600);}else{setPullY(0);setPulling(false);}};
  return (
    <div ref={scrollRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} style={{...style,position:"relative"}}>
      {pullY>0&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:pullY,transition:refreshing?"none":"height 0.2s",overflow:"hidden"}}>
          <div style={{fontSize:12,fontWeight:700,color:C.blue2,display:"flex",alignItems:"center",gap:6}}>
            {refreshing?(
              <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.5" strokeLinecap="round" style={{animation:"spin 0.8s linear infinite"}}><path d="M21 12a9 9 0 11-6.2-8.6"/></svg> Actualizando...</>
            ):pullY>=threshold?(
              <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg> Soltar para actualizar</>
            ):(
              <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.mutedDark} strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg> Tirar para actualizar</>
            )}
          </div>
        </div>
      )}
      {children}
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function NavBar({ tabs, active, onSelect, zIdx=0, badges={} }) {
  const ICONS = {
    dashboard:(c)=>(<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>),
    students:(c)=>(<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="3.5"/><path d="M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="8" r="3"/><path d="M22 20c0-3-2-5-5-5"/></svg>),
    agenda:(c)=>(<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>),
    chat:(c)=>(<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>),
    finances:(c)=>(<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="12" cy="15" r="2"/></svg>),
    cobros:(c)=>(<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="12" cy="15" r="2"/></svg>),
    finanzas:(c)=>(<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>),
  };
  return (
    <div style={{display:"flex",borderTop:"1px solid rgba(44,94,247,0.07)",background:C.white,paddingBottom:"env(safe-area-inset-bottom,8px)",position:"fixed",bottom:0,left:0,right:0,zIndex:Math.max(zIdx,100),boxShadow:"0 -2px 16px rgba(44,94,247,0.06)"}}>
      {tabs.map(t=>{
        const isActive=active===t.id; const col=isActive?C.blue2:"#9BACCB";
        const badge=badges[t.id]||0;
        return (
          <button key={t.id} onClick={()=>onSelect(t.id)} style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"8px 0 6px",position:"relative"}}>
            {isActive&&<div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:28,height:3,borderRadius:"0 0 4px 4px",background:C.blue2}}></div>}
            <div style={{width:38,height:38,borderRadius:12,background:isActive?"linear-gradient(135deg,"+C.blueL+",#D0E4FF)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s",position:"relative"}}>
              {ICONS[t.id]?ICONS[t.id](col):<span style={{fontSize:20,color:col}}>{t.icon}</span>}
              {badge>0&&<div style={{position:"absolute",top:-2,right:-2,background:"#FF4757",borderRadius:"50%",minWidth:16,height:16,fontSize:9,fontWeight:800,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #fff",padding:"0 2px"}}>{badge>9?"9+":badge}</div>}
            </div>
            <span style={{fontSize:10,color:col,fontWeight:isActive?700:500,letterSpacing:0.1}}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TopBar({ onExit, onConfig }) {
  return (
    <div style={{background:"#000000",padding:"12px 16px",display:"flex",alignItems:"center",flexShrink:0}}>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"flex-start"}}><IziLogoBlack height={44}/></div>
      <button onClick={onConfig} style={{background:"none",border:"none",cursor:"pointer",padding:"6px",display:"flex"}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      </button>
      <button onClick={onExit} style={{background:"none",border:"none",cursor:"pointer",padding:"6px",display:"flex"}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </button>
    </div>
  );
}

function NewPackageModal({ onSave, onClose, currency }) {
  const [pName,setPName]=useState("");
  const [pType,setPType]=useState("combo");
  const [pQty,setPQty]=useState("8");
  const [pPrice,setPPrice]=useState("");
  const iS={width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",background:C.white,color:C.text,outline:"none"};
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
      <div style={{background:C.white,borderRadius:20,padding:24,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.2)",border:"1.5px solid "+C.blue2}}>
        <div style={{fontWeight:800,fontSize:17,color:C.text,marginBottom:20}}>Nuevo paquete</div>
        <div style={{marginBottom:12}}>
          <label style={{fontSize:12,color:C.blue2,fontWeight:700,display:"block",marginBottom:6}}>NOMBRE *</label>
          <input value={pName} onChange={e=>setPName(e.target.value)} placeholder="Ej: Combo 8 clases" style={iS}/>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{fontSize:12,color:C.blue2,fontWeight:700,display:"block",marginBottom:6}}>TIPO</label>
          <div style={{display:"flex",gap:6}}>
            {[["individual","🎯 Individual"],["combo","📦 Combo"],["mensual","📅 Mensual"]].map(([k,l])=>(
              <button key={k} onClick={()=>setPType(k)} style={{flex:1,padding:"10px 4px",borderRadius:10,border:"2px solid "+(pType===k?C.blue2:C.border),background:pType===k?C.blueL:C.white,color:pType===k?C.blue2:C.mutedDark,fontSize:12,cursor:"pointer",fontWeight:700}}>{l}</button>
            ))}
          </div>
        </div>
        {pType==="combo"&&<div style={{marginBottom:12}}><label style={{fontSize:12,color:C.blue2,fontWeight:700,display:"block",marginBottom:6}}>CANTIDAD DE CLASES</label><input type="text" inputMode="numeric" pattern="[0-9]*" value={pQty} onChange={e=>setPQty(e.target.value)} placeholder="8" style={iS}/></div>}
        <div style={{marginBottom:20}}>
          <label style={{fontSize:12,color:C.blue2,fontWeight:700,display:"block",marginBottom:6}}>PRECIO ({currency||getCUR()}) *</label>
          <MoneyInput value={parseInt(pPrice)||0} onChange={v=>setPPrice(v)} placeholder="400000" style={iS}/>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:"13px",borderRadius:12,border:"1.5px solid "+C.border,background:C.white,cursor:"pointer",fontSize:14,color:C.mutedDark,fontWeight:700}}>Cancelar</button>
          <button onClick={()=>{
            if(!pName.trim()||!pPrice) return;
            const pkg={id:Date.now(),name:pName.trim(),type:pType,qty:pType==="combo"?parseInt(pQty)||null:null,price:parseInt(pPrice)};
            onSave(pkg);
          }} style={{flex:1,padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,cursor:"pointer",fontSize:14,fontWeight:800}}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function ConfigScreen({ onClose, courts, setCourts, packages, setPackages, coachProfile, setCoachProfile }) {
  const [section,setSection]=useState("general");
  const [showNewCourt,setShowNewCourt]=useState(false);
  const [showNewPack,setShowNewPack]=useState(false);
  const [cName,setCName]=useState(""); const [cAddr,setCAddr]=useState(""); const [cCity,setCCity]=useState("");
  const [pName,setPName]=useState(""); const [pType,setPType]=useState("combo"); const [pQty,setPQty]=useState(""); const [pPrice,setPPrice]=useState("");
  // Profile fields — init from coachProfile
  const [profName,setProfName]=useState(coachProfile?.name||"");
  const [profEmail,setProfEmail]=useState(coachProfile?.email||"");
  const [profPhone,setProfPhone]=useState(coachProfile?.phone||"");
  const [profSport,setProfSport]=useState(coachProfile?.sport||"");
  const [profPhoto,setProfPhoto]=useState(coachProfile?.photo||null);
  const [profSaved,setProfSaved]=useState(false);
  const [oldPass,setOldPass]=useState(""); const [newPass,setNewPass]=useState(""); const [newPass2,setNewPass2]=useState("");
  const [notifClases,setNotifClases]=useState(true); const [notifPagos,setNotifPagos]=useState(true); const [notifMensajes,setNotifMensajes]=useState(false);
  const iS={width:"100%",padding:"10px 12px",borderRadius:12,border:"1.5px solid "+C.border,fontSize:13,boxSizing:"border-box",background:C.white,color:C.text,outline:"none"};
  const packTypeLabel=(t)=>t==="individual"?"Individual":t==="combo"?"Combo clases":"Mensual";
  const packIcon=(t)=>t==="individual"?"🎯":t==="combo"?"📦":"📅";
  const TABS=[["general","👤 Perfil"],["security","🔒 Seguridad"],["notif","🔔 Notif."],["courts","🏟 Canchas"],["packages","💳 Paquetes"]];

  const handlePhotoChange=(e)=>{
    const file=e.target.files[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>setProfPhoto(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSaveProfile=()=>{
    setCoachProfile(p=>({...p,name:profName,email:profEmail,phone:profPhone,sport:profSport,photo:profPhoto}));
    setProfSaved(true);
    setTimeout(()=>setProfSaved(false),2000);
  };
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:299,display:"flex",flexDirection:"column",background:C.bg}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"14px 16px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.white,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
        <span style={{flex:1,fontWeight:800,fontSize:16,color:C.white}}>Configuración</span>
      </div>
      {/* Tabs */}
      <div style={{display:"flex",background:C.white,borderBottom:"1px solid "+C.border,flexShrink:0,overflowX:"auto"}}>
        {TABS.map(([k,l])=>(
          <button key={k} onClick={()=>setSection(k)} style={{flexShrink:0,padding:"12px 14px",border:"none",background:"none",cursor:"pointer",fontSize:12,fontWeight:700,color:section===k?C.blue2:C.mutedDark,borderBottom:"3px solid "+(section===k?C.blue2:"transparent"),whiteSpace:"nowrap"}}>{l}</button>
        ))}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16}}>

        {section==="general"&&(
          <>
            {/* Photo upload */}
            <div style={{textAlign:"center",marginBottom:24}}>
              <div style={{position:"relative",display:"inline-block"}}>
                {profPhoto
                  ?<img src={profPhoto} style={{width:90,height:90,borderRadius:"50%",objectFit:"cover",border:"3px solid "+C.blue2}}/>
                  :<div style={{width:90,height:90,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:900,color:C.white,border:"3px solid "+C.blue2}}>
                    {profName?profName[0].toUpperCase():"C"}
                  </div>
                }
                <label htmlFor="prof-photo-input" style={{position:"absolute",bottom:0,right:0,width:28,height:28,borderRadius:"50%",background:C.blue2,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",border:"2px solid #fff"}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </label>
                <input id="prof-photo-input" type="file" accept="image/*" onChange={handlePhotoChange} style={{display:"none"}}/>
              </div>
              <div style={{fontSize:13,color:C.mutedDark,marginTop:8}}>Tocá el ícono para cambiar la foto</div>
            </div>
            {/* Fields */}
            {[
              {l:"Nombre",v:profName,s:setProfName,p:"Tu nombre completo"},
              {l:"Deporte",v:profSport,s:setProfSport,p:"Tenis, Fútbol, Natación..."},
              {l:"Email",v:profEmail,s:setProfEmail,p:"tu@correo.com"},
              {l:"Teléfono",v:profPhone,s:setProfPhone,p:"0981 000 000"},
            ].map(f=>(
              <div key={f.l} style={{marginBottom:14}}>
                <label style={{fontSize:12,color:C.blue2,fontWeight:700,display:"block",marginBottom:6}}>{f.l.toUpperCase()}</label>
                <input value={f.v} onChange={e=>f.s(e.target.value)} placeholder={f.p} style={iS}/>
              </div>
            ))}
            <button onClick={handleSaveProfile} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",background:profSaved?"linear-gradient(135deg,#2E7D32,#65CE5A)":"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,fontSize:14,cursor:"pointer",fontWeight:700,marginBottom:20,transition:"background 0.3s"}}>
              {profSaved?"✓ Guardado!":"Guardar cambios"}
            </button>
            {profPhoto&&(
              <button onClick={()=>setProfPhoto(null)} style={{width:"100%",padding:"12px",borderRadius:12,border:"1.5px solid #FFEBEE",background:"#FFEBEE",color:"#C62828",fontSize:13,cursor:"pointer",fontWeight:700,marginBottom:20}}>
                🗑 Eliminar foto
              </button>
            )}
          </>
        )}

        {section==="security"&&(
          <>
            <WhiteCard style={{marginBottom:14}}>
              <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:14}}>Cambiar contraseña</div>
              {[{l:"Contraseña actual",v:oldPass,s:setOldPass},{l:"Nueva contraseña",v:newPass,s:setNewPass},{l:"Confirmar nueva",v:newPass2,s:setNewPass2}].map(f=>(
                <div key={f.l} style={{marginBottom:12}}>
                  <label style={{fontSize:12,color:C.blue2,fontWeight:700,display:"block",marginBottom:4}}>{f.l.toUpperCase()}</label>
                  <input type="password" value={f.v} onChange={e=>f.s(e.target.value)} placeholder="••••••••" style={iS}/>
                </div>
              ))}
              <button style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,fontSize:14,cursor:"pointer",fontWeight:700,marginTop:4}}>Actualizar contraseña</button>
            </WhiteCard>
            <WhiteCard>
              <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:4}}>💳 Facturación</div>
              <div style={{fontSize:12,color:C.mutedDark,marginBottom:12}}>Plan actual: <b>Pro</b></div>
              {["Ver historial de pagos","Cambiar plan","Métodos de pago"].map(item=>(
                <div key={item} style={{padding:"11px 0",borderBottom:"1px solid "+C.border,fontSize:14,color:C.text,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  {item}<span style={{color:C.mutedDark}}>{"›"}</span>
                </div>
              ))}
            </WhiteCard>
          </>
        )}

        {section==="notif"&&(
          <WhiteCard>
            <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:16}}>Notificaciones</div>
            {[["Recordatorio de clases",notifClases,setNotifClases],["Alertas de pagos",notifPagos,setNotifPagos],["Nuevos mensajes",notifMensajes,setNotifMensajes]].map(([label,val,setter])=>(
              <div key={label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid "+C.border}}>
                <span style={{fontSize:14,color:C.text}}>{label}</span>
                <div onClick={()=>setter(v=>!v)} style={{width:44,height:24,borderRadius:12,background:val?"linear-gradient(135deg,"+C.blue2+","+C.blue3+")":"#DDD",cursor:"pointer",position:"relative",transition:"background 0.2s"}}>
                  <div style={{position:"absolute",top:2,left:val?22:2,width:20,height:20,borderRadius:"50%",background:C.white,transition:"left 0.2s"}}></div>
                </div>
              </div>
            ))}
          </WhiteCard>
        )}

        {section==="courts"&&(
          <>
            <div style={{fontSize:13,color:C.mutedDark,marginBottom:16}}>Configurá los lugares donde dás clases. Aparecerán como opciones rápidas al crear una clase.</div>
            {courts.map(c=>(
              <WhiteCard key={c.id} style={{marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:40,height:40,borderRadius:10,background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🏟</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14,color:C.text}}>{c.name}</div>
                    {c.address&&<div style={{fontSize:12,color:C.mutedDark}}>📍 {c.address}</div>}
                    {c.city&&<div style={{fontSize:11,color:C.mutedDark}}>{c.city}</div>}
                  </div>
                  <button onClick={()=>setCourts(p=>p.filter(x=>x.id!==c.id))} style={{background:"#FFEBEE",border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </WhiteCard>
            ))}
            {courts.length===0&&<div style={{textAlign:"center",padding:"24px 0",color:C.mutedDark,fontSize:13}}>Aún no hay canchas configuradas</div>}
            {showNewCourt?(
              <WhiteCard style={{border:"1.5px solid "+C.blue2}}>
                <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:12}}>Nueva cancha</div>
                <div style={{marginBottom:10}}><label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:4}}>NOMBRE *</label><input value={cName} onChange={e=>setCName(e.target.value)} placeholder="Ej: Cancha A" style={iS}/></div>
                <div style={{marginBottom:10}}><label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:4}}>DIRECCIÓN</label><input value={cAddr} onChange={e=>setCAddr(e.target.value)} placeholder="Ej: Av. España 1234" style={iS}/></div>
                <div style={{marginBottom:14}}><label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:4}}>LOCALIDAD</label><input value={cCity} onChange={e=>setCCity(e.target.value)} placeholder="Ej: Asunción" style={iS}/></div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setShowNewCourt(false);setCName("");setCAddr("");setCCity("");}} style={{flex:1,padding:"11px",borderRadius:12,border:"1.5px solid "+C.border,background:C.white,cursor:"pointer",fontSize:13,color:C.mutedDark,fontWeight:700}}>Cancelar</button>
                  <button onClick={()=>{if(!cName.trim())return;setCourts(p=>[...p,{id:Date.now(),name:cName.trim(),address:cAddr.trim(),city:cCity.trim()}]);setCName("");setCAddr("");setCCity("");setShowNewCourt(false);}} style={{flex:1,padding:"11px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,cursor:"pointer",fontSize:13,fontWeight:800}}>Guardar</button>
                </div>
              </WhiteCard>
            ):(
              <button onClick={()=>setShowNewCourt(true)} style={{width:"100%",padding:"13px",borderRadius:12,border:"1.5px dashed "+C.blue2,background:C.blueL,color:C.blue2,fontSize:14,cursor:"pointer",fontWeight:700,marginTop:4}}>+ Agregar cancha</button>
            )}
          </>
        )}

        {section==="packages"&&(
          <>
            <div style={{fontSize:13,color:C.mutedDark,marginBottom:16}}>Configurá tus paquetes con precios sugeridos. Aparecerán como opciones al actualizar pagos.</div>
            {packages.map(p=>(
              <WhiteCard key={p.id} style={{marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:40,height:40,borderRadius:10,background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{packIcon(p.type)}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14,color:C.text}}>{p.name}</div>
                    <div style={{fontSize:12,color:C.mutedDark}}>{packTypeLabel(p.type)}{p.qty?" · "+p.qty+" clases":""}</div>
                    <div style={{fontSize:13,fontWeight:700,color:C.blue2}}>{fmtMoneyShort(p.price)}</div>
                  </div>
                  <button onClick={()=>setPackages(prev=>prev.filter(x=>x.id!==p.id))} style={{background:"#FFEBEE",border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </WhiteCard>
            ))}
            {packages.length===0&&<div style={{textAlign:"center",padding:"24px 0",color:C.mutedDark,fontSize:13}}>Aún no hay paquetes configurados</div>}
            {showNewPack?(
              <WhiteCard style={{border:"1.5px solid "+C.blue2}}>
                <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:12}}>Nuevo paquete</div>
                <div style={{marginBottom:10}}><label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:4}}>NOMBRE *</label><input value={pName} onChange={e=>setPName(e.target.value)} placeholder="Ej: Combo 8 clases" style={iS}/></div>
                <div style={{marginBottom:10}}>
                  <label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>TIPO</label>
                  <div style={{display:"flex",gap:6}}>
                    {[["individual","🎯 Individual"],["combo","📦 Combo"],["mensual","📅 Mensual"]].map(([k,l])=>(
                      <button key={k} onClick={()=>setPType(k)} style={{flex:1,padding:"8px 4px",borderRadius:10,border:"2px solid "+(pType===k?C.blue2:C.border),background:pType===k?C.blueL:C.white,color:pType===k?C.blue2:C.mutedDark,fontSize:11,cursor:"pointer",fontWeight:700}}>{l}</button>
                    ))}
                  </div>
                </div>
                {pType==="combo"&&<div style={{marginBottom:10}}><label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:4}}>CANTIDAD DE CLASES</label><input type="text" inputMode="numeric" pattern="[0-9]*" value={pQty} onChange={e=>setPQty(e.target.value)} placeholder="8" style={iS}/></div>}
                <div style={{marginBottom:14}}><label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:4}}>PRECIO (₲) *</label><MoneyInput value={parseInt(pPrice)||0} onChange={v=>setPPrice(v)} placeholder="400000" style={iS}/></div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setShowNewPack(false);setPName("");setPQty("");setPPrice("");}} style={{flex:1,padding:"11px",borderRadius:12,border:"1.5px solid "+C.border,background:C.white,cursor:"pointer",fontSize:13,color:C.mutedDark,fontWeight:700}}>Cancelar</button>
                  <button onClick={()=>{if(!pName.trim()||!pPrice)return;setPackages(prev=>[...prev,{id:Date.now(),name:pName.trim(),type:pType,qty:pType==="combo"?parseInt(pQty)||null:null,price:parseInt(pPrice)}]);setPName("");setPQty("");setPPrice("");setShowNewPack(false);}} style={{flex:1,padding:"11px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,cursor:"pointer",fontSize:13,fontWeight:800}}>Guardar</button>
                </div>
              </WhiteCard>
            ):(
              <button onClick={()=>setShowNewPack(true)} style={{width:"100%",padding:"13px",borderRadius:12,border:"1.5px dashed "+C.blue2,background:C.blueL,color:C.blue2,fontSize:14,cursor:"pointer",fontWeight:700,marginTop:4}}>+ Agregar paquete</button>
            )}
          </>
        )}

      </div>
    </div>
  );
}

function TimePicker({value, onChange, style}) {
  const parts=((value||"08:00")).split(":");
  const [h,setH]=useState(parts[0]||"08");
  const [m,setM]=useState(["00","15","30","45"].includes(parts[1])?parts[1]:"00");
  const hours=Array.from({length:24},(_,i)=>String(i).padStart(2,"0"));
  const mins=["00","15","30","45"];
  const update=(nh,nm)=>{setH(nh);setM(nm);onChange(nh+":"+nm);};
  return (
    <div style={{display:"flex",gap:4}}>
      <select value={h} onChange={e=>update(e.target.value,m)} style={{...style,flex:1}}>
        {hours.map(hh=><option key={hh} value={hh}>{hh}</option>)}
      </select>
      <select value={m} onChange={e=>update(h,e.target.value)} style={{...style,flex:1}}>
        {mins.map(mm=><option key={mm} value={mm}>{mm}</option>)}
      </select>
    </div>
  );
}

function AuthFlow({ onLogin, onStudentLogin }) {
  const inviteCode=new URLSearchParams(window.location.search).get("invite")||"";
  const [screen,setScreen]=useState(inviteCode?"register_student":"login");
  const [email,setEmail]=useState(""); const [pass,setPass]=useState(""); const [name,setName]=useState("");
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  const [inviteInfo,setInviteInfo]=useState(null);
  const iS={width:"100%",padding:"13px 16px",borderRadius:12,border:"1.5px solid rgba(255,255,255,0.3)",fontSize:14,boxSizing:"border-box",background:"rgba(255,255,255,0.15)",color:"#fff",outline:"none",marginBottom:12};
  const lS={fontSize:12,color:"rgba(255,255,255,0.7)",fontWeight:700,display:"block",marginBottom:6};

  useEffect(()=>{
    if(!inviteCode) return;
    supabase.from("invites").select("*,coaches(name)").eq("code",inviteCode).eq("used",false).single()
      .then((res)=>{
        if(res.data) setInviteInfo(res.data);
        else setErr("El link de invitación no es válido o ya fue usado.");
      });
  },[]);

  const handleLogin=async()=>{
    if(!email||!pass){setErr("Completá todos los campos.");return;}
    setLoading(true);setErr("");
    const {data,error}=await supabase.auth.signInWithPassword({email,password:pass});
    if(error){setErr(error.message);setLoading(false);return;}
    onLogin(data.user);setLoading(false);
  };

  const handleRegister=async()=>{
    if(!email||!pass||!name){setErr("Completá todos los campos.");return;}
    if(pass.length<6){setErr("La contraseña debe tener al menos 6 caracteres.");return;}
    setLoading(true);setErr("");
    const {data,error}=await supabase.auth.signUp({email,password:pass});
    if(error){setErr(error.message);setLoading(false);return;}
    if(data.user){
      localStorage.clear();
      await supabase.from("coaches").insert({id:data.user.id,email,currency:"₲"});
    }
    onLogin(data.user);setLoading(false);
  };

  const handleStudentRegister=async()=>{
    if(!email||!pass||!name){setErr("Completá todos los campos.");return;}
    if(pass.length<6){setErr("La contraseña debe tener al menos 6 caracteres.");return;}
    if(!inviteInfo){setErr("Link de invitación inválido.");return;}
    setLoading(true);setErr("");
    const {data,error}=await supabase.auth.signUp({email,password:pass});
    console.log("signUp result:", data, error);
    if(error){setErr(error.message);setLoading(false);return;}
    if(data.user){
      console.log("user id:", data.user.id, "inviteInfo:", inviteInfo);
      const {error:saError}=await supabase.from("student_auth").insert({
        id:data.user.id,
        coach_id:inviteInfo.coach_id,
        student_id:inviteInfo.student_id,
        email
      });
      console.log("student_auth insert error:", saError);
      if(saError){setErr("Error al vincular: "+saError.message);setLoading(false);return;}
      await supabase.from("invites").update({used:true}).eq("code",inviteCode);
      window.history.replaceState({},"",window.location.pathname);
      onStudentLogin&&onStudentLogin(data.user, inviteInfo);
    } else {
      setErr("No se pudo crear la cuenta. Verificá que el email no esté en uso.");
    }
    setLoading(false);
  };
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{marginBottom:32,textAlign:"center"}}>
        <div style={{fontWeight:900,fontSize:36,color:"#fff",letterSpacing:-1}}>izi<span style={{color:"#65CE5A"}}>coach</span></div>
        <div style={{fontSize:14,color:"rgba(255,255,255,0.7)",marginTop:4}}>
          {screen==="register_student"?"Portal del Alumno":"Gestión de clases y pagos"}
        </div>
      </div>
      <div style={{width:"100%",maxWidth:380}}>
        {screen==="register_student"?(
          <>
            {inviteInfo&&<div style={{background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"12px 16px",marginBottom:20,textAlign:"center"}}>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.7)"}}>Invitado por</div>
              <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>{inviteInfo.coach_name||inviteInfo.coaches?.name||"tu entrenador"}</div>
            </div>}
            {err&&<div style={{background:"rgba(229,57,53,0.3)",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#FFCDD2",marginBottom:16}}>{err}</div>}
            {!err&&<>
              <div><label style={lS}>TU NOMBRE</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Ej: Ana García" style={iS}/></div>
              <div><label style={lS}>CORREO</label><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@correo.com" style={iS}/></div>
              <div><label style={lS}>CONTRASEÑA</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Mínimo 6 caracteres" style={iS}/></div>
              <button onClick={handleStudentRegister} disabled={loading} style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:"#65CE5A",color:"#fff",fontSize:15,cursor:"pointer",fontWeight:800,marginBottom:16,opacity:loading?0.7:1}}>{loading?"Registrando...":"Crear cuenta de alumno"}</button>
            </>}
            <div style={{textAlign:"center",fontSize:13,color:"rgba(255,255,255,0.7)"}}>¿Ya tenés cuenta?{" "}<button onClick={()=>{setScreen("login");setErr("");}} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#fff",fontWeight:800}}>Iniciar sesión</button></div>
          </>
        ):screen==="login"?(
          <>
            <div><label style={lS}>CORREO</label><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@correo.com" style={iS} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/></div>
            <div><label style={lS}>CONTRASEÑA</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" style={iS} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/></div>
            {err&&<div style={{background:"rgba(229,57,53,0.3)",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#FFCDD2",marginBottom:16}}>{err}</div>}
            <button onClick={handleLogin} disabled={loading} style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:"#fff",color:"#1A3DB5",fontSize:15,cursor:"pointer",fontWeight:800,marginBottom:16,opacity:loading?0.7:1}}>{loading?"Entrando...":"Iniciar sesión"}</button>
            <div style={{textAlign:"center",fontSize:13,color:"rgba(255,255,255,0.7)"}}>¿No tenés cuenta?{" "}<button onClick={()=>{setScreen("register");setErr("");}} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#fff",fontWeight:800}}>Registrarse</button></div>
          </>
        ):(
          <>
            <div><label style={lS}>TU NOMBRE</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Ej: Carlos García" style={iS}/></div>
            <div><label style={lS}>CORREO</label><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@correo.com" style={iS}/></div>
            <div><label style={lS}>CONTRASEÑA</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Mínimo 6 caracteres" style={iS}/></div>
            {err&&<div style={{background:"rgba(229,57,53,0.3)",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#FFCDD2",marginBottom:16}}>{err}</div>}
            <button onClick={handleRegister} disabled={loading} style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:"#65CE5A",color:"#fff",fontSize:15,cursor:"pointer",fontWeight:800,marginBottom:16,opacity:loading?0.7:1}}>{loading?"Creando cuenta...":"Crear cuenta"}</button>
            <div style={{textAlign:"center",fontSize:13,color:"rgba(255,255,255,0.7)"}}>¿Ya tenés cuenta?{" "}<button onClick={()=>{setScreen("login");setErr("");}} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#fff",fontWeight:800}}>Iniciar sesión</button></div>
          </>
        )}
      </div>
    </div>
  );
}


function DayPicker({ value, onChange }) {
  const toggle=(d)=>onChange(value.includes(d)?value.filter(x=>x!==d):[...value,d]);
  return (
    <div style={{display:"flex",justifyContent:"space-between"}}>
      {ALL_DAYS.map((day,i)=>{
        const active=value.includes(day);
        return <button key={day} onClick={()=>toggle(day)} style={{width:38,height:38,borderRadius:"50%",border:"none",background:active?"linear-gradient(135deg,#0D1B4B,#1A3DB5)":C.blueL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:active?C.white:C.mutedDark,cursor:"pointer"}}>{DAY_LABELS[i]}</button>;
      })}
    </div>
  );
}

function StudentSearch({ students, selected, onAdd }) {
  const [query,setQuery]=useState("");
  const selectedIds=selected.map(x=>x.id);
  const results=query.trim().length>0?students.filter(s=>s.name.toLowerCase().includes(query.toLowerCase())&&!selectedIds.includes(s.id)):[];
  return (
    <div style={{marginBottom:12,position:"relative"}}>
      <div style={{position:"relative"}}>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar alumno..." style={{width:"100%",padding:"11px 36px 11px 14px",borderRadius:12,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",background:C.bg,color:C.text,outline:"none"}}/>
        {query&&<button onClick={()=>setQuery("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.mutedDark,fontSize:18}}>×</button>}
      </div>
      {query.trim().length>0&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,background:C.white,borderRadius:12,border:"1.5px solid "+C.border,zIndex:50,overflow:"hidden",marginTop:4}}>
          {results.length===0?<div style={{padding:"12px 14px",fontSize:13,color:C.mutedDark}}>No se encontraron alumnos</div>
          :results.map(s=>(
            <div key={s.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:"1px solid "+C.border,cursor:"pointer"}} onClick={()=>{onAdd(s);setQuery("");}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:C.white,flexShrink:0}}>{s.avatar}</div>
              <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,color:C.text}}>{s.name}</div></div>
              <div style={{background:C.blue2,borderRadius:8,padding:"5px 12px",color:C.white,fontSize:12,fontWeight:700}}>+ Agregar</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewClassModal({ onClose, onSave, students: initialStudents, dateLabel, onCreateStudent, prefill, courts=[], packages=[], onAddPackage }) {
  const [title,setTitle]=useState(""); const [court,setCourt]=useState("");
  const [sel,setSel]=useState([]);
  const [startDate,setStartDate]=useState(prefill?.date||"");
  const [endDate,setEndDate]=useState("");
  const [days,setDays]=useState([]);
  const [t1,setT1]=useState(prefill?.time||"08:00"); const [t2,setT2]=useState(prefill?.timeEnd||"09:00");
  const [showCreateStudent,setShowCreateStudent]=useState(false);
  const [showNewPackModal,setShowNewPackModal]=useState(false);
  const [pendingPackStudent,setPendingPackStudent]=useState(null);
  const [allStudents,setAllStudents]=useState(initialStudents);
  const iS={width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",background:C.blueL,color:C.text,outline:"none"};

  const DAY_MAP={"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6,"Dom":0};
  const mNShort=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const wDShort=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

  // Generate all class occurrences between startDate and endDate
  const generateOccurrences=()=>{
    if(!startDate) return [];
    // No days selected = single class
    if(days.length===0) return [];
    // No end date = single class (individual or one-time)
    if(!endDate) return [];
    // With days and end date: generate occurrences
    const dowSet=new Set(days.map(d=>DAY_MAP[d]));
    const result=[];
    let cur=new Date(startDate+"T12:00:00");
    const end=new Date(endDate+"T12:00:00");
    while(cur<=end&&result.length<200){
      if(dowSet.has(cur.getDay())){
        const ds=cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0");
        result.push(ds);
      }
      cur.setDate(cur.getDate()+1);
    }
    return result;
  };

  const occurrences=generateOccurrences();

  const handleSave=()=>{
    if(!title||sel.length===0){alert("Agregá título y al menos un alumno.");return;}
    if(!startDate){alert("Agregá una fecha de inicio.");return;}
    // Check if combo/mensual requires days
    const hasCombo=sel.some(x=>{
      const pkg=packages.find(p=>String(p.id)===String(x.pack));
      return x.pack!=="individual"&&pkg?.type!=="individual"&&x.pack!=="";
    });
    if(hasCombo&&days.length===0&&!endDate){
      alert("Para clases con combo, seleccioná al menos un día de la semana o una fecha de expiración.");return;
    }
    // If combo/mensual without endDate, generate 6 months of occurrences
    let finalOccurrences=occurrences;
    if(hasCombo&&!endDate&&days.length>0&&occurrences.length===0){
      const dowSet=new Set(days.map(d=>DAY_MAP[d]));
      const result=[];
      let cur=new Date(startDate+"T12:00:00");
      const end=new Date(new Date(startDate+"T12:00:00").setMonth(new Date(startDate+"T12:00:00").getMonth()+6));
      while(cur<=end&&result.length<200){
        if(dowSet.has(cur.getDay())){
          result.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
        }
        cur.setDate(cur.getDate()+1);
      }
      finalOccurrences=result;
    }
    const firstDate=finalOccurrences.length>0?finalOccurrences[0]:startDate||TODAY_DATE;
    onSave({title,court,studentData:sel,students:sel.map(x=>x.id),date:firstDate,time:t1,timeEnd:t2,days,startDate,endDate,occurrences:finalOccurrences});
    onClose();
  };

  const upd=(id,f,v)=>setSel(prev=>prev.map(x=>x.id===id?{...x,[f]:v}:x));
  const handleCreateStudent=(data)=>{
    const newS={id:Date.now(),...data};
    setAllStudents(prev=>[...prev,newS]);
    setSel(prev=>[...prev,{id:newS.id,pack:"",amount:"",paid:false}]);
    onCreateStudent&&onCreateStudent(newS);
    setShowCreateStudent(false);
  };

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:500,display:"flex",alignItems:"flex-end"}}>
      <div style={{background:C.white,borderRadius:"24px 24px 0 0",padding:"24px 20px 32px",width:"100%",maxHeight:"92%",overflowY:"auto",boxSizing:"border-box"}}>
        <div style={{fontWeight:900,fontSize:22,color:C.text,marginBottom:4}}>Nueva clase</div>
        <div style={{fontSize:14,color:C.mutedDark,marginBottom:20}}>{dateLabel}</div>

        <div style={{marginBottom:14}}>
          <label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Título</label>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ej: Tenis - Mañana" style={iS}/>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:14}}>
          <div>
            <label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Fecha de inicio</label>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={iS}/>
          </div>
          <div>
            <label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Expiración <span style={{fontSize:10,color:C.mutedDark,fontWeight:400}}>(opcional)</span></label>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} style={iS}/>
            {!endDate&&<div style={{fontSize:10,color:C.mutedDark,marginTop:4}}>♾ Sin límite</div>}
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:8}}>Días</label>
          <DayPicker value={days} onChange={setDays}/>
        </div>

        <div style={{display:"flex",gap:12,marginBottom:14}}>
          <div style={{flex:1}}><label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Desde</label><TimePicker value={t1} onChange={setT1} style={{...iS,padding:"10px 8px"}}/></div>
          <div style={{flex:1}}><label style={{fontSize:12,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Hasta</label><TimePicker value={t2} onChange={setT2} style={{...iS,padding:"10px 8px"}}/></div>
        </div>

        {/* Cancha */}
        <div style={{marginBottom:14}}>
          <label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Cancha</label>
          <input value={court} onChange={e=>setCourt(e.target.value)} placeholder="Ej: Cancha A" style={iS}/>
          {courts.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
            {courts.map(c=><button key={c.id} onClick={()=>setCourt(c.name)} style={{padding:"4px 12px",borderRadius:20,border:"1.5px solid "+(court===c.name?C.blue2:C.border),background:court===c.name?C.blueL:C.white,color:court===c.name?C.blue2:C.mutedDark,fontSize:12,cursor:"pointer",fontWeight:600}}>{c.name}{c.city?" · "+c.city:""}</button>)}
          </div>}
        </div>

        <div style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <label style={{fontSize:13,color:C.blue,fontWeight:700}}>Alumnos</label>
            <button onClick={()=>setShowCreateStudent(true)} style={{padding:"6px 12px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#52C048,#65CE5A)",color:C.white,fontSize:11,cursor:"pointer",fontWeight:800,letterSpacing:0.3}}>+ CREAR ALUMNO</button>
          </div>
          <StudentSearch students={allStudents} selected={sel} onAdd={(s)=>setSel(prev=>[...prev,{id:s.id,pack:"",packId:"",amount:"",paid:false}])}/>
          {sel.map(sd=>{
            const s=allStudents.find(x=>x.id===sd.id); if(!s) return null;
            return (
              <div key={s.id} style={{borderRadius:14,border:"1.5px solid "+C.blue2,background:C.blueL,marginBottom:10,overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px"}}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:C.white,flexShrink:0}}>{s.avatar}</div>
                  <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,color:C.text}}>{s.name}</div></div>
                  <button onClick={()=>setSel(prev=>prev.filter(x=>x.id!==s.id))} style={{background:"#FFEBEE",border:"none",borderRadius:"50%",width:28,height:28,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <div style={{padding:"0 12px 12px",background:C.white,borderTop:"1px solid "+C.border}}>
                  {/* Monto + Paquete row */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10,marginBottom:10}}>
                    <div>
                      <label style={{fontSize:11,color:C.blue2,fontWeight:700,display:"block",marginBottom:4}}>MONTO ({getCUR()})</label>
                      <MoneyInput value={parseInt(sd.amount)||0} onChange={v=>upd(s.id,"amount",v)} placeholder="0" style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid "+C.border,fontSize:13,boxSizing:"border-box",background:C.bg,color:C.text,outline:"none"}}/>
                    </div>
                    <div>
                      <label style={{fontSize:11,color:C.blue2,fontWeight:700,display:"block",marginBottom:4}}>PAQUETE <span style={{fontSize:9,color:C.mutedDark,fontWeight:500}}>(opcional)</span></label>
                      <select value={sd.packId||""} onChange={e=>{
                        const val=e.target.value;
                        if(val==="otro"){setPendingPackStudent(s.id);setShowNewPackModal(true);return;}
                        if(!val){upd(s.id,"packId","");upd(s.id,"pack","");return;}
                        const pkg=packages.find(p=>String(p.id)===val);
                        if(pkg){
                          upd(s.id,"packId",val);
                          upd(s.id,"pack",pkg.type==="mensual"?"mensual":pkg.type==="individual"?"individual":String(pkg.qty||""));
                          upd(s.id,"amount",pkg.price||0);
                        }
                      }} style={{width:"100%",padding:"10px 8px",borderRadius:10,border:"1.5px solid "+C.border,fontSize:13,boxSizing:"border-box",background:C.bg,color:C.text,outline:"none",cursor:"pointer"}}>
                        <option value="">Elegir paquete</option>
                        {packages.map(p=>(
                          <option key={p.id} value={String(p.id)}>{p.name}</option>
                        ))}
                        <option value="otro">✏️ Crear nuevo pago...</option>
                      </select>
                      {sd.pack==="otro"&&<div style={{fontSize:11,color:C.mutedDark,marginTop:4}}>Creá el paquete en Settings y volvé a elegirlo</div>}
                    </div>
                  </div>
                  {/* No need to show # de clases - already in package */}
                  {/* Guardar pago + Pago efectuado */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {sd.pack==="mensual"?(
                      <div>
                        <label style={{fontSize:11,color:C.blue2,fontWeight:700,display:"block",marginBottom:6}}>INICIO DE PAGO</label>
                        <input type="date" value={sd.payDate||TODAY_DATE} onChange={e=>upd(s.id,"payDate",e.target.value)} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1.5px solid "+C.border,fontSize:12,boxSizing:"border-box",background:C.bg,color:C.text,outline:"none"}}/>
                      </div>
                    ):<div/>}
                    <div>
                      <label style={{fontSize:11,color:C.blue2,fontWeight:700,display:"block",marginBottom:6}}>PAGO EFECTUADO</label>
                      <div style={{display:"flex",gap:12}}>
                        {[true,false].map(v=>(
                          <div key={String(v)} onClick={()=>upd(s.id,"paid",v)} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
                            <div style={{width:20,height:20,borderRadius:"50%",background:sd.paid===v?"linear-gradient(135deg,#0D1B4B,#1A3DB5)":C.blueL,border:"2px solid "+(sd.paid===v?C.blue2:C.border),display:"flex",alignItems:"center",justifyContent:"center"}}>{sd.paid===v&&<div style={{width:7,height:7,borderRadius:"50%",background:C.white}}></div>}</div>
                            <span style={{fontSize:12,fontWeight:sd.paid===v?700:500,color:sd.paid===v?C.blue2:C.mutedDark}}>{v?"✓ Sí":"✗ No"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:12}}>
          <button onClick={onClose} style={{flex:1,padding:"15px",borderRadius:14,border:"1.5px solid "+C.border,background:C.white,cursor:"pointer",fontSize:15,color:C.mutedDark,fontWeight:700}}>Cancelar</button>
          <button onClick={handleSave} style={{flex:1,padding:"15px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,cursor:"pointer",fontSize:15,fontWeight:800}}>Crear clase</button>
        </div>
      </div>
      {showCreateStudent&&<NewStudentModal onClose={()=>setShowCreateStudent(false)} onSave={handleCreateStudent}/>}
      {showNewPackModal&&<NewPackageModal onClose={()=>{setShowNewPackModal(false);setPendingPackStudent(null);}} onSave={(pkg)=>{
        // Add to packages list
        if(onAddPackage) onAddPackage(pkg);
        // Auto-select for the student who triggered it
        if(pendingPackStudent){
          upd(pendingPackStudent,"packId",String(pkg.id));
          upd(pendingPackStudent,"pack",pkg.type==="mensual"?"mensual":pkg.type==="individual"?"individual":String(pkg.qty||""));
          upd(pendingPackStudent,"amount",pkg.price||0);
        }
        setShowNewPackModal(false);
        setPendingPackStudent(null);
      }}/>}
    </div>
  );
}

function NewStudentModal({ onClose, onSave }) {
  const [name,setName]=useState("");
  const [phone,setPhone]=useState(""); const [email,setEmail]=useState("");
  const [photo,setPhoto]=useState(null);
  const iS={width:"100%",padding:"14px 16px",borderRadius:12,border:"none",fontSize:14,boxSizing:"border-box",background:C.blueL,color:C.text,outline:"none"};
  const initials=name.trim().split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"?";
  const handlePhoto=(e)=>{const file=e.target.files[0];if(file){const r=new FileReader();r.onload=ev=>setPhoto(ev.target.result);r.readAsDataURL(file);}};
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:500,display:"flex",alignItems:"flex-end"}}>
      <div style={{background:C.white,borderRadius:"24px 24px 0 0",padding:"24px 20px",paddingBottom:"calc(140px + env(safe-area-inset-bottom, 34px))",width:"100%",maxHeight:"90vh",overflowY:"auto",boxSizing:"border-box"}}>
        <div style={{fontWeight:900,fontSize:22,color:C.text,marginBottom:20}}>Nuevo Alumno</div>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{position:"relative",width:88,height:88,margin:"0 auto"}}>
            {photo
              ?<img src={photo} style={{width:88,height:88,borderRadius:"50%",objectFit:"cover",border:"3px solid "+C.blue2}}/>
              :<div style={{width:88,height:88,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:800,color:C.white}}>{initials}</div>
            }
            <label htmlFor="newAvInput" style={{position:"absolute",bottom:0,right:0,width:28,height:28,borderRadius:"50%",background:C.blue2,border:"2px solid "+C.white,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </label>
            <input id="newAvInput" type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto}/>
          </div>
          <div style={{fontSize:12,color:C.mutedDark,marginTop:8}}>Tocá la cámara para subir foto</div>
        </div>
        {[{l:"Nombre *",v:name,s:setName,p:"Ej: Martina López"},{l:"Teléfono",v:phone,s:setPhone,p:"0981 123 456"},{l:"Email",v:email,s:setEmail,p:"alumno@correo.com"}].map(f=>(
          <div key={f.l} style={{marginBottom:14}}><label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>{f.l}</label><input value={f.v} onChange={e=>f.s(e.target.value)} placeholder={f.p} style={iS}/></div>
        ))}
        <div style={{display:"flex",gap:12,marginTop:8}}>
          <button onClick={onClose} style={{flex:1,padding:"15px",borderRadius:14,border:"1.5px solid "+C.border,background:C.white,cursor:"pointer",fontSize:15,color:C.mutedDark,fontWeight:700}}>Cancelar</button>
          <button onClick={()=>{if(!name.trim()){alert("El nombre es obligatorio.");return;}const init=name.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase();onSave({name,phone,email,photo,avatar:init,status:"active",combos:[]});onClose();}} style={{flex:1,padding:"15px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,cursor:"pointer",fontSize:15,fontWeight:800}}>Crear Alumno</button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ students, classes, onNavigate, onNewClass, onNewStudent, onInvite, expenses=[], coachProfile={}, onRefresh }) {
  const now=new Date();
  const curMonth=now.getMonth();
  const curYear=now.getFullYear();
  // Real income from this month's expenses
  const monthExpenses=expenses.filter(e=>{
    const d=new Date(e.date+"T12:00:00");
    return d.getMonth()===curMonth&&d.getFullYear()===curYear;
  });
  const income=monthExpenses.filter(e=>e.type==="ingreso").reduce((a,b)=>a+b.amount,0);
  const exp=monthExpenses.filter(e=>e.type==="gasto").reduce((a,b)=>a+b.amount,0);
  // Cobros alerts - students with unpaid combos
  const cobrosAlerts=students.filter(s=>{if(s.suspended)return false;const r=getRem(s,classes);return r!==null&&r<0||(!getCombo(s)?.paid&&getCombo(s)?.total);});
  // Combos that just completed and need renewal (new combo created but unpaid)
  const comboRenewalAlerts=students.filter(s=>{
    const combos=s.combos||[];
    if(combos.length===0) return false;
    const last=combos[combos.length-1];
    if(!last||!last.total||last.total<=0) return false;
    const paidCount=last.paidCount!==undefined?last.paidCount:(last.paid?last.total:0);
    const fullyPaid=paidCount>=(last.total||1);
    if(!fullyPaid) return false;
    // Check if combo period ended (all dates in the past)
    const allDates=last.dates||[];
    const futureDates=allDates.filter(d=>d>=TODAY_DATE);
    // Show alert if fully paid AND (all dates passed OR 2 or fewer future dates)
    return futureDates.length<=2;
  });

  // Classes that need rescheduling: ausente_reprog OR cancelled (but not already rescheduled)
  const reprogAlerts=[
    // Classes marked as "A Reprogramar" (cancelled_reprog without date)
    ...classes.filter(c=>c.cancelled&&c.cancelType==="cancelled_reprog"&&!c.rescheduledTo).map(c=>({
      cls:c,reason:"a_reprogramar",students:(c.students||[]).map(id=>students.find(s=>s.id===id)).filter(Boolean)
    })).filter(x=>x.students.length>0),
    // Ausente-reprog: student marked as needing reschedule from attendance
    ...classes.filter(c=>{
      if(c.cancelled) return false;
      return (c.attendanceLog||[]).some(e=>(e.ausente_reprog||[]).length>0);
    }).map(c=>{
      const log=(c.attendanceLog||[]).find(e=>(e.ausente_reprog||[]).length>0);
      return {cls:c,reason:"reprog",students:(log?.ausente_reprog||[]).map(id=>students.find(s=>s.id===id)).filter(Boolean)};
    }).filter(x=>x.students.length>0),
  ];
  const todayC=classes.filter(c=>c.date===TODAY_DATE&&!c.cancelled&&!isClassDone(c.date,c.timeEnd));
  const mN=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const todayLabel=new Date(TODAY_DATE+"T12:00:00").getDate()+" de "+mN[new Date(TODAY_DATE+"T12:00:00").getMonth()];
  return (
    <PullRefresh onRefresh={onRefresh||(() => {})} style={{flex:1,overflowY:"auto",background:C.bg,display:"flex",flexDirection:"column"}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"16px 16px 32px",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
          <div style={{width:46,height:46,borderRadius:"50%",background:C.whiteA,border:"2px solid "+C.whiteB,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:C.white,overflow:"hidden",flexShrink:0}}>
            {coachProfile.photo?<img src={coachProfile.photo} style={{width:46,height:46,objectFit:"cover"}}/>:(coachProfile.name||"C")[0].toUpperCase()}
          </div>
          <div><div style={{fontSize:12,color:C.muted}}>Bienvenido</div><div style={{fontSize:18,fontWeight:700,color:C.white}}>{coachProfile.name||"Coach"}</div></div>
          <div style={{marginLeft:"auto",background:C.whiteA,borderRadius:20,padding:"4px 12px",fontSize:12,color:C.white}}>{students.filter(s=>s.status==="active").length+" activos"}</div>
        </div>
        <div style={{background:C.whiteA,borderRadius:16,padding:"16px"}}>
          <div style={{fontSize:12,color:C.muted,marginBottom:4}}>Balance del mes · {mN[curMonth]+" "+curYear}</div>
          <div style={{fontSize:28,fontWeight:800,color:C.white,marginBottom:12}}>{fmtMoneyShort(income-exp)}</div>
          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
            <div><div style={{fontSize:11,color:C.muted}}>INGRESOS</div><div style={{fontSize:15,fontWeight:700,color:"#A5D6A7"}}>{income>0?fmtMoneyShort(income):"—"}</div></div>
            <div style={{width:1,background:C.whiteB}}></div>
            <div><div style={{fontSize:11,color:C.muted}}>GASTOS</div><div style={{fontSize:15,fontWeight:700,color:"#EF9A9A"}}>{exp>0?fmtMoneyShort(exp):"—"}</div></div>
            <div style={{width:1,background:C.whiteB}}></div>
            <div><div style={{fontSize:11,color:C.muted}}>A COBRAR</div><div style={{fontSize:15,fontWeight:700,color:"#FFF59D"}}>{cobrosAlerts.length>0?cobrosAlerts.length+" alumnos":"✓ Al día"}</div></div>
            <div style={{width:1,background:C.whiteB}}></div>
            <div><div style={{fontSize:11,color:C.muted}}>CLASES DADAS</div><div style={{fontSize:15,fontWeight:700,color:"#90CAF9"}}>{(()=>{
              const monthStr=String(curYear)+"-"+String(curMonth+1).padStart(2,"0");
              const doneDates=new Set();
              classes.forEach(cls=>{
                // Past classes default = realizada
                if(cls.date&&cls.date.startsWith(monthStr)&&cls.date<=TODAY_DATE&&!cls.cancelled){
                  // Check if marked as ausente_reprog (not given)
                  const log=(cls.attendanceLog||[]).find(e=>e.date===cls.date);
                  const allReprog=log&&(cls.students||[]).every(sid=>(log.ausente_reprog||[]).includes(sid));
                  if(!allReprog) doneDates.add(cls.date+"|"+cls.id);
                }
                // Also count attendance log entries from this month
                (cls.attendanceLog||[]).forEach(e=>{
                  if(e.date&&e.date.startsWith(monthStr)&&e.date<=TODAY_DATE&&((e.present||[]).length>0||(e.ausente_dada||[]).length>0)){
                    doneDates.add(e.date+"|"+cls.id);
                  }
                });
              });
              return doneDates.size+" clases";
            })()}</div></div>
          </div>
        </div>
      </div>
      <div style={{padding:16,marginTop:-16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20,marginTop:8}}>
          {[
            {label:"CREAR\nNUEVA CLASE",action:onNewClass,icon:<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="15" x2="12" y2="19"/><line x1="10" y1="17" x2="14" y2="17"/></svg>,color:"linear-gradient(160deg,#3AAD35,#65CE5A)"},
            {label:"VER\nCOBROS",action:()=>onNavigate("cobros"),icon:<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="12" cy="15" r="2"/></svg>,color:"linear-gradient(160deg,#3AAD35,#65CE5A)"},
            {label:"INVITAR\nALUMNOS",action:onInvite,icon:<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>,color:"linear-gradient(160deg,#3AAD35,#65CE5A)"},
          ].map((s,i)=>(
            <div key={i} onClick={s.action} style={{background:s.color||"linear-gradient(135deg,#0D1B4B,#1A3DB5)",borderRadius:20,padding:"20px 8px 16px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer",minHeight:110,boxShadow:"0 6px 18px rgba(0,0,0,0.15)"}}>
              {s.icon}
              <span style={{fontSize:11,fontWeight:800,color:C.white,textAlign:"center",lineHeight:1.4,whiteSpace:"pre-line",letterSpacing:0.5}}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Clases de hoy */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:800,color:C.text}}>📅 Clases de hoy · {todayLabel}</div>
          <button onClick={()=>onNavigate("agenda")} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.blue2,fontWeight:700}}>Ver agenda →</button>
        </div>
        {todayC.length===0&&<WhiteCard style={{marginBottom:16}}><div style={{textAlign:"center",color:C.mutedDark,fontSize:13}}>Sin clases hoy</div></WhiteCard>}
        {todayC.slice(0,4).map(c=>(
          <WhiteCard key={c.id} style={{marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",borderRadius:10,padding:"8px 10px",textAlign:"center",flexShrink:0}}>
                <div style={{fontSize:13,fontWeight:800,color:C.white}}>{c.time}</div>
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14,color:C.text}}>{c.title}{c.cancelled&&c.cancelType==="cancelled"?" (Cancelada)":c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo?" (Reprogramada)":c.cancelled&&c.cancelType==="cancelled_reprog"?" (A Reprogramar)":""}</div>
                <div style={{fontSize:12,color:C.mutedDark}}>{c.court+" · "+c.students.length+" alumno"+(c.students.length>1?"s":"")}</div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:3,maxWidth:80,justifyContent:"flex-end"}}>
                {c.days.map(d=><span key={d} style={{fontSize:9,padding:"2px 5px",borderRadius:10,background:C.blueL,color:C.blue2,fontWeight:600}}>{d}</span>)}
              </div>
            </div>
          </WhiteCard>
        ))}
        {todayC.length>4&&<button onClick={()=>onNavigate("agenda")} style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px solid "+C.blue2,background:C.blueL,color:C.blue2,fontSize:13,cursor:"pointer",fontWeight:700,marginBottom:8}}>Ver {todayC.length-4} clases más →</button>}

        {/* Clases a reprogramar */}
        {reprogAlerts.length>0&&(
          <div style={{marginTop:8,marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:800,color:C.text}}>⛔↩ Clases a reprogramar</div>
              <button onClick={()=>onNavigate("agenda")} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.blue2,fontWeight:700}}>Ver agenda →</button>
            </div>
            {reprogAlerts.slice(0,4).map(({cls,reason,students:sts},i)=>(
              <div key={i} onClick={()=>onNavigate("agenda",{reprog:cls})} style={{background:reason==="a_reprogramar"?"#E3F2FD":"#E8EAF6",border:"1.5px solid "+(reason==="a_reprogramar"?"#90CAF9":"#9FA8DA"),borderRadius:12,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                <div style={{width:36,height:36,borderRadius:12,background:reason==="a_reprogramar"?"linear-gradient(135deg,#1565C0,#42A5F5)":"linear-gradient(135deg,#3949AB,#5C6BC0)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:"#fff",flexShrink:0}}>{reason==="a_reprogramar"?"🕐":"↩"}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>{cls.title}</div>
                  <div style={{fontSize:11,color:reason==="a_reprogramar"?"#1565C0":"#3949AB",fontWeight:600}}>
                    {reason==="a_reprogramar"?"A reprogramar":"A reprogramar (asistencia)"} · {sts.map(s=>s.name.split(" ")[0]).join(", ")} · {fmtDate(cls.date)}
                  </div>
                </div>
              </div>
            ))}
            {reprogAlerts.length>4&&<div style={{fontSize:12,color:C.mutedDark,textAlign:"center",marginBottom:4}}>+{reprogAlerts.length-4} más</div>}
          </div>
        )}

        {/* Combo renovacion alerts */}
        {comboRenewalAlerts.length>0&&(
          <div style={{marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:800,color:C.text}}>🔄 Combos a renovar</div>
              <button onClick={()=>onNavigate("cobros")} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.blue2,fontWeight:700}}>Ver cobros →</button>
            </div>
            {comboRenewalAlerts.slice(0,3).map((s,i)=>{
              const last=s.combos[s.combos.length-1];
              return (
                <div key={i} onClick={()=>onNavigate("cobros")} style={{background:"#E8F5E9",border:"1.5px solid #A5D6A7",borderRadius:12,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#2E7D32,#43A047)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#fff",flexShrink:0}}>{s.avatar[0]}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.text}}>{s.name}</div>
                    <div style={{fontSize:11,color:"#2E7D32",fontWeight:600}}>Combo de {last?.total} clases terminado · Renovar combo</div>
                  </div>
                  <div style={{fontSize:20,fontWeight:900,color:"#2E7D32"}}>{last?.total}</div>
                </div>
              );
            })}
            {comboRenewalAlerts.length>3&&<div style={{fontSize:12,color:C.mutedDark,textAlign:"center",marginBottom:4}}>+{comboRenewalAlerts.length-3} más</div>}
          </div>
        )}

        {/* Alertas cobros */}
        {cobrosAlerts.length>0&&(
          <div style={{marginTop:8}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:800,color:C.text}}>⚠️ Cobros pendientes</div>
              <button onClick={()=>onNavigate("cobros")} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.blue2,fontWeight:700}}>Ver cobros →</button>
            </div>
            {cobrosAlerts.slice(0,4).map(s=>{
              const r=getRem(s,classes);
              const combo=getCombo(s);
              const count=r<0?Math.abs(r):combo?.total||0;
              return (
                <div key={s.id} onClick={()=>onNavigate("cobros")} style={{background:"#FFF3E0",border:"1.5px solid #FFB74D",borderRadius:12,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:C.white,flexShrink:0}}>{s.avatar}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.text}}>{s.name}</div>
                    <div style={{fontSize:11,color:"#E65100",fontWeight:600}}>{count+" clase"+(count>1?"s":"")+" a cobrar"}</div>
                  </div>
                  <span style={{fontSize:20,fontWeight:900,color:"#E65100"}}>{count}</span>
                </div>
              );
            })}
            {cobrosAlerts.length>4&&<button onClick={()=>onNavigate("cobros")} style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px solid #FFB74D",background:"#FFF3E0",color:"#E65100",fontSize:13,cursor:"pointer",fontWeight:700}}>Ver {cobrosAlerts.length-4} más →</button>}
          </div>
        )}
      </div>
    </PullRefresh>
  );
}

function Students({ students, onAdd, onUpdate, onDelete, onChat, classes=[], onInvite, userId, onInviteStudent, onRefresh }) {
  const [f,setF]=useState("all");
  const [editS,setEditS]=useState(null);
  const [search,setSearch]=useState("");
  const [infoS,setInfoS]=useState(null);
  const [invites,setInvites]=useState({});
  const [expandAll,setExpandAll]=useState(false);
  const [expandedIds,setExpandedIds]=useState(new Set());

  // Load invite status and detect active students (have messages)
  useEffect(()=>{
    if(!userId) return;
    Promise.all([
      supabase.from("invites").select("student_id,used").eq("coach_id",userId),
      supabase.from("messages").select("student_id").eq("coach_id",userId)
    ]).then(([invRes,msgRes])=>{
      const map={};
      const activeStudents=new Set((msgRes.data||[]).map(m=>m.student_id));
      (invRes.data||[]).forEach(inv=>{
        if(inv.used||activeStudents.has(inv.student_id)) map[inv.student_id]="active";
        else map[inv.student_id]="invited";
      });
      // Also mark students with messages but no invite as active
      activeStudents.forEach(sid=>{if(!map[sid]) map[sid]="active";});
      setInvites(map);
    });
  },[userId,students]);
  let list=f==="all"?students:students.filter(s=>s.status===f);
  if(search.trim()) list=list.filter(s=>s.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:C.bg,overflow:"hidden"}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"16px 16px 16px",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontSize:18,fontWeight:800,color:C.white}}>Mis Alumnos</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={onInvite} style={{padding:"8px 12px",borderRadius:20,border:"none",background:"rgba(255,255,255,0.2)",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>📲 Invitar</button>
            <button onClick={onAdd} style={{padding:"8px 16px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#52C048,#65CE5A)",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>+ Nuevo</button>
          </div>
        </div>
        <div style={{position:"relative",marginBottom:12}}>
          <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar alumno..." style={{width:"100%",padding:"10px 36px 10px 36px",borderRadius:12,border:"none",fontSize:14,boxSizing:"border-box",background:"rgba(255,255,255,0.18)",color:C.white,outline:"none"}}/>
          {search&&<button onClick={()=>setSearch("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.7)",fontSize:18,lineHeight:1}}>×</button>}
        </div>
        <div style={{display:"flex",gap:8}}>
          {[["all","Todos"],["active","Activos"],["inactive","Inactivos"]].map(([k,l])=>(
            <button key={k} onClick={()=>setF(k)} style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:f===k?C.white:C.whiteA,color:f===k?C.blue2:C.white}}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16,paddingBottom:"calc(120px + env(safe-area-inset-bottom, 34px))"}}>
        {list.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:C.mutedDark,fontSize:14}}>No se encontraron alumnos</div>}
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
          <button onClick={()=>{setExpandAll(v=>!v);setExpandedIds(new Set());}} style={{background:C.blueL,border:"none",borderRadius:10,padding:"10px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{expandAll?<><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></>:<><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></>}</svg>
            <span style={{fontSize:13,fontWeight:700,color:C.blue2}}>{expandAll?"Compactar":"Expandir"}</span>
          </button>
        </div>
        {list.map(s=>{
          const combo=getCombo(s); const rem=getRem(s,classes);
          const isExpanded=expandAll?!expandedIds.has(s.id):expandedIds.has(s.id);
          const toggleExpand=()=>setExpandedIds(p=>{const n=new Set(p);if(n.has(s.id))n.delete(s.id);else n.add(s.id);return n;});
          return (
            <WhiteCard key={s.id} style={{marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                {s.photo?<img src={s.photo} style={{width:44,height:44,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>:<div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:C.white,flexShrink:0}}>{s.avatar}</div>}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontWeight:700,fontSize:14,color:C.text}}>{s.name}</span>
                    <button onClick={()=>setEditS({...s})} style={{background:"none",border:"none",cursor:"pointer",padding:2}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  </div>
                  <div style={{fontSize:12,color:C.mutedDark,marginBottom:4,textAlign:"left"}}>{"Alta: "+(()=>{const d=s.createdAt||getCombo(s)?.date;return d?fmtDate(d):"—";})()}</div>
                  <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:7,height:7,borderRadius:"50%",background:s.status==="active"?C.green:"#BDBDBD"}}></div><span style={{fontSize:11,color:s.status==="active"?C.green:"#BDBDBD",fontWeight:600}}>{s.status==="active"?"Activo":"Inactivo"}</span></div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {invites[s.id]==="invited"&&<div style={{fontSize:10,fontWeight:700,color:"#5C7A9F",background:"#E8EEF4",padding:"3px 10px",borderRadius:10,letterSpacing:0.5}}>📩 INVITACIÓN ENVIADA</div>}
                  {invites[s.id]==="active"&&<div style={{fontSize:10,fontWeight:700,color:"#2E7D32",background:"#EDFBEC",padding:"3px 10px",borderRadius:10,letterSpacing:0.5}}>✅ APP ACTIVA</div>}
                  <button onClick={toggleExpand} style={{background:C.blueL,border:"none",cursor:"pointer",padding:8,borderRadius:8}}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{isExpanded?<polyline points="18 15 12 9 6 15"/>:<polyline points="6 9 12 15 18 9"/>}</svg>
                  </button>
                </div>
              </div>
              {isExpanded&&(
                <div style={{display:"flex",gap:8,marginTop:12,paddingTop:12,borderTop:"1px solid "+C.border}}>
                  <button onClick={()=>setInfoS(infoS?.id===s.id?null:s)} style={{flex:1,background:C.blueL,border:"none",borderRadius:12,padding:"14px 0",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:C.blue2}}>VER PAGOS</span>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  </button>
                  <button onClick={()=>onChat&&onChat(s)} style={{flex:1,background:C.blueL,border:"none",borderRadius:12,padding:"14px 0",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:C.blue2}}>CHATEAR</span>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                  </button>
                  <button onClick={()=>onInviteStudent&&onInviteStudent(s)} style={{flex:1,background:C.blueL,border:"none",borderRadius:12,padding:"14px 0",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:C.blue2}}>INVITAR</span>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  </button>
                </div>
              )}
              {/* Info panel */}
              {infoS?.id===s.id&&(()=>{
                const myClasses=classes.filter(c=>c.students&&c.students.includes(s.id));
                const rem=getRem(s,classes); const combo=getCombo(s);
                const isRed=rem!==null&&rem<0||(!combo?.paid);
                const noData=!combo||(!combo.total&&!combo.paidCount&&!combo.paid);
                const statusColor=noData?"#9BACCB":rem===null?C.blue2:isRed?"#C62828":rem===0?"#43A047":C.blue2;
                const statusLabel=noData?"Sin registro":rem===null?"Mensual":isRed?"A cobrar":rem===0?"Al día":"Programadas";
                // Mini 4-column summary
                const allDatesSRaw=(s.combos||[]).filter(c=>c.total>0||(c.packType&&c.packType!=="mensual")).flatMap(c=>(c.dates||[]).map((d,i)=>({
                  date:d,
                  isPaid:(c.paidCount!==undefined?c.paidCount:(c.paid?c.total:0))>i,
                  isGiven:(()=>{const att=myClasses.flatMap(cl=>cl.attendanceLog||[]).find(e=>e.date===d);return att?(att.present||[]).includes(s.id)||(att.ausente_dada||[]).includes(s.id):d<TODAY_DATE;})(),
                })));
                const seenDS=new Set();
                const allDatesS=allDatesSRaw.filter(d=>{if(seenDS.has(d.date))return false;seenDS.add(d.date);return true;});
                return (
                  <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid "+C.border}}>
                    {/* Classes */}
                    {myClasses.length>0&&(
                      <div style={{marginBottom:10}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.mutedDark,marginBottom:6}}>CLASES</div>
                        {[...new Map(myClasses.map(c=>[c.title,c])).values()].slice(0,3).map(cls=>(
                          <div key={cls.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <div style={{flex:1,fontSize:12,fontWeight:600,color:C.text}}>{cls.title}</div>
                            <div style={{fontSize:11,color:C.mutedDark}}>{cls.time}</div>
                            <div style={{display:"flex",gap:3}}>
                              {(cls.days||[]).map(d=><span key={d} style={{fontSize:9,padding:"2px 5px",borderRadius:10,background:C.blueL,color:C.blue2,fontWeight:600}}>{d}</span>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {myClasses.length===0&&<div style={{fontSize:12,color:C.mutedDark,marginBottom:10}}>Sin clases asignadas</div>}
                    {/* Estado de Cuenta - 4 columns */}
                    {allDatesS.length>0&&(()=>{
                      const nP=allDatesS.filter(d=>!d.isPaid).length;
                      const pg=allDatesS.filter(d=>d.isPaid).length;
                      const pr=allDatesS.filter(d=>!d.isGiven&&d.date>=TODAY_DATE).length;
                      const re=allDatesS.filter(d=>d.isGiven).length;
                      const miniCols=[{n:nP,c:"#C62828",bg:"#FFEBEE",l:"No Pag."},{n:pg,c:"#2E7D32",bg:"#EDFBEC",l:"Pagada"},{n:pr,c:C.blue2,bg:C.blueL,l:"Progr."},{n:re,c:"#555",bg:"#F5F5F5",l:"Realiz."}];
                      return (
                        <>
                          <div style={{fontSize:11,fontWeight:700,color:C.mutedDark,marginBottom:6}}>ESTADO DE CUENTA</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:4}}>
                            {miniCols.map((col,i)=>(
                              <div key={i} style={{background:col.bg,borderRadius:8,padding:"6px 2px",textAlign:"center"}}>
                                <div style={{fontSize:15,fontWeight:900,color:col.c,lineHeight:1}}>{col.n}</div>
                                <div style={{fontSize:8,fontWeight:700,color:col.c,marginTop:2}}>{col.l}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                );
              })()}
            </WhiteCard>
          );
        })}
      </div>
      <button onClick={onAdd} style={{position:"fixed",bottom:72,right:20,width:56,height:56,borderRadius:"50%",border:"none",background:"linear-gradient(135deg,#52C048,#65CE5A)",color:C.white,fontSize:28,cursor:"pointer",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      {editS&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:99,display:"flex",flexDirection:"column",background:C.bg}}>
          <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"14px 16px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
            <button onClick={()=>setEditS(null)} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.white,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
            <span style={{flex:1,fontWeight:800,fontSize:16,color:C.white}}>Editar Alumno</span>
          </div>
          <div style={{flex:1,overflowY:"auto",background:C.bg,padding:20}}>
            <div style={{textAlign:"center",marginBottom:24}}>
              <div style={{position:"relative",width:88,height:88,margin:"0 auto"}}>
                {editS.photo
                  ?<img src={editS.photo} style={{width:88,height:88,borderRadius:"50%",objectFit:"cover",border:"3px solid "+C.blue2}}/>
                  :<div style={{width:88,height:88,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:800,color:C.white}}>{editS.avatar}</div>
                }
                <label htmlFor="editAvInput" style={{position:"absolute",bottom:0,right:0,width:28,height:28,borderRadius:"50%",background:C.blue2,border:"2px solid "+C.white,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </label>
                <input id="editAvInput" type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const file=e.target.files[0];if(file){const r=new FileReader();r.onload=ev=>setEditS({...editS,photo:ev.target.result});r.readAsDataURL(file);}}}/>
              </div>
              {editS.photo&&<button onClick={()=>setEditS({...editS,photo:null})} style={{marginTop:8,background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.mutedDark,textDecoration:"underline"}}>Eliminar foto</button>}
            </div>
            <div style={{marginBottom:14}}><label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Nombre completo</label><input value={editS.name} onChange={e=>setEditS({...editS,name:e.target.value})} style={{width:"100%",padding:"13px 16px",borderRadius:12,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",color:C.text,background:C.white,outline:"none"}}/></div>
            <div style={{marginBottom:14}}><label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Teléfono</label><input value={editS.phone||""} onChange={e=>setEditS({...editS,phone:e.target.value})} placeholder="0981 123 456" style={{width:"100%",padding:"13px 16px",borderRadius:12,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",color:C.text,background:C.white,outline:"none"}}/></div>
            <div style={{marginBottom:20}}><label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Email</label><input value={editS.email||""} onChange={e=>setEditS({...editS,email:e.target.value})} placeholder="alumno@correo.com" type="email" style={{width:"100%",padding:"13px 16px",borderRadius:12,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",color:C.text,background:C.white,outline:"none"}}/></div>
            <div style={{marginBottom:24}}>
              <label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:8}}>Estado</label>
              <div style={{display:"flex",gap:10}}>
                {[["active","● Activo"],["inactive","○ Inactivo"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setEditS({...editS,status:k})} style={{flex:1,padding:"13px",borderRadius:12,border:"2px solid "+(editS.status===k?(k==="active"?C.green:C.border):"transparent"),background:editS.status===k?(k==="active"?C.greenL:C.bg):C.bg,color:editS.status===k?(k==="active"?C.green:C.mutedDark):C.mutedDark,fontSize:14,cursor:"pointer",fontWeight:700}}>{l}</button>
                ))}
              </div>
            </div>
            <button onClick={()=>{if(!editS.name.trim())return;onUpdate(editS);setEditS(null);}} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,fontSize:15,cursor:"pointer",fontWeight:800,marginBottom:10}}>Guardar cambios</button>
            <button onClick={()=>{if(window.confirm("¿Eliminar a "+editS.name+"? Esta acción no se puede deshacer.")){onDelete(editS.id);setEditS(null);}}} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:"#FFF0F0",color:"#D32F2F",fontSize:15,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:20}}>🗑 Eliminar alumno</button>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteModal({ student, userId, onClose }) {
  const [code,setCode]=useState("");
  const [loading,setLoading]=useState(true);
  const [copied,setCopied]=useState(false);
  useEffect(()=>{
    if(!student||!userId) return;
    supabase.from("invites").select("code").eq("coach_id",userId).eq("student_id",student.id).eq("used",false).single()
      .then((res)=>{
        if(res.data&&res.data.code){setCode(res.data.code);setLoading(false);return;}
        const c=Math.random().toString(36).slice(2,10).toUpperCase();
        const coachName=(JSON.parse(localStorage.getItem("izi_profile")||"{}")).name||"";
        supabase.from("invites").insert({code:c,coach_id:userId,student_id:student.id,used:false,coach_name:coachName})
          .then(()=>{setCode(c);setLoading(false);});
      });
  },[]);
  const url="https://izicoach.vercel.app?invite="+code;
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",zIndex:999,display:"flex",alignItems:"flex-end"}}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",padding:"28px 20px 44px",width:"100%",boxSizing:"border-box"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"#DDE3F0",margin:"0 auto 20px"}}></div>
        <div style={{fontWeight:900,fontSize:18,color:C.text,marginBottom:4}}>Invitar a {student.name}</div>
        <div style={{fontSize:13,color:C.mutedDark,marginBottom:20}}>Compartí este link para que el alumno se registre.</div>
        {loading?<div style={{textAlign:"center",padding:20,color:C.mutedDark}}>Generando...</div>:(
          <div>
            <div style={{background:C.blueL,borderRadius:12,padding:"14px 16px",marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:C.mutedDark,marginBottom:6}}>LINK</div>
              <div style={{fontSize:13,color:C.blue2,fontWeight:600,wordBreak:"break-all"}}>{url}</div>
            </div>
            <div style={{background:"#F5F5F5",borderRadius:12,padding:"14px 16px",marginBottom:16,textAlign:"center"}}>
              <div style={{fontSize:11,fontWeight:700,color:C.mutedDark,marginBottom:8}}>CÓDIGO</div>
              <div style={{fontSize:32,fontWeight:900,color:C.text,letterSpacing:6}}>{code}</div>
            </div>
            <button onClick={()=>{
              const doCopy=()=>{
                if(navigator.clipboard&&navigator.clipboard.writeText){
                  navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{
                    const el=document.createElement("textarea");el.value=url;document.body.appendChild(el);el.select();document.execCommand("copy");document.body.removeChild(el);setCopied(true);setTimeout(()=>setCopied(false),2000);
                  });
                } else {
                  const el=document.createElement("textarea");el.value=url;document.body.appendChild(el);el.select();document.execCommand("copy");document.body.removeChild(el);setCopied(true);setTimeout(()=>setCopied(false),2000);
                }
              };
              doCopy();
            }} style={{width:"100%",padding:"14px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:"#fff",fontSize:14,cursor:"pointer",fontWeight:800,marginBottom:10}}>{copied?"✓ Copiado!":"📋 Copiar link"}</button>
          </div>
        )}
        <button onClick={onClose} style={{width:"100%",padding:"13px",borderRadius:14,border:"none",background:"#F5F5F5",color:C.mutedDark,fontSize:14,cursor:"pointer",fontWeight:600}}>Cerrar</button>
      </div>
    </div>
  );
}

function MiniCalendar({ year, month, selDay, onSelect, classes=[] }) {
  const mN=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const dL=["Do","Lu","Ma","Mi","Ju","Vi","Sá"];
  const firstDow=new Date(year,month,1).getDay();
  const dim=new Date(year,month+1,0).getDate();
  const cells=[];
  for(let i=0;i<firstDow;i++) cells.push(null);
  for(let d=1;d<=dim;d++) cells.push(d);
  while(cells.length%7!==0) cells.push(null);
  return (
    <div style={{background:C.white,borderRadius:16,margin:"0 16px",padding:"14px",boxShadow:"0 2px 16px rgba(21,101,192,0.10)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <span style={{fontWeight:700,fontSize:15,color:C.text}}>{mN[month]+" "+year}</span>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>onSelect("prev")} style={{background:C.blueL,border:"none",borderRadius:8,width:28,height:28,cursor:"pointer",color:C.blue2,fontWeight:700}}>{"‹"}</button>
          <button onClick={()=>onSelect("next")} style={{background:C.blueL,border:"none",borderRadius:8,width:28,height:28,cursor:"pointer",color:C.blue2,fontWeight:700}}>{"›"}</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
        {dL.map(l=><div key={l} style={{textAlign:"center",fontSize:11,fontWeight:700,color:C.mutedDark,padding:"2px 0"}}>{l}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
        {cells.map((d,i)=>{
          if(!d) return <div key={"e"+i}></div>;
          const mm=String(month+1).padStart(2,"0"); const dd=String(d).padStart(2,"0");
          const ds=year+"-"+mm+"-"+dd; const isA=selDay===ds; const isTodayCell=ds===TODAY_DATE;
          const dayClasses=classes.filter(c=>c.date===ds&&!c.cancelled);
          const cancelledClasses=classes.filter(c=>c.date===ds&&c.cancelled&&!c.rescheduled);
          const hasClasses=dayClasses.length>0||cancelledClasses.length>0;
          return (
            <button key={i} onClick={()=>onSelect(ds)} style={{background:isA?"linear-gradient(135deg,"+C.blue2+","+C.blue3+")":isTodayCell?C.blueL:"transparent",border:isTodayCell&&!isA?"2px solid "+C.blue2:"none",borderRadius:"50%",width:34,height:34,margin:"auto",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,position:"relative"}}>
              <span style={{fontSize:13,fontWeight:isA||hasClasses?700:400,color:isA?C.white:isTodayCell?C.blue2:C.text,lineHeight:1}}>{d}</span>
              {hasClasses&&(
                <div style={{display:"flex",gap:2,position:"absolute",bottom:4}}>
                  {dayClasses.slice(0,3).map((_,ci)=>(
                    <div key={ci} style={{width:4,height:4,borderRadius:"50%",background:isA?"rgba(255,255,255,0.8)":C.blue2}}></div>
                  ))}
                  {cancelledClasses.slice(0,2).map((_,ci)=>(
                    <div key={"c"+ci} style={{width:4,height:4,borderRadius:"50%",background:isA?"rgba(255,255,255,0.8)":"#E53935"}}></div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditClassScreen({ cls, students: initialStudents, onClose, onSave, onCreateStudent, packages=[], onDelete }) {
  if(!cls) return null;
  try {
  const [title,setTitle]=useState(cls.title); const [court,setCourt]=useState(cls.court);
  const [days,setDays]=useState([...cls.days]);
  const [t1,setT1]=useState(cls.time); const [t2,setT2]=useState(cls.timeEnd||"09:00");
  const [clsSt,setClsSt]=useState(()=>(cls.students||[]).filter(sid=>initialStudents.some(s=>s.id===sid)));
  const [query,setQuery]=useState("");
  const [showCreateStudent,setShowCreateStudent]=useState(false);
  const [allStudents,setAllStudents]=useState(initialStudents);
  // Per-student package/amount editing
  const [studentPacks,setStudentPacks]=useState(()=>{
    const init={};
    cls.students.forEach(sid=>{
      const st=initialStudents.find(s=>s.id===sid);
      if(!st){init[sid]={pack:"",amount:0,paid:false};return;}
      const combos=st?.combos||[];
      // Find combo that covers this class date, or fall back to last combo
      const combo=combos.find(c=>(c.dates||[]).includes(cls.date))||combos[combos.length-1];
      if(!combo){init[sid]={pack:"",amount:0,paid:false};return;}
      // Find matching package - first try packId, then qty+amount, then qty
      let packVal="";
      if(combo.packId){
        packVal=combo.packId;
      } else if(combo.total===null||combo.packType==="mensual"){
        const pkg=packages.find(p=>p.type==="mensual");
        packVal=pkg?String(pkg.id):"mensual";
      } else if(combo.packType==="individual"){
        const pkg=packages.find(p=>p.type==="individual"&&p.price===combo.amount)||
                  packages.find(p=>p.type==="individual");
        packVal=pkg?String(pkg.id):"individual";
      } else {
        const pkg=packages.find(p=>p.qty===combo.total&&p.price===combo.amount)||
                  packages.find(p=>p.qty===combo.total);
        packVal=pkg?String(pkg.id):String(combo.total);
      }
      init[sid]={pack:packVal,amount:combo?.amount||0,paid:combo?.paid||false};
    });
    return init;
  });
  const available=allStudents.filter(s=>!clsSt.includes(s.id)&&(query.trim()===""||s.name.toLowerCase().includes(query.toLowerCase())));
  const iS={width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",background:C.white,color:C.text,outline:"none"};

  const handleCreateStudent=(data)=>{
    const newS={id:Date.now(),...data};
    setAllStudents(prev=>[...prev,newS]);
    setClsSt(prev=>[...prev,newS.id]);
    onCreateStudent&&onCreateStudent(newS);
    setShowCreateStudent(false);
  };

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:99,display:"flex",flexDirection:"column",background:C.bg}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"14px 16px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.white,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
        <span style={{flex:1,fontWeight:800,fontSize:16,color:C.white}}>Modificar Clase</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16,paddingBottom:"calc(120px + env(safe-area-inset-bottom, 34px))"}}>
        <div style={{marginBottom:14}}><label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Título</label><input value={title} onChange={e=>setTitle(e.target.value)} style={iS}/></div>
        <div style={{marginBottom:14}}><label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Local / Cancha</label><input value={court} onChange={e=>setCourt(e.target.value)} style={iS}/></div>
        <div style={{marginBottom:14}}><label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:8}}>Días</label><DayPicker value={days} onChange={setDays}/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          <div><label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Hora inicio</label><TimePicker value={t1} onChange={setT1} style={{...iS,padding:"10px 8px"}}/></div>
          <div><label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Hora fin</label><TimePicker value={t2} onChange={setT2} style={{...iS,padding:"10px 8px"}}/></div>
        </div>
        <div style={{marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <label style={{fontSize:13,color:C.blue,fontWeight:700}}>Alumnos</label>
            <button onClick={()=>setShowCreateStudent(true)} style={{padding:"6px 12px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#52C048,#65CE5A)",color:C.white,fontSize:11,cursor:"pointer",fontWeight:800,letterSpacing:0.3}}>+ CREAR ALUMNO</button>
          </div>
          {clsSt.map(sid=>{const st=allStudents.find(s=>s.id===sid);return st?(
            <div key={sid} style={{borderRadius:12,background:C.white,border:"1.5px solid "+C.border,marginBottom:8,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px"}}>
                {st.photo?<img src={st.photo} style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>:<div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:C.white,flexShrink:0}}>{st.avatar}</div>}
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,color:C.text}}>{st.name}</div></div>
                <button onClick={()=>setClsSt(prev=>prev.filter(x=>x!==sid))} style={{background:"#FFEBEE",border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              {/* Package/amount per student */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:"0 12px 10px"}}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:C.mutedDark,marginBottom:4}}>PAQUETE</div>
                  <select value={studentPacks[sid]?.pack||""} onChange={e=>{
                    const val=e.target.value;
                    const pkg=packages.find(p=>String(p.id)===val);
                    setStudentPacks(p=>({...p,[sid]:{pack:val,amount:pkg?pkg.price:(p[sid]?.amount||0)}}));
                  }} style={{...iS,padding:"8px 10px",fontSize:12}}>
                    <option value="">Elegir...</option>
                    {packages.length>0?packages.map(p=>(
                      <option key={p.id} value={String(p.id)}>{p.name}</option>
                    )):<><option value="mensual">📅 Mensual</option><option value="8">📦 8 clases</option></>}
                    <option value="otro">✏️ Otro</option>
                  </select>
                  {studentPacks[sid]?.pack==="otro"&&(
                    <input type="text" placeholder="Ej: 5 clases, Mensual..." value={studentPacks[sid]?.customLabel||""} onChange={e=>setStudentPacks(p=>({...p,[sid]:{...p[sid],customLabel:e.target.value}}))} style={{...iS,padding:"8px 10px",fontSize:12,marginTop:6}}/>
                  )}
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:C.mutedDark,marginBottom:4}}>MONTO ({getCUR()})</div>
                  <MoneyInput value={studentPacks[sid]?.amount||0} onChange={v=>setStudentPacks(p=>({...p,[sid]:{...p[sid],amount:v}}))} style={{...iS,padding:"8px 10px",fontSize:12}}/>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={{fontSize:11,color:C.blue2,fontWeight:700,display:"block",marginBottom:6}}>PAGO EFECTUADO</label>
                  <div style={{display:"flex",gap:12}}>
                    {[true,false].map(v=>{
                      const isPaidVal=studentPacks[sid]?.paid===true;
                      const isSelected=v===true?isPaidVal:!isPaidVal;
                      return (
                      <div key={String(v)} onClick={()=>setStudentPacks(p=>({...p,[sid]:{...p[sid],paid:v}}))} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
                        <div style={{width:20,height:20,borderRadius:"50%",background:isSelected?"linear-gradient(135deg,#0D1B4B,#1A3DB5)":C.blueL,border:"2px solid "+(isSelected?C.blue2:C.border),display:"flex",alignItems:"center",justifyContent:"center"}}>{isSelected&&<div style={{width:7,height:7,borderRadius:"50%",background:C.white}}></div>}</div>
                        <span style={{fontSize:12,fontWeight:isSelected?700:500,color:isSelected?C.blue2:C.mutedDark}}>{v?"✓ Sí":"✗ No"}</span>
                      </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ):null;})}
          <div style={{position:"relative",marginTop:4}}>
            <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.mutedDark} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar alumno para agregar..." style={{width:"100%",padding:"11px 14px 11px 34px",borderRadius:12,border:"1.5px dashed "+C.blue2,fontSize:13,boxSizing:"border-box",background:C.blueL,color:C.text,outline:"none"}}/>
            {query&&<button onClick={()=>setQuery("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.mutedDark,fontSize:18}}>×</button>}
          </div>
          {query.trim().length>0&&(
            <div style={{background:C.white,borderRadius:12,border:"1.5px solid "+C.border,marginTop:4,overflow:"hidden"}}>
              {available.length===0
                ?<div style={{padding:"12px 14px",fontSize:13,color:C.mutedDark}}>No se encontraron alumnos</div>
                :available.map(s=>(
                  <div key={s.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:"1px solid "+C.border,cursor:"pointer"}} onClick={()=>{setClsSt(prev=>[...prev,s.id]);setStudentPacks(p=>({...p,[s.id]:{pack:"",amount:0,paid:false}}));setQuery("");}}>
                    {s.photo?<img src={s.photo} style={{width:34,height:34,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>:<div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:C.white,flexShrink:0}}>{(s.avatar||s.name?.slice(0,2)||"?").slice(0,2)}</div>}
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,color:C.text}}>{s.name}</div></div>
                    <div style={{background:C.blue2,borderRadius:8,padding:"5px 12px",color:C.white,fontSize:12,fontWeight:700}}>+ Agregar</div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
        <button onClick={()=>{
          // Regenerate occurrences if days changed
          let newOccurrences=cls.occurrences||[];
          if(JSON.stringify(days)!==JSON.stringify(cls.days)&&days.length>0){
            const DAY_MAP2={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
            const dowSet=new Set(days.map(d=>DAY_MAP2[d]));
            const result=[];
            const sd=cls.startDate||cls.date;
            const ed=cls.endDate;
            let cur=new Date(sd+"T12:00:00");
            const end=ed?new Date(ed+"T12:00:00"):new Date(new Date(sd+"T12:00:00").setMonth(new Date(sd+"T12:00:00").getMonth()+6));
            while(cur<=end&&result.length<200){
              if(dowSet.has(cur.getDay())){
                result.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
              }
              cur.setDate(cur.getDate()+1);
            }
            newOccurrences=result;
          }
          onSave({...cls,title,court,days,time:t1,timeEnd:t2,students:clsSt,studentPacks,occurrences:newOccurrences});
        }} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,fontSize:15,cursor:"pointer",fontWeight:800,marginBottom:10}}>Actualizar Clase</button>
        <button onClick={()=>{if(window.confirm("¿Eliminar esta clase? Todas las instancias serán eliminadas del calendario.")) {onDelete&&onDelete(cls.id);onClose();}}} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:"#FFF0F0",color:"#D32F2F",fontSize:15,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:20}}>🗑 Eliminar Clase</button>
      </div>
      {showCreateStudent&&<NewStudentModal onClose={()=>setShowCreateStudent(false)} onSave={handleCreateStudent}/>}
    </div>
  );
  } catch(err) {
    console.error("EditClassScreen error:", err);
    return <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:99,background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:16,color:"red"}}>Error: {err.message}</div>
      <button onClick={onClose} style={{padding:"12px 24px",borderRadius:12,border:"none",background:"#0D1B4B",color:"#fff",cursor:"pointer"}}>Cerrar</button>
    </div>;
  }
}

function CancelReprogModal({ cls, onClose, onSave, students=[], onUpdateStudent }) {
  const [selected,setSelected]=useState(cls.cancelled&&cls.cancelType==="cancelled_reprog"&&!cls.rescheduledTo?"reprog":null); // null, "cancel", "reprog"
  const [newDate,setNewDate]=useState("");
  const [newTime,setNewTime]=useState(cls.time||"08:00");

  const DAY_MAP={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
  const classDowSet=new Set((cls.days||[]).map(d=>DAY_MAP[d]));
  const getNextClassDate=(fromDate)=>{
    const d=new Date(fromDate+"T12:00:00");d.setDate(d.getDate()+1);
    for(let i=0;i<14;i++){if(classDowSet.size===0||classDowSet.has(d.getDay())) return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");d.setDate(d.getDate()+1);}
    return null;
  };
  const nextAuto=getNextClassDate(cls.date);
  const targetDate=newDate||nextAuto;
  const targetLabel=targetDate?fmtDate(targetDate):null;
  const clsStudents=(cls.students||[]).map(id=>students.find(s=>s.id===id)).filter(Boolean);

  const [reprogLater,setReprogLater]=useState(false);
  const isAssigningDate=cls.cancelled&&cls.cancelType==="cancelled_reprog"&&!cls.rescheduledTo;

  const handleConfirm=()=>{
    if(selected==="cancel"){
      onSave({...cls,cancelled:true,cancelType:"cancelled",rescheduledTo:null,applyToAll:false},true);
      onClose();
    } else if(selected==="reprog"&&reprogLater){
      onSave({...cls,cancelled:true,cancelType:"cancelled_reprog",rescheduledTo:null,applyToAll:false},true);
      onClose();
    } else if(selected==="reprog"&&targetDate){
      const oldDate=cls.date;
      const updatedLog=(cls.attendanceLog||[]).map(e=>e.date===oldDate?{...e,ausente_reprog:[],rescheduled_to:targetDate}:e);
      onSave({...cls,cancelled:true,cancelType:"cancelled_reprog",rescheduledTo:targetDate,rescheduled:true,attendanceLog:updatedLog,applyToAll:false},true);
      // Combo dates are NOT changed — the original date stays as the billing slot
      // The rescheduled class appears on the new date as a normal class instance
      onClose();
    }
  };

  const handleReprogLater=()=>{
    onSave({...cls,cancelled:true,cancelType:"cancelled_reprog",rescheduledTo:null,applyToAll:false},true);
    onClose();
  };

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",zIndex:999,display:"flex",alignItems:"flex-end"}}>
      <div style={{background:"#F5F7FF",borderRadius:"24px 24px 0 0",padding:"28px 20px",paddingBottom:"calc(40px + env(safe-area-inset-bottom, 34px))",width:"100%",maxHeight:"90vh",overflowY:"auto",boxSizing:"border-box"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"#DDE3F0",margin:"0 auto 20px"}}></div>
        <div style={{fontWeight:900,fontSize:19,color:"#0D1B4B",marginBottom:4}}>{isAssigningDate?"Asignar fecha":"Reprogramar / Cancelar"}</div>
        <div style={{fontSize:13,color:"#6B7BAD",marginBottom:20}}>{cls.title} · {fmtDate(cls.date)} · {cls.time}</div>

        {/* Options - hidden when assigning date to existing A Reprogramar */}
        {!isAssigningDate&&(
        <>
        {/* Option 1: Cancel */}
        <div onClick={()=>setSelected("cancel")} style={{display:"flex",alignItems:"center",gap:14,padding:"16px",borderRadius:14,border:"2px solid "+(selected==="cancel"?"#C62828":"#FFCDD2"),background:selected==="cancel"?"#FFF0F0":"#fff",marginBottom:10,cursor:"pointer",transition:"all 0.15s"}}>
          <div style={{width:22,height:22,borderRadius:"50%",border:"2px solid "+(selected==="cancel"?"#C62828":"#ccc"),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {selected==="cancel"&&<div style={{width:12,height:12,borderRadius:"50%",background:"#C62828"}}></div>}
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:14,color:"#C62828"}}>⛔ Cancelar clase</div>
            <div style={{fontSize:12,color:"#6B7BAD",marginTop:2}}>Se cancela y se cobra. Cuenta como realizada.</div>
          </div>
        </div>

        {/* Option 2: Cancel + Reprog */}
        <div onClick={()=>setSelected("reprog")} style={{display:"flex",alignItems:"center",gap:14,padding:"16px",borderRadius:14,border:"2px solid "+(selected==="reprog"?"#1565C0":"#90CAF9"),background:selected==="reprog"?"#E3F2FD":"#fff",marginBottom:10,cursor:"pointer",transition:"all 0.15s"}}>
          <div style={{width:22,height:22,borderRadius:"50%",border:"2px solid "+(selected==="reprog"?"#1565C0":"#ccc"),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {selected==="reprog"&&<div style={{width:12,height:12,borderRadius:"50%",background:"#1565C0"}}></div>}
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:14,color:"#1565C0"}}>🔄 Cancelar y Reprogramar</div>
            <div style={{fontSize:12,color:"#6B7BAD",marginTop:2}}>Se cancela y se reprograma a otra fecha.</div>
          </div>
        </div>
        </>
        )}

        {/* Reprog date picker - appears when reprog selected or assigning date */}
        {selected==="reprog"&&(
          <div style={{background:"#fff",borderRadius:14,padding:"16px",marginBottom:10,border:"1px solid #90CAF9"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div>
                <label style={{fontSize:12,color:"#1565C0",fontWeight:700,display:"block",marginBottom:6}}>Nueva fecha</label>
                <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} style={{width:"100%",padding:"12px",borderRadius:10,border:"none",fontSize:13,boxSizing:"border-box",background:"#E3F2FD",color:"#0D1B4B",outline:"none"}}/>
              </div>
              <div>
                <label style={{fontSize:12,color:"#1565C0",fontWeight:700,display:"block",marginBottom:6}}>Nueva hora</label>
                <input type="time" value={newTime} onChange={e=>setNewTime(e.target.value)} style={{width:"100%",padding:"12px",borderRadius:10,border:"none",fontSize:13,boxSizing:"border-box",background:"#E3F2FD",color:"#0D1B4B",outline:"none"}}/>
              </div>
            </div>
            {targetLabel&&<div style={{fontSize:12,color:"#2E7D32",background:"#E8F5E9",borderRadius:10,padding:"10px 12px",marginBottom:10}}>📅 Se moverá al <b>{targetLabel}</b> a las <b>{newTime}</b></div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {clsStudents.map(st=>(
                <div key={st.id} style={{display:"flex",alignItems:"center",gap:4,background:"#E3F2FD",borderRadius:20,padding:"3px 8px 3px 4px",fontSize:11,color:"#1565C0",fontWeight:600}}>
                  <div style={{width:16,height:16,borderRadius:"50%",background:"#1565C0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,color:"#fff",fontWeight:700}}>{st.avatar[0]}</div>
                  {st.name.split(" ")[0]}
                </div>
              ))}
            </div>
            {!isAssigningDate&&<button onClick={()=>setReprogLater(!reprogLater)} style={{width:"100%",padding:"10px",borderRadius:10,border:reprogLater?"2px solid #1565C0":"1.5px solid #90CAF9",background:reprogLater?"#E3F2FD":"#fff",color:"#1565C0",fontSize:12,cursor:"pointer",fontWeight:700}}>
              {reprogLater?"✓ ":""}🕐 Reprogramar luego (sin fecha)
            </button>}
          </div>
        )}

        {/* Confirm + Back buttons */}
        <div style={{display:"flex",gap:10,marginTop:6}}>
          <button onClick={onClose} style={{flex:1,padding:"14px",borderRadius:14,border:"1.5px solid #DDE3F0",background:"#fff",cursor:"pointer",fontSize:14,color:"#6B7BAD",fontWeight:700}}>Volver</button>
          <button onClick={handleConfirm} disabled={!selected||(selected==="reprog"&&!targetDate&&!reprogLater)} style={{flex:2,padding:"14px",borderRadius:14,border:"none",background:!selected?"#ccc":selected==="cancel"?"linear-gradient(135deg,#C62828,#E53935)":"linear-gradient(135deg,#1565C0,#42A5F5)",color:"#fff",cursor:selected?"pointer":"not-allowed",fontSize:14,fontWeight:800,opacity:(!selected||(selected==="reprog"&&!targetDate&&!reprogLater))?0.5:1}}>
            {isAssigningDate?"📅 Asignar fecha":selected==="cancel"?"⛔ Confirmar cancelación":selected==="reprog"?(reprogLater?"🕐 Confirmar sin fecha":"📅 Confirmar reprogramación"):"Elegí una opción"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReprogModal({ cls, onClose, onSave, students=[], onUpdateStudent }) {
  const [newDate,setNewDate]=useState("");
  const [newTime,setNewTime]=useState(cls.time||"08:00");
  const [notified,setNotified]=useState(false);
  const mN=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const currentDate=new Date(cls.date+"T12:00:00");
  const currentLabel=currentDate.getDate()+" de "+mN[currentDate.getMonth()]+" "+currentDate.getFullYear();

  const DAY_MAP={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
  const classDowSet=new Set((cls.days||[]).map(d=>DAY_MAP[d]));
  const getNextClassDate=(fromDate)=>{
    const d=new Date(fromDate+"T12:00:00");
    d.setDate(d.getDate()+1);
    for(let i=0;i<14;i++){
      if(classDowSet.size===0||classDowSet.has(d.getDay())){
        return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
      }
      d.setDate(d.getDate()+1);
    }
    return null;
  };

  const nextAuto=getNextClassDate(cls.date);
  const targetDate=newDate||nextAuto;
  const targetDateObj=targetDate?new Date(targetDate+"T12:00:00"):null;
  const targetLabel=targetDateObj?targetDateObj.getDate()+" de "+mN[targetDateObj.getMonth()]+" "+targetDateObj.getFullYear():null;

  const clsStudents=(cls.students||[]).map(id=>students.find(s=>s.id===id)).filter(Boolean);

  const handleNotify=()=>{
    // Mark as notified — in a real app this would send messages
    setNotified(true);
  };

  const handleConfirm=()=>{
    if(!targetDate) return;
    const oldDate=cls.date;
    const updatedLog=(cls.attendanceLog||[]).map(e=>
      e.date===oldDate?{...e,ausente_reprog:[],rescheduled_to:targetDate}:e
    );
    if(cls.cancelled){
      // Move the cancelled class to the new date (don't keep it in old date)
      const updatedClass={...cls, date:targetDate, time:newTime, cancelled:false, rescheduled:true, attendanceLog:updatedLog};
      onSave(updatedClass, false, null);
    } else {
      // ausente_reprog: move the class to new date
      onSave({...cls, date:targetDate, time:newTime, rescheduled:true, attendanceLog:updatedLog});
    }
    // Update student combo dates
    if(onUpdateStudent){
      clsStudents.forEach(s=>{
        const updatedCombos=s.combos.map(c=>{
          if(!c.dates) return c;
          const idx=c.dates.indexOf(oldDate);
          if(idx===-1) return c;
          const newDates=[...c.dates];
          newDates[idx]=targetDate;
          newDates.sort();
          return {...c,dates:newDates};
        });
        if(JSON.stringify(updatedCombos)!==JSON.stringify(s.combos)){
          onUpdateStudent({...s,combos:updatedCombos});
        }
      });
    }
  };

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:500,display:"flex",alignItems:"flex-end"}}>
      <div style={{background:C.white,borderRadius:"24px 24px 0 0",padding:"24px 20px",paddingBottom:"calc(140px + env(safe-area-inset-bottom, 34px))",width:"100%",maxHeight:"90vh",overflowY:"auto",boxSizing:"border-box"}}>
        <div style={{fontWeight:900,fontSize:20,color:C.text,marginBottom:4}}>Reprogramar clase</div>
        <div style={{fontSize:13,color:C.mutedDark,marginBottom:20}}>{cls.title} · actualmente {currentLabel} {cls.time}</div>

        {/* Date + Time row */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Nueva fecha</label>
            <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} style={{width:"100%",padding:"13px 12px",borderRadius:12,border:"none",fontSize:13,boxSizing:"border-box",background:C.blueL,color:C.text,outline:"none",cursor:"pointer"}}/>
          </div>
          <div>
            <label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Nueva hora</label>
            <input type="time" value={newTime} onChange={e=>setNewTime(e.target.value)} style={{width:"100%",padding:"13px 12px",borderRadius:12,border:"none",fontSize:13,boxSizing:"border-box",background:C.blueL,color:C.text,outline:"none",cursor:"pointer"}}/>
          </div>
        </div>

        {/* Info box */}
        <div style={{background:"#FFF8E1",borderRadius:12,padding:"12px 14px",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{fontSize:16,flexShrink:0}}>💡</span>
          <div style={{fontSize:12,color:"#E65100",lineHeight:1.5}}>
            {targetLabel
              ?<>La clase se moverá al <b>{targetLabel}</b> a las <b>{newTime}</b>. Las fechas del combo en Cobros se actualizarán.</>
              :"Elegí una nueva fecha o se usará la siguiente clase programada."
            }
          </div>
        </div>

        {/* Notify students */}
        <div style={{background:notified?C.greenL:C.blueL,borderRadius:12,padding:"12px 14px",marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:700,color:notified?C.green:C.text,marginBottom:8}}>
            {notified?"✓ Alumnos notificados":"Informar a los alumnos"}
          </div>
          {!notified&&(
            <>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                {clsStudents.map(st=>(
                  <div key={st.id} style={{display:"flex",alignItems:"center",gap:5,background:C.white,borderRadius:20,padding:"4px 10px 4px 6px",fontSize:12,color:C.blue2,fontWeight:600}}>
                    <div style={{width:18,height:18,borderRadius:"50%",background:C.blue2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:C.white,fontWeight:700}}>{st.avatar[0]}</div>
                    {st.name.split(" ")[0]}
                  </div>
                ))}
              </div>
              <div style={{fontSize:11,color:C.mutedDark,marginBottom:10,fontStyle:"italic"}}>
                {targetLabel?`"⚠️ Clase reprogramada al ${targetLabel} a las ${newTime}"`:'"⚠️ Tu clase fue reprogramada"'}
              </div>
              <button onClick={handleNotify} style={{width:"100%",padding:"10px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#FF8F00,#FFA726)",color:"#fff",fontSize:13,cursor:"pointer",fontWeight:800}}>
                📲 Enviar alerta a alumnos
              </button>
            </>
          )}
          {notified&&(
            <div style={{fontSize:12,color:C.green}}>Se envió un mensaje y alerta a {clsStudents.length} alumno{clsStudents.length!==1?"s":""}.</div>
          )}
        </div>

        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:"14px",borderRadius:14,border:"1.5px solid "+C.border,background:C.white,cursor:"pointer",fontSize:14,color:C.mutedDark,fontWeight:700}}>Cancelar</button>
          <button onClick={handleConfirm} style={{flex:2,padding:"14px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,cursor:"pointer",fontSize:14,fontWeight:800}}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}

function AttModal({ att, students, onAttendance, onClose }) {
  const [attStatus,setAttStatus]=useState(()=>{
    const init={};
    // Restore previous attendance state if it exists
    const existingLog=(att.attendanceLog||[]).find(e=>e.date===att.date);
    att.students.forEach(sid=>{
      if(existingLog){
        if((existingLog.ausente_dada||[]).includes(sid)) init[sid]="ausente_dada";
        else if((existingLog.ausente_reprog||[]).includes(sid)) init[sid]="ausente_reprog";
        else if((existingLog.present||[]).includes(sid)) init[sid]="presente";
        else init[sid]="presente";
      } else {
        init[sid]="presente";
      }
    });
    return init;
  });

  const handleSave=()=>{
    const presentStudents=att.students.filter(sid=>attStatus[sid]==="presente");
    const ausente_dada=att.students.filter(sid=>attStatus[sid]==="ausente_dada");
    const ausente_reprog=att.students.filter(sid=>attStatus[sid]==="ausente_reprog");
    onAttendance({...att, students:presentStudents, ausente_dada, ausente_reprog});
    onClose();
  };

  const presentCount=Object.values(attStatus).filter(v=>v==="presente").length;
  const ausentCount=Object.values(attStatus).filter(v=>v!=="presente").length;

  const STATUS_CYCLE=["presente","ausente_reprog","ausente_dada"];
  const STATUS_LABEL={
    "presente":     {label:"✓ Presente",    bg:"#43A047",color:"#fff"},
    "ausente_reprog":{label:"↩ Ausente — No Dada", bg:"#3949AB",color:"#fff"},
    "ausente_dada": {label:"✗ Ausente — Dada",  bg:"#E65100",color:"#fff"},
  };
  const cycleStatus=(sid)=>setAttStatus(p=>{
    const cur=p[sid]||"presente";
    const next=STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur)+1)%STATUS_CYCLE.length];
    return {...p,[sid]:next};
  });

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:500,display:"flex",alignItems:"flex-end"}}>
      <div style={{background:C.white,borderRadius:"20px 20px 0 0",width:"100%",boxSizing:"border-box",maxHeight:"85%",display:"flex",flexDirection:"column"}}>
        {/* Header */}
        <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",borderRadius:"20px 20px 0 0",padding:"16px 20px"}}>
          <div style={{fontWeight:800,fontSize:16,color:C.white}}>{att.title}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{att.date}</div>
          <div style={{display:"flex",gap:12,marginTop:10}}>
            <span style={{fontSize:12,background:"rgba(255,255,255,0.2)",borderRadius:20,padding:"4px 12px",color:C.white,fontWeight:600}}>✓ {presentCount} presentes</span>
            <span style={{fontSize:12,background:"rgba(255,255,255,0.2)",borderRadius:20,padding:"4px 12px",color:C.white,fontWeight:600}}>✗ {ausentCount} ausentes</span>
          </div>
        </div>
        {/* Student list */}
        <div style={{flex:1,overflowY:"auto",padding:"12px 16px"}}>
          {att.students.map(sid=>{
            const st=students.find(s=>s.id===sid);
            if(!st) return null;
            const cur=attStatus[sid]||"presente";
            return (
              <div key={sid} style={{padding:"10px 0",borderBottom:"1px solid "+C.border}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:0}}>
                  {st.photo
                    ?<img src={st.photo} style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>
                    :<div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:C.white,flexShrink:0}}>{st.avatar}</div>
                  }
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14,color:C.text}}>{st.name}</div>
                  </div>
                  <button onClick={()=>cycleStatus(sid)} style={{padding:"8px 16px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,background:STATUS_LABEL[cur].bg,color:STATUS_LABEL[cur].color,minWidth:160,textAlign:"center"}}>
                    {STATUS_LABEL[cur].label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {/* Footer */}
        <div style={{padding:"12px 16px",paddingBottom:"calc(28px + env(safe-area-inset-bottom, 34px))",borderTop:"1px solid "+C.border,display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:"12px",borderRadius:12,border:"1.5px solid "+C.border,background:C.white,cursor:"pointer",fontSize:14,color:C.mutedDark,fontWeight:700}}>Cancelar</button>
          <button onClick={handleSave} style={{flex:2,padding:"12px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,cursor:"pointer",fontSize:14,fontWeight:800}}>Guardar asistencia</button>
        </div>
      </div>
    </div>
  );
}

function Agenda({ students, classes, rawClasses, onSaveClass, onAttendance, onAddStudent, courts=[], packages=[], onUpdateStudent, onDeleteClass, pendingReprog, onClearPendingReprog, onAddPackage, onRefresh }) {
  const [selDay,setSelDay]=useState(TODAY_DATE);
  const [viewYear,setViewYear]=useState(new Date().getFullYear());
  const [viewMonth,setViewMonth]=useState(new Date().getMonth());
  const [viewMode,setViewMode]=useState("month");
  const [weekOffset,setWeekOffset]=useState(0);
  const [showNew,setShowNew]=useState(false);
  const [att,setAtt]=useState(null);
  const [editCls,setEditCls]=useState(null);
  const [editScopeData,setEditScopeData]=useState(null);
  const [gridNewTime,setGridNewTime]=useState(null);
  const [highlightCls,setHighlightCls]=useState(null);
  const [confirmDelete,setConfirmDelete]=useState(null); // class to delete
  const mN=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const wD=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  const wDShort=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

  const handleCalNav=(a)=>{
    if(a==="prev"){if(viewMonth===0){setViewMonth(11);setViewYear(y=>y-1);}else setViewMonth(m=>m-1);}
    else if(a==="next"){if(viewMonth===11){setViewMonth(0);setViewYear(y=>y+1);}else setViewMonth(m=>m+1);}
    else setSelDay(a);
  };

  // Week view helpers
  const getWeekDays=(offset)=>{
    const base=new Date(TODAY_DATE+"T12:00:00");
    const dow=base.getDay();
    const monday=new Date(base);
    monday.setDate(base.getDate()-(dow===0?6:dow-1)+(offset*7));
    return Array.from({length:7},(_,i)=>{
      const d=new Date(monday);
      d.setDate(monday.getDate()+i);
      return d;
    });
  };
  const weekDays=getWeekDays(weekOffset);
  const fmt=(d)=>{const mm=String(d.getMonth()+1).padStart(2,"0");const dd=String(d.getDate()).padStart(2,"0");return d.getFullYear()+"-"+mm+"-"+dd;};
  const weekLabel=()=>{
    const s=weekDays[0]; const e=weekDays[6];
    if(s.getMonth()===e.getMonth()) return s.getDate()+" – "+e.getDate()+" de "+mN[s.getMonth()]+" "+s.getFullYear();
    return s.getDate()+" "+mN[s.getMonth()].slice(0,3)+" – "+e.getDate()+" "+mN[e.getMonth()].slice(0,3)+" "+e.getFullYear();
  };

  const dayC=classes.filter(c=>c.date===selDay);
  const sd=new Date(selDay+"T12:00:00");
  const selLabel=wD[sd.getDay()]+" "+sd.getDate()+" de "+mN[sd.getMonth()];

  const [reprog,setReprog]=useState(pendingReprog||null);
  const [showCancel,setShowCancel]=useState(null);
  // Auto-open reprog modal if navigated from dashboard
  useEffect(()=>{if(pendingReprog){setShowCancel(pendingReprog);onClearPendingReprog&&onClearPendingReprog();}},[pendingReprog]); // class to reschedule

  const ClassCard=({c})=>{
    const log=(c.attendanceLog||[]).find(e=>e.date===c.date);
    const dadaCount=(log?.ausente_dada||[]).length;
    const reprogCount=(log?.ausente_reprog||[]).length;
    // Determine cancel/reprog/paused state
    const isCancelled=c.cancelled&&c.cancelType==="cancelled";
    const isReprogWithDate=c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo;
    const isReprogNoDate=c.cancelled&&c.cancelType==="cancelled_reprog"&&!c.rescheduledTo;
    const isPaused=c.paused||c.cancelType==="paused";
    // Card background based on state
    const cardBg=isPaused?"#FFF3E0":isCancelled?"#FFF0F0":isReprogWithDate?"#E8F5E9":isReprogNoDate?"#E3F2FD":C.white;
    const cardBorder=isPaused?"1.5px solid #FFB74D":isCancelled?"1.5px solid #FFCDD2":isReprogWithDate?"1.5px solid #A5D6A7":isReprogNoDate?"1.5px solid #90CAF9":"1px solid rgba(44,94,247,0.06)";
    // Status label
    const statusLabel=isPaused?"(Pausada)":isCancelled?"(Cancelada)":isReprogWithDate?"(Reprogramada)":isReprogNoDate?"(A Reprogramar)":c.rescheduled?"(Reprogramada)":"";
    const statusColor=isPaused?"#E65100":isCancelled?"#C62828":isReprogWithDate?"#2E7D32":isReprogNoDate?"#1565C0":"#2E7D32";
    return (
    <WhiteCard style={{marginBottom:12,background:cardBg,border:cardBorder}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <div><div style={{fontWeight:800,fontSize:15,color:C.text}}>{c.title}{statusLabel&&<span style={{fontSize:12,fontWeight:700,color:statusColor,marginLeft:6}}>{statusLabel}</span>}</div><div style={{fontSize:12,color:C.mutedDark}}>{c.time+" · "+c.court}</div>
          {isReprogWithDate&&<div style={{fontSize:11,color:"#2E7D32",marginTop:2}}>📅 Reprogramada al {fmtDate(c.rescheduledTo)}</div>}
        </div>
        <span style={{background:C.blueL,color:C.blue2,fontSize:11,padding:"4px 10px",borderRadius:20,fontWeight:600,height:"fit-content"}}>{c.days.join(" · ")}</span>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:(dadaCount||reprogCount)?6:12}}>
        {c.students.map(sid=>{const st=students.find(s=>s.id===sid);return st?(<div key={sid} style={{display:"flex",alignItems:"center",gap:6,background:C.blueL,borderRadius:20,padding:"4px 10px 4px 6px",fontSize:12,color:C.blue2,fontWeight:600}}><div style={{width:20,height:20,borderRadius:"50%",background:C.blue2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:C.white,fontWeight:700}}>{st.avatar[0]}</div>{st.name.split(" ")[0]}</div>):null;})}
      </div>
      {(dadaCount>0||reprogCount>0)&&(
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          {dadaCount>0&&<span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"#FFF3E0",color:"#E65100",fontWeight:700}}>✗ {dadaCount} Ausente-Dada</span>}
          {reprogCount>0&&<span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:"#FFF8E1",color:"#F57F17",fontWeight:700}}>↩ {reprogCount} A Reprogramar</span>}
        </div>
      )}
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <button onClick={()=>setEditCls(c)} style={{flex:1,padding:"9px",borderRadius:10,border:"none",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>Modificar</button>
        <button onClick={()=>setAtt({...c,attendanceLog:c.attendanceLog||[]})} style={{flex:1,padding:"9px",borderRadius:10,border:"none",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>Asistencia</button>
        <button onClick={()=>{setConfirmDelete(c);}} style={{width:38,padding:"9px",borderRadius:10,border:"none",background:"#FFEBEE",color:"#C62828",fontSize:14,cursor:"pointer",flexShrink:0}}>🗑</button>
      </div>
      {c.date>=WEEK_AGO&&<div style={{display:"flex",gap:8,marginBottom:8}}>
        <button onClick={()=>{
          if(isPaused){onSaveClass({...c,cancelled:false,cancelType:null,paused:false,_resuming:true,applyToAll:false},true);}
          else{onSaveClass({...c,cancelled:false,cancelType:"paused",paused:true,applyToAll:false},true);}
        }} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:isPaused?"linear-gradient(135deg,#2E7D32,#43A047)":"linear-gradient(135deg,#E65100,#FF8F00)",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>{isPaused?"▶ Reanudar clase":"⏸ Pausar clase"}</button>
      </div>}
      {c.date>=WEEK_AGO&&(()=>{
        const isReprogNoDate=c.cancelled&&c.cancelType==="cancelled_reprog"&&!c.rescheduledTo;
        const isCancelledPure=c.cancelled&&c.cancelType==="cancelled";
        const isReprogDone=c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo;
        if(isReprogNoDate) return <button onClick={()=>setShowCancel(c)} style={{width:"100%",padding:"10px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1565C0,#42A5F5)",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>📅 Asignar fecha de reprogramación</button>;
        if(isCancelledPure) return <button onClick={()=>onSaveClass({...c,cancelled:false,cancelType:null,rescheduledTo:null,applyToAll:false},true)} style={{width:"100%",padding:"10px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1565C0,#42A5F5)",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>↩ Reactivar clase</button>;
        if(isReprogDone) return <button onClick={()=>onSaveClass({...c,cancelled:false,cancelType:null,rescheduledTo:null,applyToAll:false},true)} style={{width:"100%",padding:"10px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#1565C0,#42A5F5)",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>↩ Volver a fecha original</button>;
        return <button onClick={()=>setShowCancel(c)} style={{width:"100%",padding:"10px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#E65100,#FF8F00)",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>📅 Reprogramar / Cancelar</button>;
      })()}
    </WhiteCard>
    );
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:C.bg,position:"relative",overflow:"hidden"}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"16px 16px 16px",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontSize:18,fontWeight:800,color:C.white}}>Agenda</div>
          <button onClick={()=>setShowNew(true)} style={{padding:"10px 16px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#52C048,#65CE5A)",color:C.white,fontSize:13,cursor:"pointer",fontWeight:700}}>+ Crear Clase</button>
        </div>
        <div style={{display:"flex",gap:8}}>
          {[["month","Mensual"],["week","Semanal"]].map(([k,l])=>(
            <button key={k} onClick={()=>setViewMode(k)} style={{padding:"6px 18px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,background:viewMode===k?C.white:C.whiteA,color:viewMode===k?C.blue2:C.white}}>{l}</button>
          ))}
        </div>
      </div>

      {viewMode==="month"&&(
        <div style={{flex:1,overflowY:"auto",background:C.bg}}>
          {/* Calendar */}
          <div style={{background:C.white,margin:"12px 12px 0",borderRadius:20,padding:"16px",boxShadow:"0 2px 12px rgba(44,94,247,0.08)"}}>
            {/* Month nav */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <button onClick={()=>handleCalNav("prev")} style={{background:C.bg,border:"1px solid "+C.border,borderRadius:10,width:36,height:36,cursor:"pointer",color:C.blue2,fontWeight:800,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{"<"}</button>
              <div style={{fontSize:16,fontWeight:800,color:C.text}}>{mN[viewMonth]+" "+viewYear}</div>
              <button onClick={()=>handleCalNav("next")} style={{background:C.bg,border:"1px solid "+C.border,borderRadius:10,width:36,height:36,cursor:"pointer",color:C.blue2,fontWeight:800,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{">"}</button>
            </div>
            {/* Day headers */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:8}}>
              {["Lu","Ma","Mi","Ju","Vi","Sá","Do"].map(d=>(
                <div key={d} style={{textAlign:"center",fontSize:11,fontWeight:700,color:C.mutedDark,padding:"4px 0"}}>{d}</div>
              ))}
            </div>
            {/* Calendar cells */}
            {(()=>{
              const firstDay=new Date(viewYear,viewMonth,1).getDay();
              const daysInMonth=new Date(viewYear,viewMonth+1,0).getDate();
              const startOffset=firstDay===0?6:firstDay-1;
              const cells=[];
              for(let i=0;i<startOffset;i++) cells.push(null);
              for(let d=1;d<=daysInMonth;d++) cells.push(d);
              while(cells.length%7!==0) cells.push(null);
              return (
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
                  {cells.map((d,i)=>{
                    if(!d) return <div key={"e"+i}/>;
                    const mm=String(viewMonth+1).padStart(2,"0");
                    const dd=String(d).padStart(2,"0");
                    const ds=viewYear+"-"+mm+"-"+dd;
                    const isA=selDay===ds; const isToday=ds===TODAY_DATE;
                    const allDayCls=classes.filter(c=>c.date===ds);
                    const normalCls=allDayCls.filter(c=>!c.cancelled);
                    const cancelledCls=allDayCls.filter(c=>c.cancelled&&c.cancelType==="cancelled");
                    const reprogCls=allDayCls.filter(c=>c.cancelled&&c.cancelType==="cancelled_reprog");
                    const count=normalCls.length;
                    const totalCount=allDayCls.length;
                    return (
                      <button key={i} onClick={()=>handleCalNav(ds)} style={{background:isA?"linear-gradient(135deg,"+C.blue2+","+C.blue3+")":isToday?C.blueL:"transparent",border:isToday&&!isA?"2px solid "+C.blue2:"2px solid transparent",borderRadius:12,padding:"6px 2px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,minHeight:48}}>
                        <span style={{fontSize:14,fontWeight:isA||isToday||totalCount>0?800:400,color:isA?C.white:isToday?C.blue2:C.text,lineHeight:1}}>{d}</span>
                        {totalCount>0&&(
                          <div style={{display:"flex",gap:2,justifyContent:"center",flexWrap:"wrap"}}>
                            {totalCount<=3?allDayCls.map((c,ci)=>{
                              const dotColor=isA?"rgba(255,255,255,0.8)":c.cancelled&&c.cancelType==="cancelled"?"#E53935":c.cancelled&&c.cancelType==="cancelled_reprog"?"#2E7D32":C.blue2;
                              return <div key={ci} style={{width:5,height:5,borderRadius:"50%",background:dotColor}}/>;
                            }):(
                              <span style={{fontSize:9,fontWeight:700,color:isA?C.white:C.blue2}}>{totalCount}</span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Selected day classes - compact */}
          <div style={{padding:"12px 12px 80px"}}>
            <div style={{fontSize:14,fontWeight:800,color:C.blue2,marginBottom:10}}>{selLabel+" | "+dayC.length+" clase"+(dayC.length!==1?"s":"")}</div>
            {dayC.length===0?(
              <div style={{textAlign:"center",padding:"24px 0",color:C.mutedDark}}>
                <div style={{fontSize:28,marginBottom:8}}>📅</div>
                <div style={{fontSize:14,fontWeight:600}}>Sin clases este día</div>
                <div style={{fontSize:12,marginTop:4}}>Tocá + para agregar</div>
              </div>
            ):dayC.map(c=>{
              const isCancelled=c.cancelled&&c.cancelType==="cancelled";
              const isReprogWithDate=c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo;
              const isReprogNoDate=c.cancelled&&c.cancelType==="cancelled_reprog"&&!c.rescheduledTo;
              const isPaused=c.paused||c.cancelType==="paused";
              const cardBg=isPaused?"#FFF3E0":isCancelled?"#FFF0F0":isReprogWithDate?"#E8F5E9":isReprogNoDate?"#E3F2FD":isNextComboPending(c,students)?"#F5F5F5":C.white;
              return (
              <div key={c._virtualId||c.id} onClick={()=>setHighlightCls((c._virtualId||c.id)===highlightCls?null:(c._virtualId||c.id))} style={{background:cardBg,borderRadius:16,padding:"12px 14px",marginBottom:10,boxShadow:highlightCls===(c._virtualId||c.id)?"0 4px 16px rgba(44,94,247,0.18)":"0 2px 10px rgba(44,94,247,0.07)",border:"1.5px solid "+(highlightCls===(c._virtualId||c.id)?C.blue2:isPaused?"#FFB74D":isCancelled?"#FFCDD2":isReprogWithDate?"#A5D6A7":isReprogNoDate?"#90CAF9":isNextComboPending(c,students)?"#BDBDBD":C.border),cursor:"pointer",opacity:isNextComboPending(c,students)?0.75:1,transition:"box-shadow 0.15s,border 0.15s"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:4}}>
                      <div style={{fontWeight:800,fontSize:15,color:isPaused?"#E65100":isCancelled?"#C62828":isReprogNoDate?"#1565C0":isReprogWithDate?"#2E7D32":isNextComboPending(c,students)?"#9E9E9E":C.text}}>{c.title}{isPaused?" (Pausada)":isCancelled?" (Cancelada)":isReprogWithDate?" (Reprogramada)":isReprogNoDate?" (A Reprogramar)":""}</div>
                      {isNextComboPending(c,students)&&<span style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#EEEEEE",color:"#757575",fontWeight:700}}>Sin pagar</span>}
                      {(()=>{const log=(c.attendanceLog||[]).find(e=>e.date===c.date);if(!log)return null;const dC=(log.ausente_dada||[]).length;const nC=(log.ausente_reprog||[]).length;if(!dC&&!nC)return null;return(<>{dC>0&&<span style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#FFF3E0",color:"#E65100",fontWeight:700}}>✗ Ausente-Dada</span>}{nC>0&&<span style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#FFF8E1",color:"#F57F17",fontWeight:700}}>↩ A Reprogramar</span>}</>);})()}
                    </div>
                    {isReprogWithDate&&c.rescheduledTo&&<div style={{fontSize:11,color:"#2E7D32",marginBottom:4}}>📅 Reprogramada al {fmtDate(c.rescheduledTo)}</div>}
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      {(c.days||[]).map(d=><span key={d} style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:C.blueL,color:C.blue2,fontWeight:600}}>{d}</span>)}
                      <span style={{fontSize:12,color:C.mutedDark}}>{c.time+(c.timeEnd?" - "+c.timeEnd:"")} · {c.court}</span>
                    </div>
                  </div>
                  <div style={{flexShrink:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:4,background:highlightCls===(c._virtualId||c.id)?C.blue2:"#F0F2FF",borderRadius:20,padding:"5px 10px"}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={highlightCls===(c._virtualId||c.id)?"#fff":C.blue2}><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                      <span style={{fontSize:10,fontWeight:700,color:highlightCls===(c._virtualId||c.id)?"#fff":C.blue2}}>{highlightCls===(c._virtualId||c.id)?"Cerrar":"Opciones"}</span>
                    </div>
                  </div>
                </div>
                <div style={{display:"flex",gap:4,marginTop:8,flexWrap:"wrap"}}>
                  {(c.students||[]).map(sid=>{const st=students.find(s=>s.id===sid);return st?(
                    <div key={sid} style={{display:"flex",alignItems:"center",gap:4,background:C.blueL,borderRadius:20,padding:"3px 8px 3px 4px"}}>
                      <div style={{width:18,height:18,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:800,color:C.white}}>{st.avatar[0]}</div>
                      <span style={{fontSize:11,color:C.blue2,fontWeight:600}}>{st.name.split(" ")[0]}</span>
                    </div>
                  ):null;})}
                </div>
              </div>
            );})}
          </div>

          {/* Class action modal */}
          {highlightCls&&(()=>{
            const c=classes.find(x=>(x._virtualId||x.id)===highlightCls);
            if(!c) return null;
            return (
              <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.45)",zIndex:99,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px"}} onClick={()=>setHighlightCls(null)}>
                <div style={{background:C.white,borderRadius:24,padding:"20px 20px 24px",width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}} onClick={e=>e.stopPropagation()}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div>
                      <div style={{fontWeight:900,fontSize:20,color:C.text}}>{c.title}</div>
                      <div style={{fontSize:13,color:C.mutedDark,marginTop:2}}>{c.time+(c.timeEnd?" – "+c.timeEnd:"")} · {c.court}</div>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>{setConfirmDelete(c);setHighlightCls(null);}} style={{width:36,height:36,borderRadius:"50%",background:"#FFEBEE",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                      </button>
                      <button onClick={()=>setHighlightCls(null)} style={{width:36,height:36,borderRadius:"50%",background:C.bg,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.mutedDark} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:18}}>
                    {(c.students||[]).map(sid=>{const st=students.find(s=>s.id===sid);return st?(
                      <div key={sid} style={{display:"flex",alignItems:"center",gap:5,background:C.blueL,borderRadius:20,padding:"4px 10px 4px 4px"}}>
                        <div style={{width:22,height:22,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:C.white}}>{st.avatar[0]}</div>
                        <span style={{fontSize:12,color:C.blue2,fontWeight:700}}>{st.name.split(" ")[0]}</span>
                      </div>
                    ):null;})}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {[
                      {label:"Editar",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,action:()=>{setEditCls(c);setHighlightCls(null);},disabled:false,color:"linear-gradient(135deg,#2E7D32,#43A047,#65CE5A)"},
                      {label:"Asistencia",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>,action:()=>{setAtt({...c,attendanceLog:c.attendanceLog||[]});setHighlightCls(null);},disabled:isNextComboPending(c,students),color:"linear-gradient(135deg,#2E7D32,#43A047,#65CE5A)"},
                      {label:c.paused||c.cancelType==="paused"?"▶ Reanudar":"⏸ Pausar",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{c.paused||c.cancelType==="paused"?<polygon points="5 3 19 12 5 21 5 3"/>:<g><line x1="10" y1="4" x2="10" y2="20"/><line x1="14" y1="4" x2="14" y2="20"/></g>}</svg>,action:()=>{if(c.paused||c.cancelType==="paused"){onSaveClass({...c,cancelled:false,cancelType:null,paused:false,_resuming:true,applyToAll:false},true);}else{onSaveClass({...c,cancelled:false,cancelType:"paused",paused:true,applyToAll:false},true);}setHighlightCls(null);},disabled:c.date<WEEK_AGO,color:c.date<WEEK_AGO?"#ccc":c.paused||c.cancelType==="paused"?"linear-gradient(135deg,#2E7D32,#43A047)":"linear-gradient(135deg,#E65100,#FF8F00)"},
                      {label:c.cancelled&&c.cancelType==="cancelled_reprog"&&!c.rescheduledTo?"Asignar fecha":c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo?"Volver a fecha original":c.cancelled?"Reactivar":"Reprogramar / Cancelar",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,action:()=>{if(c.cancelled&&c.cancelType==="cancelled_reprog"&&!c.rescheduledTo){setShowCancel(c);}else if(c.cancelled){onSaveClass({...c,cancelled:false,cancelType:null,rescheduledTo:null,applyToAll:false},true);}else{setShowCancel(c);}setHighlightCls(null);},disabled:c.date<WEEK_AGO,color:c.date<WEEK_AGO?"#ccc":c.cancelled&&!c.rescheduledTo?"linear-gradient(135deg,#1565C0,#42A5F5)":c.cancelled?"linear-gradient(135deg,#1565C0,#42A5F5)":"linear-gradient(135deg,#E65100,#FF8F00)",span:true},
                    ].map(btn=>(
                      <button key={btn.label} onClick={btn.disabled?null:btn.action} disabled={btn.disabled} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"13px",borderRadius:14,border:"none",background:btn.disabled?"#E0E0E0":(btn.color||"linear-gradient(135deg,#2E7D32,#43A047,#65CE5A)"),color:btn.disabled?"#9E9E9E":"#fff",fontSize:13,cursor:btn.disabled?"not-allowed":"pointer",fontWeight:700,boxShadow:btn.disabled?"none":"0 4px 12px rgba(0,0,0,0.15)",gridColumn:btn.span?"1 / -1":"auto"}}>
                        {btn.icon}{btn.label}{btn.disabled?" 🔒":""}
                      </button>
                    ))}
                  </div>
                  {/* Renovar Combo button for gray classes */}
                  {(()=>{
                    // Use selDay (the currently selected date) to check if this is a gray class
                    const clsForCheck={...c,date:selDay};
                    const needsRenewal=isNextComboPending(clsForCheck,students);
                    if(!needsRenewal) return null;
                    const handleRenovar=()=>{
                      const DAY_MAP2={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
                      onUpdateStudent&&(c.students||[]).forEach(sid=>{
                        const st=students.find(s=>s.id===sid);
                        if(!st) return;
                        const combos=st.combos||[];
                        const classCombos=combos.filter(x=>x.total>0&&x.packType!=="mensual"&&x.packType!=="individual");
                        const lastCombo=classCombos[classCombos.length-1];
                        if(!lastCombo) return;
                        // Use real occurrences from the class
                        const parentCls=(rawClasses||classes).find(cl=>cl.id===(c._seriesId||c.id));
                        const realOcc=(parentCls?.occurrences||[]).filter(d=>d>=selDay);
                        const newDates=realOcc.slice(0,lastCombo.total);
                        if(newDates.length===0){
                          const dowSet=new Set((c.days||[]).map(d=>DAY_MAP2[d]));
                          let cur=new Date(selDay+"T12:00:00");
                          while(newDates.length<lastCombo.total){
                            if(dowSet.size===0||dowSet.has(cur.getDay())){
                              newDates.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
                            }
                            cur.setDate(cur.getDate()+1);
                          }
                        }
                        const newCombo={id:combos.length+1,total:lastCombo.total,packType:lastCombo.packType||"combo",used:0,paid:false,paidCount:0,date:newDates[0]||selDay,amount:lastCombo.amount,dates:newDates,payments:[]};
                        onUpdateStudent({...st,combos:[...combos,newCombo]});
                      });
                      setHighlightCls(null);
                    };
                    return (
                      <button onClick={handleRenovar} style={{width:"100%",marginTop:8,padding:"13px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#1565C0,#1976D2)",color:"#fff",fontSize:14,cursor:"pointer",fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                        🔄 Renovar Combo desde esta fecha
                      </button>
                    );
                  })()}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {viewMode==="week"&&(()=>{
        const HOURS=Array.from({length:17},(_,i)=>i+6); // 6-22
        const HOUR_HEIGHT=90;
        const fmtHourLabel=(h)=>h<12?h+" AM":(h===12?"12 PM":(h-12)+" PM");
        const timeToMins=(t)=>{if(!t)return null;const[h,m]=(t).split(":").map(Number);return h*60+(m||0);};
        return (
          <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:C.bg}}>
            {/* Week nav */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px 8px",background:C.white,flexShrink:0,boxShadow:"0 1px 0 "+C.border}}>
              <button onClick={()=>setWeekOffset(w=>w-1)} style={{background:C.bg,border:"1px solid "+C.border,borderRadius:10,width:36,height:36,cursor:"pointer",color:C.blue2,fontWeight:800,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{"<"}</button>
              <div style={{fontSize:15,fontWeight:800,color:C.text}}>{weekLabel()}</div>
              <button onClick={()=>setWeekOffset(w=>w+1)} style={{background:C.bg,border:"1px solid "+C.border,borderRadius:10,width:36,height:36,cursor:"pointer",color:C.blue2,fontWeight:800,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{">"}</button>
            </div>
            {/* Day selector row */}
            <div style={{display:"flex",padding:"10px 16px",gap:4,background:C.white,flexShrink:0,borderBottom:"1px solid "+C.border}}>
              {weekDays.map((day,i)=>{
                const ds=fmt(day); const isToday=ds===TODAY_DATE; const isSel=ds===selDay;
                return (
                  <div key={i} onClick={()=>setSelDay(ds)} style={{flex:1,textAlign:"center",cursor:"pointer"}}>
                    <div style={{borderRadius:12,padding:"8px 2px",background:isSel?"linear-gradient(135deg,"+C.blue2+","+C.blue3+")":isToday?C.blueL:"transparent"}}>
                      <div style={{fontSize:18,fontWeight:900,color:isSel?C.white:isToday?C.blue2:C.text,lineHeight:1}}>{day.getDate()}</div>
                      <div style={{fontSize:9,fontWeight:700,color:isSel?"rgba(255,255,255,0.8)":C.mutedDark,marginTop:2}}>{wDShort[day.getDay()].toUpperCase()}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Timeline - absolute positioned */}
            <div style={{overflowY:"auto",flex:1,paddingBottom:"calc(120px + env(safe-area-inset-bottom, 34px))"}}>
              <div style={{position:"relative",minHeight:HOURS.length*HOUR_HEIGHT}}>
                {/* Hour grid lines + buttons */}
                {HOURS.map((hourVal,hi)=>(
                  <div key={hourVal} style={{position:"absolute",top:hi*HOUR_HEIGHT,left:0,right:0,height:HOUR_HEIGHT,borderBottom:"1px solid "+C.border,display:"flex",alignItems:"flex-start",pointerEvents:"none"}}>
                    <div style={{width:56,flexShrink:0,padding:"6px 6px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:3,pointerEvents:"all"}}>
                      <span style={{fontSize:11,fontWeight:600,color:C.mutedDark}}>{fmtHourLabel(hourVal)}</span>
                      <button onClick={()=>{setGridNewTime({date:selDay,time:String(hourVal).padStart(2,"0")+":00",timeEnd:String(hourVal+1).padStart(2,"0")+":00"});setShowNew(true);}}
                        style={{width:24,height:24,borderRadius:7,background:C.blueL,border:"1px solid "+C.border,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.8" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
                {/* Classes - absolutely positioned with collision detection */}
                {(()=>{
                  const dayCls=classes.filter(c=>c.date===selDay).map(c=>({
                    ...c,
                    startMins:timeToMins(c.time)||360,
                    endMins:timeToMins(c.timeEnd)||(timeToMins(c.time)||360)+60,
                    col:0,totalCols:1,
                  }));
                  // Assign columns for overlapping classes
                  dayCls.forEach((c,i)=>{
                    const overlapping=dayCls.filter((o,j)=>j<i&&o.startMins<c.endMins&&o.endMins>c.startMins);
                    const usedCols=new Set(overlapping.map(o=>o.col));
                    let col=0; while(usedCols.has(col)) col++;
                    c.col=col;
                    const allOverlap=dayCls.filter((o,j)=>j!==i&&o.startMins<c.endMins&&o.endMins>c.startMins);
                    c.totalCols=Math.max(allOverlap.length+1,col+1);
                  });
                  // Second pass to normalize totalCols within each overlap group
                  dayCls.forEach(c=>{
                    const group=dayCls.filter(o=>o.startMins<c.endMins&&o.endMins>c.startMins);
                    const maxCols=Math.max(...group.map(o=>o.col))+1;
                    group.forEach(o=>o.totalCols=maxCols);
                  });
                  const LEFT=60; const RIGHT=8;
                  return dayCls.map(c=>{
                    const durMins=Math.max(30,c.endMins-c.startMins);
                    const offsetFromStart=c.startMins-(HOURS[0]*60);
                    const topPx=(offsetFromStart/60)*HOUR_HEIGHT+2;
                    const heightPx=Math.max(36,(durMins/60)*HOUR_HEIGHT-4);
                    const colW=`calc((100% - ${LEFT}px - ${RIGHT}px) / ${c.totalCols} - 4px)`;
                    const colL=`calc(${LEFT}px + (100% - ${LEFT}px - ${RIGHT}px) / ${c.totalCols} * ${c.col} + ${c.col*2}px)`;
                    return (
                      <div key={c._virtualId||c.id} onClick={()=>setHighlightCls((c._virtualId||c.id)===highlightCls?null:(c._virtualId||c.id))}
                        style={{position:"absolute",top:topPx,left:colL,width:colW,height:heightPx,background:c.cancelled&&c.cancelType==="cancelled"?"#FFF0F0":c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo?"#E8F5E9":c.cancelled&&c.cancelType==="cancelled_reprog"?"#E3F2FD":isNextComboPending(c,students)?"#F5F5F5":C.white,borderRadius:12,padding:"6px 10px",border:"1.5px solid "+(highlightCls===(c._virtualId||c.id)?C.blue2:isNextComboPending(c,students)?"#BDBDBD":C.border),cursor:"pointer",boxShadow:"0 2px 8px rgba(44,94,247,0.10)",overflow:"hidden",borderLeft:"4px solid "+(c.cancelled&&c.cancelType==="cancelled"?"#C62828":c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo?"#2E7D32":c.cancelled&&c.cancelType==="cancelled_reprog"?"#1565C0":isNextComboPending(c,students)?"#BDBDBD":C.blue2),zIndex:2,opacity:isNextComboPending(c,students)?0.7:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:4,overflow:"hidden"}}>
                          <div style={{fontSize:13,fontWeight:800,color:c.cancelled&&c.cancelType==="cancelled"?"#C62828":c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo?"#2E7D32":c.cancelled&&c.cancelType==="cancelled_reprog"?"#1565C0":isNextComboPending(c,students)?"#9E9E9E":C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flex:1}}>{c.title}{c.cancelled&&c.cancelType==="cancelled"?" (Cancelada)":c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo?" (Reprogramada)":c.cancelled&&c.cancelType==="cancelled_reprog"?" (A Reprogramar)":""}</div>
                          {isNextComboPending(c,students)&&<span style={{fontSize:9,padding:"2px 5px",borderRadius:8,background:"#EEEEEE",color:"#757575",fontWeight:700,flexShrink:0}}>Sin pagar</span>}
                        </div>
                        <div style={{fontSize:11,color:C.mutedDark,marginTop:1}}>{c.time+(c.timeEnd?" – "+c.timeEnd:"")} · {c.court}</div>
                        {(()=>{const log=(c.attendanceLog||[]).find(e=>e.date===c.date);if(!log)return null;const dC=(log.ausente_dada||[]).length;const nC=(log.ausente_reprog||[]).length;if(!dC&&!nC)return null;return(<div style={{display:"flex",gap:4,marginTop:4}}>{dC>0&&<span style={{fontSize:11,padding:"3px 8px",borderRadius:10,background:"#FFF3E0",color:"#E65100",fontWeight:700}}>✗ Ausente-Dada</span>}{nC>0&&<span style={{fontSize:11,padding:"3px 8px",borderRadius:10,background:"#FFF8E1",color:"#F57F17",fontWeight:700}}>↩ A Reprogramar</span>}</div>);})()}
                        {heightPx>52&&<div style={{display:"flex",gap:3,marginTop:4,flexWrap:"wrap"}}>
                          {(c.students||[]).map(sid=>{const st=students.find(s=>s.id===sid);return st?(
                            <div key={sid} style={{display:"flex",alignItems:"center",gap:3,background:C.blueL,borderRadius:20,padding:"2px 6px 2px 3px"}}>
                              <div style={{width:14,height:14,borderRadius:"50%",background:C.blue2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:800,color:C.white}}>{st.avatar[0]}</div>
                              <span style={{fontSize:10,color:C.blue2,fontWeight:600}}>{st.name.split(" ")[0]}</span>
                            </div>
                          ):null;})}
                        </div>}
                      </div>
                    );
                  });
                })()}
              {/* Class detail modal */}
              {highlightCls&&(()=>{
                const c=classes.find(x=>(x._virtualId||x.id)===highlightCls);
                if(!c) return null;
                return (
                  <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.45)",zIndex:99,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px"}} onClick={()=>setHighlightCls(null)}>
                    <div style={{background:C.white,borderRadius:24,padding:"20px 20px 24px",width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}} onClick={e=>e.stopPropagation()}>
                      {/* Header */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                        <div>
                          <div style={{fontWeight:900,fontSize:20,color:C.text}}>{c.title}</div>
                          <div style={{fontSize:13,color:C.mutedDark,marginTop:2}}>{c.time+(c.timeEnd?" – "+c.timeEnd:"")} · {c.court}</div>
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>{setConfirmDelete(c);setHighlightCls(null);}} style={{width:36,height:36,borderRadius:"50%",background:"#FFEBEE",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                          </button>
                          <button onClick={()=>setHighlightCls(null)} style={{width:36,height:36,borderRadius:"50%",background:C.bg,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.mutedDark} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      </div>
                      {/* Students */}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:18}}>
                        {(c.students||[]).map(sid=>{const st=students.find(s=>s.id===sid);return st?(
                          <div key={sid} style={{display:"flex",alignItems:"center",gap:5,background:C.blueL,borderRadius:20,padding:"4px 10px 4px 4px"}}>
                            <div style={{width:22,height:22,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:C.white}}>{st.avatar[0]}</div>
                            <span style={{fontSize:12,color:C.blue2,fontWeight:700}}>{st.name.split(" ")[0]}</span>
                          </div>
                        ):null;})}
                      </div>
                      {/* Action buttons */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        {[
                          {label:"Editar",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,action:()=>{setEditCls(c);setHighlightCls(null);},color:"linear-gradient(135deg,#2E7D32,#43A047,#65CE5A)"},
                          {label:"Asistencia",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>,action:()=>{setAtt({...c,attendanceLog:c.attendanceLog||[]});setHighlightCls(null);},color:"linear-gradient(135deg,#2E7D32,#43A047,#65CE5A)"},
                          {label:c.paused||c.cancelType==="paused"?"▶ Reanudar":"⏸ Pausar",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{c.paused||c.cancelType==="paused"?<polygon points="5 3 19 12 5 21 5 3"/>:<g><line x1="10" y1="4" x2="10" y2="20"/><line x1="14" y1="4" x2="14" y2="20"/></g>}</svg>,action:()=>{if(c.paused||c.cancelType==="paused"){onSaveClass({...c,cancelled:false,cancelType:null,paused:false,_resuming:true,applyToAll:false},true);}else{onSaveClass({...c,cancelled:false,cancelType:"paused",paused:true,applyToAll:false},true);}setHighlightCls(null);},disabled:c.date<WEEK_AGO,color:c.date<WEEK_AGO?"#ccc":c.paused||c.cancelType==="paused"?"linear-gradient(135deg,#2E7D32,#43A047)":"linear-gradient(135deg,#E65100,#FF8F00)"},
                          {label:c.cancelled&&c.cancelType==="cancelled_reprog"&&!c.rescheduledTo?"Asignar fecha":c.cancelled&&c.cancelType==="cancelled_reprog"&&c.rescheduledTo?"Volver a fecha original":c.cancelled?"Reactivar":"Reprogramar / Cancelar",icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,action:()=>{if(c.cancelled&&c.cancelType==="cancelled_reprog"&&!c.rescheduledTo){setShowCancel(c);}else if(c.cancelled){onSaveClass({...c,cancelled:false,cancelType:null,rescheduledTo:null,applyToAll:false},true);}else{setShowCancel(c);}setHighlightCls(null);},disabled:c.date<WEEK_AGO,color:c.date<WEEK_AGO?"#ccc":c.cancelled&&!c.rescheduledTo?"linear-gradient(135deg,#1565C0,#42A5F5)":c.cancelled?"linear-gradient(135deg,#1565C0,#42A5F5)":"linear-gradient(135deg,#E65100,#FF8F00)",span:true},
                        ].map(btn=>(
                          <button key={btn.label} onClick={btn.action} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"13px",borderRadius:14,border:"none",background:btn.color||"linear-gradient(135deg,#2E7D32,#43A047,#65CE5A)",color:"#fff",fontSize:13,cursor:"pointer",fontWeight:700,boxShadow:"0 4px 12px rgba(0,0,0,0.15)",gridColumn:btn.span?"1 / -1":"auto"}}>
                            {btn.icon}{btn.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            </div>
            {/* Selected day label */}
            <div style={{position:"absolute",bottom:72,left:0,right:0,padding:"6px 16px",pointerEvents:"none"}}>
              <div style={{fontSize:13,fontWeight:800,color:C.blue2}}>{wD[new Date(selDay+"T12:00:00").getDay()]+" "+new Date(selDay+"T12:00:00").getDate()+" de "+mN[new Date(selDay+"T12:00:00").getMonth()]+" | "+classes.filter(c=>c.date===selDay).length+" clase"+(classes.filter(c=>c.date===selDay).length!==1?"s":"")}</div>
            </div>
          </div>
        );
      })()}

      <button onClick={()=>setShowNew(true)} style={{position:"fixed",bottom:72,right:20,width:56,height:56,borderRadius:"50%",border:"none",background:"linear-gradient(135deg,#52C048,#65CE5A)",color:C.white,fontSize:28,cursor:"pointer",zIndex:50,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      {/* Edit scope modal */}
      {editScopeData&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
          <div style={{background:"#fff",borderRadius:20,padding:24,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
            <div style={{fontSize:17,fontWeight:800,color:C.text,marginBottom:6}}>¿Aplicar cambios a?</div>
            <div style={{fontSize:13,color:C.mutedDark,marginBottom:20}}>Esta es una clase recurrente. ¿El cambio aplica solo a esta fecha o a toda la serie?</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <button onClick={()=>{onSaveClass(editScopeData,true);setEditScopeData(null);setEditCls(null);}} style={{padding:"14px",borderRadius:12,border:"1.5px solid "+C.border,background:C.blueL,color:C.blue2,cursor:"pointer",fontSize:14,fontWeight:700,textAlign:"left"}}>
                📅 Solo esta clase ({editScopeData.date})
              </button>
              <button onClick={()=>{onSaveClass({...editScopeData,applyToAll:true},true);setEditScopeData(null);setEditCls(null);}} style={{padding:"14px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:700,textAlign:"left"}}>
                🔄 A Todas las Clases
              </button>
              <button onClick={()=>setEditScopeData(null)} style={{padding:"12px",borderRadius:12,border:"1.5px solid "+C.border,background:"#fff",color:C.mutedDark,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {editCls&&<EditClassScreen key={editCls._virtualId||editCls.id+"_"+editCls.date} cls={editCls} students={students} onClose={()=>setEditCls(null)} onSave={(u)=>{
        // Check if this is a recurring class (has days array with values)
        const isRecurring=editCls.days&&editCls.days.length>0;
        if(isRecurring){
          setEditScopeData(u);
        } else {
          onSaveClass(u,true);
          setEditCls(null);
        }
      }} onCreateStudent={onAddStudent} packages={packages} onDelete={(id)=>{const realId=editCls?._seriesId||id;onDeleteClass&&onDeleteClass(realId);setEditCls(null);}}/>}

      {/* Custom delete confirmation modal */}
      {confirmDelete&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
          <div style={{background:"#fff",borderRadius:20,padding:24,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
            <div style={{width:48,height:48,borderRadius:"50%",background:"#FFEBEE",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </div>
            <div style={{fontSize:17,fontWeight:800,color:"#0D1B4B",textAlign:"center",marginBottom:8}}>Eliminar clase</div>
            <div style={{fontSize:14,color:"#6B7BAD",textAlign:"center",marginBottom:24,lineHeight:1.5}}>Todas las instancias de <strong>{confirmDelete.title}</strong> serán eliminadas del calendario. Esta acción no se puede deshacer.</div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setConfirmDelete(null)} style={{flex:1,padding:"13px",borderRadius:12,border:"1.5px solid #E0E7FF",background:"#fff",cursor:"pointer",fontSize:14,color:"#6B7BAD",fontWeight:700}}>Cancelar</button>
              <button onClick={()=>{onDeleteClass&&onDeleteClass(confirmDelete._seriesId||confirmDelete.id);setConfirmDelete(null);}} style={{flex:1,padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#C62828,#E53935)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800}}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
      {showCancel&&<CancelReprogModal cls={showCancel} onClose={()=>setShowCancel(null)} onSave={(u)=>{onSaveClass(u,true);setShowCancel(null);}} students={students} onUpdateStudent={onUpdateStudent}/>}
      {showNew&&<NewClassModal onClose={()=>{setShowNew(false);setGridNewTime(null);setWeekOffset(0);}} onSave={onSaveClass} students={students} dateLabel={viewMode==="month"?selLabel:weekLabel()} onCreateStudent={onAddStudent} prefill={gridNewTime||(viewMode==="month"?{date:selDay}:null)} courts={courts} packages={packages} onAddPackage={(pkg)=>{if(typeof onAddPackage==="function")onAddPackage(pkg);}}/>}
      {att&&<AttModal att={att} students={students} onAttendance={onAttendance} onClose={()=>setAtt(null)}/>}
    </div>
  );
}

function CreateGroupScreen({ students, onClose, onCreate }) {
  const [step,setStep]=useState(1);
  const [gName,setGName]=useState("");
  const [selM,setSelM]=useState([]);
  const toggleM=(id)=>setSelM(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  if(step===1) return (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:C.bg}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onClose} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.white,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
        <span style={{flex:1,fontWeight:800,fontSize:16,color:C.white}}>Nuevo Grupo</span>
        <span style={{fontSize:12,color:C.muted}}>1 / 3</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:20}}>
        <div style={{marginBottom:20}}><label style={{fontSize:13,color:C.blue2,fontWeight:700,display:"block",marginBottom:6}}>Nombre del grupo</label><input value={gName} onChange={e=>setGName(e.target.value)} placeholder="Ej: Grupo Mañana 🌅" style={{width:"100%",padding:"14px 16px",borderRadius:12,border:"none",fontSize:14,boxSizing:"border-box",background:C.blueL,color:C.text,outline:"none"}}/></div>
        <button onClick={()=>{if(gName.trim())setStep(2);}} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:gName.trim()?"linear-gradient(135deg,#0D1B4B,#1A3DB5)":"#ccc",color:C.white,fontSize:15,cursor:"pointer",fontWeight:800}}>Siguiente →</button>
      </div>
    </div>
  );
  if(step===2) return (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:C.bg}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setStep(1)} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.white,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
        <span style={{flex:1,fontWeight:800,fontSize:16,color:C.white}}>Agregar Miembros</span>
        <span style={{fontSize:12,color:C.muted}}>2 / 3</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {students.map(s=>{const sel=selM.includes(s.id);return(
          <div key={s.id} onClick={()=>toggleM(s.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:14,background:sel?C.blueL:C.white,border:"1.5px solid "+(sel?C.blue2:C.border),marginBottom:10,cursor:"pointer"}}>
            <div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:C.white,flexShrink:0}}>{s.avatar}</div>
            <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:C.text}}>{s.name}</div><div style={{fontSize:12,color:C.mutedDark}}>{s.sport}</div></div>
            <div style={{width:24,height:24,borderRadius:"50%",border:"2px solid "+(sel?C.blue2:C.border),background:sel?C.blue2:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
              {sel&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
          </div>
        );})}
      </div>
      <div style={{padding:"12px 16px",background:C.white,borderTop:"1px solid "+C.border}}>
        <button onClick={()=>{if(selM.length>0)setStep(3);}} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:selM.length>0?"linear-gradient(135deg,#0D1B4B,#1A3DB5)":"#ccc",color:C.white,fontSize:15,cursor:"pointer",fontWeight:800}}>Siguiente →</button>
      </div>
    </div>
  );
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:C.bg}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setStep(2)} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.white,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
        <span style={{flex:1,fontWeight:800,fontSize:16,color:C.white}}>Confirmar Grupo</span>
        <span style={{fontSize:12,color:C.muted}}>3 / 3</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:20}}>
        <WhiteCard style={{marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,color:C.mutedDark,marginBottom:10}}>{"MIEMBROS ("+selM.length+")"}</div>
          {selM.map(sid=>{const st=students.find(s=>s.id===sid);return st?(<div key={sid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid "+C.border}}><div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:C.white}}>{st.avatar}</div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{st.name}</div></div>):null;})}
        </WhiteCard>
        <button onClick={()=>{const init=gName.trim().split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase();onCreate({id:"g"+Date.now(),name:gName,avatar:init,lastMsg:"Grupo creado",time:"Ahora",isGroup:true,members:selM});onClose();}} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:"linear-gradient(135deg,"+C.green+",#66BB6A)",color:C.white,fontSize:15,cursor:"pointer",fontWeight:800,marginBottom:10}}>✓ Crear Grupo</button>
        <button onClick={onClose} style={{width:"100%",padding:"15px",borderRadius:14,border:"1.5px solid "+C.border,background:C.white,color:C.mutedDark,fontSize:15,cursor:"pointer",fontWeight:700}}>Cancelar</button>
      </div>
    </div>
  );
}

function Chat({ students, initialTarget, onClearTarget, sendNotification, userId, unreadChats={}, onMarkRead }) {
  const [view,setView]=useState(initialTarget?"chat":"list");
  const [active,setActive]=useState(initialTarget||null);
  const [msg,setMsg]=useState("");
  const [msgs,setMsgs]=useState([]);
  const [isAlert,setIsAlert]=useState(false);
  const [loading,setLoading]=useState(false);
  const [lastMsgTime,setLastMsgTime]=useState({});
  const [showCreate,setShowCreate]=useState(false);
  const [groups,setGroups]=useState(()=>{try{return JSON.parse(localStorage.getItem("izi_groups")||"[]");}catch{return[];}});

  useEffect(()=>{
    if(!userId) return;
    supabase.from("messages").select("student_id,created_at").eq("coach_id",userId).order("created_at",{ascending:false})
      .then(({data})=>{
        const times={};
        (data||[]).forEach(m=>{if(!times[m.student_id])times[m.student_id]=m.created_at;});
        setLastMsgTime(times);
      });
  },[userId]);

  useEffect(()=>{
    if(!active||!userId) return;
    setLoading(true);
    const studentId=active.id;
    // Mark as read
    supabase.from("messages").update({read:true}).eq("coach_id",userId).eq("student_id",studentId).eq("from_coach",false)
      .then(({error})=>{if(error)console.error("mark read error:",error);});
    onMarkRead&&onMarkRead(String(studentId));
    supabase.from("messages").select("*").eq("coach_id",userId).eq("student_id",studentId).order("created_at",{ascending:true})
      .then(({data})=>{setMsgs(data||[]);setLoading(false);});
    const channel=supabase.channel("chat_"+userId+"_"+studentId)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`coach_id=eq.${userId}`},(payload)=>{
        if(payload.new.student_id===studentId) setMsgs(p=>[...p,payload.new]);
      }).subscribe();
    return ()=>supabase.removeChannel(channel);
  },[active,userId]);

  const send=async()=>{
    if(!msg.trim()||!active||!userId) return;
    const text=msg;setMsg("");
    await supabase.from("messages").insert({coach_id:userId,student_id:active.id,text,from_coach:true,read:false,is_alert:isAlert});
    if(isAlert&&sendNotification) sendNotification(text,"alert");
    setIsAlert(false);
  };

  if(view==="chat"&&active) return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:"calc(64px + env(safe-area-inset-bottom,0px))",display:"flex",flexDirection:"column",background:C.bg,zIndex:50}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={()=>{setView("list");setActive(null);setMsgs([]);onClearTarget&&onClearTarget();}} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.white,fontSize:18}}>{"<"}</button>
        <div style={{width:38,height:38,borderRadius:"50%",background:C.whiteA,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:C.white,flexShrink:0}}>{active.avatar||"?"}</div>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:14,color:C.white}}>{active.name}</div>
          <div style={{fontSize:11,color:C.muted}}>En línea</div>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:10,paddingBottom:80}}>
        {loading&&<div style={{textAlign:"center",color:C.mutedDark,padding:20}}>Cargando...</div>}
        {msgs.map((m,i)=>(
          <div key={m.id||i} style={{display:"flex",justifyContent:m.from_coach?"flex-end":"flex-start"}}>
            <div style={{maxWidth:"75%"}}>
              {m.is_alert&&m.from_coach&&<div style={{fontSize:10,color:"#E65100",fontWeight:700,marginBottom:2}}>📢 ALERTA</div>}
              <div style={{padding:"10px 14px",fontSize:14,borderRadius:m.from_coach?"18px 18px 4px 18px":"18px 18px 18px 4px",background:m.from_coach?m.is_alert?"#fdf3e2":"linear-gradient(135deg,"+C.blue2+","+C.blue3+")":C.white,color:m.from_coach?m.is_alert?"#5D3A00":C.white:C.text,border:m.is_alert?"1px solid #F5C842":"none"}}>
                {m.text}
                <div style={{fontSize:10,opacity:.7,marginTop:4,textAlign:"right"}}>{new Date(m.created_at).toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"})}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"8px 16px",background:C.white,borderTop:"1px solid "+C.border,flexShrink:0,paddingBottom:"calc(8px + env(safe-area-inset-bottom,0px))"}}>
        {isAlert&&<div style={{background:"#FFF3E0",borderRadius:8,padding:"6px 12px",marginBottom:6,fontSize:12,color:"#E65100",fontWeight:600}}>📢 Esto se enviará como alerta al alumno</div>}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>setIsAlert(v=>!v)} style={{background:isAlert?"#FF8F00":C.blueL,border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>📢</button>
          <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder={isAlert?"Escribí la alerta...":"Escribe un mensaje..."} style={{flex:1,padding:"10px 16px",borderRadius:24,border:"1.5px solid "+(isAlert?"#FF8F00":C.border),fontSize:14,background:C.bg,color:C.text,outline:"none"}}/>
          <button onClick={send} style={{background:isAlert?"linear-gradient(135deg,#FF8F00,#FFA726)":"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",border:"none",borderRadius:"50%",width:44,height:44,cursor:"pointer",color:C.white,fontSize:18,flexShrink:0}}>➤</button>
        </div>
      </div>
    </div>
  );

  if(showCreate) return <CreateGroupScreen students={students} onClose={()=>setShowCreate(false)} onCreate={(g)=>{setGroups(p=>{const next=[g,...p];localStorage.setItem("izi_groups",JSON.stringify(next));return next;});setShowCreate(false);}}/>;

  // Sort students — unread first, then by most recent message
  const sortedStudents=[...students].sort((a,b)=>{
    const ua=unreadChats[String(a.id)]||0, ub=unreadChats[String(b.id)]||0;
    if(ua!==ub) return ub-ua;
    const ta=lastMsgTime[a.id]||"", tb=lastMsgTime[b.id]||"";
    return tb.localeCompare(ta);
  });
  return (
    <div style={{flex:1,overflowY:"auto",background:C.bg}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"16px 16px 24px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{fontSize:18,fontWeight:800,color:C.white}}>Mensajes</div>
          <button onClick={()=>setShowCreate(true)} style={{padding:"7px 14px",borderRadius:20,border:"none",background:"linear-gradient(135deg,"+C.green+",#66BB6A)",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700}}>+ Crear grupo</button>
        </div>
      </div>
      <div style={{padding:"12px 12px 80px"}}>
        {/* Groups */}
        {groups.map(g=>(
          <div key={g.id} onClick={()=>{setActive({...g});setView("chat");}} style={{background:C.white,borderRadius:14,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,cursor:"pointer",boxShadow:"0 2px 8px rgba(44,94,247,0.06)",border:"1.5px solid transparent"}}>
            <div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,"+C.green+",#66BB6A)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:C.white,flexShrink:0}}>{g.avatar||"G"}</div>
            <div style={{flex:1,textAlign:"left"}}>
              <div style={{fontWeight:700,fontSize:14,color:C.text,textAlign:"left"}}>{g.name}</div>
              <div style={{fontSize:12,color:C.mutedDark,marginTop:2,textAlign:"left"}}>{(g.members||[]).length} miembros</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.mutedDark} strokeWidth="2" style={{flexShrink:0}}><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        ))}
        {/* Individual students */}
        {sortedStudents.length===0&&groups.length===0&&<div style={{textAlign:"center",padding:"40px 0",color:C.mutedDark}}>No hay alumnos aún</div>}
        {sortedStudents.map(s=>{
          const unread=unreadChats[String(s.id)]||0;
          return (
            <div key={s.id} onClick={()=>{setActive(s);setView("chat");}} style={{background:C.white,borderRadius:14,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,cursor:"pointer",boxShadow:unread?"0 2px 12px rgba(255,71,87,0.15)":"0 2px 8px rgba(44,94,247,0.06)",border:unread?"1.5px solid #FF4757":"1.5px solid transparent"}}>
              <div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:C.white,flexShrink:0}}>{s.avatar||"?"}</div>
              <div style={{flex:1,textAlign:"left"}}>
                <div style={{fontWeight:700,fontSize:14,color:C.text,textAlign:"left"}}>{s.name}</div>
                <div style={{fontSize:12,color:unread?"#FF4757":C.mutedDark,marginTop:2,textAlign:"left",fontWeight:unread?600:400}}>{unread?"Nuevo mensaje":"Toca para chatear"}</div>
              </div>
              {unread>0
                ?<div style={{background:"#FF4757",borderRadius:"50%",minWidth:24,height:24,fontSize:12,fontWeight:800,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px",flexShrink:0}}>{unread>9?"9+":unread}</div>
                :<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.mutedDark} strokeWidth="2" style={{flexShrink:0}}><polyline points="9 18 15 12 9 6"/></svg>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PagoModal({s, combo, newClasses, setNewClasses, newAmount, setNewAmount, newDate, setNewDate, onClose, onUpdate, classes=[], addIncome, packages=[], sendNotification}) {
  const [showRecordatorioPago,setShowRecordatorioPago]=useState(false);
  const [pagoTipo,setPagoTipo]=useState(()=>{
    if(combo?.total>0) return "clases";
    if(combo?.packType==="individual"||combo?.packType==="combo") return "clases";
    return "mensual";
  });
  const [payMethod,setPayMethod]=useState("efectivo");
  const [step,setStep]=useState("form");
  const TODAY=TODAY_DATE;
  // Always start at 0 so coach explicitly enters the amount
  const [localClasses,setLocalClasses]=useState(0);
  const [localAmount,setLocalAmount]=useState(0);
  const [localDate,setLocalDate]=useState(newDate||combo?.payDate||combo?.date||"");
  const [localPayDate,setLocalPayDate]=useState(TODAY_DATE);
  const [localPayMonth,setLocalPayMonth]=useState(()=>{
    const d=new Date();
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  });

  const iSp={width:"100%",padding:"11px 14px",borderRadius:12,border:"none",fontSize:14,boxSizing:"border-box",background:C.blueL,color:"#1A237E",outline:"none"};
  const payMethodLabel={"efectivo":"💵 Efectivo","transferencia":"🏦 Transferencia","tarjeta":"💳 Tarjeta"};

  const myClasses=classes.filter(c=>c.students&&c.students.includes(s.id));
  const classDays=myClasses.length>0?myClasses[0].days:[];
  const classTime=myClasses.length>0?myClasses[0].time:"";
  const classCourt=myClasses.length>0?myClasses[0].court:"";
  const DAY_MAP={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
  const classDowSet=new Set(classDays.map(d=>DAY_MAP[d]));

  const attendedDates=new Set();
  classes.forEach(cls=>{
    if(!cls.students||!cls.students.includes(s.id)) return;
    (cls.attendanceLog||[]).forEach(e=>{if(e.present&&e.present.includes(s.id)) attendedDates.add(e.date);});
  });

  const allCombos=s.combos||[];
  const paidCoveredDates=new Set();
  allCombos.forEach(c=>{
    if(!c.paid||!c.total) return;
    const startD=new Date((c.date||"2026-01-01")+"T12:00:00");
    let cur=new Date(startD); let count=0;
    while(count<c.total){
      if(classDowSet.size===0||classDowSet.has(cur.getDay())){
        const ds=cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0");
        paidCoveredDates.add(ds); count++;
      }
      cur.setDate(cur.getDate()+1);
    }
  });

  const moraDates=[...attendedDates].filter(d=>!paidCoveredDates.has(d)).sort();
  const lastCombo=allCombos.length>0?allCombos[allCombos.length-1]:null;
  const totalPaid=lastCombo?.total||0;
  const totalUsed=lastCombo?.used||0;
  // moraCount only applies when the last combo was paid and exceeded
  // If unpaid, there's no mora — just unpaid classes
  const moraCount=lastCombo?.paid?Math.max(0,totalUsed-totalPaid):0;
  const newTotal=pagoTipo==="clases"?(parseInt(localClasses)||0):0;
  const newRealizadas=moraCount;
  const newRestantes=newTotal-newRealizadas;
  const newIsExceeded=newRestantes<0;
  const newIsWarning=newRestantes>=0&&newRestantes<=2&&newTotal>0;

  const mNShort=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const wDFull=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

  const formatDate=(ds)=>{
    const d=new Date(ds+"T12:00:00");
    return wDFull[d.getDay()]+" "+d.getDate()+" "+mNShort[d.getMonth()];
  };


  // Build dates from ALL active combos (individual + regular combos)
  const buildAllDates=()=>{
    const result=[];
    // Include active combos - hide fully paid AND fully realized ones (those go to history)
    const activeCombos=allCombos.filter(c=>{
      if(c.total>0){
        const paidCount=c.paidCount!==undefined?c.paidCount:(c.paid?c.total:0);
        // Hide fully paid combos
        if(c.paid&&paidCount>=(c.total||1)) return false;
        return true;
      }
      if(c.packType==="individual"||c.packType==="combo") return true;
      if(c.total===null&&c.date&&c.packType!=="mensual"){
        const hasMatchingClass=myClasses.some(cls=>cls.date===c.date);
        if(hasMatchingClass) return true;
      }
      return false;
    });
    if(activeCombos.length===0) return result;
    activeCombos.forEach(c=>{
      const effectiveTotal=c.total||1;
      const paidCount=c.paidCount!==undefined?c.paidCount:(c.paid?effectiveTotal:0);
      // Get dates: from stored dates array, or from matching class dates, or generate
      let dates=[];
      if(c.dates&&c.dates.length>0){
        dates=[...c.dates];
      } else if(c.date){
        const matchingCls=myClasses.find(cls=>cls.date===c.date);
        dates=[matchingCls?matchingCls.date:c.date];
      }
      dates.slice(0,Math.max(effectiveTotal,dates.length)).forEach((ds,i)=>{
        const classOnDate=myClasses.find(cl=>cl.date===ds);
        const isCancelled=!!(classOnDate?.cancelled&&classOnDate?.cancelType==="cancelled");
        const isReprogWithDate=!!(classOnDate?.cancelled&&classOnDate?.cancelType==="cancelled_reprog"&&classOnDate?.rescheduledTo);
        const isReprogNoDate=!!(classOnDate?.cancelled&&classOnDate?.cancelType==="cancelled_reprog"&&!classOnDate?.rescheduledTo);
        const isPaused=!!(classOnDate?.paused||classOnDate?.cancelType==="paused");
        const isAnyCancelled=isCancelled||isReprogWithDate||isReprogNoDate;
        const isPaidDate=i<paidCount;
        const attEntry=myClasses.flatMap(cls=>cls.attendanceLog||[]).find(e=>e.date===ds);
        const wasAusenteDada=attEntry?(attEntry.ausente_dada||[]).includes(s.id):false;
        const wasAusenteReprog=attEntry?(attEntry.ausente_reprog||[]).includes(s.id):false;
        const wasPresent=attEntry?(attEntry.present||[]).includes(s.id):false;
        const wasAbsent=attEntry?(!wasPresent&&!wasAusenteDada&&!wasAusenteReprog):false;
        // Cancelled classes count as "given" for billing, paused classes DON'T count
        const isGiven=isPaused?false:isCancelled?true:isReprogWithDate?true:isReprogNoDate?false:wasAusenteReprog?false:attEntry?(wasPresent||wasAusenteDada):isClassDone(ds,classOnDate?.timeEnd);
        let status;
        if(isPaidDate){status=isGiven?"dada":"adar";}
        else{status=isGiven?"dada_unpaid":"pendiente";}
        result.push({date:ds,status,comboId:c.id,isGiven,wasPresent,wasAbsent,wasAusenteDada,wasAusenteReprog,isCancelled,isReprogWithDate,isReprogNoDate,isPaused,rescheduledTo:classOnDate?.rescheduledTo||null});
      });
    });
    // Deduplicate by date - keep first occurrence
    const seen=new Set();
    const deduped=result.filter(r=>{
      if(seen.has(r.date)) return false;
      seen.add(r.date);
      return true;
    });
    return deduped.sort((a,b)=>a.date.localeCompare(b.date));
  };

  const allDates=buildAllDates();

  // For new combo projection (mora + future)
  const buildProjectedDates=(qty)=>{
    const dates=[];
    if(moraCount>0){
      const allCovered=[...paidCoveredDates].sort();
      const lastPaid=allCovered.length>0?allCovered[allCovered.length-1]:TODAY;
      let cur=new Date(lastPaid+"T12:00:00");
      cur.setDate(cur.getDate()+1);
      let added=0;
      while(added<moraCount){
        const ds=cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0");
        if(classDowSet.size===0||classDowSet.has(cur.getDay())){
          dates.push({date:ds,mora:added>=qty,wasMora:added<qty});
          added++;
        }
        cur.setDate(cur.getDate()+1);
      }
    }
    const extraNeeded=Math.max(0,qty-moraCount);
    if(extraNeeded>0){
      const lastDone=dates.length>0?dates[dates.length-1].date:([...paidCoveredDates].sort().slice(-1)[0]||TODAY);
      let cur=new Date(lastDone+"T12:00:00");
      cur.setDate(cur.getDate()+1);
      let added=0;
      while(added<extraNeeded){
        const ds=cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0");
        if(classDowSet.size===0||classDowSet.has(cur.getDay())){
          dates.push({date:ds,mora:false,wasMora:false});
          added++;
        }
        cur.setDate(cur.getDate()+1);
      }
    }
    return dates;
  };

  const projDates=buildProjectedDates(parseInt(localClasses)||0);

  const handleGoToReview=()=>{
    if(pagoTipo==="clases"&&(!localClasses||parseInt(localClasses)<=0)){
      alert("Ingresá la cantidad de clases usando el stepper ◀ ▶");return;
    }
    if(!localAmount||parseInt(localAmount)<=0){
      alert("Ingresá el monto del pago.");return;
    }
    setStep("review");
  };

  const handleConfirm=()=>{
    if(pagoTipo==="clases"&&(!localClasses||parseInt(localClasses)<=0)){alert("Ingresá la cantidad de clases.");return;}
    if(!localAmount||parseInt(localAmount)<=0){alert("Ingresá el monto.");return;}
    const qty=parseInt(localClasses)||0;
    let updatedCombos=[...s.combos];

    // Generate projected dates for new combo based on class schedule
    const generateNewDates=(qty, startAfterDate)=>{
      if(!qty||classDowSet.size===0) return [];
      const dates=[];
      let cur=new Date((startAfterDate||TODAY)+"T12:00:00");
      cur.setDate(cur.getDate()+1);
      while(dates.length<qty){
        if(classDowSet.has(cur.getDay())){
          dates.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
        }
        cur.setDate(cur.getDate()+1);
      }
      return dates;
    };

    if(pagoTipo==="clases"&&qty>0){
      // Distribute payment across combos from oldest to newest
      let remaining=qty;
      updatedCombos=updatedCombos.map(c=>{
        if(remaining<=0||!c.total||c.total===null) return c;
        const prevPaid=c.paidCount!==undefined?c.paidCount:(c.paid?c.total:0);
        if(prevPaid>=c.total) return c; // already fully paid
        const canPay=Math.min(c.total-prevPaid,remaining);
        if(canPay<=0) return c;
        remaining-=canPay;
        const newPaidCount=prevPaid+canPay;
        const fullyPaid=newPaidCount>=c.total;
        const givenCount=(c.dates||[]).filter(d=>d<=TODAY).length;
        const paymentDates=(c.dates||[]).slice(prevPaid,newPaidCount);
        const newPayment={id:Date.now()+remaining,qty:canPay,amount:Math.round((parseInt(localAmount)||0)*(canPay/qty)),method:payMethod,date:localDate||TODAY,dates:paymentDates};
        return {...c,paid:fullyPaid,paidCount:newPaidCount,used:Math.max(c.used||0,givenCount),payments:[...(c.payments||[]),newPayment]};
      });
      // Check if last combo is now fully paid and all given → auto-create next
      const lastC=updatedCombos[updatedCombos.length-1];
      if(lastC&&lastC.paid&&lastC.total>0){
        const givenCount=(lastC.dates||[]).filter(d=>d<=TODAY).length;
        if(givenCount>=lastC.total){
          const lastComboDate=(lastC.dates||[]).slice(-1)[0]||TODAY;
          const nextDates=generateNewDates(lastC.total, lastComboDate);
          updatedCombos.push({id:updatedCombos.length+1,total:lastC.total,packType:lastC.packType||"combo",used:0,paid:false,paidCount:0,date:nextDates[0]||TODAY,amount:lastC.amount||0,dates:nextDates,payments:[]});
        }
      }
    } else if(pagoTipo==="clases"&&qty>0){
      const allExistingDates=updatedCombos.flatMap(c=>c.dates||[]).sort();
      const lastDate=allExistingDates.length>0?allExistingDates[allExistingDates.length-1]:TODAY;
      const newDates=generateNewDates(qty, lastDate);
      const payment={id:Date.now(),qty,amount:parseInt(localAmount)||0,method:payMethod,date:localDate||TODAY,dates:newDates};
      updatedCombos.push({id:s.combos.length+1,total:qty,used:0,paid:true,paidCount:qty,date:localDate||TODAY,amount:parseInt(localAmount)||0,method:payMethod,dates:newDates,payments:[payment]});
    } else {
      // Mensual
      const mensualPayment={id:Date.now(),qty:1,amount:parseInt(localAmount)||0,method:payMethod,date:localPayDate||TODAY,payMonth:localPayMonth,dates:[]};
      updatedCombos.push({id:s.combos.length+1,total:null,packType:"mensual",used:0,paid:true,date:localDate||TODAY,payDate:localPayDate||TODAY,amount:parseInt(localAmount)||0,method:payMethod,payments:[mensualPayment]});
    }

    onUpdate({...s,combos:updatedCombos});
    if(addIncome&&parseInt(localAmount)>0){
      const qty=parseInt(localClasses)||0;
      const detail=pagoTipo==="mensual"?"Plan Mensual":qty===1?"1 clase":qty+" clases";
      addIncome(parseInt(localAmount), localPayDate||TODAY, s.name, detail);
    }
    setStep("success");
    // If all classes given (closed cycle), close faster
    const allGiven=updatedCombos[updatedCombos.length-1]?.used>=updatedCombos[updatedCombos.length-1]?.total;
    setTimeout(()=>onClose(), allGiven?1500:2200);
  };

  if(step==="success") {
    const updatedCombos=s.combos||[];
    const lastC=updatedCombos[updatedCombos.length-1];
    const isComplete=lastC&&(lastC.paidCount||0)>=(lastC.total||1)&&(lastC.used||0)>=(lastC.total||1)&&lastC.total>0;
    return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:24,padding:"40px 32px",textAlign:"center",width:"80%",maxWidth:320}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg,#52C048,#65CE5A)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div style={{fontSize:20,fontWeight:900,color:"#1A237E",marginBottom:6}}>¡Pago registrado!</div>
        <div style={{fontSize:14,color:"#5C7A9F",marginBottom:isComplete?20:0}}>{s.name}</div>
        {isComplete&&(
          <button onClick={()=>{
            const DAY_MAP2={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
            const clsDays=myClasses.length>0?myClasses[0].days:[];
            const dowSet=new Set(clsDays.map(d=>DAY_MAP2[d]));
            const lastDate=lastC.dates&&lastC.dates.length>0?lastC.dates[lastC.dates.length-1]:"";
            const newDates=[];
            let cur=new Date((lastDate||TODAY)+"T12:00:00");
            cur.setDate(cur.getDate()+1);
            while(newDates.length<lastC.total){
              if(dowSet.size===0||dowSet.has(cur.getDay())){
                newDates.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
              }
              cur.setDate(cur.getDate()+1);
            }
            const newCombo={id:updatedCombos.length+1,total:lastC.total,packType:lastC.packType||"combo",used:0,paid:false,paidCount:0,date:newDates[0]||TODAY,amount:lastC.amount,dates:newDates,payments:[]};
            onUpdate({...s,combos:[...updatedCombos,newCombo]});
            onClose();
          }} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#1565C0,#1976D2)",color:"#fff",fontSize:14,cursor:"pointer",fontWeight:800}}>
            🔄 Renovar Combo
          </button>
        )}
      </div>
    </div>
    );
  }

  if(step==="review"){
    const qty=parseInt(localClasses)||0;
    const startDateLabel=localDate?formatDate(localDate):(projDates.length>0?formatDate(projDates[0].date):"—");
    return (
      <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:999,display:"flex",alignItems:"flex-end"}}>
        <div style={{background:"#FFFFFF",borderRadius:"24px 24px 0 0",width:"100%",maxHeight:"92%",overflowY:"auto",boxSizing:"border-box",padding:"24px 20px 32px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
            <button onClick={()=>setStep("form")} style={{background:C.blueL,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.blue2,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
            <div style={{fontWeight:900,fontSize:18,color:"#1A237E"}}>Resumen del pago</div>
          </div>
          <div style={{background:C.blueL,borderRadius:16,padding:"16px",marginBottom:16}}>
            <div style={{fontSize:16,fontWeight:800,color:"#1A237E",marginBottom:10}}>{s.name}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                {l:"Plan",v:pagoTipo==="clases"?"📦 "+qty+" clases":"📅 Mensual"},
                {l:"Monto",v:fmtMoney(localAmount)},
                {l:"Forma de pago",v:payMethodLabel[payMethod]},
                {l:"Fecha de pago",v:startDateLabel},
              ].map(f=>(
                <div key={f.l}>
                  <div style={{fontSize:10,fontWeight:700,color:"#5C7A9F",marginBottom:2}}>{f.l.toUpperCase()}</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#1A237E"}}>{f.v}</div>
                </div>
              ))}
            </div>
          </div>
          {pagoTipo==="clases"&&(()=>{
            const lastComboDate=allDates.length>0?allDates[allDates.length-1].date:"";
          const allPaid=allDates.every(d=>d.status==="dada"||d.status==="adar");
          const lastDatePassed=lastComboDate&&lastComboDate<TODAY;
          // Keep all dates visible until all are paid AND last date has passed
          const activeDates=allPaid&&lastDatePassed?[]:allDates.filter(d=>d.status!=="dada");
            const qty=parseInt(localClasses)||0;
            const reviewDates=[
              ...activeDates.map((item,i)=>({...item,isNew:false,idx:i})),
              ...(lastCombo?.paid?projDates.map((item,i)=>({...item,isNew:true,idx:activeDates.length+i})):[]),
            ];
            if(reviewDates.length===0){
              // Fallback: show combo date for individual/unpaid
              const fallbackDate=lastCombo?.date||TODAY;
              return (
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#5C7A9F",letterSpacing:0.5,marginBottom:8}}>FECHAS DE CLASE</div>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:C.blueL,border:"2px solid "+C.blue2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <span style={{fontSize:11,fontWeight:800,color:C.blue2}}>1</span>
                    </div>
                    <div style={{flex:1,fontSize:13,fontWeight:600,color:"#1A237E"}}>{formatDate(fallbackDate)}</div>
                    <span style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:"#FFF3E0",color:"#E65100",fontWeight:700}}>No Pagada</span>
                  </div>
                </div>
              );
            }
            return (
            <div style={{marginBottom:20}}>
              <div style={{fontSize:11,fontWeight:700,color:"#5C7A9F",letterSpacing:0.5,marginBottom:8}}>FECHAS DE CLASE</div>
              {reviewDates.map((item,i)=>{
                const isPaidNow=lastCombo?.paid?true:i<qty;
                const isPaid=item.status!=="pendiente"||isPaidNow||item.isNew;
                const wasAbsent=item.wasAbsent||false;
                const isCancelled=item.isCancelled||false;
                const isReprogWithDate=item.isReprogWithDate||false;
                const isReprogNoDate=item.isReprogNoDate||false;
                const isPausedItem=item.isPaused||false;
                let leftBg,leftColor,leftLabel,rightBg,rightColor,rightLabel;
                if(isPausedItem){
                  leftBg="#FFF3E0";leftColor="#E65100";leftLabel="⏸ Pausada";
                } else if(isCancelled){
                  leftBg="#FFF0F0";leftColor="#C62828";leftLabel="⛔ Cancelada";
                } else if(isReprogWithDate){
                  leftBg="#E8F5E9";leftColor="#2E7D32";leftLabel="🔄 Reprogramada";
                } else if(isReprogNoDate){
                  leftBg="#E3F2FD";leftColor="#1565C0";leftLabel="🕐 A Reprogramar";
                } else if(wasAbsent){
                  leftBg="#FFF3E0";leftColor="#E65100";leftLabel="🚫 Ausente";
                } else if(item.isGiven){
                  leftBg="#E8F5E9";leftColor="#2E7D32";leftLabel="✓ Realizada";
                } else {
                  leftBg="#FFF8E1";leftColor="#F57F17";leftLabel="Programada";
                }
                if(isPausedItem){rightBg="#FFF3E0";rightColor="#E65100";rightLabel="⏸ Pausada";}
                else if(item.isNew||isPaid){rightBg="#E8F5E9";rightColor="#2E7D32";rightLabel="Pagada";}
                else{rightBg="#FFF3E0";rightColor="#E65100";rightLabel="No Pagada";}
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid #E3F2FD"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:isPausedItem?"#FFF3E0":isCancelled?"#FFF0F0":isReprogWithDate?"#E8F5E9":isReprogNoDate?"#E3F2FD":item.isNew?"#E8F5E9":C.blueL,border:"2px solid "+(isPausedItem?"#E65100":isCancelled?"#C62828":isReprogWithDate?"#2E7D32":isReprogNoDate?"#1565C0":item.isNew?"#43A047":C.blue2),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <span style={{fontSize:11,fontWeight:800,color:isPausedItem?"#E65100":isCancelled?"#C62828":isReprogWithDate?"#2E7D32":isReprogNoDate?"#1565C0":item.isNew?"#43A047":C.blue2}}>{i+1}</span>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:"#1A237E"}}>{formatDate(item.date)}</div>
                      {isReprogWithDate&&item.rescheduledTo&&<div style={{fontSize:10,color:"#2E7D32",marginTop:1}}>→ {formatDate(item.rescheduledTo)}</div>}
                    </div>
                    <span style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:leftBg,color:leftColor,fontWeight:700,flexShrink:0}}>{leftLabel}</span>
                    <span style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:rightBg,color:rightColor,fontWeight:700,flexShrink:0}}>{rightLabel}</span>
                  </div>
                );
              })}
            </div>
          );})()}
          <button onClick={handleConfirm} style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:"linear-gradient(135deg,#52C048,#65CE5A)",color:"#fff",fontSize:15,cursor:"pointer",fontWeight:900}}>
            ✓ Confirmar pago
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:999,display:"flex",alignItems:"flex-end"}}>
      <div style={{background:"#FFFFFF",borderRadius:"24px 24px 0 0",width:"100%",maxHeight:"94%",overflowY:"auto",boxSizing:"border-box"}}>
        <div style={{padding:"20px 20px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16,paddingBottom:14,borderBottom:"1px solid "+C.border}}>
            {s.photo
              ?<img src={s.photo} style={{width:52,height:52,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>
              :<div style={{width:52,height:52,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:800,color:"#fff",flexShrink:0}}>{s.avatar}</div>
            }
            <div style={{flex:1,textAlign:"left",minWidth:0}}>
              <div style={{fontWeight:900,fontSize:22,color:"#1A237E",lineHeight:1.1,textAlign:"left"}}>{s.name}</div>
              <div style={{fontSize:12,color:"#5C7A9F",marginTop:3,textAlign:"left"}}>Actualizar Pagos</div>
            </div>
          </div>


          {/* Due date banner for mensual */}
          {pagoTipo==="mensual"&&lastCombo?.date&&(
            <div style={{background:C.blueL,borderRadius:12,padding:"11px 16px",marginBottom:16,textAlign:"center"}}>
              <span style={{fontSize:14,fontWeight:700,color:C.blue2}}>
                {"📅 Fecha de pago es el "+new Date(lastCombo.date+"T12:00:00").getDate()+" de cada mes."}
              </span>
            </div>
          )}

          {/* Estado de cuenta - 4 column live summary */}
          {pagoTipo==="clases"&&allDates.length>0&&(()=>{
            const qty=parseInt(localClasses)||0;
            let unpaidCount=0;
            const cols4={noPagada:0,pagada:0,programada:0,realizada:0};
            allDates.forEach((d,i)=>{
              if(d.isCancelled) return;
              const alreadyPaid=d.status==="adar"||d.status==="dada";
              const isUnpaid=d.status==="pendiente"||d.status==="dada_unpaid";
              const paidNow=alreadyPaid||(isUnpaid&&unpaidCount<qty);
              if(isUnpaid&&!alreadyPaid){
                if(unpaidCount<qty) unpaidCount++;
              }
              const isPaid=paidNow;
              if(!isPaid) cols4.noPagada++;
              else cols4.pagada++;
              if(d.isGiven) cols4.realizada++;
              else if(!d.isPast&&d.date>=TODAY_DATE) cols4.programada++;
            });
            const cols=[
              {n:cols4.noPagada,label:"No Pagada",color:"#C62828",bg:"#FFEBEE"},
              {n:cols4.pagada,label:"Pagada",color:"#2E7D32",bg:"#EDFBEC"},
              {n:cols4.programada,label:"Programada",color:C.blue2,bg:C.blueL},
              {n:cols4.realizada,label:"Realizada",color:"#555",bg:"#F5F5F5"},
            ];
            return (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:16}}>
                {cols.map((col,i)=>(
                  <div key={i} style={{background:col.bg,borderRadius:12,padding:"10px 4px",textAlign:"center"}}>
                    <div style={{fontSize:24,fontWeight:900,color:col.color,lineHeight:1}}>{col.n}</div>
                    <div style={{fontSize:9,fontWeight:700,color:col.color,marginTop:3,lineHeight:1.2}}>{col.label}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Enviar recordatorio */}
          <div style={{marginBottom:16}}>
            <button onClick={()=>setShowRecordatorioPago(true)} style={{width:"100%",padding:"10px",borderRadius:10,border:"1.5px solid #65CE5A",background:C.white,color:"#2E7D32",fontSize:12,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2E7D32" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
              Enviar Recordatorio
            </button>
          </div>

          {/* Fields */}
          {pagoTipo==="clases"?(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#1565C0",marginBottom:6}}>¿Cuántas clases pagamos?</div>
                {(()=>{
                  // Count total unpaid across ALL combos
                  const totalUnpaidAll=allCombos.filter(c=>c.total>0).reduce((sum,c)=>{
                    const pc=c.paidCount!==undefined?c.paidCount:(c.paid?c.total:0);
                    return sum+Math.max(0,(c.total||0)-pc);
                  },0);
                  const maxUnpaid=totalUnpaidAll>0?totalUnpaidAll:20;                  return (
                    <div style={{display:"flex",alignItems:"center",background:C.blueL,borderRadius:12,overflow:"hidden"}}>
                      <button onClick={()=>setLocalClasses(Math.max(0,(parseInt(localClasses)||0)-1))} style={{width:44,height:46,border:"none",background:"#2C5EF7",color:"#fff",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>◀</button>
                      <div style={{flex:1,textAlign:"center",fontSize:22,fontWeight:800,color:"#1A237E"}}>{parseInt(localClasses)||0}</div>
                      <button onClick={()=>setLocalClasses(Math.min(maxUnpaid,(parseInt(localClasses)||0)+1))} style={{width:44,height:46,border:"none",background:"#2C5EF7",color:"#fff",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>▶</button>
                    </div>
                  );
                })()}
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#1565C0",marginBottom:6}}>Monto (₲)</div>
                <MoneyInput value={parseInt(localAmount)||0} onChange={v=>setLocalAmount(v)} placeholder="0" style={iSp}/>
              </div>
            </div>
          ):(
            <div style={{marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:"#1565C0",marginBottom:6}}>Monto (₲)</div>
              <MoneyInput value={parseInt(localAmount)||0} onChange={v=>setLocalAmount(v)} placeholder="0" style={iSp}/>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            {pagoTipo==="mensual"&&(
              <div style={{gridColumn:"1/-1"}}>
                <div style={{fontSize:12,fontWeight:700,color:C.blue2,marginBottom:6}}>📅 Inicio de pago mensual</div>
                <input type="date" value={localDate||TODAY_DATE} onChange={e=>setLocalDate(e.target.value)} style={{...iSp,cursor:"pointer",width:"100%",boxSizing:"border-box",borderColor:C.blue2}}/>
                <div style={{fontSize:11,color:C.mutedDark,marginTop:4}}>Se usa para calcular días de atraso en Cobros</div>
              </div>
            )}
            {pagoTipo==="mensual"&&(
              <div style={{gridColumn:"1/-1"}}>
                <div style={{fontSize:12,fontWeight:700,color:C.blue2,marginBottom:6}}>📆 ¿Por qué mes es este pago?</div>
                <select value={localPayMonth||""} onChange={e=>setLocalPayMonth(e.target.value)} style={{...iSp,cursor:"pointer",width:"100%",boxSizing:"border-box"}}>
                  {(()=>{
                    const mN=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
                    const opts=[];
                    const now=new Date();
                    for(let i=-2;i<=2;i++){
                      const d=new Date(now.getFullYear(),now.getMonth()+i,1);
                      const val=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
                      opts.push(<option key={val} value={val}>{mN[d.getMonth()]+" "+d.getFullYear()}</option>);
                    }
                    return opts;
                  })()}
                </select>
              </div>
            )}
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#1565C0",marginBottom:6}}>{pagoTipo==="mensual"?"Fecha de pago":"Fecha de pago"}</div>
              <input type="date" value={localPayDate||TODAY_DATE} onChange={e=>setLocalPayDate(e.target.value)} style={{...iSp,cursor:"pointer"}}/>
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#1565C0",marginBottom:6}}>Forma de pago</div>
              <select value={payMethod} onChange={e=>setPayMethod(e.target.value)} style={{...iSp,cursor:"pointer"}}>
                <option value="efectivo">💵 Efectivo</option>
                <option value="transferencia">🏦 Transferencia</option>
                <option value="tarjeta">💳 Tarjeta</option>
              </select>
            </div>
          </div>
        </div>

        {/* Fechas de clase list - show all until full cycle closes */}
        {pagoTipo==="clases"&&(()=>{
          const lastComboDate=allDates.length>0?allDates[allDates.length-1].date:"";
          const allPaid=allDates.every(d=>d.status==="dada"||d.status==="adar"||d.isCancelled);
          const lastDatePassed=lastComboDate&&lastComboDate<TODAY_DATE;
          // Show ALL dates until every combo cycle is closed
          const activeDates=allPaid&&lastDatePassed?[]:allDates;
          const hasNew=parseInt(localClasses)>0;
          // Fallback when all combos are fully paid and realized
          if(activeDates.length===0&&!hasNew){
            const totalPaid=allCombos.reduce((sum,c)=>sum+(c.paidCount||0),0);
            const totalClasses=allCombos.reduce((sum,c)=>sum+(c.total||0),0);
            const allComplete=totalPaid>0&&totalPaid>=totalClasses;
            return (
              <div style={{padding:"0 20px 16px",textAlign:"center"}}>
                <div style={{fontSize:11,fontWeight:700,color:"#5C7A9F",letterSpacing:0.5,marginBottom:12}}>FECHAS DE CLASE</div>
                {allComplete?(
                  <div style={{padding:"20px",borderRadius:16,background:"#EDFBEC",border:"1.5px solid #66BB6A"}}>
                    <div style={{fontSize:28}}>✅</div>
                    <div style={{fontSize:15,fontWeight:800,color:"#2E7D32",marginTop:8}}>No hay clases pendientes</div>
                    <div style={{fontSize:12,color:"#4CAF50",marginTop:4}}>{totalPaid} clases pagadas · {totalClasses} realizadas</div>
                  </div>
                ):(
                  <div style={{padding:"20px",borderRadius:16,background:C.blueL,border:"1.5px solid "+C.border}}>
                    <div style={{fontSize:13,color:C.mutedDark}}>No hay clases pendientes</div>
                  </div>
                )}
              </div>
            );
          }
          return (
          <div style={{padding:"0 20px 16px"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#5C7A9F",letterSpacing:0.5,marginBottom:8}}>FECHAS DE CLASE</div>
            {activeDates.map((item,i)=>{
              const qty=parseInt(localClasses)||0;
              const isCancelled=item.isCancelled||false;
              const isRescheduled=item.isRescheduled||false;
              const wasAbsent=item.wasAbsent||false;
              const wasAusenteDada=item.wasAusenteDada||false;
              const wasAusenteReprog=item.wasAusenteReprog||false;
              // Cancelled dates are never counted as payable
              const unpaidBefore=activeDates.slice(0,i).filter(d=>
                (d.status==="pendiente"||d.status==="dada_unpaid")&&!d.isCancelled
              ).length;
              const isUnpaid=item.status==="pendiente"||item.status==="dada_unpaid";
              const alreadyPaid=item.status==="adar"||item.status==="dada";
              const isCancelledItem=item.isCancelled||false;
              const isReprogWithDateItem=item.isReprogWithDate||false;
              const isReprogNoDateItem=item.isReprogNoDate||false;
              const isPausedItem=item.isPaused||false;
              const isPaidNow=!isCancelledItem&&!isReprogNoDateItem&&!isPausedItem&&(alreadyPaid||(isUnpaid&&unpaidBefore<qty));
              const isPaid=!isReprogNoDateItem&&!isPausedItem&&(alreadyPaid||isPaidNow);
              const isGiven=item.isGiven||item.status==="dada_unpaid"||item.status==="dada";
              // Class status label (left badge)
              let leftBg,leftColor,leftLabel;
              if(isPausedItem){leftBg="#FFF3E0";leftColor="#E65100";leftLabel="⏸ Pausada";}
              else if(isCancelledItem){leftBg="#FFF0F0";leftColor="#C62828";leftLabel="⛔ Cancelada";}
              else if(isReprogWithDateItem){leftBg="#E8F5E9";leftColor="#2E7D32";leftLabel="🔄 Reprogramada";}
              else if(isReprogNoDateItem){leftBg="#E3F2FD";leftColor="#1565C0";leftLabel="🕐 A Reprogramar";}
              else if(wasAusenteReprog){leftBg="#E8EAF6";leftColor="#3949AB";leftLabel="↩ A Reprogramar";}
              else if(wasAusenteDada){leftBg="#FFF3E0";leftColor="#E65100";leftLabel="🚫 Ausente (Dada)";}
              else if(wasAbsent){leftBg="#FFF3E0";leftColor="#E65100";leftLabel="🚫 Ausente";}
              else if(isGiven){leftBg="#E8F5E9";leftColor="#2E7D32";leftLabel="✓ Realizada";}
              else{leftBg="#FFF8E1";leftColor="#F57F17";leftLabel="Programada";}
              // Payment badge
              const rightBg=isPausedItem?"#FFF3E0":isPaid?"#E8F5E9":"#FFEBEE";
              const rightColor=isPausedItem?"#E65100":isPaid?"#2E7D32":"#C62828";
              const rightLabel=isPausedItem?"⏸ Pausada":isPaid?"✓ Pagada":"No Pagada";
              return (
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid #E3F2FD"}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:isPausedItem?"#FFF3E0":isCancelledItem?"#FFF0F0":isReprogWithDateItem?"#E8F5E9":isReprogNoDateItem?"#E3F2FD":C.blueL,border:"2px solid "+(isPausedItem?"#E65100":isCancelledItem?"#C62828":isReprogWithDateItem?"#2E7D32":isReprogNoDateItem?"#1565C0":"#1976D2"),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <span style={{fontSize:11,fontWeight:800,color:isPausedItem?"#E65100":isCancelledItem?"#C62828":isReprogWithDateItem?"#2E7D32":isReprogNoDateItem?"#1565C0":C.blue2}}>{i+1}</span>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#1A237E"}}>{formatDate(item.date)}</div>
                    {isReprogWithDateItem&&item.rescheduledTo&&<div style={{fontSize:10,color:"#2E7D32",marginTop:1}}>→ {formatDate(item.rescheduledTo)}</div>}
                  </div>
                  <span style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:leftBg,color:leftColor,fontWeight:700,flexShrink:0}}>{leftLabel}</span>
                  <span style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:rightBg,color:rightColor,fontWeight:700,flexShrink:0}}>{rightLabel}</span>
                </div>
              );
            })}
            {/* New projected dates — only when existing combo is paid (cycle closed) */}
            {parseInt(localClasses)>0&&lastCombo?.paid&&projDates.map((item,i)=>(
              <div key={"p"+i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #E3F2FD"}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:"#E8F5E9",border:"2px solid #43A047",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:11,fontWeight:800,color:"#43A047"}}>{activeDates.length+i+1}</span>
                </div>
                <div style={{flex:1,fontSize:13,fontWeight:600,color:"#1A237E"}}>{formatDate(item.date)}</div>
                <span style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:"#E8F5E9",color:"#2E7D32",fontWeight:700,flexShrink:0}}>Reservada</span>
                <span style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:"#E8F5E9",color:"#2E7D32",fontWeight:700,flexShrink:0}}>Pagada</span>
              </div>
            ))}
          </div>
        );
        })()}

        <div style={{padding:"0 20px 32px",display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:"14px",borderRadius:14,border:"1.5px solid rgba(21,101,192,0.12)",background:"#FFFFFF",cursor:"pointer",fontSize:14,color:"#5C7A9F",fontWeight:700}}>Cancelar</button>
          <button onClick={handleConfirm} style={{flex:2,padding:"14px",borderRadius:14,border:"none",background:(parseInt(localClasses)>0&&parseInt(localAmount)>0)||(pagoTipo==="mensual"&&parseInt(localAmount)>0)?"linear-gradient(135deg,#52C048,#65CE5A)":"#CBD5E0",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800}}>✓ Confirmar pago</button>
        </div>
      </div>
      {showRecordatorioPago&&<RecordatorioModal student={s} onClose={()=>setShowRecordatorioPago(false)} sendNotification={sendNotification} getRem={()=>getRem(s,classes)} getCombo={()=>getCombo(s)}/>}
    </div>
  );
}

function RecordatorioModal({ student:s, onClose, sendNotification, getRem, getCombo }) {
  const rem=getRem();
  const combo=getCombo();
  const defaultMsg=combo?.total===null
    ? s.name+", te recordamos que tu pago mensual está pendiente. Por favor regularizá tu situación a la brevedad. Gracias!"
    : s.name+", te recordamos que tenés "+Math.abs(rem||0)+" clase"+(Math.abs(rem||0)!==1?"s":"")+" pendientes de pago. Por favor regularizá tu situación a la brevedad. Gracias!";
  const [msg,setMsg]=useState(defaultMsg);
  const handleWhatsApp=()=>{
    const phone=(s.phone||"").replace(/\D/g,"");
    const url=phone
      ? "https://wa.me/"+phone+"?text="+encodeURIComponent(msg)
      : "https://wa.me/?text="+encodeURIComponent(msg);
    window.open(url,"_blank");
  };
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",zIndex:1099,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px"}} onClick={onClose}>
      <div style={{background:C.white,borderRadius:20,padding:20,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:17,color:C.text}}>Enviar Recordatorio</div>
          <button onClick={onClose} style={{background:C.bg,border:"none",borderRadius:"50%",width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.mutedDark} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={{fontSize:12,color:C.mutedDark,marginBottom:8}}>Podés editar el mensaje antes de enviarlo</div>
        <textarea value={msg} onChange={e=>setMsg(e.target.value)} rows={5} style={{width:"100%",padding:"12px",borderRadius:12,border:"1.5px solid "+C.border,fontSize:14,color:C.text,outline:"none",resize:"none",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.5}}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:14}}>
          <button onClick={handleWhatsApp} style={{padding:"13px",borderRadius:12,border:"none",background:"#25D366",color:"#fff",fontSize:13,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            WhatsApp
          </button>
          <button onClick={()=>{sendNotification&&sendNotification({to:s.id,text:msg,type:"alert",from:"coach",time:"Ahora"});onClose();}} style={{padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",color:"#fff",fontSize:13,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            En la App
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentCard({ student:s, onUpdate, classes, addIncome, packages=[], sendNotification, onAttendance }) {
  const combo=getCombo(s);
  const rem=getRem(s,classes);
  const isExpired=rem!==null&&rem<=0;
  const isWarning=rem!==null&&rem>0&&rem<=2;
  const [showPago,setShowPago]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const [showAtt,setShowAtt]=useState(false);
  const [suspended,setSuspended]=useState(s.suspended||false);
  const toggleSuspended=()=>{
    const newVal=!suspended;
    setSuspended(newVal);
    onUpdate({...s,suspended:newVal});
  };
  const [histTab,setHistTab]=useState(0);
  const [showComprobante,setShowComprobante]=useState(null);
  const [showRecordatorio,setShowRecordatorio]=useState(false);
  const DAY_MAP={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
  const myClassesH=classes.filter(c=>c.students&&c.students.includes(s.id));
  const classDays=myClassesH.length>0?myClassesH[0].days:[];
  const classTime=myClassesH.length>0?myClassesH[0].time:"";
  const classCourt=myClassesH.length>0?myClassesH[0].court:"";
  const [newClasses,setNewClasses]=useState(combo?.total||8);
  const [newAmount,setNewAmount]=useState(combo?.amount||400000);
  const [newDate,setNewDate]=useState("");

  const attLogs=[];
  classes.forEach(cls=>{
    if(!cls.students||!cls.students.includes(s.id)) return;
    // Show classes with explicit attendance
    const logged=(cls.attendanceLog||[]).filter(entry=>
      entry.present&&entry.present.includes(s.id)||
      entry.ausente_dada&&entry.ausente_dada.includes(s.id)
    );
    logged.forEach(entry=>{
      const d=new Date(entry.date+"T12:00:00");
      const isAusenteDada=entry.ausente_dada&&entry.ausente_dada.includes(s.id);
      attLogs.push({date:entry.date,day:entry.day||"",month:MONTHS[d.getMonth()],year:d.getFullYear(),dayNum:d.getDate(),className:cls.title,time:cls.time,status:isAusenteDada?"ausente_dada":"presente"});
    });
    // Also include past classes with NO attendance record (default = present)
    if(cls.date<TODAY_DATE&&!(cls.attendanceLog||[]).find(e=>e.date===cls.date)){
      const d=new Date(cls.date+"T12:00:00");
      const wD=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
      attLogs.push({date:cls.date,day:wD[d.getDay()],month:MONTHS[d.getMonth()],year:d.getFullYear(),dayNum:d.getDate(),className:cls.title,time:cls.time,status:"presente"});
    }
  });
  attLogs.sort((a,b)=>b.date.localeCompare(a.date));
  const byMonth={};
  attLogs.forEach(l=>{const k=l.month+" "+l.year;if(!byMonth[k])byMonth[k]=[];byMonth[k].push(l);});

  return (
    <>
      <WhiteCard style={{marginBottom:12,}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
          <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:C.white,flexShrink:0}}>{s.avatar}</div>
          <div style={{flex:1,textAlign:"left"}}>
            <div style={{fontWeight:900,fontSize:18,color:C.text,lineHeight:1.1,textAlign:"left"}}>{s.name}</div>
            {(classDays.length>0||classTime)&&(
              <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4,flexWrap:"wrap",justifyContent:"flex-start"}}>
                {classDays.map(d=><span key={d} style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:C.blueL,color:C.blue2,fontWeight:600}}>{d}</span>)}
                {classTime&&<span style={{fontSize:12,color:C.mutedDark}}>{classTime}{classCourt?" · "+classCourt:""}</span>}
              </div>
            )}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <button onClick={()=>setShowHistory(true)} style={{background:C.blueL,border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontSize:13,color:C.blue2,fontWeight:700,minWidth:90}}>Historial</button>
            <button onClick={()=>setShowAtt(true)} style={{background:C.blueL,border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontSize:13,color:C.blue2,fontWeight:700,minWidth:90}}>Asistencia</button>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <span style={{fontSize:12,padding:"6px 14px",borderRadius:20,background:"#F5F5F5",color:C.text,fontWeight:400}}>
            PAGO: <strong>{combo?.total?combo.total+" clases":combo?.packType==="individual"?"Individual":combo?.packType==="combo"?"Combo":"Mensual"}</strong>
          </span>
          {(()=>{
            const groupNames=[...new Set(classes.filter(c=>(c.students||[]).includes(s.id)).map(c=>c.title))];
            if(groupNames.length===0) return null;
            return <span style={{fontSize:12,padding:"6px 14px",borderRadius:20,background:"#F5F5F5",color:C.text,fontWeight:400}}>GRUPOS: <strong>{groupNames.join(", ")}</strong></span>;
          })()}
        </div>
        {/* ESTADO DE CUENTAS - 4 columns */}
        {combo&&rem!==null&&(()=>{
          // Only count dates from ACTIVE combos (not fully paid+realized)
          const activeCombosForCount=s.combos.filter(c=>{
            if(!(c.total>0||(c.packType&&c.packType!=="mensual"))) return false;
            const paidCount=c.paidCount!==undefined?c.paidCount:(c.paid?c.total:0);
            // Exclude fully paid combos
            if(c.paid&&paidCount>=(c.total||1)) return false;
            return true;
          });
          const allDatesForStudentRaw=activeCombosForCount.flatMap(c=>{
            const dates=[...(c.dates||[])];
            const paidCount=c.paidCount!==undefined?c.paidCount:(c.paid?c.total:0);
            return dates.map((d,idx)=>{
              const clsForDate=myClassesH.find(cls=>cls.date===d);
              const cancelInfo=clsForDate?{cancelled:clsForDate.cancelled,cancelType:clsForDate.cancelType,rescheduledTo:clsForDate.rescheduledTo,paused:clsForDate.paused}:{};
              const isCancelled=!!(cancelInfo.cancelled&&cancelInfo.cancelType==="cancelled");
              const isReprogWithDate=!!(cancelInfo.cancelled&&cancelInfo.cancelType==="cancelled_reprog"&&cancelInfo.rescheduledTo);
              const isReprogNoDate=!!(cancelInfo.cancelled&&cancelInfo.cancelType==="cancelled_reprog"&&!cancelInfo.rescheduledTo);
              const isPaused=!!(cancelInfo.paused||cancelInfo.cancelType==="paused");
              const attEntry=myClassesH.flatMap(cls=>cls.attendanceLog||[]).find(e=>e.date===d);
              const timeEnd=clsForDate?.timeEnd||"23:59";
              const isPaid=idx<paidCount;
              const isDone=isClassDone(d,timeEnd);
              const wasPresent=attEntry?(attEntry.present||[]).includes(s.id):false;
              const wasAusenteDada=attEntry?(attEntry.ausente_dada||[]).includes(s.id):false;
              const isGiven=isPaused?false:isCancelled?true:isReprogWithDate?true:isReprogNoDate?false:attEntry?(wasPresent||wasAusenteDada):isDone;
              return {date:d,isPaid,isGiven,isPast:isDone,isCancelled,isReprogWithDate,isReprogNoDate,isPaused,rescheduledTo:cancelInfo.rescheduledTo||null};
            });
          });
          // Deduplicate by date
          const seenDates=new Set();
          const allDatesForStudent=allDatesForStudentRaw.filter(d=>{
            if(seenDates.has(d.date)) return false;
            seenDates.add(d.date);
            return true;
          });
          const noPagadas=allDatesForStudent.filter(d=>!d.isPaid&&!d.isCancelled&&!d.isReprogNoDate&&!d.isPaused).length;
          const pagadas=allDatesForStudent.filter(d=>d.isPaid&&!d.isCancelled&&!d.isPaused).length;
          const programadas=allDatesForStudent.filter(d=>!d.isGiven&&!d.isPast&&!d.isCancelled&&!d.isReprogWithDate&&!d.isReprogNoDate&&!d.isPaused).length;
          const realizadas=allDatesForStudent.filter(d=>d.isGiven&&!d.isCancelled&&!d.isReprogWithDate&&!d.isPaused).length;
          const canceladas=allDatesForStudent.filter(d=>d.isCancelled).length;
          const reprogramadas=allDatesForStudent.filter(d=>d.isReprogWithDate).length;
          const aReprogramar=allDatesForStudent.filter(d=>d.isReprogNoDate).length;
          const pausadas=allDatesForStudent.filter(d=>d.isPaused).length;
          const cols=[
            {n:noPagadas,label:"No Pagada",color:"#C62828",bg:"#FFEBEE"},
            {n:pagadas,label:"Pagada",color:"#2E7D32",bg:"#EDFBEC"},
            {n:programadas,label:"Programada",color:C.blue2,bg:C.blueL},
            {n:realizadas,label:"Realizada",color:"#555",bg:"#F5F5F5"},
          ];
          const extraCols=[
            canceladas>0&&{n:canceladas,label:"Cancelada",color:"#C62828",bg:"#FFF0F0"},
            reprogramadas>0&&{n:reprogramadas,label:"Reprogramada",color:"#2E7D32",bg:"#E8F5E9"},
            aReprogramar>0&&{n:aReprogramar,label:"A Reprog.",color:"#1565C0",bg:"#E3F2FD"},
            pausadas>0&&{n:pausadas,label:"Pausada",color:"#E65100",bg:"#FFF3E0"},
          ].filter(Boolean);
          const reprogCount=allDatesForStudent.filter(d=>{
            const attEntry=myClassesH.flatMap(cls=>cls.attendanceLog||[]).find(e=>e.date===d.date);
            return attEntry&&(attEntry.ausente_reprog||[]).includes(s.id);
          }).length;
          const cancelledCount=activeCombosForCount.flatMap(c=>c.dates||[]).filter(d=>{
            const cls=myClassesH.find(c=>c.date===d);
            return cls?.cancelled&&!cls?.rescheduled;
          }).length;
          return (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:800,color:C.blue2,letterSpacing:1,marginBottom:8}}>ESTADO DE CUENTAS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:extraCols.length>0?8:0}}>
                {cols.map((col,i)=>(
                  <div key={i} style={{background:col.bg,borderRadius:12,padding:"10px 4px",textAlign:"center"}}>
                    <div style={{fontSize:26,fontWeight:900,color:col.color,lineHeight:1}}>{col.n}</div>
                    <div style={{fontSize:9,fontWeight:700,color:col.color,marginTop:3,lineHeight:1.2}}>{col.label}</div>
                  </div>
                ))}
              </div>
              {extraCols.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat("+extraCols.length+",1fr)",gap:6}}>
                  {extraCols.map((col,i)=>(
                    <div key={i} style={{background:col.bg,borderRadius:12,padding:"8px 4px",textAlign:"center"}}>
                      <div style={{fontSize:20,fontWeight:900,color:col.color,lineHeight:1}}>{col.n}</div>
                      <div style={{fontSize:9,fontWeight:700,color:col.color,marginTop:3,lineHeight:1.2}}>{col.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Mensual estado */}
        {combo&&rem===null&&(()=>{
          const lastDate=combo?.payDate||combo?.date||TODAY_DATE;
          const lastPay=new Date(lastDate+"T12:00:00");
          const today=new Date(TODAY_DATE+"T12:00:00");
          const isPaid=combo?.paid===true;
          const nextDue=isPaid?new Date(lastPay.getFullYear(),lastPay.getMonth()+1,lastPay.getDate()):lastPay;
          const diffDays=Math.floor((today-nextDue)/(1000*60*60*24))+1;
          const overdue=!isPaid||diffDays>0;
          return (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:800,color:C.blue2,letterSpacing:1,marginBottom:8}}>ESTADO DE CUENTAS</div>
              <div style={{background:overdue?"#FFEBEE":"#EDFBEC",borderRadius:12,padding:"12px 16px",textAlign:"center"}}>
                {overdue?<><div style={{fontSize:36,fontWeight:900,color:"#C62828",lineHeight:1}}>{diffDays}</div><div style={{fontSize:12,fontWeight:700,color:"#C62828",marginTop:2}}>días vencido</div></>
                :<><div style={{fontSize:16,fontWeight:900,color:"#43A047"}}>Pago al Día ✓</div></>}
              </div>
            </div>
          );
        })()}

        {/* Action buttons - horizontal */}
        {(()=>{
          // Check if renewal button should show
          const classCombos=(s.combos||[]).filter(c=>c.total>0||(c.packType&&c.packType!=="mensual"&&c.packType!=="individual"));
          const lastComboS=classCombos.slice(-1)[0];
          const showRenewal=lastComboS&&(()=>{
            const paidCount=lastComboS.paidCount!==undefined?lastComboS.paidCount:(lastComboS.paid?lastComboS.total:0);
            const fullyPaid=paidCount>=(lastComboS.total||1);
            if(!fullyPaid) return false; // don't show if unpaid classes remain
            const allDates=lastComboS.dates||[];
            const futureDates=allDates.filter(d=>d>=TODAY_DATE);
            // Show renewal if: all dates in the past, OR 2 or fewer future dates remain
            if(futureDates.length===0) return true; // combo period ended
            return futureDates.length<=2;
          })();
          // Mensual renewal
          const isMensualCombo=combo&&(combo.total===null&&combo.packType!=="individual")||(combo?.packType==="mensual");
          const showMensualRenewal=isMensualCombo&&combo?.paid===true&&(()=>{
            const lastDate=combo?.payDate||combo?.date||TODAY_DATE;
            const lastPay=new Date(lastDate+"T12:00:00");
            const nextDue=new Date(lastPay.getFullYear(),lastPay.getMonth()+1,lastPay.getDate());
            const today=new Date(TODAY_DATE+"T12:00:00");
            const daysLeft=Math.floor((nextDue-today)/(1000*60*60*24));
            return daysLeft>=0&&daysLeft<=5;
          })();
          const handleRenew=()=>{
            if(lastComboS){
              // Generate next dates after last combo date
              const lastDate=lastComboS.dates&&lastComboS.dates.length>0?lastComboS.dates[lastComboS.dates.length-1]:TODAY_DATE;
              const clsDays=myClassesH.length>0?myClassesH[0].days:[];
              const DAY_MAP={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
              const dowSet=new Set(clsDays.map(d=>DAY_MAP[d]));
              const nextDates=[];
              let cur=new Date(lastDate+"T12:00:00");
              cur.setDate(cur.getDate()+1);
              while(nextDates.length<lastComboS.total){
                if(dowSet.size===0||dowSet.has(cur.getDay())){
                  nextDates.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
                }
                cur.setDate(cur.getDate()+1);
              }
              const newCombo={id:(s.combos||[]).length+1,total:lastComboS.total,packType:lastComboS.packType||"combo",used:0,paid:false,paidCount:0,date:nextDates[0]||TODAY_DATE,amount:lastComboS.amount,dates:nextDates,payments:[]};
              onUpdate({...s,combos:[...(s.combos||[]),newCombo]});
            }
          };
          return (
        <div style={{display:"flex",gap:8,flexDirection:"column"}}>
          {(showRenewal||showMensualRenewal)&&(
            <button onClick={handleRenew} style={{padding:"11px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#1565C0,#1976D2)",color:"#fff",fontSize:13,cursor:"pointer",fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              🔄 Renovar combo
            </button>
          )}
          {!combo?(
            <button onClick={()=>setShowPago(true)} style={{padding:"12px",borderRadius:12,border:"2px dashed "+C.blue2,background:C.blueL,color:C.blue2,fontSize:13,cursor:"pointer",fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Asignar paquete
            </button>
          ):(
            <button onClick={()=>setShowPago(true)} style={{padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#52C048,#65CE5A)",color:"#fff",fontSize:14,cursor:"pointer",fontWeight:800}}>Actualizar Pagos</button>
          )}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setShowRecordatorio(true)} style={{flex:1,padding:"10px",borderRadius:10,border:"1.5px solid #65CE5A",background:C.white,color:"#2E7D32",fontSize:12,cursor:"pointer",fontWeight:700}}>Enviar Recordatorio</button>
          </div>
        </div>
          );
        })()}
      </WhiteCard>

      {showPago&&<PagoModal s={s} combo={combo} newClasses={newClasses} setNewClasses={setNewClasses} newAmount={newAmount} setNewAmount={setNewAmount} newDate={newDate} setNewDate={setNewDate} onClose={()=>setShowPago(false)} onUpdate={onUpdate} classes={classes} addIncome={addIncome} packages={packages} sendNotification={sendNotification}/>}

      {showHistory&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:999,display:"flex",flexDirection:"column",background:C.bg}}>
          {/* Header */}
          <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"14px 16px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
            <button onClick={()=>setShowHistory(false)} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.white,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
            <div style={{flex:1}}><div style={{fontWeight:800,fontSize:16,color:C.white}}>Historial de Pagos</div><div style={{fontSize:12,color:C.muted}}>{s.name}</div></div>
          </div>
          {/* Body: vertical tabs left + detail right */}
          <div style={{flex:1,display:"flex",overflow:"hidden"}}>
            {/* Left tabs - one per payment transaction */}
            <div style={{width:110,borderRight:"1px solid "+C.border,overflowY:"auto",background:C.white,flexShrink:0}}>
              {(()=>{
                const allPayments=s.combos.flatMap(c=>(c.payments||[]).map(p=>({...p,comboTotal:c.total})));
                if(allPayments.length===0) return <div style={{padding:12,fontSize:11,color:C.mutedDark,textAlign:"center"}}>Sin pagos</div>;
                return [...allPayments].reverse().map((p,i)=>{
                  const idx=allPayments.length-1-i;
                  const isActive=histTab===idx;
                  const d=new Date((p.date||"2026-01-01")+"T12:00:00");
                  const mN=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
                  return (
                    <div key={idx} onClick={()=>setHistTab(idx)} style={{padding:"12px 10px",borderBottom:"1px solid "+C.border,cursor:"pointer",background:isActive?"linear-gradient(135deg,#0D1B4B,#1A3DB5)":C.white,borderLeft:isActive?"3px solid "+C.blue2:"3px solid transparent"}}>
                      <div style={{fontSize:11,fontWeight:800,color:isActive?C.white:C.text}}>{d.getDate()+" "+mN[d.getMonth()]}</div>
                      <div style={{fontSize:10,color:isActive?"rgba(255,255,255,0.8)":C.mutedDark,marginTop:2}}>{p.comboTotal===null?(p.payMonth?(["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][parseInt(p.payMonth?.split("-")[1])-1]+" "+p.payMonth?.split("-")[0]):"Mensual"):p.qty+" clase"+(p.qty>1?"s":"")}</div>
                      <div style={{marginTop:4,width:8,height:8,borderRadius:"50%",background:"#43A047"}}></div>
                    </div>
                  );
                });
              })()}
            </div>
            {/* Right detail */}
            <div style={{flex:1,overflowY:"auto",padding:16}}>
              {(()=>{
                const allPayments=s.combos.flatMap(c=>(c.payments||[]).map(p=>({...p,comboTotal:c.total})));
                if(allPayments.length===0) return <div style={{textAlign:"center",padding:"40px 0",color:C.mutedDark}}>Sin historial de pagos</div>;
                const p=allPayments[histTab]||allPayments[allPayments.length-1];
                const wDFull=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
                const mNShort=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
                const fmtDate=(ds)=>{const d=new Date(ds+"T12:00:00");return wDFull[d.getDay()]+" "+d.getDate()+" "+mNShort[d.getMonth()];};
                const methodLabel={"efectivo":"💵 Efectivo","transferencia":"🏦 Transferencia","tarjeta":"💳 Tarjeta"};
                return (
                  <>
                    <WhiteCard style={{marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                        <div style={{fontSize:15,fontWeight:800,color:C.text}}>{"📦 "+p.qty+" clase"+(p.qty>1?"s":"")+" pagadas"}</div>
                        <button onClick={()=>setShowComprobante({...p,studentName:s.name})} style={{background:C.blueL,border:"1px solid "+C.border,borderRadius:10,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                          <span style={{fontSize:11,fontWeight:700,color:C.blue2}}>Compartir</span>
                        </button>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        {[
                          {l:"Fecha de pago",v:fmtDate(p.date||TODAY_DATE)},
                          {l:"Monto",v:fmtMoneyShort(p.amount)},
                          {l:"Forma de pago",v:methodLabel[p.method]||"💵 Efectivo"},
                          {l:"Estado",v:"✓ Pagado"},
                        ].map(f=>(
                          <div key={f.l}>
                            <div style={{fontSize:10,fontWeight:700,color:C.mutedDark,marginBottom:3}}>{f.l.toUpperCase()}</div>
                            <div style={{fontSize:13,fontWeight:700,color:f.l==="Estado"?C.green:C.text}}>{f.v}</div>
                          </div>
                        ))}
                      </div>
                    </WhiteCard>
                    {p.dates&&p.dates.length>0&&p.qty>0?(
                      <WhiteCard>
                        <div style={{fontSize:12,fontWeight:700,color:C.mutedDark,marginBottom:10}}>FECHAS DE CLASE</div>
                        {p.dates.map((ds,i)=>(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:i<p.dates.length-1?"1px solid "+C.border:"none"}}>
                            <div style={{width:26,height:26,borderRadius:"50%",background:C.greenL,border:"2px solid "+C.green,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:C.green,flexShrink:0}}>{i+1}</div>
                            <div style={{flex:1,fontSize:12,fontWeight:600,color:C.text}}>{fmtDate(ds)}</div>
                            <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:C.greenL,color:C.green,fontWeight:700}}>Pagada</span>
                          </div>
                        ))}
                      </WhiteCard>
                    ):(!p.qty||p.qty===0)&&p.date?(
                      <WhiteCard>
                        <div style={{fontSize:12,fontWeight:700,color:C.mutedDark,marginBottom:10}}>FECHA DE PAGO</div>
                        <div style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0"}}>
                          <div style={{width:26,height:26,borderRadius:"50%",background:C.greenL,border:"2px solid "+C.green,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:C.green,flexShrink:0}}>✓</div>
                          <div style={{flex:1,fontSize:13,fontWeight:700,color:C.text}}>{fmtDate(p.date)}</div>
                          <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:C.greenL,color:C.green,fontWeight:700}}>Mensual</span>
                        </div>
                      </WhiteCard>
                    ):null}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Recordatorio modal */}
      {showRecordatorio&&<RecordatorioModal student={s} onClose={()=>setShowRecordatorio(false)} sendNotification={sendNotification} getRem={()=>getRem(s,classes)} getCombo={()=>getCombo(s)}/>}

      {/* Comprobante de pago */}
      {showComprobante&&(()=>{
        const p=showComprobante;
        const mLabel={"efectivo":"Efectivo","transferencia":"Transferencia","tarjeta":"Tarjeta"};
        const mN=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
        const fmtLong=(ds)=>{const d=new Date(ds+"T12:00:00");return d.getDate()+" de "+mN[d.getMonth()]+" "+d.getFullYear();};
        const handleShare=async()=>{
          try{
            const mN2=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
            const fmtShort=(ds)=>{const d=new Date(ds+"T12:00:00");return d.getDate()+" "+mN2[d.getMonth()];};
            const dates=p.dates||[];
            const canvasH=340+(dates.length>0?40+dates.length*28:0)+60;
            const canvas=document.createElement("canvas");
            canvas.width=600; canvas.height=canvasH;
            const ctx=canvas.getContext("2d");
            // Background
            ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,600,canvasH);
            // Header gradient
            const grad=ctx.createLinearGradient(0,0,600,160);
            grad.addColorStop(0,"#0D1B4B"); grad.addColorStop(1,"#1A3DB5");
            ctx.fillStyle=grad; ctx.fillRect(0,0,600,160);
            // Header text
            ctx.fillStyle="rgba(255,255,255,0.7)"; ctx.font="bold 14px Arial"; ctx.textAlign="center";
            ctx.fillText("COMPROBANTE DE PAGO",300,40);
            ctx.fillStyle="#ffffff"; ctx.font="bold 40px Arial";
            ctx.fillText(fmtMoneyShort(p.amount),300,95);
            ctx.fillStyle="rgba(255,255,255,0.8)"; ctx.font="16px Arial";
            ctx.fillText(fmtLong(p.date||TODAY_DATE),300,130);
            // Body rows
            ctx.textAlign="left";
            const rows=[
              ["ALUMNO", p.studentName],
              ["CLASES", p.qty>0?p.qty+" clase"+(p.qty>1?"s":""):"Plan Mensual"],
              ["FORMA DE PAGO", mLabel[p.method]||"Efectivo"],
              ["MONTO", fmtMoneyShort(p.amount)],
            ];
            rows.forEach((r,i)=>{
              const y=190+i*40;
              ctx.fillStyle="#6B7BAD"; ctx.font="bold 12px Arial"; ctx.fillText(r[0],40,y);
              ctx.fillStyle="#0D1B4B"; ctx.font="bold 15px Arial"; ctx.fillText(r[1],200,y);
              ctx.strokeStyle="#EEF2FF"; ctx.lineWidth=1;
              ctx.beginPath(); ctx.moveTo(40,y+10); ctx.lineTo(560,y+10); ctx.stroke();
            });
            let yOff=350;
            // Dates section
            if(dates.length>0){
              ctx.fillStyle="#6B7BAD"; ctx.font="bold 12px Arial"; ctx.fillText("FECHAS DE CLASE",40,yOff);
              yOff+=20;
              dates.forEach((ds,i)=>{
                ctx.fillStyle="#0D1B4B"; ctx.font="13px Arial";
                ctx.fillText((i+1)+".  "+fmtShort(ds),40,yOff);
                ctx.fillStyle="#43A047"; ctx.font="bold 11px Arial";
                ctx.fillText("Pagada",200,yOff);
                yOff+=28;
              });
            }
            // Confirmed badge
            ctx.fillStyle="#EDFBEC";
            ctx.beginPath(); ctx.roundRect(40,yOff+10,520,50,12); ctx.fill();
            ctx.fillStyle="#2E7D32"; ctx.font="bold 16px Arial"; ctx.textAlign="center";
            ctx.fillText("✓ Pago confirmado",300,yOff+42);
            // Footer
            ctx.fillStyle="#9BACCB"; ctx.font="bold 12px Arial";
            ctx.fillText("izicoach",300,canvasH-20);
            // Share/download
            const url=canvas.toDataURL("image/png");
            if(navigator.share&&navigator.canShare){
              const blob=await(await fetch(url)).blob();
              const file=new File([blob],"comprobante.png",{type:"image/png"});
              if(navigator.canShare({files:[file]})){
                await navigator.share({files:[file],title:"Comprobante de pago"});
                return;
              }
            }
            const a=document.createElement("a");
            a.href=url; a.download="comprobante-"+p.studentName+".png"; a.click();
          }catch(e){
            alert("No se pudo compartir. Intentá de nuevo.");
          }
        };
        return (
          <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.6)",zIndex:1099,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px"}} onClick={()=>setShowComprobante(null)}>
            <div style={{width:"100%",maxWidth:380}} onClick={e=>e.stopPropagation()}>
              <div id="comprobante-card" style={{background:"#fff",borderRadius:20,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
                <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"20px 20px 24px",textAlign:"center"}}>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.7)",letterSpacing:2,marginBottom:6}}>COMPROBANTE DE PAGO</div>
                  <div style={{fontSize:28,fontWeight:900,color:"#fff",marginBottom:4}}>{fmtMoneyShort(p.amount)}</div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,0.8)"}}>{fmtLong(p.date||TODAY_DATE)}</div>
                </div>
                <div style={{padding:20}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,paddingBottom:14,borderBottom:"1px solid #EEF2FF"}}>
                    <div style={{fontSize:12,color:"#6B7BAD",fontWeight:600}}>ALUMNO</div>
                    <div style={{fontSize:14,fontWeight:800,color:"#0D1B4B"}}>{p.studentName}</div>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
                    <div style={{fontSize:12,color:"#6B7BAD",fontWeight:600}}>CLASES</div>
                    <div style={{fontSize:14,fontWeight:700,color:"#0D1B4B"}}>{p.qty>0?p.qty+" clase"+(p.qty>1?"s":""):"Plan Mensual"}</div>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
                    <div style={{fontSize:12,color:"#6B7BAD",fontWeight:600}}>FORMA DE PAGO</div>
                    <div style={{fontSize:14,fontWeight:700,color:"#0D1B4B"}}>{mLabel[p.method]||"Efectivo"}</div>
                  </div>
                  <div style={{background:"#EDFBEC",borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:10,marginTop:16}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:"#65CE5A",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div style={{fontSize:13,fontWeight:700,color:"#2E7D32"}}>Pago confirmado</div>
                  </div>
                  {p.dates&&p.dates.length>0&&(
                    <div style={{marginTop:14}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#6B7BAD",marginBottom:8}}>FECHAS DE CLASE</div>
                      {p.dates.map((ds,i)=>{
                        const d=new Date(ds+"T12:00:00");
                        const mN3=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
                        return (
                          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #EEF2FF"}}>
                            <span style={{fontSize:12,color:"#0D1B4B",fontWeight:600}}>{(i+1)+". "+d.getDate()+" "+mN3[d.getMonth()]}</span>
                            <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:"#EDFBEC",color:"#43A047",fontWeight:700}}>Pagada</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{textAlign:"center",marginTop:16,fontSize:11,color:"#9BACCB",fontWeight:700,letterSpacing:1}}>izicoach</div>
                </div>
              </div>
              <div style={{display:"flex",gap:10,marginTop:12}}>
                <button onClick={()=>setShowComprobante(null)} style={{flex:1,padding:"13px",borderRadius:12,border:"none",background:"rgba(255,255,255,0.2)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:700}}>Cerrar</button>
                <button onClick={handleShare} style={{flex:2,padding:"13px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#2E7D32,#65CE5A)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  Compartir
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showAtt&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:999,display:"flex",flexDirection:"column",background:C.bg}}>
          <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"14px 16px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
            <button onClick={()=>setShowAtt(false)} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:C.white,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
            <div style={{flex:1}}><div style={{fontWeight:800,fontSize:16,color:C.white}}>Registro de Asistencia</div><div style={{fontSize:12,color:C.muted}}>{s.name}</div></div>
            <button onClick={async()=>{
              const mN=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
              const rowH=44; const headerH=130; const footerH=40;
              const canvas=document.createElement("canvas");
              canvas.width=600; canvas.height=headerH+attLogs.length*rowH+footerH+20;
              const ctx=canvas.getContext("2d");
              ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
              // Header
              const grad=ctx.createLinearGradient(0,0,600,headerH);
              grad.addColorStop(0,"#0D1B4B"); grad.addColorStop(1,"#1A3DB5");
              ctx.fillStyle=grad; ctx.fillRect(0,0,600,headerH);
              ctx.fillStyle="#fff"; ctx.font="bold 22px Arial"; ctx.textAlign="left";
              ctx.fillText(s.name,30,45);
              ctx.fillStyle="rgba(255,255,255,0.7)"; ctx.font="14px Arial";
              ctx.fillText("Registro de Asistencia · izicoach",30,70);
              ctx.fillStyle="rgba(255,255,255,0.5)"; ctx.font="12px Arial";
              ctx.fillText("Total: "+attLogs.length+" clases asistidas",30,95);
              // Column headers
              ctx.fillStyle="#EEF2FF"; ctx.fillRect(0,headerH,600,28);
              ctx.fillStyle="#0D1B4B"; ctx.font="bold 11px Arial"; ctx.textAlign="left";
              ctx.fillText("FECHA",30,headerH+19);
              ctx.fillText("DÍA",160,headerH+19);
              ctx.fillText("CLASE",260,headerH+19);
              ctx.fillText("ESTADO",440,headerH+19);
              // Rows
              attLogs.forEach((e,i)=>{
                const y=headerH+28+i*rowH;
                ctx.fillStyle=i%2===0?"#F8F9FF":"#fff"; ctx.fillRect(0,y,600,rowH);
                const d=new Date(e.date+"T12:00:00");
                ctx.fillStyle="#0D1B4B"; ctx.font="13px Arial"; ctx.textAlign="left";
                ctx.fillText(d.getDate()+" "+mN[d.getMonth()]+" "+d.getFullYear(),30,y+26);
                ctx.fillText(e.day||"",160,y+26);
                ctx.fillText((e.className||"").slice(0,22),260,y+26);
                ctx.fillStyle=e.status==="ausente_dada"?"#E65100":"#2E7D32";
                ctx.font="bold 11px Arial";
                ctx.fillText(e.status==="ausente_dada"?"Ausente":"✓ Presente",440,y+26);
                ctx.strokeStyle="#EEF2FF"; ctx.lineWidth=1;
                ctx.beginPath(); ctx.moveTo(0,y+rowH); ctx.lineTo(600,y+rowH); ctx.stroke();
              });
              // Footer
              ctx.fillStyle="#9BACCB"; ctx.font="11px Arial"; ctx.textAlign="center";
              ctx.fillText("izicoach · Generado el "+TODAY_DATE,300,canvas.height-12);
              const a=document.createElement("a");
              a.href=canvas.toDataURL("image/png");
              a.download="asistencia-"+s.name+".png";
              a.click();
            }} style={{background:C.whiteA,border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",color:C.white,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:16}}>
            {attLogs.length===0?(
              <div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontSize:36,marginBottom:8}}>📋</div><div style={{color:C.mutedDark,fontSize:14}}>Sin registros de asistencia aún</div></div>
            ):(
              <div>
                <div style={{background:C.blueL,borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:13,color:C.blue2,fontWeight:700}}>Total clases asistidas</div>
                  <div style={{fontSize:28,fontWeight:800,color:C.blue2}}>{attLogs.length}</div>
                </div>
                {Object.entries(byMonth).map(([month,entries])=>(
                  <div key={month} style={{marginBottom:20}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                      <span style={{background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",color:C.white,padding:"4px 14px",borderRadius:20,fontSize:12,fontWeight:700}}>{month}</span>
                      <span style={{fontSize:12,color:C.mutedDark}}>{entries.length+" clase"+(entries.length>1?"s":"")}</span>
                    </div>
                    {entries.map((e,i)=>(
                      <WhiteCard key={i} style={{marginBottom:8,padding:"12px 14px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:12}}>
                          <div style={{width:44,height:44,borderRadius:12,background:C.blueL,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <div style={{fontSize:18,fontWeight:800,color:C.blue2,lineHeight:1}}>{e.dayNum}</div>
                            <div style={{fontSize:9,color:C.mutedDark,fontWeight:600}}>{e.day.slice(0,3).toUpperCase()}</div>
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700,fontSize:14,color:C.text}}>{e.className}</div>
                            <div style={{fontSize:12,color:C.mutedDark}}>{e.day+" "+e.dayNum+" de "+e.month}</div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:12,fontWeight:600,color:C.blue2}}>{e.time}</div>
                            <span style={{fontSize:10,padding:"2px 6px",borderRadius:10,background:e.status==="ausente_dada"?"#FFF3E0":"#EDFBEC",color:e.status==="ausente_dada"?"#E65100":"#2E7D32",fontWeight:700}}>{e.status==="ausente_dada"?"Ausente":"✓"}</span>
                          </div>
                        </div>
                      </WhiteCard>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function PaymentsTab({ students, onUpdate, classes, addIncome, packages=[], sendNotification, onAttendance }) {
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState("none");
  const allList=students.filter(s=>classes.some(c=>c.students&&c.students.includes(s.id)));
  const uniqueClasses=[...new Set(classes.map(c=>c.title))].sort();
  let list=[...allList];
  if(search.trim()){
    const q=search.toLowerCase();
    list=list.filter(s=>
      s.name.toLowerCase().includes(q)||
      classes.some(c=>(c.students||[]).includes(s.id)&&c.title.toLowerCase().includes(q))
    );
  }
  list=list.sort((a,b)=>{
    const ra=getRem(a,classes);
    const rb=getRem(b,classes);
    const scoreA=ra===null?1:ra<0?-1:ra>0?0:1;
    const scoreB=rb===null?1:rb<0?-1:rb>0?0:1;
    if(scoreA!==scoreB) return scoreA-scoreB;
    if(ra!==null&&rb!==null) return ra-rb;
    return a.name.localeCompare(b.name);
  });
  if(filter==="mora") list=list.filter(s=>{
    if(s.suspended) return false;
    const r=getRem(s,classes);
    const combo=getCombo(s);
    if(r!==null) return r<0;
    if(!combo) return false;
    const lastDate=combo.payDate||combo.date||TODAY_DATE;
    const lastPay=new Date(lastDate+"T12:00:00");
    const today=new Date(TODAY_DATE+"T12:00:00");
    const isPaid=combo.paid===true;
    const nextDue=isPaid?new Date(lastPay.getFullYear(),lastPay.getMonth()+1,lastPay.getDate()):lastPay;
    const diffDays=Math.floor((today-nextDue)/(1000*60*60*24))+1;
    return !isPaid||diffDays>0;
  });
  // Summary
  const enMora=allList.filter(s=>{if(s.suspended)return false;const r=getRem(s,classes);return r!==null&&r<0;});
  const programadas=allList.filter(s=>{const r=getRem(s,classes);return r!==null&&r>0;}).length;
  const alDia=allList.length-enMora.length-programadas;
  return (
    <div style={{flex:1,overflowY:"auto",padding:"0 16px",paddingBottom:"calc(120px + env(safe-area-inset-bottom, 34px))"}}>
      {allList.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16,marginTop:8}}>
          <div style={{background:"#FFEBEE",borderRadius:14,padding:"12px 10px",textAlign:"center"}}>
            <div style={{fontSize:22,fontWeight:900,color:"#C62828"}}>{enMora.length}</div>
            <div style={{fontSize:10,fontWeight:700,color:"#C62828",marginTop:2}}>EN MORA</div>
          </div>
          <div style={{background:C.blueL,borderRadius:14,padding:"12px 10px",textAlign:"center"}}>
            <div style={{fontSize:22,fontWeight:900,color:C.blue2}}>{programadas}</div>
            <div style={{fontSize:10,fontWeight:700,color:C.blue2,marginTop:2}}>PROGRAMADAS</div>
          </div>
          <div style={{background:"#EDFBEC",borderRadius:14,padding:"12px 10px",textAlign:"center"}}>
            <div style={{fontSize:22,fontWeight:900,color:"#2E7D32"}}>{alDia}</div>
            <div style={{fontSize:10,fontWeight:700,color:"#2E7D32",marginTop:2}}>AL DÍA</div>
          </div>
        </div>
      )}
      <div style={{position:"relative",marginBottom:12}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar alumno o grupo..." style={{width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",background:C.white,color:C.text,outline:"none"}}/>
        {search&&<button onClick={()=>setSearch("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.mutedDark,fontSize:18}}>×</button>}
        {search.trim().length>0&&(()=>{
          const q=search.toLowerCase();
          const studentSugg=allList.filter(s=>s.name.toLowerCase().includes(q)&&s.name.toLowerCase()!==q).slice(0,4);
          const classSugg=uniqueClasses.filter(c=>c.toLowerCase().includes(q)&&c.toLowerCase()!==q).slice(0,3);
          if(studentSugg.length===0&&classSugg.length===0) return null;
          return (
            <div style={{position:"absolute",top:"100%",left:0,right:0,background:C.white,borderRadius:12,border:"1.5px solid "+C.border,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",zIndex:100,overflow:"hidden",marginTop:4}}>
              {studentSugg.map(s=>(
                <div key={s.id} onClick={()=>setSearch(s.name)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",borderBottom:"1px solid "+C.border}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff",flexShrink:0}}>{s.avatar}</div>
                  <span style={{fontSize:13,color:C.text,fontWeight:600}}>{s.name}</span>
                  <span style={{fontSize:11,color:C.mutedDark,marginLeft:"auto"}}>Alumno</span>
                </div>
              ))}
              {classSugg.map(cls=>(
                <div key={cls} onClick={()=>setSearch(cls)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",borderBottom:"1px solid "+C.border}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:"#EEF2FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>👥</div>
                  <span style={{fontSize:13,color:C.text,fontWeight:600}}>{cls}</span>
                  <span style={{fontSize:11,color:C.mutedDark,marginLeft:"auto"}}>Grupo</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[["none","Todos"],["mora","⚠️ En mora"]].map(([k,l])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{padding:"7px 18px",borderRadius:20,border:"1.5px solid "+(filter===k?(k==="mora"?"#FFCDD2":C.blue2):C.border),cursor:"pointer",fontSize:13,fontWeight:600,background:filter===k?(k==="mora"?"#FFEBEE":C.blue2):C.white,color:filter===k?(k==="mora"?"#C62828":C.white):C.mutedDark}}>{l}</button>
        ))}
      </div>
      {list.length===0&&!search&&(
        <div style={{textAlign:"center",padding:"40px 20px",color:C.mutedDark}}>
          <div style={{fontSize:40,marginBottom:12}}>📋</div>
          <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:8}}>No tenés clases creadas aún</div>
          <div style={{fontSize:13,marginBottom:16}}>Creá una clase y asigná alumnos para verlos acá</div>
          <button onClick={()=>document.dispatchEvent(new CustomEvent("izi-nav",{detail:"agenda"}))} style={{padding:"12px 24px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:"#fff",fontSize:14,cursor:"pointer",fontWeight:700}}>
            Ir a Agenda →
          </button>
        </div>
      )}
      {list.map(s=><PaymentCard key={s.id} student={s} onUpdate={onUpdate} classes={classes} addIncome={addIncome} packages={packages} sendNotification={sendNotification} onAttendance={onAttendance}/>)}
    </div>
  );
}

function Finances({ students, classes, initialTab="payments", onUpdate, expenses=[], setExpenses, addIncome, packages=[], sendNotification, onAttendance }) {
  const [tab,setTab]=useState(initialTab);
  const [selMonth,setSelMonth]=useState((()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");})());
  const [showMovModal,setShowMovModal]=useState(null);
  const [movCat,setMovCat]=useState(""); const [movAmount,setMovAmount]=useState(""); const [movDate,setMovDate]=useState("");
  const [editMovId,setEditMovId]=useState(null);
  const [showCatModal,setShowCatModal]=useState(false);
  const [customCats,setCustomCats]=useState([
    {id:1,name:"Canchas",type:"gasto"},{id:2,name:"Equipamiento",type:"gasto"},
    {id:3,name:"Transporte",type:"gasto"},{id:4,name:"Cobros clases",type:"ingreso"},
  ]);
  const [newCatName,setNewCatName]=useState(""); const [newCatType,setNewCatType]=useState("gasto");
  const barC=[C.blue2,C.blue3,"#5C6BC0","#26C6DA"];
  const monthFiltered=expenses.filter(e=>e.date.startsWith(selMonth));
  const income=monthFiltered.filter(e=>e.type==="ingreso").reduce((a,b)=>a+b.amount,0);
  const exp=monthFiltered.filter(e=>e.type==="gasto").reduce((a,b)=>a+b.amount,0);
  const cats=[...new Set(monthFiltered.filter(e=>e.type==="gasto").map(e=>e.category))];
  const [yr,mn]=selMonth.split("-").map(Number);
  const monthLabel=MONTHS[mn-1]+" "+yr;
  const prevMonth=()=>{const d=new Date(yr,mn-2,1);setSelMonth(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"));};
  const nextMonth=()=>{const d=new Date(yr,mn,1);setSelMonth(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"));};
  return (
    <div style={{flex:1,overflowY:"auto",background:C.bg}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"16px 16px 20px",flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:C.white}}>{initialTab==="payments"?"Cobros":"Finanzas"}</div>
            <div style={{fontSize:13,color:C.muted,marginTop:4}}>{initialTab==="payments"?"Estado de cobros por alumno":"Resumen financiero del mes"}</div>
          </div>
          <button onClick={()=>{
            let csv="";
            if(tab==="payments"||initialTab==="payments"){
              // Export cobros by student
              csv="Alumno,Tipo,Total Clases,Pagadas,No Pagadas,Monto,Estado Pago\n";
              students.forEach(s=>{
                const combo=getCombo(s);
                if(!combo) return;
                const paidCount=combo.paidCount||0;
                const total=combo.total||0;
                const unpaid=Math.max(0,total-paidCount);
                csv+='"'+s.name+'","'+(combo.packType||"combo")+'",'+total+','+paidCount+','+unpaid+','+((combo.amount||0))+','+(combo.paid?"Pagado":"Pendiente")+'\n';
              });
              // Add payment history
              csv+="\nHistorial de Pagos\nAlumno,Fecha,Monto,Método,Clases\n";
              students.forEach(s=>{
                (s.combos||[]).forEach(c=>{
                  (c.payments||[]).forEach(p=>{
                    csv+='"'+s.name+'","'+p.date+'",'+p.amount+',"'+(p.method||"")+'",'+p.qty+'\n';
                  });
                });
              });
            } else {
              // Export monthly finances
              csv="Fecha,Tipo,Categoría,Nota,Monto\n";
              monthFiltered.forEach(e=>{
                csv+='"'+e.date+'","'+(e.type==="ingreso"?"Ingreso":"Gasto")+'","'+(e.category||"")+'","'+(e.note||"")+'",'+e.amount+'\n';
              });
              csv+='\n"","","","TOTAL INGRESOS",'+income+'\n';
              csv+='"","","","TOTAL GASTOS",'+exp+'\n';
              csv+='"","","","BALANCE",'+(income-exp)+'\n';
            }
            const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
            const url=URL.createObjectURL(blob);
            const a=document.createElement("a");
            a.href=url;
            a.download=(tab==="payments"?"cobros":"finanzas")+"-"+selMonth+".csv";
            a.click();
            URL.revokeObjectURL(url);
          }} style={{padding:"10px 16px",borderRadius:12,border:"none",background:"rgba(255,255,255,0.2)",color:C.white,fontSize:12,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar
          </button>
        </div>
      </div>
      <div style={{padding:"16px",marginTop:-8}}>
        {tab==="payments"&&<PaymentsTab students={students} onUpdate={onUpdate} classes={classes} addIncome={addIncome} packages={packages} sendNotification={sendNotification} onAttendance={onAttendance}/>}
        {tab==="expenses"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:C.white,borderRadius:14,padding:"12px 16px",marginBottom:14,border:"1px solid "+C.border}}>
              <button onClick={prevMonth} style={{background:C.blueL,border:"none",borderRadius:10,width:34,height:34,cursor:"pointer",color:C.blue2,fontWeight:800,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{"‹"}</button>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:16,fontWeight:800,color:C.text}}>{monthLabel}</div>
                <div style={{fontSize:11,color:C.mutedDark}}>{monthFiltered.length+" movimiento"+(monthFiltered.length!==1?"s":"")}</div>
              </div>
              <button onClick={nextMonth} style={{background:C.blueL,border:"none",borderRadius:10,width:34,height:34,cursor:"pointer",color:C.blue2,fontWeight:800,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{"›"}</button>
            </div>
            {/* Always show the 3 boxes */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div style={{background:"linear-gradient(135deg,#52C048,#65CE5A)",borderRadius:14,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.8)"}}>INGRESOS</div>
                  <button onClick={()=>{setShowMovModal("ingreso");setMovCat("");setMovAmount("");setMovDate("");}} style={{width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,0.25)",border:"none",cursor:"pointer",color:"#fff",fontSize:18,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>+</button>
                </div>
                <div style={{fontSize:income>0?20:13,fontWeight:800,color:C.white}}>{income>0?fmtMoneyShort(income):"Sin ingresos aún"}</div>
              </div>
              <div style={{background:"linear-gradient(135deg,#E53935,#EF5350)",borderRadius:14,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.8)"}}>GASTOS</div>
                  <button onClick={()=>{setShowMovModal("gasto");setMovCat("");setMovAmount("");setMovDate("");}} style={{width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,0.25)",border:"none",cursor:"pointer",color:"#fff",fontSize:18,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>+</button>
                </div>
                <div style={{fontSize:exp>0?20:13,fontWeight:800,color:C.white}}>{exp>0?fmtMoneyShort(exp):"Sin gastos aún"}</div>
              </div>
            </div>
            <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",borderRadius:14,padding:14,marginBottom:14}}>
              <div style={{fontSize:12,color:C.muted}}>{"Balance neto — "+monthLabel}</div>
              <div style={{fontSize:income>0||exp>0?26:14,fontWeight:800,color:C.white}}>{income>0||exp>0?fmtMoneyShort(income-exp):"Sin movimientos aún"}</div>
            </div>
            {monthFiltered.length===0?(
              <div style={{textAlign:"center",padding:"24px 0",color:C.mutedDark,fontSize:13}}>
                <div style={{fontSize:32,marginBottom:8}}>📊</div>
                Sin movimientos en {monthLabel}. Usá los botones + para agregar.
              </div>
            ):cats.length>0&&(()=>{
                  const COLORS=[C.blue2,"#26C6DA","#5C6BC0","#43A047","#FF7043","#AB47BC"];
                  const catData=cats.map((cat,i)=>{
                    const v=monthFiltered.filter(e=>e.category===cat&&e.type==="gasto").reduce((a,b)=>a+b.amount,0);
                    const pct=exp>0?Math.round(v/exp*100):0;
                    return {cat,v,pct,color:COLORS[i%COLORS.length]};
                  });
                  // Build SVG pie
                  const cx=90,cy=90,r=75;
                  let startAngle=-90;
                  const slices=catData.map(d=>{
                    const angle=(d.pct/100)*360;
                    const endAngle=startAngle+angle;
                    const large=angle>180?1:0;
                    const s=startAngle*Math.PI/180;
                    const e=endAngle*Math.PI/180;
                    const x1=cx+r*Math.cos(s); const y1=cy+r*Math.sin(s);
                    const x2=cx+r*Math.cos(e); const y2=cy+r*Math.sin(e);
                    const path=`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`;
                    const mid=(startAngle+angle/2)*Math.PI/180;
                    startAngle=endAngle;
                    return {...d,path,mid};
                  });
                  return (
                    <WhiteCard style={{marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                        <div style={{fontSize:13,fontWeight:700,color:C.text}}>Desglose de gastos</div>
                        <button onClick={()=>setShowCatModal(true)} style={{padding:"5px 12px",borderRadius:20,border:"1.5px solid "+C.blue2,background:C.blueL,color:C.blue2,fontSize:11,cursor:"pointer",fontWeight:700}}>⚙ Categorías</button>
                      </div>
                      {exp>0?(
                        <div style={{display:"flex",alignItems:"center",gap:16}}>
                          {/* Pie chart */}
                          <svg width="180" height="180" viewBox="0 0 180 180" style={{flexShrink:0}}>
                            {catData.length===1?(
                              <circle cx={cx} cy={cy} r={r} fill={catData[0].color}/>
                            ):(
                              slices.map((s,i)=>(
                                <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth="2"/>
                              ))
                            )}
                            <circle cx={cx} cy={cy} r={38} fill="#fff"/>
                            <text x={cx} y={cy-6} textAnchor="middle" fontSize="11" fontWeight="700" fill={C.mutedDark}>GASTOS</text>
                            <text x={cx} y={cy+10} textAnchor="middle" fontSize="13" fontWeight="800" fill={C.text}>{fmtMoneyShort(exp)}</text>
                          </svg>
                          {/* Legend */}
                          <div style={{flex:1}}>
                            {catData.map((d,i)=>(
                              <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                                <div style={{width:10,height:10,borderRadius:2,background:d.color,flexShrink:0}}></div>
                                <div style={{flex:1}}>
                                  <div style={{fontSize:12,fontWeight:600,color:C.text}}>{d.cat}</div>
                                  <div style={{fontSize:11,color:C.mutedDark}}>{fmtMoneyShort(d.v)+" · "+d.pct+"%"}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ):(
                        <div style={{textAlign:"center",padding:"20px 0",color:C.mutedDark,fontSize:13}}>Sin gastos este mes</div>
                      )}
                    </WhiteCard>
                  );
                })()}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,marginTop:6}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>Movimientos</div>
                  <button onClick={async()=>{
                    const [yr2,mn2]=selMonth.split("-").map(Number);
                    const mNames=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
                    const selMonthLabel=mNames[mn2-1]+" "+yr2;
                    const canvas=document.createElement("canvas");
                    const rowH=36; const headerH=120; const footerH=40;
                    canvas.width=800; canvas.height=headerH+sorted.length*rowH+footerH+40;
                    const ctx=canvas.getContext("2d");
                    // Background
                    ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,canvas.width,canvas.height);
                    // Header
                    ctx.fillStyle="#0D1B4B"; ctx.fillRect(0,0,800,headerH);
                    ctx.fillStyle="#ffffff"; ctx.font="bold 24px Arial"; ctx.textAlign="left";
                    ctx.fillText("Reporte de Movimientos",30,45);
                    ctx.font="14px Arial"; ctx.fillStyle="rgba(255,255,255,0.8)";
                    ctx.fillText(selMonthLabel,30,70);
                    // Summary
                    const inc=monthFiltered.filter(e=>e.type==="ingreso").reduce((a,e)=>a+e.amount,0);
                    const exp=monthFiltered.filter(e=>e.type==="gasto").reduce((a,e)=>a+e.amount,0);
                    ctx.font="bold 13px Arial"; ctx.fillStyle="#65CE5A";
                    ctx.fillText("Ingresos: "+fmtMoneyShort(inc),30,95);
                    ctx.fillStyle="#EF5350";
                    ctx.fillText("Gastos: "+fmtMoneyShort(exp),220,95);
                    ctx.fillStyle="#fff";
                    ctx.fillText("Balance: "+fmtMoneyShort(inc-exp),410,95);
                    // Column headers
                    ctx.fillStyle="#EEF2FF"; ctx.fillRect(0,headerH,800,30);
                    ctx.fillStyle="#0D1B4B"; ctx.font="bold 12px Arial";
                    ctx.fillText("FECHA",20,headerH+20);
                    ctx.fillText("CATEGORÍA",120,headerH+20);
                    ctx.fillText("NOTA",360,headerH+20);
                    ctx.fillText("TIPO",560,headerH+20);
                    ctx.textAlign="right"; ctx.fillText("MONTO",780,headerH+20);
                    // Rows
                    sorted.forEach((e,i)=>{
                      const y=headerH+30+i*rowH;
                      ctx.fillStyle=i%2===0?"#F8F9FF":"#ffffff"; ctx.fillRect(0,y,800,rowH);
                      ctx.fillStyle="#0D1B4B"; ctx.font="13px Arial"; ctx.textAlign="left";
                      ctx.fillText(e.date,20,y+22);
                      ctx.fillText(e.category.slice(0,28),120,y+22);
                      ctx.fillText((e.note||"").slice(0,25),360,y+22);
                      ctx.fillStyle=e.type==="ingreso"?"#2E7D32":"#C62828";
                      ctx.font="bold 12px Arial";
                      ctx.fillText(e.type==="ingreso"?"↑ Ingreso":"↓ Gasto",560,y+22);
                      ctx.textAlign="right";
                      ctx.fillText((e.type==="ingreso"?"+":"-")+fmtMoneyShort(e.amount),780,y+22);
                      // Divider
                      ctx.strokeStyle="#EEF2FF"; ctx.lineWidth=1;
                      ctx.beginPath(); ctx.moveTo(0,y+rowH); ctx.lineTo(800,y+rowH); ctx.stroke();
                    });
                    // Footer
                    const fy=headerH+30+sorted.length*rowH+10;
                    ctx.fillStyle="#9BACCB"; ctx.font="11px Arial"; ctx.textAlign="center";
                    ctx.fillText("izicoach · Generado el "+TODAY_DATE,400,fy+20);
                    // Download
                    const a=document.createElement("a");
                    a.href=canvas.toDataURL("image/png");
                    a.download="movimientos-"+selMonthLabel+".png";
                    a.click();
                  }} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:10,border:"1px solid "+C.border,background:C.white,cursor:"pointer",fontSize:12,color:C.blue2,fontWeight:700}}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Exportar
                  </button>
                </div>
                {[...monthFiltered].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>(
                  <WhiteCard key={e.id} style={{marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <div style={{width:40,height:40,borderRadius:12,background:e.type==="ingreso"?"linear-gradient(135deg,#52C048,#65CE5A)":"linear-gradient(135deg,#E53935,#EF5350)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:C.white,flexShrink:0}}>{e.type==="ingreso"?"↑":"↓"}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:700,color:C.text}}>{e.category}</div>
                        <div style={{fontSize:11,color:C.mutedDark}}>{e.date}{e.note?" · "+e.note:""}{e.detail?" · "+e.detail:""}</div>
                      </div>
                      <div style={{fontWeight:800,color:e.type==="ingreso"?"#2E7D32":"#C62828",fontSize:14,marginRight:8}}>{(e.type==="ingreso"?"+":"-")+fmtMoneyShort(e.amount)}</div>
                      <div style={{display:"flex",gap:4}}>
                        <button onClick={()=>{
                          setShowMovModal(e.type);
                          setMovCat(e.category);
                          setMovAmount(String(e.amount));
                          setMovDate(e.date);
                          setEditMovId(e.id);
                        }} style={{width:30,height:30,borderRadius:8,border:"none",background:C.blueL,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.blue2} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button onClick={()=>setExpenses(p=>p.filter(x=>x.id!==e.id))} style={{width:30,height:30,borderRadius:8,border:"none",background:"#FFEBEE",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                        </button>
                      </div>
                    </div>
                  </WhiteCard>
                ))}
          </div>
        )}
      </div>
      {showCatModal&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:999,display:"flex",alignItems:"flex-end"}}>
          <div style={{background:C.white,borderRadius:"24px 24px 0 0",padding:"24px 20px 32px",width:"100%",maxHeight:"85%",overflowY:"auto",boxSizing:"border-box"}}>
            <div style={{fontWeight:900,fontSize:20,color:C.text,marginBottom:20}}>Gestionar Categorías</div>
            <div style={{marginBottom:16}}>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                {[["gasto","💸 Gasto"],["ingreso","💰 Ingreso"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setNewCatType(k)} style={{flex:1,padding:"9px",borderRadius:12,border:"2px solid "+(newCatType===k?(k==="gasto"?"#E53935":C.green):C.border),background:newCatType===k?(k==="gasto"?"#FFEBEE":C.greenL):C.white,color:newCatType===k?(k==="gasto"?"#C62828":C.green):C.mutedDark,fontSize:13,cursor:"pointer",fontWeight:700}}>{l}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:8}}>
                <input value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="Nueva categoría..." style={{flex:1,padding:"12px 14px",borderRadius:12,border:"1.5px solid "+C.border,fontSize:14,background:C.blueL,color:C.text,outline:"none"}}/>
                <button onClick={()=>{if(!newCatName.trim())return;setCustomCats(p=>[...p,{id:Date.now(),name:newCatName.trim(),type:newCatType}]);setNewCatName("");}} style={{padding:"12px 18px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,fontSize:16,cursor:"pointer",fontWeight:800}}>+</button>
              </div>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:C.mutedDark,marginBottom:8}}>💸 GASTOS</div>
            {customCats.filter(c=>c.type==="gasto").map(c=>(
              <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:12,background:"#FFF5F5",border:"1px solid #FFCDD2",marginBottom:6}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:"#E53935",flexShrink:0}}></div>
                <span style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{c.name}</span>
                <button onClick={()=>setCustomCats(p=>p.filter(x=>x.id!==c.id))} style={{background:"#FFEBEE",border:"none",borderRadius:"50%",width:28,height:28,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
            <div style={{fontSize:12,fontWeight:700,color:C.mutedDark,margin:"14px 0 8px"}}>💰 INGRESOS</div>
            {customCats.filter(c=>c.type==="ingreso").map(c=>(
              <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:12,background:C.greenL,border:"1px solid #C8E6C9",marginBottom:6}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:C.green,flexShrink:0}}></div>
                <span style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{c.name}</span>
                <button onClick={()=>setCustomCats(p=>p.filter(x=>x.id!==c.id))} style={{background:"#FFEBEE",border:"none",borderRadius:"50%",width:28,height:28,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#C62828" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
            <button onClick={()=>setShowCatModal(false)} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:C.bg,color:C.mutedDark,fontSize:14,cursor:"pointer",fontWeight:700,marginTop:16}}>Cerrar</button>
          </div>
        </div>
      )}
      {showMovModal&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:999,display:"flex",alignItems:"flex-end"}}>
          <div style={{background:C.white,borderRadius:"24px 24px 0 0",padding:"24px 20px 32px",width:"100%",boxSizing:"border-box"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
              <div style={{width:40,height:40,borderRadius:12,background:showMovModal==="ingreso"?"linear-gradient(135deg,#52C048,#65CE5A)":"linear-gradient(135deg,#E53935,#EF5350)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:C.white}}>{showMovModal==="ingreso"?"↑":"↓"}</div>
              <div style={{fontWeight:900,fontSize:20,color:C.text}}>{editMovId?(showMovModal==="ingreso"?"Editar Ingreso":"Editar Gasto"):(showMovModal==="ingreso"?"Nuevo Ingreso":"Nuevo Gasto")}</div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Categoría</label>
              <input value={movCat} onChange={e=>setMovCat(e.target.value)} placeholder={showMovModal==="ingreso"?"Ej: Cobros clases":"Ej: Canchas"} style={{width:"100%",padding:"13px 16px",borderRadius:12,border:"none",fontSize:14,boxSizing:"border-box",background:C.blueL,color:C.text,outline:"none"}}/>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
                {customCats.filter(c=>c.type===showMovModal).map(c=>(
                  <button key={c.id} onClick={()=>setMovCat(c.name)} style={{padding:"4px 12px",borderRadius:20,border:"1.5px solid "+(movCat===c.name?C.blue2:C.border),background:movCat===c.name?C.blueL:C.white,color:movCat===c.name?C.blue2:C.mutedDark,fontSize:12,cursor:"pointer",fontWeight:600}}>{c.name}</button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Monto (₲)</label>
              <MoneyInput value={parseInt(movAmount)||0} onChange={v=>setMovAmount(v)} placeholder="200000" style={{width:"100%",padding:"13px 16px",borderRadius:12,border:"none",fontSize:15,fontWeight:700,boxSizing:"border-box",background:C.blueL,color:C.text,outline:"none"}}/>
            </div>
            <div style={{marginBottom:24}}>
              <label style={{fontSize:13,color:C.blue,fontWeight:700,display:"block",marginBottom:6}}>Fecha</label>
              <input type="date" value={movDate} onChange={e=>setMovDate(e.target.value)} style={{width:"100%",padding:"13px 16px",borderRadius:12,border:"none",fontSize:14,boxSizing:"border-box",background:C.blueL,color:C.text,outline:"none",cursor:"pointer"}}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setShowMovModal(null);setEditMovId(null);setMovCat("");setMovAmount("");setMovDate("");}} style={{flex:1,padding:"14px",borderRadius:14,border:"1.5px solid "+C.border,background:C.white,cursor:"pointer",fontSize:14,color:C.mutedDark,fontWeight:700}}>Cancelar</button>
              <button onClick={()=>{
                if(!movCat.trim()||!movAmount){alert("Completá categoría y monto.");return;}
                const date=movDate||(selMonth+"-01");
                if(editMovId){
                  setExpenses(prev=>prev.map(e=>e.id===editMovId?{...e,category:movCat,amount:parseInt(movAmount),date,type:showMovModal}:e));
                  setEditMovId(null);
                } else {
                  setExpenses(prev=>[...prev,{id:Date.now(),category:movCat,amount:parseInt(movAmount),type:showMovModal,date}]);
                }
                setShowMovModal(null);setMovCat("");setMovAmount("");setMovDate("");
              }} style={{flex:1,padding:"14px",borderRadius:14,border:"none",background:showMovModal==="ingreso"?"linear-gradient(135deg,#52C048,#65CE5A)":"linear-gradient(135deg,#E53935,#EF5350)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800}}>{editMovId?"Actualizar":"Guardar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StudentApp({ student: initialStudent, onExit, classes=[], notifications=[], sendNotification, coachId }) {
  const [tab,setTab]=useState("home");
  const [student,setStudent]=useState(initialStudent);
  const [msg,setMsg]=useState("");
  const [msgs,setMsgs]=useState([]);
  const [alerts,setAlerts]=useState([]);
  const [oldPass,setOldPass]=useState(""); const [newPass,setNewPass]=useState(""); const [newPass2,setNewPass2]=useState("");
  const combo=getCombo(student); const rem=getRem(student);

  // Send message from student to coach
  const send=async()=>{
    if(!msg.trim()||!coachId||!student?.id) return;
    const text=msg.trim();setMsg("");
    await supabase.from("messages").insert({coach_id:coachId,student_id:student.id,text,from_coach:false,is_alert:false});
  };

  // Load messages from Supabase
  useEffect(()=>{
    if(!coachId||!student?.id) return;
    const dismissedKey="izi_dismissed_alerts_"+student.id;
    const dismissed=JSON.parse(localStorage.getItem(dismissedKey)||"[]");
    supabase.from("messages").select("*").eq("coach_id",coachId).eq("student_id",student.id).order("created_at",{ascending:true})
      .then(({data})=>{
        setMsgs(data||[]);
        setAlerts((data||[]).filter(m=>m.is_alert&&m.from_coach&&!dismissed.includes(m.id)).slice(-3).reverse());
      });
    const channel=supabase.channel("student_chat_"+coachId+"_"+student.id)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`coach_id=eq.${coachId}`},(payload)=>{
        if(payload.new.student_id===student.id){
          setMsgs(p=>[...p,payload.new]);
          if(payload.new.is_alert&&payload.new.from_coach) setAlerts(p=>[payload.new,...p].slice(0,3));
        }
      }).subscribe();
    return ()=>supabase.removeChannel(channel);
  },[coachId,student?.id]);
  const saveProfile=async()=>{
    try{
      const cId=coachId||(localStorage.getItem("izi_student_coach_id")?.replace(/"/g,""));
      const studentIdRaw=localStorage.getItem("izi_student_id_raw");
      if(cId&&studentIdRaw){
        const {data}=await supabase.from("coach_data").select("students").eq("coach_id",cId).single();
        if(data?.students){
          const studs=JSON.parse(data.students);
          const updated=studs.map(s=>String(s.id)===studentIdRaw?{...s,name:student.name,phone:student.phone||"",email:student.email||""}:s);
          await supabase.from("coach_data").update({students:JSON.stringify(updated)}).eq("coach_id",cId);
          localStorage.setItem("izi_students",JSON.stringify(updated));
        }
      }
    }catch(e){console.error("saveProfile error:",e);}
    setTab("home");
  };
  const attLogs=[];
  classes.forEach(cls=>{
    if(!cls.students||!cls.students.includes(student.id)) return;
    (cls.attendanceLog||[]).forEach(entry=>{
      if(!entry.present||!entry.present.includes(student.id)) return;
      const d=new Date(entry.date+"T12:00:00");
      attLogs.push({date:entry.date,day:entry.day,month:MONTHS[d.getMonth()],dayNum:d.getDate(),className:cls.title,time:cls.time});
    });
  });
  attLogs.sort((a,b)=>b.date.localeCompare(a.date));

  // Student's classes schedule
  const myClasses=classes.filter(c=>c.students&&c.students.includes(student.id));

  const tabs=[
    {id:"home",label:"Inicio",icon:(col)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>},
    {id:"clases",label:"Clases",icon:(col)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>},
    {id:"chat",label:"Chat",icon:(col)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>},
    {id:"pagos",label:"Pagos",icon:(col)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="12" cy="15" r="2"/></svg>},
    {id:"config",label:"Config",icon:(col)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>},
  ];

  const unreadAlerts=alerts.length;

  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,display:"flex",flexDirection:"column",background:C.bg,zIndex:10}}>
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"16px 16px 20px",flexShrink:0,boxShadow:"0 4px 20px rgba(26,61,181,0.3)"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{position:"relative"}}>
            {student.photo
              ?<img src={student.photo} style={{width:68,height:68,borderRadius:"50%",objectFit:"cover",border:"3px solid rgba(255,255,255,0.4)"}}/>
              :<div style={{width:68,height:68,borderRadius:"50%",background:"rgba(255,255,255,0.2)",border:"3px solid rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:800,color:C.white}}>{student.avatar}</div>
            }
            <div style={{position:"absolute",bottom:2,right:2,width:14,height:14,borderRadius:"50%",background:"#65CE5A",border:"2px solid #fff"}}></div>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.65)",fontWeight:600,letterSpacing:1,marginBottom:2}}>PORTAL ALUMNO</div>
            <div style={{fontSize:22,fontWeight:900,color:C.white,letterSpacing:-0.3}}>{student.name}</div>
          </div>
          <button onClick={()=>setTab("home")} style={{position:"relative",background:"rgba(255,255,255,0.18)",border:"1.5px solid rgba(255,255,255,0.30)",borderRadius:14,width:48,height:48,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            {unreadAlerts>0&&<span style={{position:"absolute",top:-6,right:-6,background:"#FF4757",color:"#fff",borderRadius:"50%",width:20,height:20,fontSize:11,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #fff"}}>{unreadAlerts}</span>}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>

        {/* HOME */}
        {tab==="home"&&(
          <div style={{flex:1,overflowY:"auto",paddingBottom:"calc(120px + env(safe-area-inset-bottom, 34px))",background:C.bg}}>

            {/* Hero card - Bienvenida + Próxima clase */}
            <div style={{background:C.white,margin:"12px 12px 0",borderRadius:20,padding:16,boxShadow:"0 2px 12px rgba(44,94,247,0.08)",display:"flex",gap:14,alignItems:"stretch"}}>
              <div style={{flexShrink:0}}>
                {student.photo
                  ?<img src={student.photo} style={{width:90,height:110,borderRadius:14,objectFit:"cover"}}/>
                  :<div style={{width:90,height:110,borderRadius:14,background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,fontWeight:900,color:C.white}}>{student.avatar}</div>
                }
              </div>
              <div style={{flex:1,paddingTop:4,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:13,color:C.mutedDark,fontWeight:600,letterSpacing:0.3,textAlign:"left"}}>BUEN DIA,</div>
                  <div style={{fontSize:28,fontWeight:900,color:C.blue2,letterSpacing:-0.5,lineHeight:1,textTransform:"uppercase",textAlign:"left"}}>{student.name?student.name.split(" ")[0]:"ALUMNO"}</div>
                </div>
                {myClasses.length>0?(()=>{
                  const next=[...myClasses].filter(c=>c.date>=TODAY_DATE).sort((a,b)=>a.date.localeCompare(b.date))[0]||myClasses[0];
                  const d=new Date((next?.date||TODAY_DATE)+"T12:00:00");
                  const wD=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
                  const mN=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
                  return (
                    <div style={{textAlign:"left"}}>
                      <div style={{fontSize:10,color:C.mutedDark,fontWeight:700,letterSpacing:0.5,marginBottom:2}}>TU PRÓXIMA CLASE ES</div>
                      <div style={{fontSize:13,fontWeight:800,color:C.blue2,lineHeight:1.4,textTransform:"uppercase",textAlign:"left"}}>{wD[d.getDay()]+" "+d.getDate()+" DE "+mN[d.getMonth()]+","}<br/>{next?.time}</div>
                    </div>
                  );
                })():(
                  <div style={{fontSize:12,color:C.mutedDark,textAlign:"left"}}>Sin clases programadas</div>
                )}
              </div>
            </div>

            {/* Tus Clases */}
            {myClasses.length>0&&(()=>{
              const cls=[...new Map(myClasses.map(c=>[c.title,c])).values()][0];
              return (
                <div style={{background:C.white,margin:"8px 12px 0",borderRadius:20,padding:"14px 16px",boxShadow:"0 2px 12px rgba(44,94,247,0.08)"}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.mutedDark,letterSpacing:1,marginBottom:10,textAlign:"center"}}>TUS CLASES</div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    {(cls.days||[]).map(d=><span key={d} style={{fontSize:12,padding:"5px 10px",borderRadius:20,background:C.blue2,color:"#fff",fontWeight:700}}>{d.slice(0,2)}</span>)}
                    <span style={{fontSize:13,fontWeight:700,color:C.mutedDark,marginLeft:4}}>{cls.time}{cls.timeEnd?" - "+cls.timeEnd:""}</span>
                    {cls.court&&<span style={{fontSize:12,color:C.mutedDark}}>· {cls.court}</span>}
                  </div>
                </div>
              );
            })()}

            {/* Estado de Cuenta */}
            {(()=>{
              const allDates=(student.combos||[]).filter(c=>c.total>0&&c.packType!=="mensual").flatMap(c=>{
                const seen=new Set();
                return (c.dates||[]).filter(d=>{if(seen.has(d))return false;seen.add(d);return true;}).map((d,i)=>{
                  const paidCount=c.paidCount!==undefined?c.paidCount:(c.paid?c.total:0);
                  const isPaid=i<paidCount;
                  const isPast=d<=TODAY_DATE;
                  const attEntry=myClasses.flatMap(cls=>cls.attendanceLog||[]).find(e=>e.date===d);
                  const isGiven=attEntry?(attEntry.present||[]).includes(student.id)||(attEntry.ausente_dada||[]).includes(student.id):isPast;
                  return {date:d,isPaid,isGiven,isPast};
                });
              });
              const seen2=new Set();
              const deduped=allDates.filter(d=>{if(seen2.has(d.date))return false;seen2.add(d.date);return true;});
              const noPagada=deduped.filter(d=>!d.isPaid).length;
              const pagada=deduped.filter(d=>d.isPaid).length;
              const programada=deduped.filter(d=>!d.isGiven&&d.date>TODAY_DATE).length;
              const realizada=deduped.filter(d=>d.isGiven||d.date<=TODAY_DATE).length;
              const boxes=[
                {label:"No Pagada",val:noPagada,bg:"#FFEBEE",color:"#C62828"},
                {label:"Pagada",val:pagada,bg:C.greenL,color:"#2E7D32"},
                {label:"Programada",val:programada,bg:C.blueL,color:C.blue2},
                {label:"Realizada",val:realizada,bg:"#F5F5F5",color:"#616161"},
              ];
              return (
                <div style={{margin:"8px 12px 0"}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.mutedDark,letterSpacing:1,marginBottom:8,textAlign:"center"}}>ESTADO DE CUENTA</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
                    {boxes.map(b=>(
                      <div key={b.label} style={{background:b.bg,borderRadius:14,padding:"14px 6px",textAlign:"center"}}>
                        <div style={{fontSize:28,fontWeight:900,color:b.color,lineHeight:1}}>{b.val}</div>
                        <div style={{fontSize:10,fontWeight:700,color:b.color,marginTop:4}}>{b.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div style={{padding:"10px 12px 0"}}>
              {/* Chat button */}
              <button onClick={()=>setTab("chat")} style={{width:"100%",padding:"18px",borderRadius:16,border:"none",background:"linear-gradient(135deg,#2E7D32,#43A047,#65CE5A)",color:C.white,fontSize:15,cursor:"pointer",fontWeight:800,letterSpacing:0.3,marginBottom:12,boxShadow:"0 6px 20px rgba(101,206,90,0.35)",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                Chatear con el Entrenador
              </button>
              {/* Alerts */}
              {alerts.length>0&&(
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:C.mutedDark,letterSpacing:1,marginBottom:8,textAlign:"center"}}>AVISO DEL ENTRENADOR</div>
                  {alerts.map((a,i)=>(
                    <div key={a.id||i} style={{background:"#fdf3e2",borderRadius:16,padding:"14px 16px",marginBottom:10,display:"flex",gap:12,alignItems:"center",border:"1px solid #F5C842"}}>
                      <div style={{width:40,height:40,borderRadius:12,background:"#fff",border:"1px solid #F5C842",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E65100" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,color:"#5D3A00",fontWeight:700,lineHeight:1.4}}>{a.text}</div>
                        <div style={{fontSize:11,color:"#E65100",marginTop:3,fontWeight:500}}>{a.created_at?new Date(a.created_at).toLocaleDateString("es",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):""}</div>
                      </div>
                      <button onClick={()=>{setAlerts(p=>p.filter(x=>x!==a));if(a.id){const dk="izi_dismissed_alerts_"+student.id;const d=JSON.parse(localStorage.getItem(dk)||"[]");d.push(a.id);localStorage.setItem(dk,JSON.stringify(d));}}} style={{background:"none",border:"none",cursor:"pointer",padding:4,flexShrink:0,opacity:0.5}}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5D3A00" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* CLASES */}
        {tab==="clases"&&(
          <div style={{flex:1,overflowY:"auto",padding:16,paddingBottom:"calc(120px + env(safe-area-inset-bottom, 34px))"}}>
            <div style={{fontSize:16,fontWeight:800,color:C.text,marginBottom:16}}>Mis Clases</div>
            {myClasses.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:C.mutedDark}}>No tenés clases asignadas aún</div>}
            {[...new Map(myClasses.map(c=>[c.title,c])).values()].map(cls=>{
              const allDates=(student.combos||[]).filter(c=>c.total>0&&c.packType!=="mensual").flatMap(c=>{
                const seen=new Set();
                return (c.dates||[]).filter(d=>{if(seen.has(d))return false;seen.add(d);return true;}).map((d,i)=>{
                  const paidCount=c.paidCount!==undefined?c.paidCount:(c.paid?c.total:0);
                  const isPaid=i<paidCount;
                  const isPast=d<=TODAY_DATE;
                  const attEntry=(cls.attendanceLog||[]).find(e=>e.date===d);
                  const isGiven=attEntry?(attEntry.present||[]).includes(student.id)||(attEntry.ausente_dada||[]).includes(student.id):isPast;
                  const isCancelled=attEntry&&(attEntry.ausente_reprog||[]).includes(student.id);
                  return {date:d,isPaid,isGiven,isPast,isCancelled};
                });
              }).sort((a,b)=>a.date.localeCompare(b.date));
              const seen2=new Set();
              const deduped=allDates.filter(d=>{if(seen2.has(d.date))return false;seen2.add(d.date);return true;});
              return (
                <WhiteCard key={cls.id} style={{marginBottom:12}}>
                  <div style={{fontWeight:800,fontSize:15,color:C.text,marginBottom:6}}>{cls.title}</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                    {(cls.days||[]).map(d=><span key={d} style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:C.blueL,color:C.blue2,fontWeight:600}}>{d}</span>)}
                    <span style={{fontSize:12,color:C.mutedDark}}>🕐 {cls.time}{cls.timeEnd?" – "+cls.timeEnd:""}</span>
                    <span style={{fontSize:12,color:C.mutedDark}}>📍 {cls.court}</span>
                  </div>
                  {deduped.length===0?<div style={{fontSize:12,color:C.mutedDark}}>Sin clases asignadas</div>:(
                    <div>
                      {deduped.map((item,i)=>{
                        let leftBg="#EDFBEC",leftColor="#2E7D32",leftLabel="Pagada";
                        if(!item.isPaid){leftBg="#FFEBEE";leftColor="#C62828";leftLabel="No Pagada";}
                        let rightBg="#F5F5F5",rightColor="#616161",rightLabel="Realizada";
                        if(!item.isGiven&&item.date>TODAY_DATE){rightBg=C.blueL;rightColor=C.blue2;rightLabel="Programada";}
                        if(item.isCancelled){rightBg="#FFF3E0";rightColor="#E65100";rightLabel="A Reprog.";}
                        return (
                          <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid "+C.border}}>
                            <div style={{width:26,height:26,borderRadius:"50%",background:C.blueL,border:"2px solid "+C.blue2,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                              <span style={{fontSize:10,fontWeight:800,color:C.blue2}}>{i+1}</span>
                            </div>
                            <div style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>{fmtDate(item.date)}</div>
                            <span style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:leftBg,color:leftColor,fontWeight:700}}>{leftLabel}</span>
                            <span style={{fontSize:10,padding:"3px 8px",borderRadius:20,background:rightBg,color:rightColor,fontWeight:700}}>{rightLabel}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </WhiteCard>
              );
            })}
          </div>
        )}

        {/* CHAT */}
        {tab==="chat"&&(
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",height:"100%"}}>
            <div style={{padding:"10px 16px",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",display:"flex",alignItems:"center",gap:10,flexShrink:0,zIndex:2}}>
              <div style={{width:38,height:38,borderRadius:"50%",background:C.whiteA,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:C.white}}>E</div>
              <div><div style={{fontWeight:700,fontSize:14,color:C.white}}>Tu Entrenador</div><div style={{fontSize:11,color:C.muted}}>● En línea</div></div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:8,background:C.bg,minHeight:0,paddingBottom:"calc(80px + env(safe-area-inset-bottom,0px))"}}>
              {msgs.map((m,i)=>(
                <div key={m.id||i} style={{display:"flex",justifyContent:m.from_coach?"flex-start":"flex-end",gap:8,alignItems:"flex-end"}}>
                  {m.from_coach&&<div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:C.white,flexShrink:0}}>E</div>}
                  <div style={{maxWidth:"72%"}}>
                    {m.is_alert&&m.from_coach&&<div style={{fontSize:10,color:"#E65100",fontWeight:700,marginBottom:2}}>📢 ALERTA</div>}
                    <div style={{padding:"10px 14px",fontSize:13,borderRadius:m.from_coach?"18px 18px 18px 4px":"18px 18px 4px 18px",background:m.from_coach?m.is_alert?"#fdf3e2":C.white:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",color:m.from_coach?m.is_alert?"#5D3A00":C.text:C.white,border:m.is_alert?"1px solid #F5C842":"none"}}>
                      {m.text}
                    </div>
                    <div style={{fontSize:10,color:C.mutedDark,marginTop:2,textAlign:m.from_coach?"left":"right"}}>{m.created_at?new Date(m.created_at).toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"}):""}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{padding:"10px 16px",background:C.white,borderTop:"1px solid "+C.border,display:"flex",gap:8,alignItems:"center",flexShrink:0,zIndex:2,marginBottom:"calc(64px + env(safe-area-inset-bottom,0px))"}}>
              <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Escribí un mensaje..." style={{flex:1,padding:"10px 16px",borderRadius:24,border:"1.5px solid "+C.border,fontSize:14,background:C.bg,color:C.text,outline:"none"}}/>
              <button onClick={send} style={{background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",border:"none",borderRadius:"50%",width:44,height:44,cursor:"pointer",color:C.white,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* PAGOS */}
        {tab==="pagos"&&(
          <div style={{flex:1,overflowY:"auto",padding:16,paddingBottom:"calc(120px + env(safe-area-inset-bottom, 34px))"}}>
            <div style={{fontSize:16,fontWeight:800,color:C.text,marginBottom:16}}>Historial de Pagos</div>
            {(student.combos||[]).flatMap(c=>(c.payments||[]).map(p=>({...p,packType:c.packType,comboTotal:c.total}))).length===0&&(
              <div style={{textAlign:"center",padding:"32px 0",color:C.mutedDark}}>Sin pagos registrados aún</div>
            )}
            {(student.combos||[]).flatMap(c=>(c.payments||[]).map(p=>({...p,packType:c.packType,comboTotal:c.total}))).sort((a,b)=>b.date.localeCompare(a.date)).map((p,i)=>(
              <WhiteCard key={i} style={{marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,#52C048,#65CE5A)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>✓</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14,color:C.text}}>
                      {p.comboTotal===null?"📅 Plan Mensual":"📦 "+p.qty+" clase"+(p.qty>1?"s":"")}
                    </div>
                    <div style={{fontSize:12,color:C.mutedDark,marginTop:2}}>{p.date}</div>
                    {p.payMonth&&<div style={{fontSize:11,color:C.blue2,fontWeight:600,marginTop:2}}>Mes: {(["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][parseInt(p.payMonth?.split("-")[1])-1]||"")} {p.payMonth?.split("-")[0]}</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontWeight:800,color:C.blue2,fontSize:16}}>{fmtMoneyShort(p.amount)}</div>
                    <span style={{fontSize:11,padding:"3px 8px",borderRadius:20,background:C.greenL,color:C.green,fontWeight:600,display:"inline-block",marginTop:4}}>Pagado</span>
                  </div>
                </div>
              </WhiteCard>
            ))}
          </div>
        )}

        {/* CONFIG */}
        {tab==="config"&&(
          <div style={{flex:1,overflowY:"auto",padding:16,paddingBottom:"calc(120px + env(safe-area-inset-bottom, 34px))"}}>
            {/* Avatar */}
            <div style={{textAlign:"center",marginBottom:24}}>
              <div style={{position:"relative",width:88,height:88,margin:"0 auto 8px"}}>
                {student.photo
                  ?<img src={student.photo} style={{width:88,height:88,borderRadius:"50%",objectFit:"cover",border:"3px solid "+C.blue2}}/>
                  :<div style={{width:88,height:88,borderRadius:"50%",background:"linear-gradient(135deg,"+C.blue2+","+C.blue3+")",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:800,color:C.white}}>{student.avatar}</div>
                }
                <label htmlFor="stuAvInput" style={{position:"absolute",bottom:0,right:0,width:28,height:28,borderRadius:"50%",background:C.blue2,border:"2px solid "+C.white,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </label>
                <input id="stuAvInput" type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const file=e.target.files[0];if(file){const r=new FileReader();r.onload=ev=>setStudent({...student,photo:ev.target.result});r.readAsDataURL(file);}}}/>
              </div>
              <div style={{fontSize:14,fontWeight:700,color:C.text}}>{student.name}</div>
              {student.photo&&<button onClick={()=>setStudent({...student,photo:null})} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.mutedDark,textDecoration:"underline",marginTop:4}}>Eliminar foto</button>}
            </div>

            {/* Profile fields */}
            <WhiteCard style={{marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>Datos personales</div>
              {[{l:"Nombre",v:student.name,k:"name"},{l:"Teléfono",v:student.phone||"",k:"phone"},{l:"Email",v:student.email||"",k:"email"}].map(f=>(
                <div key={f.k} style={{marginBottom:12}}>
                  <label style={{fontSize:12,color:C.blue2,fontWeight:700,display:"block",marginBottom:4}}>{f.l.toUpperCase()}</label>
                  <input value={f.v} onChange={e=>setStudent({...student,[f.k]:e.target.value})} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",color:C.text,background:C.bg,outline:"none"}}/>
                </div>
              ))}
              <button onClick={saveProfile} style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,fontSize:14,cursor:"pointer",fontWeight:700}}>Guardar cambios</button>
            </WhiteCard>

            {/* Password */}
            <WhiteCard style={{marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>🔒 Cambiar contraseña</div>
              {[{l:"Contraseña actual",v:oldPass,s:setOldPass},{l:"Nueva contraseña",v:newPass,s:setNewPass},{l:"Confirmar nueva",v:newPass2,s:setNewPass2}].map(f=>(
                <div key={f.l} style={{marginBottom:10}}>
                  <label style={{fontSize:12,color:C.blue2,fontWeight:700,display:"block",marginBottom:4}}>{f.l.toUpperCase()}</label>
                  <input type="password" value={f.v} onChange={e=>f.s(e.target.value)} placeholder="••••••••" style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid "+C.border,fontSize:14,boxSizing:"border-box",color:C.text,background:C.bg,outline:"none"}}/>
                </div>
              ))}
              <button onClick={async()=>{if(!newPass||newPass!==newPass2){alert("Las contraseñas no coinciden.");return;}if(newPass.length<6){alert("Mínimo 6 caracteres.");return;}const {error}=await supabase.auth.updateUser({password:newPass});if(error){alert("Error: "+error.message);}else{setOldPass("");setNewPass("");setNewPass2("");setTab("home");}}} style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",color:C.white,fontSize:14,cursor:"pointer",fontWeight:700,marginTop:4}}>Actualizar contraseña</button>
            </WhiteCard>

            <button onClick={onExit} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"#FFF0F0",color:"#D32F2F",fontSize:14,cursor:"pointer",fontWeight:700}}>Cerrar sesión</button>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{display:"flex",borderTop:"1px solid rgba(44,94,247,0.07)",background:C.white,paddingBottom:"env(safe-area-inset-bottom,4px)",position:"fixed",bottom:0,left:0,right:0,zIndex:100,boxShadow:"0 -2px 16px rgba(44,94,247,0.06)"}}>
        {tabs.map(t=>{
          const isActive=tab===t.id; const col=isActive?C.blue2:"#9BACCB";
          return (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"8px 0 6px",position:"relative"}}>
              {isActive&&<div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:28,height:3,borderRadius:"0 0 4px 4px",background:C.blue2}}></div>}
              {t.id==="chat"&&unreadAlerts>0&&<div style={{position:"absolute",top:6,right:"20%",width:8,height:8,borderRadius:"50%",background:"#FF4757",border:"1.5px solid #fff"}}></div>}
              <div style={{width:38,height:38,borderRadius:12,background:isActive?"linear-gradient(135deg,"+C.blueL+",#D0E4FF)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
                {t.icon(col)}
              </div>
              <span style={{fontSize:10,color:col,fontWeight:isActive?700:500,letterSpacing:0.1}}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
function OnboardingFlow({ onComplete }) {
  const [step,setStep]=useState(0);
  const [profName,setProfName]=useState("");
  const [profSport,setProfSport]=useState("");
  const [profSportCustom,setProfSportCustom]=useState("");
  const [profPhoto,setProfPhoto]=useState(null);
  const [profCountry,setProfCountry]=useState("");
  const [courts,setCourts]=useState([]);
  const [cName,setCName]=useState(""); const [cCity,setCCity]=useState("");
  const [packages,setPackages]=useState([]);
  const [pType,setPType]=useState("combo"); const [pQty,setPQty]=useState("8"); const [pPrice,setPPrice]=useState(""); const [pNameOnboard,setPNameOnboard]=useState("");

  const COUNTRIES=[
    {code:"PY",name:"Paraguay",currency:"₲",currencyName:"Guaraní"},
    {code:"AR",name:"Argentina",currency:"$",currencyName:"Peso argentino"},
    {code:"UY",name:"Uruguay",currency:"$U",currencyName:"Peso uruguayo"},
    {code:"BR",name:"Brasil",currency:"R$",currencyName:"Real"},
    {code:"CL",name:"Chile",currency:"$",currencyName:"Peso chileno"},
    {code:"CO",name:"Colombia",currency:"$",currencyName:"Peso colombiano"},
    {code:"MX",name:"México",currency:"$",currencyName:"Peso mexicano"},
    {code:"PE",name:"Perú",currency:"S/",currencyName:"Sol"},
    {code:"US",name:"Estados Unidos",currency:"$",currencyName:"Dólar"},
    {code:"ES",name:"España",currency:"€",currencyName:"Euro"},
    {code:"OTHER",name:"Otro país",currency:"$",currencyName:"Moneda local"},
  ];
  const selectedCountry=COUNTRIES.find(c=>c.code===profCountry)||null;

  const iS={width:"100%",padding:"14px 16px",borderRadius:14,border:"none",fontSize:15,boxSizing:"border-box",background:"rgba(255,255,255,0.15)",color:"#fff",outline:"none"};
  const lS={fontSize:12,color:"rgba(255,255,255,0.7)",fontWeight:700,display:"block",marginBottom:6,letterSpacing:0.5};

  const steps=[
    {title:"Tu perfil",subtitle:"Contanos sobre vos",icon:"👤"},
    {title:"Tus canchas",subtitle:"¿Dónde dás clases?",icon:"🏟"},
    {title:"Tus paquetes",subtitle:"¿Cómo cobrás?",icon:"💳"},
    {title:"¡Todo listo!",subtitle:"Ya podés empezar",icon:"🎉"},
  ];

  const Progress=()=>(
    <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:28}}>
      {steps.slice(0,3).map((_,i)=>(
        <div key={i} style={{height:4,borderRadius:2,background:i<=step?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.25)",flex:1,maxWidth:60,transition:"background 0.3s"}}></div>
      ))}
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#1565C0,#2196F3)",display:"flex",flexDirection:"column",padding:"32px 24px 24px"}}>
      {/* Logo */}
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{fontSize:22,fontWeight:900,color:"#fff",letterSpacing:-1}}>izi<span style={{color:"#90CAF9"}}>coach</span></div>
      </div>

      {step<3&&<Progress/>}

      {/* Step 0 — Profile */}
      {step===0&&(
        <div style={{flex:1,display:"flex",flexDirection:"column"}}>
          <div style={{textAlign:"center",marginBottom:28}}>
            <div style={{fontSize:40,marginBottom:8}}>👤</div>
            <div style={{fontSize:22,fontWeight:900,color:"#fff",marginBottom:6}}>Tu perfil</div>
            <div style={{fontSize:14,color:"rgba(255,255,255,0.7)"}}>Contanos quién sos</div>
          </div>
          {/* Avatar upload */}
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{position:"relative",width:88,height:88,margin:"0 auto"}}>
              {profPhoto
                ?<img src={profPhoto} style={{width:88,height:88,borderRadius:"50%",objectFit:"cover",border:"3px solid rgba(255,255,255,0.5)"}}/>
                :<div style={{width:88,height:88,borderRadius:"50%",background:"rgba(255,255,255,0.2)",border:"3px dashed rgba(255,255,255,0.4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>📷</div>
              }
              <label htmlFor="obAvInput" style={{position:"absolute",bottom:0,right:0,width:28,height:28,borderRadius:"50%",background:"#43A047",border:"2px solid #fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </label>
              <input id="obAvInput" type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=ev=>setProfPhoto(ev.target.result);r.readAsDataURL(f);}}}/>
            </div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginTop:8}}>Subí tu foto (opcional)</div>
          </div>
          <div style={{marginBottom:14}}><label style={lS}>TU NOMBRE *</label><input value={profName} onChange={e=>setProfName(e.target.value)} placeholder="Ej: Carlos García" style={iS}/></div>
          <div style={{marginBottom:14}}>
            <label style={lS}>DEPORTE / ESPECIALIDAD</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:profSport==="Otras"?10:0}}>
              {["Tenis","Padel","Squash","Fútbol","Volley","Karate","Golf","Natación","Otras"].map(sport=>(
                <button key={sport} onClick={()=>setProfSport(sport)} style={{padding:"8px 14px",borderRadius:20,border:"2px solid "+(profSport===sport?"#fff":"rgba(255,255,255,0.3)"),background:profSport===sport?"rgba(255,255,255,0.25)":"transparent",color:"#fff",fontSize:13,cursor:"pointer",fontWeight:profSport===sport?700:400}}>
                  {sport}
                </button>
              ))}
            </div>
            {profSport==="Otras"&&(
              <input value={profSportCustom||""} onChange={e=>setProfSportCustom(e.target.value)} placeholder="Especificá tu deporte..." style={{...iS,marginTop:8}}/>
            )}
          </div>
          <div style={{marginBottom:28}}>
            <label style={lS}>PAÍS *</label>
            <select value={profCountry} onChange={e=>{setProfCountry(e.target.value);const c=COUNTRIES.find(x=>x.code===e.target.value);if(c){setCUR(c.currency);}}} style={{...iS,cursor:"pointer",appearance:"none"}}>
              <option value="" disabled>Seleccioná tu país...</option>
              {COUNTRIES.map(c=><option key={c.code} value={c.code}>{c.name+" — "+c.currency+" ("+c.currencyName+")"}</option>)}
            </select>
            {selectedCountry&&<div style={{marginTop:8,fontSize:12,color:"rgba(255,255,255,0.8)",textAlign:"center"}}>
              {"💰 Moneda: "+selectedCountry.currency+" · "+selectedCountry.currencyName}
            </div>}
          </div>
          <button onClick={()=>{if(!profName.trim()||!profCountry)return;setStep(1);}} style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:(profName.trim()&&profCountry)?"#fff":"rgba(255,255,255,0.3)",color:(profName.trim()&&profCountry)?"#1565C0":"rgba(255,255,255,0.5)",fontSize:15,cursor:"pointer",fontWeight:800}}>Siguiente →</button>
        </div>
      )}

      {/* Step 1 — Courts */}
      {step===1&&(
        <div style={{flex:1,display:"flex",flexDirection:"column"}}>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{fontSize:40,marginBottom:8}}>🏟</div>
            <div style={{fontSize:22,fontWeight:900,color:"#fff",marginBottom:6}}>Tus canchas</div>
            <div style={{fontSize:14,color:"rgba(255,255,255,0.7)"}}>¿Dónde dás clases?</div>
          </div>
          {courts.length>0&&(
            <div style={{marginBottom:16}}>
              {courts.map(c=>(
                <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"10px 14px",marginBottom:8}}>
                  <span style={{fontSize:18}}>🏟</span>
                  <div style={{flex:1}}><div style={{fontWeight:700,color:"#fff",fontSize:14}}>{c.name}</div>{c.city&&<div style={{fontSize:12,color:"rgba(255,255,255,0.7)"}}>{c.city}</div>}</div>
                  <button onClick={()=>setCourts(p=>p.filter(x=>x.id!==c.id))} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:"50%",width:26,height:26,cursor:"pointer",color:"#fff",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <input value={cName} onChange={e=>setCName(e.target.value)} placeholder="Nombre de la cancha" style={{...iS,flex:1}}/>
            <button onClick={()=>{if(!cName.trim())return;setCourts(p=>[...p,{id:Date.now(),name:cName.trim()}]);setCName("");}} style={{padding:"14px 18px",borderRadius:14,border:"none",background:"#fff",color:"#1565C0",fontSize:14,cursor:"pointer",fontWeight:800,flexShrink:0}}>+ Agregar</button>
          </div>
          <div style={{marginTop:"auto",display:"flex",gap:10}}>
            <button onClick={()=>setStep(2)} style={{flex:1,padding:"14px",borderRadius:14,border:"2px solid rgba(255,255,255,0.3)",background:"transparent",color:"rgba(255,255,255,0.7)",fontSize:14,cursor:"pointer",fontWeight:700}}>Saltar</button>
            <button onClick={()=>setStep(2)} style={{flex:2,padding:"14px",borderRadius:14,border:"none",background:"#fff",color:"#1565C0",fontSize:15,cursor:"pointer",fontWeight:800}}>Siguiente →</button>
          </div>
        </div>
      )}

      {/* Step 2 — Packages */}
      {step===2&&(
        <div style={{flex:1,display:"flex",flexDirection:"column"}}>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{fontSize:40,marginBottom:8}}>💳</div>
            <div style={{fontSize:22,fontWeight:900,color:"#fff",marginBottom:6}}>Tus paquetes</div>
            <div style={{fontSize:14,color:"rgba(255,255,255,0.7)"}}>¿Cómo cobrás tus clases?</div>
          </div>
          {packages.length>0&&(
            <div style={{marginBottom:16}}>
              {packages.map(p=>(
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"10px 14px",marginBottom:8}}>
                  <span style={{fontSize:18}}>{p.type==="individual"?"🎯":p.type==="combo"?"📦":"📅"}</span>
                  <div style={{flex:1}}><div style={{fontWeight:700,color:"#fff",fontSize:14}}>{p.name||(p.type==="individual"?"Individual":p.type==="combo"?"Combo "+p.qty+" clases":"Mensual")}</div><div style={{fontSize:12,color:"rgba(255,255,255,0.7)"}}>{fmtMoneyShort(p.price)}</div></div>
                  <button onClick={()=>setPackages(pr=>pr.filter(x=>x.id!==p.id))} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:"50%",width:26,height:26,cursor:"pointer",color:"#fff",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{marginBottom:10}}>
            <label style={lS}>NOMBRE DEL PAQUETE *</label>
            <input value={pNameOnboard} onChange={e=>setPNameOnboard(e.target.value)} placeholder="Ej: Combo 8 clases, Plan Mensual..." style={{...iS,border:pNameOnboard===null&&"2px solid #FF6B6B"}}/>
            {pNameOnboard===null&&<div style={{fontSize:11,color:"#FF6B6B",marginTop:4,fontWeight:600}}>⚠️ El nombre es requerido</div>}
          </div>
          <div style={{display:"flex",gap:8,marginBottom:10}}>
            {[["individual","🎯"],["combo","📦"],["mensual","📅"]].map(([k,ic])=>(
              <button key={k} onClick={()=>setPType(k)} style={{flex:1,padding:"10px 4px",borderRadius:12,border:"2px solid "+(pType===k?"#fff":"rgba(255,255,255,0.3)"),background:pType===k?"rgba(255,255,255,0.25)":"transparent",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:700}}>{ic+" "+k.charAt(0).toUpperCase()+k.slice(1)}</button>
            ))}
          </div>
          {pType==="combo"&&(
            <div style={{marginBottom:8}}>
              <label style={lS}>CANTIDAD DE CLASES</label>
              <input value={pQty} onChange={e=>setPQty(e.target.value)} placeholder="Ej: 8" type="text" inputMode="numeric" pattern="[0-9]*" style={iS}/>
            </div>
          )}
          <div style={{display:"flex",gap:8,marginBottom:20,alignItems:"flex-end"}}>
            <div style={{flex:1}}>
              <label style={lS}>PRECIO ({selectedCountry?.currency||getCUR()})</label>
              <MoneyInput value={parseInt(pPrice)||0} onChange={v=>setPPrice(v)} placeholder="400000" style={iS}/>
            </div>
            <button onClick={()=>{
              if(!pNameOnboard||!pNameOnboard.trim()){setPNameOnboard(null);return;}
              if(!pPrice)return;
              const qty=pType==="combo"?parseInt(pQty):null;
              setPackages(p=>[...p,{id:Date.now(),name:pNameOnboard.trim(),type:pType,qty,price:parseInt(pPrice)}]);
              setPPrice("");setPQty("8");setPNameOnboard("");
            }} style={{padding:"14px 18px",borderRadius:14,border:"none",background:"#fff",color:"#1565C0",fontSize:14,cursor:"pointer",fontWeight:800,flexShrink:0}}>+ Agregar</button>
          </div>
          <div style={{marginTop:"auto",display:"flex",gap:10}}>
            <button onClick={()=>setStep(3)} style={{flex:1,padding:"14px",borderRadius:14,border:"2px solid rgba(255,255,255,0.3)",background:"transparent",color:"rgba(255,255,255,0.7)",fontSize:14,cursor:"pointer",fontWeight:700}}>Saltar</button>
            <button onClick={()=>setStep(3)} style={{flex:2,padding:"14px",borderRadius:14,border:"none",background:"#fff",color:"#1565C0",fontSize:15,cursor:"pointer",fontWeight:800}}>Siguiente →</button>
          </div>
        </div>
      )}

      {/* Step 3 — Done */}
      {step===3&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center"}}>
          <div style={{fontSize:72,marginBottom:16}}>🎉</div>
          <div style={{fontSize:26,fontWeight:900,color:"#fff",marginBottom:8}}>{"¡Todo listo"+(profName?" "+profName.split(" ")[0]:"")+"!"}</div>
          <div style={{fontSize:15,color:"rgba(255,255,255,0.8)",marginBottom:12,lineHeight:1.6}}>Tu cuenta está configurada.</div>
          <div style={{background:"rgba(255,255,255,0.15)",borderRadius:16,padding:"16px 20px",marginBottom:32,width:"100%",boxSizing:"border-box"}}>
            {[
              profCountry?`🌍 ${COUNTRIES.find(c=>c.code===profCountry)?.name} · ${selectedCountry?.currency} (${selectedCountry?.currencyName})`:null,
              courts.length>0?`🏟 ${courts.length} cancha${courts.length>1?"s":""} configurada${courts.length>1?"s":""}`:null,
              packages.length>0?`💳 ${packages.length} paquete${packages.length>1?"s":""} creado${packages.length>1?"s":""}`:null,
              "📲 Podés invitar alumnos con tu link",
            ].filter(Boolean).map((item,i,arr)=>(
              <div key={i} style={{fontSize:14,color:"rgba(255,255,255,0.9)",padding:"6px 0",borderBottom:i<arr.length-1?"1px solid rgba(255,255,255,0.15)":"none",textAlign:"left"}}>{item}</div>
            ))}
          </div>
          <button onClick={()=>onComplete({name:profName,sport:profSport==="Otras"?profSportCustom||"Otras":profSport,photo:profPhoto,courts,packages,country:profCountry,currency:selectedCountry?.currency||"₲"})} style={{width:"100%",padding:"18px",borderRadius:16,border:"none",background:"#fff",color:"#1565C0",fontSize:16,cursor:"pointer",fontWeight:900,marginBottom:12}}>
            🚀 Crear mi primera clase
          </button>
          <button onClick={()=>onComplete({name:profName,sport:profSport,photo:profPhoto,courts,packages,skipToHome:true,country:profCountry,currency:selectedCountry?.currency||"₲"})} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.6)",fontSize:13}}>
            Ir al dashboard →
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyDashboard({ onNewClass, onNewStudent, onInvite }) {
  return (
    <div style={{flex:1,overflowY:"auto",background:C.bg}}>
      <div style={{background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",padding:"20px 16px 40px",flexShrink:0}}>
        <div style={{fontSize:20,fontWeight:800,color:"#fff",marginBottom:4}}>¡Bienvenido a izicoach! 👋</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,0.75)"}}>Seguí estos pasos para empezar</div>
      </div>
      <div style={{padding:16,marginTop:-20}}>
        {[
          {icon:"📅",title:"Creá tu primera clase",desc:"Configurá horario, días y cancha",action:onNewClass,btn:"Crear clase",color:C.blue2,bg:C.blueL},
          {icon:"👤",title:"Agregá un alumno",desc:"Invitá a tus alumnos a la plataforma",action:onNewStudent,btn:"Agregar alumno",color:"#43A047",bg:"#E8F5E9"},
          {icon:"📲",title:"Invitá por link o QR",desc:"Compartí el link y que se registren solos",action:onInvite,btn:"Ver link",color:"#7B1FA2",bg:"#F3E5F5"},
        ].map((s,i)=>(
          <div key={i} style={{background:"#fff",borderRadius:16,padding:16,marginBottom:12,border:"1px solid "+C.border,display:"flex",gap:14,alignItems:"center"}}>
            <div style={{width:52,height:52,borderRadius:14,background:s.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0}}>{s.icon}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:15,color:C.text,marginBottom:2}}>{s.title}</div>
              <div style={{fontSize:12,color:C.mutedDark}}>{s.desc}</div>
            </div>
            <button onClick={s.action} style={{padding:"8px 14px",borderRadius:10,border:"none",background:s.color,color:"#fff",fontSize:12,cursor:"pointer",fontWeight:700,flexShrink:0}}>{s.btn}</button>
          </div>
        ))}
        <div style={{background:"linear-gradient(135deg,#1565C0,#1976D2)",borderRadius:16,padding:"16px 18px",marginTop:4,display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:28}}>💡</div>
          <div><div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:2}}>Consejo rápido</div><div style={{fontSize:12,color:"rgba(255,255,255,0.8)"}}>Configurá tus canchas y paquetes en ⚙ Configuración para agilizar la creación de clases.</div></div>
        </div>
      </div>
    </div>
  );
}
function StudentRegisterScreen({ coachName, onComplete }) {
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [phone,setPhone]=useState("");
  const [sport,setSport]=useState("");
  const [pass,setPass]=useState("");
  const iS={width:"100%",padding:"14px 16px",borderRadius:14,border:"none",fontSize:14,boxSizing:"border-box",background:"rgba(255,255,255,0.18)",color:"#fff",outline:"none",marginBottom:12};
  return (
    <div style={{minHeight:"100%",background:"linear-gradient(160deg,#1565C0,#2196F3)",display:"flex",flexDirection:"column",padding:"32px 24px 32px"}}>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontSize:22,fontWeight:900,color:"#fff",letterSpacing:-1,marginBottom:8}}>izi<span style={{color:"#90CAF9"}}>coach</span></div>
        <div style={{background:"rgba(255,255,255,0.15)",borderRadius:16,padding:"12px 20px",display:"inline-block"}}>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.8)"}}>Te invita</div>
          <div style={{fontSize:18,fontWeight:800,color:"#fff"}}>🎓 {coachName}</div>
        </div>
      </div>

      <div style={{fontSize:20,fontWeight:900,color:"#fff",marginBottom:4}}>Crear tu cuenta</div>
      <div style={{fontSize:13,color:"rgba(255,255,255,0.7)",marginBottom:24}}>Registrate para ver tus clases, pagos y chatear con tu entrenador</div>

      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Tu nombre completo *" style={iS}/>
      <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email *" type="email" style={iS}/>
      <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Teléfono" type="tel" style={iS}/>
      <input value={sport} onChange={e=>setSport(e.target.value)} placeholder="Deporte (ej: Tenis, Fútbol...)" style={iS}/>
      <input value={pass} onChange={e=>setPass(e.target.value)} placeholder="Contraseña *" type="password" style={iS}/>

      <button onClick={()=>{
        if(!name.trim()||!email.trim()||!pass.trim()) return;
        onComplete({name:name.trim(),email:email.trim(),phone:phone.trim(),sport:sport.trim()});
      }} style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:(name&&email&&pass)?"#fff":"rgba(255,255,255,0.3)",color:(name&&email&&pass)?"#1565C0":"rgba(255,255,255,0.5)",fontSize:15,cursor:"pointer",fontWeight:900,marginTop:8}}>
        🚀 Unirme a las clases
      </button>

      <div style={{marginTop:20,background:"rgba(255,255,255,0.1)",borderRadius:12,padding:"12px 14px"}}>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.8)",lineHeight:1.6}}>
          ✓ Vas a poder ver tus clases y horarios{"\n"}
          ✓ Chatear con tu entrenador{"\n"}
          ✓ Ver tu estado de pagos y asistencia
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const ls=(key,def)=>{try{const v=localStorage.getItem(key);return v?JSON.parse(v):def;}catch{return def;}};
  const lsSet=(key,val)=>{try{localStorage.setItem(key,JSON.stringify(val));}catch{}};
  const [user,setUser]=useState(null);
  const setUserWithRef=(u)=>{setUser(u);window._iziUserId=u?.id||null;};
  const [loadingAuth,setLoadingAuth]=useState(true);
  const [checkingProfile,setCheckingProfile]=useState(false);

  const [mode,setMode]=useState(null);
  const [onboarded,setOnboarded]=useState(false);
  const [showInvite,setShowInvite]=useState(false);
  const [inviteTarget,setInviteTarget]=useState(null);
  const [tab,setTab]=useState("dashboard");
  const [financeTab,setFinanceTab]=useState("payments");
  const [students,setStudentsRaw]=useState(()=>ls("izi_students",[]));
  const [classes,setClassesRaw]=useState(()=>ls("izi_classes",[]));
  const [showNewClass,setShowNewClass]=useState(false);
  const [showNewStudent,setShowNewStudent]=useState(false);
  const [chatTarget,setChatTarget]=useState(null);
  const [tick,setTick]=useState(0);
  useEffect(()=>{
    const interval=setInterval(()=>setTick(t=>t+1),1800000); // re-render every 30 min
    return ()=>clearInterval(interval);
  },[]);
  const [unreadChats,setUnreadChats]=useState({});

  // Subscribe to unread messages
  useEffect(()=>{
    if(!user?.id) return;
    // Load unread counts
    supabase.from("messages").select("student_id").eq("coach_id",user.id).eq("read",false).eq("from_coach",false)
      .then(({data})=>{
        const counts={};
        (data||[]).forEach(m=>{const k=String(m.student_id);counts[k]=(counts[k]||0)+1;});
        setUnreadChats(counts);
      });
    // Realtime subscription for new messages
    const channel=supabase.channel("coach_inbox_"+user.id)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`coach_id=eq.${user.id}`},(payload)=>{
        if(!payload.new.from_coach){
          setUnreadChats(p=>({...p,[String(payload.new.student_id)]:(p[String(payload.new.student_id)]||0)+1}));
        }
      }).subscribe();
    return ()=>supabase.removeChannel(channel);
  },[user?.id]);
  const [showConfig,setShowConfig]=useState(false);
  const [courts,setCourtsRaw]=useState([]);
  const [packages,setPackagesRaw]=useState([]);
  const [coachProfile,setCoachProfileRaw]=useState(()=>ls("izi_profile",{name:"Coach",sport:"",photo:null}));
  const [expenses,setExpensesRaw]=useState(()=>ls("izi_expenses",[]));

  // Sync helpers - store all data as JSON blob per coach
  const syncAll=async(newStudents, newClasses, newExpenses, newCourts, newPackages)=>{
    const userId=window._iziUserId;
    if(!userId) return;
    // Validate data before saving - must be arrays
    if(!Array.isArray(newStudents)||!Array.isArray(newClasses)) return;
    try {
      await supabase.from("coach_data").upsert({
        coach_id:userId,
        students:JSON.stringify(newStudents||[]),
        classes:JSON.stringify(newClasses||[]),
        expenses:JSON.stringify(newExpenses||[]),
        courts:JSON.stringify(newCourts||[]),
        packages:JSON.stringify(newPackages||[]),
        updated_at:new Date().toISOString(),
      },{onConflict:"coach_id"});
    } catch(e){ console.error("Sync error:",e); }
  };

  // Wrapped setters that persist to localStorage (Supabase sync handled by debounced useEffect)
  const setStudents=(v)=>{const next=typeof v==="function"?v(students):v;
    // Guard: never allow combo dates to exceed total
    if(Array.isArray(next)){next.forEach(s=>{(s.combos||[]).forEach(c=>{if(c.dates&&c.total&&c.dates.length>c.total){console.warn("[GUARD] "+s.name+" combo dates "+c.dates.length+" > total "+c.total+". Capping.");c.dates=c.dates.slice(0,c.total);}});});}
    setStudentsRaw(next);lsSet("izi_students",next);};
  const setClasses=(v)=>{const next=typeof v==="function"?v(classes):v;setClassesRaw(next);lsSet("izi_classes",next);};
  const setCourts=(v)=>{const next=typeof v==="function"?v(courts):v;setCourtsRaw(next);lsSet("izi_courts",next);};
  const setPackages=(v)=>{const next=typeof v==="function"?v(packages):v;setPackagesRaw(next);lsSet("izi_packages",next);};
  const setCoachProfile=(v)=>{const next=typeof v==="function"?v(coachProfile):v;setCoachProfileRaw(next);lsSet("izi_profile",next);if(window._iziUserId)supabase.from("coaches").upsert({id:window._iziUserId,...next}).then(res=>{if(res.error)console.error("Coach profile upsert error:",res.error.message);else console.log("Coach profile saved to Supabase");});};
  const setExpenses=(v)=>{const next=typeof v==="function"?v(expenses):v;setExpensesRaw(next);lsSet("izi_expenses",next);};

  const loadData=async(userId)=>{
    try {
      const {data}=await supabase.from("coach_data").select("*").eq("coach_id",userId).single();
      if(data){
        const tryParse=(str,fallback=[])=>{
          try{const p=JSON.parse(str);return Array.isArray(p)?p:fallback;}catch{return fallback;}
        };
        const students=tryParse(data.students);
        const classes=tryParse(data.classes);
        const expenses=tryParse(data.expenses);
        const courts=tryParse(data.courts);
        const packages=tryParse(data.packages);
        // Always trust server data — including empty arrays (e.g. coach deleted all students)
        setStudentsRaw(students);lsSet("izi_students",students);
        setClassesRaw(classes);lsSet("izi_classes",classes);
        setExpensesRaw(expenses);lsSet("izi_expenses",expenses);
        setCourtsRaw(courts);lsSet("izi_courts",courts);
        setPackagesRaw(packages);lsSet("izi_packages",packages);
      }
      // Also load coach profile (name, phone, email, sport, photo, currency)
      const {data:profileData}=await supabase.from("coaches").select("*").eq("id",userId).single();
      if(profileData){
        const profile={name:profileData.name||"Coach",sport:profileData.sport||"",photo:profileData.photo||null,phone:profileData.phone||"",email:profileData.email||"",currency:profileData.currency||""};
        setCoachProfileRaw(profile);lsSet("izi_profile",profile);
        if(profile.currency) setCUR(profile.currency);
      }
    } catch(e){ console.error("Load error:",e); }
  };

  const setModeP=(v)=>{setMode(v);lsSet("izi_mode",v);};
  const setOnboardedP=(v)=>{setOnboarded(v);lsSet("izi_onboarded",v);};

  // Sync all data to Supabase when anything changes (debounced 1s)
  useEffect(()=>{
    if(!window._iziUserId||loadingAuth||checkingProfile) return;
    if(mode==="student_portal") return;
    const timer=setTimeout(()=>{
      syncAll(students,classes,expenses,courts,packages);
    },1000);
    return ()=>clearTimeout(timer);
  },[students,classes,expenses,courts,packages]);

  // Force sync when user switches tabs or minimizes to prevent data loss
  // AND reload from Supabase when returning to the tab (multi-device sync)
  useEffect(()=>{
    const handleVisChange=()=>{
      if(document.visibilityState==="hidden"&&window._iziUserId&&mode!=="student_portal"){
        syncAll(
          JSON.parse(localStorage.getItem("izi_students")||"[]"),
          JSON.parse(localStorage.getItem("izi_classes")||"[]"),
          JSON.parse(localStorage.getItem("izi_expenses")||"[]"),
          JSON.parse(localStorage.getItem("izi_courts")||"[]"),
          JSON.parse(localStorage.getItem("izi_packages")||"[]")
        );
      }
      if(document.visibilityState==="visible"&&window._iziUserId&&mode!=="student_portal"){
        loadData(window._iziUserId);
      }
    };
    document.addEventListener("visibilitychange",handleVisChange);
    return ()=>document.removeEventListener("visibilitychange",handleVisChange);
  },[mode]);

  useEffect(()=>{
    supabase.auth.getSession().then(async({data:{session}})=>{
      if(session?.user){
        setUserWithRef(session.user);setCheckingProfile(true);
        const {data}=await supabase.from("coaches").select("name,currency,sport,photo").eq("id",session.user.id).single();
        if(data?.name){
          setModeP("coach");setOnboardedP(true);if(data.currency)setCUR(data.currency);
          setCoachProfileRaw({name:data.name,sport:data.sport||"",photo:data.photo||null,currency:data.currency||"₲"});
          try{await loadData(session.user.id);}catch(e){console.error(e);}
        } else {
          const {data:sa}=await supabase.from("student_auth").select("*").eq("id",session.user.id).single();
          if(sa){
            lsSet("izi_student_coach_id", sa.coach_id);
            localStorage.setItem("izi_student_id_raw", String(sa.student_id));
            try{
              const {data:cd}=await supabase.from("coach_data").select("*").eq("coach_id",sa.coach_id).single();
              if(cd){
                const tryP=(s,f=[])=>{try{const p=JSON.parse(s);return Array.isArray(p)?p:f;}catch{return f;}};
                const s=tryP(cd.students);const cl=tryP(cd.classes);
                if(s.length>0){setStudentsRaw(s);lsSet("izi_students",s);}
                if(cl.length>0){setClassesRaw(cl);lsSet("izi_classes",cl);}
              }
            }catch(e){console.error("student load error:",e);}
            setModeP("student_portal");
            setCheckingProfile(false);
          }
          else{setModeP("coach_new");setOnboardedP(false);setCheckingProfile(false);}
        }
        setCheckingProfile(false);
      }
      setLoadingAuth(false);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{setUserWithRef(session?.user||null);});
    return ()=>subscription.unsubscribe();
  },[]);

  const handleOnboardingComplete=async(data)=>{
    if(data.courts?.length) setCourts(data.courts);
    if(data.packages?.length) setPackages(data.packages);
    setCUR(data.currency||"₲"); setCurrency(data.currency||"₲");
    const profile={name:data.name||"Coach",sport:data.sport||"",photo:data.photo||null,currency:data.currency||"₲",country:data.country||""};
    setCoachProfile(profile);
    // Save profile to Supabase so next login goes to dashboard
    if(user){
      await supabase.from("coaches").upsert({id:user.id,...profile,email:user.email});
    }
    setOnboardedP(true);
    setModeP("coach");
    if(!data.skipToHome) setShowNewClass(true);
  };

  // Set currency from saved profile on load
  useEffect(()=>{
    try{const p=JSON.parse(localStorage.getItem("izi_profile")||"{}");if(p.currency) setCUR(p.currency);}catch{}
  },[]);

  const handleLogout=async()=>{
    await supabase.auth.signOut();
    localStorage.clear();
    setUserWithRef(null);
    window._iziUserId=null;
    setStudentsRaw([]);setClassesRaw([]);setCourtsRaw([]);setPackagesRaw([]);
    setCoachProfileRaw({name:"Coach",sport:"",photo:null});setExpensesRaw([]);
    setMode(null);setModeP(null);setOnboarded(false);setOnboardedP(false);
  };

  // Listen for navigation events from child components
  useEffect(()=>{
    const handler=(e)=>setTab(e.detail);
    document.addEventListener("izi-nav",handler);
    return ()=>document.removeEventListener("izi-nav",handler);
  },[]);

  const isFirstTime=students.length===0&&classes.length===0;

  const [notifications,setNotifications]=useState([
    {id:1,from:"coach",to:"all",text:"Mañana la clase empieza 15 min antes, a las 7:45. ⏰",time:"Ayer 18:30",type:"alert",read:false},
    {id:2,from:"coach",to:"all",text:"El miércoles se suspende la clase por mantenimiento de la cancha.",time:"Hoy 09:00",type:"alert",read:false},
  ]);

  const updateStudent=(u)=>setStudents(p=>p.map(s=>s.id===u.id?u:s));

  const sendNotification=(text,type="alert")=>{
    setNotifications(p=>[...p,{id:Date.now(),from:"coach",to:"all",text,time:"Ahora",type,read:false}]);
  };

  const handleLogin=(role)=>{
    setOnboardedP(false);
    setTab("dashboard");
    setShowNewClass(false);
    setShowNewStudent(false);
    setShowConfig(false);
    setShowInvite(false);
    setChatTarget(null);
    if(role==="coach_full"){
      setStudents(INIT_STUDENTS);
      setClasses(INIT_CLASSES);
      setCourts([
        {id:1,name:"Cancha A",address:"Av. España 1234",city:"Asunción"},
        {id:2,name:"Cancha B",address:"Calle Palma 567",city:"Asunción"},
        {id:3,name:"Cancha C",address:"Ruta 2 km 12",city:"San Lorenzo"},
      ]);
      setPackages([
        {id:1,name:"Clase individual",type:"individual",qty:null,price:80000},
        {id:2,name:"Combo 8 clases",type:"combo",qty:8,price:400000},
        {id:3,name:"Combo 12 clases",type:"combo",qty:12,price:550000},
        {id:4,name:"Plan Mensual",type:"mensual",qty:null,price:300000},
      ]);
      setExpenses(EXPENSES);
      setCUR("₲"); setCurrency("₲");
      setCoachProfile({name:"Coach Carlos",sport:"Tenis",photo:null,currency:"₲"});
      setOnboardedP(true);
    } else {
      setStudents([]);
      setClasses([]);
      setCourts([]);
      setPackages([]);
      setExpenses([]);
      setCoachProfile({name:"Coach",sport:"",photo:null});
    }
    setModeP(role);
  };



  const [currency,setCurrency]=useState(()=>{
    try{const p=JSON.parse(localStorage.getItem("izi_profile")||"{}");return p.currency||"₲";}catch{return "₲";}
  });

  const updateCurrency=(cur)=>{
    setCurrency(cur);
  };

  const addIncome=(amount,date,studentName,detail)=>{
    setExpenses(p=>[...p,{id:Date.now(),category:"Cobros clases",amount,type:"ingreso",date:date||TODAY_DATE,note:studentName,detail:detail||""}]);
  };

  const handleDeleteClass=(id)=>{
    // Support both expanded virtual classes and raw classes
    const cls=classes.find(c=>c.id===id);
    if(!cls) return;
    const allDatesInSeries=new Set(cls.occurrences||[cls.date]);
    // Remove the class (single object now with occurrences)
    const newClasses=classes.filter(c=>c.id!==cls.id);
    const newStudents=students.map(s=>{
      if(!(cls.students||[]).includes(s.id)) return s;
      const cleanedCombos=s.combos.filter(combo=>{
        if(!combo.dates||combo.dates.length===0) return !allDatesInSeries.has(combo.date);
        return !combo.dates.some(d=>allDatesInSeries.has(d));
      });
      // If student has no more classes after deletion, clear all combos
      const hasOtherClasses=newClasses.some(c=>(c.students||[]).includes(s.id));
      return {...s,combos:hasOtherClasses?cleanedCombos:[]};
    });
    // Remove expenses related to this class's students
    const studentNames=(cls.students||[]).map(sid=>students.find(s=>s.id===sid)?.name).filter(Boolean);
    const newExpenses=expenses.filter(e=>!(e.category==="Cobros clases"&&studentNames.includes(e.note)&&allDatesInSeries.has(e.date)));
    // Update state and sync both together
    setClassesRaw(newClasses);lsSet("izi_classes",newClasses);
    setStudentsRaw(newStudents);lsSet("izi_students",newStudents);
    setExpensesRaw(newExpenses);lsSet("izi_expenses",newExpenses);
    if(window._iziUserId){
      const userId=window._iziUserId;
      supabase.from("coach_data").select("*").eq("coach_id",userId).single().then(({data:existing})=>{
        const row={
          coach_id:userId,
          students:JSON.stringify(newStudents),
          classes:JSON.stringify(newClasses),
          expenses:JSON.stringify(newExpenses),
          courts:existing?.courts||'[]',
          packages:existing?.packages||'[]',
          updated_at:new Date().toISOString(),
        };
        supabase.from("coach_data").upsert(row,{onConflict:"coach_id"});
      });
    }
  };

  const handleSaveClass=(cd,isEdit=false)=>{
    if(isEdit){
      // Resolve virtual id to real series id
      const realId=cd._seriesId||cd.id;
      const editDate=cd.date; // the specific date being edited

      // Handle per-date cancellation/pause for recurring classes
      if((cd.cancelled!==undefined||cd.cancelType==="paused"||cd._resuming)&&editDate){
        setClasses(p=>p.map(c=>{
          if(c.id!==realId) return c;
          const dc={...(c.dateCancellations||{})};
          let occ=c.occurrences?[...c.occurrences]:[];
          
          if(cd.cancelType==="paused"){
            // PAUSE: only mark dates that are in active combos (not grey/unassigned)
            dc[editDate]={cancelType:"paused",rescheduledTo:null};
            // Collect all combo dates for students in this class
            const allComboDates=new Set();
            (c.students||[]).forEach(sid=>{
              const st=students.find(s=>s.id===sid);
              if(st)(st.combos||[]).forEach(combo=>{(combo.dates||[]).forEach(d=>allComboDates.add(d));});
            });
            const pausedDatesNew=[];
            (c.occurrences||[]).forEach(d=>{
              if(d>=editDate&&allComboDates.has(d)&&(!dc[d]||dc[d].cancelType==="paused")){
                dc[d]={cancelType:"paused",rescheduledTo:null};
                pausedDatesNew.push(d);
              }
            });
            // No replacement dates at pause time - they get added at RESUME time
          } else if(cd._resuming){
            // RESUME: just remove paused status from resume date forward
            
            Object.keys(dc).forEach(d=>{
              if(d>=editDate&&dc[d]?.cancelType==="paused") delete dc[d];
            });
            
            const {cancelled:_c,cancelType:_ct,rescheduledTo:_rt,date:_d,_virtualId:_v,_seriesId:_s,_isRescheduledInstance:_ri,attendanceLog:_al,applyToAll:_aa,paused:_p,_resuming:_re,...rest}=cd;
            return {...c,...rest,id:realId,dateCancellations:dc,occurrences:occ};
          } else if(cd.cancelled){
            dc[editDate]={cancelType:cd.cancelType||"cancelled",rescheduledTo:cd.rescheduledTo||null};
          } else {
            delete dc[editDate]; // reactivate
          }
          if(!c.occurrences||c.occurrences.length===0){
            return {...c,...cd,id:realId,dateCancellations:dc};
          }
          const {cancelled:_c,cancelType:_ct,rescheduledTo:_rt,date:_d,_virtualId:_v,_seriesId:_s,_isRescheduledInstance:_ri,attendanceLog:_al,applyToAll:_aa,paused:_p,_resuming:_re,...rest}=cd;
          return {...c,...rest,id:realId,dateCancellations:dc,occurrences:occ};
        }));
        return;
      }

      if(cd.applyToAll){
        // With new format, the series is a single object — just update it
        setClasses(p=>p.map(c=>{
          if(c.id===realId){
            return {...c,...cd,id:realId,date:c.date,occurrences:c.occurrences};
          }
          return c;
        }));
      } else {
        setClasses(p=>p.map(c=>c.id===realId?{...c,...cd,id:realId}:c));
      }
      // Clean combos for students removed from the class
      if(cd.students){
        const originalClass=classes.find(c=>c.id===realId);
        const removedStudentIds=(originalClass?.students||[]).filter(id=>!(cd.students||[]).includes(id));
        if(removedStudentIds.length>0){
          // Get ALL dates from this class (occurrences or single date)
          const classDates=new Set(originalClass?.occurrences||[originalClass?.date].filter(Boolean));
          setStudents(p=>p.map(s=>{
            if(!removedStudentIds.includes(s.id)) return s;
            // Remove only the dates belonging to this class from each combo
            const cleanedCombos=(s.combos||[]).map(combo=>{
              const comboDates=combo.dates||[combo.date].filter(Boolean);
              const filteredDates=comboDates.filter(d=>!classDates.has(d));
              if(filteredDates.length===0) return null; // combo fully emptied, remove it
              return {...combo, dates:filteredDates, total:filteredDates.length, date:filteredDates[0]};
            }).filter(Boolean);
            return {...s,combos:cleanedCombos};
          }));
        }
      }
      // If studentPacks changed, update student combos
      if(cd.studentPacks){
        try {

        const editedClass=classes.find(c=>c.id===cd.id)||cd;
        setStudents(p=>p.map(s=>{
          const sp=cd.studentPacks[s.id]||cd.studentPacks[String(s.id)];
          if(!sp||!sp.pack) return s;
          const pkg=packages.find(pk=>String(pk.id)===String(sp.pack));
          const isMensual=sp.pack==="mensual"||pkg?.type==="mensual";
          const isIndividual=sp.pack==="individual"||pkg?.type==="individual";
          const qty=isMensual?null:isIndividual?1:pkg?.qty||(!isNaN(parseInt(sp.pack))&&parseInt(sp.pack)<100?parseInt(sp.pack):null)||8;
          const packType=isMensual?"mensual":isIndividual?"individual":"combo";
          const combos=[...s.combos];
          const lastCombo=combos.length>0?combos[combos.length-1]:null;
          const lastDate=lastCombo?.dates?.slice(-1)[0]||"";
          const today=new Date().toISOString().slice(0,10);
          const lastComboFullyUsed=!lastDate||((lastDate<today)&&(lastCombo?.used||0)>=(lastCombo?.total||0));
          // Only create new combo if student has no active combo OR last combo is expired
          // Don't create if student already has an active combo (future dates OR unused classes)
          const hasActiveCombo=lastCombo&&(
            (lastDate&&lastDate>=today) || // combo with future dates
            (lastCombo.packType==="mensual"&&lastCombo.paid) || // paid mensual
            ((lastCombo.used||0)<(lastCombo.total||0)) // combo with unused classes (even if dates passed)
          );
          // If explicitly marking as paid, update existing combo and create payment record
          if(hasActiveCombo&&sp.paid===true&&lastCombo&&!lastCombo.paid){
            const paymentRecord={
              id:Date.now(),
              qty:lastCombo.total||0,
              amount:lastCombo.amount||sp.amount||0,
              method:"efectivo",
              date:TODAY_DATE,
              dates:lastCombo.dates||[],
            };
            combos[combos.length-1]={...lastCombo,paid:true,paidCount:lastCombo.total||0,payments:[...(lastCombo.payments||[]),paymentRecord]};
            return {...s,combos};
          }
          if(hasActiveCombo) return s; // don't modify - just editing the class
          // Create NEW combo when last combo is expired (last date is in the past)
          if(!lastDate||lastComboFullyUsed){
            const startDate=cd.date||today;
            // Use REAL occurrences from the class, not generated dates
            const editedClassFull=classes.find(c=>c.id===(cd._seriesId||cd.id));
            const realOcc=(editedClassFull?.occurrences||[]).filter(d=>d>=startDate);
            const total=qty||8;
            const newDates=realOcc.slice(0,total);
            // Fallback: if no occurrences available, generate from days
            if(newDates.length===0){
              const DAY_MAP={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
              const dowSet=new Set((editedClass.days||[]).map(d=>DAY_MAP[d]));
              let cur=new Date(startDate+"T12:00:00");
              while(newDates.length<total){
                if(dowSet.size===0||dowSet.has(cur.getDay())){
                  newDates.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
                }
                cur.setDate(cur.getDate()+1);
              }
            }
            combos.push({
              id:combos.length+1,
              total:qty,
              packType,
              used:0,
              paid:sp.paid===true,
              paidCount:sp.paid===true?(qty||0):0,
              date:newDates[0]||startDate,
              amount:parseInt(sp.amount)||0,
              dates:newDates,
              payments:sp.paid===true?[{id:Date.now(),qty:qty||0,amount:parseInt(sp.amount)||0,method:"efectivo",date:today,dates:newDates}]:[],
            });
          } else {
            // Update existing last combo
            if(combos.length>0){
              combos[combos.length-1]={...combos[combos.length-1],total:qty,amount:parseInt(sp.amount)||combos[combos.length-1].amount};
            }
          }
          return {...s,combos};
        }));
        } catch(err){ console.error("studentPacks error:", err); }
      }
      return;
    }
    // Store a single class definition with occurrences array
    const dates=cd.occurrences&&cd.occurrences.length>0?cd.occurrences:[cd.date||TODAY_DATE];
    const newClass={
      ...cd,
      id:Date.now(),
      date:dates[0],
      occurrences:dates,
      attendanceLog:[],
      cancelledDates:[],
      rescheduledDates:[],
    };
    setClasses(p=>[...p,newClass]);
    if(cd.studentData&&cd.studentData.length>0){
      setStudents(p=>p.map(s=>{
        const sd=cd.studentData.find(x=>x.id===s.id);
        if(!sd) return s;
        const pkg=packages.find(p=>String(p.id)===String(sd.pack));
        const isIndividual=sd.pack==="individual"||pkg?.type==="individual";
        const isMensual=sd.pack==="mensual"||pkg?.type==="mensual";
        // For individual: total = number of occurrences, dates = all occurrence dates
        const pn=isMensual?null:isIndividual?dates.length:pkg?.qty||parseInt(sd.pack)||null;
        const packType=isMensual?"mensual":isIndividual?"individual":"combo";
        // For individual: use all occurrence dates directly
        const projectedClassDates=isIndividual?[...dates]:(()=>{
          const ds=[];
          if(!pn) return ds;
          if(cd.days&&cd.days.length>0){
            const DAY_MAP={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
            const dowSet=new Set(cd.days.map(d=>DAY_MAP[d]));
            let cur=new Date((cd.date||TODAY_DATE)+"T12:00:00");
            while(ds.length<pn){
              if(dowSet.has(cur.getDay())){
                ds.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
              }
              cur.setDate(cur.getDate()+1);
            }
          } else {
            let cur=new Date((cd.date||TODAY_DATE)+"T12:00:00");
            for(let i=0;i<pn;i++){
              ds.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
              cur.setDate(cur.getDate()+1);
            }
          }
          return ds;
        })();
        const amount=parseInt(sd.amount)||0;
        const paymentEntry=sd.paid&&amount>0?[{id:Date.now(),qty:pn||0,amount,method:"efectivo",date:cd.date||TODAY_DATE,dates:projectedClassDates}]:[];
        // For individual classes: merge into existing active individual combo if exists
        const existingIndividualIdx=s.combos.findIndex(c=>
          (c.packType==="individual"||c.total===1)&&
          c.paid===sd.paid&&
          c.amount===(parseInt(sd.amount)||0)&&
          !(c.dates&&c.dates.some(d=>d<TODAY_DATE&&(c.used||0)>=(c.total||1))) // not fully consumed
        );
        if(isIndividual&&existingIndividualIdx>=0){
          // Add this class date to existing combo
          const existing=s.combos[existingIndividualIdx];
          const newDates=[...new Set([...(existing.dates||[]),...projectedClassDates])].sort();
          const newTotal=(existing.total||1)+1;
          const newPaidCount=sd.paid?(existing.paidCount||0)+1:(existing.paidCount||0);
          const updatedCombos=s.combos.map((c,idx)=>idx===existingIndividualIdx?{
            ...c,total:newTotal,paidCount:newPaidCount,dates:newDates,
            payments:sd.paid&&amount>0?[...(c.payments||[]),{id:Date.now(),qty:1,amount,method:"efectivo",date:cd.date||TODAY_DATE,dates:projectedClassDates}]:(c.payments||[])
          }:c);
          return {...s,combos:updatedCombos};
        }
        return {...s,combos:[...s.combos,{
          id:s.combos.length+1,
          total:pn,
          packType,
          packId:sd.packId||sd.pack||"",
          used:0,
          paid:sd.paid,
          paidCount:sd.paid?(pn||0):0,
          date:sd.pack==="mensual"?(sd.payDate||cd.date||TODAY_DATE):(cd.date||TODAY_DATE),
          payDate:sd.pack==="mensual"?(sd.payDate||cd.date||TODAY_DATE):undefined,
          amount,
          dates:projectedClassDates,
          payments:paymentEntry,
        }]};
      }));
      // Register income in Finanzas for paid students who chose to save payment
      cd.studentData.forEach(sd=>{
        const shouldSave=sd.savePay===undefined?true:sd.savePay;
        if(shouldSave&&sd.paid&&parseInt(sd.amount)>0){
          const pkg=packages.find(p=>String(p.id)===String(sd.pack));
          const studentName=students.find(s=>String(s.id)===String(sd.id))?.name||"Alumno";
          const detail=sd.pack==="mensual"||pkg?.type==="mensual"?"Plan Mensual":
            sd.pack==="individual"||pkg?.type==="individual"?"Clase Individual":
            pkg?.qty?(pkg.qty+" clases"):pkg?.name||"";
          addIncome(parseInt(sd.amount), cd.date||TODAY_DATE, studentName, detail);
        }
      });
    }
  };

  const handleAttendance=(cls)=>{
    const wD=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
    const classDate=cls.date||new Date().toISOString().split("T")[0];
    const day=wD[new Date(classDate+"T12:00:00").getDay()];
    const presentIds=cls.students||[];
    const ausenteDadaIds=cls.ausente_dada||[];
    const ausenteReprogIds=cls.ausente_reprog||[];
    // Resolve to the real class id (support expanded virtual classes)
    const realId=cls._seriesId||cls.id;
    const allClassStudents=classes.find(c=>c.id===realId)?.students||cls.students;
    // Save attendance log with full status
    setClasses(p=>p.map(c=>{
      if(c.id!==realId) return c;
      const log=[...(c.attendanceLog||[]).filter(e=>e.date!==classDate),
        {date:classDate,day,present:presentIds,ausente_dada:ausenteDadaIds,ausente_reprog:ausenteReprogIds}];
      return {...c,attendanceLog:log};
    }));
    // Only increment 'used' for present + ausente_dada (class was given)
    const givenIds=[...presentIds,...ausenteDadaIds];
    setStudents(p=>p.map(s=>{
      if(!allClassStudents.includes(s.id)) return s;
      const wasGiven=givenIds.includes(s.id);
      if(!wasGiven) return s;
      const combos=[...s.combos];
      if(combos.length===0) return s;
      const lastIdx=combos.length-1;
      const last=combos[lastIdx];
      const newUsed=(last.used||0)+1;
      combos[lastIdx]={...last,used:newUsed};
      // Check if combo is now complete (all paid + all given)
      const effectiveTotal=last.total||0;
      const paidCount=last.paidCount!==undefined?last.paidCount:(last.paid?effectiveTotal:0);
      const allGiven=newUsed>=paidCount&&paidCount>=effectiveTotal&&effectiveTotal>0;
      if(allGiven&&last.dates&&last.dates.length>0){
        // Generate next combo dates starting from day after last date
        const myClsForStudent=classes.filter(c=>c.students&&c.students.includes(s.id));
        const classDays=myClsForStudent.length>0?myClsForStudent[0].days:[];
        const DAY_MAP={"Dom":0,"Lun":1,"Mar":2,"Mié":3,"Jue":4,"Vie":5,"Sáb":6};
        const dowSet=new Set(classDays.map(d=>DAY_MAP[d]));
        const lastDate=last.dates[last.dates.length-1];
        let cur=new Date(lastDate+"T12:00:00");
        cur.setDate(cur.getDate()+1);
        const nextDates=[];
        while(nextDates.length<effectiveTotal){
          if(dowSet.size===0||dowSet.has(cur.getDay())){
            nextDates.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0"));
          }
          cur.setDate(cur.getDate()+1);
        }
        // Add new unpaid combo
        combos.push({
          id:combos.length+1,
          total:effectiveTotal,
          packType:last.packType||"combo",
          used:0,
          paid:false,
          paidCount:0,
          date:nextDates[0]||lastDate,
          amount:last.amount,
          dates:nextDates,
          payments:[],
        });
      }
      return {...s,combos};
    }));
    // For ausente_reprog: mark their combo date as needing reschedule
    // (coach will reschedule from Agenda)
  };

  const [pendingReprog,setPendingReprog]=useState(null);
  const handleRefresh=async()=>{if(window._iziUserId)await loadData(window._iziUserId);};

  const handleNavigate=(section,params)=>{
    setTab(section);
    if(params?.subTab&&section==="cobros") setFinanceTab(params.subTab);
    if(params?.subTab&&typeof params.subTab==="string") setFinanceTab(params.subTab);
    if(params?.reprog) setPendingReprog(params.reprog);
  };

  const coachTabs=[
    {id:"dashboard",label:"Inicio"},{id:"students",label:"Alumnos"},
    {id:"agenda",label:"Agenda"},{id:"chat",label:"Chat"},
    {id:"cobros",label:"Cobros"},{id:"finanzas",label:"Finanzas"},
  ];

  if(loadingAuth||checkingProfile){
    return (
    <div style={{width:"100vw",height:"100vh",position:"fixed",top:0,left:0,display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#0D1B4B,#1A3DB5)",zIndex:9999}}>
      <div style={{textAlign:"center",color:"#fff"}}>
        <style>{`
          @keyframes iziBounce {
            0%,100%{transform:scale(1);opacity:1}
            50%{transform:scale(1.12);opacity:0.85}
          }
          @keyframes iziDot {
            0%,80%,100%{transform:scale(0.4);opacity:0.3}
            40%{transform:scale(1);opacity:1}
          }
        `}</style>
        <div style={{fontSize:42,fontWeight:900,letterSpacing:-2,marginBottom:20,animation:"iziBounce 1.5s ease-in-out infinite"}}>
          izi<span style={{color:"#65CE5A"}}>coach</span>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          {[0,1,2].map(i=>(
            <div key={i} style={{width:10,height:10,borderRadius:"50%",background:"#65CE5A",animation:`iziDot 1.2s ease-in-out ${i*0.2}s infinite`}}/>
          ))}
        </div>
      </div>
    </div>
  );
  }

  if(!user&&!mode) return (
    <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column"}}>
      <AuthFlow onLogin={async(u)=>{
        setUserWithRef(u);setCheckingProfile(true);
        const {data}=await supabase.from("coaches").select("name,currency,sport,photo").eq("id",u.id).single();
        if(data?.name){
          setModeP("coach");setOnboardedP(true);if(data.currency)setCUR(data.currency);
          setCoachProfileRaw({name:data.name,sport:data.sport||"",photo:data.photo||null,currency:data.currency||"₲"});
          try{await loadData(u.id);}catch(e){console.error(e);}
        } else {
          // Check if student
          const {data:sa}=await supabase.from("student_auth").select("*").eq("id",u.id).single();
          if(sa){
            lsSet("izi_student_coach_id", sa.coach_id);
            localStorage.setItem("izi_student_id_raw", String(sa.student_id));
            try{
              const {data:cd}=await supabase.from("coach_data").select("*").eq("coach_id",sa.coach_id).single();
              if(cd){
                const tryP=(s,f=[])=>{try{const p=JSON.parse(s);return Array.isArray(p)?p:f;}catch{return f;}};
                const s=tryP(cd.students);const cl=tryP(cd.classes);
                if(s.length>0){setStudentsRaw(s);lsSet("izi_students",s);}
                if(cl.length>0){setClassesRaw(cl);lsSet("izi_classes",cl);}
              }
            }catch(e){}
            setModeP("student_portal");
          } else {
            setModeP("coach_new");setOnboardedP(false);
          }
        }
        setCheckingProfile(false);
      }} onStudentLogin={async(u,inviteInfo)=>{
        setUserWithRef(u);setCheckingProfile(true);setLoadingAuth(false);
        lsSet("izi_student_coach_id", inviteInfo.coach_id);
        localStorage.setItem("izi_student_id_raw", String(inviteInfo.student_id));
        try{
          const {data}=await supabase.from("coach_data").select("*").eq("coach_id",inviteInfo.coach_id).single();
          if(data){
            const tryP=(s,f=[])=>{try{const p=JSON.parse(s);return Array.isArray(p)?p:f;}catch{return f;}};
            const s=tryP(data.students);const cl=tryP(data.classes);
            if(s.length>0){setStudentsRaw(s);lsSet("izi_students",s);}
            if(cl.length>0){setClassesRaw(cl);lsSet("izi_classes",cl);}
          }
        }catch(e){console.error(e);}
        setModeP("student_portal");
        setCheckingProfile(false);
      }}/>
    </div>
  );

  // Expand recurring classes into per-date instances for display
  const xClasses=expandClasses(classes);

  if(mode==="student_portal"){
    const storedStudentIdRaw=localStorage.getItem("izi_student_id_raw")||localStorage.getItem("izi_student_id")||"0";
    const studentData=students.find(s=>String(s.id)===storedStudentIdRaw)||
                      students.find(s=>s.email&&s.email===user?.email)||
                      students[0]||
                      {id:0,name:user?.email||"Alumno",avatar:"A",sport:"",combos:[]};
    return (
      <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",background:C.bg,overflow:"hidden"}}>
        <StudentApp student={studentData||{id:0,name:"Alumno",avatar:"A",sport:"",combos:[]}} onExit={async()=>{await supabase.auth.signOut();setUserWithRef(null);setMode(null);localStorage.clear();}} classes={xClasses} notifications={notifications} sendNotification={sendNotification} coachId={(()=>{try{const v=localStorage.getItem("izi_student_coach_id");return v?JSON.parse(v):null;}catch{return localStorage.getItem("izi_student_coach_id");}})()}/>
      </div>
    );
  }

  if(mode==="student_new") return (
    <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",background:C.bg,overflow:"hidden"}}>
      <StudentApp student={students[students.length-1]||{id:99,name:"Alumno",avatar:"AL",sport:"",combos:[]}} onExit={()=>setMode(null)} classes={xClasses} notifications={notifications} sendNotification={sendNotification}/>
    </div>
  );

  if(mode==="student") return (
    <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",background:C.bg,overflow:"hidden"}}>
      <StudentApp student={{id:99,name:"Martina López",avatar:"ML",sport:"Tenis",phone:"0981 123 456",email:"alumno@test.com",combos:[{id:1,total:8,used:6,paid:true,date:"2026-06-01",amount:400000}]}} onExit={()=>setMode(null)} classes={INIT_CLASSES} notifications={notifications} sendNotification={sendNotification}/>
    </div>
  );

  if((mode==="coach_new"||mode==="coach")&&!onboarded) return (
    <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column"}}>
      <OnboardingFlow onComplete={handleOnboardingComplete}/>
    </div>
  );

  return (
    <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",background:C.bg,overflow:"hidden",position:"relative"}}>
      <TopBar onExit={handleLogout} onConfig={()=>setShowConfig(true)}/>
      <div key={"cur-"+currency} style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",position:"relative",overflow:"hidden",paddingBottom:"calc(64px + env(safe-area-inset-bottom, 34px))"}}>
        {tab==="dashboard"&&isFirstTime&&<EmptyDashboard onNewClass={()=>setShowNewClass(true)} onNewStudent={()=>setShowNewStudent(true)} onInvite={()=>setShowInvite(true)}/>}
        {tab==="dashboard"&&!isFirstTime&&<Dashboard students={students} classes={xClasses} onNavigate={handleNavigate} onNewClass={()=>setShowNewClass(true)} onNewStudent={()=>setShowNewStudent(true)} onInvite={()=>setShowInvite(true)} expenses={expenses} coachProfile={coachProfile} onRefresh={handleRefresh}/>}
        {tab==="students"&&<Students students={students} onAdd={()=>setShowNewStudent(true)} onUpdate={updateStudent} onDelete={(id)=>setStudents(p=>p.filter(s=>s.id!==id))} onChat={(s)=>{setChatTarget(s);setTab("chat");}} classes={xClasses} onInvite={()=>setShowInvite(true)} userId={user?.id} onInviteStudent={(s)=>setInviteTarget(s)} onRefresh={handleRefresh}/>}
        {inviteTarget&&<InviteModal student={inviteTarget} userId={user?.id} onClose={()=>setInviteTarget(null)}/>}
        {tab==="agenda"&&<Agenda students={students} classes={xClasses} rawClasses={classes} onSaveClass={handleSaveClass} onAttendance={handleAttendance} onAddStudent={(d)=>setStudents(p=>[...p,d])} courts={courts} packages={packages} onUpdateStudent={updateStudent} onDeleteClass={handleDeleteClass} pendingReprog={pendingReprog} onClearPendingReprog={()=>setPendingReprog(null)} onAddPackage={(pkg)=>setPackages(p=>[...p,pkg])} onRefresh={handleRefresh}/>}
        {tab==="chat"&&<Chat students={students} initialTarget={chatTarget} onClearTarget={()=>setChatTarget(null)} sendNotification={sendNotification} userId={user?.id} unreadChats={unreadChats} onMarkRead={(sid)=>setUnreadChats(p=>{const n={...p};delete n[String(sid)];return n;})}/>}
        {tab==="cobros"&&<Finances students={students} classes={xClasses} initialTab="payments" onUpdate={updateStudent} expenses={expenses} setExpenses={setExpenses} addIncome={addIncome} packages={packages} sendNotification={sendNotification} onAttendance={handleAttendance}/>}
        {tab==="finanzas"&&<Finances students={students} classes={xClasses} initialTab="expenses" onUpdate={updateStudent} expenses={expenses} setExpenses={setExpenses} addIncome={addIncome} packages={packages}/>}
        {showNewClass&&<NewClassModal onClose={()=>{setShowNewClass(false);if(classes.length===0)setTab("agenda");}} onSave={handleSaveClass} students={students} dateLabel="Nueva clase" onCreateStudent={(d)=>setStudents(p=>[...p,d])} courts={courts} packages={packages} onAddPackage={(pkg)=>setPackages(p=>[...p,pkg])}/>}
        {showNewStudent&&<NewStudentModal onClose={()=>setShowNewStudent(false)} onSave={(d)=>setStudents(p=>[...p,{id:Date.now(),...d}])}/>}
        {showConfig&&<ConfigScreen onClose={()=>setShowConfig(false)} courts={courts} setCourts={setCourts} packages={packages} setPackages={setPackages} coachProfile={coachProfile} setCoachProfile={setCoachProfile}/>}
        {showInvite&&(
          <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",zIndex:999,display:"flex",alignItems:"flex-end"}}>
            <div style={{background:C.white,borderRadius:"24px 24px 0 0",width:"100%",maxHeight:"90%",overflowY:"auto",boxSizing:"border-box",padding:"28px 20px 36px"}}>
              <div style={{fontWeight:900,fontSize:20,color:C.text,marginBottom:4}}>Invitá a tus alumnos</div>
              <div style={{fontSize:13,color:C.mutedDark,marginBottom:20}}>El alumno escanea el QR o usa el link para registrarse y conectarse con vos automáticamente.</div>

              {/* QR Code SVG */}
              <div style={{background:C.bg,borderRadius:16,padding:"20px",textAlign:"center",marginBottom:16}}>
                <div style={{fontSize:12,color:C.mutedDark,marginBottom:12,fontWeight:600}}>ESCANEÁ PARA UNIRTE</div>
                <div style={{display:"inline-block",background:"#fff",padding:12,borderRadius:12,border:"2px solid "+C.border}}>
                  <svg width="160" height="160" viewBox="0 0 160 160">
                    {/* QR pattern - simplified visual */}
                    {[...Array(16)].map((_,row)=>[...Array(16)].map((_,col)=>{
                      // Create a deterministic pattern based on coach name
                      const hash=(row*16+col+row*col)%7;
                      const isFinder=(row<3&&col<3)||(row<3&&col>12)||(row>12&&col<3);
                      const isData=hash<3;
                      return (isFinder||isData)?(
                        <rect key={`${row}-${col}`} x={col*10} y={row*10} width={9} height={9} fill="#1A237E" rx={1}/>
                      ):null;
                    }))}
                    {/* Finder patterns */}
                    <rect x={0} y={0} width={30} height={30} fill="none" stroke="#1A237E" strokeWidth={3} rx={3}/>
                    <rect x={130} y={0} width={30} height={30} fill="none" stroke="#1A237E" strokeWidth={3} rx={3}/>
                    <rect x={0} y={130} width={30} height={30} fill="none" stroke="#1A237E" strokeWidth={3} rx={3}/>
                    <rect x={10} y={10} width={10} height={10} fill="#1A237E"/>
                    <rect x={140} y={10} width={10} height={10} fill="#1A237E"/>
                    <rect x={10} y={140} width={10} height={10} fill="#1A237E"/>
                    {/* Logo in center */}
                    <rect x={65} y={65} width={30} height={30} fill="#fff" rx={4}/>
                    <text x={80} y={85} textAnchor="middle" fontSize={10} fontWeight="900" fill={C.blue2}>izi</text>
                  </svg>
                </div>
                <div style={{fontSize:11,color:C.mutedDark,marginTop:10}}>Coach: {coachProfile.name}</div>
              </div>

              {/* Link */}
              <div style={{fontSize:12,fontWeight:700,color:C.mutedDark,marginBottom:8}}>O COMPARTÍ EL LINK</div>
              <div style={{background:C.blueL,borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{flex:1,fontSize:12,color:C.blue2,fontWeight:600,wordBreak:"break-all"}}>
                  {"https://izicoach.app/join/"+coachProfile.name.toLowerCase().replace(/\s+/g,"-")}
                </div>
                <button onClick={()=>{
                  const link="https://izicoach.app/join/"+coachProfile.name.toLowerCase().replace(/\s+/g,"-");
                  navigator.clipboard?.writeText(link).catch(()=>{});
                }} style={{background:C.blue2,border:"none",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:700,flexShrink:0}}>Copiar</button>
              </div>

              {/* Share buttons */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                {[
                  {label:"📱 WhatsApp",bg:"#25D366",msg:"Únete a mis clases en izicoach: https://izicoach.app/join/"+coachProfile.name.toLowerCase().replace(/\s+/g,"-")},
                  {label:"✉️ Email",bg:C.blue2,msg:""},
                ].map(s=>(
                  <button key={s.label} onClick={()=>{
                    if(s.label.includes("WhatsApp")){
                      window.open("https://wa.me/?text="+encodeURIComponent(s.msg),"_blank");
                    }
                  }} style={{padding:"11px",borderRadius:12,border:"none",background:s.bg,color:"#fff",fontSize:13,cursor:"pointer",fontWeight:700}}>{s.label}</button>
                ))}
              </div>

              {/* Info */}
              <div style={{background:"#E8F5E9",borderRadius:12,padding:"12px 14px",marginBottom:16,display:"flex",gap:10}}>
                <span style={{fontSize:18}}>ℹ️</span>
                <div style={{fontSize:12,color:"#2E7D32",lineHeight:1.5}}>
                  Cuando el alumno escanea el QR o abre el link, se registra automáticamente y queda conectado con vos. Podés ver sus clases, cobros y chatear desde la app.
                </div>
              </div>

              <button onClick={()=>setShowInvite(false)} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:C.bg,color:C.mutedDark,fontSize:14,cursor:"pointer",fontWeight:700}}>Cerrar</button>
            </div>
          </div>
        )}
      </div>
      <NavBar tabs={coachTabs} active={tab} onSelect={(t)=>{setTab(t);}} zIdx={100} badges={{chat:Object.values(unreadChats).reduce((a,b)=>a+b,0)||0}}/>
    </div>
  );
}
