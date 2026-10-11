# CrowdPulse

CrowdPulse is a full-stack crowd-monitoring and incident-response prototype. It combines an operations dashboard, a Node.js API, PostgreSQL persistence, crowd-reading simulations, camera/sensor integration, and an optional Python AI service.

Treat this as a prototype: simulated readings and model predictions are not validated real-world safety performance and must not be the sole basis for emergency decisions.

## Main components

- **Dashboard:** React + Vite; the current built dashboard is served from `backend/public/`.
- **API:** Node.js, Express, Socket.IO, and PostgreSQL.
- **Simulation:** `backend/simulator.js` generates synthetic crowd readings for demonstrations.
- **AI service:** Python/FastAPI service under `ai-service/` with scikit-learn/XGBoost model artifacts.
- **Camera pipeline:** backend scripts for camera/sensor integration and YOLO-based person detection.
- **Operations:** incidents, zone readings, panic reports, attendee reports, and responder workflows.

## Requirements

- Node.js 18 or newer
- PostgreSQL
- Python version compatible with `ai-service/requirements.txt` if deploying the AI service
- Optional camera hardware/stream and model weights for camera-based counting

Docker and Redis are not required. The backend broadcasts Socket.IO events directly from a single Node.js process. If you later run multiple backend instances, you will need to deliberately add a cross-instance event adapter or another shared event bus.

## Run the backend locally

```bash
cd backend
npm install
```

Create `backend/.env` from `backend/.env.example`, then set at least a valid `DATABASE_URL` and a strong `JWT_SECRET`. Replace the example usernames/passwords and admin key before exposing the app publicly.

Start the API:

```bash
npm start
```

The default port is `4000`. Open `http://localhost:4000`.

## Run the simulator

In a second terminal:

```bash
cd backend
npm run simulate
```

The simulator posts synthetic readings for demonstrations. Clearly label simulated data and never present it as actual crowd observations.

## Frontend development

```bash
cd frontend
npm install
npm run dev
```

Use the Vite URL printed in the terminal. The repository contains a prebuilt dashboard under `backend/public/`; rebuild and copy the frontend build there if you want the backend to serve updated frontend source.

## Deploy the Node.js app on Render

Use a **Web Service** with these settings:

- **Root Directory:** `backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Health check path:** `/api/health`

Configure environment variables in Render, not in committed files. Set `DATABASE_URL` to your PostgreSQL connection string and provide strong values for `JWT_SECRET`, `ADMIN_PASSWORD`, `OPERATOR_PASSWORD`, `SENSOR_PASSWORD`, `ATTENDEE_PASSWORD`, and `ADMIN_KEY`. Set `GEMINI_API_KEY` only if you want the optional Gemini-powered feature.

The backend calls PostgreSQL during startup, so the database must be reachable. The app serves the currently committed `backend/public/` bundle; frontend source changes do not automatically update that bundle unless you rebuild and copy it.

## Deploy the optional AI service

The Python service is separate from the Node.js backend. To deploy it on Render, create another Web Service with:

- **Root Directory:** `ai-service`
- **Runtime:** Python
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn app:app --host 0.0.0.0 --port $PORT`

Set `AI_SERVICE_URL` on the Node.js service to the deployed AI service's base URL. If you do not deploy the AI service, the backend's local AI logic remains available, but requests requiring the separate flow-forecast service will not reach a remote model.

## Security and production notes

- Never commit real `.env` files, API keys, JWT secrets, database credentials, or webhook tokens.
- Use HTTPS, production-grade authentication/authorization, rate limiting, and strict CORS settings.
- Configure PostgreSQL backups and review retention for attendee reports, incident logs, and uploaded media.
- Validate and monitor camera/AI outputs; person counts and surge forecasts can be wrong.
- The app's demo fallback credentials must be replaced before public deployment.
- This prototype must not be used as the sole basis for emergency response or crowd-safety decisions without independent testing and operational safeguards.

## License

No license is specified in this repository.
