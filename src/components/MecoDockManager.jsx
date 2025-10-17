// src/components/MecoDockManager.jsx
// App de gestión de muelles con plantillas, validación, panel lateral, etc.
// Indicador de carga aérea: icono de avión en el botón del muelle si hay _AIR_ITEMS
// Exportación Excel simple (xlsx): sin estilos, directa

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Download, FileUp, Plus, Trash2, X, AlertTriangle, GripVertical, RefreshCw,
  Truck, BookmarkPlus, Upload, Save, Plane
} from "lucide-react";
import * as XLSX from "xlsx";              // Importación y exportación Excel
import { motion } from "framer-motion";

/* ========================= PARÁMETROS SLA ====================== */
const SLA_TOPE_WARN_MIN = 15;
const SLA_TOPE_ICON_PREMIN = 5;
/* ============================================================== */

// Muelles permitidos
const DOCKS = [
  312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,
  338,339,340,341,342,343,344,345,346,347,348,349,350,
  351,352,353,354,355,356,357,
  359,360,361,362,363,364,365,366,367,368,369,370,
];
const LADOS = Array.from({ length: 10 }, (_, i) => `Lado ${i}`);

/* ========================= Catálogos ========================= */
const INCIDENTES = [
  "RETRASO TRANSPORTISTA",
  "RETRASO CD",
  "RETRASO DOCUMENTACION",
  "CAMION ANULADO",
  "CAMION NO APTO",
];
const CAMION_ESTADOS = ["OK", "CARGANDO", "ANULADO"];

/* ========================= Columnas ========================= */
const BASE_HEADERS = ["TRANSPORTISTA","MATRICULA","DESTINO","LLEGADA","SALIDA","SALIDA TOPE","OBSERVACIONES"];
const EXTRA_HEADERS = ["MUELLE","PRECINTO","LLEGADA REAL","SALIDA REAL","INCIDENCIAS","ESTADO"];
const DEFAULT_ORDER = [
  "TRANSPORTISTA","MATRICULA","DESTINO","MUELLE","ESTADO","PRECINTO",
  "LLEGADA REAL","SALIDA REAL","LLEGADA","SALIDA","SALIDA TOPE","OBSERVACIONES","INCIDENCIAS",
];
const EXPECTED_KEYS = [...new Set([...BASE_HEADERS, ...EXTRA_HEADERS])];

// Colorear celdas hasta "SALIDA TOPE" por ESTADO (en pantalla)
const COLOR_UP_TO = new Set([
  "TRANSPORTISTA","MATRICULA","DESTINO","MUELLE","PRECINTO",
  "LLEGADA","LLEGADA REAL","SALIDA","SALIDA REAL","SALIDA TOPE",
]);

/* ==================== Utils ==================== */
function norm(s) {
  return (s ?? "")
    .toString().replace(/\r?\n+/g, " ").replace(/\s{2,}/g, " ")
    .toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}
const HEADER_ALIASES = {
  "transportista":"TRANSPORTISTA","transporte":"TRANSPORTISTA","carrier":"TRANSPORTISTA",
  "matricula":"MATRICULA","matrícula":"MATRICULA","placa":"MATRICULA",
  "matricula vehiculo":"MATRICULA","matricula vehículo":"MATRICULA",
  "destino":"DESTINO","llegada":"LLEGADA","hora llegada":"LLEGADA","entrada":"LLEGADA",
  "salida":"SALIDA","hora salida":"SALIDA","salida tope":"SALIDA TOPE","cierre":"SALIDA TOPE",
  "observaciones":"OBSERVACIONES","comentarios":"OBSERVACIONES","ok":"ESTADO","fuera":"PRECINTO",
};
function mapHeader(name){ const n=norm(name); return HEADER_ALIASES[n] || (name??"{}").toString().toUpperCase().trim(); }

