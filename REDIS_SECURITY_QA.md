# Redis Security QA

- Redis requires a password: `requirepass` is enabled.
- Redis traffic uses TLS (`rediss://`) inside the Docker Compose stack.
- Redis is not published on the host; no `6379:6379` mapping exists.
- Backend verifies the Redis CA certificate with `rejectUnauthorized=true`.
- Socket.IO Redis adapter uses the same authenticated TLS Redis clients.
- Pub/Sub publisher/subscriber use the same authenticated TLS Redis clients.
- Healthcheck authenticates and verifies TLS with the CA certificate.
- The included certificate/key are for local/demo deployment only; replace them and the password for production.
