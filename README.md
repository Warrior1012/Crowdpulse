# CrowdPulse

CrowdPulse is a full-stack crowd-monitoring and incident-response prototype. It combines an operations dashboard, backend event processing, crowd readings from simulated or supported sensor inputs, and an AI service for crowd-flow/surge analysis.

The repository includes live application code alongside demo data, pretrained model artifacts, and simulation utilities. Treat the project as a prototype: model predictions and simulated readings are not evidence of validated real-world safety performance.

## Main components

- **Dashboard:** React + Vite frontend; the backend can serve the built dashboard from `backend/public/`.
- **API:** Node.js, Express, Socket.IO, PostgreSQL, and optional Redis Pub/Sub.
- **Simulation:** `backend/simulator.js` posts synthetic crowd readings for local demonstrations.
- **AI service:** Python service under `ai-service/` with scikit-learn/XGBoost-related model artifacts and metadata.
- **Camera pipeline:** backend scripts for camera/sensor integration and YOLO-based person detection.
- **Operations:** incident records, zone readings, panic reports, and dispatch-related workflows.

## Requirements

- Node.js 18+
- Python version compatible with `ai-service/requirements.txt` if running the AI service
- PostgreSQL for persistent storage (the backend documents an in-memory fallback)
- Redis only when using the Redis Pub/Sub deployment path
- Optional camera hardware/stream and model weights for camera-based counting

## Quick start: backend dashboard

```bash
cd backend
npm install
```

Create `backend/.env` from `backend/.env.example`. Configure `DATABASE_URL` for PostgreSQL and set any authentication, Redis, webhook, or AI-service values required by the features you intend to use.

Start the API:

```bash
npm start
```

Open `http://localhost:4000` if using the default port configured by the backend.

## Run the simulator

In a second terminal:

```bash
cd backend
npm run simulate
```

The simulator generates synthetic readings so dashboard alerts can be demonstrated without live sensors. Clearly label simulated data during demos; it must not be represented as actual crowd observations.

## Frontend development

```bash
cd frontend
npm install
npm run dev
```

Use the Vite URL printed in the terminal. The repository also contains a prebuilt dashboard under `backend/public/`; rebuild it when frontend source changes if the backend-served copy is used.

## AI service

Install the dependencies listed in `ai-service/requirements.txt` and follow the model metadata/model-card documents in the repository. Configure the backend to point to the AI service using the environment variables supported by the current implementation. Model files are versioned in this repository; retraining, evaluation, and calibration should be documented before making accuracy or safety claims.

## Useful project documents

- `AI_ARCHITECTURE.md`
- `ML_MODEL_CARD.md`
- `ML_TRAINING_REPORT.md`
- `PRODUCTION_READINESS_AUDIT.md`
- `QA_VERIFICATION.md`
- `REDIS_PUBSUB_QA.md`
- `REDIS_SECURITY_QA.md`

## Security and production notes

- Never commit real environment files, JWT secrets, database credentials, or webhook tokens.
- Use HTTPS, production-grade authentication/authorization, rate limiting, and strict CORS settings.
- Configure PostgreSQL backups and Redis authentication/TLS when applicable.
- Validate and monitor camera/AI outputs; person counts and surge forecasts can be wrong.
- Do not use this prototype as the sole basis for emergency response or crowd-safety decisions without independent testing and operational safeguards.

## License

No license is specified in this repository.