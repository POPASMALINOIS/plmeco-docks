// MecoDockManager.jsx — Sin Login ni Subir/Cargar red · Botones operativos · SALIDA REAL/TOPE 100px · Edición MUELLE en blur
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, FileUp, Plus, Trash2, X, AlertTriangle, GripVertical, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";

/* ========================= PARÁMETROS SLA ====================== */
const SLA_WAIT_WARN_MIN = 15;
const SLA_WAIT_CRIT_MIN = 30;
const SLA_TOPE_WARN_MIN = 15;
/* ============================================================== */

const DOCKS = [
  312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,
  351,352,353,354,355,356,357,359,360,361,362,363,364,365,366,367,368,369,
];
const LADOS = Array.from({ length: 10 }, (_, i) => `Lado ${i}`);

const INCIDENTES = [
  "RETRASO TRANSPORTISTA",
  "RETRASO CD",
  "RETRASO DOCUMENTACION",
  "CAMION ANULADO",
  "CAMION NO APTO",
];
const CAMION_ESTADOS = ["OK", "CARGANDO", "ANULADO"];

const BASE_HEADERS = ["TRANSPORTISTA","MATRICULA","DESTINO","LLEGADA","SALIDA","SALIDA TOPE","OBSERVACIONES"];
const EXTRA_HEADERS = ["MUELLE","PRECINTO","LLEGADA REAL","SALIDA REAL","INCIDENCIAS","ESTADO"];
const DEFAULT_ORDER = [
  "TRANSPORTISTA","DESTINO","MUELLE","PRECINTO","LLEGADA REAL","SALIDA REAL",
  "MATRICULA","LLEGADA","SALIDA","SALIDA TOPE","OBSERVACIONES","INCIDENCIAS","ESTADO",
];
const EXPECTED_KEYS = [...new Set([...BASE_HEADERS, ...EXTRA_HEADERS])];

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
function mapHeader(name){ const n=norm(name); return HEADER_ALIASES[n] || (name??"").toString().toUpperCase().trim(); }

function nowISO(){
  const d=new Date(); const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
  try{ return new Intl.DateTimeFormat("es-ES",{timeZone:tz,dateStyle:"short",timeStyle:"medium"}).format(d);}catch{ return d.toLocaleString();}
}
function coerceCell(v){ if(v==null) return ""; if(v instanceof Date) return v.toISOString(); return String(v).replace(/\r?\n+/g," ").replace(/\s{2,}/g," ").trim(); }
function normalizeEstado(v){
  const raw=String(v??"").trim();
  if(raw===""||raw==="*"||raw==="-"||/^N\/?A$/i.test(raw)) return "";
  const up=raw.toUpperCase(); if(up==="OK"||up==="CARGANDO"||up==="ANULADO") return up; return up;
}

