# Seguridad y Redes

Principios clave
- Usa TLS siempre que el tráfico salga de la LAN. Cliente: `wss://…`.
- Expón solo 80/443 del proxy al exterior; mantén 1234 interno.
- Considera allowlist por IP o autenticación a nivel de proxy para restringir acceso.

Modelo de datos
- y-websocket es in-memory; al reiniciar, los clientes se re-sincronizan.
- No hay persistencia histórica de cambios en el servidor.

Proxy y puertos
- Proxy en 80/443 con TLS termina WSS → WS interno a 127.0.0.1:1234.
- Puerto 1234 no debe exponerse a Internet.

Allowlist por IP (opcional)
- Caddy: usa matcher `remote_ip` (ver Caddyfile de ejemplo).
- Nginx: `allow`/`deny` en el bloque `location /`.

Autenticación (futuro)
- Basic Auth o JWT en el proxy si necesitáis identificar clientes.
- Rate limiting básico en Nginx para mitigación de abuso.

Observabilidad y respuesta a incidentes
- Recolecta logs del proxy y del contenedor `collab`.
- Monitoriza:
  - Errores 4xx/5xx del proxy
  - Reinicios de contenedores
  - Uso de CPU/RAM anómalo
- Plan de contingencia:
  - Ante fallo, reinicia el stack (`docker compose restart`).
  - Para rollback, usa un tag anterior de imagen en `image:` y `up -d`.
