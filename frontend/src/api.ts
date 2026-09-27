import { io, type Socket } from 'socket.io-client';
import type { DemoPayload, ZoneStatus } from './models';

export const API = '';
const TOKEN_KEY = 'crowdpulse_jwt';

export function getToken(): string | null { return sessionStorage.getItem(TOKEN_KEY); }
export function setToken(token: string): void { sessionStorage.setItem(TOKEN_KEY, token); }
export function clearToken(): void { sessionStorage.removeItem(TOKEN_KEY); }

export interface AuthUser { username: string; role: 'admin' | 'operator' | 'sensor'; }
export interface LoginResponse { token: string; expiresIn: string; user: AuthUser; }

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Login failed (${res.status})`);
  setToken(data.token);
  return data as LoginResponse;
}

export function getClientId(): string {
  let id = sessionStorage.getItem('crowdpulse_client_id');
  if (!id) {
    const uuid = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    id = `client-${uuid}`;
    sessionStorage.setItem('crowdpulse_client_id', id);
  }
  return id;
}

function headers(): HeadersInit {
  const token = getToken();
  return token ? { 'Content-Type':'application/json', Authorization:`Bearer ${token}` } : { 'Content-Type':'application/json' };
}

export function createSocket(): Socket {
  const token = getToken();
  return io(API || undefined, { transports:['websocket','polling'], auth: { token } });
}

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { headers: headers() });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function postJSON<T = Record<string, unknown>>(path: string, body: unknown = {}, _admin = false): Promise<T> {
  const res = await fetch(API + path, { method:'POST', headers:headers(), body:JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${data?.error || 'request failed'}`);
  return data as T;
}

export function localTimeFromISO(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11,19);
  return d.toTimeString().slice(0,8);
}
export const STATUS_COLORS: Record<ZoneStatus,string> = { safe:'#3FAE72', caution:'#E0A83E', critical:'#E0483E', unknown:'#7C8898' };
export const STATUS_FILLS: Record<ZoneStatus,string> = { safe:'#1D3527', caution:'#3A2E17', critical:'#3A1D1B', unknown:'#202833' };
export const SIGNAL = '#4FA8D8';
export function statusColor(status:string):string { return STATUS_COLORS[status as ZoneStatus] || STATUS_COLORS.safe; }
export function statusFill(status:string):string { return STATUS_FILLS[status as ZoneStatus] || STATUS_FILLS.safe; }
export function sourceLabel(source?:string|null):string { const map:Record<string,string>={'simulated-iot':'simulated','simulated-iot-flow':'simulated','demo-trigger':'demo','camera-cv':'camera','manual-tally':'manual'}; return source ? (map[source] || source) : 'no data yet'; }
export type { DemoPayload };
