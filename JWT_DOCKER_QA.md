# CrowdPulse JWT + Docker QA

## Static verification

- Node syntax check: `backend/*.js`: PASS
- TypeScript/TSX transpile parser check: all `src/**/*.ts(x)`: PASS
- Duplicate `onDisconnect` declaration removed: PASS
- Dashboard no longer sends the hard-coded `x-admin-key`: PASS
- JWT is attached to REST requests: PASS
- JWT is attached to Socket.IO handshake: PASS
- Simulator authenticates as sensor role: PASS
- Admin/operator demo routes accept JWT: PASS
- Sensor ingestion accepts sensor/admin/operator JWT: PASS
- PostgreSQL remains a startup dependency: PASS
- Docker Compose has Postgres healthcheck: PASS
- Docker Compose app depends on healthy Postgres: PASS
- Simulator depends on healthy app: PASS
- Docker app image builds frontend and serves it through Express: configured

## Runtime limitation

Docker is not installed in the verification environment, and npm registry access timed out during dependency-lock refresh. Therefore a real `docker compose up --build` and live PostgreSQL/JWT HTTP test could not be executed here. The project is configured for those runtime checks and should be validated on a machine with Docker and npm registry access.
