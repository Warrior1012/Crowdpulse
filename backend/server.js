require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { VENUE_CENTER, ZONES, RESPONDERS, ADJACENCY, ADMIN_KEY, THRESHOLDS } = require('./config');
const db = require('./db');
const { assessZone } = require('./ai-engine');
const { nearestCampForLocation, buildCameraInjurySummary, summarizeDetectionMetrics } = require('./cctv-pipeline');
const SESSION_ID = process.env.SESSION_ID || 'demo-session';
const CAMP_LOCATIONS = [
  { id: 'camp-north', name: 'North Aid Camp', lat: 26.9136, lng: 75.7861 },
  { id: 'camp-south', name: 'South Aid Camp', lat: 26.9108, lng: 75.7890 },
  { id: 'camp-east', name: 'East Relief Point', lat: 26.9116, lng: 75.7898 },
];
const SERVER_INSTANCE_ID = crypto.randomUUID();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-jwt-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
// Redis is OPTIONAL. It only matters if you run more than one backend
// instance and need Socket.IO events to fan out across them. A single
// instance (the normal case for a demo) works fully without it: every
// event is emitted to this instance's own connected clients directly,
// and Redis publishing underneath that is best-effort, never required.
// Set DISABLE_REDIS=true to skip even attempting a connection.
const REDIS_DISABLED = String(process.env.DISABLE_REDIS || '').toLowerCase() === 'true';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
const REDIS_TLS = String(process.env.REDIS_TLS || 'false').toLowerCase() === 'true';
const REDIS_TLS_CA = process.env.REDIS_TLS_CA || '';
const REDIS_TLS_REJECT_UNAUTHORIZED = String(process.env.REDIS_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';
const REDIS_CHANNEL = process.env.REDIS_CHANNEL || 'crowdpulse:events';
let redisEnabled = false; // flips true only after a real successful connection
const AUTH_USERS = [
  { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'crowdpulse-admin', role: 'admin' },
  { username: process.env.OPERATOR_USERNAME || 'operator', password: process.env.OPERATOR_PASSWORD || 'crowdpulse-operator', role: 'operator' },
  { username: process.env.SENSOR_USERNAME || 'sensor', password: process.env.SENSOR_PASSWORD || 'crowdpulse-sensor', role: 'sensor' },
  { username: process.env.ATTENDEE_USERNAME || 'attendee', password: process.env.ATTENDEE_PASSWORD || 'crowdpulse-attendee', role: 'attendee' },
];

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const redisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: () => null, // don't keep retrying forever if Redis is genuinely absent
  ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
  ...(REDIS_TLS ? {
    tls: {
      ca: REDIS_TLS_CA ? fs.readFileSync(REDIS_TLS_CA) : undefined,
      rejectUnauthorized: REDIS_TLS_REJECT_UNAUTHORIZED,
      servername: process.env.REDIS_TLS_SERVERNAME || 'redis',
    },
  } : {}),
};
const redisPub = REDIS_DISABLED ? null : new Redis(REDIS_URL, redisOptions);
const redisSub = REDIS_DISABLED ? null : new Redis(REDIS_URL, redisOptions);
const redisAdapterPub = REDIS_DISABLED ? null : new Redis(REDIS_URL, redisOptions);
const redisAdapterSub = REDIS_DISABLED ? null : new Redis(REDIS_URL, redisOptions);
if (!REDIS_DISABLED) {
  redisPub.on('error', err => { if (redisEnabled) console.error('Redis publisher error:', err.message); });
  redisSub.on('error', err => { if (redisEnabled) console.error('Redis subscriber error:', err.message); });
  redisAdapterPub.on('error', err => { if (redisEnabled) console.error('Redis Socket.IO publisher error:', err.message); });
  redisAdapterSub.on('error', err => { if (redisEnabled) console.error('Redis Socket.IO subscriber error:', err.message); });
}
const io = new Server(server, { cors: { origin: '*' } });

// Every event is always delivered to this instance's own clients
// immediately and directly. Redis (if connected) is used ONLY as a
// best-effort side channel so other instances, if any, also see it.
// This is what actually fixes single-instance mode: previously every
// event's *only* delivery path was publish-to-redis then wait for our
// own subscription to hear it back, so a Redis outage silently killed
// the entire live dashboard even with zero scaling in play.
async function publishEvent(event, payload) {
  io.emit(event, payload);
  if (!redisEnabled) return;
  try {
    await redisPub.publish(REDIS_CHANNEL, JSON.stringify({ event, payload, ts: timeNow(), sessionId: SESSION_ID, origin: SERVER_INSTANCE_ID }));
  } catch (err) {
    console.error('Redis publish failed (event was still delivered locally):', err.message);
  }
}

// Attempts a real Redis connection with a bounded timeout. Resolves to
// true/false rather than throwing, so a missing/misconfigured Redis
// never takes down server startup: this fixes the previous behavior
// where a Redis connection failure was caught by the same try/catch as
// the database and reported, incorrectly, as "Database startup failed."
async function tryEnableRedis() {
  if (REDIS_DISABLED) { console.log('Redis disabled via DISABLE_REDIS=true; running single-instance.'); return false; }
  try {
    await Promise.all([redisPub.connect(), redisSub.connect(), redisAdapterPub.connect(), redisAdapterSub.connect()]);
    await redisSub.subscribe(REDIS_CHANNEL);
    redisSub.on('message', (channel, raw) => {
      if (channel !== REDIS_CHANNEL) return;
      try {
        const message = JSON.parse(raw);
        if (message.sessionId && message.sessionId !== SESSION_ID) return;
        if (message.origin === SERVER_INSTANCE_ID) return; // already emitted locally by publishEvent
        io.emit(message.event, message.payload);
      } catch (err) {
        console.error('Invalid Redis event:', err.message);
      }
    });
    io.adapter(createAdapter(redisAdapterPub, redisAdapterSub));
    console.log(`Redis Pub/Sub connected: ${REDIS_CHANNEL} (${REDIS_TLS ? 'TLS' : 'no TLS'}). Multi-instance broadcast enabled.`);
    return true;
  } catch (err) {
    console.warn(`Redis unavailable (${err.message}); continuing in single-instance mode. This is fine for one backend process; it only matters if you run more than one.`);
    return false;
  }
}
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('JWT required'));
  try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
  catch (err) { next(new Error('Invalid or expired JWT')); }
});

const PORT = process.env.PORT || 4000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || null;
const DATA_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'incidents.log.jsonl');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- In-memory state ---------------- */
// Zone live state: count, status, short rolling history for trend detection
const zoneState = {};
ZONES.forEach(z => {
  zoneState[z.id] = {
    count: Math.round(z.cap * 0.35),
    status: 'safe',
    history: [],       // last N counts, for trend/predictive alerting
    lastDelta: 0,       // change since previous reading, for flow detection
    lastSource: null,   // where the last reading came from (simulated, camera-cv, manual-tally, ...)
    lastStatusChange: Date.now(),
  };
});

const responders = RESPONDERS.map(r => ({ ...r }));
let incidents = []; // recent incidents kept in memory (also persisted to disk)
let attendees = {}; // socketId or clientId -> { lat, lng, zoneId }
let activeCasualties = [];
const panicReports = {}; // zoneId -> array of { clientId, ts } (distinct clients matter, not raw taps)

const PANIC_WINDOW_MS = THRESHOLDS.PANIC_WINDOW_MS;
const PANIC_THRESHOLD = THRESHOLDS.PANIC_THRESHOLD;
const FLOW_FRAC = THRESHOLDS.FLOW_FRAC;
const BOTTLENECK_PROJECT_FRAC = THRESHOLDS.BOTTLENECK_PROJECT_FRAC;

