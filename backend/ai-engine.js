const http = require('http');
const https = require('https');
const { ZONES } = require('./config');

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';

const AI_SERVICE_TIMEOUT_MS = 10000;

function requestJson(
  urlString,
  body,
  timeoutMs = AI_SERVICE_TIMEOUT_MS
) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);

    const client =
      url.protocol === 'https:' ? https : http;

    const req = client.request(
      {
        hostname: url.hostname,
        port:
          url.port ||
          (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Connection: 'close',
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';

        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (
            res.statusCode < 200 ||
            res.statusCode >= 300
          ) {
            return reject(
              new Error(
                `AI service returned ${res.statusCode}: ${data.slice(
                  0,
                  500
                )}`
              )
            );
          }

          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(
              new Error(
                `Invalid JSON from AI service: ${data.slice(
                  0,
                  500
                )}`
              )
            );
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(
        new Error(
          `AI service request timed out after ${timeoutMs}ms`
        )
      );
    });

    req.on('error', reject);

    req.write(payload);
    req.end();
  });
}

function clamp(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(
    Math.max(number, min),
    max
  );
}

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((item) => {
      if (
        typeof item === 'number' ||
        typeof item === 'string'
      ) {
        return Number(item);
      }

      if (
        item &&
        typeof item === 'object' &&
        'count' in item
      ) {
        return Number(item.count);
      }

      return NaN;
    })
    .filter(Number.isFinite);
}

function normalizeIncidentCount(
  incidentCount,
  incidents
) {
  if (Number.isFinite(Number(incidentCount))) {
    return Math.max(0, Number(incidentCount));
  }

  if (Array.isArray(incidents)) {
    return incidents.length;
  }

  return 0;
}

/*
|--------------------------------------------------------------------------
| Local fallback risk calculation
|--------------------------------------------------------------------------
*/

function calculateFallbackRisk({
  currentCount,
  history,
  panicCount = 0,
  incidentCount = 0,
}) {
  const counts = normalizeHistory(history);

  if (!counts.length) {
    return 0;
  }

  const recent = counts.slice(-6);

  const average =
    recent.reduce(
      (sum, value) => sum + value,
      0
    ) / recent.length;

  const previous =
    recent.length > 1
      ? recent
          .slice(0, -1)
          .reduce(
            (sum, value) => sum + value,
            0
          ) /
        (recent.length - 1)
      : average;

  const current =
    Number(currentCount) || 0;

  const growth =
    previous > 0
      ? Math.max(
          0,
          (current - previous) / previous
        )
      : current > 0
        ? 1
        : 0;

  const densitySignal =
    average > 0
      ? Math.max(
          0,
          current / average - 1
        )
      : 0;

  const panicSignal = Math.min(
    1,
    Number(panicCount || 0) / 3
  );

  const incidentSignal = Math.min(
    1,
    Number(incidentCount || 0) / 3
  );

  const score =
    growth * 0.45 +
    densitySignal * 0.35 +
    panicSignal * 0.1 +
    incidentSignal * 0.1;

  return clamp(score, 0, 1);
}

/*
|--------------------------------------------------------------------------
| Fallback assessment
|--------------------------------------------------------------------------
*/

