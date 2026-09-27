# CrowdPulse: Working Prototype

This is a real, running full-stack prototype: Node.js/Express backend,
Socket.io for live updates, a Leaflet-based ops dashboard, a simulated
IoT feed, and a rule/trend-based alerting + dispatch engine. Tested end
to end before handing this to you: see "What's actually real" below
for exactly what is live logic vs. simulated input.

## Run it (2 terminals)

The frontend is now a React + Vite app, but it ships **already built**:
`backend/public/` is the built output, and the backend serves it
directly, so you don't need Node's React toolchain installed just to
run the demo. You only need `frontend-react/` if you want to change the
UI, see "Modifying the frontend" below.

**Terminal 1: backend + dashboard**
```
cd backend
npm install
npm start
```
Open **http://localhost:4000** in your browser. That's the ops dashboard.

**Terminal 2: simulated IoT sensor feed**
```
cd backend
npm run simulate
```
This starts posting fake but realistic crowd-density readings to the
backend every 2 seconds, per zone, with occasional surges: so you'll
see zones cross thresholds, alerts fire, and responders get
auto-dispatched live on the dashboard within the first minute or two.
Leave this running during your demo. Prefer real data over this? See
"Real sensing without buying any hardware" below.

### PostgreSQL database

CrowdPulse now persists its operational data in PostgreSQL instead of relying only on process memory. The backend creates these tables automatically on first startup:

- `incidents`: alerts, dispatches, panic corroboration, resolutions and other incident events
- `zone_readings`: sensor/camera/manual crowd readings
- `attendees`: latest attendee location per client ID
- `panic_reports`: individual panic reports used for corroboration

Start PostgreSQL with Docker from the project root:

```
docker compose up -d postgres
```

Then configure the backend (copy `.env.example` to `.env` if needed):

```
DATABASE_URL=postgresql://crowdpulse:crowdpulse@localhost:5432/crowdpulse
```

Run a real database connectivity check:

```
cd backend
npm install
npm run db:check
```

The backend also exposes `/api/health`; it returns `database: "connected"` only when PostgreSQL responds successfully. The server refuses to start when the database cannot be initialized, so you cannot accidentally run a supposedly persistent demo against a missing database.

The demo reset endpoint clears the current `SESSION_ID` from the database as well as the in-memory state.

For production, replace the local Docker credentials with a managed PostgreSQL connection string and enable SSL.


Optional: copy `backend/.env.example` to `backend/.env` to change the
port, the demo admin key, or add a real Slack/Discord webhook URL for
live critical-alert notifications (see `.env.example` for details).
The app works fine with no `.env` file at all.

## Modifying the frontend

The dashboard's source is `frontend-react/` (React + Vite). After
changing anything in there:
```
cd frontend-react
npm install
npm run build
```
This rebuilds straight into `backend/public/`, so a normal backend
restart (or just a page refresh, if the backend is already running)
picks up the change. For active development with hot reload instead of
rebuilding every time:
```
cd frontend-react
npm run dev
```
This starts a separate dev server (typically `http://localhost:5173`)
that proxies `/api` and `/socket.io` to the backend on port 4000 (see
`vite.config.js`), so run the backend in another terminal as usual.

**Why React + Vite instead of the plain HTML/JS version this started
as:** component structure, a real build step, and a proper dependency
system (npm packages instead of CDN `<script>` tags) scale better as
the UI grows, and match what most teams' judges will expect to see
under the hood for a "real" product rather than a single script file.

**Why a satellite basemap instead of Google Earth Engine:** Earth
Engine is built for planetary-scale satellite time-series analysis
(deforestation tracking, climate monitoring, that kind of thing), and
needs a Google Cloud project with OAuth or a service account. It isn't
a live map-tile provider for an interactive dashboard, and wiring it up
here would be using the wrong tool for the job. The map now uses Esri's
free World Imagery satellite tiles instead: no API key, no cloud
account, same "look down at the real venue from above" effect that
was actually wanted, in about five lines of config (see
`frontend-react/src/components/MapView.tsx`).

## Real sensing without buying any hardware

If you're demoing this somewhere the judges expect real data, not a
simulator, here are two zero-cost ways to feed the exact same
`/api/sensor-ping` endpoint with genuine readings. Use either, or both
across different zones. The simulator (`npm run simulate`) is meant to
be replaced by these, not run alongside them for the zones you're
actually demoing live.