// Simple in-memory per-IP rate limiter for public write endpoints. Not
// meant to survive a restart or scale across multiple server instances,
// but it stops a single client from trivially hammering these routes.
const rateLimitBuckets = new Map();
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    // Include clientId (when the caller sends one) so that on a single
    // demo machine, distinct browser tabs are rate-limited separately
    // instead of all sharing one bucket keyed only on localhost's IP.
    const key = ip + ':' + (req.body?.clientId || 'anon');
    const now = Date.now();
    const recent = (rateLimitBuckets.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests, please slow down.' });
    }
    recent.push(now);
    rateLimitBuckets.set(key, recent);
    next();
  };
}
function signToken(user) {
  return jwt.sign({ sub: user.username, username: user.username, role: user.role, sessionId: SESSION_ID }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function authUsersFromEnv() {
  return [
    { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'crowdpulse-admin', role: 'admin' },
    { username: process.env.OPERATOR_USERNAME || 'operator', password: process.env.OPERATOR_PASSWORD || 'crowdpulse-operator', role: 'operator' },
    { username: process.env.SENSOR_USERNAME || 'sensor', password: process.env.SENSOR_PASSWORD || 'crowdpulse-sensor', role: 'sensor' },
    { username: process.env.ATTENDEE_USERNAME || 'attendee', password: process.env.ATTENDEE_PASSWORD || 'crowdpulse-attendee', role: 'attendee' },
  ];
}

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Bearer token required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired JWT' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient role permissions' });
    next();
  };
}

function requireAdminKey(req, res, next) {
  // Backwards-compatible demo gate for existing integrations. JWT is the preferred dashboard auth.
  const key = req.get('x-admin-key');
  if (key === ADMIN_KEY) return next();
  return requireAuth(req, res, () => {
    if (!['admin', 'operator'].includes(req.user.role)) return res.status(403).json({ error: 'Admin/operator role required' });
    next();
  });
}

/* ---------------- Helpers ---------------- */
function zoneCentroid(zone) {
  const [minLat, minLng, maxLat, maxLng] = zone.bounds;
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

function pointInZone(lat, lng, zone) {
  const [minLat, minLng, maxLat, maxLng] = zone.bounds;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

function findZoneForPoint(lat, lng) {
  return ZONES.find(z => pointInZone(lat, lng, z)) || null;
}

// Haversine distance in meters
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestAvailableResponder(targetLat, targetLng) {
  const available = responders.filter(r => r.status === 'available');
  if (available.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const r of available) {
    const d = distanceMeters(targetLat, targetLng, r.lat, r.lng);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  return { responder: best, distanceMeters: Math.round(bestDist) };
}

function logIncident(incident) {
  incidents.unshift(incident);
  if (incidents.length > 200) incidents.pop();
  fs.appendFile(LOG_FILE, JSON.stringify(incident) + '\n', () => {});
  void db.insertIncident(incident, SESSION_ID).catch(err => console.error('DB incident insert failed:', err.message));
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildCasualtyReport(zone, severityInput = 'random') {
  const severityMap = {
    red: { level: 'Critical', code: 'red', summary: 'Severe trauma with high-risk impact and rapid escalation required.', triagePriority: 'Immediate', recommendedAction: 'Dispatch trauma response and secure the affected area immediately.' },
    yellow: { level: 'Moderate', code: 'yellow', summary: 'Visible injury or instability requiring triage and observation.', triagePriority: 'Prompt', recommendedAction: 'Send first-response team and prepare for transfer to a nearby care point.' },
    green: { level: 'Low', code: 'green', summary: 'Minor issue with stable condition and low immediate escalation risk.', triagePriority: 'Routine', recommendedAction: 'Monitor the patient and route non-urgent support if needed.' }
  };
  const picked = severityInput === 'random' ? randomChoice(Object.keys(severityMap)) : (severityMap[severityInput] ? severityInput : randomChoice(Object.keys(severityMap)));
  const selected = severityMap[picked];
  const centroid = zoneCentroid(zone);
  const hospitalCamp = randomChoice(['North Aid Camp', 'Medical Bay Camp', 'South Support Post', 'Gate 2 Relief Point']);
  const ambulanceEtaMinutes = picked === 'red' ? 4 : picked === 'yellow' ? 7 : 12;
  const report = {
    severity: selected.level,
    confidence: picked === 'red' ? 0.93 : picked === 'yellow' ? 0.8 : 0.72,
    rationale: `${zone.name} has a ${selected.level.toLowerCase()} casualty triage signal. The zone is proximate to public circulation, and the evaluation indicates ${selected.summary.toLowerCase()}`,
    provider: 'local-fallback',
    assistiveNote: 'Assistive AI assessment only: this does not represent a medical diagnosis or treatment decision.',
    triagePriority: selected.triagePriority,
    recommendedAction: selected.recommendedAction,
    location: { lat: centroid.lat, lng: centroid.lng },
    hospitalCamp,
    ambulanceEtaMinutes,
  };
  return report;
}

async function classifyCasualtyWithGemini(zone, severityInput) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const payload = buildCasualtyReport(zone, severityInput);
    const prompt = `You are an assistive emergency operations assistant. Assess a casualty in ${zone.name} and return valid JSON only with keys: severity, confidence, rationale, triagePriority, recommendedAction, hospitalCamp, ambulanceEtaMinutes. Severity must be one of Critical, Moderate, Low; this is not a medical diagnosis. The event is a simulated crowd incident in a venue. \n${JSON.stringify(payload, null, 2)}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, topP: 0.8 } })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `Gemini casualty request failed (${response.status})`);
    const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text).join('') || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini casualty response did not include valid JSON.');
    const parsed = JSON.parse(match[0]);
    const chosenSeverity = ['Critical', 'Moderate', 'Low'].includes(parsed.severity) ? parsed.severity : payload.severity;
    return {
      severity: chosenSeverity,
      confidence: Number(parsed.confidence) || payload.confidence,
      rationale: String(parsed.rationale || payload.rationale),
      provider: 'gemini',
      assistiveNote: 'Assistive AI assessment only: this does not represent a medical diagnosis or treatment decision.',
      triagePriority: String(parsed.triagePriority || payload.triagePriority),
      recommendedAction: String(parsed.recommendedAction || payload.recommendedAction),
      hospitalCamp: String(parsed.hospitalCamp || payload.hospitalCamp),
      ambulanceEtaMinutes: Number(parsed.ambulanceEtaMinutes) || payload.ambulanceEtaMinutes,
    };
  } catch (err) {
    console.warn('Gemini casualty triage failed, using local fallback:', err.message);
    return null;
  }
}

async function assessCasualty(zone, severityInput = 'random') {
  const geminiResult = await classifyCasualtyWithGemini(zone, severityInput);
  if (geminiResult) return geminiResult;
  return buildCasualtyReport(zone, severityInput);
}

function localIncidentSeverity(text, hasImage = false) {
  const combined = `${text || ''}`.toLowerCase();
  let score = 0;
  const criticalPatterns = [
    'unconscious', 'passed out', 'collapsed', 'chest pain', 'shortness of breath', 'difficulty breathing',
    'severe bleeding', 'bleeding heavily', 'trauma', 'fracture', 'fire', 'smoke', 'overdose', 'stroke',
    'heart attack', 'seizure', 'panic attack', 'gun', 'knife', 'violent', 'assault', 'medical emergency',
    'bleeding', 'unresponsive', 'not breathing', 'critical', 'emergency', 'injury', 'serious condition',
    'bahut khatarnak', 'samajh nahi aa raha', 'behosh', 'gir gaya', 'ghayal', 'jantya nahi', 'laash', 'mare jaa',
    'khatarnak', 'aag', 'dhuaan', 'ghayal hai', 'pain in chest', 'hard to breathe', 'severe injury', 'serious injury'
  ];
  const highPatterns = [
    'injured', 'fall', 'cut', 'vomiting', 'dizzy', 'faint', 'head injury', 'lost consciousness',
    'crowd surge', 'stampede', 'trapped', 'emergency', 'hard to breathe', 'breathless', 'breathing trouble',
    'pain', 'chot', 'gir', 'bechain', 'bahut stress', 'chot lagi', 'bimari', 'badh gayi', 'khatra',
    'crowd pushing', 'difficult breathing', 'medical help', 'need ambulance'
  ];
  const mediumPatterns = [
    'minor injury', 'hitting', 'accident', 'sick', 'feeling weak', 'struggling', 'hazard', 'barrier', 'broken',
    'wounded', 'nausea', 'dizzy', 'weak', 'light pain', 'crowd distress', 'pushing', 'noise', 'fight',
    'thoda dard', 'kamjor', 'chhoti chot', 'dukh ho raha', 'khoon', 'khalnayak', 'asiri', 'ghabrahat', 'ladayi'
  ];
  const lowPatterns = ['tired', 'slow', 'waiting', 'complaint', 'noise', 'nuisance', 'suspicious', 'lost', 'thak gaye', 'wait kar rahe', 'koi dikkat', 'suspicious', 'sab thik', 'patience', 'trouble'];

  for (const pattern of criticalPatterns) if (combined.includes(pattern)) score += 4;
  for (const pattern of highPatterns) if (combined.includes(pattern)) score += 3;
  for (const pattern of mediumPatterns) if (combined.includes(pattern)) score += 2;
  for (const pattern of lowPatterns) if (combined.includes(pattern)) score += 1;
  if (hasImage) score += 1;

  if (score >= 11) return { severity: 'Critical', confidence: 0.92, rationale: 'The report includes severe injury, emergency, or critical crowd-risk language and/or an uploaded image that suggests urgent intervention.', provider: 'local-fallback' };
  if (score >= 7) return { severity: 'High', confidence: 0.8, rationale: 'The report indicates a serious injury or escalation risk that should be reviewed promptly.', provider: 'local-fallback' };
  if (score >= 4) return { severity: 'Medium', confidence: 0.68, rationale: 'The report describes a moderate issue requiring operational review.', provider: 'local-fallback' };
  return { severity: 'Low', confidence: 0.62, rationale: 'The report suggests a minor issue or low immediate risk, but it should still be logged and reviewed.', provider: 'local-fallback' };
}

async function classifyIncidentWithGemini(report) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!apiKey) return null;

  try {
    const prompt = `You are an assistive safety operations assistant. Classify the severity of the following attendee incident report as one of: Critical, High, Medium, Low. This is NOT a medical diagnosis. The report may be in English, Hindi, or Hinglish. Return valid JSON only with keys: severity, confidence, rationale, provider. Focus on operational urgency and safety impact. Keep the rationale concise but specific. Here is the report:\n\n${JSON.stringify(report, null, 2)}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, topP: 0.8 }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `Gemini request failed (${response.status})`);
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text).join('') || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('Gemini response did not include valid JSON.');
    }
    const parsed = JSON.parse(match[0]);
    const severity = ['Critical', 'High', 'Medium', 'Low'].includes(parsed.severity) ? parsed.severity : 'Medium';
    return {
      severity,
      confidence: Number(parsed.confidence) || 0.7,
      rationale: String(parsed.rationale || 'Gemini assessed the incident as a safety concern requiring review.'),
      provider: 'gemini'
    };
  } catch (err) {
    console.warn('Gemini incident classification failed, using local fallback:', err.message);
    return null;
  }
}

