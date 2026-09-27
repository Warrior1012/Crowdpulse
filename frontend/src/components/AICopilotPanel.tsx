import { motion } from 'framer-motion';
import type { AIAssessment } from '../models';

export default function AICopilotPanel({
  assessment,
}: {
  assessment: AIAssessment | null;
}) {
  if (!assessment) {
    return (
      <div className="rounded-lg border border-cp-border bg-cp-panel2 p-4 text-xs text-cp-muted">
        AI Copilot is warming up. Waiting for the first sensor reading.
      </div>
    );
  }

  // ------------------------------------------------------------
  // Risk
  // ------------------------------------------------------------

  const risk = Number.isFinite(Number(assessment.risk))
    ? Number(assessment.risk)
    : 0;

  const riskPct = Math.max(
    0,
    Math.min(100, Math.round(risk * 100))
  );

  const riskLevel = assessment.riskLevel || 'normal';

  const critical = riskLevel === 'critical';
  const elevated = riskLevel === 'elevated';

  // ------------------------------------------------------------
  // Features
  // ------------------------------------------------------------

  const features = assessment.features || {};

  const occupancy = Number.isFinite(
    Number(features.occupancy)
  )
    ? Number(features.occupancy)
    : 0;

  const inflowRate = Number.isFinite(
    Number(features.inflowRate)
  )
    ? Number(features.inflowRate)
    : 0;

  const outflowRate = Number.isFinite(
    Number(features.outflowRate)
  )
    ? Number(features.outflowRate)
    : 0;

  const panicReports = Number.isFinite(
    Number(features.panicReports)
  )
    ? Number(features.panicReports)
    : 0;

  // ------------------------------------------------------------
  // Copilot
  // ------------------------------------------------------------

  const copilot = assessment.copilot || {
    summary:
      'AI model reading is available. Continue monitoring the zone.',

    why: [
      'The AI reasoning layer did not return additional explanation.',
    ],

    recommendedActions: [
      'Continue normal monitoring.',
    ],

    provider: 'local',
  };

  const why = Array.isArray(copilot.why)
    ? copilot.why
    : [];

  const recommendedActions = Array.isArray(
    copilot.recommendedActions
  )
    ? copilot.recommendedActions
    : [];

  // ------------------------------------------------------------
  // Model
  // ------------------------------------------------------------

  const model = assessment.model || null;

  const modelName =
    model?.name || 'local-crowdpulse-model';

  const modelConfidence = Number.isFinite(
    Number(model?.confidence)
  )
    ? Number(model?.confidence)
    : 0.5;

  const safeModelConfidence = Math.max(
    0,
    Math.min(1, modelConfidence)
  );

  const provider =
    copilot.provider || 'local';

  const zoneName =
    assessment.zoneName ||
    assessment.zoneId ||
    'Unknown zone';

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------

  return (
    <motion.section
      layout
      initial={{
        opacity: 0,
        y: 8,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      className="rounded-lg border border-cp-border bg-cp-panel2 p-4 shadow-[0_0_30px_rgba(79,168,216,.06)]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.18em] text-cp-signal">
            AI Crowd Intelligence
          </div>

          <div className="mt-1 text-sm font-semibold">
            {zoneName}
          </div>
        </div>

        <div
          className={`font-mono text-lg font-bold ${
            critical
              ? 'text-cp-critical'
              : elevated
                ? 'text-cp-caution'
                : 'text-cp-safe'
          }`}
        >
          {riskPct}%
        </div>
      </div>

      {/* Risk bar */}
      <div className="mt-3 h-1.5 overflow-hidden rounded bg-black/30">
        <motion.div
          initial={{
            width: 0,
          }}
          animate={{
            width: `${riskPct}%`,
          }}
          className={`h-full ${
            critical
              ? 'bg-cp-critical'
              : elevated
                ? 'bg-cp-caution'
                : 'bg-cp-safe'
          }`}
        />
      </div>

      {/* AI Summary */}
      <p className="mt-3 text-xs leading-5 text-cp-text">
        {copilot.summary ||
          'No AI summary is available for this reading.'}
      </p>

      {/* Metrics */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-cp-muted">
        <Metric
          label="Occupancy"
          value={`${Math.round(
            occupancy * 100
          )}%`}
        />

        <Metric
          label="Inflow"
          value={`${formatRate(
            inflowRate
          )}/s`}
        />

        <Metric
          label="Outflow"
          value={`${formatRate(
            outflowRate
          )}/s`}
        />

        <Metric
          label="Panic reports"
          value={`${panicReports}`}
        />
      </div>

      {/* WHY */}
      <div className="mt-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-cp-muted">
          Why
        </div>

        <ul className="mt-1 space-y-1 text-[11px] text-cp-muted">
          {why.length > 0 ? (
            why.slice(0, 4).map((item, index) => (
              <li key={index}>
                • {String(item)}
              </li>
            ))
          ) : (
            <li>
              • No additional explanation was returned.
            </li>
          )}
        </ul>
      </div>

      {/* Recommended operator actions */}
      <div className="mt-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-cp-muted">
          Recommended operator actions
        </div>

        <ul className="mt-1 space-y-1 text-[11px] text-cp-text">
          {recommendedActions.length > 0 ? (
            recommendedActions
              .slice(0, 4)
              .map((item, index) => (
                <li
                  key={index}
                  className="rounded border border-cp-border px-2 py-1.5"
                >
                  {index + 1}. {String(item)}
                </li>
              ))
          ) : (
            <li className="rounded border border-cp-border px-2 py-1.5">
              Continue normal monitoring.
            </li>
          )}
        </ul>
      </div>

      {/* Model metadata */}
      <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-wider text-cp-dim">
        <span>
          Model: {modelName}
        </span>

        <span>
          Confidence:{' '}
          {Math.round(
            safeModelConfidence * 100
          )}
          %
        </span>

        <span>
          {provider}
        </span>

        {model?.source && (
          <span>
            Source: {model.source}
          </span>
        )}

        {model?.anomalyScore != null &&
          Number.isFinite(
            Number(model.anomalyScore)
          ) && (
            <span>
              Anomaly:{' '}
              {Math.round(
                Number(model.anomalyScore) * 100
              )}
              %
            </span>
          )}

        {model?.nextThresholdSeconds != null &&
          Number.isFinite(
            Number(model.nextThresholdSeconds)
          ) && (
            <span>
              Threshold ≈{' '}
              {Math.round(
                Number(
                  model.nextThresholdSeconds
                )
              )}
              s
            </span>
          )}
      </div>
    </motion.section>
  );
}

// ------------------------------------------------------------
// Metric component
// ------------------------------------------------------------

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border border-cp-border bg-cp-panel px-2 py-1.5">
      <div>
        {label}
      </div>

      <div className="mt-0.5 font-mono text-cp-text">
        {value}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Number formatting
// ------------------------------------------------------------

function formatRate(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(1);
}