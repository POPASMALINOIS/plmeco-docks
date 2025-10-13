import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, FileUp, Plus, Trash2, X } from "lucide-react";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";

/**
 * PLMECO – Gestión de Muelles (WEB)
 * Cambios:
 * - deriveDocks con prioridad global OCUPADO > ESPERA > LIBRE para consolidar varios Lados.
 * - Filas coloreadas por ESTADO: OK (verde), CARGANDO (amarillo), ANULADO (rojo).
 * - Mantiene reordenación de columnas por drag&drop con persistencia.
 */

// --------------------------- Constantes generales ---------------------------
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

// Cabeceras base que pueden venir del Excel
const BASE_HEADERS = [
  "TRANSPORTISTA",
  "MATRICULA",
  "DESTINO",
  "LLEGADA",
  "SALIDA",
  "SALIDA TOPE",
  "OBSERVACIONES",
];

// Columnas extra propias de la app
const EXTRA_HEADERS = [
  "MUELLE",
  "PRECINTO",
  "LLEGADA REAL",
  "SALIDA REAL",
  "INCIDENCIAS",
  "ESTADO",
];

// Orden por defecto (visible)
const DEFAULT_ORDER = [
  // Grupo solicitado primero:
  "TRANSPORTISTA",
  "DESTINO",
  "MUELLE",
  "PRECINTO",
  "LLEGADA REAL",
  "SALIDA REAL",
  // Resto:
  "MATRICULA",
  "LLEGADA",
  "SALIDA",
  "SALIDA TOPE",
  "OBSERVACIONES",
  "INCIDENCIAS",
  "ESTADO",
];

const EXPECTED_KEYS = [...new Set([...BASE_HEADERS, ...EXTRA_HEADERS])];

// Alias de cabeceras (normalización)
function norm(s) {
  return (s ?? "")
    .toString()
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}
const HEADER_ALIASES = {
  "transportista": "TRANSPORTISTA",
  "transporte": "TRANSPORTISTA",
  "carrier": "TRANSPORTISTA",
  "matricula": "MATRICULA",
  "matrícula": "MATRICULA",
  "placa": "MATRICULA",
  "matricula vehiculo": "MATRICULA",
  "matricula vehículo": "MATRICULA",
  "destino": "DESTINO",
  "llegada": "LLEGADA",
  "hora llegada": "LLEGADA",
  "entrada": "LLEGADA",
  "salida": "SALIDA",
  "hora salida": "SALIDA",
  "salida tope": "SALIDA TOPE",
  "cierre": "SALIDA TOPE",
  "observaciones": "OBSERVACIONES",
  "comentarios": "OBSERVACIONES",
  "ok": "ESTADO",
  "fuera": "PRECINTO",
};
function mapHeader(name) {
  const n = norm(name);
  return HEADER_ALIASES[n] || (name ?? "").toString().toUpperCase().trim();
}
function nowISO() {
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat("es-ES", { timeZone: tz, dateStyle: "short", timeStyle: "medium" }).format(d);
  } catch {
    return d.toLocaleString();
  }
}
function coerceCell(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).replace(/\r?\n+/g, " ").replace(/\s{2,}/g, " ").trim();
}

// Autoancho por contenido (ancho en "ch"); MATRÍCULA con un plus
function widthFromLen(len) {
  const ch = Math.min(Math.max(len * 0.7 + 3, 10), 56);
  return `${Math.round(ch)}ch`;
}
function computeColumnTemplate(rows, order) {
  const widths = order.map((h) => {
    const maxLen = Math.max(
      (h || "").length,
      ...rows.map(r => ((r?.[h] ?? "") + "").length)
    );
    if (h === "MATRICULA") return widthFromLen(maxLen + 6); // plus para que no se corte
    return widthFromLen(maxLen);
  });
  return `${widths.join(" ")} 8rem`; // última = Acciones
}

// ---------------------------- Persistencia local ----------------------------
function useLocalStorage(key, initial) {
  const [state, setState] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial; }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} }, [key, state]);
  return [state, setState];
}