function parseFlexibleToDate(s){
  const str=(s??"").toString().trim(); if(!str) return null;
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
const TIME_COLS = new Set(["LLEGADA","LLEGADA REAL","SALIDA","SALIDA REAL","SALIDA TOPE"]); // HH:mm
const PX_TIME = 80;           // LLEGADA y SALIDA
const PX_TIME_REAL = 100;     // LLEGADA REAL y SALIDA REAL
const PX_TIME_TOPE = 100;     // SALIDA TOPE
const PX_MUELLE = 90;         // MUELLE
const PX_ESTADO = 130;        // ESTADO

// Ajustes columnas
const PX_TRANSPORTISTA = 160; // reducido
const PX_MATRICULA = 120;     // reducido
const PX_DESTINO = 360;       // aumentado
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
const ACTIONS_PX = 44; // columna Acciones

// --- util ancho columnas ---
function px(n){
  return `${Math.max(40, Math.floor(n))}px`; // mínimo 40px
}
function computeColumnTemplate(_rows, order){
  const widths = (order || []).map((h) => ((h in FIXED_PX) ? px(FIXED_PX[h]) : "minmax(120px,1fr)"));
  return `${widths.join(" ")} ${px(ACTIONS_PX)}`;
}

/* ================= Persistencia local ================= */
function useLocalStorage(key, initial){
  const [state,setState]=useState(()=>{ try{const raw=localStorage.getItem(key); return raw?JSON.parse(raw):initial;}catch{return initial;}});
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
      const muNum=Number(String(row?.MUELLE??"").trim());
      if(!Number.isFinite(muNum)||!DOCKS.includes(muNum)) return;
      const llegadaReal=(row?.["LLEGADA REAL"]||"").trim();
      const salidaReal=(row?.["SALIDA REAL"]||"").trim();
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
function rowColorByEstado(estado){ if(estado==="ANULADO")return "bg-red-200"; if(estado==="CARGANDO")return "bg-amber-200"; if(estado==="OK")return "bg-emerald-200"; return ""; }
function rowAccentBorder(estado){ if(estado==="ANULADO")return "border-l-4 border-red-400"; if(estado==="CARGANDO")return "border-l-4 border-amber-400"; if(estado==="OK")return "border-l-4 border-emerald-400"; return ""; }

/* ================== Validación / conflicto MUELLE ========================= */
function isValidDockValue(val){ if(val===""||val==null) return true; const num=Number(String(val).trim()); return Number.isFinite(num)&&DOCKS.includes(num); }
function checkDockConflict(app,dockValue,currentLado,currentRowId){
  const num=Number(String(dockValue).trim()); if(!Number.isFinite(num)) return {conflict:false};
  for(const ladoName of Object.keys(app?.lados||{})){
    for(const row of (app?.lados?.[ladoName]?.rows||[])){
      if(row.id===currentRowId && ladoName===currentLado) continue;
      const mu=Number(String(row?.MUELLE??"").trim()); if(mu!==num) continue;
      const llegadaReal=(row?.["LLEGADA REAL"]||"").trim(); const salidaReal=(row?.["SALIDA REAL"]||"").trim();
      let state="ESPERA"; if(llegadaReal) state="OCUPADO"; if(salidaReal) state="LIBRE";
      if(state!=="LIBRE") return {conflict:true, info:{lado:ladoName,row,estado:state}};
    }
  }
  return {conflict:false};
}

/* =============================== SLA helpers =============================== */
function withDockAssignStamp(prevRow,nextRow){
  const prevDock=(prevRow?.MUELLE??"").toString().trim();
  const nextDock=(nextRow?.MUELLE??"").toString().trim();
  if(nextDock && (!prevDock || prevDock!==nextDock)) return {...nextRow,_ASIG_TS:new Date().toISOString()};
  return nextRow;
}
function getSLA(row){
  const now=new Date();
  let wait={level:null,minutes:0};
  const muelle=(row?.MUELLE||"").toString().trim();
  const llegadaReal=(row?.["LLEGADA REAL"]||"").toString().trim();
  if(muelle && !llegadaReal){
    let ref=row?._ASIG_TS?new Date(row._ASIG_TS):null;
    if(!ref && row?.LLEGADA){ const d=parseFlexibleToDate(row.LLEGADA); if(d) ref=d; }
    if(ref){ const m=minutesDiff(now,ref); wait.minutes=m; if(m>=SLA_WAIT_CRIT_MIN) wait.level="crit"; else if(m>=SLA_WAIT_WARN_MIN) wait.level="warn"; }
  }
  let tope={level:null,diff:0};
  const salidaReal=(row?.["SALIDA REAL"]||"").toString().trim();
  const salidaTope=parseFlexibleToDate(row?.["SALIDA TOPE"]||"");
  if(!salidaReal && salidaTope){
    const diffMin=minutesDiff(now,salidaTope); tope.diff=diffMin;
    if(diffMin>0) tope.level="crit"; else if(diffMin>=-SLA_TOPE_WARN_MIN) tope.level="warn";
  }
  const parts=[];
  if(wait.level) parts.push(`Espera en muelle ${wait.minutes} min`);
  if(tope.level==="crit") parts.push(`Salida tope superada (+${tope.diff} min)`);
  else if(tope.level==="warn") parts.push(`Salida tope próxima (${Math.abs(tope.diff)} min)`);
  return {wait,tope,tip:parts.join(" · ")};
}
function slaOutlineClasses(sla){
  const levels=["crit","warn"];
  for(const lv of levels){
    if(sla.tope.level===lv || sla.wait.level===lv){
      return lv==="crit" ? "outline outline-2 outline-red-500" : "outline outline-2 outline-amber-400";
    }
  }
  return "";
}

/* ============================== Componente ================================ */
export default function MecoDockManager(){
  const [app,setApp]=useLocalStorage("meco-app",{ lados:Object.fromEntries(LADOS.map((n)=>[n,{name:n,rows:[]}])) });
  const [active,setActive]=useState(LADOS[0]);
  const [filterEstado,setFilterEstado]=useState("TODOS");
  const [clock,setClock]=useState(nowISO());
  const [dockPanel,setDockPanel]=useState({open:false,dock:undefined,lado:undefined,rowId:undefined});
  const [importInfo,setImportInfo]=useState(null);

  // Orden columnas (persistente)
  const [columnOrder,setColumnOrder]=useLocalStorage("meco-colorder",DEFAULT_ORDER);

  // Estado para el modal de resumen
  const [summary,setSummary]=useState({open:false,type:null});

  // refs para edición de muelle (guardar valor previo y validar en blur)
  const muPrevRef = useRef({}); // { [rowId]: prevValue }

  // DnD encabezados
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
    const is=(v,x)=> (String(v||"").toUpperCase()===x);
    let waitWarn=0, waitCrit=0, topeWarn=0, topeCrit=0;
    const waitRows=[], topeRows=[];
    all.forEach(r=>{
      const sla=getSLA(r);
      if(sla.wait.level){ waitRows.push({...r,_sla:sla}); if(sla.wait.level==="crit") waitCrit++; else waitWarn++; }
      if(sla.tope.level){ topeRows.push({...r,_sla:sla}); if(sla.tope.level==="crit") topeCrit++; else topeWarn++; }
    });
    return {
      OK: all.filter(r=>is(r.ESTADO,"OK")),
      CARGANDO: all.filter(r=>is(r.ESTADO,"CARGANDO")),
      ANULADO: all.filter(r=>is(r.ESTADO,"ANULADO")),
      INCIDENCIAS: all.filter(r=>(r?.INCIDENCIAS||"").trim()!==""),
      total: all.length,
      SLA_WAIT: { warn: waitWarn, crit: waitCrit, rows: waitRows },
      SLA_TOPE: { warn: topeWarn, crit: topeCrit, rows: topeRows },
    };
  },[app]);

  /* ====== Helpers CRUD ====== */
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
    const value = (newValue ?? "").toString().trim();

    if(value===""){
      updateRowDirect(lado,rowId,{MUELLE:""});
      return;
    }
    if(!isValidDockValue(value)){
      alert(`El muelle "${newValue}" no es válido. Permitidos: ${DOCKS.join(", ")}.`);
      updateRowDirect(lado,rowId,{MUELLE: prevValue});
      return;
    }
    const {conflict,info}=checkDockConflict(app,value,lado,rowId);
    if(conflict){
      const ok=confirm(
        `El muelle ${value} está ${info.estado} en ${info.lado}.\n`+
        `Matrícula: ${info.row.MATRICULA||"?"} · Destino: ${info.row.DESTINO||"?"}\n\n`+
        `¿Asignarlo igualmente?`
      );
      if(!ok){
        updateRowDirect(lado,rowId,{MUELLE: prevValue});
        return;
      }
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

        setApp(prev => ({
          ...prev,
          lados: {
            ...prev.lados,
            [lado]: {
              ...(prev.lados && prev.lados[lado] ? prev.lados[lado] : { name: lado, rows: [] }),
              rows,
            },
          },
        }));

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
      const allEmpty=keysMin.every(k=>String(obj[k]||"").trim()===""); if(allEmpty) return;
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
    return list.filter(r=>(r?.ESTADO||"")===filterEstado);
  }

  /* ====== Render ====== */
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

        {/* Avisos SLA arriba */}
        <AlertStrip
          waitCrit={summaryData.SLA_WAIT.crit}
          waitWarn={summaryData.SLA_WAIT.warn}
          topeCrit={summaryData.SLA_TOPE.crit}
          topeWarn={summaryData.SLA_TOPE.warn}
          onOpen={(type)=>setSummary({open:true,type})}
        />

        {/* Resumen superior */}
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
                </TabsList>

                <div className="mt-3">
                  <ToolbarX
                    onImport={(f)=>importExcel(f,active)}
                    onAddRow={()=>addRow(active)}
                    onClear={()=>clearLado(active)}
                    filterEstado={filterEstado}
                    setFilterEstado={setFilterEstado}
                    onExportCSV={()=>exportCSV(active,app,columnOrder)}
                    onExportXLSX={()=>exportXLSX(active,app,columnOrder)}
                    onResetCache={()=>{ try{localStorage.removeItem("meco-app"); localStorage.removeItem("meco-colorder");}catch(e){} window.location.reload(); }}
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
                          {/* Header de la tabla */}
                          <div
                            className="grid sticky top-0 z-10"
                            style={{gridTemplateColumns:gridTemplate, minWidth: "100%"}}
                          >
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
                              const estado=(row?.ESTADO||"").toString();
                              const sla=getSLA(row);
                              const outline=slaOutlineClasses(sla);
                              const hasSLA=sla.wait.level||sla.tope.level;
                              return (
                                <Tooltip key={row.id}>
                                  <TooltipTrigger asChild>
                                    <div className={`grid border-t ${rowColorByEstado(estado)} ${rowAccentBorder(estado)} border-slate-200 ${outline}`} style={{gridTemplateColumns:gridTemplate, minWidth: "100%"}}>
                                      {columnOrder.map((h)=>{
                                        const isEstado=h==="ESTADO", isInc=h==="INCIDENCIAS", isMuelle=h==="MUELLE";
                                        return (
                                          <div key={h} className="p-1 border-r border-slate-100/60 flex items-center">
                                            {isEstado ? (
                                              <select className="h-8 w-full border rounded px-2 bg-transparent text-sm" value={(row?.ESTADO??"").toString()} onChange={(e)=>setField(n,row.id,"ESTADO",e.target.value)}>
                                                <option value="">Seleccionar</option>
                                                {CAMION_ESTADOS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                                              </select>
                                            ) : isInc ? (
                                              <select className="h-8 w-full border rounded px-2 bg-transparent text-sm" value={(row?.INCIDENCIAS??"").toString()} onChange={(e)=>setField(n,row.id,"INCIDENCIAS",e.target.value)}>
                                                <option value="">Seleccionar</option>
                                                {INCIDENTES.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                                              </select>
                                            ) : isMuelle ? (
                                              <input
                                                className="h-8 w-full border rounded px-2 bg-white text-sm"
                                                value={(row?.[h] ?? "").toString()}
                                                onFocus={()=>{ muPrevRef.current[row.id] = (row?.[h] ?? "").toString(); }}
                                                onChange={(e)=> updateRowDirect(n, row.id, { MUELLE: e.target.value })}
                                                onBlur={(e)=> commitDockValue(n, row.id, e.target.value)}
                                                placeholder="nº muelle"
                                              />
                                            ) : (
                                              <input className="h-8 w-full border rounded px-2 bg-transparent text-sm"
                                                value={(row?.[h]??"").toString()}
                                                onChange={(e)=>setField(n,row.id,h,e.target.value)}
                                              />
                                            )}
                                          </div>
                                        );
                                      })}
                                      <div className="p-0.5 flex items-center justify-center">
                                        {hasSLA && <AlertTriangle className={`w-4 h-4 mr-0.5 ${sla.tope.level==="crit"||sla.wait.level==="crit"?"text-red-600":"text-amber-500"}`} />}
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={()=>removeRow(n,row.id)} title="Eliminar">
                                          <X className="w-4 h-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  </TooltipTrigger>
                                  {hasSLA && <TooltipContent><p className="max-w-sm text-sm">{sla.tip}</p></TooltipContent>}
                                </Tooltip>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  );
                })}
              </Tabs>
            </CardContent>
          </Card>

          {/* Derecha · panel muelles */}
          <DockRight app={app} setDockPanel={setDockPanel} dockPanel={dockPanel} />
        </div>

        {/* Drawer muelles */}
        <DockDrawer
          app={app}
          dockPanel={dockPanel}
          setDockPanel={setDockPanel}
          updateRowDirect={updateRowDirect}
          commitDockValue={commitDockValue}
          setField={setField}
          muPrevRef={muPrevRef}
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