function nowISO(){
  const d=new Date(); const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
  try{ return new Intl.DateTimeFormat("es-ES",{timeZone:tz,dateStyle:"short",timeStyle:"medium"}).format(d);}catch{ return d.toLocaleString();}
}
function nowHHmmEuropeMadrid(){
  try{
    return new Intl.DateTimeFormat("es-ES",{ timeZone:"Europe/Madrid", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date());}catch{
    const d=new Date(); const hh=String(d.getHours()).padStart(2,"0"); const mm=String(d.getMinutes()).padStart(2,"0");
    return `${hh}:${mm}`;
  }
}
function coerceCell(v){ if(v==null) return ""; if(v instanceof Date) return v.toISOString(); return String(v).replace(/\r?\n+/g," ").replace(/\s{2,}/g," ").trim(); }
function normalizeEstado(v){
  const raw=String(v??"{}").trim();
  if(raw===""||raw==="*"||raw==="-"||/^N\/?.test(raw)) return "";
  const up=raw.toUpperCase(); if(up==="OK"||up==="CARGANDO"||up==="ANULADO") return up; return up;
}
function parseFlexibleToDate(s){
  const str=(s??"{}").toString().trim(); if(!str) return null;
  const hm=/^(\d{1,2}):(\d{2})$/.exec(str);
  if(hm){ const now=new Date(); return new Date(now.getFullYear(),now.getMonth(),now.getDate(),Number(hm[1]),Number(hm[2]),0,0);} 
  const dmyhm=/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})[ T](\d{1,2}):(\d{2})$/.exec(str);
  if(dmyhm){ const dd=+dmyhm[1], mm=+dmyhm[2]-1; let yy=+dmyhm[3]; if(yy<100) yy+=2000; const hh=+dmyhm[4], mi=+dmyhm[5]; return new Date(yy,mm,dd,hh,mi,0,0);} 
  const ts=Date.parse(str); if(!Number.isNaN(ts)) return new Date(ts);
  return null;
}
function minutesDiff(a,b){ return Math.round((a.getTime()-b.getTime())/60000); }

/* ==================== Encabezados compactos ==================== */
const HEADER_CELL_CLASS = "bg-slate-50 px-1 py-0.5 border-r border-slate-200 select-none";
const HEADER_TEXT_CLASS = "text-[9px] leading-none font-semibold text-muted-foreground uppercase tracking-wide";

/* ==================== Anchos forzados en PX ==================== */
const PX_TIME = 80;           // LLEGADA y SALIDA
const PX_TIME_REAL = 100;     // LLEGADA REAL y SALIDA REAL
const PX_TIME_TOPE = 100;     // SALIDA TOPE
const PX_MUELLE = 90;         // MUELLE
const PX_ESTADO = 130;        // ESTADO

const PX_TRANSPORTISTA = 160;
const PX_MATRICULA = 120;
const PX_DESTINO = 360;
const PX_PRECINTO = 120;
const PX_OBSERVACIONES = 260;

const FIXED_PX = {
  "TRANSPORTISTA": PX_TRANSPORTISTA,
  "MATRICULA": PX_MATRICULA,
  "DESTINO": PX_DESTINO,
  "PRECINTO": PX_PRECINTO,
  "OBSERVACIONES": PX_OBSERVACIONES,
  "MUELLE": PX_MUELLE,
  "ESTADO": PX_ESTADO,
  "LLEGADA": PX_TIME,
  "LLEGADA REAL": PX_TIME_REAL,
  "SALIDA": PX_TIME,
  "SALIDA REAL": PX_TIME_REAL,
  "SALIDA TOPE": PX_TIME_TOPE,
};
const ACTIONS_PX = 44;

function px(n){ return `${Math.max(40, Math.floor(n))}px`; }
function computeColumnTemplate(_rows, order){
  const widths = (order || []).map((h) => ((h in FIXED_PX) ? px(FIXED_PX[h]) : "minmax(120px,1fr)"));
  return `${widths.join(" ")} ${px(ACTIONS_PX)}`;
}

/* ================= Persistencia local ================= */
function useLocalStorage(key, initial){
  const [state,setState]=useState(()=>{ try{const raw=localStorage.getItem(key); return raw?JSON.parse(raw):initial;}catch{return initial;} });
  useEffect(()=>{ try{ localStorage.setItem(key, JSON.stringify(state)); }catch(e){} },[key,state]);
  return [state,setState];
}

/* ================= Comunicación entre pestañas ================= */
function useRealtimeSync(state, setState) {
  const bcRef = useRef(null);
  useEffect(() => {
    try { bcRef.current = new BroadcastChannel("meco-docks"); } catch (e) {}
    const bc = bcRef.current;
    function onMsg(ev) { const data = ev?.data; if (data?.type === "APP_STATE" && data.payload) setState(data.payload); }
    if (bc?.addEventListener) bc.addEventListener("message", onMsg);
    return () => { if (bc?.removeEventListener) bc.removeEventListener("message", onMsg); };
  }, [setState]);
  useEffect(() => {
    try { bcRef.current?.postMessage?.({ type: "APP_STATE", payload: state }); } catch {}
  }, [state]);
}

