import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TopBar from './components/TopBar';
import type { RedisStatus } from './components/TopBar';
import ZoneList from './components/ZoneList';
import MapView from './components/MapView';
import OpsFeed from './components/OpsFeed';
import AttendeePanel from './components/AttendeePanel';
import AnalyticsPanel from './components/AnalyticsPanel';
import AICopilotPanel from './components/AICopilotPanel';
import { getJSON, postJSON, createSocket, getToken, clearToken } from './api';
import LoginScreen from './components/LoginScreen';
import type { AIAssessment, AdminMapSnapshot, AttendeeMarker, CasualtyMarker, DemoAction, DemoPayload, Incident, PanicPing, Responder, UploadedReportMarker, Zone, ZoneUpdatePayload, VenueCenter } from './models';
import type { Socket } from 'socket.io-client';
interface PanicEvent extends Incident { lat?: number; lng?: number }
interface AttendeeEvent { lat?: number; lng?: number }

const MAX_FEED = 30;
const MAX_PANIC_MARKERS = 20;
type AppTab = 'feed' | 'attendee' | 'analytics';
const TABS: Array<[AppTab, string]> = [['feed', 'Ops feed'], ['attendee', 'Attendee app'], ['analytics', 'Analytics']];

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [venueCenter, setVenueCenter] = useState<[number, number]>([26.912, 75.787]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [panicPings, setPanicPings] = useState<PanicPing[]>([]);
  const [casualties, setCasualties] = useState<CasualtyMarker[]>([]);
  const [uploadedReports, setUploadedReports] = useState<UploadedReportMarker[]>([]);
  const [adminMap, setAdminMap] = useState<AdminMapSnapshot | null>(null);
  const [selectedCasualty, setSelectedCasualty] = useState<CasualtyMarker | null>(null);
  const [connected, setConnected] = useState(false);
  const [offline, setOffline] = useState(false);
  const [backendDown, setBackendDown] = useState(false);
  const [databaseConnected, setDatabaseConnected] = useState(false);
  const [redisStatus, setRedisStatus] = useState<RedisStatus>('unknown');
  const [aiAssessment, setAiAssessment] = useState<AIAssessment | null>(null);
  const [tab, setTab] = useState<AppTab>('feed');
  const [lat, setLat] = useState<string>('26.9130');
  const [lng, setLng] = useState<string>('75.7870');
  const [attendeeMarker, setAttendeeMarker] = useState<AttendeeMarker | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const queuedEventsRef = useRef<Record<string, unknown>[]>([]);
  const panicTimeoutsRef = useRef<Map<string, number>>(new Map());
  const offlineRef = useRef(false);
  const responderTimeoutsRef = useRef<Map<string, number>>(new Map());

  const pushIncident = useCallback((evt: Incident) => {
    if (!evt) return;
    setIncidents(prev => [evt, ...prev].slice(0, MAX_FEED));
  }, []);

  const applyZoneUpdate = useCallback((payload: ZoneUpdatePayload) => {
    if (!payload?.zoneId) return;
    setZones(prev => {
      const idx = prev.findIndex(z => z.id === payload.zoneId);
      const previous = idx >= 0 ? prev[idx] : null;
      if (!previous) return prev;
      const previousHistory = previous.history || [];
      const history = [...previousHistory, payload.count].slice(-6);
      const merged: Zone = {
        ...previous,
        id: payload.zoneId,
        name: payload.name,
        cap: payload.cap,
        count: payload.count,
        pct: payload.pct,
        status: payload.status,
        source: payload.source,
        history,
        bounds: previous?.bounds,
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = merged;
        return next;
      }
      return [...prev, merged];
    });
  }, []);

  const loadInitial = useCallback(async () => {
    const [venue, zoneData, incidentData, responderData, health, mapData, reportsData] = await Promise.all([
      getJSON<{ center?: VenueCenter }>('/api/venue'),
      getJSON<Zone[]>('/api/zones'),
      getJSON<Incident[]>('/api/incidents?limit=15'),
      getJSON<Responder[]>('/api/responders'),
      getJSON<{ database?: string; redis?: RedisStatus }>('/api/health'),
      getJSON<AdminMapSnapshot>('/api/admin-map').catch(() => null),
      getJSON<UploadedReportMarker[]>('/api/attendee-reports').catch(() => []),
    ]);

    if (venue?.center && Number.isFinite(venue.center.lat) && Number.isFinite(venue.center.lng)) {
      setVenueCenter([venue.center.lat, venue.center.lng]);
    }
    setZones(Array.isArray(zoneData) ? zoneData : []);
    setResponders(Array.isArray(responderData) ? responderData : []);
    setIncidents(Array.isArray(incidentData) ? incidentData.slice(0, MAX_FEED) : []);
    setAdminMap(mapData ?? null);
    if (Array.isArray(mapData?.casualties)) setCasualties(mapData.casualties);
    setUploadedReports(Array.isArray(reportsData) ? reportsData : (mapData?.uploadedPeople ?? []));
    setDatabaseConnected(health?.database === 'connected');
    setRedisStatus(health?.redis ?? 'unknown');
    try { const latestAI = await getJSON<AIAssessment[]>('/api/ai/latest'); if (latestAI?.length) setAiAssessment(latestAI[0]); } catch (err) { console.warn('AI latest unavailable:', err); }
    setBackendDown(false);
  }, []);

  const flashResponder = useCallback((responderId: string | undefined, status: Responder['status'] = 'dispatched') => {
    if (!responderId) return;
    setResponders(prev => prev.map(r => r.id === responderId ? { ...r, status } : r));
  }, []);

  const queueOfflineEvent = useCallback((event: Record<string, unknown>) => {
    queuedEventsRef.current.push(event);
  }, []);

  const flushOfflineQueue = useCallback(async () => {
    const events = queuedEventsRef.current;
    if (!events.length) return;
    try {
      await postJSON('/api/sync', { events }, true);
      queuedEventsRef.current = [];
      pushIncident({
        id: `SYNC-${Date.now()}`,
        type: 'sync',
        ts: new Date().toISOString(),
        message: `${events.length} offline event${events.length === 1 ? '' : 's'} synced successfully.`,
      });
    } catch (err) {
      console.error('Offline queue sync failed:', err);
    }
  }, [pushIncident]);

  const handleAttendeeLocationUpdate = useCallback((newLat: number, newLng: number) => {
    if (!Number.isFinite(newLat) || !Number.isFinite(newLng)) return;
    setLat(String(newLat));
    setLng(String(newLng));
    setAttendeeMarker({ lat: newLat, lng: newLng });
  }, []);

  const handleMapClick = useCallback((newLat: number, newLng: number) => {
    handleAttendeeLocationUpdate(newLat, newLng);
    const nearest = casualties.reduce<CasualtyMarker | null>((best, marker) => {
      const dist = Math.hypot(newLat - marker.lat, newLng - marker.lng) * 111000;
      if (!best || dist < Math.hypot(newLat - best.lat, newLng - best.lng) * 111000) return marker;
      return best;
    }, null);
    if (nearest && Math.hypot(newLat - nearest.lat, newLng - nearest.lng) * 111000 < 45) {
      setSelectedCasualty(nearest);
    }
  }, [casualties, handleAttendeeLocationUpdate]);

  const handleToggleOffline = useCallback(() => {
    setOffline(prev => {
      const next = !prev;
      offlineRef.current = next;
      if (!next) {
        void flushOfflineQueue();
        void loadInitial().catch(err => console.error('Refresh after reconnect failed:', err));
      }
      return next;
    });
  }, [flushOfflineQueue, loadInitial]);

  const handleDemoAction = useCallback(async (action: DemoAction, payload: DemoPayload = {}) => {
    try {
      if (action === 'flow-surge') {
        await postJSON('/api/simulate-flow-surge', payload, true);
      } else if (action === 'force-critical') {
        await postJSON('/api/simulate-critical', payload, true);
      } else if (action === 'panic-burst') {
        await postJSON('/api/simulate-panic-burst', payload, true);
      } else if (action === 'add-casualty') {
        await postJSON('/api/simulate-casualty', payload || {}, true);
      } else if (action === 'reset-demo') {
        await postJSON('/api/reset-demo', {}, true);
        setPanicPings([]);
        setCasualties([]);
        setSelectedCasualty(null);
        setIncidents([]);
        await loadInitial();
      }
    } catch (err) {
      console.error(`Demo action failed: ${action}`, err);
    }
  }, [loadInitial]);

  useEffect(() => {
    let active = true;
    void loadInitial().catch(err => {
      if (active) {
        console.error('Initial load failed:', err);
        setBackendDown(true);
        setDatabaseConnected(false);
      }
    });

    const socket = createSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      setBackendDown(false);
      if (!offlineRef.current) void flushOfflineQueue();
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: Error) => {
      console.error('Socket connection error:', err?.message || err);
      setBackendDown(true);
    };
    const onDispatch = (evt: Incident) => {
      pushIncident(evt);
      const responderId = typeof evt?.responderId === 'string' ? evt.responderId : undefined;
      flashResponder(responderId, 'dispatched');
      if (responderId) {
        const existing = responderTimeoutsRef.current.get(responderId);
        if (existing) window.clearTimeout(existing);
        const timeout = window.setTimeout(() => {
          flashResponder(responderId, 'available');
          responderTimeoutsRef.current.delete(responderId);
        }, 25000);
        responderTimeoutsRef.current.set(responderId, timeout);
      }
    };
    const onPanic = (evt: PanicEvent) => {
      pushIncident(evt);
      if (typeof evt?.lat === 'number' && typeof evt?.lng === 'number') {
        const marker = { id: evt.id || `panic-${Date.now()}`, lat: evt.lat, lng: evt.lng };
        setPanicPings(prev => [...prev, marker].slice(-MAX_PANIC_MARKERS));
        const timeout = window.setTimeout(() => {
          setPanicPings(prev => prev.filter(p => p.id !== marker.id));
          panicTimeoutsRef.current.delete(marker.id);
        }, 12000);
        panicTimeoutsRef.current.set(marker.id, timeout);
      }
    };
    const onAttendeeUpdate = (evt: AttendeeEvent) => {
      if (typeof evt?.lat === 'number' && typeof evt?.lng === 'number') {
        setAttendeeMarker(prev => prev || { lat: evt.lat as number, lng: evt.lng as number });
      }
    };
    const onAiAssessment = (evt: AIAssessment) => { if (evt?.zoneId) setAiAssessment(evt); };
    const onCasualty = (evt: CasualtyMarker) => {
      setCasualties(prev => {
        const withoutOld = prev.filter(item => item.id !== evt.id);
        return [...withoutOld, evt].slice(-8);
      });
      setSelectedCasualty(prev => prev && prev.id === evt.id ? evt : prev);
      pushIncident({
        id: evt.id,
        type: 'casualty',
        ts: evt.ts || new Date().toISOString(),
        zoneId: evt.zoneId,
        zoneName: evt.zoneName,
        message: `${evt.zoneName} casualty alert: ${evt.summary} (${evt.level})`,
      });
    };
    const onDemoReset = () => {
      setIncidents([]);
      setPanicPings([]);
      setCasualties([]);
      setSelectedCasualty(null);
      void loadInitial().catch(err => console.error('Reset refresh failed:', err));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('zoneUpdate', applyZoneUpdate);
    socket.on('alert', pushIncident);
    socket.on('dispatch', onDispatch);
    socket.on('preemptive_dispatch', onDispatch);
    socket.on('resolved', pushIncident);
    socket.on('predictive', pushIncident);
    socket.on('no_unit', pushIncident);
    socket.on('bottleneck', pushIncident);
    socket.on('sms_fallback', pushIncident);
    socket.on('panic', onPanic);
    socket.on('panic_corroborated', pushIncident);
    socket.on('casualty', onCasualty);
    socket.on('casualty_hospital', pushIncident);
    socket.on('ambulance_update', pushIncident);
    socket.on('attendeeUpdate', onAttendeeUpdate);
    socket.on('aiAssessment', onAiAssessment);
    socket.on('demo_reset', onDemoReset);

    return () => {
      active = false;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('zoneUpdate', applyZoneUpdate);
      socket.off('alert', pushIncident);
      socket.off('dispatch', onDispatch);
      socket.off('preemptive_dispatch', onDispatch);
      socket.off('resolved', pushIncident);
      socket.off('predictive', pushIncident);
      socket.off('no_unit', pushIncident);
      socket.off('bottleneck', pushIncident);
      socket.off('sms_fallback', pushIncident);
      socket.off('panic', onPanic);
      socket.off('panic_corroborated', pushIncident);
      socket.off('casualty', onCasualty);
      socket.off('casualty_hospital', pushIncident);
      socket.off('ambulance_update', pushIncident);
      socket.off('attendeeUpdate', onAttendeeUpdate);
      socket.off('aiAssessment', onAiAssessment);
      socket.off('demo_reset', onDemoReset);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      panicTimeoutsRef.current.forEach(timeout => window.clearTimeout(timeout));
      panicTimeoutsRef.current.clear();
      responderTimeoutsRef.current.forEach(timeout => window.clearTimeout(timeout));
      responderTimeoutsRef.current.clear();
    };
  }, [applyZoneUpdate, flashResponder, flushOfflineQueue, loadInitial, pushIncident]);

  return (
    <div className="min-h-screen bg-cp-bg text-cp-text web3-shell">
      <TopBar
        databaseConnected={databaseConnected}
        redisStatus={redisStatus}
        aiLive={Boolean(aiAssessment)}
        connected={connected}
        offline={offline}
        onToggleOffline={handleToggleOffline}
        onDemoAction={handleDemoAction}
        onLogout={onLogout}
      />

      <AnimatePresence>{backendDown && (
        <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} className="flex items-center gap-2 border-b border-red-900 bg-cp-criticalDim px-4 py-2 text-xs font-medium text-red-200">
          Backend not reachable at this address. Make sure the server is running (<code className="rounded bg-white/10 px-1 py-0.5 font-mono">npm start</code> in the <code className="rounded bg-white/10 px-1 py-0.5 font-mono">backend</code> folder), then reload this page.
        </motion.div>
      )}</AnimatePresence>
      {offline && (
        <div className="flex items-center gap-2 border-b border-red-900 bg-cp-criticalDim px-4 py-2 text-xs font-medium text-red-200">
          Simulated network loss. Dashboard is showing last received data. Attendee updates are queuing locally and will sync on reconnect.
        </div>
      )}

      <motion.main initial={{opacity:0}} animate={{opacity:1}} transition={{duration:.35}} className="grid min-h-[calc(100vh-53px)] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <ZoneList zones={zones} />

        <section className="relative flex min-h-[420px] flex-col border-b border-cp-border lg:min-h-0">
          <div className="flex items-center border-b border-cp-border px-4 py-3">
            <div className="text-[13px] font-semibold">
              Venue map <span className="ml-2 font-normal text-cp-muted">satellite view · real backend feed · click map to set attendee location</span>
            </div>
          </div>
          <div className="min-h-[420px] flex-1">
            <MapView
              venueCenter={venueCenter}
              zones={zones}
              responders={responders}
              panicPings={panicPings}
              casualties={casualties}
              camps={adminMap?.camps ?? []}
              security={adminMap?.security ?? []}
              ambulances={adminMap?.ambulances ?? []}
              injuredPersons={adminMap?.injuredPersons ?? []}
              reportMarkers={uploadedReports}
              attendeeMarker={attendeeMarker}
              onMapClick={handleMapClick}
              onCasualtyClick={setSelectedCasualty}
            />
            {selectedCasualty && (
              <div className="absolute bottom-3 left-3 z-[600] max-w-sm rounded border border-cp-border bg-cp-panel/95 p-3 shadow-2xl backdrop-blur-sm">
                <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-cp-muted">Casualty report</div>
                <div className="text-sm font-semibold text-cp-text">{selectedCasualty.zoneName}</div>
                <div className="mt-1 text-[11px] text-cp-muted">Severity: {selectedCasualty.level} · {selectedCasualty.hospitalCamp || 'nearby hospital camp'} · ETA {selectedCasualty.ambulanceEtaMinutes ?? 8} min</div>
                <div className="mt-2 text-[11px] text-cp-text">{selectedCasualty.aiSummary || selectedCasualty.summary}</div>
                {selectedCasualty.estimatedCasualties != null && (
                  <div className="mt-2 text-[10.5px] text-cp-muted">Estimated injured persons: {selectedCasualty.estimatedCasualties}</div>
                )}
                {selectedCasualty.structuredReport && (
                  <div className="mt-2 space-y-1 rounded border border-cp-border bg-cp-panel2 p-2 text-[10.5px] text-cp-muted">
                    <div><span className="font-semibold text-cp-text">AI:</span> {selectedCasualty.structuredReport.severity} ({selectedCasualty.structuredReport.confidence * 100}% confidence)</div>
                    <div><span className="font-semibold text-cp-text">Rationale:</span> {selectedCasualty.structuredReport.rationale}</div>
                    <div><span className="font-semibold text-cp-text">Action:</span> {selectedCasualty.structuredReport.recommendedAction}</div>
                  </div>
                )}
                {adminMap?.distances && (
                  <div className="mt-2 space-y-1 rounded border border-cp-border bg-cp-panel2 p-2 text-[10.5px] text-cp-muted">
                    {adminMap.distances
                      .filter(item => item.fromId === selectedCasualty.id)
                      .map((item, index) => (
                        <div key={`${item.toId}-${index}`}><span className="font-semibold text-cp-text">{item.kind}:</span> {item.toLabel} · {item.distanceMeters}m</div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3.5 border-t border-cp-border px-4 py-2.5 text-[11px] text-cp-muted">
            <Legend color="bg-cp-safe" label="Normal" />
            <Legend color="bg-cp-caution" label="Elevated" />
            <Legend color="bg-cp-critical" label="Critical, dispatch triggered" />
            <Legend color="bg-cp-signal" label="Responder unit" />
          </div>
          <div className="px-4 pb-2.5 text-[11px] text-cp-dim">Flow bottleneck: predicted congestion forming between two adjacent zones, flagged before either zone individually crosses its own threshold.</div>

          <div className="border-t border-cp-border px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cp-muted">Uploaded people</div>
              <div className="text-[10px] text-cp-dim">{uploadedReports.length} records</div>
            </div>
            <div className="space-y-2">
              {uploadedReports.length === 0 ? (
                <div className="rounded border border-dashed border-cp-border bg-cp-panel2 p-2 text-[11px] text-cp-dim">No attendee uploads yet.</div>
              ) : (
                uploadedReports.slice(0, 6).map((report) => (
                  <div key={report.id} className="rounded border border-cp-border bg-cp-panel2 p-2">
                    <div className="mb-1 flex items-center gap-2">
                      {report.imageDataUrl ? (
                        <img src={report.imageDataUrl} alt={report.imageName || report.reporterName} className="h-10 w-10 rounded object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-cp-panel text-[10px] text-cp-muted">IMG</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold text-cp-text">{report.reporterName}</div>
                        <div className="truncate text-[10px] text-cp-muted">{report.zoneName || 'Unknown zone'} · {report.severity || 'Medium'}</div>
                      </div>
                    </div>
                    <div className="text-[10px] text-cp-dim">
                      {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[10px] text-cp-muted">{report.description || report.transcript || 'Uploaded incident report'}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="overflow-y-auto border-l border-cp-border">
          <div className="flex border-b border-cp-border">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 border-b-2 px-1 py-3 text-xs font-semibold ${tab === key ? 'border-cp-signal text-cp-text' : 'border-transparent text-cp-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="p-4">
            <AICopilotPanel assessment={aiAssessment} />
            <div className="mt-4">
            {tab === 'feed' && <OpsFeed incidents={incidents} />}
            {tab === 'attendee' && (
              <AttendeePanel
                lat={lat}
                lng={lng}
                setLat={setLat}
                setLng={setLng}
                connected={connected && !offline}
                onLocationUpdate={handleAttendeeLocationUpdate}
                queueOfflineEvent={queueOfflineEvent}
              />
            )}
            {tab === 'analytics' && <AnalyticsPanel active={tab === 'analytics'} />}
            </div>
          </div>
        </section>
      </motion.main>

      <footer className="mx-3 my-2 flex w-fit items-center gap-1.5 rounded border border-cp-border bg-cp-panel px-2.5 py-1 text-[10.5px] text-cp-dim lg:fixed lg:bottom-2.5 lg:right-3.5 lg:z-[500] lg:m-0">
        <a className="text-cp-muted hover:text-cp-text hover:underline" href="/privacy.html">Privacy Policy</a>
        <span>·</span>
        <a className="text-cp-muted hover:text-cp-text hover:underline" href="/terms.html">Terms of Use</a>
        <span>·</span>
        <span>CrowdPulse prototype, JWT-secured session</span>
      </footer>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <div className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${color}`} />{label}</div>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(getToken()));
  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />;
  const handleLogout = () => {
    clearToken();
    setAuthenticated(false);
  };
  return <Dashboard onLogout={handleLogout} />;
}