### Option A: manual volunteer tally (most reliable, zero technical risk)
Open `http://<the-backend-machine's-IP>:4000/manual-counter.html` on
any phone's browser, on the same WiFi as the machine running the
backend. Pick a zone, then tap +1 when someone enters and -1 when
someone leaves. Every tap sends a real reading to the backend
immediately. No app install, no camera, nothing that can glitch mid-
demo. This is the safest option if you have volunteers but no spare
cameras.

### Option B: an old phone as a free camera sensor (real computer vision)
`backend/camera-sensor.py` turns any camera into a real person-counting
sensor using YOLOv8n, a small pretrained object-detection model (free,
open, auto-downloads its ~6MB weights the first time you run it, no
paid vision API):
```
pip install -r backend/requirements.txt
python backend/camera-sensor.py --zone A --source 0
```

**Turning a phone into a camera, for free:**
- **USB** (recommended, avoids depending on venue WiFi): install a free
  app like DroidCam on the phone and its matching desktop client on
  your laptop. It exposes the phone's camera as a normal webcam device.
- **WiFi**: an app like "IP Webcam" (Android) serves a stream URL such
  as `http://192.168.1.42:8080/video` on the same network, which
  `--source` can point at directly.

If you'll be offline at the venue, run the script once anywhere with
internet first so `yolov8n.pt` is already cached locally; it won't
re-download on later runs.

**Calibrating a real, physically provable test:**
1. Mark out a small real area, e.g. 10 square meters, and set that
   zone's `cap` in `backend/config.js` to whatever count should count
   as "full" for the test, e.g. 4.
2. Run the script pointed at that area with `--show`, so you can see
   the live detection boxes and confirm the count is right before
   trusting it unattended.
3. Walk a 5th person into frame and watch the dashboard cross into
   "critical" and fire a real alert, live.

Honest limitations, from the script's own docstring: YOLOv8n is the
smallest, fastest model in its family, chosen because it needs no GPU
and a small download. A bigger model (`--model yolov8s.pt`) would be
more accurate on dense or awkward-angle crowds, at the cost of a larger
download and slower frames per second.

Both options post with a `source` field (`manual-tally` or `camera-cv`)
so the dashboard and incident log can show, honestly, where each
reading actually came from, instead of everything being force-labeled
"simulated" regardless of its real origin (that was a bug in the
backend, now fixed: `/api/sensor-ping` respects whatever `source` the
caller sends).

## What's actually real vs. simulated (say this to judges: it's a
strength, not a weakness)

| Piece | Status |
|---|---|
| Backend (Express + Socket.io) | **Real.** Actual server, actual WebSocket connections. |
| REST API (`/api/zones`, `/api/sensor-ping`, `/api/attendee-location`, etc.) | **Real.** |
| Alert engine (threshold + trend-based predictive alerting) | **Real logic**, rule/statistics-based: not a trained ML model. It's a legitimate lightweight forecasting heuristic (linear extrapolation over recent readings), described honestly as that in the code comments. |
| **Flow-bottleneck prediction (core USP)** | **Real logic.** Detects a fast outflow from one zone lining up with a fast inflow into an adjacent zone, and projects forward: this is how real crowd crushes usually form (at the joint between two zones), which per-zone threshold monitoring alone misses. See "The USP" below. |
| **Panic-report corroboration** | **Real logic.** Attendee "unsafe" taps in the same zone within a rolling window escalate an alert independent of sensor readings: catches things density sensors can't (a scuffle, a blocked exit) and reduces false-alarm risk versus acting on a single report. |
| **Post-event analytics** | **Real**, computed live from this session's actual incident log: total alerts, dispatch count, avg time-to-stabilize, peak zone. Not placeholder numbers. |
| Nearest-responder dispatch (including preemptive dispatch on a predicted bottleneck) | **Real** haversine great-circle distance calculation against actual responder coordinates. |
| SMS/USSD fallback channel | **Simulated and clearly labeled as such** in the UI ("SMS fallback (simulated)"). No real Twilio/SMS gateway wired up: that needs a paid account. A real webhook (Slack/Discord) notification does fire for real on critical/corroborated alerts if `WEBHOOK_URL` is set in `.env`: that's a genuine free channel, unlike SMS. |
| IoT sensors | **Real options now available, simulator still included for quick testing.** `backend/camera-sensor.py` does real, free computer-vision people counting from any camera. `/manual-counter.html` (served by the backend, source in `frontend-react/public/`) is a real volunteer-operated tally. `simulator.js` remains for convenience when you just want to see the dashboard move without setting up either. See "Real sensing without buying any hardware" above. |
| Attendee GPS | **Manual by default, with a real option.** A "Use my real device location" button calls the browser's actual `navigator.geolocation` API: a genuine permission prompt and real coordinates, not simulated. Manual lat/lng entry and map-click remain available too. |
| Data persistence | Incidents are logged to `backend/data/incidents.log.jsonl` on disk. In-memory for live state. Good enough for a demo; swap for Postgres/Redis for production, as noted in the original pitch deck. |
| Network-loss resilience demo | **Real.** The "Simulate network loss" button actually disconnects the Socket.io connection; reconnecting actually flushes queued events to `/api/sync`. |