async function assessIncidentReport(report) {
  const text = [report.transcript || '', report.description || '', report.reporterName || '', report.contact || ''].join(' ');
  const geminiResult = await classifyIncidentWithGemini(report);
  if (geminiResult) {
    return {
      ...geminiResult,
      assistiveNote: 'Assistive AI assessment only: this does not represent a medical diagnosis or treatment decision.',
    };
  }

  const localResult = localIncidentSeverity(text, Boolean(report.imageDataUrl));
  return {
    ...localResult,
    assistiveNote: 'Assistive AI assessment only: this does not represent a medical diagnosis or treatment decision.',
  };
}

// Real external notification channel, used for critical alerts and
// panic-corroborated escalations. This is genuinely wired up (unlike the
// simulated SMS/USSD entry) because a webhook costs nothing to integrate,
// unlike a real telecom SMS gateway, which needs a paid account. Supports
// Slack and Discord incoming-webhook payload shapes, auto-detected from
// the URL. Silently does nothing if WEBHOOK_URL isn't set.
async function notifyWebhook(text) {
  if (!WEBHOOK_URL) return;
  try {
    const isDiscord = WEBHOOK_URL.includes('discord.com') || WEBHOOK_URL.includes('discordapp.com');
    const body = isDiscord ? { content: text } : { text };
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('Webhook notification failed:', err.message);
  }
}

// Simple trend-based predictive check (linear extrapolation over rolling
// history). This is a lightweight statistical heuristic, not a trained
// model, flagged here honestly rather than oversold as "AI".
function predictCrossing(zoneId, cap) {
  const hist = zoneState[zoneId].history;
  if (hist.length < 3) return false;
  const recent = hist.slice(-3);
  const avgDelta = (recent[2] - recent[0]) / 2;
  if (avgDelta <= 0) return false;
  const projected = recent[2] + avgDelta * 3; // project 3 ticks ahead
  const pct = recent[2] / cap;
  return pct >= THRESHOLDS.PREDICTIVE_MIN_FRAC && pct < THRESHOLDS.CRITICAL_FRAC && projected / cap >= THRESHOLDS.CRITICAL_FRAC;
}

function timeNow() {
  return new Date().toISOString();
}

// ---- Flow-bottleneck detection (this is the core differentiator) ----
// Per-zone thresholds fire when a zone alone gets too full. That misses
// the more common real failure mode: a crush forming at the JOINT between
// two zones because people are draining out of one faster than the next
// one can absorb them, even while both are individually still "safe" or
// "caution". This checks, after every reading, whether the zone that was
// just updated is receiving a fast inflow that lines up with a fast
// outflow from an adjacent zone, and projects forward a couple of ticks.
function checkFlowBottleneck(zoneId) {
  const zone = ZONES.find(z => z.id === zoneId);
  const s = zoneState[zoneId];
  if (!zone) return;
  if (s.status === 'critical') { s._bottleneckFired = false; return; }

  const neighbors = ADJACENCY[zoneId] || [];
  const inflowThreshold = zone.cap * FLOW_FRAC;

  for (const nId of neighbors) {
    const n = zoneState[nId];
    const nZone = ZONES.find(z => z.id === nId);
    if (!n || !nZone) continue;
    const outflowThreshold = -(nZone.cap * FLOW_FRAC);

    if (s.lastDelta >= inflowThreshold && n.lastDelta <= outflowThreshold) {
      const projected = s.count + s.lastDelta * 2;
      const projectedPct = projected / zone.cap;

      if (projectedPct >= BOTTLENECK_PROJECT_FRAC && !s._bottleneckFired) {
        s._bottleneckFired = true;

        const alert = {
          id: 'BTL-' + Date.now(), type: 'bottleneck', zoneId, zoneName: zone.name,
          fromZoneId: nId, fromZoneName: nZone.name,
          message: `People are moving from ${nZone.name} into ${zone.name} faster than it can absorb. Projected to reach ${Math.round(projectedPct * 100)}% capacity within about 2 update cycles, even though neither zone has crossed its own threshold yet.`,
          ts: timeNow(),
        };
        logIncident(alert);
        void publishEvent('bottleneck', alert);

        const centroid = zoneCentroid(zone);
        const match = nearestAvailableResponder(centroid.lat, centroid.lng);
        if (match) {
          match.responder.status = 'dispatched';
          const dispatch = {
            id: 'PDS-' + Date.now(), type: 'preemptive_dispatch', zoneId, zoneName: zone.name,
            responderId: match.responder.id, responderName: match.responder.name,
            distanceMeters: match.distanceMeters,
            message: `${match.responder.name} preemptively routed to ${zone.name} ahead of predicted congestion (${match.distanceMeters}m away), dispatched before either zone crossed its own threshold.`,
            ts: timeNow(),
          };
          logIncident(dispatch);
          void publishEvent('preemptive_dispatch', dispatch);
          setTimeout(() => { match.responder.status = 'available'; }, 25000);
        }
        return;
      }
    }
  }

  // Reset the flag once the surge subsides so it can fire again later.
  const stillTrending = neighbors.some(nId => s.lastDelta >= inflowThreshold * 0.5);
  if (!stillTrending) s._bottleneckFired = false;
}

