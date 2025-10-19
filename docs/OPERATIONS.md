# Operaciones (Runbooks)

Arranque / Parada / Reinicio
```bash
docker compose up -d
docker compose stop
docker compose restart collab
```

Logs y diagnóstico
```bash
docker compose logs -f collab
docker compose logs -f caddy   # o nginx
```

Verificación de servicio (WebSocket)
```bash
# Con wscat (Node)
npx wscat -c wss://collab.example.com

# En LAN (sin TLS, solo para pruebas)
npx wscat -c ws://HOST_IP:1234
```

Actualizaciones
```bash
# Obtén la última imagen
docker compose pull collab

# Recrea solo el servicio collab
docker compose up -d collab
```

Rollback
```bash
# Edita docker-compose.yml para fijar un tag anterior:
# image: ghcr.io/POPASMALINOIS/plmeco-docks-collab:<tag-anterior>
docker compose up -d collab
```

Backups
- No aplican al servicio `collab` (no hay datos persistentes).
- En su lugar, respalda configuraciones del proxy y automatizaciones (Caddyfile / nginx.conf / Compose).
