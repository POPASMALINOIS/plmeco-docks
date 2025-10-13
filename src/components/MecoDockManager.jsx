import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, FileUp, Plus, Trash2, Upload, RefreshCw, LogIn, LogOut, X, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";

/* ========================= PARÁMETROS SLA AJUSTABLES ====================== */
const SLA_WAIT_WARN_MIN = 15;
const SLA_WAIT_CRIT_MIN = 30;
const SLA_TOPE_WARN_MIN = 15;
/* ========================================================================== */

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

// ----- utilidades -----
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

// ancho mínimo algo menor para permitir columnas más compactas
function widthFromLen(len){ const ch=Math.min(Math.max(len*0.7+2,8),56); return `${Math.round(ch)}ch`; }

// >>> OVERRIDES de ancho: compactar horas, muelle y estado <<<
const TIME_COLS = new Set(["LLEGADA","LLEGADA REAL","SALIDA","SALIDA REAL","SALIDA TOPE"]); // HH:mm
const FIXED_WIDTHS = {
  MUELLE: "7ch",            // 3 dígitos + margen
  ESTADO: "11ch",           // que quepa "CARGANDO"
};
const TIME_WIDTH = "8ch";   // HH:mm
const ACTIONS_WIDTH = "3.2rem"; // solo icono borrar

// cálculo de width basado en el **máximo** entre datos y encabezado
function computeColumnTemplate(rows, order){
  const widths = order.map((h)=>{
    if (TIME_COLS.has(h)) return TIME_WIDTH;
    if (h in FIXED_WIDTHS) return FIXED_WIDTHS[h];

    const headerLen = (h || "").length;
    let dataMax = 0;
    if (rows && rows.length) {
      dataMax = Math.max(...rows.map(r => ((r?.[h] ?? "") + "").length), 0);
    }

    if (h === "MATRICULA") {
      return widthFromLen(Math.max(dataMax + 6, headerLen));
    }
    return widthFromLen(Math.max(dataMax, headerLen));
  });

  return `${widths.join(" ")} ${ACTIONS_WIDTH}`;
}

// ---------------------------- Persistencia local ----------------------------
function useLocalStorage(key, initial){
  const [state,setState]=useState(()=>{ try{const raw=localStorage.getItem(key); return raw?JSON.parse(raw):initial;}catch{return initial;}});
  useEffect(()=>{ try{ localStorage.setItem(key, JSON.stringify(state)); }catch(e){} },[key,state]);
  return [state,setState];
}

// ----------------------------- Comunicación RT -----------------------------
function useRealtimeSync(state, setState) {
  const bcRef = useRef(null);
  const wsRef = useRef(null);

  // BroadcastChannel entre pestañas
  useEffect(() => {
    try {
      bcRef.current = new BroadcastChannel("meco-docks");
    } catch (e) {
      // Browser sin soporte: ignorar
    }
    var bc = bcRef.current;

    function onMsg(ev) {
      var data = ev && ev.data;
      if (data && data.type === "APP_STATE" && data.payload) {
        setState(data.payload);
      }
    }

    if (bc && bc.addEventListener) {
      bc.addEventListener("message", onMsg);
    }

    return () => {
      if (bc && bc.removeEventListener) {
        bc.removeEventListener("message", onMsg);
      }
    };
  }, [setState]);

  // WebSocket (opcional)
  useEffect(() => {
    var url = (typeof window !== "undefined") && window.MECO_WS_URL;
    if (!url) return;

    try {
      var ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener("open", function () {
        try {
          ws.send(JSON.stringify({ type: "HELLO", role: "client" }));
        } catch (e) {}
      });

      function onWSMessage(e) {
        try {
          var msg = null;
          try { msg = JSON.parse(e.data); } catch (err) {}
          if (msg && msg.type === "APP_STATE" && msg.payload) {
            setState(msg.payload);
          }
        } catch (e2) {}
      }

      ws.addEventListener("message", onWSMessage);

      return () => {
        try { ws.removeEventListener("message", onWSMessage); } catch (e) {}
        try { ws.close(); } catch (e) {}
      };
    } catch (e) {}
  }, [setState]);

  // Propagar cambios locales a otras pestañas / WS
  useEffect(() => {
    try {
      if (bcRef.current && bcRef.current.postMessage) {
        bcRef.current.postMessage({ type: "APP_STATE", payload: state });
      }
    } catch (e) {}
    try {
      if (wsRef.current && wsRef.current.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: "APP_STATE", payload: state }));
      }
    } catch (e) {}
  }, [state]);
}