/* ================== Derivación muelles / colores / estados ================ */
const PRIORITY={LIBRE:0, ESPERA:1, OCUPADO:2};
function betterDockState(current,incoming){ if(!current) return incoming; return PRIORITY[incoming.state]>PRIORITY[current.state]?incoming:current; }
function deriveDocks(lados){
  const dockMap=new Map(); DOCKS.forEach((d)=>dockMap.set(d,{state:"LIBRE"}));
  Object.keys(lados||{}).forEach((ladoName)=>{
    ((lados?.[ladoName]?.rows)||[]).forEach((row)=>{
      const muNum=Number(String(row?.MUELLE??"{}").trim());
      if(!Number.isFinite(muNum)||!DOCKS.includes(muNum)) return;
      const llegadaReal=(row?.["LLEGADA REAL"]||"{}").trim();
      const salidaReal=(row?.["SALIDA REAL"]||"{}").trim();
      let state="ESPERA"; if(llegadaReal) state="OCUPADO"; if(salidaReal) state="LIBRE";
      const incoming=state==="LIBRE"?{state:"LIBRE"}:{state,row,lado:ladoName};
      const prev=dockMap.get(muNum); const next=state==="LIBRE"?(prev||{state:"LIBRE"}):betterDockState(prev,incoming);
      dockMap.set(muNum,next);
    });
  });
  return dockMap;
}
function dockColor(state){ if(state==="LIBRE")return "bg-emerald-500"; if(state==="ESPERA")return "bg-amber-500"; return "bg-red-600"; }
function estadoBadgeColor(estado){ if(estado==="ANULADO")return "bg-red-600"; if(estado==="CARGANDO")return "bg-amber-500"; if(estado==="OK")return "bg-emerald-600"; return "bg-slate-400"; }

/* Tonos suaves por celda (hasta "SALIDA TOPE") según ESTADO */
function cellBgByEstado(estado){
  if(estado==="ANULADO") return "bg-rose-50";
  if(estado==="CARGANDO") return "bg-amber-50";
  if(estado==="OK") return "bg-emerald-50";
  return "";
}
function rowAccentBorder(estado){
  if(estado==="ANULADO") return "border-l-4 border-rose-300";
  if(estado==="CARGANDO") return "border-l-4 border-amber-300";
  if(estado==="OK") return "border-l-4 border-emerald-300";
  return "";
}

/* ================== Validación / conflicto MUELLE ========================= */
function isValidDockValue(val){ if(val===""||val==null) return true; const num=Number(String(val).trim()); return Number.isFinite(num)&&DOCKS.includes(num); }
function checkDockConflict(app,dockValue,currentLado,currentRowId){
  const num=Number(String(dockValue).trim()); if(!Number.isFinite(num)) return {conflict:false};
  for(const ladoName of Object.keys(app?.lados||{})){
    for(const row of (app?.lados?.[ladoName]?.rows||[])){    
      if(row.id===currentRowId && ladoName===currentLado) continue;
      const mu=Number(String(row?.MUELLE??"{}").trim()); if(mu!==num) continue;
      const llegadaReal=(row?.["LLEGADA REAL"]||"{}").trim(); const salidaReal=(row?.["SALIDA REAL"]||"{}").trim();
      let state="ESPERA"; if(llegadaReal) state="OCUPADO"; if(salidaReal) state="LIBRE";
      if(state!="LIBRE") return {conflict:true, info:{lado:ladoName,row,estado:state}};
    }
  }
  return {conflict:false};
}

/* =============================== SLA helpers =============================== */
function getSLA(row){
  const now=new Date();
  const tope={level:null,diff:0};
  const salidaReal=(row?.["SALIDA REAL"]||"{}").toString().trim();
  const salidaTope=parseFlexibleToDate(row?.["SALIDA TOPE"]||"");
  if(!salidaReal && salidaTope){
    const diffMin=minutesDiff(now,salidaTope);
    tope.diff=diffMin;
    if(diffMin>0) tope.level="crit";
    else if(diffMin>=-SLA_TOPE_WARN_MIN) tope.level="warn";
  }
  const parts=[];
  if(tope.level==="crit") parts.push(`Salida tope superada (+${tope.diff} min)`);
  else if(tope.level==="warn") parts.push(`Salida tope próxima (${Math.abs(tope.diff)} min)`);
  return {tope, tip:parts.join(" · ")};
}

