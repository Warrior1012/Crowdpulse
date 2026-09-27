const CAMP_LOCATIONS = [
  { id: 'camp-north', name: 'North Aid Camp', lat: 26.9136, lng: 75.7861 },
  { id: 'camp-south', name: 'South Aid Camp', lat: 26.9108, lng: 75.7890 },
  { id: 'camp-east', name: 'East Relief Point', lat: 26.9116, lng: 75.7898 },
];

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestCampForLocation(lat, lng) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const camp of CAMP_LOCATIONS) {
    const d = distanceMeters(lat, lng, camp.lat, camp.lng);
    if (d < bestDistance) {
      bestDistance = d;
      best = camp;
    }
  }
  return best || CAMP_LOCATIONS[0];
}

function buildCameraInjurySummary({
  personCount = 1,
  confidence = 0.75,
  posture = 'unknown',
  transcript = '',
  hasAudio = false,
  severityHint = 'medium',
}) {
  const combinedText = [transcript || '', posture || '', severityHint || '']
    .join(' ')
    .toLowerCase();

  let severity = 'Medium';
  let rationale = 'Detected a potential person distress event. A human operator should review the frame and determine the exact patient status.';
  let recommendedAction = 'Dispatch first-response staff and verify the victim with the nearest aid point.';

  const criticalKeywords = [
    'unconscious', 'collapsed', 'bleeding', 'severe injury', 'critical', 'not breathing', 'falling', 'passed out',
    'behosh', 'ghayal', 'khatarnak', 'blood', 'bleed', 'attack', 'emergency'
  ];
  const highKeywords = [
    'injured', 'coughing', 'dizzy', 'vomiting', 'struggling', 'pain', 'hurt', 'accident', 'fall', 'head injury',
    'chot', 'dard', 'gir', 'bahut', 'painful', 'weak'
  ];

  const isCritical = criticalKeywords.some((k) => combinedText.includes(k)) || severityHint.toLowerCase() === 'critical';
  const isHigh = highKeywords.some((k) => combinedText.includes(k)) || severityHint.toLowerCase() === 'high';

  if (isCritical || personCount > 2 || confidence >= 0.9) {
    severity = 'Critical';
    rationale = 'The camera analysis suggests a severe injured-person event with a likely critical medical condition or severe crowd-risk disruption.';
    recommendedAction = 'Dispatch trauma/medical response immediately and notify the nearest camp for rapid deployment.';
  } else if (isHigh || confidence >= 0.75) {
    severity = 'High';
    rationale = 'The camera detection indicates a likely injury or incapacitated person and should be escalated for rapid review.';
    recommendedAction = 'Send a medical unit and secure the immediate area while validating the victim status.';
  } else if (confidence >= 0.55 || hasAudio || posture === 'fallen') {
    severity = 'Medium';
    rationale = 'The scene suggests a moderate incident requiring quick human review and aid confirmation.';
    recommendedAction = 'Route a responder to verify and provide support if needed.';
  } else {
    severity = 'Low';
    rationale = 'The camera signal is mild and should be treated as a low-priority observation unless more evidence appears.';
    recommendedAction = 'Monitor the area and recheck the footage before dispatching a full response.';
  }

  return {
    severity,
    confidence: Number(Math.max(0.45, Math.min(0.99, confidence))).toFixed(2),
    posture,
    rationale,
    recommendedAction,
    assistiveNote: 'Assistive AI assessment only; this is not a medical diagnosis.',
    provider: 'camera-yolo-assistive',
  };
}

function summarizeDetectionMetrics({
  injuredPeople = 0,
  normalPeople = 0,
  importantEvents = 0,
  totalDetectedPeople = 0,
} = {}) {
  const injured = Math.max(0, Number(injuredPeople) || 0);
  const normal = Math.max(0, Number(normalPeople) || 0);
  const important = Math.max(0, Number(importantEvents) || 0);
  const explicitTotal = Number(totalDetectedPeople) || 0;
  const totalCount = Math.max(1, explicitTotal || injured + normal + important);
  const detectionRate = totalCount > 0 ? (injured / totalCount) * 100 : 0;
  const importantEventsRate = totalCount > 0 ? (important / totalCount) * 100 : 0;

  return {
    injuredPeople: injured,
    normalPeople: normal,
    importantEvents: important,
    totalDetectedPeople: totalCount,
    detectionRate: Number(detectionRate.toFixed(2)),
    importantEventsRate: Number(importantEventsRate.toFixed(2)),
    activeByCategory: {
      injured: injured,
      normal: normal,
      important: important,
    },
  };
}

module.exports = {
  CAMP_LOCATIONS,
  distanceMeters,
  nearestCampForLocation,
  buildCameraInjurySummary,
  summarizeDetectionMetrics,
};
