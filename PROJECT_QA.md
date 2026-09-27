# CrowdPulse: Project Q&A and Insights

A prep document for judge questions. Written honestly: what's genuinely
strong, what's genuinely weak, and what we'd say if asked either.

---

## In one paragraph

CrowdPulse is a real-time crowd-density monitoring and alert-dispatch
system for large public gatherings. Unlike a typical "zone is full,
sound the alarm" dashboard, its core contribution is predicting a crush
forming at the joint between two adjacent zones before either zone
individually crosses its own threshold, and dispatching a responder
preemptively. It corroborates sensor alerts with attendee self-reports
to reduce both false positives and blind spots. The prototype is a real,
running full stack (Node.js/Express backend, Socket.io live updates, a
Leaflet ops dashboard), tested end to end, with two zero-cost real
crowd-counting options (a camera-based computer-vision sensor and a
manual volunteer tally) plus a simulator kept around for quick testing,
and both manual and real-device-GPS options for attendee location.

---

## Advantages: what we'd lead with

**1. Flow-bottleneck prediction (the core differentiator).**
Most crowd-safety tools we looked at monitor per-zone thresholds only.
That misses the actual mechanism behind most real crowd crushes: a
surge draining out of one area faster than the next one can absorb it,
at the seam between two zones. We detect that pattern (a fast outflow
from zone A lining up with a fast inflow into adjacent zone B) and
project it forward, flagging it before either zone alone looks
dangerous.

**2. Preemptive dispatch, not just preemptive alerting.**
When a bottleneck is predicted, we don't just log a warning. We
immediately find the nearest available responder and route them to the
zone that's about to fill up, before it's even crossed its own
threshold. The alert and the response happen in the same step.

**3. Human corroboration reduces both false alarms and blind spots.**
A single "I feel unsafe" tap could be anything. Three distinct
attendees tapping it in the same zone within a few minutes is a real
signal, and one that can catch problems density sensors can't (a
scuffle, a blocked exit, a fight) independent of what the headcount
says. We deliberately require distinct devices, not just three taps,
so one person can't manufacture an escalation alone.

**4. It's an actual running system, not slides.**
Real Express backend, real Socket.io connections, real REST API, real
haversine-distance dispatch calculations, real point-in-polygon zone
matching, real WebSocket disconnect/reconnect for the offline-resilience
demo. We tested every piece end to end with curl before treating it as
"done." Nothing in the demo is a mockup pretending to be functional.

**5. Real, zero-cost sensing, not just a labeled simulation.**
`backend/camera-sensor.py` does genuine computer-vision people counting
from any camera using YOLOv8n, a small pretrained deep-learning model
that auto-downloads its ~6MB weights once and needs no paid vision API.
`frontend-react/public/manual-counter.html` is
a real volunteer-operated headcount tally. Both post to the same
`/api/sensor-ping` endpoint the simulator uses, so the rest of the
system doesn't know or care where a reading came from. We kept the
simulator too, purely for fast local testing without a camera or a
volunteer on hand.

**6. Attendee location has a real option, not just a manual stand-in.**
A "Use my real device location" button calls the browser's actual
`navigator.geolocation` API: a genuine permission prompt, real
coordinates. Manual entry and map-click remain as fallbacks. Since the
demo venue's zones sit at fixed placeholder coordinates, your real
location will usually land "outside all mapped zones" unless you're
physically there, which is correct behavior and worth explaining if a
judge tries it and gets that response.

**7. A real external notification channel, not just a simulated one.**
Critical and corroborated alerts fire a genuine webhook (Slack or
Discord incoming-webhook format, auto-detected) if configured. It costs
nothing to demo this working end to end, unlike SMS, which needs a paid
telecom API and stays simulated for that specific reason.

**8. A real component-based frontend, not a single script file.**
The dashboard is a React + Vite app (components, a real build step, npm
dependencies instead of CDN script tags), which is what most judges
expect under the hood for something presented as a real product. It
uses a free satellite basemap (Esri World Imagery) for the venue view,
deliberately chosen over Google Earth Engine: Earth Engine is a
planetary-scale satellite time-series analysis platform requiring a
Google Cloud project and OAuth, not a live map-tile provider for an
interactive dashboard, so it would have been the wrong tool here.

---

## Limitations: what we'd volunteer before being asked

We think naming these first, with a concrete next step for each, reads
better than waiting for a judge to find them.