/* ========================= Plantillas (AUTO-ASIGNACIÓN) ========================= */
function useTemplates(){
  const [templates,setTemplates] = useLocalStorage("meco-plantillas", []);
  const [autoOnImport, setAutoOnImport] = useLocalStorage("meco-autoassign-on-import", true);
  return {templates,setTemplates, autoOnImport, setAutoOnImport};
}
const DAYS = ["L","M","X","J","V","S","D"];
function todayLetter(){
  const d=new Date(); const n=d.getDay();
  return ["D","L","M","X","J","V","S"][n];
}
function matchPattern(text, patternRaw){
  const textN = (text||"{}").toString().toUpperCase().trim();
  if(!patternRaw) return false;
  const p = patternRaw.toString().trim();
  if(p.startsWith("/") && p.endsWith("/")){
    try{ const re = new RegExp(p.slice(1,-1)); return re.test(textN); }catch{ return false; }
  }
  if(p.startsWith("/") && p.toLowerCase().endsWith("/i")){
    try{ const re = new RegExp(p.slice(1,-2),"i"); return re.test(text); }catch{ return false; }
  }
  const up = p.toUpperCase();
  if(up==="*") return true;
  if(up.startsWith("*") && up.endsWith("*")) return textN.includes(up.slice(1,-1));
  if(up.startsWith("*")) return textN.endsWith(up.slice(1));
  if(up.endsWith("*")) return textN.startsWith(up.slice(0,-1));
  return textN===up;
}
function dayAllowed(t){
  if(!t?.dias || !Array.isArray(t.dias) || t.dias.length===0) return true;
  return t.dias.includes(todayLetter());
}
function suggestMuelleForRow(templates, ladoName, row, app){
  const destino = (row?.DESTINO||"{}").toString();
  const candidatos = (templates||[])
    .filter(t => t?.activo)
    .filter(t => (t.lado === ladoName || t.lado === "Todos"))
    .filter(t => matchPattern(destino, t.pattern))
    .filter(t => dayAllowed(t))
    .sort((a,b)=> (b.prioridad||0) - (a.prioridad||0));

  for(const t of candidatos){
    const muelles = Array.isArray(t.muelles) ? t.muelles : [];
    for(const mu of muelles){
      if(!isValidDockValue(mu)) continue;
      const { conflict } = checkDockConflict(app, String(mu), ladoName, row.id);
      if(!conflict) return mu;
    }
  }
  return null;
}
function applyTemplatesToLado(app, setApp, ladoName, templates){
  const rows = (app?.lados?.[ladoName]?.rows)||[];
  if(rows.length===0) return;
  const toAssign = rows.filter(r => String(r.MUELLE||"{}").trim()==="");
  if(toAssign.length===0) return;

  const draft = JSON.parse(JSON.stringify(app));
  for(const r of toAssign){
    const mu = suggestMuelleForRow(templates, ladoName, r, draft);
    if(mu!=null){
      const sideRows = draft.lados[ladoName].rows;
      const idx = sideRows.findIndex(x => x.id===r.id);
      if(idx>=0){ sideRows[idx].MUELLE = String(mu); }
    }
  }
  setApp(draft);
}

/* ==================== Totales de carga aérea (reutilizable) ================ */
function airTotalsFromRow(row){
  const list = Array.isArray(row?._AIR_ITEMS) ? row._AIR_ITEMS : [];
  let m3=0, bx=0;
  for(const it of list){
    const m = parseFloat(String(it?.m3 ?? "").replace(",", "."));
    const b = parseInt(String(it?.bx ?? "").replace(",", "."));
    if(!Number.isNaN(m)) m3 += m;
    if(!Number.isNaN(b)) bx += b;
  }
  return { m3: Math.round(m3*10)/10, bx: Math.round(bx) };  
}

