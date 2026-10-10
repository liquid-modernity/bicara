export type ActivityMomentType =
  | 'session-started'
  | 'participant-joined'
  | 'discussion-opened'
  | 'room-quiet'
  | 'conversation-active'
  | 'session-ended';

export interface ActivityTimelineEntry {
  id: string;
  type: ActivityMomentType;
  label: string;
  at: number;
}

export function createTimelineMoment(type: ActivityMomentType, label: string, at = Date.now()): ActivityTimelineEntry {
  return {
    id: `${type}-${at}`,
    type,
    label,
    at
  };
}

export function appendTimelineMoment(timeline: ActivityTimelineEntry[], moment: ActivityTimelineEntry, maxEntries = 40): ActivityTimelineEntry[] {
  const previous = timeline.at(-1);
  if (previous?.type === moment.type && previous.label === moment.label && moment.at - previous.at < 4_000) return timeline;
  return [...timeline, moment].slice(-maxEntries);
}
