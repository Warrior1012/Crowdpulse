import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getJSON } from '../api';
import type { AnalyticsData } from '../models';

export default function AnalyticsPanel({ active }: { active: boolean }) {
  const [data, setData] = useState<AnalyticsData | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getJSON<AnalyticsData>('/api/analytics'));
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [active, load]);

  async function exportCsv() {
    const incidents = await getJSON<Array<Record<string, unknown>>>('/api/incidents?limit=200').catch(() => []);
    const rows = [['timestamp', 'type', 'zone_id', 'zone_name', 'message']];
    incidents.slice().reverse().forEach((evt) => {
      rows.push([
        String(evt.ts || ''),
        String(evt.type || ''),
        String(evt.zoneId || ''),
        String(evt.zoneName || ''),
        String(evt.message || '').replace(/"/g, '""'),
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `crowdpulse-incident-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data) {
    return <div className="py-8 text-center text-xs text-cp-dim">Loading...</div>;
  }

  const maxZone = Math.max(1, ...data.zones.map((z) => z.count));
  const typeEntries = Object.entries(data.byType || {}) as [string, number][];
  const maxType = Math.max(1, ...typeEntries.map(([, value]) => value));
  const detection = data.detectionMetrics || {
    injuredPeople: 0,
    normalPeople: 0,
    importantEvents: 0,
    totalDetectedPeople: 0,
    detectionRate: 0,
    importantEventsRate: 0,
  };

  const detectionEntries = [
    ['Injured people', detection.injuredPeople],
    ['Normal people', detection.normalPeople],
    ['Important events', detection.importantEvents],
  ] as [string, number][];

  const metricCards = [
    [data.totalIncidents, 'Total incidents logged'],
    [data.dispatchCount, 'Responders dispatched'],
    [data.avgResolveSeconds != null ? `${data.avgResolveSeconds}s` : '-', 'Avg time to stabilize'],
    [data.peakZone?.name || '-', 'Highest-alert zone'],
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="mb-4 grid grid-cols-2 gap-2.5">
        {metricCards.map(([value, label], index) => (
          <motion.div
            key={String(label)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06 }}
            className="web3-card rounded-md border border-cp-border bg-cp-panel2 p-3"
          >
            <div className="font-mono text-[22px] font-bold">{value}</div>
            <div className="mt-0.5 text-[11px] text-cp-muted">{label}</div>
          </motion.div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <div className="web3-card rounded-md border border-cp-border bg-cp-panel2 p-3">
          <div className="text-[11px] font-semibold tracking-wide text-cp-muted">YOLO detection rate</div>
          <div className="mt-2 font-mono text-[22px] font-bold">{Math.round(detection.detectionRate)}%</div>
          <div className="mt-1 text-[11px] text-cp-muted">
            {detection.injuredPeople} injured / {detection.normalPeople} normal
          </div>
        </div>

        <div className="web3-card rounded-md border border-cp-border bg-cp-panel2 p-3">
          <div className="text-[11px] font-semibold tracking-wide text-cp-muted">Important event alerts</div>
          <div className="mt-2 font-mono text-[22px] font-bold">{detection.importantEvents}</div>
          <div className="mt-1 text-[11px] text-cp-muted">
            {Math.round(detection.importantEventsRate)}% of the detected crowd stream
          </div>
        </div>
      </div>

      <BarSection
        title="YOLO detection categories"
        entries={detectionEntries}
        max={Math.max(1, ...detectionEntries.map(([, count]) => count))}
        empty="No camera detections yet."
      />

      <BarSection
        title="Zone activity"
        entries={data.zones.map((z) => [z.name, z.count] as [string, number])}
        max={maxZone}
        empty="No zone activity yet."
      />

      <BarSection title="Incident type mix" entries={typeEntries} max={maxType} empty="No incidents logged yet." />

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void exportCsv()}
          className="rounded border border-cp-border bg-cp-panel px-2.5 py-1.5 text-[11px] text-cp-muted transition hover:border-cp-signal hover:text-cp-text"
        >
          Export incident log
        </button>
      </div>
    </motion.div>
  );
}

function BarSection({
  title,
  entries,
  max,
  empty = 'No data yet.',
}: {
  title: string;
  entries: [string, number][];
  max: number;
  empty?: string;
}) {
  return (
    <>
      <div className="mb-2.5 mt-4 text-[11px] font-semibold tracking-wide text-cp-muted">{title}</div>
      {entries.length ? (
        entries.map(([name, count], index) => (
          <div key={name} className="mb-2 flex items-center gap-2.5">
            <div className="w-[110px] shrink-0 text-xs capitalize text-cp-muted">{name}</div>
            <div className="h-2 flex-1 overflow-hidden rounded bg-cp-panel">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.round((count / max) * 100)}%` }}
                transition={{ duration: 0.5, delay: index * 0.04 }}
                className="h-full rounded bg-cp-signal"
              />
            </div>
            <div className="w-[22px] text-right font-mono text-[11px] text-cp-muted">{count}</div>
          </div>
        ))
      ) : (
        <div className="py-6 text-center text-xs text-cp-dim">{empty}</div>
      )}
    </>
  );
}