// ---- Panic / self-report corroboration ----
// One person tapping "I feel unsafe" could be anything. Several people
// tapping it in the same zone within a few minutes is a real signal,
// often faster than density sensors alone, e.g. a crush caused by a
// scuffle or a blocked exit rather than raw headcount. This lets human
// reports escalate an alert independent of what the sensors say.
function recordPanicReport(lat, lng, clientId) {
  const zone = findZoneForPoint(lat, lng);
  const report = {
    id: 'PNC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    type: 'panic', lat, lng, zoneId: zone ? zone.id : null, zoneName: zone ? zone.name : null,
    ts: timeNow(),
  };
  logIncident(report);
  void publishEvent('panic', report);

  if (zone) {
    const now = Date.now();
    const id = clientId || ('anon-' + lat.toFixed(5) + ',' + lng.toFixed(5)); // best-effort if no clientId sent
    if (!panicReports[zone.id]) panicReports[zone.id] = [];
    panicReports[zone.id].push({ clientId: id, ts: now });
    panicReports[zone.id] = panicReports[zone.id].filter(r => now - r.ts <= PANIC_WINDOW_MS);

    // Count DISTINCT clients, not raw taps. One device tapping repeatedly
    // should not be able to trigger corroboration on its own.
    const distinctClients = new Set(panicReports[zone.id].map(r => r.clientId));
    const count = distinctClients.size;

    if (count >= PANIC_THRESHOLD && !zoneState[zone.id]._panicFired) {
      zoneState[zone.id]._panicFired = true;
      const corroborated = {
        id: 'PNCC-' + Date.now(), type: 'panic_corroborated', zoneId: zone.id, zoneName: zone.name,
        message: `${count} distinct attendees have reported unsafe conditions in ${zone.name} in the last few minutes. Escalating regardless of current sensor reading.`,
        ts: timeNow(),
      };
      logIncident(corroborated);
      void publishEvent('panic_corroborated', corroborated);
      notifyWebhook(`[CrowdPulse] Corroborated alert: ${corroborated.message}`);
      setTimeout(() => { zoneState[zone.id]._panicFired = false; panicReports[zone.id] = []; }, PANIC_WINDOW_MS);
    }
  }
  return { zoneId: zone ? zone.id : null, zoneName: zone ? zone.name : null };
}

async function runAiAssessment(zoneId, source = 'unknown') {
  const s = zoneState[zoneId];
  if (!s) return null;
  try {
    const historyRows = await db.loadRecentZoneReadings(SESSION_ID, zoneId, 12);
    const history = historyRows.map(r => Number(r.count)).filter(Number.isFinite);
    const panicCount = await db.loadZonePanicCount(SESSION_ID, zoneId, 5);
    const recentIncidents = incidents.filter(i => i.zoneId === zoneId).slice(0, 8);
    const result = await assessZone({ zoneId, count: s.count, history, intervalSeconds: Number(process.env.SENSOR_INTERVAL_SECONDS || 2), panicReports: panicCount, incidents: recentIncidents, source });
    await db.insertAiPrediction(result, SESSION_ID);
    await publishEvent('aiAssessment', result);
    return result;
  } catch (err) {
    console.error(`AI assessment failed for ${zoneId}:`, err.message);
    return null;
  }
}

/* ---------------- Core zone update logic (called by sensor pings) ------- */
function applySensorReading(zoneId, count, source) {
  const zone = ZONES.find(z => z.id === zoneId);
  if (!zone) return null;
  const s = zoneState[zoneId];
  const previousCount = s.count;
  s.count = Math.max(0, count);
  s.lastDelta = s.count - previousCount;
  s.lastSource = source;
  s.history.push(s.count);
  if (s.history.length > 6) s.history.shift();

  const pct = s.count / zone.cap;
  const prevStatus = s.status;
  let newStatus = 'safe';
  // Fractional thresholds (90%/70%) don't make sense for a very small
  // integer capacity: with cap=1, being AT capacity (1 person, 100%)
  // already reads as "critical" under the normal model, even though the
  // limit hasn't actually been exceeded yet. Zones can opt out of the
  // fractional model via `criticalOnExceedOnly` in config.js and use a
  // literal "over capacity" rule instead: at cap is still safe, one more
  // than cap is critical. Zone Camera (cap=1) uses this so that exactly
  // 1 person stays safe and a 2nd person is what actually triggers it.
  if (zone.criticalOnExceedOnly) {
    newStatus = s.count > zone.cap ? 'critical' : 'safe';
  } else {
    if (pct >= THRESHOLDS.CRITICAL_FRAC) newStatus = 'critical';
    else if (pct >= THRESHOLDS.CAUTION_FRAC) newStatus = 'caution';
  }

  // Trend-based "predictive caution" is a fractional-occupancy concept
  // (trending toward 90%) and doesn't apply to a binary exceed/don't-exceed
  // zone like Zone Camera, so skip it there rather than let it fire on a
  // model that doesn't match how that zone actually behaves.
  const predictive = zone.criticalOnExceedOnly ? false : predictCrossing(zoneId, zone.cap);

  s.status = newStatus;

  const payload = {
    zoneId, name: zone.name, cap: zone.cap, count: s.count,
    pct: Math.round(pct * 100), status: s.status, source, ts: timeNow(),
  };
  void db.insertZoneReading({ sessionId: SESSION_ID, zoneId, count: s.count, source, ts: payload.ts }).catch(err => console.error('DB zone reading insert failed:', err.message));
  void publishEvent('zoneUpdate', payload);
  void runAiAssessment(zoneId, source);

  // Predictive caution: fires once while trending up but before crossing.
  if (predictive && prevStatus !== 'critical' && !s._predictiveFired) {
    s._predictiveFired = true;
    const alert = {
      id: 'PRED-' + Date.now(), type: 'predictive', zoneId, zoneName: zone.name,
      message: `${zone.name} trending toward capacity. Projected to exceed 90% within about 3 update cycles at current rate.`,
      ts: timeNow(),
    };
    logIncident(alert);
    void publishEvent('predictive', alert);
  }
  if (s.status !== 'critical') s._predictiveFired = false;

  // Threshold crossed into critical -> alert + auto-dispatch
  if (newStatus === 'critical' && prevStatus !== 'critical') {
    const alert = {
      id: 'ALT-' + Date.now(), type: 'alert', zoneId, zoneName: zone.name,
      message: `${zone.name} exceeded safe density (${payload.pct}% of capacity).`,
      ts: timeNow(),
    };
    logIncident(alert);
    void publishEvent('alert', alert);
    notifyWebhook(`[CrowdPulse] CRITICAL: ${alert.message}`);

    const sms = {
      id: 'SMS-' + Date.now(), type: 'sms_fallback', zoneId, zoneName: zone.name,
      message: `[Simulated] Critical alert for ${zone.name} pushed via SMS/USSD fallback channel. Reaches on-ground marshals independent of app or WiFi connectivity.`,
      ts: timeNow(),
    };
    logIncident(sms);
    void publishEvent('sms_fallback', sms);

    const centroid = zoneCentroid(zone);
    const match = nearestAvailableResponder(centroid.lat, centroid.lng);
    if (match) {
      match.responder.status = 'dispatched';
      const dispatch = {
        id: 'DSP-' + Date.now(), type: 'dispatch', zoneId, zoneName: zone.name,
        responderId: match.responder.id, responderName: match.responder.name,
        distanceMeters: match.distanceMeters,
        message: `${match.responder.name} dispatched to ${zone.name} (${match.distanceMeters}m away).`,
        ts: timeNow(),
      };
      logIncident(dispatch);
      void publishEvent('dispatch', dispatch);

      // simulate responder arriving and becoming available again after a while
      setTimeout(() => { match.responder.status = 'available'; }, 25000);
    } else {
      const noUnit = {
        id: 'NOU-' + Date.now(), type: 'no_unit', zoneId, zoneName: zone.name,
        message: `${zone.name} critical but no responder units currently available.`,
        ts: timeNow(),
      };
      logIncident(noUnit);
      void publishEvent('no_unit', noUnit);
    }
  }

  // Resolved
  if (prevStatus === 'critical' && newStatus !== 'critical' && pct < 0.75) {
    const resolved = {
      id: 'RES-' + Date.now(), type: 'resolved', zoneId, zoneName: zone.name,
      message: `${zone.name} back under safe threshold.`, ts: timeNow(),
    };
    logIncident(resolved);
    void publishEvent('resolved', resolved);
  }

  checkFlowBottleneck(zoneId);

  return payload;
}

