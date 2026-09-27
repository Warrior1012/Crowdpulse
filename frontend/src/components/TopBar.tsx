import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import DemoControls from './DemoControls';
import type { DemoAction, DemoPayload } from '../models';

export type RedisStatus = 'connected' | 'disabled' | 'down' | 'unknown';

interface Props {
  databaseConnected: boolean;
  redisStatus: RedisStatus;
  aiLive: boolean;
  connected: boolean;
  offline: boolean;
  onToggleOffline: () => void;
  onDemoAction: (action: DemoAction, payload?: DemoPayload) => void;
  onLogout: () => void;
}

function PulseIcon() {
  return <div className="relative h-6 w-6 animate-web3-pulse"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="#4FA8D8"/><circle cx="12" cy="12" r="8" stroke="#4FA8D8" strokeWidth="1.4" opacity="0.5"/><circle cx="12" cy="12" r="11" stroke="#4FA8D8" strokeWidth="1" opacity="0.25"/></svg></div>;
}

export default function TopBar({ databaseConnected, redisStatus, aiLive, connected, offline, onToggleOffline, onDemoAction, onLogout }: Props) {
  const [clock, setClock] = useState(new Date().toTimeString().slice(0, 8));
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date().toTimeString().slice(0, 8)), 1000); return () => window.clearInterval(timer); }, []);

  const liveLabel = offline ? 'Disconnected' : connected ? 'Live' : 'Connecting...';
  const redisIsLive = redisStatus === 'connected';
  const redisIsDisabled = redisStatus === 'disabled';
  const redisLabel = redisIsLive ? 'Live' : redisIsDisabled ? 'Single instance' : redisStatus === 'down' ? 'Down' : 'Unknown';
  const redisColor = redisIsLive || redisIsDisabled ? 'bg-cp-safe' : redisStatus === 'down' ? 'bg-cp-critical' : 'bg-cp-caution';

  return <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-cp-border bg-cp-panel px-5 py-3.5 web3-grid-line">
    <div className="flex items-center gap-2.5"><PulseIcon/><div><div className="text-base font-semibold tracking-tight">CrowdPulse</div><div className="hidden text-[10px] uppercase tracking-[0.18em] text-cp-dim sm:block">Ops Console · live backend</div></div></div>
    <div className="flex flex-wrap items-center gap-3.5"><div className="font-mono text-xs text-cp-muted">{clock}</div><div className="flex items-center gap-1.5 text-xs text-cp-muted"><span className={`h-2 w-2 rounded-full ${offline || !connected ? 'bg-cp-critical' : 'bg-cp-safe'} ${connected && !offline ? 'animate-ping-soft' : ''}`}/><span>{liveLabel}</span></div><div className="flex items-center gap-1.5 text-xs text-cp-muted"><span className={`h-2 w-2 rounded-full ${databaseConnected ? 'bg-cp-safe' : 'bg-cp-critical'}`}/><span>DB {databaseConnected ? 'Live' : 'Down'}</span></div><div className="flex items-center gap-1.5 text-xs text-cp-muted"><span className={`h-2 w-2 rounded-full ${redisColor}`}/><span>Redis {redisLabel}</span></div><div className="flex items-center gap-1.5 text-xs text-cp-muted"><span className={`h-2 w-2 rounded-full ${aiLive ? 'bg-cp-signal' : 'bg-cp-caution'}`}/><span>AI {aiLive ? 'Live' : 'Warming'}</span></div><button onClick={onToggleOffline} className="web3-button inline-flex items-center gap-1.5 rounded border border-cp-border bg-cp-panel2 px-3 py-1.5 text-xs font-medium text-cp-text transition hover:border-slate-600 hover:bg-slate-800">{offline ? 'Restore connectivity' : 'Simulate network loss'}</button><DemoControls onAction={onDemoAction}/><button onClick={onLogout} className="web3-button inline-flex items-center gap-1.5 rounded border border-cp-border bg-cp-panel2 px-3 py-1.5 text-xs font-medium text-cp-text transition hover:border-slate-600 hover:bg-slate-800" aria-label="Log out of CrowdPulse"><LogOut size={14}/><span>Log out</span></button></div>
  </header>;
}
