import type { RoomMode } from './room-mode';
import type { SessionSummary } from './session-summary';

export interface RecentSession {
  sessionId: string;
  roomId: string;
  roomName: string;
  purpose: string;
  mode: RoomMode;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  participantCount: number;
  peakActivity: string;
}

export function recentSessionFromSummary(summary: SessionSummary, details: Pick<RecentSession, 'roomName' | 'purpose' | 'mode'>): RecentSession {
  return {
    sessionId: summary.sessionId,
    roomId: summary.roomId,
    roomName: details.roomName,
    purpose: details.purpose,
    mode: details.mode,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationMs: summary.durationMs,
    participantCount: summary.participantCount,
    peakActivity: summary.peakActivity
  };
}

export function rememberRecentSession(sessions: RecentSession[], next: RecentSession, maxSessions = 5): RecentSession[] {
  return [next, ...sessions.filter((session) => session.sessionId !== next.sessionId)].slice(0, maxSessions);
}