| # | Limitation | Why it exists | What we'd do about it |
|---|---|---|---|
| 1 | Nearest-responder dispatch uses straight-line (haversine) distance | No real venue pathway data available for a hackathon build | Build an indoor routing graph for the venue and use Dijkstra/A* for actual walking distance |
| 2 | Single Node process, in-memory state | Fastest path to a working demo; no time to stand up Redis/Postgres for a hackathon | Move to the microservices + Redis pub/sub architecture from our original pitch deck: ingestion and alerting scaled independently |
| 3 | Alert thresholds (70%/90% density, 8% flow-signal, panic corroboration count) are hardcoded placeholders | We have no real historical crowd-density data to calibrate against | Centralized them in one config file (done) so they're visibly tunable; would calibrate per venue from real event data before any real deployment |
| 4 | SMS/USSD fallback is simulated | Real SMS gateways (Twilio etc.) need a paid account we don't have for a hackathon | A real webhook (Slack/Discord) notification is already wired up as a genuine, free alternative channel; swapping the simulated SMS entry for a real telecom API is a later integration task, not a redesign |
| 5 | The camera-based sensor's accuracy depends on model size, angle, and lighting | YOLOv8n (the smallest, fastest model in its family) was chosen for zero-GPU, small-download setup; it's noticeably better than classic detectors but still smaller/faster over more-accurate | Confirmed against real photos with known people counts (not just synthetic tests) before relying on it; `--model yolov8s.pt` is a documented upgrade path if bandwidth and CPU headroom allow |
| 6 | No real user accounts or JWT auth | Out of scope for a demo where every "attendee" is the same person testing it | Admin/demo-trigger endpoints are gated by a shared key as an interim measure (done); real deployment needs JWT with organizer/volunteer/sensor-device scopes |
| 7 | Rate limiting is per-IP, which is weak on a single demo machine | All requests during a live demo come from one machine, so IP-based limiting can't meaningfully distinguish "attendees" in the demo itself | Now combines IP with a per-tab client ID (done), so distinct browser tabs are limited separately even on one machine; production would add real per-session limits as a second layer |
| 8 | No real data-privacy compliance (consent flow, retention policy, legal basis for holding location data) | This is a hackathon prototype, not a fielded product | Documented explicitly in the app's own Privacy Policy page rather than left unaddressed; a real deployment needs a named data controller and DPDP Act (or equivalent) compliance review before touching real attendee data |

---

## Anticipated questions, direct answers

**"Is this actually AI/ML, or just if-statements?"**
Mostly rule-based and statistical, not trained ML. The predictive layer
uses linear trend extrapolation over recent readings (a real, if simple,
forecasting technique), not a neural network. We say this plainly
because overclaiming "AI" here would be the kind of thing that falls
apart the moment someone asks "which model?"

**"How is this different from every other crowd-monitoring hackathon
project?"**
Most stop at "zone X is at Y% capacity, alert." We predict the failure
mode that actually causes most real crushes (flow between zones, not
just density within one), dispatch before the threshold is crossed, and
corroborate sensor data with human reports. That's three concrete,
demoable things most single-zone-threshold projects don't have.

**"What happens if two zones both surge into a third at once?"**
Right now the bottleneck detector checks one neighbor pair at a time
and fires on the first match; it doesn't yet aggregate simultaneous
inflow from multiple neighbors into one combined projection. That's a
real edge case we haven't handled and would flag if asked directly
rather than claim it's covered.

**"Did you use Google Earth Engine for the satellite map?"**
No, and deliberately not: Earth Engine is built for planetary-scale
satellite time-series analysis, not serving live map tiles to an
interactive dashboard, and it needs a Google Cloud project with OAuth
to even start. We use Esri's free World Imagery tiles instead, which
gives the same "real venue from above" view with zero setup and zero
cost. Using the right tool for the job mattered more here than using
the more famous one.

**"Is your camera people-counter actually accurate?"**
We tested it on real photos with a known number of people in them (not
just synthetic test frames) before trusting it: it correctly counted 2
and 3 people respectively on two standard test images. It uses
YOLOv8n, a small pretrained deep-learning detector, not a hand-rolled
heuristic. It's the smallest model in its family, chosen for zero-GPU,
small-download setup, so it's not the most accurate detector that
exists; a bigger model would do better on dense or awkward-angle
crowds, and that's a named upgrade path, not something we're pretending
isn't needed.

**"Why should we believe your 8%/90% thresholds mean anything?"**
We shouldn't be believed on that basis, and we say so. They're
demo-calibrated constants, not validated against real crowd behavior.
The honest pitch is "here's a working detection mechanism with tunable
knobs," not "here are the correct numbers for a real stadium."

**"What would you build next if you had another week?"**
In order: (1) a real indoor pathway graph for proper dispatch routing,
(2) aggregating multi-neighbor bottleneck signals into one projection
per zone instead of first-match, (3) a lightweight mobile companion app
so attendee location isn't manually typed, (4) persisting to a real
database (Postgres) instead of a JSON log file so state survives a
restart.

**"Could this actually save lives at a real event?"**
Only after the limitations above are addressed, especially real
pathway-aware dispatch and validated thresholds. As a concept and a
working proof of the detection approach, yes, we think the flow-
bottleneck idea specifically targets a real, documented failure mode in
crowd crushes. As a deployable safety system today, no, and we wouldn't
want anyone to think otherwise.

---

## What we learned building this

- Reactive, single-zone alerting is the obvious first idea and also the
  least differentiated one. The flow-bottleneck angle came from asking
  "how do real crowd crushes actually start" rather than "how do we
  detect a zone being full."
- Simulating something honestly (a separate process making real network
  calls, clearly labeled) is more credible under questioning than
  building a fake-looking real thing or hiding a simulation inside real-
  looking code.
- Cheap fixes that remove an attack surface (per-client dedup on panic
  reports, a shared admin key on demo-trigger routes, basic rate
  limiting) cost very little time and close off the most obvious "what
  if someone abuses this" questions.
- Naming limitations in our own documentation, before a judge asks,
  changed the framing from "did they miss this" to "they know exactly
  where the edges of this prototype are."
