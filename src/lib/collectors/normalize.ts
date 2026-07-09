export interface CanonicalEvent {
  entity: string;
  type: string;
  attributes: Record<string, unknown>;
  timestamp: Date;
  source: string;
  sourceType: 'prometheus' | 'syslog' | 'docker' | 'rest';
}

export function normalizeEvent(
  raw: Partial<CanonicalEvent>,
  sourceType: CanonicalEvent['sourceType'],
): CanonicalEvent {
  if (!raw.entity) throw new Error('normalizeEvent: entity is required');
  if (!raw.type) throw new Error('normalizeEvent: type is required');
  if (!raw.timestamp) throw new Error('normalizeEvent: timestamp is required');

  const ts = raw.timestamp instanceof Date ? raw.timestamp : new Date(raw.timestamp as never);
  return {
    entity: raw.entity,
    type: raw.type,
    attributes: raw.attributes ?? {},
    timestamp: ts,
    source: raw.source ?? sourceType,
    sourceType,
  };
}
