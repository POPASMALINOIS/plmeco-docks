function importExcel(file, lado) {
  const reader = new FileReader();

  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const wb = XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // ===== Encabezados en FILA 3 =====
    // Ajustamos el rango para que XLSX tome la fila 3 (1-index) como cabecera
    if (ws && ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      range.s.r = 2; // 0-index → fila 3
      ws['!ref'] = XLSX.utils.encode_range(range);
    }

    // Leemos la hoja con esas cabeceras
    const json = XLSX.utils.sheet_to_json(ws, {
      defval: "",  // mantener celdas vacías
      raw: false   // formatear como texto legible (fechas/números)
    });

    // Catálogo de cabeceras esperado (base + extras)
    const ALL_HEADERS = [
      "TRANSPORTISTA","MATRICULA","DESTINO","LLEGADA","SALIDA","SALIDA TOPE","OBSERVACIONES",
      "MUELLE","PRECINTO","LLEGADA REAL","SALIDA REAL","INCIDENCIAS","ESTADO"
    ];

    // Aliases para mapear nombres “libres” a los esperados
    const HEADER_ALIASES = {
      "transportista": "TRANSPORTISTA",
      "transporte": "TRANSPORTISTA",
      "carrier": "TRANSPORTISTA",
      "matricula": "MATRICULA",
      "matrícula": "MATRICULA",
      "placa": "MATRICULA",
      "destino": "DESTINO",
      "llegada": "LLEGADA",
      "entrada": "LLEGADA",
      "salida": "SALIDA",
      "salida tope": "SALIDA TOPE",
      "cierre": "SALIDA TOPE",
      "observaciones": "OBSERVACIONES",
    };

    // Normaliza texto (minúsculas + sin tildes)
    function norm(s) {
      return (s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim();
    }

    function mapHeader(name) {
      const n = norm(name);
      return HEADER_ALIASES[n] || (name || "").toUpperCase();
    }

    // Lista de muelles válidos (para validar MUELLE)
    const DOCKS = [
      312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,
      351,352,353,354,355,356,357,359,360,361,362,363,364,365,366,367,368,369,
    ];

    // Construimos las filas normalizadas
    const rows = json.map((row) => {
      const mapped = {};

      // 1) Mapear cabeceras del Excel a las esperadas
      Object.keys(row).forEach((k) => {
        const mk = mapHeader(String(k || "").trim());
        mapped[mk] = row[k];
      });

      // 2) Asegurar todas las columnas (rellenar vacíos)
      ALL_HEADERS.forEach((h) => { if (!(h in mapped)) mapped[h] = ""; });

      // 3) Validar MUELLE (si viene) y dejarlo vacío si no es válido
      if (mapped["MUELLE"]) {
        const num = Number(String(mapped["MUELLE"]).trim());
        mapped["MUELLE"] = Number.isFinite(num) && DOCKS.includes(num) ? num : "";
      }

      // 4) Estado por defecto
      if (!mapped["ESTADO"]) mapped["ESTADO"] = "OK";

      return { id: crypto.randomUUID(), ...mapped };
    });

    // Guardar en el lado correspondiente
    setApp((prev) => ({
      ...prev,
      lados: { ...prev.lados, [lado]: { ...prev.lados[lado], rows } },
    }));
  };

  reader.readAsArrayBuffer(file);
}
