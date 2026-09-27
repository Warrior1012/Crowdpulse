import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import { getClientId, postJSON } from '../api';
import type { AttendeeZoneInfo, IncidentReportResult } from '../models';

const STATUS_CLASS: Record<string, string> = {
  safe: 'bg-cp-safeDim',
  critical: 'bg-cp-criticalDim',
  caution: 'bg-cp-cautionDim',
};

const MAX_IMAGE_DATA_URL_LENGTH = 1_200_000;
const MAX_AUDIO_DATA_URL_LENGTH = 900_000;

async function compressImageToDataUrl(file: File, maxWidth = 1200, quality = 0.72): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });

  if (!dataUrl.startsWith('data:image/')) return null;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to decode image.'));
    img.src = dataUrl;
  });

  const scale = Math.min(1, maxWidth / Math.max(image.width, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const compressed = canvas.toDataURL('image/jpeg', quality);
  return compressed.length <= MAX_IMAGE_DATA_URL_LENGTH ? compressed : null;
}

interface Props {
  lat: string;
  lng: string;
  setLat: (v: string) => void;
  setLng: (v: string) => void;
  connected: boolean;
  onLocationUpdate: (lat: number, lng: number) => void;
  queueOfflineEvent: (event: Record<string, unknown>) => void;
}

export default function AttendeePanel({
  lat,
  lng,
  setLat,
  setLng,
  connected,
  onLocationUpdate,
  queueOfflineEvent,
}: Props) {
  const [zoneInfo, setZoneInfo] = useState<AttendeeZoneInfo | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [reporterName, setReporterName] = useState('Attendee');
  const [reporterContact, setReporterContact] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceLanguage, setVoiceLanguage] = useState<'en-IN' | 'hi-IN'>('en-IN');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState('incident-photo');
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState('incident-audio');
  const [isRecording, setIsRecording] = useState(false);
  const [reportResult, setReportResult] = useState<IncidentReportResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const recognitionRef = useRef<any>(null);

  const speechLang = voiceLanguage;

  const voicePrompt = useMemo(
    () => (voiceTranscript ? voiceTranscript : 'Record a short voice summary of what happened.'),
    [voiceTranscript]
  );

  async function submitLocation(newLat: number, newLng: number) {
    if (!Number.isFinite(newLat) || !Number.isFinite(newLng)) {
      setZoneInfo({
        status: 'unknown',
        zoneLabel: 'INVALID LOCATION',
        value: 'Enter valid coordinates',
        message: 'Latitude and longitude must both be valid numbers.',
      });
      return;
    }

    onLocationUpdate(newLat, newLng);

    if (!connected) {
      queueOfflineEvent({
        type: 'attendee_location_offline',
        lat: newLat,
        lng: newLng,
        ts: new Date().toISOString(),
        message: `Attendee location update queued offline at ${newLat.toFixed(4)}, ${newLng.toFixed(4)}`,
      });
      setZoneInfo({
        status: 'unknown',
        zoneLabel: 'QUEUED (OFFLINE)',
        message: 'No connection right now. This update will sync once connectivity is restored.',
      });
      return;
    }

    try {
      const res = await postJSON<{
        status: 'safe' | 'critical' | 'caution' | 'unknown';
        zoneId?: string | null;
        zoneName?: string;
        message: string;
      }>('/api/attendee-location', { lat: newLat, lng: newLng, clientId: getClientId() });

      setZoneInfo({
        status: res.status,
        zoneLabel: res.zoneId ? `ZONE ${res.zoneId} · ${(res.zoneName || '').toUpperCase()}` : 'OUTSIDE MAPPED ZONES',
        value:
          res.status === 'critical'
            ? 'Evacuate now'
            : res.status === 'caution'
              ? 'Getting crowded'
              : res.zoneId
                ? 'All clear'
                : 'Not in a mapped zone',
        message: res.message,
      });
    } catch (err) {
      console.error('Attendee location update failed:', err);
      setZoneInfo({
        status: 'unknown',
        zoneLabel: 'UPDATE FAILED',
        value: 'Could not update',
        message: 'The server rejected or could not process this location update.',
      });
    }
  }

  function handleUseGps() {
    if (!navigator.geolocation) {
      window.alert('Geolocation is not supported by this browser.');
      return;
    }

    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newLat = pos.coords.latitude;
        const newLng = pos.coords.longitude;
        setLat(newLat.toFixed(5));
        setLng(newLng.toFixed(5));
        setGpsBusy(false);
        void submitLocation(newLat, newLng);
      },
      (err) => {
        setGpsBusy(false);
        window.alert(`Could not get your location: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function handlePanic() {
    const l = parseFloat(lat);
    const g = parseFloat(lng);
    if (Number.isNaN(l) || Number.isNaN(g)) return;

    if (!connected) {
      queueOfflineEvent({
        type: 'panic_offline',
        lat: l,
        lng: g,
        ts: new Date().toISOString(),
        message: `Unsafe report queued offline at ${l.toFixed(4)}, ${g.toFixed(4)}`,
      });
      return;
    }

    await postJSON('/api/panic-report', { lat: l, lng: g, clientId: getClientId() });
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImageName(file.name);
    try {
      const compressed = await compressImageToDataUrl(file);
      setImageDataUrl(compressed);
    } catch (err) {
      console.error('Image compression failed:', err);
      setImageDataUrl(null);
      window.alert('Could not process the image. Please choose a smaller photo.');
    }
  }

  async function handleAudioUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      setAudioDataUrl(null);
      window.alert('Voice note is too large. Please record a shorter clip or skip audio for this report.');
      return;
    }

    setAudioName(file.name);
    const reader = new FileReader();
    reader.onload = () => setAudioDataUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  }

  function startVoiceCapture() {
    const speechCtor =
      (window as typeof window & { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
      (window as typeof window & { SpeechRecognition?: any; webkitSpeechRecognition?: any }).webkitSpeechRecognition;

    if (!speechCtor) {
      window.alert('Voice transcription is not available in this browser. You can still type your description manually.');
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new speechCtor();
      recognition.lang = speechLang;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event: any) => {
        const transcriptText = event?.results?.[0]?.[0]?.transcript || '';
        setVoiceTranscript((prev) => (prev ? `${prev} ${transcriptText}`.trim() : transcriptText));
      };
      recognition.onerror = () => setIsRecording(false);
      recognition.onend = () => setIsRecording(false);
      recognitionRef.current = recognition;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
      return;
    }

    recognitionRef.current.lang = speechLang;
    recognitionRef.current.start();
    setIsRecording(true);
  }

  async function submitIncidentReport() {
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const combinedDescription = [incidentDescription, voiceTranscript].filter(Boolean).join(' ').trim();

    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      window.alert('Please enter a valid location before submitting the report.');
      return;
    }

    if (!combinedDescription) {
      window.alert('Please add a short description or voice note before submitting the incident report.');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        reporterName: reporterName || 'Attendee',
        reporterRole: 'attendee',
        contact: reporterContact || undefined,
        latitude: parsedLat,
        longitude: parsedLng,
        zoneId: null,
        zoneName: null,
        description: incidentDescription,
        transcript: voiceTranscript,
        voiceLanguage,
        imageDataUrl: imageDataUrl && imageDataUrl.length < MAX_IMAGE_DATA_URL_LENGTH ? imageDataUrl : undefined,
        imageName: imageName || 'incident-photo',
        audioDataUrl: audioDataUrl && audioDataUrl.length < MAX_AUDIO_DATA_URL_LENGTH ? audioDataUrl : undefined,
        audioName: audioName || 'incident-audio',
        timestamp: new Date().toISOString(),
      };

      const result = await postJSON<IncidentReportResult>('/api/incident-report', payload);
      setReportResult(result);
      setIncidentDescription('');
      setVoiceTranscript('');
      setImageDataUrl(null);
      setImageName('incident-photo');
      setAudioDataUrl(null);
      setAudioName('incident-audio');
    } catch (err) {
      console.error('Incident report failed:', err);
      window.alert(err instanceof Error ? err.message : 'The incident report could not be submitted.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const boxClass = zoneInfo
    ? STATUS_CLASS[zoneInfo.status] || (zoneInfo.zoneLabel && zoneInfo.zoneLabel !== 'OUTSIDE MAPPED ZONES' ? 'bg-cp-safeDim' : 'bg-cp-panel')
    : 'bg-cp-panel';

  return (
    <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
      <div className="web3-card mb-4 rounded-[14px] border border-cp-border bg-cp-panel2 p-4">
        <div className="mb-2.5 text-[11px] text-cp-muted">ATTENDEE VIEW · {zoneInfo ? zoneInfo.zoneLabel : 'LOCATION NOT SET'}</div>
        <motion.div
          key={zoneInfo?.status || 'idle'}
          initial={{ scale: 0.98, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`mb-2.5 rounded-md p-3.5 text-center ${boxClass}`}
        >
          <div className="mb-1 text-[11px] text-cp-muted">STATUS</div>
          <div className="text-[15px] font-bold">{zoneInfo ? zoneInfo.value || 'Saved locally' : 'Set your location'}</div>
        </motion.div>
        <div className="text-xs leading-relaxed text-cp-muted">
          {zoneInfo
            ? zoneInfo.message
            : 'Enter coordinates below, or click a point on the map, to simulate this attendee\'s position. No real GPS wired up by default, use the button below for real device location.'}
        </div>
      </div>

      <label className="mb-1 block text-[11px] text-cp-muted">Latitude</label>
      <input className="mb-2.5 w-full rounded border border-cp-border bg-cp-panel2 px-2 py-1.5 text-xs text-cp-text outline-none focus:border-cp-signal" type="number" step="0.0001" value={lat} onChange={(e: ChangeEvent<HTMLInputElement>) => setLat(e.target.value)} />
      <label className="mb-1 block text-[11px] text-cp-muted">Longitude</label>
      <input className="mb-2.5 w-full rounded border border-cp-border bg-cp-panel2 px-2 py-1.5 text-xs text-cp-text outline-none focus:border-cp-signal" type="number" step="0.0001" value={lng} onChange={(e: ChangeEvent<HTMLInputElement>) => setLng(e.target.value)} />
      <button className="web3-button w-full rounded border border-cp-signal bg-cp-signal px-3 py-2 text-xs font-semibold text-slate-950 hover:brightness-110" onClick={() => void submitLocation(parseFloat(lat), parseFloat(lng))}>Update my location</button>
      <button className="mt-2 w-full rounded border border-cp-border bg-cp-panel2 px-3 py-2 text-xs hover:bg-slate-800" onClick={handleUseGps} disabled={gpsBusy}>{gpsBusy ? 'Requesting permission...' : 'Use my GPS location'}</button>
      <button className="mt-2 w-full rounded border border-cp-border bg-cp-panel2 px-3 py-2 text-xs hover:bg-slate-800" onClick={() => void handlePanic()}>Report unsafe feeling</button>

      <div className="mt-5 rounded-[14px] border border-cp-border bg-cp-panel2 p-4">
        <div className="mb-2 text-[11px] text-cp-muted">AI INCIDENT REPORTING</div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-cp-muted">Your name</label>
            <input value={reporterName} onChange={(e) => setReporterName(e.target.value)} className="w-full rounded border border-cp-border bg-cp-panel px-2 py-1.5 text-xs text-cp-text outline-none focus:border-cp-signal" />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-cp-muted">Contact / phone (optional)</label>
            <input value={reporterContact} onChange={(e) => setReporterContact(e.target.value)} className="w-full rounded border border-cp-border bg-cp-panel px-2 py-1.5 text-xs text-cp-text outline-none focus:border-cp-signal" />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-cp-muted">Incident photo</label>
            <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} className="w-full rounded border border-cp-border bg-cp-panel px-2 py-2 text-[11px] text-cp-text" />
            {imageDataUrl && (
              <img src={imageDataUrl} alt="Incident upload preview" className="mt-2 max-h-40 w-full rounded object-cover border border-cp-border" />
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-cp-muted">Voice language</label>
            <select value={voiceLanguage} onChange={(e) => setVoiceLanguage(e.target.value as 'en-IN' | 'hi-IN')} className="w-full rounded border border-cp-border bg-cp-panel px-2 py-1.5 text-xs text-cp-text outline-none focus:border-cp-signal">
              <option value="en-IN">English</option>
              <option value="hi-IN">Hindi / Hinglish</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-cp-muted">Voice note</label>
            <div className="flex gap-2">
              <button type="button" className="rounded border border-cp-signal bg-cp-signal px-2 py-1.5 text-[10px] font-semibold text-slate-950" onClick={startVoiceCapture}>{isRecording ? 'Stop recording' : 'Record voice'}</button>
              <div className="flex-1 rounded border border-cp-border bg-cp-panel px-2 py-1.5 text-[11px] text-cp-muted">{voicePrompt}</div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-cp-muted">Upload audio clip</label>
            <input type="file" accept="audio/*" onChange={handleAudioUpload} className="w-full rounded border border-cp-border bg-cp-panel px-2 py-2 text-[11px] text-cp-text" />
            {audioDataUrl && <div className="mt-2 text-[10px] text-cp-muted">Audio uploaded: {audioName}</div>}
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-cp-muted">What happened?</label>
            <textarea value={incidentDescription} onChange={(e) => setIncidentDescription(e.target.value)} rows={4} className="w-full rounded border border-cp-border bg-cp-panel px-2 py-2 text-xs text-cp-text outline-none focus:border-cp-signal" placeholder="Describe the incident, injuries, crowd condition, or safety concern." />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-cp-muted">Voice transcript</label>
            <textarea value={voiceTranscript} onChange={(e) => setVoiceTranscript(e.target.value)} rows={3} className="w-full rounded border border-cp-border bg-cp-panel px-2 py-2 text-xs text-cp-text outline-none focus:border-cp-signal" placeholder="Transcript from voice input will appear here, or you can paste text manually." />
          </div>

          <button className="w-full rounded border border-cp-signal bg-cp-signal px-3 py-2 text-xs font-semibold text-slate-950 hover:brightness-110 disabled:opacity-60" onClick={() => void submitIncidentReport()} disabled={isSubmitting}>{isSubmitting ? 'Submitting report…' : 'Submit incident report'}</button>

          <div className="rounded border border-amber-800/60 bg-amber-900/20 px-3 py-2 text-[10px] leading-relaxed text-amber-100">
            Assistive AI assessment only: this classification is intended to support operations and is not a medical diagnosis or treatment decision.
          </div>

          {reportResult && (
            <div className="rounded border border-cp-border bg-cp-panel px-3 py-3 text-[11px] text-cp-text">
              <div className="mb-1 font-semibold">AI severity: {reportResult.assessment.severity}</div>
              <div className="text-cp-muted">{reportResult.assessment.rationale}</div>
              <div className="mt-2 text-[10px] text-cp-muted">Confidence: {Math.round(reportResult.assessment.confidence * 100)}% · Provider: {reportResult.assessment.provider}</div>
              <div className="mt-2 text-[10px] text-amber-200">{reportResult.assessment.assistiveNote}</div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
