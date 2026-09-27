export type ZoneStatus = 'safe' | 'caution' | 'critical' | 'unknown';
export type ResponderStatus = 'available' | 'dispatched' | string;

export interface VenueCenter { lat: number; lng: number }
export interface Zone {
  id: string;
  name: string;
  cap: number;
  count: number;
  pct: number;
  status: ZoneStatus;
  source?: string | null;
  history?: number[];
  bounds: [number, number, number, number];
}
export interface Responder {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: ResponderStatus;
}
export interface Incident {
  id?: string;
  type: string;
  ts: string;
  message?: string;
  zoneId?: string;
  zoneName?: string;
  responderId?: string;
  [key: string]: unknown;
}
export interface PanicPing { id: string; lat: number; lng: number }
export interface AttendeeMarker { lat: number; lng: number }
export interface ZoneUpdatePayload {
  zoneId: string;
  name: string;
  cap: number;
  count: number;
  pct: number;
  status: ZoneStatus;
  source?: string | null;
}
export interface AttendeeZoneInfo {
  status: ZoneStatus;
  zoneLabel: string;
  value?: string;
  message: string;
}

export interface IncidentReportPayload {
  reporterName?: string;
  reporterRole?: string;
  contact?: string;
  latitude?: number;
  longitude?: number;
  zoneId?: string | null;
  zoneName?: string | null;
  description?: string;
  transcript?: string;
  voiceLanguage?: 'en-IN' | 'hi-IN' | string;
  imageDataUrl?: string;
  imageName?: string;
  audioDataUrl?: string;
  audioName?: string;
  timestamp?: string;
}

export interface IncidentSeverityAssessment {
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  confidence: number;
  rationale: string;
  assistiveNote: string;
  provider: 'gemini' | 'local-fallback';
}

export interface IncidentReportResult {
  ok: boolean;
  reportId: string;
  severity: IncidentSeverityAssessment['severity'];
  assessment: IncidentSeverityAssessment;
  submittedAt: string;
}

export interface AnalyticsData {
  totalIncidents: number;
  dispatchCount: number;
  avgResolveSeconds: number | null;
  peakZone: { name: string } | null;
  zones: Array<{ name: string; count: number }>;
  byType: Record<string, number>;
  detectionMetrics?: {
    injuredPeople: number;
    normalPeople: number;
    importantEvents: number;
    totalDetectedPeople: number;
    detectionRate: number;
    importantEventsRate: number;
  };
}
export type DemoAction = 'flow-surge' | 'force-critical' | 'panic-burst' | 'add-casualty' | 'reset-demo';
export type DemoPayload = Record<string, string | number>;
export type CasualtySeverity = 'red' | 'yellow' | 'green';

export interface CasualtyMarker {
  id: string;
  zoneId: string;
  zoneName: string;
  lat: number;
  lng: number;
  severity: CasualtySeverity;
  level: 'Critical' | 'Moderate' | 'Low';
  summary: string;
  aiSummary?: string;
  estimatedCasualties?: number;
  structuredReport?: {
    severity: string;
    confidence: number;
    rationale: string;
    provider: 'gemini' | 'local-fallback';
    assistiveNote: string;
    triagePriority: string;
    recommendedAction: string;
    hospitalCamp: string;
    ambulanceEtaMinutes: number;
  };
  hospitalCamp?: string;
  ambulanceEtaMinutes?: number;
  ts?: string;
}

export interface AdminCampMarker { id: string; name: string; lat: number; lng: number; type: 'camp' }
export interface AdminSecurityMarker { id: string; name: string; lat: number; lng: number; status: string; type: 'security' }
export interface AdminAmbulanceMarker { id: string; name: string; lat: number; lng: number; etaMinutes: number; routeTo: string; type: 'ambulance' }
export interface AdminInjuredPersonMarker { id: string; casualtyId: string; casualtyZone: string; lat: number; lng: number; severity: string; label: string; }
export interface AdminDistanceMetric { fromId: string; fromLabel: string; toId: string; toLabel: string; distanceMeters: number; kind: 'camp' | 'security' | 'ambulance'; }
export interface UploadedReportMarker {
  id: string;
  reporterName: string;
  reporterRole: string;
  latitude: number;
  longitude: number;
  zoneId?: string | null;
  zoneName?: string | null;
  description?: string;
  transcript?: string;
  imageDataUrl?: string | null;
  imageName?: string | null;
  timestamp?: string;
  severity?: string;
  rationale?: string;
  contact?: string | null;
}
export interface AdminMapSnapshot { camps: AdminCampMarker[]; casualties: CasualtyMarker[]; injuredPersons: AdminInjuredPersonMarker[]; security: AdminSecurityMarker[]; ambulances: AdminAmbulanceMarker[]; distances: AdminDistanceMetric[]; uploadedPeople?: UploadedReportMarker[]; }

export interface AIAssessment {
  zoneId: string;
  zoneName: string;
  ts: string;
  risk: number;
  riskLevel: 'normal' | 'elevated' | 'critical' | string;
  model: { name: string; source: string; confidence: number; anomalyScore: number; nextThresholdSeconds: number | null };
  features: { occupancy: number; count: number; capacity: number; inflowRate: number; outflowRate: number; acceleration: number; panicReports: number };
  copilot: { summary: string; why: string[]; recommendedActions: string[]; confidence: number; caveats?: string[]; provider?: string; geminiError?: string | null };
  venueKnowledge?: Array<{ id: number; title: string; content: string; tags: string[] }>;
}
