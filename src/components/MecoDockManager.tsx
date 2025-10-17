// src/components/MecoDockManager.tsx
// App de gestión de muelles (TypeScript) con:
// - Importación XLSX (lee desde fila de cabeceras detectada automáticamente)
// - Edición en tabla, validación de muelles y conflictos entre lados
// - Panel lateral (drawer) por muelle con botones "Llegada" y "Salida"
// - "Carga aérea" (destino/m3/bx) por muelle, totales y marcador de avión si hay ítems
// - Resumen superior con contadores y modal de detalle
// - Icono de warning en botón de muelle cuando se acerca/supera SALIDA TOPE
// - Reordenación de columnas por “drag” y persistencia en localStorage
// - Exportar .xlsx (simple) y filtro por estado
// - Sin estilos de Excel (dependemos solo de xlsx)

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import * as XLSX from "xlsx";
import {
  Download, FileUp, Plus, Trash2, X, AlertTriangle, GripVertical,
  RefreshCw, Truck, BookmarkPlus, Upload, Save, Plane
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/* ========================= Tipos ========================= */

type Estado = "" | "OK" | "CARGANDO" | "ANULADO";

interface AirItem {
  id: string;
  dest: string;
  m3: string; // texto editable (lo convertimos para totales)
  bx: string; // texto editable (lo convertimos para totales)
}

interface RowData {
  id: string;
  TRANSPORTISTA?: string;
  MATRICULA?: string;
  DESTINO?: string;
  LLEGADA?: string;
  SALIDA?: string;
  "SALIDA TOPE"?: string;
  OBSERVACIONES?: string;

  MUELLE?: string;
  PRECINTO?: string;
  "LLEGADA REAL"?: string;
  "SALIDA REAL"?: string;
  INCIDENCIAS?: string;
  ESTADO?: Estado;

  // Campos internos
  _ASIG_TS?: string;       // marca de tiempo al asignar muelle
  _lado?: string;          // relleno al construir summary
  _sla?: { tip?: string }; // texto SLA en modal
  _AIR_ITEMS?: AirItem[];  // destinos aéreos
}

interface LadoState {
  name: string;
  rows: RowData[];
}
type LadosMap = Record<string, LadoState>;

interface AppState {
  lados: LadosMap;
}

type SlaLevel = "warn" | "crit" | null;

/* ========================= Parámetros ========================= */

const SLA_TOPE_WARN_MIN = 15;       // resumen superior
const SLA_TOPE_ICON_PREMIN = 5;     // icono en botón muelle
const LADOS = Array.from({ length: 10 }, (_, i) => `Lado ${i}`);

const DOCKS = [
  312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,
  338,339,340,341,342,343,344,345,346,347,348,349,350,
  351,352,353,354,355,356,357,
  359,360,361,362,363,364,365,366,367,368,369,370,
];

const INCIDENTES = [
  "RETRASO TRANSPORTISTA",
  "RETRASO CD",
  "RETRASO DOCUMENTACION",
  "CAMION ANULADO",
  "CAMION NO APTO",
] as const;
const CAMION_ESTADOS: Estado[] = ["OK", "CARGANDO", "ANULADO"];

const BASE_HEADERS = ["TRANSPORTISTA","MATRICULA","DESTINO","LLEGADA","SALIDA","SALIDA TOPE","OBSERVACIONES"] as const;
const EXTRA_HEADERS = ["MUELLE","PRECINTO","LLEGADA REAL","SALIDA REAL","INCIDENCIAS","ESTADO"] as const;
const EXPECTED_KEYS = Array.from(new Set<string>([...BASE_HEADERS, ...EXTRA_HEADERS]));

const DEFAULT_ORDER: string[] = [
  "TRANSPORTISTA","MATRICULA","DESTINO","MUELLE","ESTADO","PRECINTO",
  "LLEGADA REAL","SALIDA REAL","LLEGADA","SALIDA","SALIDA TOPE","OBSERVACIONES","INCIDENCIAS",
];

/* ========================= Utils ========================= */

function norm(s: unknown): string {
  return (s ?? "")
    .toString()
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

const HEADER_ALIASES: Record<string, string> = {
  "transportista":"TRANSPORTISTA","transporte":"TRANSPORTISTA","carrier":"TRANSPORTISTA",
  "matricula":"MATRICULA","matrícula":"MATRICULA","placa":"MATRICULA",
  "matricula vehiculo":"MATRICULA","matricula vehículo":"MATRICULA",
  "destino":"DESTINO","llegada":"LLEGADA","hora llegada":"LLEGADA","entrada":"LLEGADA",
  "salida":"SALIDA","hora salida":"SALIDA","salida tope":"SALIDA TOPE","cierre":"SALIDA TOPE",
  "observaciones":"OBSERVACIONES","comentarios":"OBSERVACIONES","ok":"ESTADO","fuera":"PRECINTO",
};
function mapHeader(name: string | unknown): string {
  const n = norm(name);
  return HEADER_ALIASES[n] || (name ?? "").toString().toUpperCase().trim();
}

function nowISO(): string {
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat("es-ES", { timeZone: tz, dateStyle: "short", timeStyle: "medium" }).format(d);
  } catch {
    return d.toLocaleString();
  }
}
function nowHHmmEuropeMadrid(): string {
  try {
    return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  } catch {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
}

function coerceCell(v: any): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).replace(/\r?\n+/g," ").replace(/\s{2,}/g," ").trim();
}
function normalizeEstado(v: any): Estado {
  const raw = String(v ?? "").trim();
  if (raw === "" || raw === "*" || raw === "-" || /^N\/?A$/i.test(raw)) return "";
  const up = raw.toUpperCase();
  if (up === "OK" || up === "CARGANDO" || up === "ANULADO") return up as Estado;
  return up as Estado;
}
function parseFlexibleToDate(s: any): Date | null {
  const str = (s ?? "").toString().trim();
  if (!str) return null;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(str);
  if (hm) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(hm[1]), Number(hm[2]), 0, 0);
  }
  const dmyhm = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})[ T](\d{1,2}):(\d{2})$/.exec(str);
  if (dmyhm) {
    const dd = +dmyhm[1], mm = +dmyhm[2]-1;
    let yy = +dmyhm[3]; if (yy < 100) yy += 2000;
    const hh = +dmyhm[4], mi = +dmyhm[5];
    return new Date(yy, mm, dd, hh, mi, 0, 0);
  }
  const ts = Date.parse(str);
  if (!Number.isNaN(ts)) return new Date(ts);
  return null;
}
function minutesDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

/* ========================= Estilos / anchos ========================= */

const HEADER_CELL_CLASS = "bg-slate-50 px-1 py-0.5 border-r border-slate-200 select-none";
const HEADER_TEXT_CLASS = "text-[9px] leading-none font-semibold text-muted-foreground uppercase tracking-wide";

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

const FIXED_PX: Record<string, number> = {
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

function px(n: number): string { return `${Math.max(40, Math.floor(n))}px`; }
function computeColumnTemplate(_rows: RowData[], order: string[]): string {
  const widths = (order || []).map((h) => ((h in FIXED_PX) ? px(FIXED_PX[h]) : "minmax(120px,1fr)"));
  return `${widths.join(" ")} ${px(ACTIONS_PX)}`;
}

const COLOR_UP_TO = new Set<string>([
  "TRANSPORTISTA","MATRICULA","DESTINO","MUELLE","PRECINTO",
  "LLEGADA","LLEGADA REAL","SALIDA","SALIDA REAL","SALIDA TOPE",
]);
function cellBgByEstado(estado?: Estado): string {
  if (estado === "ANULADO") return "bg-rose-50";
  if (estado === "CARGANDO") return "bg-amber-50";
  if (estado === "OK") return "bg-emerald-50";
  return "";
}
function rowAccentBorder(estado?: Estado): string {
  if (estado === "ANULADO") return "border-l-4 border-rose-300";
  if (estado === "CARGANDO") return "border-l-4 border-amber-300";
  if (estado === "OK") return "border-l-4 border-emerald-300";
  return "";
}
function estadoBadgeColor(estado?: Estado): string {
  if (estado === "ANULADO") return "bg-red-600";
  if (estado === "CARGANDO") return "bg-amber-500";
  if (estado === "OK") return "bg-emerald-600";
  return "bg-slate-400";
}

/* ========================= Persistencia local ========================= */

function useLocalStorage<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : initial; }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} }, [key, state]);
  return [state, setState];
}

