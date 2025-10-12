import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, FileUp, Plus, Trash2, X } from "lucide-react";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";

/**
 * PLMECO – Gestión de Muelles (WEB)
 * - MUELLE editable como texto (validación diferida en parrilla).
 * - Selects de ESTADO/INCIDENCIAS con <select> nativo (funciona siempre).
 * - Contenedor tabla alto (84vh) con header sticky y auto-ancho de columnas.
 * - Panel de muelle estrecho y a pantalla completa.
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

const BASE_HEADERS = [
  "TRANSPORTISTA",
  "MATRICULA",
  "DESTINO",
  "LLEGADA",
  "SALIDA",
  "SALIDA TOPE",
  "OBSERVACIONES",
];
const EXTRA_HEADERS = [
  "MUELLE",
  "PRECINTO",
  "LLEGADA REAL",
  "SALIDA REAL",
  "INCIDENCIAS",
  "ESTADO",
];
const ALL_HEADERS = [...BASE_HEADERS, ...EXTRA_HEADERS];
const EXPECTED_KEYS = [...ALL_HEADERS];

// Alias de cabeceras
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

// --------------------------- Utilidades comunes -----------------------------
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

// Autoancho por contenido (ancho en "ch")
function widthFromLen(len) {
  const ch = Math.min(Math.max(len * 0.7 + 3, 10), 46); // 10–46ch
  return `${Math.round(ch)}ch`;
}
function computeColumnTemplate(rows) {
  const widths = ALL_HEADERS.map((h) => {
    const maxLen = Math.max(
      (h || "").length,
      ...rows.map(r => ((r?.[h] ?? "") + "").length)
    );
    return widthFromLen(maxLen);
  });
  return `${widths.join(" ")} 8rem`; // última es Acciones (8rem)
}

// ---------------------------- Persistencia local ----------------------------
function useLocalStorage(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

// ----------------------------- Comunicación RT -----------------------------
function useRealtimeSync(state, setState) {
  const bcRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    try { bcRef.current = new BroadcastChannel("meco-docks"); } catch {}
    const bc = bcRef.current;
    const onMsg = (ev) => {
      const data = ev && ev.data;
      if (data && data.type === "APP_STATE") setState(data.payload);
    };
    bc && bc.addEventListener && bc.addEventListener("message", onMsg);
    return () => bc && bc.removeEventListener && bc.removeEventListener("message", onMsg);
  }, [setState]);

  useEffect(() => {
    const url = window && window.MECO_WS_URL;
    if (!url) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => { try { ws.send(JSON.stringify({ type: "HELLO", role: "client" })); } catch {} };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg && msg.type === "APP_STATE") setState(msg.payload);
      } catch {}
    };
    return () => { try { ws.close(); } catch {} };
  }, [setState]);

  useEffect(() => {
    try { bcRef.current?.postMessage({ type: "APP_STATE", payload: state }); } catch {}
    try { wsRef.current?.send(JSON.stringify({ type: "APP_STATE", payload: state })); } catch {}
  }, [state]);
}

// ---------------------------- Derivación de muelles -------------------------
function deriveDocks(lados) {
  const dockMap = new Map();
  DOCKS.forEach((d) => dockMap.set(d, { state: "LIBRE" }));

  Object.keys(lados).forEach((ladoName) => {
    lados[ladoName].rows.forEach((row) => {
      const muNum = Number(String(row.MUELLE ?? "").trim());
      if (!Number.isFinite(muNum) || !DOCKS.includes(muNum)) return;

      const llegadaReal = (row["LLEGADA REAL"] || "").trim();
      const salidaReal  = (row["SALIDA REAL"]  || "").trim();

      let state = "ESPERA";
      if (llegadaReal) state = "OCUPADO";
      if (salidaReal)  state = "LIBRE";

      if (state !== "LIBRE") {
        dockMap.set(muNum, { state, row, lado: ladoName });
      } else {
        if (dockMap.has(muNum)) {
          const prev = dockMap.get(muNum);
          if (prev.state !== "OCUPADO") dockMap.set(muNum, { state: "LIBRE" });
        }
      }
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

// ------------------------------- Celdas editables ---------------------------
function SelectNative({ value, onChange, options, placeholder = "Seleccionar", className="" }) {
  // value siempre string; placeholder como opción vacía
  const v = (value ?? "").toString();
  return (
    <select
      className={`h-8 w-full border rounded px-2 bg-white text-sm ${className}`}
      value={v}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

function EditableCell({ value, onChange, type = "text", className = "", options }) {
  if (type === "select" && options) {
    return <SelectNative value={value} onChange={onChange} options={options} className={className} />;
  }
  return (
    <Input
      value={(value ?? "").toString()}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 ${className}`}
      type={type === "number" ? "number" : "text"}
    />
  );
}

function Header({ title }) {
  return (
    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
      {title}
    </div>
  );
}

// ------------------------------ Importador XLSX -----------------------------
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
        cell.v = text;
        cell.t = "s";
      }
    }
  });
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
    for (const h of EXPECTED_KEYS) if (!(h in obj)) obj[h] = "";

    const keysMin = ["TRANSPORTISTA","MATRICULA","DESTINO","LLEGADA","SALIDA","OBSERVACIONES"];
    const allEmpty = keysMin.every(k => String(obj[k] || "").trim() === "");
    if (allEmpty) return;

    if (!obj["ESTADO"]) obj["ESTADO"] = "OK";

    rows.push({ id: crypto.randomUUID(), ...obj });
  });

  return { sheetName, headerRowIdx, bestScore, headers: Array.from(seenHeaders), rows };
}

// ------------------------------- Componente App -----------------------------
export default function MecoDockManager() {
  const [app, setApp] = useLocalStorage("meco-app", {
    lados: Object.fromEntries(LADOS.map((n) => [n, { name: n, rows: [] }]))
  });
  const [active, setActive] = useState(LADOS[0]);
  const [filterEstado, setFilterEstado] = useState("TODOS");
  const [clock, setClock] = useState(nowISO());
  const [dockPanel, setDockPanel] = useState({ open: false, dock: undefined, info: undefined });
  const [debugOpen, setDebugOpen] = useState(false);
  const [importInfo, setImportInfo] = useState(null);

  useRealtimeSync(app, setApp);

  useEffect(() => {
    const t = setInterval(() => setClock(nowISO()), 1000);
    return () => clearInterval(t);
  }, []);

  const docks = useMemo(() => deriveDocks(app.lados), [app]);

  function updateRow(lado, id, patch) {
    setApp((prev) => {
      const rows = prev.lados[lado].rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
      return { ...prev, lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows } } };
    });
  }
  function addRow(lado) {
    const newRow = { id: crypto.randomUUID(), ESTADO: "OK" };
    setApp((prev) => ({
      ...prev,
      lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows: [newRow, ...prev.lados[lado].rows] } },
    }));
  }
  function removeRow(lado, id) {
    setApp((prev) => ({
      ...prev,
      lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows: prev.lados[lado].rows.filter((r) => r.id !== id) } },
    }));
  }
  function clearLado(lado) {
    setApp((prev) => ({ ...prev, lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows: [] } } }));
  }

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
        results.sort((a, b) => {
          if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
          return b.bestScore - a.bestScore;
        });
        const best = results[0] || null;

        setImportInfo({
          sheetsTried: results.map(r => ({
            sheet: r.sheetName,
            headerRowIdx: r.headerRowIdx,
            bestScore: r.bestScore,
            headers: r.headers,
            rows: r.rows.length
          })),
          chosen: best ? {
            sheet: best.sheetName,
            headerRowIdx: best.headerRowIdx,
            bestScore: best.bestScore,
            headers: best.headers,
            rows: best.rows.length
          } : null,
        });

        const rows = best?.rows ?? [];
        setApp((prev) => ({
          ...prev,
          lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows } },
        }));

        if (!rows.length) {
          alert("No se han detectado filas con datos. Revisa que el Excel tenga cabeceras reconocibles y datos debajo.");
        }
      } catch (err) {
        console.error(err);
        alert("Error al leer el Excel. ¿Es un .xlsx válido?");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function filteredRows(lado) {
    const list = app.lados[lado].rows;
    if (filterEstado === "TODOS") return list;
    return list.filter((r) => (r.ESTADO || "OK") === filterEstado);
  }

  const legend = (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-500" /> Libre</div>
      <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-amber-500" /> Espera</div>
      <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-600" /> Ocupado</div>
    </div>
  );

  return (
    <TooltipProvider>
      <div className="w-full min-h-screen p-4 md:p-6 bg-gradient-to-b from-slate-50 to-white">
        <header className="flex items-center gap-2 justify-between mb-3">
          <h1 className="text-2xl font-bold tracking-tight">PLMECO · Gestión de Muelles</h1>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Fecha y hora</div>
            <div className="font-medium">{clock}</div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Columna izquierda: pestañas + tabla */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>Operativas por lado</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setDebugOpen(v => !v)}>
                  {debugOpen ? "Ocultar diagnóstico" : "Ver diagnóstico de importación"}
                </Button>
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
                  {LADOS.map((n) => (
                    <TabsTrigger key={n} value={n} className="px-3">{n}</TabsTrigger>
                  ))}
                </TabsList>

                <div className="mt-3">
                  <ToolbarX
                    onImport={(f) => importExcel(f, active)}
                    onAddRow={() => addRow(active)}
                    onClear={() => clearLado(active)}
                    filterEstado={filterEstado}
                    setFilterEstado={setFilterEstado}
                    onExport={() => exportCSV(active, app)}
                  />
                </div>

                {LADOS.map((n) => {
                  const rows = app.lados[n].rows;
                  const gridTemplate = computeColumnTemplate(rows);
                  return (
                    <TabsContent key={n} value={n} className="mt-3">
                      <div className="border rounded-xl overflow-hidden">
                        {/* ÚNICO contenedor con scroll h+v; header sticky */}
                        <div className="overflow-auto max-h-[84vh]">
                          {/* Header */}
                          <div
                            className="grid bg-slate-200 sticky top-0 z-10"
                            style={{ gridTemplateColumns: gridTemplate }}
                          >
                            {ALL_HEADERS.map((h) => (
                              <div key={h} className="bg-slate-50 p-2 border-r border-slate-200">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</div>
                              </div>
                            ))}
                            <div className="bg-slate-50 p-2">
                              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Acciones</div>
                            </div>
                          </div>

                          {/* Filas */}
                          <div>
                            {filteredRows(n).map((row) => (
                              <div
                                key={row.id}
                                className="grid bg-white border-t border-slate-200"
                                style={{ gridTemplateColumns: gridTemplate }}
                              >
                                {ALL_HEADERS.map((h) => {
                                  const isEstado = h === "ESTADO";
                                  const isInc    = h === "INCIDENCIAS";
                                  const isText = !isEstado && !isInc;
                                  return (
                                    <div key={h} className="p-1 border-r border-slate-100 flex items-center">
                                      <EditableCell
                                        value={row[h]}
                                        onChange={(v) => {
                                          if (isEstado) {
                                            const val = (v || "").toString().trim();
                                            return updateRow(n, row.id, { ESTADO: CAMION_ESTADOS.includes(val) ? val : "" });
                                          }
                                          if (isInc) {
                                            const val = (v || "").toString().trim();
                                            return updateRow(n, row.id, { INCIDENCIAS: INCIDENTES.includes(val) ? val : "" });
                                          }
                                          updateRow(n, row.id, { [h]: v });
                                        }}
                                        type={isText ? "text" : "select"}
                                        options={isEstado ? CAMION_ESTADOS : isInc ? INCIDENTES : undefined}
                                        className="rounded-none border-0 bg-white"
                                      />
                                    </div>
                                  );
                                })}
                                <div className="p-1 flex items-center justify-center">
                                  <Button size="icon" variant="ghost" onClick={() => removeRow(n, row.id)}>
                                    <X className="w-4 h-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  );
                })}
              </Tabs>
            </CardContent>
          </Card>

          {/* Columna derecha: estado de muelles (vertical, sticky) */}
          <Card className="lg:col-span-1 lg:sticky lg:top-4 self-start">
            <CardHeader className="pb-2 flex flex-col gap-2">
              <CardTitle>Muelles (tiempo real)</CardTitle>
              {legend}
            </CardHeader>
            <CardContent className="max-h-[84vh] overflow-auto">
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                {DOCKS.map((d) => {
                  const info = docks.get(d) || { state: "LIBRE" };
                  const color = dockColor(info.state);
                  const label = `${d}`;
                  const tooltip = info.row
                    ? `${label} • ${info.row.MATRICULA || "?"} • ${info.row.DESTINO || "?"} • ${(info.row.ESTADO || "OK")}`
                    : `${label} • Libre`;
                  return (
                    <Tooltip key={d}>
                      <TooltipTrigger asChild>
                        <motion.button
                          whileTap={{ scale: 0.96 }}
                          onClick={() => setDockPanel({ open: true, dock: d, info })}
                          className={`h-10 rounded-2xl text-white text-sm font-semibold shadow ${color}`}
                        >
                          {label}
                        </motion.button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{tooltip}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Panel lateral info de muelle – estrecho y alto completo */}
        <Sheet open={dockPanel.open} onOpenChange={(o) => setDockPanel((p) => ({ ...p, open: o }))}>
          <SheetContent side="right" className="w-[300px] sm:w-[340px] h-screen overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Muelle {dockPanel.dock}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-3 pb-6">
              {(() => {
                const info = dockPanel.info;
                if (!info || !dockPanel.dock) return <div className="text-muted-foreground">Sin información.</div>;
                if (!info.row) return <div className="text-emerald-600 font-medium">Muelle libre</div>;
                const r = info.row;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Lado</div>
                      <div className="font-medium">{info.lado}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Matrícula</div>
                      <div className="font-medium truncate max-w-[160px]">{r.MATRICULA || "—"}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Destino</div>
                      <div className="font-medium truncate max-w-[160px]">{r.DESTINO || "—"}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">Estado</div>
                      <Badge className={`${estadoBadgeColor(r.ESTADO)} text-white`}>{r.ESTADO || "OK"}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <div>
                        <Header title="Llegada real" />
                        <Input
                          value={(r["LLEGADA REAL"] ?? "").toString()}
                          onChange={(e) => updateRow(info.lado, r.id, { "LLEGADA REAL": e.target.value })}
                          placeholder="hh:mm / ISO"
                        />
                      </div>
                      <div>
                        <Header title="Salida real" />
                        <Input
                          value={(r["SALIDA REAL"] ?? "").toString()}
                          onChange={(e) => updateRow(info.lado, r.id, { "SALIDA REAL": e.target.value })}
                          placeholder="hh:mm / ISO"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Header title="Muelle" />
                        <Input
                          value={(r["MUELLE"] ?? "").toString()}
                          onChange={(e) => updateRow(info.lado, r.id, { MUELLE: e.target.value })}
                          placeholder="nº muelle"
                        />
                        <div className="text-[10px] text-muted-foreground mt-0.5">* Se valida en la parrilla</div>
                      </div>
                      <div>
                        <Header title="Precinto" />
                        <Input
                          value={(r["PRECINTO"] ?? "").toString()}
                          onChange={(e) => updateRow(info.lado, r.id, { "PRECINTO": e.target.value })}
                          placeholder="Precinto"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Header title="Incidencias" />
                        <SelectNative
                          value={r["INCIDENCIAS"]}
                          onChange={(v) => updateRow(info.lado, r.id, { "INCIDENCIAS": v })}
                          options={INCIDENTES}
                        />
                      </div>
                      <div>
                        <Header title="Estado" />
                        <SelectNative
                          value={r["ESTADO"]}
                          onChange={(v) => updateRow(info.lado, r.id, { "ESTADO": v })}
                          options={CAMION_ESTADOS}
                        />
                      </div>
                    </div>
                    <div className="pt-2">
                      <Header title="Observaciones" />
                      <Input
                        value={(r.OBSERVACIONES ?? "").toString()}
                        onChange={(e) => updateRow(info.lado, r.id, { OBSERVACIONES: e.target.value })}
                        placeholder="Añade notas"
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          </SheetContent>
        </Sheet>

        <footer className="mt-4 text-xs text-muted-foreground flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div>Estados camión: <Badge className="bg-emerald-600">OK</Badge> · <Badge className="bg-amber-500">CARGANDO</Badge> · <Badge className="bg-red-600">ANULADO</Badge></div>
          <div>© {new Date().getFullYear()} PLMECO · Plataforma Logística Meco (Inditex)</div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

// ------------------------------ Toolbar -------------------------------------
function ToolbarX({
  onImport, onAddRow, onClear, filterEstado, setFilterEstado, onExport,
}) {
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
        <SelectNative
          value={filterEstado === "TODOS" ? "" : filterEstado}
          onChange={(v) => setFilterEstado(v || "TODOS")}
          options={CAMION_ESTADOS}
          className="w-[160px]"
        />
      </div>
    </div>
  );
}

// ----------------------------- Exportar CSV ---------------------------------
function exportCSV(lado, app) {
  const rows = app.lados[lado].rows;
  const headers = ALL_HEADERS;
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
