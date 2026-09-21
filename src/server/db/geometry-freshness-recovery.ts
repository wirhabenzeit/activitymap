export type GeometryFingerprint = {
  athleteId: string;
  detailedPolyline: string;
  id: string;
  mapId: string | null;
  summaryPolyline: string | null;
};

export type CurrentGeometryRow = Omit<GeometryFingerprint, 'detailedPolyline'> & {
  detailedPolyline: string | null;
  geometryState: 'summary' | 'detailed' | 'refresh_required';
};

export type GeometryRecoveryClassification = {
  alreadyRecovered: number;
  candidates: GeometryFingerprint[];
  detailedPolylineChanged: number;
  missingFromTarget: number;
  ownerChanged: number;
  routeIdentityChanged: number;
};

export function classifyGeometryRecovery(
  historicalRows: readonly GeometryFingerprint[],
  currentRows: readonly CurrentGeometryRow[],
): GeometryRecoveryClassification {
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const result: GeometryRecoveryClassification = {
    alreadyRecovered: 0,
    candidates: [],
    detailedPolylineChanged: 0,
    missingFromTarget: 0,
    ownerChanged: 0,
    routeIdentityChanged: 0,
  };

  for (const historical of historicalRows) {
    const current = currentById.get(historical.id);
    if (!current) {
      result.missingFromTarget += 1;
      continue;
    }
    if (current.athleteId !== historical.athleteId) {
      result.ownerChanged += 1;
      continue;
    }
    if (current.geometryState !== 'refresh_required') {
      result.alreadyRecovered += 1;
      continue;
    }
    if (
      current.mapId !== historical.mapId ||
      current.summaryPolyline !== historical.summaryPolyline
    ) {
      result.routeIdentityChanged += 1;
      continue;
    }
    if (current.detailedPolyline !== historical.detailedPolyline) {
      result.detailedPolylineChanged += 1;
      continue;
    }
    result.candidates.push(historical);
  }

  return result;
}
