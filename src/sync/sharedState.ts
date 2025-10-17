import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "").trim();
const BACKEND_TOKEN = (import.meta.env.VITE_BACKEND_TOKEN || "").trim();

function safeParse<T>(s: string | null, fallback: T): T {
  try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; }
}

export function useSharedState<T>(storageKey: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => safeParse<T>(localStorage.getItem(storageKey), initial));
  const socketRef = useRef<Socket | null>(null);
  const readyRef = useRef(false);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {} }, [storageKey, state]);

  useEffect(() => {
    if (!BACKEND_URL || !BACKEND_TOKEN) return;
    const socket = io(BACKEND_URL, { transports: ["websocket"], auth: { token: BACKEND_TOKEN } });
    socketRef.current = socket;

    socket.on("state:init", (remote) => {
      const local = safeParse<T>(localStorage.getItem(storageKey), initial);
      if (!local || (typeof local === "object" && Object.keys(local as any).length === 0)) {
        setState(remote);
      } else {
        socket.emit("state:replace", local);
      }
      readyRef.current = true;
    });
    socket.on("state:replace", (remote) => setState(remote));
    socket.on("state:patch", (delta) => setState(prev => deepMerge(prev, delta)));

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [storageKey]);

  useEffect(() => {
    if (!BACKEND_URL || !BACKEND_TOKEN) return;
    if (!readyRef.current) return;
    const t = setTimeout(() => { socketRef.current?.emit("state:patch", state); }, 50);
    return () => clearTimeout(t);
  }, [state]);

  return [state, setState];
}

function deepMerge(base: any, delta: any): any {
  if (Array.isArray(base) && Array.isArray(delta)) return delta.slice();
  if (isObj(base) && isObj(delta)) {
    const out: any = { ...base };
    for (const k of Object.keys(delta)) out[k] = deepMerge(base[k], delta[k]);
    return out;
  }
  return delta;
}
function isObj(x: any) { return x && typeof x === "object" && !Array.isArray(x); }
