import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Activity, LockKeyhole } from 'lucide-react';
import { login } from '../api';

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [username,setUsername] = useState('admin');
  const [password,setPassword] = useState('crowdpulse-admin');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(username,password); onLogin(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Login failed'); }
    finally { setBusy(false); }
  }
  return <div className="web3-shell min-h-screen bg-cp-bg text-cp-text grid place-items-center p-6">
    <motion.form initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} onSubmit={submit} className="w-full max-w-sm rounded-xl border border-cp-border bg-cp-panel p-6 shadow-2xl">
      <div className="mb-6 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-cp-signal/15 text-cp-signal"><Activity size={20}/></div><div><div className="font-semibold">CrowdPulse</div><div className="text-xs text-cp-muted">Operations Control Center</div></div></div>
      <h1 className="text-lg font-semibold">Secure operator access</h1><p className="mt-1 text-xs text-cp-muted">JWT-authenticated dashboard session.</p>
      <label className="mt-5 block text-xs text-cp-muted">Username<input value={username} onChange={e=>setUsername(e.target.value)} className="mt-1 w-full rounded border border-cp-border bg-black/20 px-3 py-2 text-sm outline-none focus:border-cp-signal" autoComplete="username"/></label>
      <label className="mt-3 block text-xs text-cp-muted">Password<div className="relative"><LockKeyhole size={15} className="absolute left-3 top-2.5 text-cp-dim"/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 w-full rounded border border-cp-border bg-black/20 py-2 pl-9 pr-3 text-sm outline-none focus:border-cp-signal" autoComplete="current-password"/></div></label>
      {error && <div className="mt-3 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">{error}</div>}
      <button disabled={busy} className="mt-5 w-full rounded bg-cp-signal px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{busy?'Authenticating…':'Sign in'}</button>
      <div className="mt-4 text-[10px] text-cp-dim">Demo default: admin / crowdpulse-admin</div>
    </motion.form>
  </div>;
}
