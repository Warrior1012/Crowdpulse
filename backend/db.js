const { Pool } = require('pg');
const crypto = require('crypto');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://crowdpulse:crowdpulse@localhost:5432/crowdpulse';
const pool = new Pool({ connectionString: DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 10), idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined });

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

async function initDb(){
  await pool.query('SELECT 1');
  await pool.query(`
CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,type TEXT NOT NULL,zone_id TEXT,zone_name TEXT,message TEXT NOT NULL,payload JSONB NOT NULL DEFAULT '{}'::jsonb,ts TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS incidents_session_ts_idx ON incidents(session_id,ts DESC);
CREATE TABLE IF NOT EXISTS zone_readings(id BIGSERIAL PRIMARY KEY,session_id TEXT NOT NULL,zone_id TEXT NOT NULL,count INTEGER NOT NULL,source TEXT,ts TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS zone_readings_session_zone_ts_idx ON zone_readings(session_id,zone_id,ts DESC);
CREATE TABLE IF NOT EXISTS attendees(client_id TEXT PRIMARY KEY,lat DOUBLE PRECISION NOT NULL,lng DOUBLE PRECISION NOT NULL,zone_id TEXT,ts TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS panic_reports(id BIGSERIAL PRIMARY KEY,session_id TEXT NOT NULL,client_id TEXT NOT NULL,zone_id TEXT,lat DOUBLE PRECISION NOT NULL,lng DOUBLE PRECISION NOT NULL,ts TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS panic_reports_session_zone_ts_idx ON panic_reports(session_id,zone_id,ts DESC);
CREATE TABLE IF NOT EXISTS ai_predictions(id BIGSERIAL PRIMARY KEY,session_id TEXT NOT NULL,zone_id TEXT NOT NULL,risk DOUBLE PRECISION NOT NULL,risk_level TEXT NOT NULL,model_source TEXT NOT NULL,model_version TEXT,confidence DOUBLE PRECISION,anomaly_score DOUBLE PRECISION,features JSONB NOT NULL DEFAULT '{}'::jsonb,copilot JSONB NOT NULL DEFAULT '{}'::jsonb,ts TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS ai_predictions_session_zone_ts_idx ON ai_predictions(session_id,zone_id,ts DESC);
CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK (role IN ('admin','operator','sensor','attendee')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS attendee_reports(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,reporter_name TEXT NOT NULL,reporter_role TEXT NOT NULL,contact TEXT,latitude DOUBLE PRECISION NOT NULL,longitude DOUBLE PRECISION NOT NULL,zone_id TEXT,zone_name TEXT,description TEXT,transcript TEXT,voice_language TEXT,image_data_url TEXT,audio_data_url TEXT,image_name TEXT,audio_name TEXT,assessment JSONB NOT NULL DEFAULT '{}'::jsonb,timestamp TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS attendee_reports_session_ts_idx ON attendee_reports(session_id,timestamp DESC);
CREATE TABLE IF NOT EXISTS venue_knowledge(id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,tags TEXT[] NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS venue_knowledge_tags_idx ON venue_knowledge USING GIN(tags);
`);
  const seed = [
    ['Main Stage SOP','Keep the front-of-stage egress lane clear. If occupancy exceeds 90% or inflow persistently exceeds outflow, meter entry and position responders at the north and east approaches.',['main stage','egress','entry']],
    ['Entry Gate 1 SOP','Entry Gate 1 is a high-flow boundary. Use controlled metering when adjacent Main Stage or Food Court zones rise rapidly.',['entry gate','metering','main stage','food court']],
    ['Medical Bay SOP','Medical Bay is a response zone. Keep its approach unobstructed and avoid routing new crowd flow through it during an incident.',['medical','responder','exit']],
    ['East Lawn SOP','East Lawn can absorb overflow from Food Court and Medical Bay only while its occupancy remains below 70%.',['east lawn','overflow','food court']],
    ['Parking Overflow SOP','Parking Overflow is an external holding area. Keep vehicle/pedestrian paths separated and use it as a controlled overflow route only when operations approves.',['parking','overflow','vehicle']],
    ['General emergency SOP','All AI recommendations are advisory. A human operator must approve emergency actions. Preserve clear egress and verify camera evidence before escalation when practical.',['emergency','safety','operator']]
  ];
  for (const [title, content, tags] of seed) {
    await pool.query(`INSERT INTO venue_knowledge(title,content,tags) SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM venue_knowledge WHERE title=$1)`, [title, content, tags]);
  }

  const defaultUsers = [
    { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'crowdpulse-admin', role: 'admin' },
    { username: process.env.OPERATOR_USERNAME || 'operator', password: process.env.OPERATOR_PASSWORD || 'crowdpulse-operator', role: 'operator' },
    { username: process.env.SENSOR_USERNAME || 'sensor', password: process.env.SENSOR_PASSWORD || 'crowdpulse-sensor', role: 'sensor' },
    { username: process.env.ATTENDEE_USERNAME || 'attendee', password: process.env.ATTENDEE_PASSWORD || 'crowdpulse-attendee', role: 'attendee' },
  ];
  for (const user of defaultUsers) {
    await pool.query(`INSERT INTO users(username,password_hash,role) SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM users WHERE username=$1)`, [user.username, hashPassword(user.password), user.role]);
  }
}
async function health(){const r=await pool.query('SELECT NOW() AS now');return {ok:true,now:r.rows[0].now};}
async function insertIncident(i,s){await pool.query(`INSERT INTO incidents(id,session_id,type,zone_id,zone_name,message,payload,ts) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(id) DO NOTHING`,[i.id,s,i.type||'unknown',i.zoneId||null,i.zoneName||null,i.message||'',JSON.stringify(i),i.ts||new Date().toISOString()]);}
async function insertZoneReading({sessionId,zoneId,count,source,ts}){await pool.query(`INSERT INTO zone_readings(session_id,zone_id,count,source,ts) VALUES($1,$2,$3,$4,$5)`,[sessionId,zoneId,count,source||null,ts||new Date().toISOString()]);}
async function loadLatestZoneReadings(s){const r=await pool.query(`SELECT DISTINCT ON(zone_id) zone_id,count,source,ts FROM zone_readings WHERE session_id=$1 ORDER BY zone_id,ts DESC`,[s]);return r.rows;}
async function loadRecentZoneReadings(s, zoneId, limit=12){const r=await pool.query(`SELECT count,source,ts FROM zone_readings WHERE session_id=$1 AND zone_id=$2 ORDER BY ts DESC LIMIT $3`,[s,zoneId,limit]);return r.rows.reverse();}
async function loadIncidents(s,l=200){const r=await pool.query(`SELECT payload FROM incidents WHERE session_id=$1 ORDER BY ts DESC LIMIT $2`,[s,l]);return r.rows.map(x=>x.payload);}
async function loadZonePanicCount(s, zoneId, windowMinutes=5){const r=await pool.query(`SELECT COUNT(DISTINCT client_id)::int AS count FROM panic_reports WHERE session_id=$1 AND zone_id=$2 AND ts >= NOW() - ($3 * INTERVAL '1 minute')`,[s,zoneId,windowMinutes]);return r.rows[0]?.count || 0;}
async function upsertAttendee({clientId,lat,lng,zoneId,ts}){await pool.query(`INSERT INTO attendees(client_id,lat,lng,zone_id,ts) VALUES($1,$2,$3,$4,$5) ON CONFLICT(client_id) DO UPDATE SET lat=EXCLUDED.lat,lng=EXCLUDED.lng,zone_id=EXCLUDED.zone_id,ts=EXCLUDED.ts`,[clientId,lat,lng,zoneId||null,ts||new Date().toISOString()]);}
async function insertPanicReport({sessionId,clientId,zoneId,lat,lng,ts}){await pool.query(`INSERT INTO panic_reports(session_id,client_id,zone_id,lat,lng,ts) VALUES($1,$2,$3,$4,$5,$6)`,[sessionId,clientId,zoneId||null,lat,lng,ts||new Date().toISOString()]);}
async function insertAiPrediction(p,s){const ts = p?.ts || new Date().toISOString(); await pool.query(`INSERT INTO ai_predictions(session_id,zone_id,risk,risk_level,model_source,model_version,confidence,anomaly_score,features,copilot,ts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,[s,p.zoneId,p.risk,p.riskLevel,p.model?.source||'local',p.model?.name||null,p.model?.confidence||null,p.model?.anomalyScore||null,JSON.stringify(p.features||{}),JSON.stringify(p.copilot||{}),ts]);}
async function loadLatestAiPredictions(s){const r=await pool.query(`SELECT DISTINCT ON(zone_id) * FROM ai_predictions WHERE session_id=$1 ORDER BY zone_id,ts DESC`,[s]);return r.rows;}
async function getUserByUsername(username){ const r=await pool.query('SELECT * FROM users WHERE username=$1 LIMIT 1',[username]); return r.rows[0] || null; }
async function insertAttendeeReport(report){ await pool.query(`INSERT INTO attendee_reports(id,session_id,reporter_name,reporter_role,contact,latitude,longitude,zone_id,zone_name,description,transcript,voice_language,image_data_url,audio_data_url,image_name,audio_name,assessment,timestamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18) ON CONFLICT(id) DO NOTHING`, [report.id, report.sessionId || 'demo-session', report.reporterName || 'Attendee', report.reporterRole || 'attendee', report.contact || null, report.latitude, report.longitude, report.zoneId || null, report.zoneName || null, report.description || '', report.transcript || '', report.voiceLanguage || 'en-IN', report.imageDataUrl || null, report.audioDataUrl || null, report.imageName || null, report.audioName || null, JSON.stringify(report.assessment || {}), report.timestamp || new Date().toISOString()]); }
async function listAttendeeReports(limit=20){ const r=await pool.query(`SELECT * FROM attendee_reports ORDER BY timestamp DESC LIMIT $1`, [limit]); return r.rows; }
async function searchVenueKnowledge(query, limit=4){const terms=String(query||'').toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>2).slice(0,12); if(!terms.length) return [];
  const pattern = `%${terms.join('%')}%`;
  const r=await pool.query(`SELECT id,title,content,tags FROM venue_knowledge WHERE LOWER(title||' '||content||' '||array_to_string(tags,' ')) LIKE $1 LIMIT $2`,[pattern,limit]);
  return r.rows;
}
async function clearSession(s){await pool.query('DELETE FROM incidents WHERE session_id=$1',[s]);await pool.query('DELETE FROM zone_readings WHERE session_id=$1',[s]);await pool.query('DELETE FROM panic_reports WHERE session_id=$1',[s]);await pool.query('DELETE FROM ai_predictions WHERE session_id=$1',[s]);}
module.exports={initDb,health,insertIncident,insertZoneReading,loadLatestZoneReadings,loadRecentZoneReadings,loadIncidents,loadZonePanicCount,upsertAttendee,insertPanicReport,insertAiPrediction,loadLatestAiPredictions,getUserByUsername,insertAttendeeReport,listAttendeeReports,searchVenueKnowledge,clearSession};
