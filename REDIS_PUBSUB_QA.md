# CrowdPulse Redis Pub/Sub QA

## Architecture
- Redis 7 is a first-class Docker service with persistence and a health check.
- The backend uses ioredis with dedicated publisher/subscriber connections.
- Application events are published to `crowdpulse:events` and consumed back into Socket.IO broadcasts.
- Socket.IO also uses `@socket.io/redis-adapter`, allowing Socket.IO rooms/broadcasts to work across multiple backend instances sharing Redis.
- PostgreSQL remains the durable source for incidents, zone readings, attendees and panic reports.

## Event path
`Sensor/REST input -> detection logic -> PostgreSQL persistence -> Redis publish -> subscriber -> Socket.IO clients`

## Health
`GET /api/health` now checks PostgreSQL plus both Redis publisher/subscriber connections.

## Docker
`docker compose up --build` starts Redis and PostgreSQL first, then the application, then the simulator.

## Local verification
The source was checked with Node syntax parsing. A live Redis integration test could not be executed in this environment because Docker/Redis and npm registry access are unavailable here.

## Production note
Set a strong Redis password/TLS configuration, JWT secret and database password before exposing the stack publicly. For horizontally scaled deployments, keep all backend instances on the same Redis instance/cluster and use a load balancer configuration compatible with Socket.IO.