// ----------------------------- Comunicación RT -----------------------------
function useRealtimeSync(state, setState) {
  const bcRef = useRef(null);
  const wsRef = useRef(null);
  useEffect(() => {
    try { bcRef.current = new BroadcastChannel("meco-docks"); } catch {}
    const bc = bcRef.current;
    const onMsg = (ev) => { const data = ev && ev.data; if (data?.type === "APP_STATE") setState(data.payload); };
    bc?.addEventListener?.("message", onMsg);
    return () => bc?.removeEventListener?.("message", onMsg);
  }, [setState]);

  useEffect(() => {
    const url = window && window.MECO_WS_URL;
    if (!url) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => { try { ws.send(JSON.stringify({ type: "HELLO", role: "client" })); } catch {} };
    ws.onmessage = (e) => { try { const msg = JSON.parse(e.data); if (msg?.type === "APP_STATE") setState(msg.payload); } catch {} };
    return () => { try { ws.close(); } catch {} };
  }, [setState]);

  useEffect(() => {
    try { bcRef.current?.postMessage({ type: "APP_STATE", payload: state }); } catch {}
    try { wsRef.current?.send(JSON.stringify({ type: "APP_STATE", payload: state })); } catch {}
  }, [state]);
}

// ---------------------------- Derivación de muelles -------------------------
const PRIORITY = { "LIBRE": 0, "ESPERA": 1, "OCUPADO": 2 };

function betterDockState(current, incoming) {
  // Devuelve el estado con mayor prioridad
  if (!current) return incoming;
  return PRIORITY[incoming.state] > PRIORITY[current.state] ? incoming : current;
}

function deriveDocks(lados) {
  // Calcula el estado consolidado de cada muelle a través de TODOS los lados
  const dockMap = new Map();
  DOCKS.forEach((d) => dockMap.set(d, { state: "LIBRE" })); // base

  Object.keys(lados).forEach((ladoName) => {
    (lados[ladoName]?.rows || []).forEach((row) => {
      const muStr = String(row.MUELLE ?? "").trim();
      const muNum = Number(muStr);
      if (!Number.isFinite(muNum) || !DOCKS.includes(muNum)) return;

      const llegadaReal = (row["LLEGADA REAL"] || "").trim();
      const salidaReal  = (row["SALIDA REAL"]  || "").trim();

      // Regla: SALIDA REAL => libera.
      // Si no hay salida:
      //   - con LLEGADA REAL => OCUPADO
      //   - sin LLEGADA REAL => ESPERA (reservado)
      let state = "ESPERA";
      if (llegadaReal) state = "OCUPADO";
      if (salidaReal)  state = "LIBRE";

      const incoming = state === "LIBRE"
        ? { state: "LIBRE" }
        : { state, row, lado: ladoName };

      const prev = dockMap.get(muNum);
      // Nunca dejar que LIBRE pise un no-LIBRE; elegir la mejor prioridad
      const next = state === "LIBRE" ? (prev || { state: "LIBRE" }) : betterDockState(prev, incoming);
      dockMap.set(muNum, next);
    });
  });

  return dockMap;
}

function dockColor(state) {
  if (state === "LIBRE")  return "bg-emerald-500";
  if (state === "ESPERA") return "bg-amber-500";
  return "bg-red-600";
}
function estadoBadgeColor(estado) {
  if (estado === "ANULADO")  return "bg-red-600";
  if (estado === "CARGANDO") return "bg-amber-500";
  return "bg-emerald-600";
}
function rowColorByEstado(estado) {
  if (estado === "ANULADO")  return "bg-red-100";
  if (estado === "CARGANDO") return "bg-amber-100";
  return "bg-emerald-100"; // OK o vacío -> verde
}
function rowAccentBorder(estado) {
  if (estado === "ANULADO")  return "border-l-4 border-red-400";
  if (estado === "CARGANDO") return "border-l-4 border-amber-400";
  return "border-l-4 border-emerald-400";
}