/* ============================= Panel derecha ============================== */
function DockRight({app,setDockPanel,dockPanel}){
  const docks=useMemo(()=>deriveDocks(app?.lados||{}),[app]);
  const legend=(
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-500" /> Libre</div>
      <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-amber-500" /> Espera</div>
      <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-600" /> Ocupado</div>
    </div>
  );
  return (
    <Card className="w-[290px]">
      <CardHeader className="pb-2 flex flex-col gap-2">
        <CardTitle className="text-base">Muelles (tiempo real)</CardTitle>
        {legend}
      </CardHeader>
      <CardContent className="max-h-[84vh] overflow-auto">
        <div className="grid grid-cols-2 xs:grid-cols-3 gap-2">
          {DOCKS.map((d)=>{
            const info=docks.get(d)||{state:"LIBRE"}; const color=dockColor(info.state); const label=`${d}`;
            const tooltip=info.row ? `${label} • ${info.row.MATRICULA||"?"} • ${info.row.DESTINO||"?"} • ${(info.row.ESTADO||"")}` : `${label} • Libre`;
            const btn=(
              <motion.button whileTap={{scale:0.96}} onClick={()=>setDockPanel({open:true,dock:d,lado:info.lado,rowId:info.row?.id})} className={`h-9 rounded-xl text-white text-sm font-semibold shadow ${color}`}>
                {label}
              </motion.button>
            );
            return dockPanel?.open ? <div key={d}>{btn}</div> : (
              <Tooltip key={d}><TooltipTrigger asChild>{btn}</TooltipTrigger><TooltipContent><p>{tooltip}</p></TooltipContent></Tooltip>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================== Drawer lateral ============================ */
function DockDrawer({app,dockPanel,setDockPanel,updateRowDirect,commitDockValue,setField,muPrevRef}){
  const open = !!dockPanel?.open;
  if(!open) return null;

  const { lado, rowId, dock } = dockPanel;
  const row = (lado && rowId) ? (app?.lados?.[lado]?.rows||[]).find(r=>r.id===rowId) : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[9998]" onClick={()=>setDockPanel({open:false,dock:undefined,lado:undefined,rowId:undefined})}/>
      <div
        className="
          fixed right-0 top-0 h-screen
          w-[400px] sm:w-[520px] md:w-[600px]
          bg-white z-[9999] shadow-2xl border-l pointer-events-auto
          flex flex-col
        "
        onMouseDown={(e)=>e.stopPropagation()}
        onClick={(e)=>e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Muelle {dock ?? "—"}</div>
          <Button size="icon" variant="ghost" onClick={()=>setDockPanel({open:false,dock:undefined,lado:undefined,rowId:undefined})}><X className="w-5 h-5" /></Button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto grow">
          {!lado || !rowId || !row ? (
            <div className="text-sm text-muted-foreground">Muelle libre o no hay fila asociada.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <KV label="Lado" value={lado} />
                <KV label="Matrícula" value={row.MATRICULA || "—"} />
                <KV label="Destino" value={row.DESTINO || "—"} wrap />
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Estado</div>
                  {(row.ESTADO||"") ? <Badge className={`${estadoBadgeColor(row.ESTADO)} text-white`}>{row.ESTADO}</Badge> : <span className="text-slate-400 text-sm">—</span>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <InputX label="Llegada real" value={(row["LLEGADA REAL"]??"").toString()} onChange={(v)=>setField(lado,row.id,"LLEGADA REAL",v)} placeholder="hh:mm / ISO" />
                <InputX label="Salida real" value={(row["SALIDA REAL"]??"").toString()} onChange={(v)=>setField(lado,row.id,"SALIDA REAL",v)} placeholder="hh:mm / ISO" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">Muelle</div>
                  <input
                    className="h-9 w-full border rounded px-2 bg-white text-sm"
                    value={(row["MUELLE"] ?? "").toString()}
                    onFocus={()=>{ muPrevRef.current[row.id] = (row["MUELLE"] ?? "").toString(); }}
                    onChange={(e)=> updateRowDirect(lado, row.id, { MUELLE: e.target.value })}
                    onBlur={(e)=> commitDockValue(lado, row.id, e.target.value)}
                    placeholder="nº muelle"
                  />
                  <div className="text-[10px] text-muted-foreground mt-1">Permitidos: 312–369 (según lista)</div>
                </div>

                <InputX label="Precinto" value={(row["PRECINTO"]??"").toString()} onChange={(v)=>setField(lado,row.id,"PRECINTO",v)} placeholder="Precinto" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectX label="Incidencias" value={(row["INCIDENCIAS"]??"").toString()} onChange={(v)=>setField(lado,row.id,"INCIDENCIAS",v)} options={INCIDENTES} />
                <SelectX label="Estado" value={(row.ESTADO??"").toString()} onChange={(v)=>setField(lado,row.id,"ESTADO",v)} options={CAMION_ESTADOS} />
              </div>

              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">Observaciones</div>
                <textarea
                  className="min-h-[90px] w-full border rounded px-2 py-1 bg-white text-sm"
                  value={(row.OBSERVACIONES??"").toString()}
                  onChange={(e)=>setField(lado,row.id,"OBSERVACIONES",e.target.value)}
                  placeholder="Añade notas"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ========================= Subcomponentes UI ============================== */
function HeaderCell({title, onDragStart, onDragOver, onDrop}) {
  function stopDragIfDoubleClick(e) {
    if (e.detail && e.detail > 1) { e.stopPropagation(); try { e.preventDefault(); } catch {} }
  }
  return (
    <div className={HEADER_CELL_CLASS} onMouseDown={stopDragIfDoubleClick}>
      <div className="flex items-center gap-1 whitespace-nowrap">
        <div
          className="shrink-0 rounded px-0.5 cursor-grab active:cursor-grabbing"
          draggable
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          title="Arrastra para reordenar"
        >
          <GripVertical className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <span className={HEADER_TEXT_CLASS}>{title}</span>
      </div>
    </div>
  );
}
function KV({label,value,wrap}){
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="text-sm text-muted-foreground shrink-0">{label}</div>
      <div className={`font-medium text-sm ${wrap ? "whitespace-pre-wrap break-words" : "truncate"}`}>{value}</div>
    </div>
  );
}
function InputX({label,value,onChange,placeholder}){ return (
  <div><div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">{label}</div>
    <input className="h-9 w-full border rounded px-2 bg-white text-sm" value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} />
  </div>
);}
function SelectX({label,value,onChange,options}){ return (
  <div><div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">{label}</div>
    <select className="h-9 w-full border rounded px-2 bg-white text-sm" value={value} onChange={(e)=>onChange(e.target.value)}>
      <option value="">Seleccionar</option>{options.map(opt=><option key={opt} value={opt}>{opt}</option>)}
    </select>
  </div>
);}

/* ===================== LÍNEA SUPERIOR DE AVISOS (SLA) ===================== */
function AlertStrip({ waitCrit, waitWarn, topeCrit, topeWarn, onOpen }) {
  const hasAny = (waitCrit + waitWarn + topeCrit + topeWarn) > 0;
  return (
    <div className={`mb-3 ${hasAny ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertTriangle className="w-4 h-4" /> Avisos SLA:
        </span>
        <button onClick={()=>onOpen("SLA_WAIT")} className="flex items-center gap-2 px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 transition" title="Ver detalle · SLA Espera">
          <span className="font-medium">Espera</span>
          <span className="text-[11px] px-1 rounded bg-red-200 text-red-800">Crit: {waitCrit}</span>
          <span className="text-[11px] px-1 rounded bg-amber-200 text-amber-800">Aviso: {waitWarn}</span>
        </button>
        <button onClick={()=>onOpen("SLA_TOPE")} className="flex items-center gap-2 px-2 py-1 rounded-full bg-red-100 text-red-800 border border-red-200 hover:bg-red-200 transition" title="Ver detalle · SLA Tope">
          <span className="font-medium">Tope</span>
          <span className="text-[11px] px-1 rounded bg-red-300 text-red-900">Crit: {topeCrit}</span>
          <span className="text-[11px] px-1 rounded bg-amber-200 text-amber-800">Aviso: {topeWarn}</span>
        </button>
        {!hasAny && <span className="text-xs text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">Sin avisos SLA en este momento</span>}
      </div>
    </div>
  );
}

/* ==================== Barra de resumen & Modal =================== */
function SummaryBar({data,onOpen}){
  const cards = [
    { key:"OK", title:"OK", count:data.OK.length, color:"bg-emerald-600", sub:"Camiones en OK" },
    { key:"CARGANDO", title:"Cargando", count:data.CARGANDO.length, color:"bg-amber-500", sub:"Camiones cargando" },
    { key:"ANULADO", title:"Anulado", count:data.ANULADO.length, color:"bg-red-600", sub:"Camiones anulados" },
    { key:"INCIDENCIAS", title:"Incidencias", count:data.INCIDENCIAS.length, color:"bg-indigo-600", sub:"Con incidencia" },
    { key:"SLA_WAIT", title:"SLA Espera", count:data.SLA_WAIT.crit + data.SLA_WAIT.warn, color:"bg-amber-600", sub:"Crit / Aviso", badgeL:data.SLA_WAIT.crit, badgeR:data.SLA_WAIT.warn },
    { key:"SLA_TOPE", title:"SLA Tope", count:data.SLA_TOPE.crit + data.SLA_TOPE.warn, color:"bg-red-700", sub:"Crit / Aviso", badgeL:data.SLA_TOPE.crit, badgeR:data.SLA_TOPE.warn },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
      {cards.map(c=>(
        <button key={c.key} onClick={()=>onOpen(c.key)} className="rounded-2xl p-3 text-left shadow hover:shadow-md transition border bg-white">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{c.title}</div>
            <span className={`inline-flex items-center justify-center w-7 h-7 text-white text-sm font-semibold rounded-full ${c.color}`}>{c.count}</span>
          </div>
          {c.badgeL!=null ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Crit: {c.badgeL}</span>
              <span className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Aviso: {c.badgeR}</span>
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">{c.sub}</div>
          )}
        </button>
      ))}
    </div>
  );
}

function SummaryModal({open,type,data,onClose}){
  if(!open) return null;
  let title="Resumen", rows=[];
  if(type==="OK"){ title="Resumen · OK"; rows=data.OK; }
  else if(type==="CARGANDO"){ title="Resumen · Cargando"; rows=data.CARGANDO; }
  else if(type==="ANULADO"){ title="Resumen · Anulado"; rows=data.ANULADO; }
  else if(type==="INCIDENCIAS"){ title="Resumen · Incidencias"; rows=data.INCIDENCIAS; }
  else if(type==="SLA_WAIT"){ title="Resumen · SLA Espera"; rows=data.SLA_WAIT.rows; }
  else if(type==="SLA_TOPE"){ title="Resumen · SLA Tope"; rows=data.SLA_TOPE.rows; }
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[9998]" onClick={onClose}/>
      <div className="fixed left-1/2 top-6 -translate-x-1/2 z-[9999] w-[95vw] max-w-6xl bg-white rounded-2xl shadow-2xl border overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">{title}</div>
          <Button size="icon" variant="ghost" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>
        <div className="p-3 max-h-[75vh] overflow-auto">
          <div className="grid grid-cols-[90px_140px_minmax(140px,1fr)_80px_120px_120px_minmax(160px,1fr)] gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            <div>Lado</div><div>Matrícula</div><div>Destino</div><div>Muelle</div><div>Llegada real</div><div>Salida real</div><div>{type==="INCIDENCIAS"?"Incidencias": type?.startsWith("SLA_")?"Motivo": "Estado"}</div>
          </div>
          <div className="divide-y">
            {rows.map((r)=>(
              <div key={r.id} className="grid grid-cols-[90px_140px_minmax(140px,1fr)_80px_120px_120px_minmax(160px,1fr)] gap-2 py-2 text-sm">
                <div className="font-medium">{r._lado}</div>
                <div className="truncate">{r.MATRICULA||"—"}</div>
                <div className="truncate">{r.DESTINO||"—"}</div>
                <div>{r.MUELLE||"—"}</div>
                <div>{r["LLEGADA REAL"]||"—"}</div>
                <div>{r["SALIDA REAL"]||"—"}</div>
                <div>
                  {type==="INCIDENCIAS" ? (r.INCIDENCIAS||"—")
                   : type==="SLA_WAIT"  ? (r._sla?.tip || "Espera en muelle")
                   : type==="SLA_TOPE"  ? (r._sla?.tip || "Salida tope")
                   : (r.ESTADO||"—")}
                </div>
              </div>
            ))}
            {rows.length===0 && <div className="text-sm text-muted-foreground py-6 text-center">No hay elementos para mostrar.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

/* ============================ Toolbar & Export ============================ */
function ToolbarX({onImport,onAddRow,onClear,filterEstado,setFilterEstado,onExportCSV,onExportXLSX,onResetCache}){
  const fileRef=useRef(null);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e)=>{ const f=e.target.files&&e.target.files[0]; if(f) onImport(f); if(fileRef.current) fileRef.current.value=""; }}
      />
      <Button size="sm" variant="secondary" onClick={()=>fileRef.current && fileRef.current.click()}>
        <FileUp className="mr-2 h-4 w-4" /> Importar Excel
      </Button>
      <Button size="sm" onClick={onExportCSV}>
        <Download className="mr-2 h-4 w-4" /> Exportar CSV
      </Button>
      <Button size="sm" onClick={onExportXLSX} variant="outline">
        <Download className="mr-2 h-4 w-4" /> Exportar Excel (.xlsx)
      </Button>
      <Button size="sm" variant="outline" onClick={onAddRow}>
        <Plus className="mr-2 h-4 w-4" /> Nueva fila
      </Button>
      <Button size="sm" variant="destructive" onClick={onClear}>
        <Trash2 className="mr-2 h-4 w-4" /> Vaciar lado
      </Button>
      <Button size="sm" variant="secondary" onClick={onResetCache}>
        Limpiar caché local
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filtrar estado</span>
        <select
          className="h-8 w-[160px] border rounded px-2 bg-white text-sm"
          value={filterEstado==="TODOS"?"":filterEstado}
          onChange={(e)=>setFilterEstado(e.target.value||"TODOS")}
        >
          <option value="">Todos</option>
          {CAMION_ESTADOS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    </div>
  );
}

function exportCSV(lado,app,columnOrder){
  const headers=columnOrder, rows=(app?.lados?.[lado]?.rows)||[];
  const SEP=";"; const esc=(val)=>{ const s=(val??"").toString().replace(/\r?\n/g," "); const doubled=s.replace(/"/g,'""'); return `"${doubled}"`; };
  const headerLine=headers.map(h=>esc(h)).join(SEP);
  const dataLines=rows.map(r=>headers.map(h=>esc(r?.[h])).join(SEP));
  const content="\uFEFF"+"sep="+SEP+"\r\n"+[headerLine,...dataLines].join("\r\n");
  const blob=new Blob([content],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`${lado.replace(/\s+/g,"_")}.csv`; a.click(); URL.revokeObjectURL(url);
}
function exportXLSX(lado,app,columnOrder){
  const headers=columnOrder, rows=(app?.lados?.[lado]?.rows)||[];
  const data=rows.map(r=>{ const o={}; headers.forEach(h=>{o[h]=r?.[h]??""}); return o; });
  const ws=XLSX.utils.json_to_sheet(data,{header:headers,skipHeader:false});
  const colWidths=headers.map(h=>{
    if (h in FIXED_PX) return { wpx: FIXED_PX[h] };
    if (TIME_COLS.has(h)) return { wpx: 140 }; // solo aspecto en Excel
    return { wpx: 140 };
  });
  ws["!cols"]=colWidths;
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,lado.replace(/[\\/?*[\]]/g,"_").slice(0,31));
  XLSX.writeFile(wb,`${lado.replace(/\s+/g,"_")}.xlsx`,{bookType:"xlsx",compression:true});
}