function buildFallbackAssessment({
  zoneId,
  currentCount,
  history,
  panicCount = 0,
  incidentCount = 0,
}) {
  const zone = ZONES.find(
    (entry) => entry.id === zoneId
  );

  const count =
    Number(currentCount) || 0;

  const capacity =
    zone && Number(zone.cap)
      ? Number(zone.cap)
      : Math.max(1, count);

  const historyValues =
    normalizeHistory(history);

  const previous =
    historyValues.length >= 2
      ? historyValues[
          historyValues.length - 2
        ]
      : count;

  const delta =
    count - previous;

  const intervalSeconds = 2;

  const inflowRate =
    delta > 0
      ? delta / intervalSeconds
      : 0;

  const outflowRate =
    delta < 0
      ? Math.abs(delta) / intervalSeconds
      : 0;

  const occupancy =
    capacity > 0
      ? count / capacity
      : 0;

  const risk =
    calculateFallbackRisk({
      currentCount: count,
      history: historyValues,
      panicCount,
      incidentCount,
    });

  let riskLevel = 'normal';

  if (risk >= 0.75) {
    riskLevel = 'critical';
  } else if (risk >= 0.45) {
    riskLevel = 'elevated';
  }

  const why = [];
  const recommendedActions = [];

  if (occupancy >= 0.9) {
    why.push(
      `occupancy is ${Math.round(
        occupancy * 100
      )}% of configured capacity`
    );

    recommendedActions.push(
      'Monitor incoming flow closely and prepare to meter entry if required.'
    );
  } else if (occupancy >= 0.7) {
    why.push(
      `occupancy has reached ${Math.round(
        occupancy * 100
      )}% of configured capacity`
    );

    recommendedActions.push(
      'Increase monitoring of entry and exit flow.'
    );
  }

  if (inflowRate > outflowRate + 1) {
    why.push(
      `inflow is exceeding outflow by ${(
        inflowRate - outflowRate
      ).toFixed(1)} people/s`
    );

    recommendedActions.push(
      'Monitor the nearest incoming flow boundary.'
    );
  }

  if (Number(panicCount) > 0) {
    why.push(
      `${Number(
        panicCount
      )} panic report(s) are associated with this zone`
    );

    recommendedActions.push(
      'Verify the reported area and keep nearby exit routes clear.'
    );
  }

  if (Number(incidentCount) > 0) {
    why.push(
      `${Number(
        incidentCount
      )} recent incident(s) are associated with this zone`
    );

    recommendedActions.push(
      'Review recent incidents before taking operational action.'
    );
  }

  if (!why.length) {
    why.push(
      'No high-severity crowd signal is currently dominant.'
    );
  }

  if (!recommendedActions.length) {
    recommendedActions.push(
      'Continue normal monitoring of the zone.'
    );
  }

  let summary;

  if (riskLevel === 'critical') {
    summary =
      'The local fallback assessment shows a high increase signal. Operator review is recommended.';
  } else if (riskLevel === 'elevated') {
    summary =
      'The local fallback assessment shows an elevated increase signal. Continue close monitoring.';
  } else {
    summary =
      'The current crowd signals are within the observed normal range.';
  }

  return {
    zoneId,

    zoneName:
      zone?.name || zoneId,

    ts: new Date().toISOString(),

    risk,

    riskLevel,

    surgeScore: risk,

    anomalyScore: 0,

    modelConfidence: 0,

    model: {
      name: 'Local fallback risk model',
      version: 'fallback-1.0',
      source: 'local-fallback',
      provider: 'local',
      confidence: 0,
      anomalyScore: 0,
      nextThresholdSeconds: null,
    },

    features: {
      count,
      capacity,
      occupancy,

      inflowRate: Number(
        inflowRate.toFixed(2)
      ),

      outflowRate: Number(
        outflowRate.toFixed(2)
      ),

      acceleration: 0,

      panicReports:
        Number(panicCount) || 0,

      incidentCount:
        Number(incidentCount) || 0,

      historyPoints:
        historyValues.length,
    },

    copilot: {
      summary,

      why: why.slice(0, 4),

      recommendedActions:
        recommendedActions.slice(0, 4),

      provider: 'local-fallback',

      confidence: 0,

      caveats: [
        'The AI service was unavailable for this reading.',
      ],
    },

    source: 'local-fallback',

    available: false,
  };
}

/*
|--------------------------------------------------------------------------
| AI service
|--------------------------------------------------------------------------
*/

async function callAiService(payload) {
  const response = await requestJson(
    `${AI_SERVICE_URL.replace(/\/$/, '')}/predict`,
    payload,
    AI_SERVICE_TIMEOUT_MS
  );

  return response;
}

/*
|--------------------------------------------------------------------------
| Main AI assessment
|--------------------------------------------------------------------------
|
| Supports both:
|
| Old contract:
|   currentCount
|   panicCount
|   incidentCount
|
| Current backend contract:
|   count
|   panicReports
|   incidents
|   intervalSeconds
|   source
|
|--------------------------------------------------------------------------
*/

