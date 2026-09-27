// Demo venue: replace these with your actual event's real coordinates.
// Center point is arbitrary (a generic open ground); zones are small
// rectangles offset from it by real degree-scale distances (~80-150m each).

const VENUE_CENTER = { lat: 26.9124, lng: 75.7873 };

// [south, west, north, east] bounding boxes
const ZONES = [
  { id: 'A', name: 'Main Stage',       cap: 3000, bounds: [26.9128, 75.7862, 26.9138, 75.7878] },
  { id: 'B', name: 'Food Court',       cap: 1200, bounds: [26.9128, 75.7880, 26.9134, 75.7896] },
  { id: 'C', name: 'Entry Gate 1',     cap: 1800, bounds: [26.9110, 75.7862, 26.9118, 75.7874] },
  { id: 'D', name: 'Medical Bay',      cap: 400,  bounds: [26.9110, 75.7876, 26.9116, 75.7884] },
  { id: 'E', name: 'East Lawn / Exit', cap: 2200, bounds: [26.9110, 75.7886, 26.9124, 75.7900] },
  { id: 'F', name: 'Parking Overflow', cap: 2500, bounds: [26.9096, 75.7862, 26.9108, 75.7896] },

  // Dedicated real-camera zone.
  // Only camera-sensor.py writes to this zone.
  { id: 'G', name: 'Camera Zone', cap: 1, criticalOnExceedOnly: true, bounds: [26.9138, 75.7870, 26.9142, 75.7876] },
];

// ID of the zone reserved for the real camera sensor.
const CAMERA_ZONE_ID = 'G';

// Responder units with starting GPS positions around the venue.
const RESPONDERS = [
  { id: 'R1', name: 'Volunteer Team #3', lat: 26.9126, lng: 75.7870, status: 'available' },
  { id: 'R2', name: 'Medical Unit 2',     lat: 26.9113, lng: 75.7880, status: 'available' },
  { id: 'R3', name: 'Security Team B',    lat: 26.9132, lng: 75.7888, status: 'available' },
  { id: 'R4', name: 'Marshal Unit 1',     lat: 26.9100, lng: 75.7878, status: 'available' },
  { id: 'R5', name: 'Volunteer Team #7',  lat: 26.9115, lng: 75.7868, status: 'available' },
];

// Which zones are physically adjacent / connected by a walkable path.
const ADJACENCY = {
  A: ['B', 'C'],
  B: ['A', 'E'],
  C: ['A', 'D', 'F'],
  D: ['C', 'E'],
  E: ['B', 'D', 'F'],
  F: ['C', 'E'],

  // Camera zone is isolated from the normal venue flow graph.
  G: [],
};

// Demo-only admin gate for trigger/sync endpoints.
const ADMIN_KEY = process.env.ADMIN_KEY || 'demo-admin-key';

// ---- Tunable thresholds ----

const THRESHOLDS = {
  CAUTION_FRAC: 0.7,
  CRITICAL_FRAC: 0.9,
  PREDICTIVE_MIN_FRAC: 0.55,
  FLOW_FRAC: 0.08,
  BOTTLENECK_PROJECT_FRAC: 0.85,
  PANIC_WINDOW_MS: 3 * 60 * 1000,
  PANIC_THRESHOLD: 3,
};

module.exports = {
  VENUE_CENTER,
  ZONES,
  RESPONDERS,
  ADJACENCY,
  ADMIN_KEY,
  THRESHOLDS,
  CAMERA_ZONE_ID
};