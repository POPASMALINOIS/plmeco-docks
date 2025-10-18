// src/collab/collabClient.js
// WebSocket client for real-time collaboration

/**
 * Get the WebSocket URL for collaboration
 * Priority:
 * 1. window.MECO_WS_URL (runtime configuration)
 * 2. VITE_MECO_WS_URL (build-time environment variable)
 * 3. Auto-detect based on current location (for LAN testing)
 */
export function getWebSocketUrl() {
  // Check runtime configuration first
  if (typeof window !== 'undefined' && window.MECO_WS_URL) {
    return window.MECO_WS_URL;
  }

  // Check build-time environment variable
  if (import.meta.env.VITE_MECO_WS_URL) {
    return import.meta.env.VITE_MECO_WS_URL;
  }

  // Fallback: auto-detect based on current location
  // Use ws:// protocol for LAN testing (not wss://)
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    const port = 8080; // Default WebSocket server port for LAN testing
    return `ws://${hostname}:${port}`;
  }

  // Ultimate fallback
  return 'ws://localhost:8080';
}

/**
 * Create a WebSocket connection for collaboration
 */
export function createCollabConnection() {
  const url = getWebSocketUrl();
  console.log('[CollabClient] Connecting to:', url);
  
  try {
    const ws = new WebSocket(url);
    
    ws.addEventListener('open', () => {
      console.log('[CollabClient] Connected to collaboration server');
    });
    
    ws.addEventListener('error', (error) => {
      console.error('[CollabClient] WebSocket error:', error);
    });
    
    ws.addEventListener('close', () => {
      console.log('[CollabClient] Disconnected from collaboration server');
    });
    
    return ws;
  } catch (error) {
    console.error('[CollabClient] Failed to create WebSocket connection:', error);
    return null;
  }
}

export default {
  getWebSocketUrl,
  createCollabConnection,
};