/* ---------------- REST API ---------------- */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const dbUser = username && password ? await db.getUserByUsername(username) : null;
  const user = dbUser && dbUser.password_hash === require('crypto').createHash('sha256').update(String(password || '')).digest('hex')
    ? { username: dbUser.username, role: dbUser.role, password: String(password) }
    : AUTH_USERS.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  const token = signToken(user);
  res.json({ token, expiresIn: JWT_EXPIRES_IN, user: { username: user.username, role: user.role } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { username: req.user.username, role: req.user.role }, sessionId: SESSION_ID });
});

app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await db.health();
    let redis = 'disabled';
    if (redisEnabled) { try { await redisPub.ping(); redis = 'connected'; } catch { redis = 'down'; } }
    res.json({ ok: true, database: 'connected', redis, ai: { local: true, gemini: Boolean(process.env.GEMINI_API_KEY), service: process.env.AI_SERVICE_URL || 'http://localhost:8000' }, now: dbHealth.now });
  } catch (err) {
    res.status(503).json({ ok: false, database: 'down', redis: redisEnabled ? 'unknown' : 'disabled', ai: { local: true, gemini: Boolean(process.env.GEMINI_API_KEY) }, error: err.message });
  }
});

app.get('/api/venue', requireAuth, (req, res) => res.json({ center: VENUE_CENTER }));

app.get('/api/zones', requireAuth, (req, res) => {
  const out = ZONES.map(z => ({
    id: z.id, name: z.name, cap: z.cap, bounds: z.bounds,
    count: zoneState[z.id].count,
    pct: Math.round((zoneState[z.id].count / z.cap) * 100),
    status: zoneState[z.id].status,
    source: zoneState[z.id].lastSource,
    history: zoneState[z.id].history, // last few readings, used for the zone-list sparkline
  }));
  res.json(out);
});

app.get('/api/responders', requireAuth, (req, res) => res.json(responders));

app.get('/api/admin-map', requireAuth, requireRole('admin','operator'), async (req, res) => {
  const uploadedReports = await db.listAttendeeReports(50).catch(() => []);
  const uploadedPeople = uploadedReports.map((report) => ({
    id: report.id,
    reporterName: report.reporter_name || 'Attendee',
    reporterRole: report.reporter_role || 'attendee',
    latitude: Number(report.latitude),
    longitude: Number(report.longitude),
    zoneId: report.zone_id,
    zoneName: report.zone_name || 'Unknown zone',
    description: report.description || '',
    transcript: report.transcript || '',
    imageDataUrl: report.image_data_url || null,
    imageName: report.image_name || 'incident-photo',
    timestamp: report.timestamp,
    severity: report.assessment?.severity || 'Medium',
    rationale: report.assessment?.rationale || 'AI assessed from uploaded report.',
    contact: report.contact || null,
  }));

  const casualties = activeCasualties.map((casualty) => ({
    id: casualty.id,
    zoneId: casualty.zoneId,
    zoneName: casualty.zoneName,
    lat: casualty.lat,
    lng: casualty.lng,
    severity: casualty.severity,
    level: casualty.level,
    summary: casualty.summary,
    estimatedCasualties: casualty.estimatedCasualties || casualty.injuredCount || 1,
    hospitalCamp: casualty.hospitalCamp,
    ambulanceEtaMinutes: casualty.ambulanceEtaMinutes,
    ts: casualty.ts,
  }));

  const injuredPersons = casualties.flatMap((casualty) => {
    const count = Math.max(1, Number(casualty.estimatedCasualties) || 1);
    return Array.from({ length: Math.min(6, count) }, (_, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, Math.min(6, count));
      const offset = 0.00028 + (index % 3) * 0.00018;
      return {
        id: `${casualty.id}-person-${index}`,
        casualtyId: casualty.id,
        casualtyZone: casualty.zoneName,
        lat: casualty.lat + Math.cos(angle) * offset,
        lng: casualty.lng + Math.sin(angle) * offset,
        severity: casualty.severity,
        label: `Injured ${index + 1}`,
      };
    });
  });

  const camps = CAMP_LOCATIONS.map((camp) => ({ ...camp, type: 'camp' }));
  const security = responders.map((unit) => ({ ...unit, type: 'security' }));
  const ambulances = casualties.map((casualty) => {
    const camp = camps.find((item) => item.name === casualty.hospitalCamp) || camps[0];
    const lat = camp ? camp.lat + 0.00022 : casualty.lat + 0.0004;
    const lng = camp ? camp.lng + 0.00022 : casualty.lng + 0.0004;
    return {
      id: `ambulance-${casualty.id}`,
      name: `${camp?.name || 'Nearby'} ambulance`,
      lat,
      lng,
      etaMinutes: casualty.ambulanceEtaMinutes || 8,
      routeTo: casualty.zoneName,
      type: 'ambulance',
    };
  });

  const distances = casualties.flatMap((casualty) => {
    const nearestCamp = camps.reduce((best, camp) => {
      const d = Math.hypot(casualty.lat - camp.lat, casualty.lng - camp.lng) * 111000;
      return !best || d < best.distance ? { ...camp, distance: d } : best;
    }, null);
    const nearestSecurity = security.reduce((best, unit) => {
      const d = Math.hypot(casualty.lat - unit.lat, casualty.lng - unit.lng) * 111000;
      return !best || d < best.distance ? { ...unit, distance: d } : best;
    }, null);
    const nearestAmbulance = ambulances.find((unit) => unit.routeTo === casualty.zoneName) || ambulances[0];
    const items = [];
    if (nearestCamp) items.push({ fromId: casualty.id, fromLabel: casualty.zoneName, toId: nearestCamp.id, toLabel: nearestCamp.name, distanceMeters: Math.round(nearestCamp.distance), kind: 'camp' });
    if (nearestSecurity) items.push({ fromId: casualty.id, fromLabel: casualty.zoneName, toId: nearestSecurity.id, toLabel: nearestSecurity.name, distanceMeters: Math.round(nearestSecurity.distance), kind: 'security' });
    if (nearestAmbulance) items.push({ fromId: casualty.id, fromLabel: casualty.zoneName, toId: nearestAmbulance.id, toLabel: nearestAmbulance.name, distanceMeters: Math.round(Math.hypot(casualty.lat - nearestAmbulance.lat, casualty.lng - nearestAmbulance.lng) * 111000), kind: 'ambulance' });
    return items;
  });

  res.json({ camps, casualties, injuredPersons, security, ambulances, distances, uploadedPeople });
});