// ------------------------------- Componente ---------------------------------
export default function MecoDockManager() {
  const [app, setApp] = useLocalStorage("meco-app", {
    lados: Object.fromEntries(LADOS.map((n) => [n, { name: n, rows: [] }]))
  });
  const [active, setActive] = useState(LADOS[0]);
  const [filterEstado, setFilterEstado] = useState("TODOS");
  const [clock, setClock] = useState(nowISO());
  const [dockPanel, setDockPanel] = useState({ open: false, dock: undefined, lado: undefined, rowId: undefined });
  const [debugOpen, setDebugOpen] = useState(false);
  const [importInfo, setImportInfo] = useState(null);

  // Orden columnas (drag&drop)
  const [columnOrder, setColumnOrder] = useLocalStorage("meco-colorder", DEFAULT_ORDER);

  // DnD estado
  const dragInfoRef = useRef({ from: null, to: null });
  const [draggingKey, setDraggingKey] = useState(null);

  useRealtimeSync(app, setApp);
  useEffect(() => { const t = setInterval(() => setClock(nowISO()), 1000); return () => clearInterval(t); }, []);

  const docks = useMemo(() => deriveDocks(app.lados), [app]);

  function updateRow(lado, id, patch) {
    setApp((prev) => {
      const rows = prev.lados[lado].rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
      return { ...prev, lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows } } };
    });
  }
  function addRow(lado) {
    const newRow = { id: crypto.randomUUID(), ESTADO: "OK" };
    setApp((prev) => ({ ...prev, lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows: [newRow, ...prev.lados[lado].rows] } } }));
  }
  function removeRow(lado, id) {
    setApp((prev) => ({ ...prev, lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows: prev.lados[lado].rows.filter((r) => r.id !== id) } } }));
  }
  function clearLado(lado) {
    setApp((prev) => ({ ...prev, lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows: [] } } }));
  }

  // ------------------------------ Importador XLSX ---------------------------
  function importExcel(file, lado) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const results = [];
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name];
          if (!ws) continue;
          const parsed = tryParseSheet(ws, name);
          results.push(parsed);
        }
        results.sort((a, b) => (b.rows.length - a.rows.length) || (b.bestScore - a.bestScore));
        const best = results[0] || null;

        setImportInfo({
          sheetsTried: results.map(r => ({ sheet: r.sheetName, headerRowIdx: r.headerRowIdx, bestScore: r.bestScore, headers: r.headers, rows: r.rows.length })),
          chosen: best ? { sheet: best.sheetName, headerRowIdx: best.headerRowIdx, bestScore: best.bestScore, headers: best.headers, rows: best.rows.length } : null,
        });

        const rows = best?.rows ?? [];
        setApp((prev) => ({ ...prev, lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows } } }));
        if (!rows.length) alert("No se han detectado filas con datos. Revisa cabeceras y datos.");
      } catch (err) { console.error(err); alert("Error al leer el Excel. ¿Es un .xlsx válido?"); }
    };
    reader.readAsArrayBuffer(file);
  }

  function tryParseSheet(ws, sheetName) {
    const rows2D = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    let headerRowIdx = -1, bestScore = -1, limit = Math.min(rows2D.length, 40);
    for (let r = 0; r < limit; r++) {
      const mapped = (rows2D[r] || []).map((h) => mapHeader(h));
      const score = mapped.reduce((acc, h) => acc + (EXPECTED_KEYS.includes(h) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; headerRowIdx = r; }
    }
    if (headerRowIdx < 0) headerRowIdx = 0;
    expandHeaderMerges(ws, headerRowIdx);

    let ws2 = ws;
    if (ws["!ref"]) {
      const range = XLSX.utils.decode_range(ws["!ref"]);
      range.s.r = headerRowIdx;
      ws2 = { ...ws, "!ref": XLSX.utils.encode_range(range) };
    }

    const json = XLSX.utils.sheet_to_json(ws2, { defval: "", raw: false });
    const rows = [];
    const seenHeaders = new Set();

    json.forEach((row) => {
      const obj = {};
      Object.keys(row).forEach((kRaw) => {
        const k = mapHeader(kRaw);
        seenHeaders.add(k);
        obj[k] = coerceCell(row[kRaw]);
      });
      // aseguramos todas las keys esperadas
      for (const h of EXPECTED_KEYS) if (!(h in obj)) obj[h] = "";
      const keysMin = ["TRANSPORTISTA","MATRICULA","DESTINO","LLEGADA","SALIDA","OBSERVACIONES"];
      const allEmpty = keysMin.every(k => String(obj[k] || "").trim() === "");
      if (allEmpty) return;
      if (!obj["ESTADO"]) obj["ESTADO"] = "OK";
      rows.push({ id: crypto.randomUUID(), ...obj });
    });

    return { sheetName, headerRowIdx, bestScore, headers: Array.from(seenHeaders), rows };
  }
  function expandHeaderMerges(ws, headerRowIdx) {
    const merges = ws["!merges"] || [];
    merges.forEach((m) => {
      if (m.s.r <= headerRowIdx && m.e.r >= headerRowIdx) {
        const srcAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
        const src = ws[srcAddr];
        if (!src || !src.v) return;
        const text = coerceCell(src.v);
        for (let c = m.s.c; c <= m.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
          const cell = ws[addr] || (ws[addr] = {});
          cell.v = text; cell.t = "s";
        }
      }
    });
  }

  function filteredRows(lado) {
    const list = app.lados[lado].rows;
    if (filterEstado === "TODOS") return list;
    return list.filter((r) => (r.ESTADO || "OK") === filterEstado);
  }

  // --------------------------- DnD Handlers (HTML5) -------------------------
  function onHeaderDragStart(e, key) {
    setDraggingKey(key);
    dragInfoRef.current.from = key;
    e.dataTransfer.setData("text/plain", key);
    e.dataTransfer.effectAllowed = "move";
  }
  function onHeaderDragOver(e, overKey) {
    e.preventDefault();
    dragInfoRef.current.to = overKey;
  }
  function onHeaderDrop(e, dropKey) {
    e.preventDefault();
    const fromKey = dragInfoRef.current.from;
    const toKey   = dropKey || dragInfoRef.current.to;
    if (!fromKey || !toKey || fromKey === toKey) {
      setDraggingKey(null);
      dragInfoRef.current = { from: null, to: null };
      return;
    }
    const newOrder = reorder(columnOrder, fromKey, toKey);
    setColumnOrder(newOrder);
    setDraggingKey(null);
    dragInfoRef.current = { from: null, to: null };
  }
  function onHeaderDragEnd() {
    setDraggingKey(null);
    dragInfoRef.current = { from: null, to: null };
  }
  function reorder(order, fromKey, toKey) {
    const arr = order.slice();
    const fromIdx = arr.indexOf(fromKey);
    const toIdx = arr.indexOf(toKey);
    if (fromIdx === -1 || toIdx === -1) return order;
    arr.splice(toIdx, 0, arr.splice(fromIdx, 1)[0]);
    return arr;
  }

  // --------------------------- Render ---------------------------------------
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

        {/* 2 columnas: principal + derecha 290px */}
        <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) 290px" }}>
          {/* Izquierda: pestañas + tabla */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>Operativas por lado</CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setColumnOrder(DEFAULT_ORDER)}>
                    Restablecer orden
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDebugOpen(v => !v)}>
                    {debugOpen ? "Ocultar diagnóstico" : "Ver diagnóstico de importación"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {debugOpen && (
                <div className="mb-3 p-3 border rounded text-xs bg-amber-50">
                  <div className="font-semibold mb-1">Diagnóstico última importación</div>
                  {!importInfo ? (
                    <div className="text-muted-foreground">Aún no has importado ningún Excel.</div>
                  ) : (
                    <>
                      <div className="mb-2">Hojas analizadas:</div>
                      <ul className="list-disc pl-5 space-y-1">
                        {importInfo.sheetsTried.map((it, idx) => (
                          <li key={idx}>
                            <span className="font-mono">{it.sheet}</span> · cabecera en fila <b>{it.headerRowIdx+1}</b> · score <b>{it.bestScore}</b> · columnas: <span className="font-mono">{(it.headers||[]).join(", ")}</span> · filas: <b>{it.rows}</b>
                          </li>
                        ))}
                      </ul>
                      {importInfo.chosen && (
                        <div className="mt-2">
                          <div><b>Usando hoja:</b> <span className="font-mono">{importInfo.chosen.sheet}</span></div>
                          <div><b>Cabecera en fila:</b> {importInfo.chosen.headerRowIdx + 1}</div>
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
                  {LADOS.map((n) => <TabsTrigger key={n} value={n} className="px-3">{n}</TabsTrigger>)}
                </TabsList>

                <div className="mt-3">
                  <ToolbarX
                    onImport={(f) => importExcel(f, active)}
                    onAddRow={() => addRow(active)}
                    onClear={() => clearLado(active)}
                    filterEstado={filterEstado}
                    setFilterEstado={setFilterEstado}
                    onExport={() => exportCSV(active, app, columnOrder)}
                  />
                </div>

                {LADOS.map((n) => {
                  const rows = app.lados[n].rows;
                  const gridTemplate = computeColumnTemplate(rows, columnOrder);
                  return (
                    <TabsContent key={n} value={n} className="mt-3">
                      <div className="border rounded-xl overflow-hidden">
                        <div className="overflow-auto max-h-[84vh]">
                          {/* Header sticky con drag&drop */}
                          <div className="grid bg-slate-200 sticky top-0 z-10 select-none" style={{ gridTemplateColumns: gridTemplate }}>
                            {columnOrder.map((h) => (
                              <HeaderCell
                                key={h}
                                title={h}
                                dragging={draggingKey === h}
                                onDragStart={(e) => onHeaderDragStart(e, h)}
                                onDragOver={(e) => onHeaderDragOver(e, h)}
                                onDrop={(e) => onHeaderDrop(e, h)}
                                onDragEnd={onHeaderDragEnd}
                              />
                            ))}
                            <div className="bg-slate-50 p-2">
                              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Acciones</div>
                            </div>
                          </div>

                          {/* Filas */}
                          <div>
                            {filteredRows(n).map((row) => {
                              const estado = (row.ESTADO || "OK").toString();
                              return (
                                <div
                                  key={row.id}
                                  className={`grid border-t ${rowColorByEstado(estado)} ${rowAccentBorder(estado)} border-slate-200`}
                                  style={{ gridTemplateColumns: gridTemplate }}
                                >
                                  {columnOrder.map((h) => {
                                    const isEstado = h === "ESTADO";
                                    const isInc    = h === "INCIDENCIAS";
                                    return (
                                      <div key={h} className="p-1 border-r border-slate-100/60 flex items-center">
                                        {isEstado ? (
                                          <select
                                            className="h-8 w-full border rounded px-2 bg-white/90 text-sm"
                                            value={(row.ESTADO ?? "").toString()}
                                            onChange={(e)=>updateRow(n, row.id, { ESTADO: e.target.value })}
                                          >
                                            <option value="">Seleccionar</option>
                                            {CAMION_ESTADOS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                          </select>
                                        ) : isInc ? (
                                          <select
                                            className="h-8 w-full border rounded px-2 bg-white/90 text-sm"
                                            value={(row.INCIDENCIAS ?? "").toString()}
                                            onChange={(e)=>updateRow(n, row.id, { INCIDENCIAS: e.target.value })}
                                          >
                                            <option value="">Seleccionar</option>
                                            {INCIDENTES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                          </select>
                                        ) : (
                                          <input
                                            className="h-8 w-full border rounded px-2 bg-white/90 text-sm"
                                            value={(row[h] ?? "").toString()}
                                            onChange={(e) => updateRow(n, row.id, { [h]: e.target.value })}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                  <div className="p-1 flex items-center justify-center">
                                    <Button size="icon" variant="ghost" onClick={() => removeRow(n, row.id)}>
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
              </Tabs>
            </CardContent>
          </Card>

          {/* Derecha: estrecha (290px) y vertical */}
          <DockRight app={app} setDockPanel={setDockPanel} dockPanel={dockPanel} />
        </div>

        {/* Drawer lateral (inputs 100% interactivos) */}
        <DockDrawer app={app} dockPanel={dockPanel} setDockPanel={setDockPanel} updateRow={updateRow} />

        <footer className="mt-4 text-xs text-muted-foreground flex items-center justify-between">
          <div>Estados camión: <Badge className="bg-emerald-600">OK</Badge> · <Badge className="bg-amber-500">CARGANDO</Badge> · <Badge className="bg-red-600">ANULADO</Badge></div>
          <div>© {new Date().getFullYear()} PLMECO · Plataforma Logística Meco (Inditex)</div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

// ------------------------------ Panel derecha -------------------------------
function DockRight({ app, setDockPanel, dockPanel }) {
  const docks = useMemo(() => deriveDocks(app.lados), [app]);
  const legend = (
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
          {DOCKS.map((d) => {
            const info = docks.get(d) || { state: "LIBRE" };
            const color = dockColor(info.state);
            const label = `${d}`;
            const tooltip = info.row
              ? `${label} • ${info.row.MATRICULA || "?"} • ${info.row.DESTINO || "?"} • ${(info.row.ESTADO || "OK")}`
              : `${label} • Libre`;

            const btn = (
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => setDockPanel({ open: true, dock: d, lado: info.lado, rowId: info.row?.id })}
                className={`h-9 rounded-xl text-white text-sm font-semibold shadow ${color}`}
              >
                {label}
              </motion.button>
            );

            return dockPanel.open ? (
              <div key={d}>{btn}</div>
            ) : (
              <Tooltip key={d}>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent><p>{tooltip}</p></TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------ Drawer lateral ------------------------------
function DockDrawer({ app, dockPanel, setDockPanel, updateRow }) {
  return dockPanel.open && (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-[9998]"
        onClick={() => setDockPanel({ open: false, dock: undefined, lado: undefined, rowId: undefined })}
      />
      <div
        className="fixed right-0 top-0 h-screen w-[280px] sm:w-[320px] bg-white z-[9999] shadow-2xl border-l pointer-events-auto"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Muelle {dockPanel.dock}</div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setDockPanel({ open: false, dock: undefined, lado: undefined, rowId: undefined })}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto h-[calc(100vh-56px)]">
          {(() => {
            const { lado, rowId } = dockPanel;
            if (!lado || !rowId) return <div className="text-emerald-600 font-medium">Muelle libre</div>;
            const r = app.lados[lado]?.rows.find(rr => rr.id === rowId);
            if (!r) return <div className="text-muted-foreground">No se encontró la fila.</div>;

            return (
              <div className="space-y-2">
                <KV label="Lado" value={lado} />
                <KV label="Matrícula" value={r.MATRICULA || "—"} maxw />
                <KV label="Destino" value={r.DESTINO || "—"} maxw />
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Estado</div>
                  <Badge className={`${estadoBadgeColor(r.ESTADO)} text-white`}>{r.ESTADO || "OK"}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <InputX
                    label="Llegada real"
                    value={(r["LLEGADA REAL"] ?? "").toString()}
                    onChange={(v) => updateRow(lado, r.id, { "LLEGADA REAL": v })}
                    placeholder="hh:mm / ISO"
                  />
                  <InputX
                    label="Salida real"
                    value={(r["SALIDA REAL"] ?? "").toString()}
                    onChange={(v) => updateRow(lado, r.id, { "SALIDA REAL": v })}
                    placeholder="hh:mm / ISO"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <InputX
                    label="Muelle"
                    value={(r["MUELLE"] ?? "").toString()}
                    onChange={(v) => updateRow(lado, r.id, { MUELLE: v })}
                    placeholder="nº muelle"
                    help="* Se valida en la parrilla"
                  />
                  <InputX
                    label="Precinto"
                    value={(r["PRECINTO"] ?? "").toString()}
                    onChange={(v) => updateRow(lado, r.id, { "PRECINTO": v })}
                    placeholder="Precinto"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <SelectX
                    label="Incidencias"
                    value={(r["INCIDENCIAS"] ?? "").toString()}
                    onChange={(v) => updateRow(lado, r.id, { "INCIDENCIAS": v })}
                    options={INCIDENTES}
                  />
                  <SelectX
                    label="Estado"
                    value={(r["ESTADO"] ?? "").toString()}
                    onChange={(v) => updateRow(lado, r.id, { "ESTADO": v })}
                    options={CAMION_ESTADOS}
                  />
                </div>

                <InputX
                  label="Observaciones"
                  value={(r.OBSERVACIONES ?? "").toString()}
                  onChange={(v) => updateRow(lado, r.id, { OBSERVACIONES: v })}
                  placeholder="Añade notas"
                />
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}

// ------------------------------ Subcomponentes UI ---------------------------
function HeaderCell({ title, dragging, onDragStart, onDragOver, onDrop, onDragEnd }) {
  return (
    <div
      className={`bg-slate-50 p-2 border-r border-slate-200 cursor-grab ${dragging ? "opacity-60 ring-2 ring-sky-400" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title="Arrastra para reordenar"
    >
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
        <span className="inline-block select-none">⋮⋮</span>
        {title}
      </div>
    </div>
  );
}
function KV({ label, value, maxw }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`font-medium ${maxw ? "truncate max-w-[150px]" : ""}`}>{value}</div>
    </div>
  );
}
function InputX({ label, value, onChange, placeholder, help }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
      <input
        className="h-9 w-full border rounded px-2 bg-white text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {help ? <div className="text-[10px] text-muted-foreground mt-0.5">{help}</div> : null}
    </div>
  );
}
function SelectX({ label, value, onChange, options }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
      <select
        className="h-9 w-full border rounded px-2 bg-white text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Seleccionar</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

// ------------------------------ Toolbar & Export ----------------------------
function ToolbarX({ onImport, onAddRow, onClear, filterEstado, setFilterEstado, onExport }) {
  const fileRef = useRef(null);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          if (f) onImport(f);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />
      <Button size="sm" variant="secondary" onClick={() => fileRef.current && fileRef.current.click()}>
        <FileUp className="mr-2 h-4 w-4" /> Importar Excel
      </Button>
      <Button size="sm" onClick={onExport}>
        <Download className="mr-2 h-4 w-4" /> Exportar CSV
      </Button>
      <Button size="sm" variant="outline" onClick={onAddRow}>
        <Plus className="mr-2 h-4 w-4" /> Nueva fila
      </Button>
      <Button size="sm" variant="destructive" onClick={onClear}>
        <Trash2 className="mr-2 h-4 w-4" /> Vaciar lado
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filtrar estado</span>
        <select
          className="h-8 w-[160px] border rounded px-2 bg-white text-sm"
          value={filterEstado === "TODOS" ? "" : filterEstado}
          onChange={(e)=> setFilterEstado(e.target.value || "TODOS")}
        >
          <option value="">Todos</option>
        {CAMION_ESTADOS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    </div>
  );
}

function exportCSV(lado, app, columnOrder) {
  const headers = columnOrder;
  const rows = app.lados[lado].rows;
  const csv = [headers.join(",")]
    .concat(rows.map((r) => headers.map((h) => (r[h] ?? "")).join(",")))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${lado.replace(/\s+/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