/* ========================= Sync pestañas ========================= */

function useRealtimeSync<T>(state: T, setState: (v: T) => void) {
  const bcRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try { bcRef.current = new BroadcastChannel("meco-docks"); } catch {}
    const bc = bcRef.current;
    const onMsg = (ev: MessageEvent) => {
      const data = (ev?.data as any);
      if (data?.type === "APP_STATE" && data.payload) setState(data.payload);
    };
    if (bc && "addEventListener" in bc) bc.addEventListener("message", onMsg as any);
    return () => { if (bc && "removeEventListener" in bc) bc.removeEventListener("message", onMsg as any); };
  }, [setState]);
  useEffect(() => { try { bcRef.current?.postMessage?.({ type: "APP_STATE", payload: state }); } catch {} }, [state]);
}

/* ========================= Derivar estado de muelles ========================= */

const PRIORITY: Record<"LIBRE" | "ESPERA" | "OCUPADO", number> = { LIBRE: 0, ESPERA: 1, OCUPADO: 2 };

interface DockInfoBusy {
  state: "ESPERA" | "OCUPADO";
  row: RowData;
  lado: string;
}
type DockInfo = { state: "LIBRE" } | DockInfoBusy;

function betterDockState(current: DockInfo | undefined, incoming: DockInfo): DockInfo {
  if (!current) return incoming;
  return PRIORITY[(incoming as any).state] > PRIORITY[(current as any).state] ? incoming : current;
}

function deriveDocks(lados: LadosMap): Map<number, DockInfo> {
  const dockMap = new Map<number, DockInfo>();
  DOCKS.forEach((d) => dockMap.set(d, { state: "LIBRE" }));
  Object.keys(lados || {}).forEach((ladoName) => {
    (lados?.[ladoName]?.rows || []).forEach((row) => {
      const muNum = Number(String(row?.MUELLE ?? "").trim());
      if (!Number.isFinite(muNum) || !DOCKS.includes(muNum)) return;
      const llegadaReal = (row?.["LLEGADA REAL"] || "").trim();
      const salidaReal = (row?.["SALIDA REAL"] || "").trim();
      let state: DockInfo["state"] = "ESPERA";
      if (llegadaReal) state = "OCUPADO";
      if (salidaReal) state = "LIBRE";
      const incoming: DockInfo = state === "LIBRE" ? { state: "LIBRE" } : { state, row, lado: ladoName } as DockInfoBusy;
      const prev = dockMap.get(muNum);
      const next = state === "LIBRE" ? (prev || { state: "LIBRE" }) : betterDockState(prev, incoming);
      dockMap.set(muNum, next);
    });
  });
  return dockMap;
}

function dockColor(state: DockInfo["state"]): string {
  if (state === "LIBRE") return "bg-emerald-500";
  if (state === "ESPERA") return "bg-amber-500";
  return "bg-red-600";
}

/* ========================= Validaciones de muelle ========================= */

function isValidDockValue(val: unknown): boolean {
  if (val === "" || val == null) return true;
  const num = Number(String(val).trim());
  return Number.isFinite(num) && DOCKS.includes(num);
}
function checkDockConflict(app: AppState, dockValue: string, currentLado: string, currentRowId: string) {
  const num = Number(String(dockValue).trim());
  if (!Number.isFinite(num)) return { conflict: false as const };
  for (const ladoName of Object.keys(app?.lados || {})) {
    for (const row of (app?.lados?.[ladoName]?.rows || [])) {
      if (row.id === currentRowId && ladoName === currentLado) continue;
      const mu = Number(String(row?.MUELLE ?? "").trim());
      if (mu !== num) continue;
      const llegadaReal = (row?.["LLEGADA REAL"] || "").trim();
      const salidaReal = (row?.["SALIDA REAL"] || "").trim();
      let state: "LIBRE" | "ESPERA" | "OCUPADO" = "ESPERA";
      if (llegadaReal) state = "OCUPADO";
      if (salidaReal) state = "LIBRE";
      if (state !== "LIBRE") return { conflict: true as const, info: { lado: ladoName, row, estado: state } };
    }
  }
  return { conflict: false as const };
}

/* ========================= SLA helpers ========================= */

function getSLA(row: RowData): { tope: { level: SlaLevel; diff: number }, tip: string } {
  const now = new Date();
  const tope = { level: null as SlaLevel, diff: 0 };
  const salidaReal = (row?.["SALIDA REAL"] || "").toString().trim();
  const salidaTope = parseFlexibleToDate(row?.["SALIDA TOPE"] || "");
  if (!salidaReal && salidaTope) {
    const diffMin = minutesDiff(now, salidaTope);
    tope.diff = diffMin;
    if (diffMin > 0) tope.level = "crit";
    else if (diffMin >= -SLA_TOPE_WARN_MIN) tope.level = "warn";
  }
  const parts: string[] = [];
  if (tope.level === "crit") parts.push(`Salida tope superada (+${tope.diff} min)`);
  else if (tope.level === "warn") parts.push(`Salida tope próxima (${Math.abs(tope.diff)} min)`);
  return { tope, tip: parts.join(" · ") };
}

/* ========================= Plantillas (autoasignación) ========================= */

interface TemplateRule {
  id: string;
  lado: string;            // "Todos" o "Lado 0"...
  pattern: string;         // comodín / regex / literal
  muelles: number[];
  prioridad: number;
  dias: string[];          // L,M,X,J,V,S,D
  activo: boolean;
}

const DAYS = ["L","M","X","J","V","S","D"] as const;
function todayLetter(): string {
  const n = new Date().getDay(); // 0..6
  return ["D","L","M","X","J","V","S"][n];
}
function matchPattern(text: string, patternRaw: string): boolean {
  const textN = (text || "").toString().toUpperCase().trim();
  if (!patternRaw) return false;
  const p = patternRaw.toString().trim();

  if (p.startsWith("/") && p.endsWith("/")) {
    try { const re = new RegExp(p.slice(1,-1)); return re.test(textN); } catch { return false; }
  }
  if (p.startsWith("/") && p.toLowerCase().endsWith("/i")) {
    try { const re = new RegExp(p.slice(1,-2), "i"); return re.test(text); } catch { return false; }
  }
  const up = p.toUpperCase();
  if (up === "*") return true;
  if (up.startsWith("*") && up.endsWith("*")) return textN.includes(up.slice(1,-1));
  if (up.startsWith("*")) return textN.endsWith(up.slice(1));
  if (up.endsWith("*")) return textN.startsWith(up.slice(0,-1));
  return textN === up;
}
function dayAllowed(t: TemplateRule): boolean {
  if (!t?.dias || !Array.isArray(t.dias) || t.dias.length === 0) return true;
  return t.dias.includes(todayLetter());
}

function useTemplates() {
  const [templates, setTemplates] = useLocalStorage<TemplateRule[]>("meco-plantillas", []);
  const [autoOnImport, setAutoOnImport] = useLocalStorage<boolean>("meco-autoassign-on-import", true);
  return { templates, setTemplates, autoOnImport, setAutoOnImport };
}