async function assessZone({
  zoneId,

  currentCount,
  count,

  history = [],

  panicCount = 0,
  panicReports,

  incidentCount,
  incidents = [],

  intervalSeconds = 2,

  source = 'backend-local-ai',
}) {
  const zone = ZONES.find(
    (entry) => entry.id === zoneId
  );

  /*
   * Support both old and current names.
   */
  const actualCount =
    Number.isFinite(Number(count))
      ? Number(count)
      : Number(currentCount) || 0;

  const actualPanicCount =
    Number.isFinite(Number(panicReports))
      ? Number(panicReports)
      : Number(panicCount) || 0;

  const actualIncidentCount =
    normalizeIncidentCount(
      incidentCount,
      incidents
    );

  const historyValues =
    normalizeHistory(history);

  const capacity =
    zone && Number(zone.cap)
      ? Number(zone.cap)
      : Math.max(
          1,
          actualCount || 1
        );

  const interval =
    Number(intervalSeconds) > 0
      ? Number(intervalSeconds)
      : 2;

  const previous =
    historyValues.length >= 2
      ? historyValues[
          historyValues.length - 2
        ]
      : actualCount;

  const delta =
    actualCount - previous;

  const inflowRate =
    delta > 0
      ? delta / interval
      : 0;

  const outflowRate =
    delta < 0
      ? Math.abs(delta) / interval
      : 0;

  const acceleration =
    historyValues.length >= 3
      ? (
          historyValues[
            historyValues.length - 1
          ] -
          2 *
            historyValues[
              historyValues.length - 2
            ] +
          historyValues[
            historyValues.length - 3
          ]
        ) /
        interval
      : 0;

  const occupancy =
    capacity > 0
      ? actualCount / capacity
      : 0;

  /*
   * Payload expected by ai-service/app.py
   */
  const payload = {
    zoneId,

    count: actualCount,

    capacity,

    occupancy,

    inflowRate,

    outflowRate,

    acceleration,

    panicReports:
      actualPanicCount,

    intervalSeconds:
      interval,

    anomalyHint: 0,

    source,

    history:
      historyValues,

    weather_condition:
      'unknown',

    incidents:
      actualIncidentCount > 0
        ? 'incident'
        : 'no_incident',

    temperature: 0,
  };

  try {
    const aiResponse =
      await callAiService(payload);

    /*
     * AI service may return:
     * available: false
     */
    if (
      aiResponse &&
      aiResponse.available === false
    ) {
      throw new Error(
        aiResponse.error ||
          'AI service returned unavailable'
      );
    }

    const risk = clamp(
      aiResponse?.risk,
      0,
      1
    );

    let riskLevel = 'normal';

    if (risk >= 0.75) {
      riskLevel = 'critical';
    } else if (risk >= 0.45) {
      riskLevel = 'elevated';
    }

    const surgeScore =
      clamp(
        aiResponse?.surgeScore ??
          aiResponse?.risk,
        0,
        1
      );

    const anomalyScore =
      clamp(
        aiResponse?.anomalyScore,
        0,
        1
      );

    const modelConfidence =
      clamp(
        aiResponse?.modelConfidence,
        0,
        1
      );

    /*
     * ------------------------------------------------------------
     * AI COPILOT REASONING
     * ------------------------------------------------------------
     */

    const why = [];

    const recommendedActions = [];

    const occupancyPct =
      Math.round(
        occupancy * 100
      );

    const surgePct =
      Math.round(
        surgeScore * 100
      );

    const anomalyPct =
      Math.round(
        anomalyScore * 100
      );

    /*
     * Occupancy
     */
    if (occupancy >= 0.9) {
      why.push(
        `occupancy is ${occupancyPct}% of configured capacity`
      );

      recommendedActions.push(
        'Monitor incoming flow closely and prepare to meter entry if required.'
      );
    } else if (occupancy >= 0.7) {
      why.push(
        `occupancy has reached ${occupancyPct}% of configured capacity`
      );

      recommendedActions.push(
        'Increase monitoring of entry and exit flow.'
      );
    }

    /*
     * Trained surge model
     */
    if (surgeScore >= 0.75) {
      why.push(
        `the trained crowd-surge model is showing a ${surgePct}% surge signal`
      );

      recommendedActions.push(
        'Verify the live camera view and nearby crowd movement.'
      );
    } else if (surgeScore >= 0.45) {
      why.push(
        `the trained crowd-surge model shows an elevated ${surgePct}% signal`
      );

      recommendedActions.push(
        'Continue close monitoring for changes in crowd flow.'
      );
    } else {
      why.push(
        `the trained crowd-surge model currently shows a low ${surgePct}% signal`
      );
    }

    /*
     * Anomaly model
     */
    if (anomalyScore >= 0.7) {
      why.push(
        `the anomaly model detected an unusual movement pattern (${anomalyPct}%)`
      );

      recommendedActions.push(
        'Have an operator verify the camera view and surrounding zone activity.'
      );
    }

    /*
     * Flow
     */
    if (
      inflowRate >
      outflowRate + 1
    ) {
      why.push(
        `inflow is exceeding outflow by ${(inflowRate - outflowRate).toFixed(
          1
        )} people/s`
      );

      recommendedActions.push(
        'Monitor the nearest incoming flow boundary.'
      );
    }

    /*
     * Panic
     */
    if (
      actualPanicCount > 0
    ) {
      why.push(
        `${actualPanicCount} panic report(s) are currently associated with this zone`
      );

      recommendedActions.push(
        'Verify the reported area and keep nearby exit routes clear.'
      );
    }

    /*
     * Incidents
     */
    if (
      actualIncidentCount > 0
    ) {
      why.push(
        `${actualIncidentCount} recent incident(s) are associated with this zone`
      );

      recommendedActions.push(
        'Review recent incidents before taking operational action.'
      );
    }

    /*
     * Default reasoning
     */
    if (!why.length) {
      why.push(
        'No high-severity crowd signal is currently dominant.'
      );
    }

    if (
      !recommendedActions.length
    ) {
      recommendedActions.push(
        'Continue normal monitoring of the zone.'
      );
    }

    /*
     * Summary
     */
    let summary;

    if (
      riskLevel === 'critical'
    ) {
      summary =
        'The trained crowd-surge model is showing a high increase signal. Operator review is recommended.';
    } else if (
      riskLevel === 'elevated'
    ) {
      summary =
        'The trained crowd-surge model is showing an elevated increase signal. Continue close monitoring.';
    } else {
      summary =
        'The trained crowd-surge model currently shows a low crowd-increase signal.';
    }

    /*
     * Final dashboard-compatible response
     */
    return {
      ...aiResponse,

      zoneId,

      zoneName:
        zone?.name || zoneId,

      ts:
        new Date().toISOString(),

      risk,

      riskLevel,

      surgeScore,

      anomalyScore,

      modelConfidence,

      features: {
        count:
          actualCount,

        capacity,

        occupancy,

        inflowRate:
          Number(
            inflowRate.toFixed(2)
          ),

        outflowRate:
          Number(
            outflowRate.toFixed(2)
          ),

        acceleration:
          Number(
            acceleration.toFixed(3)
          ),

        panicReports:
          actualPanicCount,

        incidentCount:
          actualIncidentCount,

        historyPoints:
          historyValues.length,
      },

      copilot: {
        summary,

        why:
          why.slice(0, 4),

        recommendedActions:
          recommendedActions.slice(0, 4),

        provider:
          'local-ai',

        confidence:
          modelConfidence,

        caveats: [
          'The trained model forecasts rapid next-hour crowd increase from Würzburg pedestrian-flow data.',
          'This signal is not an emergency or stampede probability.',
          'Venue-specific validation is required.',
        ],
      },

      model: {
        name:
          aiResponse?.modelVersion ||
          'WuerzburgNextHourSurge-XGBoost-v2.1',

        version:
          aiResponse?.modelVersion ||
          '2.1.0',

        source:
          aiResponse?.source ||
          'real-trained-wuerzburg-dynamics',

        provider:
          'local-ai-service',

        confidence:
          modelConfidence,

        anomalyScore,

        nextThresholdSeconds:
          aiResponse?.nextThresholdSeconds ??
          null,
      },

      source:
        aiResponse?.source ||
        'real-trained-wuerzburg-dynamics',

      available: true,
    };
  } catch (error) {
    console.warn(
      `[AI] AI service unavailable for zone ${zoneId}: ${error.message}`
    );

    return buildFallbackAssessment({
      zoneId,

      currentCount:
        actualCount,

      history:
        historyValues,

      panicCount:
        actualPanicCount,

      incidentCount:
        actualIncidentCount,
    });
  }
}

module.exports = {
  assessZone,
  calculateFallbackRisk,
  buildFallbackAssessment,
};


