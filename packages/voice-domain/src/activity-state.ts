export type RoomActivityState = 'preparing' | 'gathering' | 'active' | 'quiet' | 'closing' | 'ended';

export type FacilitationSessionState = 'preparing' | 'open' | 'quiet' | 'closing' | 'ended';

export interface RoomActivityInput {
  sessionState: FacilitationSessionState;
  participantCount: number;
  speakingCount: number;
  reconnectingParticipants: number;
  returningParticipants: number;
}

export function roomActivityState(input: RoomActivityInput): RoomActivityState {
  if (input.sessionState === 'ended') return 'ended';
  if (input.sessionState === 'closing') return 'closing';
  if (input.sessionState === 'quiet') return 'quiet';
  if (input.speakingCount > 0) return 'active';
  if (input.reconnectingParticipants > 0 || input.returningParticipants > 0) return 'gathering';
  if (input.sessionState === 'preparing' && input.participantCount <= 1) return 'preparing';
  if (input.participantCount > 1) return input.sessionState === 'preparing' ? 'gathering' : 'quiet';
  return 'preparing';
}
