import { useEffect, useRef, useState } from 'react';
import type { DemoAction, DemoPayload } from '../models';

interface Props {
  onAction: (action: DemoAction, payload?: DemoPayload) => void;
}

export default function DemoControls({ onAction }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('click', handler);

    return () => {
      document.removeEventListener('click', handler);
    };
  }, []);

  const fire = (action: DemoAction, payload?: DemoPayload) => {
    onAction(action, payload);
    setOpen(false);
  };

  const actionBtn =
    'mb-1.5 w-full rounded border border-cp-border bg-cp-panel2 px-2.5 py-1.5 text-left text-xs transition hover:-translate-y-px hover:border-cp-signal hover:bg-slate-800';

  const label =
    'mb-1.5 mt-2 text-[10px] tracking-wide text-cp-muted first:mt-0';

  return (
    <div className="relative" ref={ref}>
      <button
        className="web3-button rounded border border-cp-border bg-cp-panel2 px-3 py-1.5 text-xs font-medium hover:bg-slate-800"
        onClick={() => setOpen((o) => !o)}
      >
        Demo controls
      </button>

      {open && (
        <div
          className="
            web3-card
            fixed
            right-4
            top-[72px]
            z-[9999]
            w-72
            max-w-[calc(100vw-2rem)]
            max-h-[calc(100vh-88px)]
            overflow-y-auto
            rounded-md
            border
            border-cp-border
            bg-cp-panel2
            p-2.5
            shadow-2xl
            animate-panel-in
          "
        >
          <div className={label}>
            FLOW BOTTLENECK (core USP)
          </div>

          <button
            className={actionBtn}
            onClick={() =>
              fire('flow-surge', {
                fromZoneId: 'A',
                toZoneId: 'B',
              })
            }
          >
            Surge: Main Stage to Food Court
          </button>

          <button
            className={actionBtn}
            onClick={() =>
              fire('flow-surge', {
                fromZoneId: 'E',
                toZoneId: 'F',
              })
            }
          >
            Surge: East Lawn to Parking
          </button>

          <div className={label}>
            THRESHOLD ALERT
          </div>

          <button
            className={actionBtn}
            onClick={() =>
              fire('force-critical', {
                zoneId: 'A',
              })
            }
          >
            Force critical: Main Stage
          </button>

          <div className={label}>
            HUMAN CORROBORATION
          </div>

          <button
            className={actionBtn}
            onClick={() =>
              fire('panic-burst', {
                zoneId: 'B',
                count: 3,
              })
            }
          >
            Panic burst (x3): Food Court
          </button>

          <div className={label}>
            CASUALTY TRIAGE
          </div>

          <button
            className={actionBtn}
            onClick={() =>
              fire('add-casualty', {
                severity: 'random',
              })
            }
          >
            Add casualty (AI-randomize zone + severity)
          </button>

          <div className={label}>
            SESSION
          </div>

          <button
            className={actionBtn}
            onClick={() => fire('reset-demo')}
          >
            Reset demo state
          </button>

          <div className="mt-2 text-[11px] text-cp-dim">
            Red = critical, yellow = monitor, green = low-risk triage.
            AI chooses the zone and routes the dispatch.
          </div>
        </div>
      )}
    </div>
  );
}