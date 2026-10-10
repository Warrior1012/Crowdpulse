# CrowdPulse Production Readiness Audit

Audit date: 2026-10-10
Scope: Render deployment, PostgreSQL startup, attendee incident reporting, authentication, and responsive UI.
Status: PostgreSQL connection is confirmed by the latest Render application log. This is not a claim that every production flow has passed end-to-end testing.

## Confirmed deployment state

- Render service: `crowdpulse`
- Public URL: https://crowdpulse-5z8o.onrender.com
- Database: Render PostgreSQL `crowdpulse-db`
- Latest checked startup log: `PostgreSQL connected`
- Database environment variables configured on Render: `DATABASE_URL` and `DB_SSL=true`

## Findings from the live UI screenshots

1. The dashboard displays a Camera Zone occupancy of 200% with a configured capacity of 1. This may be a deliberate demo/sensor-overflow condition, but it must be visibly identified as demo/simulated data when no real camera reading is available. Never present simulated counts as verified live attendance.
2. The AI panel states 100% confidence and refers to a trained model while the displayed crowd-increase signal is 0%. Confirm these labels come from actual model output and calibrated confidence, not constants or fallback defaults. Show model unavailable/stale when inference is unavailable.
3. The incident report form is narrow and its lower controls/footer appear crowded/overlapped in the supplied screenshot. Verify responsive layout at 320px, 375px, 768px, and desktop widths. The form should scroll within the panel/page without the footer covering the submit button or privacy notice.
4. Photo, audio, voice transcription, manual transcript, location, and incident submission are present in the UI. Each must be tested end-to-end, including permission denial, unsupported speech-recognition browsers, upload errors, and server failures.

## Production blockers / required checks

### Secrets and authentication

- Rotate the PostgreSQL password because it was shared in a chat; update Render's `DATABASE_URL` with the rotated credential.
- Set a unique random `JWT_SECRET` in Render. The code currently has a development fallback; production must never rely on it.
- Set unique `ADMIN_PASSWORD`, `OPERATOR_PASSWORD`, `SENSOR_PASSWORD`, `ATTENDEE_PASSWORD`, and `ADMIN_KEY` values in Render. Do not use the documented demo defaults in a public deployment.
- Confirm login fails closed if the database is unavailable. Avoid allowing demo-user fallback authentication in production.
- Restrict CORS and Socket.IO origins to the deployed frontend origin(s); avoid wildcard origins for production.
- Ensure secrets are never committed to the repository or included in logs.

### Incident report flow

- Validate latitude (-90..90), longitude (-180..180), text lengths, allowed image/audio MIME types, and file-size limits on the server, not only in the browser.
- Use a request size limit suitable for compressed attachments; avoid unbounded base64 data URLs and return a clear 413 response for oversized uploads.
- Test report submission with description only, transcript only, photo, audio, and combined attachments. Confirm that successful submission returns a report ID and that the record remains after a service restart.
- A database write failure must be visible to the caller. Do not return a successful/persisted status when the report exists only in memory.
- Protect attendee contact details, voice notes, images, and location data; avoid logging their contents.

### Runtime and data integrity

- Verify startup schema creation and the `users`, `attendee_reports`, `incidents`, `zone_readings`, `attendees`, `panic_reports`, and `ai_predictions` tables.
- Verify the API health endpoint, login, authenticated API access, socket authentication, zone updates, incident creation, analytics, and logout.
- Test database restart/reconnect and failed-database behavior. Do not silently describe in-memory fallback data as durable.
- Render's free PostgreSQL instance currently has an expiry date in its dashboard. Upgrade or arrange a migration before expiry if data must be retained.
- Configure a backup/export and restoration procedure before real operational use.
- The current server uses in-memory state and a local JSONL incident log for some flows. These are not durable across instance replacement/redeploy and do not provide multi-instance consistency. Move authoritative state to PostgreSQL and use shared storage/pub-sub before scaling horizontally.

## Smoke-test checklist

- [ ] Homepage loads over HTTPS.
- [ ] Valid login succeeds; invalid credentials fail.
- [ ] Protected API and Socket.IO reject missing/expired tokens.
- [ ] PostgreSQL health check passes and tables exist.
- [ ] Zone reading and incident survive a service restart.
- [ ] Incident form works with text only and with each optional attachment.
- [ ] Oversized/invalid files are rejected with a clear message.
- [ ] GPS denied/unsupported and speech recognition unsupported paths remain usable.
- [ ] Failed database write is shown as a failure, not success.
- [ ] Dashboard labels demo/simulated data and stale/unavailable AI output accurately.
- [ ] Responsive form is usable at mobile, tablet, and desktop widths with no footer overlap.
- [ ] Secrets rotated and production auth/CORS settings reviewed.

## Important

CrowdPulse is a prototype. Crowd-risk classifications and AI suggestions are assistive signals only and must not replace trained human operators, emergency services, or validated crowd-safety procedures. Do not use the current prototype as the sole basis for real-world emergency decisions.