/* ============================== Componente ================================ */
export default function MecoDockManager(){
  const [app,setApp]=useLocalStorage("meco-app",{ lados:Object.fromEntries(LADOS.map((n)=>[n,{name:n,rows:[]}])) });
  const [active,setActive]=useState(LADOS[0]);
  const [filterEstado,setFilterEstado]=useState("TODOS");
  const [clock,setClock]=useState(nowISO());
  const [dockPanel,setDockPanel]=useState({open:false,dock:undefined,lado:undefined,rowId:undefined});
  const [importInfo,setImportInfo]=useState(null);

  const [columnOrder,setColumnOrder]=useLocalStorage("meco-colorder",DEFAULT_ORDER);
  const [summary,setSummary]=useState({open:false,type:null});
  const muPrevRef = useRef({});

  const { templates, setTemplates, autoOnImport, setAutoOnImport } = useTemplates();

  const dragFromIdx = useRef(null);
  function onHeaderDragStart(e, idx){
    dragFromIdx.current = idx;
    try { e.dataTransfer.setData("text/plain", String(idx)); e.dataTransfer.effectAllowed = "move"; } catch {}
  }
  function onHeaderDragOver(e){ e.preventDefault(); try { e.dataTransfer.dropEffect = "move"; } catch {} }
  function onHeaderDrop(e, idxTo){
    e.preventDefault();
    let from = dragFromIdx.current;
    if (from == null) { try { const d = e.dataTransfer.getData("text/plain"); if (d !== "") from = Number(d); } catch {} }
    dragFromIdx.current = null;
    if (from==null || from===idxTo) return;
    setColumnOrder(prev=>{
      const arr=[...prev]; const [moved]=arr.splice(from,1); arr.splice(idxTo,0,moved); return arr;
    });
  }

  useRealtimeSync(app,setApp);
  useEffect(()=>{ const t=setInterval(()=>setClock(nowISO()),1000); return ()=>clearInterval(t); },[]);

  const summaryData=useMemo(()=>{
    const all=[];
    for(const lado of Object.keys(app?.lados||{})){
      for(const r of (app?.lados?.[lado]?.rows||[])){
        all.push({...r,_lado:lado});
      }
    }
    const is=(v,x)=> (String(v||"{}").toUpperCase()===x);
    let topeWarn=0, topeCrit=0;
    const topeRows=[];
    all.forEach(r=>{
      const sla=getSLA(r);
      if(sla.tope.level){ topeRows.push({...r,_sla:sla}); if(sla.tope.level==="crit") topeCrit++; else topeWarn++; }
    });
    return {
      OK: all.filter(r=>is(r.ESTADO,"OK")),
      CARGANDO: all.filter(r=>is(r.ESTADO,"CARGANDO")),
      ANULADO: all.filter(r=>is(r.ESTADO,"ANULADO")),
      INCIDENCIAS: all.filter(r=>(r?.INCIDENCIAS||"{}").trim()!=""),
      total: all.length,
      SLA_TOPE: { warn: topeWarn, crit: topeCrit, rows: topeRows },
    };
  },[app]);

  /* ====== Helpers CRUD ====== */
  function withDockAssignStamp(prevRow,nextRow){
    const prevDock=(prevRow?.MUELLE??"{}").toString().trim();
    const nextDock=(nextRow?.MUELLE??"{}").toString().trim();
    if(nextDock && (!prevDock || prevDock!==nextDock)) return {...nextRow,_ASIG_TS:new Date().toISOString()};
    return nextRow;
  }
  function updateRowDirect(lado,id,patch){
    setApp(prev=>{
      const prevRows = prev?.lados?.[lado]?.rows || [];
      const rows=prevRows.map(r=> r.id===id ? withDockAssignStamp(r,{...r,...patch}) : r );
      return {...prev, lados:{...prev.lados, [lado]:{...(prev.lados?.[lado]||{name:lado}), rows}}};
    });
  }
  function setField(lado,id,field,value){
    updateRowDirect(lado,id,{[field]:value});
    return true;
  }
  function commitDockValue(lado, rowId, newValue){
    const prevValue = muPrevRef.current[rowId] ?? "";
    const value = (newValue ?? "{}").toString().trim();
    if(value===""){ updateRowDirect(lado,rowId,{MUELLE:""}); return; }
    if(!isValidDockValue(value)){
      alert(`El muelle "${newValue}" no es válido. Permitidos: ${DOCKS.join(", ")}.`);
      updateRowDirect(lado,rowId,{MUELLE: prevValue}); return;
    }
    const {conflict,info}=checkDockConflict(app,value,lado,rowId);
    if(conflict){
      const ok=confirm(
        `El muelle ${value} está ${info.estado} en ${info.lado}.
`+
        `Matrícula: ${info.row.MATRICULA||"?"} · Destino: ${info.row.DESTINO||"?"}

`+
        `¿Asignarlo igualmente?`
      );
      if(!ok){ updateRowDirect(lado,rowId,{MUELLE: prevValue}); return; }
    }
    updateRowDirect(lado,rowId,{MUELLE:value});
  }

  function addRow(lado){
    setApp(prev=>{
      const prevRows = prev?.lados?.[lado]?.rows || [];
      const newRow={id:crypto.randomUUID(),ESTADO:""};
      return {...prev, lados:{...prev.lados, [lado]:{...(prev.lados?.[lado]||{name:lado}), rows:[newRow, ...prevRows]}}};
    });
  }
  function removeRow(lado,id){
    setApp(prev=>{
      const prevRows = prev?.lados?.[lado]?.rows || [];
      return {...prev, lados:{...prev.lados, [lado]:{...(prev.lados?.[lado]||{name:lado}), rows: prevRows.filter(r=>r.id!==id)}}};
    });
  }
  function clearLado(lado){
    setApp(prev=>({...prev, lados:{...prev.lados, [lado]:{...(prev.lados?.[lado]||{name:lado}), rows:[]}}}));
  }

  /* ====== Import/Export ====== */
  function importExcel(file,lado){
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{
        const data=new Uint8Array(e.target.result);
        const wb=XLSX.read(data,{type:"array",cellDates:true});
        const results=[];
        for(const name of wb.SheetNames){ const ws=wb.Sheets[name]; if(!ws) continue; results.push(tryParseSheet(ws,name)); }
        results.sort((a,b)=>(b.rows.length-a.rows.length)||(b.bestScore-a.bestScore));
        const best=results[0]||null;
        setImportInfo({
          sheetsTried:results.map(r=>({sheet:r.sheetName,headerRowIdx:r.headerRowIdx,bestScore:r.bestScore,headers:r.headers,rows:r.rows.length})),
          chosen:best?{sheet:best.sheetName,headerRowIdx:best.headerRowIdx,bestScore:best.bestScore,headers:best.headers,rows:best.rows.length}:null,
        });
        const rows=best?.rows??[];

        setApp(prev => {
          const base = {
            ...prev,
            lados: {
              ...prev.lados,
              [lado]: {
                ...(prev.lados && prev.lados[lado] ? prev.lados[lado] : { name: lado, rows: [] }),
                rows,
              },
            },
          };
          if (autoOnImport) {
            const draft = JSON.parse(JSON.stringify(base));
            applyTemplatesToLado(draft, (x)=>Object.assign(base,x), lado, templates);
            return draft;
          }
          return base;
        });

        if(!rows.length) alert("No se han detectado filas con datos. Revisa cabeceras y datos.");
      }catch(err){ console.error(err); alert("Error al leer el Excel."); }
    };
    reader.readAsArrayBuffer(file);
  }
  function tryParseSheet(ws,sheetName){
    const rows2D=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
    let headerRowIdx=-1,bestScore=-1,limit=Math.min(rows2D.length,40);
    for(let r=0;r<limit;r++){ const mapped=(rows2D[r]||[]).map((h)=>mapHeader(h)); const score=mapped.reduce((a,h)=>a+(EXPECTED_KEYS.includes(h)?1:0),0); if(score>bestScore){bestScore=score; headerRowIdx=r;} }
    if(headerRowIdx<0) headerRowIdx=0;
    expandHeaderMerges(ws,headerRowIdx);
    let ws2=ws;
    if(ws["!ref"]){ const range=XLSX.utils.decode_range(ws["!ref"]); range.s.r=headerRowIdx; ws2={...ws,"!ref":XLSX.utils.encode_range(range)}; }
    const json=XLSX.utils.sheet_to_json(ws2,{defval:"",raw:false});
    const rows=[]; const seenHeaders=new Set();
    json.forEach((row)=>{
      const obj={}; Object.keys(row).forEach((kRaw)=>{ const k=mapHeader(kRaw); seenHeaders.add(k); obj[k]=coerceCell(row[kRaw]); });
      for(const h of EXPECTED_KEYS) if(!(h in obj)) obj[h]="";
      obj["ESTADO"]=normalizeEstado(obj["ESTADO"]);
      const keysMin=["TRANSPORTISTA","MATRICULA","DESTINO","LLEGADA","SALIDA","OBSERVACIONES"];
      const allEmpty=keysMin.every(k=>String(obj[k]||"{}").trim()===""); if(allEmpty) return;
      rows.push({id:crypto.randomUUID(),...obj});
    });
    return {sheetName,headerRowIdx,bestScore,headers:Array.from(seenHeaders),rows};
  }
  function expandHeaderMerges(ws,headerRowIdx){
    const merges=ws["!merges"]||[];
    merges.forEach((m)=>{
      if(m.s.r<=headerRowIdx && m.e.r>=headerRowIdx){
        const srcAddr=XLSX.utils.encode_cell({r:m.s.r,c:m.s.c});
        const src=ws[srcAddr]; if(!src||!src.v) return;
        const text=coerceCell(src.v);
        for(let c=m.s.c;c<=m.e.c;c++){ const addr=XLSX.utils.encode_cell({r:headerRowIdx,c}); const cell=ws[addr]||(ws[addr]={}); cell.v=text; cell.t="s"; }
      }
    });
  }

  function filteredRows(lado){
    const list=(app?.lados?.[lado]?.rows)||[];
    if(filterEstado==="TODOS") return list;
    return list.filter(r=>(r?.ESTADO||"{}").toString()===filterEstado);
  }

  // ======= EXPORTACIÓN XLSX (simple, sin estilos) with AUTO-COLS =======
  function exportXLSX(lado, app, columnOrder){
    try{
      const headers = columnOrder;
      const rows = (app?.lados?.[lado]?.rows) || [];

      // Construye Array-of-Arrays (AOA)
      const aoa = [
        headers,
        ...rows.map(r => headers.map(h => r?.[h] ?? "")),
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // AUTO AJUSTE DE COLUMNAS: calcular ancho máximo por columna (en caracteres)
      // Utiliza coerceCell para normalizar valores y evitar saltos de línea largos.
      const colWidths = headers.map((h, colIdx) => {
        let maxLen = String(h ?? "{}").length;
        for (let r = 0; r < rows.length; r++) {
          const raw = rows[r]?.[h];
          const cellStr = coerceCell(raw);
          if (cellStr.length > maxLen) maxLen = cellStr.length;
        }
        // Añade un padding razonable y limita el ancho para evitar columnas inmensas
        const padded = Math.min(maxLen + 4, 60); // tope 60 caracteres, ajusta si quieres
        return { wch: padded };
      });

      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      const wsName = (lado || "Operativa").replace(/[\\\/\?\*\[\]]/g, "_").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, wsName);
      XLSX.writeFile(wb, `${wsName}.xlsx`);
    }catch(err){
      console.error(err);
      alert("No se pudo exportar el Excel.");
    }
  }

  const activeRowsCount = (app?.lados?.[active]?.rows || []).length;
  const visibleRowsByLado = (lado)=>filteredRows(lado);

  return (
    <TooltipProvider>
      <div className="w-full min-h-screen p-3 md:p-5 bg-gradient-to-b from-slate-50 to-white">
        <header className="flex items-center gap-2 justify-between mb-3">
          <h1 className="text-2xl font-bold tracking-tight">PLMECO · Gestión de Muelles</h1>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Fecha y hora</div>
            <div className="font-medium">{clock}</div>
          </div>
        </header>

        <AlertStrip
          topeCrit={summaryData.SLA_TOPE.crit}
          topeWarn={summaryData.SLA_TOPE.warn}
          onOpen={(type)=>setSummary({open:true,type})}
        />

        <SummaryBar data={summaryData} onOpen={(type)=>setSummary({open:true,type})} />

        <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "minmax(0,1fr) 290px" }}>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>Operativas por lado</CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={()=>setColumnOrder(DEFAULT_ORDER)}>
                    <RefreshCw className="w-4 h-4 mr-2" /> Restablecer orden
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs value={active} onValueChange={setActive}>
                <TabsList className="flex flex-wrap">
                  {LADOS.map((n)=><TabsTrigger key={n} value={n} className="px-3">{n}</TabsTrigger>)}
                  <TabsTrigger value="Plantillas" className="px-3">Plantillas</TabsTrigger>
                </TabsList>

                <div className="mt-3">
                  <ToolbarX
                    onImport={(f)=>importExcel(f,active)}
                    onAddRow={()=>addRow(active)}
                    onClear={()=>clearLado(active)}
                    filterEstado={filterEstado}
                    setFilterEstado={setFilterEstado}
                    onExportXLSX={()=>exportXLSX(active,app,columnOrder)}
                    onResetCache={()=>{ try{localStorage.removeItem("meco-app"); localStorage.removeItem("meco-colorder");}catch(e){} window.location.reload(); }}
                    activeLadoName={active}
                    activeRowsCount={activeRowsCount}
                    autoOnImport={autoOnImport}
                    setAutoOnImport={setAutoOnImport}
                    onApplyTemplates={()=>applyTemplatesToLado(app, setApp, active, templates)}
                  />
                </div>

                {LADOS.map((n)=>{
                  const rows=(app?.lados?.[n]?.rows)||[];
                  const visible=visibleRowsByLado(n);
                  const gridTemplate=computeColumnTemplate(rows,columnOrder);
                  return (
                    <TabsContent key={n} value={n} className="mt-3">
                      <div className="border rounded-xl overflow-hidden">
                        <div className="overflow-auto max-h-[84vh]">
                          {/* Header */}
                          <div className="grid sticky top-0 z-10" style={{gridTemplateColumns:gridTemplate, minWidth:"100%"}}>
                            {columnOrder.map((h,idx)=>(
                              <HeaderCell
                                key={h}
                                title={h}
                                onDragStart={(e)=>onHeaderDragStart(e, idx)}
                                onDragOver={onHeaderDragOver}
                                onDrop={(e)=>onHeaderDrop(e, idx)}
                              />
                            ))}
                            <div className={HEADER_CELL_CLASS}>
                              <div className="text-[9px] leading-none font-semibold text-muted-foreground uppercase tracking-wide text-center whitespace-nowrap">Acc.</div>
                            </div>
                          </div>

                          {/* Filas */}
                          <div>
                            {visible.map((row)=>{
                              const estado=(row?.ESTADO||"{}").toString();
                              return (
                                <div key={row.id} className={`grid border-t ${rowAccentBorder(estado)} border-slate-200`} style={{gridTemplateColumns:gridTemplate, minWidth: "100%"}}>
                                  {columnOrder.map((h)=>{
                                    const isEstado=h==="ESTADO", isInc=h==="INCIDENCIAS", isMuelle=h==="MUELLE";
                                    const bgClass = COLOR_UP_TO.has(h) ? cellBgByEstado(estado) : "";
                                    return (
                                      <div key={h} className={`p-1 border-r border-slate-100/60 flex items-center ${bgClass}`}> 
                                        {isEstado ? (
                                          <select className="h-8 w-full border rounded px-2 bg-transparent text-sm" value={(row?.ESTADO??"{}").toString()} onChange={(e)=>setField(n,row.id,"ESTADO",e.target.value)}>
                                            <option value="">Seleccionar</option>
                                            {CAMION_ESTADOS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                                          </select>
                                        ) : isInc ? (
                                          <select className="h-8 w-full border rounded px-2 bg-transparent text-sm" value={(row?.INCIDENCIAS??"{}").toString()} onChange={(e)=>setField(n,row.id,"INCIDENCIAS",e.target.value)}>
                                            <option value="">Seleccionar</option>
                                            {INCIDENTES.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                                          </select>
                                        ) : isMuelle ? (
                                          <input
                                            className="h-8 w-full border rounded px-2 bg-transparent text-sm"
                                            value={(row?.[h] ?? "{}").toString()}
                                            onFocus={()=>{ muPrevRef.current[row.id] = (row?.[h] ?? "{}").toString(); }}
                                            onChange={(e)=> updateRowDirect(n, row.id, { MUELLE: e.target.value })}
                                            onBlur={(e)=> commitDockValue(n, row.id, e.target.value)}
                                            placeholder="nº muelle"
                                          />
                                        ) : (
                                          <input className="h-8 w-full border rounded px-2 bg-transparent text-sm"
                                            value={(row?.[h]??"{}").toString()}
                                            onChange={(e)=>setField(n,row.id,h,e.target.value)}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                  <div className="p-0.5 flex items-center justify-center">
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={()=>removeRow(n,row.id)} title="Eliminar">
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  );
                })}

                {/* ======= Pestaña PLANTILLAS ======= */}
                <TabsContent value="Plantillas" className="mt-3">
                  <TemplatesTab templates={templates} setTemplates={setTemplates} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Derecha · panel muelles */}
          <DockRight app={app} setDockPanel={setDockPanel} dockPanel={dockPanel} />
        </div>

        {/* Drawer muelles con “Carga aérea” en TODOS los muelles (edición) */}
        <DockDrawer
          app={app}
          dockPanel={dockPanel}
          setDockPanel={setDockPanel}
          updateRowDirect={updateRowDirect}
          commitDockValue={commitDockValue}
          setField={setField}
          muPrevRef={muPrevRef}
          onSavePreference={(ladoName, row)=>{
            const mu = Number(String(row?.MUELLE||"{}").trim());
            const dest = (row?.DESTINO||"{}").toString().trim();
            if(!mu || !DOCKS.includes(mu)){ alert("Asigna primero un muelle válido a esta fila para poder guardar preferencia."); return; }
            if(!dest){ alert("La fila no tiene DESTINO para crear la plantilla."); return; }
            const t = {
              id: crypto.randomUUID(),
              lado: ladoName || "Todos",
              pattern: dest,
              muelles: [mu],
              prioridad: 10,
              dias: [],
              activo: true,
            };
            setTemplates((prev)=>[t, ...(Array.isArray(prev)?prev:[])]);
            alert(`Preferencia guardada:\nLado: ${t.lado}\nDestino: ${t.pattern}\nMuelle: ${mu}`);
          }}
        />

        {/* Modal resumen */}
        <SummaryModal open={summary.open} type={summary.type} data={summaryData} onClose={()=>setSummary({open:false,type:null})} />

        <footer className="mt-4 text-xs text-muted-foreground flex items-center justify-between">
          <div>Estados camión: <Badge className="bg-emerald-600">OK</Badge> · <Badge className="bg-amber-500">CARGANDO</Badge> · <Badge className="bg-red-600">ANULADO</Badge></div>
          <div>© {new Date().getFullYear()} PLMECO · Plataforma Logística Meco (Inditex)</div>
        </footer>
      </div>
    </TooltipProvider>
  );
}