## The USP, in one line for judges

*"Most crowd-safety tools tell you a zone is full. We predict the crush
that forms **between** two zones, before either one crosses its own
threshold. And we back that up with human reports, not just sensor
counts."*

Concretely, three things most teams won't have:
1. **Flow-bottleneck prediction**: watches for a surge draining out of
   one zone into an adjacent one and projects forward, catching the
   actual mechanism behind most real stampedes (a joint between two
   areas overloading) rather than only flagging a single zone after the
   fact.
2. **Preemptive dispatch**: a responder gets routed to the *receiving*
   zone as soon as a bottleneck is predicted, before it's even crossed
   its own threshold.
3. **Human corroboration**: repeated "I feel unsafe" taps in the same
   zone escalate an alert on their own, independent of what the sensors
   say, and reduce the odds of a single false report causing a scare.

## Limitations, honestly, and what's already been done about them

A few things judges are likely to ask about, and where things stand:

| Concern | Status |
|---|---|
| **No real auth on the API** | Partially addressed. Public endpoints (`/api/zones`, `/api/attendee-location`, `/api/panic-report`, `/api/analytics`) are open, as they would be for any logged-in-or-not attendee. The demo-trigger endpoints (`/api/simulate-*`, `/api/sync`) now require an `x-admin-key` header (see `ADMIN_KEY` in `backend/config.js`) so a stranger on the network can't blind-POST to your demo mid-show. This is a shared key, not real auth. Production would use JWT with organizer/volunteer/sensor-device scopes. |
| **Alert thresholds look arbitrary** | Addressed for transparency, not accuracy. All the tunable numbers (density thresholds, flow-signal thresholds, panic corroboration window/count) are now centralized in `backend/config.js` under `THRESHOLDS`, with comments explaining they're placeholder values tuned to demo cleanly against the simulator, not validated against real crowd data. If asked "where did 90% come from," the honest answer is "it's a config value we'd calibrate per venue from real historical data, here's exactly where it lives in the code." |
| **A single device could spam the panic button and fake a corroborated alert** | Fixed. Corroboration now counts distinct client IDs within the time window, not raw taps (see `recordPanicReport` in `backend/server.js`). One browser tab tapping the button repeatedly no longer escalates anything on its own; it takes 3 different clients. This uses a per-tab ID (`sessionStorage`), not a real login, so it's still spoofable by opening multiple tabs, but it's no longer a one-tap exploit. |
| **No rate limiting on public write endpoints** | Fixed, with a caveat. `/api/attendee-location` and `/api/panic-report` are now rate-limited per IP (20 and 10 requests per 10 seconds respectively) using a simple in-memory sliding window, no new dependency. Caveat: on a single demo machine, every request looks like it comes from the same IP (`localhost`), so you won't see this distinguish between "attendees" in the demo itself. The logic is real and would work correctly across distinct client IPs in an actual deployment. |
| **Feed timestamps didn't match the visible clock** | Fixed. The clock and the incident feed both now render in the browser's local time; only the raw API payloads stay in ISO/UTC internally. |
| **Dashboard fails silently if the backend isn't running** | Fixed. If the initial API calls or the Socket.io connection can't reach the backend, a banner appears telling you to start the server, instead of an unexplained blank dashboard. |
| **Zone names were hover-only, easy to miss on stage** | Fixed. Zone names and live counts are now permanent labels directly on the map, not just tooltips. |
| **Critical zones looked identical to a static screenshot** | Fixed. A critical zone now pulses subtly on the map so it reads as "live and urgent" rather than a static red rectangle. |
| **No way to hand judges a take-away summary** | Fixed. The Analytics tab has an "Export as CSV" button that downloads the actual incident log from this session. |
| **Nearest-responder dispatch uses straight-line distance** | Not fixed, flagged as a real gap. Haversine distance ignores walls, barricades, and actual walkable paths. A real deployment needs an indoor routing graph and pathfinding (Dijkstra/A*) over it. Say so directly if asked, don't claim this is solved. |
| **Single Node process, in-memory state, won't scale to a real large event** | Not fixed, flagged as a real gap. This is demo-scale by design. The production architecture (microservices, Redis pub/sub, horizontal scaling of ingestion vs. alerting) is described in the original pitch deck but not implemented here. |
| **SMS/USSD fallback is simulated** | Still simulated, honestly. But critical alerts and corroborated panic alerts now also fire a real webhook notification (Slack or Discord incoming-webhook format, auto-detected) if `WEBHOOK_URL` is set in `.env`. That's a genuine external channel we could wire up for free; a real SMS gateway needs a paid telecom API, which is why that specific piece stays simulated. |
| **Attendee GPS is manual, not real device location** | Partially fixed. There's now a real "Use my real device location" button using the browser's actual `navigator.geolocation` API. Since the demo zones sit at fixed placeholder coordinates, your real device location will almost always land "outside all mapped zones" unless you're physically there. That's correct behavior; the geolocation call itself is genuine. |
| **No health check, and no way to reset state between demo runs without restarting the server** | Fixed. `GET /api/health` reports uptime and whether a webhook is configured. `POST /api/reset-demo` (admin-gated) resets all zones, responders, and incidents to a fresh starting state without restarting the process, useful for running the demo back-to-back for multiple judges. |
| **Zone density history wasn't visible anywhere except the map tooltip** | Fixed. Each zone in the sidebar list now shows a small live sparkline of its last few readings. |
| **No real DPDP Act / privacy compliance** | Documented, not implemented. See `/privacy.html` (served by the backend, source in `frontend-react/public/`), which states plainly what would still be needed for a real deployment. |

