// src/sync/sharedState.ts
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "").trim();   // p.ej. "http://SERVIDOR:4000"
const BACKEND_TOKEN = (import.meta.env.VITE_BACKEND_TOKEN || "").trim(); // el mismo TOKEN del backend

function safeParse<T>(s: string | null, fallback: T): T {
  try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; }
}

/**
 * useSharedState:
 * - Mantiene el estado en localStorage (como antes).
 * - Si hay BACKEND_URL + TOKEN, se conecta por Socket.IO:
 *   - Al entrar, recibe state remoto (o sube el local si ya existe).
 *   - En cada cambio local, envía un patch a los demás clientes.
 * - API compatible con useState: [state, setState]
 */
export function useSharedState<T>(
  storageKey: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => safeParse<T>(localStorage.getItem(storageKey), initial));

  const socketRef = useRef<Socket | null>(null);
  const readyRef = useRef(false); // true cuando ya sincronizamos init/replace

  // Persistencia local siempre
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
  }, [storageKey, state]);

  // Conexión Socket.IO si hay variables de entorno configuradas
  useEffect(() => {
    if (!BACKEND_URL || !BACKEND_TOKEN) return; // sin backend => solo localStorage

    const socket = io(BACKEND_URL, { transports: ["websocket"], auth: { token: BACKEND_TOKEN } });
    socketRef.current = socket;

    // Estado inicial desde el backend
    socket.on("state:init", (remote: any) => {
      const local = safeParse<T>(localStorage.getItem(storageKey), initial);
      const isEmptyLocal = !local || (typeof local === "object" && Object.keys(local as any).length === 0);
      if (isEmptyLocal) {
        setState(remote);
      } else {
        socket.emit("state:replace", local);
      }
      readyRef.current = true;
    });

    // Reemplazo completo recibido
    socket.on("state:replace", (remote: any) => {
      setState(remote);
    });

    // Patch remoto recibido (fusión recursiva)
    socket.on("state:patch", (delta: any) => {
      setState(prev => deepMerge(prev, delta));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [storageKey]);

  // Enviar patch en cada cambio local (ligeramente debounce)
  useEffect(() => {
    if (!BACKEND_URL || !BACKEND_TOKEN) return;
    if (!readyRef.current) return;
    const t = setTimeout(() => {
      socketRef.current?.emit("state:patch", state);
    }, 50);
    return () => clearTimeout(t);
  }, [state]);

  return [state, setState];
}

// Fusión recursiva simple: objetos profundos, arrays se reemplazan
function deepMerge(base: any, delta: any): any {
  if (Array.isArray(base) && Array.isArray(delta)) {
    return delta.slice();
  }
  if (isObj(base) && isObj(delta)) {
    const out: any = { ...base };
    for (const k of Object.keys(delta)) out[k] = deepMerge(base[k], delta[k]);
    return out;
  }
  return delta;
}
function isObj(x: any) { return x && typeof x === "object" && !Array.isArray(x); }