function suggestMuelleForRow(templates: TemplateRule[], ladoName: string, row: RowData, app: AppState): number | null {
  const destino = (row?.DESTINO || "").toString();
  const candidatos = (templates || [])
    .filter(t => t?.activo)
    .filter(t => (t.lado === ladoName || t.lado === "Todos"))
    .filter(t => matchPattern(destino, t.pattern))
    .filter(t => dayAllowed(t))
    .sort((a,b)=> (b.prioridad||0) - (a.prioridad||0));

  for (const t of candidatos) {
    const muelles = Array.isArray(t.muelles) ? t.muelles : [];
    for (const mu of muelles) {
      if (!isValidDockValue(mu)) continue;
      const { conflict } = checkDockConflict(app, String(mu), ladoName, row.id);
      if (!conflict) return mu;
    }
  }
  return null;
}
function applyTemplatesToLado(app: AppState, setApp: (v: AppState)=>void, ladoName: string, templates: TemplateRule[]) {
  const rows = (app?.lados?.[ladoName]?.rows) || [];
  if (rows.length === 0) return;
  const toAssign = rows.filter(r => String(r.MUELLE || "").trim() === "");
  if (toAssign.length === 0) return;

  const draft: AppState = JSON.parse(JSON.stringify(app));
  for (const r of toAssign) {
    const mu = suggestMuelleForRow(templates, ladoName, r, draft);
    if (mu != null) {
      const sideRows = draft.lados[ladoName].rows;
      const idx = sideRows.findIndex(x => x.id === r.id);
      if (idx >= 0) { sideRows[idx].MUELLE = String(mu); }
    }
  }
  setApp(draft);
}

/* ========================= Totales carga aérea ========================= */

function totalsAir(list: AirItem[]): { m3: number; bx: number } {
  let m3 = 0, bx = 0;
  for (const it of (list || [])) {
    const m = parseFloat(String(it.m3 ?? "").replace(",", "."));
    const b = parseInt(String(it.bx ?? "").replace(",", "."));
    if (!Number.isNaN(m)) m3 += m;
    if (!Number.isNaN(b)) bx += b;
  }
  return { m3: Math.round(m3 * 100) / 100, bx };
}

/* ========================= Encabezado arrastrable ========================= */

