// Simulated IoT crowd-density feed.
//
// This is honestly a simulator, not real sensor hardware, but it's a real,
// separate Node process making real HTTP calls to the backend over the
// network, the same way actual sensor gateways or a mobile-crowd-counting
// pipeline would. Swap this file for a real ingestion adapter later without
// touching the backend's alerting/dispatch logic at all.
//
// Movement model: each zone is pulled toward a resting "baseline"
// occupancy every tick (mean reversion), plus small random noise, plus an
// occasional surge. The earlier version had a surge with no pull-back
// force, so zones climbed to their cap almost immediately and stayed
// pinned there. This version always pulls a zone back toward baseline,
// so a surge produces a realistic rise-then-fall instead of a one-way
// climb, and "resolved" events actually get a chance to fire.

const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';
const { ZONES, ADJACENCY, CAMERA_ZONE_ID } = require('./config');

// The camera-test zone only ever gets real data from camera-sensor.py.
// Simulated data must never touch it, otherwise there's no way to show
// "this zone is simulated, this one is the real camera" side by side in
// a demo.
const SIMULATED_ZONES = ZONES.filter(z => z.id !== CAMERA_ZONE_ID);
const SENSOR_USERNAME = process.env.SENSOR_USERNAME || 'sensor';
const SENSOR_PASSWORD = process.env.SENSOR_PASSWORD || 'crowdpulse-sensor';
let token = null;

async function authenticate() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:SENSOR_USERNAME,password:SENSOR_PASSWORD}),
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data.token) throw new Error(data.error || `authentication failed (${res.status})`);
  token = data.token;
}


/* ---------------- Tunable simulation parameters ---------------- */
const TICK_MS = 2000;             // how often each zone reports a new reading
const BASELINE_FRAC = 0.35;       // resting occupancy, as a fraction of capacity
const REVERSION_RATE = 0.12;      // fraction of the gap to baseline closed per tick
const NOISE_FRAC = 0.02;          // random noise per tick, as a fraction of capacity
const SURGE_CHANCE = 0.035;       // probability a given zone surges on a given tick
const SURGE_MIN_FRAC = 0.12;      // minimum surge size, as a fraction of capacity
const SURGE_MAX_FRAC = 0.22;      // maximum surge size, as a fraction of capacity
const MAX_OCCUPANCY_FRAC = 1.05;  // hard ceiling, as a fraction of capacity
const FLOW_SURGE_CHANCE = 0.03;   // probability of a coordinated inter-zone surge per tick
const FLOW_SURGE_FRAC = 0.14;     // size of a flow surge, as a fraction of the receiving zone's capacity

const zoneCounts = {};
SIMULATED_ZONES.forEach(z => { zoneCounts[z.id] = Math.round(z.cap * BASELINE_FRAC); });

// Zones with at least one neighbor to surge into. Filtering on
// neighbors.length here (rather than just excluding the camera zone by
// name) also protects against a future zone added with an empty
// adjacency list crashing this the same way: an empty neighbor array
// means neighbors[random * 0] is undefined, and everything downstream
// of that throws.
const FLOW_SOURCE_IDS = Object.keys(ADJACENCY).filter(id => (ADJACENCY[id] || []).length > 0);

// Occasionally simulate a coordinated flow surge between two adjacent
// zones (people draining out of one into the next) rather than every
// zone moving independently. This is what feeds the flow-bottleneck
// detector on the backend. Both zones still get pulled back toward their
// own baselines on subsequent ticks, same as any other surge.
function maybeTriggerFlowSurge() {
  if (FLOW_SOURCE_IDS.length === 0) return;
  if (Math.random() < FLOW_SURGE_CHANCE) {
    const fromId = FLOW_SOURCE_IDS[Math.floor(Math.random() * FLOW_SOURCE_IDS.length)];
    const neighbors = ADJACENCY[fromId];
    const toId = neighbors[Math.floor(Math.random() * neighbors.length)];
    const fromZone = ZONES.find(z => z.id === fromId);
    const toZone = ZONES.find(z => z.id === toId);
    const amount = Math.round(toZone.cap * FLOW_SURGE_FRAC);
    zoneCounts[fromId] = Math.max(0, zoneCounts[fromId] - amount);
    zoneCounts[toId] = Math.min(toZone.cap * MAX_OCCUPANCY_FRAC, zoneCounts[toId] + amount);
    console.log(`[simulated-iot-flow] surge: ${fromZone.name} -> ${toZone.name}`);
  }
}

function nextCount(zone) {
  const current = zoneCounts[zone.id];
  const baseline = zone.cap * BASELINE_FRAC;

  // Pull toward baseline. This is the piece that was missing before: it
  // guarantees a zone comes back down after a surge instead of only ever
  // being pushed up.
  const reversion = (baseline - current) * REVERSION_RATE;

  // Small symmetric random noise so it doesn't look like a perfect curve.
  const noise = (Math.random() - 0.5) * zone.cap * NOISE_FRAC * 2;

  let delta = reversion + noise;

  // Occasional surge on top of the above, same as before, just less
  // frequent and with an upper bound that leaves room for reversion to
  // actually pull it back down rather than sitting at the ceiling.
  if (Math.random() < SURGE_CHANCE) {
    delta += zone.cap * (SURGE_MIN_FRAC + Math.random() * (SURGE_MAX_FRAC - SURGE_MIN_FRAC));
  }

  const next = Math.max(0, Math.min(zone.cap * MAX_OCCUPANCY_FRAC, current + delta));
  return Math.round(next);
}

async function pingZone(zone) {
  zoneCounts[zone.id] = nextCount(zone);
  const count = zoneCounts[zone.id];

  try {
    if (!token) await authenticate();
    const res = await fetch(`${BACKEND}/api/sensor-ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ zoneId: zone.id, count, source: 'simulated-iot' }),
    });
    if (res.status === 401) { token = null; await authenticate(); return pingZone(zone); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`[simulated-iot] ${zone.name.padEnd(20)} ${count}/${zone.cap}`);
  } catch (err) {
    console.error(`[simulated-iot] failed to reach backend (${BACKEND}): ${err.message}`);
  }
}

console.log(`Simulated IoT feed starting. Authenticating as ${SENSOR_USERNAME}; posting to ${BACKEND} every ${TICK_MS / 1000}s per zone.`);
setInterval(() => {
  maybeTriggerFlowSurge();
  SIMULATED_ZONES.forEach(pingZone);
}, TICK_MS);