// ---------------------------- Derivación de muelles -------------------------
const PRIORITY={LIBRE:0, ESPERA:1, OCUPADO:2};
function betterDockState(current,incoming){ if(!current) return incoming; return PRIORITY[incoming.state]>PRIORITY[current.state]?incoming:current; }
function deriveDocks(lados){
  const dockMap=new Map(); DOCKS.forEach((d)=>dockMap.set(d,{state:"LIBRE"}));
  Object.keys(lados).forEach((ladoName)=>{
    (lados[ladoName]?.rows||[]).forEach((row)=>{
      const muNum=Number(String(row.MUELLE??"").trim()); if(!Number.isFinite(muNum)||!DOCKS.includes(muNum)) return;
      const llegadaReal=(row["LLEGADA REAL"]||"").trim(); const salidaReal=(row["SALIDA REAL"]||"").trim();
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

// ---------------------- Validación/conflicto MUELLE -------------------------
function isValidDockValue(val){ if(val===""||val==null) return true; const num=Number(String(val).trim()); return Number.isFinite(num)&&DOCKS.includes(num); }
function checkDockConflict(app,dockValue,currentLado,currentRowId){
  const num=Number(String(dockValue).trim()); if(!Number.isFinite(num)) return {conflict:false};
  for(const ladoName of Object.keys(app.lados)){
    for(const row of app.lados[ladoName].rows){
      if(row.id===currentRowId && ladoName===currentLado) continue;
      const mu=Number(String(row.MUELLE??"").trim()); if(mu!==num) continue;
      const llegadaReal=(row["LLEGADA REAL"]||"").trim(); const salidaReal=(row["SALIDA REAL"]||"").trim();
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
  const muelle=(row.MUELLE||"").toString().trim();
  const llegadaReal=(row["LLEGADA REAL"]||"").toString().trim();
  if(muelle && !llegadaReal){
    let ref=row._ASIG_TS?new Date(row._ASIG_TS):null;
    if(!ref && row.LLEGADA){ const d=parseFlexibleToDate(row.LLEGADA); if(d) ref=d; }
    if(ref){ const m=minutesDiff(now,ref); wait.minutes=m; if(m>=SLA_WAIT_CRIT_MIN) wait.level="crit"; else if(m>=SLA_WAIT_WARN_MIN) wait.level="warn"; }
  }
  let tope={level:null,diff:0};
  const salidaReal=(row["SALIDA REAL"]||"").toString().trim();
  const salidaTope=parseFlexibleToDate(row["SALIDA TOPE"]||"");
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

// ------------------------------- Componente ---------------------------------
export default function MecoDockManager(){
  const [app,setApp]=useLocalStorage("meco-app",{ lados:Object.fromEntries(LADOS.map((n)=>[n,{name:n,rows:[]}])) });
  const [active,setActive]=useState(LADOS[0]);
  const [filterEstado,setFilterEstado]=useState("TODOS");
  const [clock,setClock]=useState(nowISO());
  const [dockPanel,setDockPanel]=useState({open:false,dock:undefined,lado:undefined,rowId:undefined});
  const [debugOpen,setDebugOpen]=useState(false);
  const [importInfo,setImportInfo]=useState(null);
  const [syncMsg,setSyncMsg]=useState("");
  const [dockEdit, setDockEdit] = useState({}); // edición libre de MUELLE

  // Auth
  const [auth,setAuth]=useLocalStorage("meco-auth",{token:null,user:null});
  const [loginOpen,setLoginOpen]=useState(false);
  const emailRef=useRef(null), passRef=useRef(null);

  // Resumen / modal
  const [summary,setSummary]=useState({open:false,type:null});

  // Orden columnas
  const [columnOrder,setColumnOrder]=useLocalStorage("meco-colorder",DEFAULT_ORDER);

  useRealtimeSync(app,setApp);
  useEffect(()=>{ const t=setInterval(()=>setClock(nowISO()),1000); return ()=>clearInterval(t); },[]);

  const summaryData=useMemo(()=>{
    const all=[];
    for(const lado of Object.keys(app.lados)){ for(const r of app.lados[lado].rows){ all.push({...r,_lado:lado}); } }
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
      INCIDENCIAS: all.filter(r=>(r.INCIDENCIAS||"").trim()!==""),
      total: all.length,
      SLA_WAIT: { warn: waitWarn, crit: waitCrit, rows: waitRows },
      SLA_TOPE: { warn: topeWarn, crit: topeCrit, rows: topeRows },
    };
  },[app]);

  function openSummary(type){ setSummary({open:true,type}); }
  function closeSummary(){ setSummary({open:false,type:null}); }

  // updates
  function updateRowDirect(lado,id,patch){
    setApp(prev=>{
      const rows=prev.lados[lado].rows.map(r=> r.id===id ? withDockAssignStamp(r,{...r,...patch}) : r );
      return {...prev,lados:{...prev.lados,[lado]:{...prev.lados[lado],rows}}};
    });
  }
  function setField(lado,id,field,value){
    if(field==="MUELLE"){
      if(!isValidDockValue(value)){ alert(`El muelle "${value}" no es válido. Solo: ${DOCKS.join(", ")}.`); return false; }
      const {conflict,info}=checkDockConflict(app,value,lado,id);
      if(conflict){
        const ok=confirm([
          `El muelle ${value} está ${info.estado} en ${info.lado}.`,
          `Matrícula: ${info.row.MATRICULA||"?"} · Destino: ${info.row.DESTINO||"?"}`,
          ``,
          `¿Asignarlo igualmente?`,
        ].join("\n")); if(!ok) return false;
      }
    }
    updateRowDirect(lado,id,{[field]:value});
    return true;
  }
  function updateRow(lado,id,patch){
    if(Object.prototype.hasOwnProperty.call(patch,"MUELLE")) return setField(lado,id,"MUELLE",patch.MUELLE);
    updateRowDirect(lado,id,patch);
    return true;
  }
  function addRow(lado){ const newRow={id:crypto.randomUUID(),ESTADO:""}; setApp(prev=>({...prev,lados:{...prev.lados[lado],rows:[newRow,...prev.lados[lado].rows]}})); }
  function removeRow(lado,id){ setApp(prev=>({...prev,lados:{...prev.lados[lado],rows:prev.lados[lado].rows.filter(r=>r.id!==id)}})); }
  function clearLado(lado){ setApp(prev=>({...prev,lados:{...prev.lados[lado],rows:[]}})); }

  // ----------------- IMPORT Excel -----------------
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

        // actualizar el lado con estructura segura
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

  function filteredRows(lado){ const list=app.lados[lado].rows; if(filterEstado==="TODOS") return list; return list.filter(r=>(r.ESTADO||"")===filterEstado); }

  // persistencia central (subir/bajar)
  async function uploadState(){
    try{
      setSyncMsg("Subiendo…");
      const base=window.MECO_API_URL; if(!base){ alert("Configura window.MECO_API_URL"); setSyncMsg(""); return; }
      const headers={"Content-Type":"application/json", ...(window.MECO_API_KEY?{Authorization:`Bearer ${window.MECO_API_KEY}`}:{}) , ...(auth?.token?{Authorization:`Bearer ${auth.token}`}:{}) };
      const res=await fetch(new URL("/state",base),{method:"POST",headers,body:JSON.stringify({state:app,by:auth?.user||null})});
      if(res.status===401){ alert("No autorizado. Inicia sesión."); setSyncMsg(""); return; }
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      setSyncMsg("Subido correctamente."); setTimeout(()=>setSyncMsg(""),2000);
    }catch(e){ console.error(e); alert("Error al subir el estado."); setSyncMsg(""); }
  }
  async function downloadState(){
    try{
      setSyncMsg("Cargando…");
      const base=window.MECO_API_URL; if(!base){ alert("Configura window.MECO_API_URL"); setSyncMsg(""); return; }
      const headers={ ...(window.MECO_API_KEY?{Authorization:`Bearer ${window.MECO_API_KEY}`}:{}) , ...(auth?.token?{Authorization:`Bearer ${auth.token}`}:{}) };
      const res=await fetch(new URL("/state",base),{headers});
      if(res.status===401){ alert("No autorizado. Inicia sesión."); setSyncMsg(""); return; }
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json=await res.json();
      if(json && json.state && json.state.lados){ setApp(json.state); setSyncMsg("Cargado correctamente."); setTimeout(()=>setSyncMsg(""),2000); }
      else { alert("Respuesta sin 'state' válido."); setSyncMsg(""); }
    }catch(e){ console.error(e); alert("Error al cargar el estado."); setSyncMsg(""); }
  }
  async function doLogin(email,password){
    try{
      const base=window.MECO_API_URL; if(!base){ alert("Configura window.MECO_API_URL para login."); return; }
      const res=await fetch(new URL("/login",base),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
      if(!res.ok){ alert("Login incorrecto."); return; }
      const json=await res.json(); if(!json?.token){ alert("Respuesta de login inválida."); return; }
      setAuth({token:json.token,user:json.user||{name:email,role:"user"}}); setLoginOpen(false);
    }catch(e){ console.error(e); alert("Error de red en login."); }
  }
  function doLogout(){ setAuth({token:null,user:null}); }

  // edición/confirmación MUELLE (tabla y drawer)
  function commitDock(lado, rowId, fallbackValue="") {
    const tmp = (dockEdit[rowId] ?? "").trim();
    const toSet = tmp === "" ? "" : tmp;
    const ok = setField(lado, rowId, "MUELLE", toSet);
    if (ok) setDockEdit(prev => { const n={...prev}; delete n[rowId]; return n; });
  }
  function cancelDock(rowId) {
    setDockEdit(prev => { const n={...prev}; delete n[rowId]; return n; });
  }

  // render
  return (
    <TooltipProvider>
      <div className="w-full min-h-screen p-3 md:p-5 bg-gradient-to-b from-slate-50 to-white">
        <header className="flex items-center gap-2 justify-between mb-3">
          <h1 className="text-2xl font-bold tracking-tight">PLMECO · Gestión de Muelles</h1>
          <div className="flex items-center gap-3">
            {auth?.user ? (
              <>
                <div className="text-sm">
                  <div className="leading-tight font-medium">{auth.user.name || "Usuario"}</div>
                  <div className="text-xs text-muted-foreground">{auth.user.role || "user"}</div>
                </div>
                <Button size="sm" variant="outline" onClick={doLogout}><LogOut className="w-4 h-4 mr-2" />Salir</Button>
              </>
            ) : (
              <Button size="sm" onClick={()=>setLoginOpen(true)}><LogIn className="w-4 h-4 mr-2" />Entrar</Button>
            )}
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Fecha y hora</div>
              <div className="font-medium">{clock}</div>
            </div>
          </div>
        </header>

        {/* Línea superior de avisos SLA */}
        <AlertStrip
          waitCrit={summaryData.SLA_WAIT.crit}
          waitWarn={summaryData.SLA_WAIT.warn}
          topeCrit={summaryData.SLA_TOPE.crit}
          topeWarn={summaryData.SLA_TOPE.warn}
          onOpen={(type)=>setSummary({open:true,type})}
        />

        {/* Resumen */}
        <SummaryBar data={summaryData} onOpen={(type)=>setSummary({open:true,type})} />

        {/* 2 columnas */}
        <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "minmax(0,1fr) 290px" }}>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>Operativas por lado</CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={()=>setColumnOrder(DEFAULT_ORDER)}>Restablecer orden</Button>
                  <Button size="sm" variant="outline" onClick={()=>setDebugOpen(v=>!v)}>{debugOpen?"Ocultar diagnóstico":"Ver diagnóstico de importación"}</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {debugOpen && (
                <div className="mb-3 p-3 border rounded text-xs bg-amber-50">
                  <div className="font-semibold mb-1">Diagnóstico última importación</div>
                  {!importInfo ? <div className="text-muted-foreground">Aún no has importado ningún Excel.</div> : (
                    <>
                      <div className="mb-2">Hojas analizadas:</div>
                      <ul className="list-disc pl-5 space-y-1">
                        {importInfo.sheetsTried.map((it,idx)=>(
                          <li key={idx}><span className="font-mono">{it.sheet}</span> · cabecera fila <b>{it.headerRowIdx+1}</b> · score <b>{it.bestScore}</b> · cols: <span className="font-mono">{(it.headers||[]).join(", ")}</span> · filas: <b>{it.rows}</b></li>
                        ))}
                      </ul>
                      {importInfo.chosen && (
                        <div className="mt-2">
                          <div><b>Usando hoja:</b> <span className="font-mono">{importInfo.chosen.sheet}</span></div>
                          <div><b>Cabecera en fila:</b> {importInfo.chosen.headerRowIdx+1}</div>
                          <div><b>Columnas:</b> <span className="font-mono">{(importInfo.chosen.headers||[]).join(", ")}</span></div>
                          <div><b>Filas importadas:</b> {importInfo.chosen.rows}</div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

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
                    onResetCache={()=>{ try{localStorage.removeItem("meco-app");}catch(e){} window.location.reload(); }}
                    onUploadState={uploadState}
                    onDownloadState={downloadState}
                    syncMsg={syncMsg}
                  />
                </div>

                {LADOS.map((n)=>{
                  const rows=app.lados[n].rows;
                  const gridTemplate=computeColumnTemplate(rows,columnOrder);
                  return (
                    <TabsContent key={n} value={n} className="mt-3">
                      <div className="border rounded-xl overflow-hidden">
                        <div className="overflow-auto max-h-[84vh]">
                          {/* Encabezados compactos en una sola línea */}
                          <div className="grid bg-slate-200 sticky top-0 z-10 select-none" style={{gridTemplateColumns:gridTemplate}}>
                            {columnOrder.map((h)=><HeaderCell key={h} title={h} />)}
                            <div className="bg-slate-50 p-1.5">
                              <div className="text-[10px] leading-tight font-semibold text-muted-foreground uppercase tracking-wide text-center whitespace-nowrap">Acc.</div>
                            </div>
                          </div>
                          <div>
                            {filteredRows(n).map((row)=>{
                              const estado=(row.ESTADO||"").toString();
                              const sla=getSLA(row);
                              const outline=slaOutlineClasses(sla);
                              const hasSLA=sla.wait.level||sla.tope.level;
                              return (
                                <Tooltip key={row.id}>
                                  <TooltipTrigger asChild>
                                    <div className={`grid border-t ${rowColorByEstado(estado)} ${rowAccentBorder(estado)} border-slate-200 ${outline}`} style={{gridTemplateColumns:gridTemplate}}>
                                      {columnOrder.map((h)=>{
                                        const isEstado=h==="ESTADO", isInc=h==="INCIDENCIAS", isMuelle=h==="MUELLE";
                                        return (
                                          <div key={h} className="p-1 border-r border-slate-100/60 flex items-center">
                                            {isEstado ? (
                                              <select className="h-8 w-full border rounded px-2 bg-transparent text-sm" value={(row.ESTADO??"").toString()} onChange={(e)=>updateRow(n,row.id,{ESTADO:e.target.value})}>
                                                <option value="">Seleccionar</option>
                                                {CAMION_ESTADOS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                                              </select>
                                            ) : isInc ? (
                                              <select className="h-8 w-full border rounded px-2 bg-transparent text-sm" value={(row.INCIDENCIAS??"").toString()} onChange={(e)=>updateRow(n,row.id,{INCIDENCIAS:e.target.value})}>
                                                <option value="">Seleccionar</option>
                                                {INCIDENTES.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                                              </select>
                                            ) : isMuelle ? (
                                              <input
                                                className="h-8 w-full border rounded px-2 bg-white text-sm"
                                                value={dockEdit[row.id] ?? (row[h] ?? "").toString()}
                                                onChange={(e)=> setDockEdit(prev=>({...prev, [row.id]: e.target.value}))}
                                                onBlur={()=> commitDock(n, row.id, (row[h] ?? ""))}
                                                onKeyDown={(e)=>{
                                                  if(e.key==="Enter"){ e.currentTarget.blur(); }
                                                  if(e.key==="Escape"){ cancelDock(row.id); e.currentTarget.blur(); }
                                                }}
                                                placeholder="nº muelle"
                                              />
                                            ) : (
                                              <input className="h-8 w-full border rounded px-2 bg-transparent text-sm"
                                                value={(row[h]??"").toString()}
                                                onChange={(e)=>updateRow(n,row.id,{[h]:e.target.value})}
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

          {/* Derecha */}
          <DockRight app={app} setDockPanel={setDockPanel} dockPanel={dockPanel} />
        </div>

        {/* Drawer muelles */}
        <DockDrawer
          app={app}
          dockPanel={dockPanel}
          setDockPanel={setDockPanel}
          updateRow={updateRow}
          setField={setField}
          dockEdit={dockEdit}
          setDockEdit={setDockEdit}
          commitDock={commitDock}
          cancelDock={cancelDock}
        />

        {/* Modal resumen */}
        <SummaryModal open={summary.open} type={summary.type} data={summaryData} onClose={closeSummary} />

        {/* Modal Login */}
        {loginOpen && (
          <>
            <div className="fixed inset-0 bg-black/30 z-[9998]" onClick={()=>setLoginOpen(false)} />
            <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] w-[92vw] max-w-md bg-white rounded-2xl shadow-2xl border overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="font-semibold">Iniciar sesión</div>
                <Button size="icon" variant="ghost" onClick={()=>setLoginOpen(false)}><X className="w-5 h-5" /></Button>
              </div>
              <div className="p-4 space-y-3">
                <div><div className="text-xs text-muted-foreground mb-1">Email</div><input ref={emailRef} className="h-9 w-full border rounded px-2" type="email" placeholder="usuario@empresa.com" /></div>
                <div><div className="text-xs text-muted-foreground mb-1">Contraseña</div><input ref={passRef} className="h-9 w-full border rounded px-2" type="password" placeholder="••••••••" /></div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={()=>setLoginOpen(false)}>Cancelar</Button>
                  <Button onClick={()=>doLogin(emailRef.current?.value||"", passRef.current?.value||"")}><LogIn className="w-4 h-4 mr-2" />Entrar</Button>
                </div>
              </div>
            </div>
          </>
        )}

        <footer className="mt-4 text-xs text-muted-foreground flex items-center justify-between">
          <div>Estados camión: <Badge className="bg-emerald-600">OK</Badge> · <Badge className="bg-amber-500">CARGANDO</Badge> · <Badge className="bg-red-600">ANULADO</Badge></div>
          <div>© {new Date().getFullYear()} PLMECO · Plataforma Logística Meco (Inditex)</div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

// ------------------------------ Panel derecha -------------------------------
function DockRight({app,setDockPanel,dockPanel}){
  const docks=useMemo(()=>deriveDocks(app.lados),[app]);
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
            return dockPanel.open ? <div key={d}>{btn}</div> : (
              <Tooltip key={d}><TooltipTrigger asChild>{btn}</TooltipTrigger><TooltipContent><p>{tooltip}</p></TooltipContent></Tooltip>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------ Drawer lateral ------------------------------
function DockDrawer({app,dockPanel,setDockPanel,updateRow,setField,dockEdit,setDockEdit,commitDock,cancelDock}){
  return dockPanel.open && (
    <>
      <div className="fixed inset-0 bg-black/30 z-[9998]" onClick={()=>setDockPanel({open:false,dock:undefined,lado:undefined,rowId:undefined})}/>
      <div className="fixed right-0 top-0 h-screen w-[280px] sm:w-[320px] bg-white z-[9999] shadow-2xl border-l pointer-events-auto" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Muelle {dockPanel.dock}</div>
          <Button size="icon" variant="ghost" onClick={()=>setDockPanel({open:false,dock:undefined,lado:undefined,rowId:undefined})}><X className="w-5 h-5" /></Button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto h-[calc(100vh-56px)]">
          {(()=>{
            const {lado,rowId}=dockPanel; if(!lado||!rowId) return <div className="text-emerald-600 font-medium">Muelle libre</div>;
            const r=app.lados[lado]?.rows.find(rr=>rr.id===rowId); if(!r) return <div className="text-muted-foreground">No se encontró la fila.</div>;
            const estado=(r.ESTADO||"").toString();
            return (
              <div className="space-y-2">
                <KV label="Lado" value={lado} />
                <KV label="Matrícula" value={r.MATRICULA||"—"} maxw />
                <KV label="Destino" value={r.DESTINO||"—"} maxw />
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Estado</div>
                  {estado ? <Badge className={`${estadoBadgeColor(estado)} text-white`}>{estado}</Badge> : <span className="text-slate-400 text-sm">—</span>}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <InputX label="Llegada real" value={(r["LLEGADA REAL"]??"").toString()} onChange={(v)=>updateRow(lado,r.id,{"LLEGADA REAL":v})} placeholder="hh:mm / ISO" />
                  <InputX label="Salida real" value={(r["SALIDA REAL"]??"").toString()} onChange={(v)=>updateRow(lado,r.id,{"SALIDA REAL":v})} placeholder="hh:mm / ISO" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">Muelle</div>
                    <input
                      className="h-9 w-full border rounded px-2 bg-white text-sm"
                      value={dockEdit[rowId] ?? (r["MUELLE"] ?? "").toString()}
                      onChange={(e)=> setDockEdit(prev=>({...prev, [rowId]: e.target.value}))}
                      onBlur={()=> commitDock(lado, rowId, (r["MUELLE"] ?? ""))}
                      onKeyDown={(e)=>{
                        if(e.key==="Enter"){ e.currentTarget.blur(); }
                        if(e.key==="Escape"){ cancelDock(rowId); e.currentTarget.blur(); }
                      }}
                      placeholder="nº muelle"
                    />
                    <div className="text-[10px] text-muted-foreground mt-0.5">Permitidos: {DOCKS[0]}…{DOCKS[DOCKS.length-1]}</div>
                  </div>
                  <InputX label="Precinto" value={(r["PRECINTO"]??"").toString()} onChange={(v)=>updateRow(lado,r.id,{"PRECINTO":v})} placeholder="Precinto" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SelectX label="Incidencias" value={(r["INCIDENCIAS"]??"").toString()} onChange={(v)=>updateRow(lado,r.id,{"INCIDENCIAS":v})} options={INCIDENTES} />
                  <SelectX label="Estado" value={estado} onChange={(v)=>updateRow(lado,r.id,{"ESTADO":v})} options={CAMION_ESTADOS} />
                </div>
                <InputX label="Observaciones" value={(r.OBSERVACIONES??"").toString()} onChange={(v)=>updateRow(lado,r.id,{OBSERVACIONES:v})} placeholder="Añade notas" />
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}

// ------------------------------ Subcomponentes UI ---------------------------
function HeaderCell({title}) {
  return (
    <div className="bg-slate-50 p-1.5 border-r border-slate-200">
      <div
        className="
          text-[10px] leading-tight font-semibold text-muted-foreground uppercase tracking-wide
          flex items-center gap-1
          whitespace-nowrap
        "
        title={title}
      >
        <span className="inline-block select-none text-[10px]">⋮⋮</span>
        <span className="block">{title}</span>
      </div>
    </div>
  );
}
function KV({label,value,maxw}){ return (<div className="flex items-center justify-between"><div className="text-sm text-muted-foreground">{label}</div><div className={`font-medium ${maxw?"truncate max-w-[150px]":""}`}>{value}</div></div>); }
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

        <button
          onClick={()=>onOpen("SLA_WAIT")}
          className="flex items-center gap-2 px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 transition"
          title="Ver detalle · SLA Espera"
        >
          <span className="font-medium">Espera</span>
          <span className="text-[11px] px-1 rounded bg-red-200 text-red-800">Crit: {waitCrit}</span>
          <span className="text-[11px] px-1 rounded bg-amber-200 text-amber-800">Aviso: {waitWarn}</span>
        </button>

        <button
          onClick={()=>onOpen("SLA_TOPE")}
          className="flex items-center gap-2 px-2 py-1 rounded-full bg-red-100 text-red-800 border border-red-200 hover:bg-red-200 transition"
          title="Ver detalle · SLA Tope"
        >
          <span className="font-medium">Tope</span>
          <span className="text-[11px] px-1 rounded bg-red-300 text-red-900">Crit: {topeCrit}</span>
          <span className="text-[11px] px-1 rounded bg-amber-200 text-amber-800">Aviso: {topeWarn}</span>
        </button>

        {!hasAny && (
          <span className="text-xs text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
            Sin avisos SLA en este momento
          </span>
        )}
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

  let title="Resumen";
  let rows=[];
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

// ------------------------------ Toolbar & Export ----------------------------
function ToolbarX({onImport,onAddRow,onClear,filterEstado,setFilterEstado,onExportCSV,onExportXLSX,onResetCache,onUploadState,onDownloadState,syncMsg}){
  const fileRef=useRef(null);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e)=>{ const f=e.target.files&&e.target.files[0]; if(f) onImport(f); if(fileRef.current) fileRef.current.value=""; }}/>
      <Button size="sm" variant="secondary" onClick={()=>fileRef.current && fileRef.current.click()}><FileUp className="mr-2 h-4 w-4" /> Importar Excel</Button>
      <Button size="sm" onClick={onExportCSV}><Download className="mr-2 h-4 w-4" /> Exportar CSV</Button>
      <Button size="sm" onClick={onExportXLSX} variant="outline"><Download className="mr-2 h-4 w-4" /> Exportar Excel (.xlsx)</Button>
      <Button size="sm" variant="outline" onClick={onAddRow}><Plus className="mr-2 h-4 w-4" /> Nueva fila</Button>
      <Button size="sm" variant="destructive" onClick={onClear}><Trash2 className="mr-2 h-4 w-4" /> Vaciar lado</Button>
      <Button size="sm" variant="secondary" onClick={onResetCache}>Limpiar caché local</Button>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onUploadState} title="Subir al servidor"><Upload className="mr-2 h-4 w-4" /> Subir</Button>
        <Button size="sm" variant="outline" onClick={onDownloadState} title="Cargar del servidor"><RefreshCw className="mr-2 h-4 w-4" /> Cargar</Button>
        {syncMsg ? <span className="text-xs text-muted-foreground">{syncMsg}</span> : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filtrar estado</span>
        <select className="h-8 w-[160px] border rounded px-2 bg-white text-sm" value={filterEstado==="TODOS"?"":filterEstado} onChange={(e)=>setFilterEstado(e.target.value||"TODOS")}>
          <option value="">Todos</option>
          {CAMION_ESTADOS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    </div>
  );
}

function exportCSV(lado,app,columnOrder){
  const headers=columnOrder, rows=app.lados[lado].rows||[];
  const SEP=";"; const esc=(val)=>{ const s=(val??"").toString().replace(/\r?\n/g," "); const doubled=s.replace(/"/g,'""'); return `"${doubled}"`; };
  const headerLine=headers.map(h=>esc(h)).join(SEP);
  const dataLines=rows.map(r=>headers.map(h=>esc(r[h])).join(SEP));
  const content="\uFEFF"+"sep="+SEP+"\r\n"+[headerLine,...dataLines].join("\r\n");
  const blob=new Blob([content],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`${lado.replace(/\s+/g,"_")}.csv`; a.click(); URL.revokeObjectURL(url);
}
function exportXLSX(lado,app,columnOrder){
  const headers=columnOrder, rows=app.lados[lado].rows||[];
  const data=rows.map(r=>{ const o={}; headers.forEach(h=>{o[h]=r[h]??""}); return o; });
  const ws=XLSX.utils.json_to_sheet(data,{header:headers,skipHeader:false});
  const colWidths=headers.map(h=>{ 
    if (TIME_COLS.has(h)) return {wch: 8}; 
    if (h==="MUELLE") return {wch: 7};
    if (h==="ESTADO") return {wch: 11};
    const maxLen=Math.max(...rows.map(r=>((r?.[h]??"")+"").length), 0, (h||"").length);
    return {wch:Math.min(Math.max(Math.ceil((maxLen||8)*0.9)+2,8),50)};
  });
  ws["!cols"]=colWidths;
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,lado.replace(/[\\/?*[\]]/g,"_").slice(0,31));
  XLSX.writeFile(wb,`${lado.replace(/\s+/g,"_")}.xlsx`,{bookType:"xlsx",compression:true});
}