function HeaderCell(props: {
  title: string;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  const stopDragIfDoubleClick = (e: React.MouseEvent) => {
    // evita arrastre accidental al hacer doble click
    // (no cambia comportamiento de click simple)
    if ((e as any).detail && (e as any).detail > 1) {
      e.stopPropagation();
      try { e.preventDefault(); } catch {}
    }
  };
  return (
    <div className={HEADER_CELL_CLASS} onMouseDown={stopDragIfDoubleClick}>
      <div className="flex items-center gap-1 whitespace-nowrap">
        <div
          className="shrink-0 rounded px-0.5 cursor-grab active:cursor-grabbing"
          draggable
          onDragStart={props.onDragStart}
          onDragOver={props.onDragOver}
          onDrop={props.onDrop}
          title="Arrastra para reordenar"
        >
          <GripVertical className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <span className={HEADER_TEXT_CLASS}>{props.title}</span>
      </div>
    </div>
  );
}

/* ========================= Subcomponentes básicos ========================= */

function KV({ label, value, wrap }: { label: string; value?: string; wrap?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="text-sm text-muted-foreground shrink-0">{label}</div>
      <div className={`font-medium text-sm ${wrap ? "whitespace-pre-wrap break-words" : "truncate"}`}>{value ?? "—"}</div>
    </div>
  );
}
function InputX({ label, value, onChange, placeholder }:{
  label: string; value: string; onChange: (v: string)=>void; placeholder?: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">{label}</div>
      <input className="h-9 w-full border rounded px-2 bg-white text-sm" value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
function SelectX<T extends string>({ label, value, onChange, options }:{
  label: string; value: T | ""; onChange: (v: T | "")=>void; options: readonly T[];
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">{label}</div>
      <select className="h-9 w-full border rounded px-2 bg-white text-sm" value={value} onChange={(e)=>onChange(e.target.value as T | "")}>
        <option value="">Seleccionar</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

/* ========================= Tira de avisos (SLA) ========================= */

function AlertStrip({ topeCrit, topeWarn, onOpen }:{
  topeCrit: number; topeWarn: number; onOpen: (t: "SLA_TOPE")=>void;
}) {
  const hasAnyTope = (topeCrit + topeWarn) > 0;
  return (
    <div className={`mb-3 ${hasAnyTope ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertTriangle className="w-4 h-4" /> Avisos SLA:
        </span>
        <button
          onClick={()=>onOpen("SLA_TOPE")}
          className="flex items-center gap-2 px-2 py-1 rounded-full bg-red-100 text-red-800 border border-red-200 hover:bg-red-200 transition"
          title="Ver detalle · SLA Tope"
        >
          <span className="font-medium">Tope</span>
          <span className="text-[11px] px-1 rounded bg-red-300 text-red-900">Crit: {topeCrit}</span>
          <span className="text-[11px] px-1 rounded bg-amber-200 text-amber-800">Aviso: {topeWarn}</span>
        </button>
        {!hasAnyTope && (
          <span className="text-xs text-emerald-700 bg-emerald-100 border-emerald-200 border px-2 py-0.5 rounded-full">
            Sin avisos SLA Tope en este momento
          </span>
        )}
      </div>
    </div>
  );
}

/* ========================= Barra de Resumen + Modal ========================= */

function SummaryBar({ data, onOpen }:{
  data: ReturnType<typeof useSummaryData>;
  onOpen: (t: "OK" | "CARGANDO" | "ANULADO" | "INCIDENCIAS" | "SLA_TOPE") => void;
}) {
  const cards = [
    { key:"OK",         title:"OK",         count:data.OK.length,         color:"bg-emerald-600", sub:"Camiones en OK" },
    { key:"CARGANDO",   title:"Cargando",   count:data.CARGANDO.length,   color:"bg-amber-500",   sub:"Camiones cargando" },
    { key:"ANULADO",    title:"Anulado",    count:data.ANULADO.length,    color:"bg-red-600",     sub:"Camiones anulados" },
    { key:"INCIDENCIAS",title:"Incidencias",count:data.INCIDENCIAS.length,color:"bg-indigo-600",  sub:"Con incidencia" },
    { key:"SLA_TOPE",   title:"SLA Tope",   count:data.SLA_TOPE.crit + data.SLA_TOPE.warn, color:"bg-red-700", sub:"Crit / Aviso", badgeL:data.SLA_TOPE.crit, badgeR:data.SLA_TOPE.warn },
  ] as const;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map(c=>(
        <button key={c.key} onClick={()=>onOpen(c.key)} className="rounded-2xl p-3 text-left shadow hover:shadow-md transition border bg-white">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{c.title}</div>
            <span className={`inline-flex items-center justify-center w-7 h-7 text-white text-sm font-semibold rounded-full ${c.color}`}>{c.count}</span>
          </div>
          {"badgeL" in c ? (
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

function SummaryModal({ open, type, data, onClose }:{
  open: boolean;
  type: "OK" | "CARGANDO" | "ANULADO" | "INCIDENCIAS" | "SLA_TOPE" | null;
  data: ReturnType<typeof useSummaryData>;
  onClose: () => void;
}) {
  if (!open || !type) return null;
  let title="Resumen", rows: RowData[] = [];
  if (type==="OK") { title="Resumen · OK"; rows=data.OK; }
  else if (type==="CARGANDO") { title="Resumen · Cargando"; rows=data.CARGANDO; }
  else if (type==="ANULADO") { title="Resumen · Anulado"; rows=data.ANULADO; }
  else if (type==="INCIDENCIAS") { title="Resumen · Incidencias"; rows=data.INCIDENCIAS; }
  else if (type==="SLA_TOPE") { title="Resumen · SLA Tope"; rows=data.SLA_TOPE.rows; }

  const lastColHeader = (type==="INCIDENCIAS") ? "Incidencias" : (type==="SLA_TOPE" ? "Estado / Motivo" : "Estado");
  const getLastColValue = (r: RowData) => {
    if (type==="INCIDENCIAS") return r.INCIDENCIAS || "—";
    if (type==="SLA_TOPE") return r._sla?.tip || r.ESTADO || "—";
    return r.ESTADO || "—";
  };

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
            <div>Lado</div><div>Matrícula</div><div>Destino</div><div>Muelle</div><div>Llegada real</div><div>Salida real</div><div>{lastColHeader}</div>
          </div>
          <div className="divide-y">
            {rows.map((r)=>(
              <div key={r.id} className="grid grid-cols-[90px_140px_minmax(140px,1fr)_80px_120px_120px_minmax(160px,1fr)] gap-2 py-2 text-sm">
                <div className="font-medium">{r._lado}</div>
                <div className="truncate">{r.MATRICULA || "—"}</div>
                <div className="truncate">{r.DESTINO || "—"}</div>
                <div>{r.MUELLE || "—"}</div>
                <div>{r["LLEGADA REAL"] || "—"}</div>
                <div>{r["SALIDA REAL"] || "—"}</div>
                <div>{getLastColValue(r)}</div>
              </div>
            ))}
            {rows.length===0 && <div className="text-sm text-muted-foreground py-6 text-center">No hay elementos para mostrar.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

/* ========================= Resumen derivado ========================= */

function useSummaryData(app: AppState) {
  return useMemo(() => {
    const all: RowData[] = [];
    for (const lado of Object.keys(app?.lados || {})) {
      for (const r of (app?.lados?.[lado]?.rows || [])) {
        all.push({ ...r, _lado: lado });
      }
    }
    const is = (v?: string, x?: string) => (String(v || "").toUpperCase() === x);
    let topeWarn=0, topeCrit=0;
    const topeRows: RowData[] = [];
    all.forEach(r => {
      const sla = getSLA(r);
      if (sla.tope.level) {
        const rr = { ...r, _sla: { tip: sla.tip } };
        topeRows.push(rr);
        if (sla.tope.level === "crit") topeCrit++;
        else topeWarn++;
      }
    });
    return {
      OK: all.filter(r=>is(r.ESTADO,"OK")),
      CARGANDO: all.filter(r=>is(r.ESTADO,"CARGANDO")),
      ANULADO: all.filter(r=>is(r.ESTADO,"ANULADO")),
      INCIDENCIAS: all.filter(r=>(r?.INCIDENCIAS || "").trim() !== ""),
      total: all.length,
      SLA_TOPE: { warn: topeWarn, crit: topeCrit, rows: topeRows },
    };
  }, [app]);
}

/* ========================= Componente principal ========================= */

export default function MecoDockManager() {
  const [app, setApp] = useLocalStorage<AppState>("meco-app", {
    lados: Object.fromEntries(LADOS.map((n) => [n, { name: n, rows: [] as RowData[] }])) as LadosMap
  });

  const [active, setActive] = useState<string>(LADOS[0]);
  const [filterEstado, setFilterEstado] = useState<Estado | "TODOS">("TODOS");
  const [clock, setClock] = useState<string>(nowISO());
  const [dockPanel, setDockPanel] = useState<{open: boolean; dock?: number; lado?: string; rowId?: string}>({ open: false });

  const [importInfo, setImportInfo] = useState<any>(null);
  const [columnOrder, setColumnOrder] = useLocalStorage<string[]>("meco-colorder", DEFAULT_ORDER);
  const [summary, setSummary] = useState<{open: boolean; type: "OK"|"CARGANDO"|"ANULADO"|"INCIDENCIAS"|"SLA_TOPE"|null}>({ open:false, type:null });

  const muPrevRef = useRef<Record<string, string>>({});
  const { templates, setTemplates, autoOnImport, setAutoOnImport } = useTemplates();

  useRealtimeSync(app, (v)=>setApp(v));
  useEffect(()=>{ const t = setInterval(()=>setClock(nowISO()), 1000); return ()=>clearInterval(t); }, []);

  const summaryData = useSummaryData(app);

  /* ====== Drag columnas ====== */
  const dragFromIdx = useRef<number | null>(null);
  function onHeaderDragStart(e: React.DragEvent, idx: number) {
    dragFromIdx.current = idx;
    try { e.dataTransfer.setData("text/plain", String(idx)); e.dataTransfer.effectAllowed = "move"; } catch {}
  }
  function onHeaderDragOver(e: React.DragEvent) { e.preventDefault(); try { e.dataTransfer.dropEffect = "move"; } catch {} }
  function onHeaderDrop(e: React.DragEvent, idxTo: number) {
    e.preventDefault();
    let from: number | null = dragFromIdx.current;
    if (from == null) { try { const d = e.dataTransfer.getData("text/plain"); if (d !== "") from = Number(d); } catch {} }
    dragFromIdx.current = null;
    if (from==null || from===idxTo) return;
    setColumnOrder(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(idxTo, 0, moved);
      return arr;
    });
  }

  /* ====== Helpers CRUD ====== */
  function withDockAssignStamp(prevRow: RowData, nextRow: RowData): RowData {
    const prevDock = (prevRow?.MUELLE ?? "").toString().trim();
    const nextDock = (nextRow?.MUELLE ?? "").toString().trim();
    if (nextDock && (!prevDock || prevDock !== nextDock)) return { ...nextRow, _ASIG_TS: new Date().toISOString() };
    return nextRow;
  }
  function updateRowDirect(lado: string, id: string, patch: Partial<RowData>) {
    setApp(prev => {
      const prevRows = prev?.lados?.[lado]?.rows || [];
      const rows = prevRows.map(r => r.id === id ? withDockAssignStamp(r, { ...r, ...patch }) : r);
      return { ...prev, lados: { ...prev.lados, [lado]: { ...(prev.lados?.[lado] || { name: lado }), rows } } };
    });
  }
  function setField(lado: string, id: string, field: keyof RowData, value: string) {
    updateRowDirect(lado, id, { [field]: value } as Partial<RowData>);
    return true;
  }
  function commitDockValue(lado: string, rowId: string, newValue: string) {
    const prevValue = muPrevRef.current[rowId] ?? "";
    const value = (newValue ?? "").toString().trim();
    if (value === "") { updateRowDirect(lado, rowId, { MUELLE: "" }); return; }
    if (!isValidDockValue(value)) {
      alert(`El muelle "${newValue}" no es válido. Permitidos: ${DOCKS.join(", ")}.`);
      updateRowDirect(lado, rowId, { MUELLE: prevValue }); return;
    }
    const { conflict, info } = checkDockConflict(app, value, lado, rowId);
    if (conflict) {
      const ok = confirm(
        `El muelle ${value} está ${info!.estado} en ${info!.lado}.\n` +
        `Matrícula: ${info!.row.MATRICULA || "?"} · Destino: ${info!.row.DESTINO || "?"}\n\n` +
        `¿Asignarlo igualmente?`
      );
      if (!ok) { updateRowDirect(lado, rowId, { MUELLE: prevValue }); return; }
    }
    updateRowDirect(lado, rowId, { MUELLE: value });
  }

  function addRow(lado: string) {
    setApp(prev => {
      const prevRows = prev?.lados?.[lado]?.rows || [];
      const newRow: RowData = { id: crypto.randomUUID(), ESTADO: "" };
      return { ...prev, lados: { ...prev.lados, [lado]: { ...(prev.lados?.[lado] || { name: lado }), rows: [newRow, ...prevRows] } } };
    });
  }
  function removeRow(lado: string, id: string) {
    setApp(prev => {
      const prevRows = prev?.lados?.[lado]?.rows || [];
      return { ...prev, lados: { ...prev.lados, [lado]: { ...(prev.lados?.[lado] || { name: lado }), rows: prevRows.filter(r => r.id !== id) } } };
    });
  }
  function clearLado(lado: string) {
    setApp(prev => ({ ...prev, lados: { ...prev.lados, [lado]: { ...(prev.lados?.[lado] || { name: lado }), rows: [] } } }));
  }

  /* ====== Import/Export ====== */
  function importExcel(file: File, lado: string) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const results = [] as { sheetName: string; headerRowIdx: number; bestScore: number; headers: string[]; rows: RowData[] }[];

        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name]; if (!ws) continue;
          results.push(tryParseSheet(ws, name));
        }
        results.sort((a,b)=> (b.rows.length - a.rows.length) || (b.bestScore - a.bestScore));
        const best = results[0] || null;

        setImportInfo({
          sheetsTried: results.map(r=>({sheet:r.sheetName, headerRowIdx:r.headerRowIdx, bestScore:r.bestScore, headers:r.headers, rows:r.rows.length})),
          chosen: best ? { sheet: best.sheetName, headerRowIdx: best.headerRowIdx, bestScore: best.bestScore, headers: best.headers, rows: best.rows.length } : null,
        });

        const rows = best?.rows ?? [];
        setApp(prev => {
          const base: AppState = {
            ...prev,
            lados: {
              ...prev.lados,
              [lado]: {
                ...(prev.lados && prev.lados[lado] ? prev.lados[lado] : { name: lado, rows: [] }),
                rows,
              },
            },
          };
          // Autoasignación por plantillas (solo filas sin muelle)
          if (autoOnImport) {
            const draft: AppState = JSON.parse(JSON.stringify(base));
            applyTemplatesToLado(draft, (x)=>Object.assign(base, x), lado, templates);
            return draft;
          }
          return base;
        });

        if (!rows.length) alert("No se han detectado filas con datos. Revisa cabeceras y datos.");
      } catch (err) {
        console.error(err);
        alert("Error al leer el Excel.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function expandHeaderMerges(ws: XLSX.WorkSheet, headerRowIdx: number) {
    const merges = (ws as any)["!merges"] || [];
    merges.forEach((m: any) => {
      if (m.s.r <= headerRowIdx && m.e.r >= headerRowIdx) {
        const srcAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
        const src = (ws as any)[srcAddr]; if (!src || !src.v) return;
        const text = coerceCell(src.v);
        for (let c = m.s.c; c <= m.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
          const cell = (ws as any)[addr] || ((ws as any)[addr] = {});
          cell.v = text; cell.t = "s";
        }
      }
    });
  }

  function tryParseSheet(ws: XLSX.WorkSheet, sheetName: string) {
    const rows2D: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    let headerRowIdx = -1, bestScore = -1, limit = Math.min(rows2D.length, 40);
    for (let r = 0; r < limit; r++) {
      const mapped = (rows2D[r] || []).map((h) => mapHeader(h));
      const score = mapped.reduce((a: number, h: string) => a + (EXPECTED_KEYS.includes(h) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; headerRowIdx = r; }
    }
    if (headerRowIdx < 0) headerRowIdx = 0;

    expandHeaderMerges(ws, headerRowIdx);
    let ws2: XLSX.WorkSheet = ws;
    if ((ws as any)["!ref"]) {
      const range = XLSX.utils.decode_range((ws as any)["!ref"]);
      range.s.r = headerRowIdx;
      ws2 = { ...ws, "!ref": XLSX.utils.encode_range(range) } as XLSX.WorkSheet;
    }
    const json = XLSX.utils.sheet_to_json(ws2, { defval: "", raw: false }) as Record<string, any>[];
    const rows: RowData[] = [];
    const seenHeaders = new Set<string>();

    json.forEach((row) => {
      const obj: Record<string, string> = {};
      Object.keys(row).forEach((kRaw) => {
        const k = mapHeader(kRaw);
        seenHeaders.add(k);
        obj[k] = coerceCell(row[kRaw]);
      });
      for (const h of EXPECTED_KEYS) if (!(h in obj)) obj[h] = "";
      obj["ESTADO"] = normalizeEstado(obj["ESTADO"]);
      const keysMin = ["TRANSPORTISTA","MATRICULA","DESTINO","LLEGADA","SALIDA","OBSERVACIONES"];
      const allEmpty = keysMin.every(k => String(obj[k] || "").trim() === "");
      if (allEmpty) return;
      rows.push({ id: crypto.randomUUID(), ...(obj as RowData) });
    });

    return { sheetName, headerRowIdx, bestScore, headers: Array.from(seenHeaders), rows };
  }

  function filteredRows(lado: string): RowData[] {
    const list = (app?.lados?.[lado]?.rows) || [];
    if (filterEstado === "TODOS") return list;
    return list.filter(r => (r?.ESTADO || "") === filterEstado);
  }

  function exportXLSX(lado: string, appState: AppState, columnOrderState: string[]) {
    try {
      const headers = columnOrderState;
      const rows = (appState?.lados?.[lado]?.rows) || [];
      const aoa = [
        headers,
        ...rows.map(r => headers.map(h => (r as any)?.[h] ?? "")),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      const wsName = (lado || "Operativa").replace(/[\\/?*[\]]/g, "_").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, wsName);
      XLSX.writeFile(wb, `${wsName}.xlsx`);
    } catch (err) {
      console.error(err);
      alert("No se pudo exportar el Excel.");
    }
  }

  const activeRowsCount = (app?.lados?.[active]?.rows || []).length;
  const docksMap = useMemo(() => deriveDocks(app.lados), [app.lados]);

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
          onOpen={()=>setSummary({open:true,type:"SLA_TOPE"})}
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
                    onExportXLSX={()=>exportXLSX(active, app, columnOrder)}
                    onResetCache={()=>{
                      const ok = confirm(
                        "¿Seguro que quieres limpiar la caché local?\n\nEsto borrará TODAS las operativas de TODOS los lados,\n" +
                        "así como el orden de columnas guardado.\nSe recargará la página al terminar.\n\n¿Confirmas?"
                      );
                      if (ok) {
                        try {
                          localStorage.removeItem("meco-app");
                          localStorage.removeItem("meco-colorder");
                        } catch {}
                        window.location.reload();
                      }
                    }}
                    activeLadoName={active}
                    activeRowsCount={activeRowsCount}
                    autoOnImport={autoOnImport}
                    setAutoOnImport={setAutoOnImport}
                    onApplyTemplates={()=>applyTemplatesToLado(app, setApp, active, templates)}
                  />
                </div>

                {LADOS.map((n)=>{
                  const rows = (app?.lados?.[n]?.rows) || [];
                  const visible = filteredRows(n);
                  const gridTemplate = computeColumnTemplate(rows, columnOrder);
                  return (
                    <TabsContent key={n} value={n} className="mt-3">
                      <div className="border rounded-xl overflow-hidden">
                        <div className="overflow-auto max-h-[84vh]">
                          {/* Header */}
                          <div className="grid sticky top-0 z-10" style={{ gridTemplateColumns: gridTemplate, minWidth: "100%" }}>
                            {columnOrder.map((h, idx) => (
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
                              const estado = (row?.ESTADO || "") as Estado;
                              return (
                                <div key={row.id} className={`grid border-t ${rowAccentBorder(estado)} border-slate-200`} style={{ gridTemplateColumns: gridTemplate, minWidth: "100%" }}>
                                  {columnOrder.map((h)=>{
                                    const isEstado = h === "ESTADO";
                                    const isInc = h === "INCIDENCIAS";
                                    const isMuelle = h === "MUELLE";
                                    const bgClass = COLOR_UP_TO.has(h) ? cellBgByEstado(estado) : "";
                                    return (
                                      <div key={h} className={`p-1 border-r border-slate-100/60 flex items-center ${bgClass}`}>
                                        {isEstado ? (
                                          <select className="h-8 w-full border rounded px-2 bg-transparent text-sm" value={(row?.ESTADO ?? "").toString()} onChange={(e)=>setField(n, row.id, "ESTADO", e.target.value as Estado)}>
                                            <option value="">Seleccionar</option>
                                            {CAMION_ESTADOS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                          </select>
                                        ) : isInc ? (
                                          <select className="h-8 w-full border rounded px-2 bg-transparent text-sm" value={(row?.INCIDENCIAS ?? "").toString()} onChange={(e)=>setField(n, row.id, "INCIDENCIAS", e.target.value)}>
                                            <option value="">Seleccionar</option>
                                            {INCIDENTES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                          </select>
                                        ) : isMuelle ? (
                                          <input
                                            className="h-8 w-full border rounded px-2 bg-transparent text-sm"
                                            value={(row?.[h as keyof RowData] ?? "").toString()}
                                            onFocus={()=>{ muPrevRef.current[row.id] = (row?.[h as keyof RowData] ?? "").toString(); }}
                                            onChange={(e)=> updateRowDirect(n, row.id, { MUELLE: e.target.value })}
                                            onBlur={(e)=> commitDockValue(n, row.id, e.target.value)}
                                            placeholder="nº muelle"
                                          />
                                        ) : (
                                          <input
                                            className="h-8 w-full border rounded px-2 bg-transparent text-sm"
                                            value={(row?.[h as keyof RowData] ?? "").toString()}
                                            onChange={(e)=>setField(n, row.id, h as keyof RowData, e.target.value)}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                  <div className="p-0.5 flex items-center justify-center">
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={()=>removeRow(n, row.id)} title="Eliminar">
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

          {/* Panel derecho: botones de muelles en tiempo real */}
          <DockRight
            app={app}
            docksMap={docksMap}
            setDockPanel={setDockPanel}
            dockPanel={dockPanel}
          />
        </div>

        {/* Drawer lateral (detalle muelle) */}
        <DockDrawer
          app={app}
          dockPanel={dockPanel}
          setDockPanel={setDockPanel}
          updateRowDirect={updateRowDirect}
          commitDockValue={commitDockValue}
          setField={setField}
          muPrevRef={muPrevRef}
          onSavePreference={(ladoName, row)=>{
            const mu = Number(String(row?.MUELLE || "").trim());
            const dest = (row?.DESTINO || "").toString().trim();
            if (!mu || !DOCKS.includes(mu)) { alert("Asigna primero un muelle válido para guardar preferencia."); return; }
            if (!dest) { alert("La fila no tiene DESTINO para crear una plantilla."); return; }
            const t: TemplateRule = {
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

        <SummaryModal open={summary.open} type={summary.type} data={summaryData} onClose={()=>setSummary({open:false,type:null})} />

        <footer className="mt-4 text-xs text-muted-foreground flex items-center justify-between">
          <div>Estados camión: <Badge className="bg-emerald-600">OK</Badge> · <Badge className="bg-amber-500">CARGANDO</Badge> · <Badge className="bg-red-600">ANULADO</Badge></div>
          <div>© {new Date().getFullYear()} PLMECO · Plataforma Logística Meco (Inditex)</div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

/* ========================= DockRight (grid de muelles) ========================= */

function DockRight({ app, docksMap, setDockPanel, dockPanel }:{
  app: AppState;
  docksMap: Map<number, DockInfo>;
  setDockPanel: React.Dispatch<React.SetStateAction<{open: boolean; dock?: number; lado?: string; rowId?: string}>>;
  dockPanel: {open: boolean; dock?: number; lado?: string; rowId?: string};
}) {
  function shouldShowTopeIcon(info: DockInfo): boolean {
    if (info.state === "LIBRE") return false;
    const row = info.row;
    if (!row) return false;
    const salidaReal = (row["SALIDA REAL"] || "").toString().trim();
    if (salidaReal) return false;
    const dTope = parseFlexibleToDate(row["SALIDA TOPE"] || "");
    if (!dTope) return false;
    const diff = minutesDiff(new Date(), dTope);
    return diff >= -SLA_TOPE_ICON_PREMIN;
  }
  function iconSeverity(info: DockInfo): SlaLevel {
    if (info.state === "LIBRE") return null;
    const row = info.row!;
    const salidaReal = (row["SALIDA REAL"] || "").toString().trim();
    if (salidaReal) return null;
    const dTope = parseFlexibleToDate(row["SALIDA TOPE"] || "");
    if (!dTope) return null;
    const diff = minutesDiff(new Date(), dTope);
    if (diff > 0) return "crit";
    if (diff >= -SLA_TOPE_ICON_PREMIN) return "warn";
    return null;
  }

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
            const info = docksMap.get(d) || { state:"LIBRE" as const };
            const color = dockColor(info.state);
            const label = `${d}`;
            const tipBase = (info.state !== "LIBRE" && (info as DockInfoBusy).row)
              ? `${label} • ${(info as DockInfoBusy).row.MATRICULA || "?"} • ${(info as DockInfoBusy).row.DESTINO || "?"} • ${((info as DockInfoBusy).row.ESTADO || "") || "—"}`
              : `${label} • Libre`;

            const showIcon = shouldShowTopeIcon(info);
            const sev = iconSeverity(info);
            const iconTitle = sev==="crit" ? "SALIDA TOPE rebasada" : "SALIDA TOPE en ≤5 min";

            // Avión (carga aérea) si hay _AIR_ITEMS
            const hasAir = info.state !== "LIBRE" && Array.isArray((info as DockInfoBusy).row._AIR_ITEMS) && (info as DockInfoBusy).row._AIR_ITEMS!.length > 0;
            const airIcon = hasAir ? (
              <span
                title="Carga aérea en este muelle"
                className="absolute -top-1 -left-1 inline-flex items-center justify-center w-5 h-5 rounded-full border bg-white shadow border-sky-400"
              >
                <Plane className="w-3.5 h-3.5 text-sky-600" />
              </span>
            ) : null;

            const btn = (
              <motion.button
                key={d}
                whileTap={{scale:0.96}}
                onClick={()=> setDockPanel({ open:true, dock:d, lado:(info as any).lado, rowId:(info as any).row?.id })}
                className={`relative h-9 rounded-xl text-white text-sm font-semibold shadow ${color} px-2`}
                title={tipBase}
              >
                {label}
                {showIcon && (
                  <span
                    className={`absolute -top-1 -right-1 inline-flex items-center justify-center w-5 h-5 rounded-full border bg-white shadow
                      ${sev==="crit" ? "border-red-500" : "border-amber-400"}`}
                    title={iconTitle}
                  >
                    <AlertTriangle className={`w-3.5 h-3.5 ${sev==="crit" ? "text-red-600" : "text-amber-500"}`} />
                  </span>
                )}
                {airIcon}
              </motion.button>
            );

            return dockPanel?.open ? (
              <div key={d}>{btn}</div>
            ) : (
              <Tooltip key={d}>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent><p>{tipBase}</p></TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ========================= Drawer lateral por muelle ========================= */

function DockDrawer({
  app, dockPanel, setDockPanel, updateRowDirect, commitDockValue, setField, muPrevRef, onSavePreference
}:{
  app: AppState;
  dockPanel: { open: boolean; dock?: number; lado?: string; rowId?: string };
  setDockPanel: React.Dispatch<React.SetStateAction<{open: boolean; dock?: number; lado?: string; rowId?: string}>>;
  updateRowDirect: (lado: string, id: string, patch: Partial<RowData>) => void;
  commitDockValue: (lado: string, rowId: string, newValue: string) => void;
  setField: (lado: string, id: string, field: keyof RowData, value: string) => boolean;
  muPrevRef: React.MutableRefObject<Record<string,string>>;
  onSavePreference: (ladoName: string, row: RowData)=>void;
}) {
  const open = !!dockPanel?.open;
  if (!open) return null;

  const { lado, rowId, dock } = dockPanel;
  const row = (lado && rowId) ? (app?.lados?.[lado]?.rows || []).find(r => r.id === rowId) : null;

  function marcarLlegadaAhora() {
    if (!lado || !row) return;
    const now = nowHHmmEuropeMadrid();
    if ((row["LLEGADA REAL"] || "").trim() !== "") {
      const ok = confirm(`Esta fila ya tiene LLEGADA REAL = "${row["LLEGADA REAL"]}".\n¿Quieres sobrescribirla por ${now}?`);
      if (!ok) return;
    }
    setField(lado, row.id, "LLEGADA REAL", now);
  }
  function marcarSalidaAhora() {
    if (!lado || !row) return;
    const now = nowHHmmEuropeMadrid();
    if ((row["SALIDA REAL"] || "").trim() !== "") {
      const ok = confirm(`Esta fila ya tiene SALIDA REAL = "${row["SALIDA REAL"]}".\n¿Quieres sobrescribirla por ${now}?`);
      if (!ok) return;
    }
    setField(lado, row.id, "SALIDA REAL", now);
  }

  function airItems(r?: RowData): AirItem[] {
    const arr = r?._AIR_ITEMS;
    return Array.isArray(arr) ? arr : [];
  }
  function setAirItems(newArr: AirItem[]) {
    if (!lado || !row) return;
    updateRowDirect(lado, row.id, { _AIR_ITEMS: newArr });
  }
  function addAirItem() {
    const list = airItems(row || undefined);
    setAirItems([
      ...list,
      { id: crypto.randomUUID(), dest: "", m3: "", bx: "" }
    ]);
  }
  function updateAirItem(id: string, patch: Partial<AirItem>) {
    const list = airItems(row || undefined);
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return;
    const next = [...list];
    next[idx] = { ...next[idx], ...patch };
    setAirItems(next);
  }
  function removeAirItem(id: string) {
    const list = airItems(row || undefined);
    setAirItems(list.filter(x => x.id !== id));
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[9998]" onClick={()=>setDockPanel({open:false})}/>
      <div
        className="
          fixed right-0 top-0 h-screen
          w-[400px] sm:w-[520px] md:w-[640px]
          bg-white z-[9999] shadow-2xl border-l pointer-events-auto
          flex flex-col
        "
        onMouseDown={(e)=>e.stopPropagation()}
        onClick={(e)=>e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Muelle {dock ?? "—"}</div>
          <Button size="icon" variant="ghost" onClick={()=>setDockPanel({open:false})}><X className="w-5 h-5" /></Button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto grow">
          {!lado || !rowId || !row ? (
            <div className="text-sm text-muted-foreground">Muelle libre o no hay fila asociada.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <KV label="Lado" value={lado} />
                <KV label="Matrícula" value={row.MATRICULA || "—"} />
                <KV label="Destino (operativa)" value={row.DESTINO || "—"} wrap />
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Estado</div>
                  {(row.ESTADO||"") ? <Badge className={`${estadoBadgeColor(row.ESTADO)} text-white`}>{row.ESTADO}</Badge> : <span className="text-slate-400 text-sm">—</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={marcarLlegadaAhora} className="h-9">
                  <Truck className="w-4 h-4 mr-2" />
                  Llegada
                </Button>
                <Button onClick={marcarSalidaAhora} className="h-9 bg-red-600 hover:bg-red-700 text-white">
                  <Truck className="w-4 h-4 mr-2" />
                  Salida
                </Button>
                <Button onClick={()=>onSavePreference(lado, row)} variant="outline" className="h-9">
                  <BookmarkPlus className="w-4 h-4 mr-2" />
                  Guardar preferencia
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <InputX label="Llegada real" value={(row["LLEGADA REAL"] ?? "").toString()} onChange={(v)=>setField(lado, row.id, "LLEGADA REAL", v)} placeholder="hh:mm / ISO" />
                <InputX label="Salida real" value={(row["SALIDA REAL"] ?? "").toString()} onChange={(v)=>setField(lado, row.id, "SALIDA REAL", v)} placeholder="hh:mm / ISO" />
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
                  <div className="text-[10px] text-muted-foreground mt-1">Permitidos: 312–357 y 359–370</div>
                </div>

                <InputX label="Precinto" value={(row["PRECINTO"] ?? "").toString()} onChange={(v)=>setField(lado, row.id, "PRECINTO", v)} placeholder="Precinto" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectX label="Incidencias" value={(row["INCIDENCIAS"] ?? "") as any} onChange={(v)=>setField(lado, row.id, "INCIDENCIAS", v)} options={INCIDENTES} />
                <SelectX label="Estado" value={(row.ESTADO ?? "") as Estado | ""} onChange={(v)=>setField(lado, row.id, "ESTADO", v as Estado | "")} options={CAMION_ESTADOS} />
              </div>

              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">Observaciones</div>
                <textarea
                  className="min-h:[90px] w-full border rounded px-2 py-1 bg-white text-sm"
                  value={(row.OBSERVACIONES ?? "").toString()}
                  onChange={(e)=>setField(lado, row.id, "OBSERVACIONES", e.target.value)}
                  placeholder="Añade notas"
                />
              </div>

              {/* ====== BLOQUE CARGA AÉREA ====== */}
              <div className="mt-2 border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Carga aérea</div>
                  <Button size="sm" onClick={addAirItem}>
                    <Plus className="w-4 h-4 mr-2" />
                    Añadir destino aéreo
                  </Button>
                </div>

                <div className="overflow-auto">
                  <div className="min-w-[560px]">
                    <div className="grid grid-cols-[minmax(220px,1fr)_110px_110px_60px] gap-2 px-2 py-2 bg-slate-50 border rounded-t text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      <div>Destino</div>
                      <div>m³</div>
                      <div>bx</div>
                      <div>Acc.</div>
                    </div>

                    {airItems(row).length===0 && (
                      <div className="px-3 py-3 text-sm text-muted-foreground border-x border-b rounded-b">
                        No hay destinos aéreos añadidos para este camión.
                      </div>
                    )}

                    {airItems(row).length>0 && (
                      <div className="border-x border-b rounded-b divide-y">
                        {airItems(row).map(item=>(
                          <div key={item.id} className="grid grid-cols-[minmax(220px,1fr)_110px_110px_60px] gap-2 px-2 py-2 items-center">
                            <input
                              className="h-9 w-full border rounded px-2 bg-white text-sm"
                              placeholder="Destino aéreo (independiente del DESTINO general)"
                              value={item.dest || ""}
                              onChange={(e)=>updateAirItem(item.id, { dest: e.target.value })}
                            />
                            <input
                              className="h-9 w-full border rounded px-2 bg-white text-sm"
                              placeholder="0.00"
                              inputMode="decimal"
                              value={item.m3 ?? ""}
                              onChange={(e)=>updateAirItem(item.id, { m3: e.target.value })}
                            />
                            <input
                              className="h-9 w-full border rounded px-2 bg-white text-sm"
                              placeholder="0"
                              inputMode="numeric"
                              value={item.bx ?? ""}
                              onChange={(e)=>updateAirItem(item.id, { bx: e.target.value })}
                            />
                            <div className="flex items-center justify-center">
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={()=>removeAirItem(item.id)} title="Eliminar">
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}

                        {/* Totales */}
                        {(() => {
                          const t = totalsAir(airItems(row));
                          return (
                            <div className="grid grid-cols-[minmax(220px,1fr)_110px_110px_60px] gap-2 px-2 py-2 bg-slate-50/70 items-center">
                              <div className="text-sm font-medium text-right pr-2">Totales</div>
                              <div className="text-sm font-semibold">{t.m3.toFixed(2)}</div>
                              <div className="text-sm font-semibold">{t.bx}</div>
                              <div />
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* ====== / BLOQUE CARGA AÉREA ====== */}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ========================= Toolbar / Plantillas ========================= */

function ToolbarX({
  onImport,onAddRow,onClear,filterEstado,setFilterEstado,
  onExportXLSX,onResetCache,
  activeLadoName, activeRowsCount,
  autoOnImport, setAutoOnImport,
  onApplyTemplates
}:{
  onImport: (f: File)=>void;
  onAddRow: ()=>void;
  onClear: ()=>void;
  filterEstado: Estado | "TODOS";
  setFilterEstado: (v: Estado | "TODOS")=>void;
  onExportXLSX: ()=>void;
  onResetCache: ()=>void;
  activeLadoName: string;
  activeRowsCount: number;
  autoOnImport: boolean;
  setAutoOnImport: (v: boolean)=>void;
  onApplyTemplates: ()=>void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  function handleClear() {
    const n = activeRowsCount ?? 0;
    const lado = activeLadoName || "lado activo";
    const ok = confirm(
      `¿Vaciar ${lado}?\n\nSe eliminarán ${n} fila(s) de este lado.\n` +
      `Esta acción no se puede deshacer y no afectará a otros lados.\n\n¿Confirmas?`
    );
    if (ok) onClear();
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e)=>{ const f = e.target.files && e.target.files[0]; if (f) onImport(f); if(fileRef.current) fileRef.current.value = ""; }}
      />
      <Button size="sm" variant="secondary" onClick={()=>fileRef.current?.click()}>
        <FileUp className="mr-2 h-4 w-4" /> Importar Excel
      </Button>
      <Button size="sm" onClick={onExportXLSX} variant="outline">
        <Download className="mr-2 h-4 w-4" /> Exportar Excel (.xlsx)
      </Button>
      <Button size="sm" variant="outline" onClick={onAddRow}>
        <Plus className="mr-2 h-4 w-4" /> Nueva fila
      </Button>
      <Button size="sm" variant="outline" onClick={onApplyTemplates} title="Aplicar plantillas al lado activo (solo filas sin muelle)">
        <Save className="mr-2 h-4 w-4" /> Aplicar plantillas
      </Button>

      <div className="flex items-center gap-2 ml-2">
        <label className="text-sm text-muted-foreground flex items-center gap-2">
          <input type="checkbox" className="scale-110" checked={!!autoOnImport} onChange={(e)=>setAutoOnImport(!!e.target.checked)} />
          Autoasignar al importar
        </label>
      </div>

      <Button size="sm" variant="destructive" onClick={handleClear}>
        <Trash2 className="mr-2 h-4 w-4" /> Vaciar lado
      </Button>
      <Button size="sm" variant="secondary" onClick={onResetCache}>
        Limpiar caché local
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filtrar estado</span>
        <select
          className="h-8 w-[160px] border rounded px-2 bg-white text-sm"
          value={filterEstado==="TODOS" ? "" : (filterEstado || "")}
          onChange={(e)=>setFilterEstado((e.target.value as Estado) || "TODOS")}
        >
          <option value="">Todos</option>
          {CAMION_ESTADOS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    </div>
  );
}

function TemplatesTab({ templates, setTemplates }:{
  templates: TemplateRule[];
  setTemplates: React.Dispatch<React.SetStateAction<TemplateRule[]>>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  function addTemplate() {
    const t: TemplateRule = {
      id: crypto.randomUUID(),
      lado: "Todos",
      pattern: "",
      muelles: [],
      prioridad: 1,
      dias: [],
      activo: true,
    };
    setTemplates(prev => [ ...(Array.isArray(prev) ? prev : []), t ]);
  }
  function updateTemplate(id: string, patch: Partial<TemplateRule>) {
    setTemplates(prev => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr[i] = { ...arr[i], ...patch };
      return arr;
    });
  }
  function removeTemplate(id: string) {
    const ok = confirm("¿Eliminar esta plantilla?");
    if (!ok) return;
    setTemplates(prev => (Array.isArray(prev) ? prev.filter(x => x.id !== id) : []));
  }
  function toggleDay(id: string, letter: string) {
    setTemplates(prev => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      const i = arr.findIndex(x => x.id === id);
      if (i < 0) return arr;
      const t = arr[i];
      const d = new Set(t.dias || []);
      if (d.has(letter)) d.delete(letter); else d.add(letter);
      arr[i] = { ...t, dias: Array.from(d) };
      return arr;
    });
  }
  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(String(e.target?.result ?? "[]"));
        if (!Array.isArray(json)) throw new Error("El JSON debe ser un array de plantillas.");
        const cleaned: TemplateRule[] = json.map((t: any) => ({
          id: t.id || crypto.randomUUID(),
          lado: t.lado || "Todos",
          pattern: t.pattern || "",
          muelles: (Array.isArray(t.muelles) ? t.muelles.map((n:any)=>Number(n)).filter((n:number)=>Number.isFinite(n)) : []),
          prioridad: Number(t.prioridad || 0),
          dias: Array.isArray(t.dias) ? t.dias.filter((x:string)=>["L","M","X","J","V","S","D"].includes(x)) : [],
          activo: !!t.activo,
        }));
        setTemplates(cleaned);
        alert(`Importadas ${cleaned.length} plantillas.`);
      } catch (err) {
        console.error(err); alert("JSON inválido.");
      }
    };
    reader.readAsText(file);
  }
  function exportJson() {
    const data = JSON.stringify(templates || [], null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plantillas-muelles.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Plantillas de muelles (por Lado y Destino)</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportJson}>
              <Download className="mr-2 h-4 w-4" /> Exportar JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e)=>{ const f = e.target.files?.[0]; if (f) importJson(f); if (fileRef.current) fileRef.current.value=""; }}
            />
            <Button size="sm" variant="outline" onClick={()=>fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Importar JSON
            </Button>
            <Button size="sm" onClick={addTemplate}>
              <Plus className="mr-2 h-4 w-4" /> Nueva regla
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[110px_150px_minmax(220px,1fr)_200px_110px_230px_90px] gap-2 px-2 py-2 bg-slate-50 border text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              <div>Activo</div>
              <div>Lado</div>
              <div>Destino (patrón)</div>
              <div>Muelles preferentes (coma)</div>
              <div>Prioridad</div>
              <div>Días (L M X J V S D)</div>
              <div>Acciones</div>
            </div>

            {(templates || []).length === 0 && (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                No hay plantillas aún. Crea una con “Nueva regla” o guarda una preferencia desde el drawer del muelle.
              </div>
            )}

            {(templates || []).map(t=>(
              <div key={t.id} className="grid grid-cols-[110px_150px_minmax(220px,1fr)_200px_110px_230px_90px] gap-2 px-2 py-2 border-b items-center">
                <div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!t.activo} onChange={(e)=>updateTemplate(t.id, { activo: !!e.target.checked })} />
                    {t.activo ? "Sí" : "No"}
                  </label>
                </div>
                <div>
                  <select className="h-8 w-full border rounded px-2 bg-white text-sm" value={t.lado || "Todos"} onChange={(e)=>updateTemplate(t.id, { lado: e.target.value })}>
                    <option value="Todos">Todos</option>
                    {LADOS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <input className="h-8 w-full border rounded px-2 bg-white text-sm"
                    placeholder='ZARA*, *VALLECAS, /BERSANA/i'
                    value={t.pattern || ""}
                    onChange={(e)=>updateTemplate(t.id, { pattern: e.target.value })}
                  />
                </div>
                <div>
                  <input className="h-8 w-full border rounded px-2 bg-white text-sm"
                    placeholder="320,321,322"
                    value={(t.muelles || []).join(",")}
                    onChange={(e)=>{
                      const arr = e.target.value.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n));
                      updateTemplate(t.id, { muelles: arr });
                    }}
                  />
                </div>
                <div>
                  <input className="h-8 w-full border rounded px-2 bg-white text-sm"
                    type="number" value={Number(t.prioridad || 0)}
                    onChange={(e)=>updateTemplate(t.id, { prioridad: Number(e.target.value || 0) })}
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {DAYS.map(d=>(
                    <label key={d} className={`border rounded px-2 py-0.5 text-xs cursor-pointer ${t.dias?.includes(d) ? "bg-slate-800 text-white" : "bg-white"}`}>
                      <input type="checkbox" className="hidden" checked={t.dias?.includes(d) || false} onChange={()=>toggleDay(t.id, d)} />
                      {d}
                    </label>
                  ))}
                  <button className="text-xs underline ml-2" onClick={()=>updateTemplate(t.id, { dias: [] })}>Todos</button>
                </div>
                <div className="flex items-center justify-center">
                  <Button size="icon" variant="ghost" onClick={()=>removeTemplate(t.id)} title="Eliminar">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
