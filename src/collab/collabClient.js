// Cliente de colaboración (Yjs + y-websocket)
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

// Prioridad de URL del servidor WS:
// 1) window.MECO_WS_URL (definible en index.html)
// 2) import.meta.env.VITE_MECO_WS_URL (variables Vite)
// 3) 'ws://localhost:1234' por defecto
export const WS_URL =
  (typeof window !== 'undefined' && window.MECO_WS_URL) ||
  import.meta.env.VITE_MECO_WS_URL ||
  'ws://localhost:1234'

// Nombre de sala (room) compartida
export const ROOM = import.meta.env.VITE_MECO_ROOM || 'plmeco-docks'

// Documento Yjs y proveedor WebSocket
export const doc = new Y.Doc()
export const provider = new WebsocketProvider(WS_URL, ROOM, doc, { connect: true })
export const awareness = provider.awareness

// Helpers para estructuras Yjs
export function getOrCreateMap(name) {
  return doc.getMap(name)
}
export function getOrCreateArray(name) {
  return doc.getArray(name)
}
