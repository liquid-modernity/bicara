import type { SessionMemory } from './memory';

export interface SessionSummary {
  sessionId: string;
  roomId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  participantCount: number;
  peakActivity: string;
  participationMoments: number;
}

export function createSessionSummary(memory: SessionMemory, endedAt = memory.endedAt ?? Date.now()): SessionSummary {
  return {
    sessionId: memory.sessionId,
    roomId: memory.roomId,
    startedAt: memory.startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - memory.startedAt),
    participantCount: memory.participants.length,
    peakActivity: peakActivityLabel(memory),
    participationMoments: memory.activityTimeline.length
  };
}

function peakActivityLabel(memory: SessionMemory): string {
  const activeMoments = memory.activityTimeline.filter((moment) => moment.type === 'conversation-active' || moment.type === 'discussion-opened');
  if (activeMoments.length > 0) return 'Discussion session';
  if (memory.activityTimeline.some((moment) => moment.type === 'room-quiet')) return 'Quiet conversation';
  return 'Voice room';
}
