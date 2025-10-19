# Pruebas en LAN (Host + VM / dos PCs)

Objetivo: probar colaboración en tiempo real en la misma red local de forma sencilla.

## Opción A — Un solo comando (si está disponible)
Requisitos: script `npm run dev:lan` y fallback de auto-host habilitado.

En el host (Mac/Windows/Linux):
```bash
npm install
npm run dev:lan
```
- Permite el firewall si lo solicita.
- Averigua la IP del host (ej. 192.168.1.50).

En la otra máquina (VM/otro PC):
- Abre `http://IP_DEL_HOST:5173`
- El cliente se conectará a `ws://IP_DEL_HOST:1234` automáticamente.

## Opción B — Manual (sin scripts especiales)
En el host, arranca el servidor WS:
```bash
npm run collab:server
# o: y-websocket-server --port 1234 --host 0.0.0.0
```
En otra terminal del host, arranca Vite accesible en LAN:
```bash
vite --host
```
Configura el cliente (elige una):
- Archivo `.env.local`:
  ```
  VITE_MECO_WS_URL=ws://IP_DEL_HOST:1234
  ```
- O inyecta en `index.html`:
  ```html
  <script>window.MECO_WS_URL = "ws://IP_DEL_HOST:1234"</script>
  ```

Desde la otra máquina:
- Abre `http://IP_DEL_HOST:5173`.

## Consejos y resolución de problemas
- VM en “Bridge/puente” (no NAT).
- Verifica conectividad:
  - `ping IP_DEL_HOST`
  - `nc -vz IP_DEL_HOST 1234` (Linux/Mac) o `Test-NetConnection IP_DEL_HOST -Port 1234` (Windows)
- Si el WS se abre y se cierra:
  - Firewall del host
  - Servidor WS en ejecución
  - URL correcta (`ws://` en LAN)