The two "not fixed" rows above are intentionally left as real, named limitations rather than glossed over. If a judge asks about them, the honest answer, "we identified this, here's the concrete next step," lands better than pretending it's solved.

## Attendee location / GPS

The **Attendee app** tab on the dashboard gives you three ways to set a
position:
- click "Use my real device location", which calls the browser's actual
  `navigator.geolocation` API (a real permission prompt, real
  coordinates); since the demo venue's zones sit at fixed placeholder
  coordinates, your real location will likely show as "outside all
  mapped zones" unless you're physically standing there, which is
  correct behavior, not a bug
- type in latitude/longitude directly, or
- click anywhere on the venue map to drop a pin there

All three call the same real backend endpoint, which does real
point-in-zone matching and returns the real zone status. A full mobile
app with location permissions was out of scope for this build, but the
underlying location plumbing is genuine, not mocked.

## Demo script (about 2 minutes)

1. Open the dashboard, point out zones are calm (green), simulator running in the background.
2. Open **Demo controls** (top right) → click **"Surge: Main Stage → Food Court"**. Within a second the Ops feed shows a **flow-bottleneck alert** and a **preemptive dispatch**: call out that neither zone crossed its own threshold, this is the predictive layer working. This is your headline moment; lead with it.
3. Click **"Force critical: Main Stage"** → a normal threshold alert fires, auto-dispatch assigns a responder, and a **simulated SMS fallback** entry appears: mention this models reaching marshals even if the app/WiFi is down.
4. Click **"Panic burst (x3): Food Court"** → after the third tap, a **corroborated alert** appears, distinct from a sensor-based one: explain this is attendee reports escalating independently of density data.
5. Switch to the **Attendee app** tab, click a point inside a red zone on the map → show the phone-style card, and point out the **"Report unsafe conditions here"** button as the real version of what the demo just simulated in bulk.
6. Click **"Simulate network loss"** → banner appears, dot goes red. Update the attendee location again → note it says "queued offline." Click "Restore connectivity" → show the queued event syncing.
7. Switch to the **Analytics** tab → show the real, session-computed totals (alerts, dispatches, avg time-to-stabilize, peak zone) as your "impact" close, and hit **Export as CSV** if you want to hand judges something.
8. Between judges, click **Reset demo state** in the Demo controls panel to put every zone back to a calm baseline without restarting the server or the simulator.

