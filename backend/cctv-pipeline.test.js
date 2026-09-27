const assert = require('node:assert/strict');
const { nearestCampForLocation, buildCameraInjurySummary, summarizeDetectionMetrics } = require('./cctv-pipeline');

const camp = nearestCampForLocation(26.9136, 75.7861);
assert.equal(camp.name, 'North Aid Camp');

const summary = buildCameraInjurySummary({
  personCount: 1,
  confidence: 0.92,
  posture: 'fallen',
  transcript: 'he is unconscious and bleeding badly',
  hasAudio: true,
  severityHint: 'critical'
});

assert.equal(summary.severity, 'Critical');
assert.match(summary.rationale, /unconscious|bleeding|critical/i);
assert.ok(summary.recommendedAction.length > 0);

const metrics = summarizeDetectionMetrics({
  injuredPeople: 2,
  normalPeople: 18,
  importantEvents: 5,
});
assert.equal(metrics.injuredPeople, 2);
assert.equal(metrics.normalPeople, 18);
assert.equal(metrics.importantEvents, 5);
assert.equal(Math.round(metrics.detectionRate), 8);
assert.equal(Math.round(metrics.importantEventsRate), 20);

console.log('cctv pipeline tests passed');
