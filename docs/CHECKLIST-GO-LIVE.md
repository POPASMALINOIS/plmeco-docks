# Checklist de Go-Live

Infra
- [ ] Host con Docker y Docker Compose
- [ ] DNS apuntando a collab.example.com (ajustar dominio real)

Seguridad/Redes
- [ ] Solo puertos 80/443 expuestos
- [ ] 1234 interno
- [ ] TLS activo (WSS)
- [ ] (Opcional) Allowlist por IP

Despliegue
- [ ] docker compose up -d (Caddy o Nginx)
- [ ] Logs sin errores

Validación
- [ ] wss://collab.example.com responde (wscat)
- [ ] La app cliente configurada con VITE_MECO_WS_URL o window.MECO_WS_URL
- [ ] Prueba multi-equipo: 2+ navegadores simultáneos conectados

Operación
- [ ] Documentado cómo actualizar y hacer rollback
- [ ] Monitoreo básico de logs y reinicios