All of the above are driven by the **Demo controls** panel in the top
bar: no terminal needed on stage. If you'd rather trigger things from a
terminal instead:
```
curl -X POST http://localhost:4000/api/sensor-ping \
  -H "Content-Type: application/json" \
  -d '{"zoneId":"A","count":2900}'
```

## Project structure
```
backend/
  server.js          Express + Socket.io app, alert/dispatch engine, REST API
  simulator.js       standalone simulated IoT feed (optional, see "Real sensing" above)
  camera-sensor.py   real YOLOv8n camera-based people counter (optional, real data)
  requirements.txt   Python dependencies for camera-sensor.py
  config.js          venue coordinates, zones, responder starting positions, thresholds
  .env.example       documented optional environment variables
  public/            built frontend output (generated by frontend-react, served as-is)
  data/              incident log (created at runtime)
frontend-react/
  src/               React app source (components, styles, API/socket helpers)
  public/            static pages carried through the build unchanged:
                     manual-counter.html, privacy.html, terms.html
  vite.config.js     builds straight into backend/public
```

## Coordinates
The venue center and zone boundaries in `backend/config.js` are made-up
demo coordinates (a generic open ground), picked only so the map
renders at a real, walkable scale. Replace them with your actual
event's coordinates before using this for anything beyond a demo.


## Frontend architecture
The dashboard frontend is now a React 18 + Vite + JavaScript application styled with Tailwind CSS. The source lives in `frontend-react/src`, and `npm run build` outputs the production bundle to `backend/public` so the existing Express backend can serve it from the same origin.

### Frontend development
```bash
cd frontend-react
npm install
npm run dev
```
Vite proxies `/api` and `/socket.io` to the backend at `http://localhost:4000`.

### Production build
```bash
cd frontend-react
npm run build
cd ../backend
npm start
```

## JWT authentication

CrowdPulse now uses JWT for the dashboard and operational API. The old `x-admin-key` gate is retained only as a backwards-compatible demo integration path; the React dashboard does not use it.

Default demo accounts (change these in `.env` before deployment):

- `admin / crowdpulse-admin`: full demo/admin controls
- `operator / crowdpulse-operator`: dashboard/operator controls
- `sensor / crowdpulse-sensor`: sensor ingestion only

The frontend stores the JWT only in `sessionStorage` and sends it as `Authorization: Bearer <token>`. Socket.IO receives the same token during the handshake. The simulator authenticates as the `sensor` account before posting readings.

Set a strong `JWT_SECRET` in production. Do not expose the development credentials or `ADMIN_KEY` outside a local/demo environment.

## Full Docker stack

The root `docker-compose.yml` runs three services:

1. `postgres`: PostgreSQL 16 with a persistent named volume
2. `app`: Node/Express + Socket.IO + built React/Vite dashboard + JWT + PostgreSQL
3. `simulator`: authenticated simulated IoT feed using the `sensor` JWT role

Start everything:

```bash
docker compose up --build
```

Open `http://localhost:4000` and sign in with the demo admin account. The app container waits for the PostgreSQL health check before starting, and the simulator waits for the app health check.

Check:

```bash
curl http://localhost:4000/api/health
```

The health endpoint intentionally remains public so Docker/Kubernetes health checks can verify the service without storing a JWT in the health probe.

## Redis security

Redis is configured for TLS and password authentication in Docker. The Redis port is intentionally not published to the host; only the CrowdPulse containers can reach it on the Docker network. The included certificate is a demo/self-signed CA for local use. Replace the demo Redis password and certificates with deployment-managed secrets/certificates before production.

## Hybrid AI layer

CrowdPulse now includes a local ML service plus optional Gemini reasoning.

- YOLOv8n: camera person detection.
- Local ML: `GradientBoostingClassifier` + `IsolationForest` in `ai-service/` for risk and anomaly scoring.
- Venue-aware retrieval: PostgreSQL `venue_knowledge` table stores zone SOPs and operational constraints.
- Gemini: optional reasoning/explanation layer. Set `GEMINI_API_KEY` in `.env`; raw frames are never sent to Gemini.
- Redis Pub/Sub: distributes `aiAssessment` events to connected dashboards.
- PostgreSQL: persists AI predictions and features for later evaluation/retraining.

Run the complete stack:

```bash
docker compose up --build
```

Without a Gemini key the local AI still runs and the dashboard falls back to the local copilot.