app.get('/api/attendee-reports', requireAuth, requireRole('admin','operator'), async (req, res) => {
  try {
    const rows = await db.listAttendeeReports(50);
    const reports = rows.map((report) => ({
      id: report.id,
      reporterName: report.reporter_name || 'Attendee',
      reporterRole: report.reporter_role || 'attendee',
      latitude: Number(report.latitude),
      longitude: Number(report.longitude),
      zoneId: report.zone_id,
      zoneName: report.zone_name || 'Unknown zone',
      description: report.description || '',
      transcript: report.transcript || '',
      imageDataUrl: report.image_data_url || null,
      imageName: report.image_name || 'incident-photo',
      audioDataUrl: report.audio_data_url || null,
      voiceLanguage: report.voice_language || 'en-IN',
      timestamp: report.timestamp,
      severity: report.assessment?.severity || 'Medium',
      rationale: report.assessment?.rationale || 'AI assessed from uploaded report.',
      contact: report.contact || null,
    }));
    res.json(reports);
  } catch (err) {
    console.error('Failed to load attendee reports:', err);
    res.status(500).json({ error: 'Unable to fetch attendee reports.' });
  }
});

app.get('/api/incidents', requireAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(incidents.slice(0, limit));
});

// Called by the IoT simulator (or real sensors, later) to push a reading.
// Called by any real or simulated crowd-counting source: the simulator,
// a camera-based CV script, a volunteer's manual-tally page, whatever.
// `source` is caller-supplied so the incident log and dashboard can show
// where a reading actually came from, instead of every reading being
// force-labeled as simulated regardless of its real origin.
app.post('/api/sensor-ping', requireAuth, requireRole('sensor','admin','operator'), (req, res) => {
  const { zoneId, count, source } = req.body;
  if (!zoneId || typeof count !== 'number') {
    return res.status(400).json({ error: 'zoneId and numeric count are required' });
  }
  const result = applySensorReading(zoneId, count, source || 'unlabeled-sensor');
  if (!result) return res.status(404).json({ error: 'unknown zoneId' });
  res.json({ ok: true, result });
});

// Attendee reports/updates their own coordinates (manual input, since real
// GPS isn't wired up in this prototype, see README).
app.post('/api/attendee-location', requireAuth, requireRole('attendee','admin','operator'), rateLimit(20, 10000), (req, res) => {
  const { lat, lng, clientId } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng must be numbers' });
  }
  const zone = findZoneForPoint(lat, lng);
  const id = clientId || 'anon';
  attendees[id] = { lat, lng, zoneId: zone ? zone.id : null, ts: timeNow() };
  void db.upsertAttendee({ clientId: id, lat, lng, zoneId: zone ? zone.id : null, ts: attendees[id].ts }).catch(err => console.error('DB attendee upsert failed:', err.message));
  void publishEvent('attendeeUpdate', { clientId: id, lat, lng, zoneId: zone ? zone.id : null });

  if (!zone) {
    return res.json({ zoneId: null, status: 'unknown', message: 'You are outside all mapped zones.' });
  }
  const s = zoneState[zone.id];
  let message;
  if (s.status === 'critical') {
    message = `${zone.name} is over capacity. Move calmly toward a lower-density zone. Responders are being dispatched.`;
  } else if (s.status === 'caution') {
    message = `${zone.name} is filling up. Consider moving if you need more space.`;
  } else {
    message = `${zone.name} density is normal. No action needed.`;
  }
  res.json({ zoneId: zone.id, zoneName: zone.name, status: s.status, message });
});

// Attendee taps "I feel unsafe". Real signal, corroborated against other
// reports in the same zone. See recordPanicReport() for why this matters.
app.post('/api/panic-report', requireAuth, requireRole('attendee','admin','operator'), rateLimit(10, 10000), (req, res) => {
  const { lat, lng, clientId } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng must be numbers' });
  }
  const result = recordPanicReport(lat, lng, clientId);
  const panicZone = findZoneForPoint(lat, lng);
  void db.insertPanicReport({ sessionId: SESSION_ID, clientId: clientId || 'anon', zoneId: panicZone ? panicZone.id : null, lat, lng, ts: timeNow() }).catch(err => console.error('DB panic insert failed:', err.message));
  res.json({ ok: true, ...result });
});

app.post('/api/incident-report', requireAuth, requireRole('attendee','admin','operator'), rateLimit(10, 60000), async (req, res) => {
  try {
    const {
      reporterName,
      reporterRole,
      contact,
      latitude,
      longitude,
      zoneId,
      zoneName,
      description,
      transcript,
      imageDataUrl,
      imageName,
      audioDataUrl,
      audioName,
      voiceLanguage,
      timestamp,
    } = req.body || {};

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ error: 'latitude and longitude must be numbers' });
    }

    const summaryText = [description || '', transcript || ''].filter(Boolean).join(' ');
    if (!summaryText.trim()) {
      return res.status(400).json({ error: 'Please provide a short incident description or voice transcript.' });
    }

    const reportId = `IR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id: reportId,
      reporterName: reporterName || 'Attendee',
      reporterRole: reporterRole || 'attendee',
      contact: contact || undefined,
      latitude,
      longitude,
      zoneId: zoneId || null,
      zoneName: zoneName || null,
      description: description || '',
      transcript: transcript || '',
      imageDataUrl: imageDataUrl || undefined,
      imageName: imageName || 'incident-photo',
      audioDataUrl: audioDataUrl || undefined,
      audioName: audioName || 'incident-audio',
      voiceLanguage: voiceLanguage || 'en-IN',
      timestamp: timestamp || new Date().toISOString(),
    };

    const assessment = await assessIncidentReport(payload);
    const incident = {
      id: reportId,
      type: 'incident_report',
      ts: payload.timestamp,
      message: `AI assistive incident report classified as ${assessment.severity}: ${assessment.rationale}`,
      zoneId: payload.zoneId || null,
      zoneName: payload.zoneName || null,
      reporterName: payload.reporterName,
      reporterRole: payload.reporterRole,
      severity: assessment.severity,
      assistiveAssessment: true,
      assessment,
      payload,
    };

    try {
      await db.insertAttendeeReport({
        id: reportId,
        sessionId: SESSION_ID,
        reporterName: payload.reporterName || 'Attendee',
        reporterRole: payload.reporterRole || 'attendee',
        contact: payload.contact || null,
        latitude: payload.latitude,
        longitude: payload.longitude,
        zoneId: payload.zoneId || null,
        zoneName: payload.zoneName || null,
        description: payload.description || '',
        transcript: payload.transcript || '',
        voiceLanguage: payload.voiceLanguage || 'en-IN',
        imageDataUrl: payload.imageDataUrl || null,
        audioDataUrl: payload.audioDataUrl || null,
        imageName: payload.imageName || 'incident-photo',
        audioName: payload.audioName || 'incident-audio',
        assessment,
        timestamp: payload.timestamp || new Date().toISOString(),
      });
    } catch (dbErr) {
      console.error('Attendee report DB persistence failed:', dbErr.message);
    }

    logIncident(incident);
    void publishEvent('incident_report', incident);

    return res.json({
      ok: true,
      reportId,
      severity: assessment.severity,
      assessment,
      submittedAt: payload.timestamp,
    });
  } catch (err) {
    console.error('Incident report submission failed:', err);
    return res.status(500).json({ error: err.message || 'Incident report classification failed.' });
  }
});

app.post('/api/camera/injury-detect', requireAuth, requireRole('admin','operator','sensor'), rateLimit(10, 60000), async (req, res) => {
  try {
    const {
      lat,
      lng,
      zoneId,
      zoneName,
      personCount = 1,
      confidence = 0.75,
      posture = 'unknown',
      transcript = '',
      imageDataUrl,
      audioDataUrl,
      voiceLanguage = 'en-IN',
      cameraId = 'cctv-1',
      severityHint = 'medium',
    } = req.body || {};

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }

    const cameraLocation = { lat, lng };
    const nearestCamp = nearestCampForLocation(lat, lng);
    const cameraSummary = buildCameraInjurySummary({
      personCount,
      confidence,
      posture,
      transcript,
      hasAudio: Boolean(audioDataUrl),
      severityHint,
    });

    const reportId = `CAM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const report = {
      id: reportId,
      type: 'camera_injury_report',
      ts: new Date().toISOString(),
      cameraId,
      zoneId: zoneId || null,
      zoneName: zoneName || null,
      location: cameraLocation,
      nearestCamp,
      severity: cameraSummary.severity,
      assessment: cameraSummary,
      transcript,
      imageDataUrl: imageDataUrl || null,
      audioDataUrl: audioDataUrl || null,
      voiceLanguage,
      message: `Camera-based injury report triggered near ${zoneName || 'camera zone'}; nearest camp is ${nearestCamp.name}.`,
    };

    const campDispatch = {
      id: `DSP-${Date.now()}`,
      type: 'camp_dispatch_confirmed',
      zoneId: zoneId || 'camera-zone',
      zoneName: zoneName || 'Camera Zone',
      responderId: 'camp-dispatch',
      responderName: `${nearestCamp.name} Response Unit`,
      distanceMeters: Math.round(Math.hypot(lat - nearestCamp.lat, lng - nearestCamp.lng) * 111000),
      message: `${nearestCamp.name} accepted and is deploying a unit to the detected injured person. ${cameraSummary.recommendedAction}`,
      ts: new Date().toISOString(),
      campName: nearestCamp.name,
      severity: cameraSummary.severity,
    };

    logIncident(report);
    logIncident(campDispatch);
    void publishEvent('camera_injury_report', report);
    void publishEvent('camp_dispatch_confirmed', campDispatch);

    try {
      await db.insertAttendeeReport({
        id: reportId,
        sessionId: SESSION_ID,
        reporterName: 'Camera AI',
        reporterRole: 'sensor',
        contact: null,
        latitude: lat,
        longitude: lng,
        zoneId: zoneId || null,
        zoneName: zoneName || null,
        description: `CCTV YOLO + AI injury detection report for ${cameraId}. ${cameraSummary.rationale}`,
        transcript,
        voiceLanguage,
        imageDataUrl: imageDataUrl || null,
        audioDataUrl: audioDataUrl || null,
        imageName: `${cameraId}-injury-photo`,
        audioName: `${cameraId}-injury-audio`,
        assessment: cameraSummary,
        timestamp: report.ts,
      });
    } catch (dbErr) {
      console.warn('Camera injury report persisted in-memory only:', dbErr.message);
    }

    res.json({ ok: true, report, dispatch: campDispatch, nearestCamp });
  } catch (err) {
    console.error('Camera injury detection failed:', err);
    res.status(500).json({ error: err.message || 'Camera injury detection failed.' });
  }
});

