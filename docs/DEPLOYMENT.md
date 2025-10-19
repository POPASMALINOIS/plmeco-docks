# Despliegue del servidor de colaboración (y-websocket)

Este repositorio incluye un cliente que usa Yjs para colaboración en tiempo real y un servidor `y-websocket` que actúa como “hub” WebSocket. El servidor es:
- Stateless e in-memory: al reiniciar, los clientes se re-sincronizan; no hay persistencia.
- Sencillo de escalar horizontalmente (por sala/documento) con balanceo de carga sticky si fuera necesario.

Índice
- 1. Arquitectura
- 2. Rutas de despliegue
  - 2.1 Cloud (24/7)
  - 2.2 On-Prem (NAS/Raspberry/Servidor)
- 3. DNS, TLS y WSS
- 4. Pasos (copy/paste) con Docker Compose
- 5. Configuración del cliente
- 6. Operación: salud, reinicio, logs, actualizaciones y rollback

---

## 1) Arquitectura

Cliente (navegador) <—WSS—> Reverse Proxy (TLS) <—WS—> y-websocket (puerto 1234)

- Reverse proxy recomendado: Caddy o Nginx.
- Exponer solo 80/443 en Internet. Mantener 1234 accesible solo internamente.

## 2) Rutas de despliegue

### 2.1 Cloud (24/7)
- Un VPS/host con Docker y Docker Compose.
- Imagen del servidor en GHCR:
  - ghcr.io/POPASMALINOIS/plmeco-docks-collab:latest
- Reverse proxy con TLS automático (Caddy) o Nginx con certificados.

### 2.2 On-Prem (NAS/Raspberry/Servidor)
- Igual que Cloud, pero dentro de tu red.
- Para acceso externo: abrir puertos 80/443 en el router hacia el proxy, o usar túneles/SD-WAN.
- Para uso solo interno: mantener 80/443 internos y usar certificados internos o HTTP si es estrictamente LAN.

## 3) DNS, TLS y WSS
- Crea un subdominio: collab.example.com apuntando a tu host.
- TLS obligatorio si el tráfico sale de la LAN. El cliente usará `wss://collab.example.com`.
- Mantén el puerto 1234 solo interno; los clientes acceden al proxy (80/443).

## 4) Pasos (copy/paste) con Docker Compose

Prerrequisitos:
- Docker y Docker Compose instalados.
- Dominio apuntando al host (para TLS con Caddy) o certificados listos (para Nginx).

Opción A: Caddy (TLS automático con Let’s Encrypt)
```bash
# Clona o copia los ejemplos
# Colócate en: infra/collab-server/examples/compose-with-caddy
docker compose up -d
docker compose ps
docker compose logs -f caddy
```

Opción B: Nginx (requiere certs en ./certs)
```bash
# Colócate en: infra/collab-server/examples/compose-with-nginx
# Pon tus certificados en ./certs: fullchain.pem y privkey.pem
docker compose up -d
docker compose ps
docker compose logs -f nginx
```

Notas:
- Edita el dominio en el Caddyfile o nginx.conf (collab.example.com).
- El servicio `collab` se publica en 127.0.0.1:1234 y solo el proxy escucha en 80/443.

## 5) Configuración del cliente

Preferido (producción):
- Variable de entorno de Vite:
  - `VITE_MECO_WS_URL=wss://collab.example.com`
- O inyectar en index.html:
  - `window.MECO_WS_URL = "wss://collab.example.com"`

Fallback (solo si se fusiona el PR de auto-host):
- Si no hay variables, el cliente usa `ws://<location.hostname>:1234`. Útil para pruebas LAN.

Sala por defecto:
- `plmeco-docks` (ajústala si necesitáis multitenancy/seguridad adicional en el proxy).

## 6) Operación

Salud y estado:
- Logs:
  - `docker compose logs -f collab`
  - `docker compose logs -f caddy` o `nginx`
- Verificar WebSocket:
  - Con wscat: `npx wscat -c wss://collab.example.com`
  - O desde otra máquina en la LAN si es HTTP: `npx wscat -c ws://HOST_IP:1234`

Reinicio/arranque/parada:
```bash
docker compose restart collab
docker compose stop
docker compose up -d
```

Actualizar imagen (rolling) y rollback:
```bash
# Actualizar a la última imagen
docker compose pull collab
docker compose up -d collab

# Rollback: especifica un tag previo
# (ejemplo) en docker-compose.yml del servicio collab:
# image: ghcr.io/POPASMALINOIS/plmeco-docks-collab:<tag-anterior>
docker compose up -d collab
```

Seguridad y redes:
- Exponer solo 80/443.
- IP allowlist opcional en el proxy.
- Ver más en docs/SECURITY-NETWORKING.md.