/* ---- Demo-control endpoints (require x-admin-key, see config.js) ----
   These exist so you can drive a live demo from the dashboard's "Demo
   controls" panel instead of typing curl commands on stage. They feed the
   exact same detection pipeline as real data would. Nothing about the
   alert/dispatch logic is bypassed, only the input is synthetic. */

app.post('/api/simulate-critical', requireAdminKey, (req, res) => {
  const { zoneId } = req.body;
  const zone = ZONES.find(z => z.id === zoneId);
  if (!zone) return res.status(400).json({ error: 'invalid zoneId' });
  const result = applySensorReading(zoneId, Math.round(zone.cap * 0.97), 'demo-trigger');
  res.json({ ok: true, result });
});

app.post('/api/simulate-casualty', requireAdminKey, async (req, res) => {
  const { severity = 'random', zoneId } = req.body || {};
  const eligibleZones = ZONES.filter(z => z.id !== 'G');
  const selectedZone = zoneId ? ZONES.find(z => z.id === zoneId) : randomChoice(eligibleZones);
  if (!selectedZone) return res.status(400).json({ error: 'invalid zoneId' });

  const casualtySeverity = severity === 'random' ? randomChoice(['red', 'yellow', 'green']) : String(severity).toLowerCase();
  const report = await assessCasualty(selectedZone, casualtySeverity);
  const centroid = zoneCentroid(selectedZone);
  const marker = {
    id: `CAS-${Date.now()}`,
    type: 'casualty',
    zoneId: selectedZone.id,
    zoneName: selectedZone.name,
    lat: centroid.lat + (Math.random() - 0.5) * 0.0009,
    lng: centroid.lng + (Math.random() - 0.5) * 0.0009,
    severity: casualtySeverity === 'red' ? 'red' : casualtySeverity === 'yellow' ? 'yellow' : 'green',
    level: report.severity === 'Critical' ? 'Critical' : report.severity === 'Moderate' ? 'Moderate' : 'Low',
    summary: report.rationale,
    aiSummary: `${report.triagePriority} casualty response: ${report.recommendedAction}`,
    structuredReport: { ...report },
    hospitalCamp: report.hospitalCamp || 'North Aid Camp',
    ambulanceEtaMinutes: report.ambulanceEtaMinutes || 8,
    estimatedCasualties: report.severity === 'Critical' ? 5 : report.severity === 'Moderate' ? 3 : 1,
    injuredCount: report.severity === 'Critical' ? 5 : report.severity === 'Moderate' ? 3 : 1,
    ts: timeNow(),
  };

  activeCasualties = [marker, ...activeCasualties].slice(0, 12);

  logIncident({ ...marker, message: `Casualty triage in ${selectedZone.name}: ${report.rationale}` });
  void publishEvent('casualty', marker);
  void publishEvent('casualty_hospital', {
    id: marker.id,
    type: 'casualty_hospital',
    zoneId: selectedZone.id,
    zoneName: selectedZone.name,
    hospitalCamp: marker.hospitalCamp,
    message: `Hospital camp ${marker.hospitalCamp} notified for ${selectedZone.name}. ${report.recommendedAction}`,
    ts: timeNow(),
  });
  void publishEvent('ambulance_update', {
    id: `AMB-${Date.now()}`,
    type: 'ambulance_update',
    zoneId: selectedZone.id,
    zoneName: selectedZone.name,
    destination: { lat: marker.lat, lng: marker.lng },
    ambulanceFrom: marker.hospitalCamp,
    etaMinutes: marker.ambulanceEtaMinutes,
    message: `Ambulance dispatched from ${marker.hospitalCamp} to ${selectedZone.name}; ETA ${marker.ambulanceEtaMinutes} minutes.`,
    ts: timeNow(),
  });

  res.json({ ok: true, casualty: marker, assessment: report });
});

app.post('/api/simulate-flow-surge', requireAdminKey, (req, res) => {
  const { fromZoneId, toZoneId } = req.body;
  const fromZone = ZONES.find(z => z.id === fromZoneId);
  const toZone = ZONES.find(z => z.id === toZoneId);
  if (!fromZone || !toZone) return res.status(400).json({ error: 'invalid zone ids' });
  const amount = Math.round(toZone.cap * 0.22);
  applySensorReading(fromZoneId, Math.max(0, zoneState[fromZoneId].count - amount), 'demo-trigger');
  applySensorReading(toZoneId, zoneState[toZoneId].count + amount, 'demo-trigger');
  res.json({ ok: true });
});

app.post('/api/simulate-panic-burst', requireAdminKey, (req, res) => {
  const { zoneId, count } = req.body;
  const zone = ZONES.find(z => z.id === zoneId);
  if (!zone) return res.status(400).json({ error: 'invalid zoneId' });
  const n = Math.min(6, count || 3);
  const c = zoneCentroid(zone);
  for (let i = 0; i < n; i++) {
    // distinct simulated client ids, since real distinct attendees is the
    // whole point of the corroboration check (see recordPanicReport)
    const fakeClientId = 'demo-burst-' + zoneId + '-' + i;
    setTimeout(() => recordPanicReport(
      c.lat + (Math.random() - 0.5) * 0.0004,
      c.lng + (Math.random() - 0.5) * 0.0004,
      fakeClientId
    ), i * 400);
  }
  res.json({ ok: true, queued: n });
});

// Resets all live state to defaults without restarting the process, so
// you can run the demo again for the next judge without a server bounce
// (which would also stop the simulator's polling loop resyncing). Does
// not clear the on-disk incident log, only in-memory/session state.
app.post('/api/reset-demo', requireAdminKey, async (req, res) => {
  ZONES.forEach(z => {
    zoneState[z.id].count = Math.round(z.cap * 0.35);
    zoneState[z.id].status = 'safe';
    zoneState[z.id].history = [];
    zoneState[z.id].lastDelta = 0;
    zoneState[z.id].lastSource = null;
    zoneState[z.id]._predictiveFired = false;
    zoneState[z.id]._bottleneckFired = false;
    zoneState[z.id]._panicFired = false;
  });
  responders.forEach(r => { r.status = 'available'; });
  incidents = [];
  activeCasualties = [];
  Object.keys(panicReports).forEach(k => delete panicReports[k]);
  try { await db.clearSession(SESSION_ID); } catch (err) { return res.status(503).json({ error:'database reset failed', detail:err.message }); }
  void publishEvent('demo_reset', { ts: timeNow() });
  res.json({ ok: true });
});

app.get('/api/ai/status', requireAuth, async (req, res) => {
  res.json({ localModel: 'GradientBoostingClassifier + IsolationForest (prototype risk layer)', flowForecastModel: 'WuerzburgFootTrafficNextHour-XGBoost-v1', aiService: process.env.AI_SERVICE_URL || 'http://localhost:8000', geminiEnabled: Boolean(process.env.GEMINI_API_KEY), model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
});

app.get('/api/ai/latest', requireAuth, async (req, res) => {
  try { res.json(await db.loadLatestAiPredictions(SESSION_ID)); }
  catch (err) { res.status(503).json({ error: err.message }); }
});

app.post('/api/ai/flow-forecast', requireAuth, requireRole('admin','operator','sensor'), async (req, res) => {
  try {
    const url = `${(process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '')}/flow-forecast`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) });
    const parsed = await response.json();
    if (!response.ok) throw new Error(parsed.error || `AI service HTTP ${response.status}`);
    res.json(parsed);
  } catch (err) {
    res.status(503).json({ available: false, error: err.message });
  }
});

app.get('/api/ai/zone/:zoneId', requireAuth, async (req, res) => {
  const zone = ZONES.find(z => z.id === req.params.zoneId);
  if (!zone) return res.status(404).json({ error: 'unknown zone' });
  const result = await runAiAssessment(zone.id, zoneState[zone.id]?.lastSource || 'dashboard');
  if (!result) return res.status(503).json({ error: 'AI assessment unavailable' });
  res.json(result);
});

app.post('/api/ai/ask', requireAuth, requireRole('admin','operator'), async (req, res) => {
  const zoneId = req.body?.zoneId;
  const zone = ZONES.find(z => z.id === zoneId);
  if (!zone) return res.status(400).json({ error: 'invalid zoneId' });
  const result = await runAiAssessment(zoneId, 'operator-query');
  if (!result) return res.status(503).json({ error: 'AI assessment unavailable' });
  res.json(result);
});

// Post-event summary, computed only from incidents actually logged this
// session, real numbers from this run, not placeholder metrics.
app.get('/api/analytics', requireAuth, (req, res) => {
  const byType = {};
  const byZone = {};
  let dispatchCount = 0;
  const pendingAlertTs = {};
  const resolveDurationsMs = [];

  incidents.slice().reverse().forEach(evt => {
    byType[evt.type] = (byType[evt.type] || 0) + 1;
    if (evt.zoneId) byZone[evt.zoneId] = (byZone[evt.zoneId] || 0) + 1;
    if (evt.type === 'dispatch' || evt.type === 'preemptive_dispatch') dispatchCount++;
    if (evt.type === 'alert') pendingAlertTs[evt.zoneId] = new Date(evt.ts).getTime();
    if (evt.type === 'resolved' && pendingAlertTs[evt.zoneId]) {
      resolveDurationsMs.push(new Date(evt.ts).getTime() - pendingAlertTs[evt.zoneId]);
      delete pendingAlertTs[evt.zoneId];
    }
  });

  const avgResolveSeconds = resolveDurationsMs.length
    ? Math.round(resolveDurationsMs.reduce((a, b) => a + b, 0) / resolveDurationsMs.length / 1000)
    : null;

  const peakZoneId = Object.keys(byZone).sort((a, b) => byZone[b] - byZone[a])[0] || null;
  const peakZone = peakZoneId ? ZONES.find(z => z.id === peakZoneId) : null;

  const cameraInjuryReports = incidents.filter(evt => evt.type === 'camera_injury_report');
  const sensorPingCount = incidents.filter(evt => evt.type === 'sensor_ping').length;
  const cameraSummary = summarizeDetectionMetrics({
    injuredPeople: cameraInjuryReports.length,
    normalPeople: Math.max(0, sensorPingCount - cameraInjuryReports.length),
    importantEvents: incidents.filter(evt => ['alert', 'bottleneck', 'panic_corroborated', 'camera_injury_report', 'dispatch', 'preemptive_dispatch'].includes(evt.type)).length,
    totalDetectedPeople: Math.max(1, sensorPingCount + cameraInjuryReports.length),
  });

  res.json({
    totalIncidents: incidents.length,
    byType,
    dispatchCount,
    avgResolveSeconds,
    peakZone: peakZone ? { id: peakZone.id, name: peakZone.name, count: byZone[peakZoneId] } : null,
    zones: ZONES.map(z => ({ id: z.id, name: z.name, count: byZone[z.id] || 0 })),
    detectionMetrics: {
      injuredPeople: cameraSummary.injuredPeople,
      normalPeople: cameraSummary.normalPeople,
      importantEvents: cameraSummary.importantEvents,
      totalDetectedPeople: cameraSummary.totalDetectedPeople,
      detectionRate: cameraSummary.detectionRate,
      importantEventsRate: cameraSummary.importantEventsRate,
    },
  });
});

// Flush queued events captured while the client was "offline" (network-loss demo)
app.post('/api/sync', requireAuth, requireRole('admin','operator'), (req, res) => {
  const events = Array.isArray(req.body.events) ? req.body.events : [];
  events.forEach(e => logIncident({ ...e, syncedLate: true, ts: timeNow() }));
  res.json({ ok: true, synced: events.length });
});

async function start() {
  let databaseAvailable = false;
  try {
    await db.initDb();
    databaseAvailable = true;
  } catch (err) {
    console.warn('Database startup unavailable:', err.message);
    console.warn('Continuing in in-memory fallback mode. PostgreSQL is optional for the prototype demo, but attendee/auth persistence will be disabled until the database is available.');
  }

  redisEnabled = await tryEnableRedis(); // never fatal, see tryEnableRedis()

  if (databaseAvailable) {
    try {
      const latest = await db.loadLatestZoneReadings(SESSION_ID);
      latest.forEach(row => { if (zoneState[row.zone_id]) { zoneState[row.zone_id].count=row.count; zoneState[row.zone_id].lastSource=row.source; zoneState[row.zone_id].history=[row.count]; } });
      incidents = await db.loadIncidents(SESSION_ID, 200);
    } catch (err) {
      console.error('Warning: could not load prior session state from the database:', err.message);
      console.error('Continuing with fresh in-memory state.');
    }
  }

  function listenOn(port) {
    server.once('error', err => {
      if (err && err.code === 'EADDRINUSE') {
        const nextPort = port + 1;
        console.warn(`Port ${port} is in use. Retrying on ${nextPort} automatically.`);
        listenOn(nextPort);
        return;
      }
      console.error('Failed to start backend server:', err && err.message ? err.message : err);
      process.exit(1);
    });

    server.listen(port, () => {
      console.log(`CrowdPulse backend running: http://localhost:${port} | PostgreSQL ${databaseAvailable ? 'connected' : 'unavailable (in-memory fallback)'} | Redis ${redisEnabled ? 'connected' : 'disabled (single-instance mode)'} | session=${SESSION_ID}`);
    });
  }

  listenOn(Number(PORT) || 4000);
}
start();