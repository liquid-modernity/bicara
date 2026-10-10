import type { FacilitationSessionState } from './activity-state';
import type { RoomMode } from './room-mode';

export type RoomPersonality =
  | 'community-lounge'
  | 'collaborative-workshop'
  | 'learning-circle'
  | 'gaming-lobby'
  | 'focused-discussion';

export interface RoomPersonalitySnapshot {
  personality: RoomPersonality;
  label: string;
  description: string;
}

export function roomPersonality(mode: RoomMode, participantCount: number, sessionState: FacilitationSessionState): RoomPersonalitySnapshot {
  if (sessionState === 'quiet' && participantCount <= 2) return personalitySnapshot('focused-discussion');
  if (mode === 'workshop') return personalitySnapshot('collaborative-workshop');
  if (mode === 'learning') return personalitySnapshot('learning-circle');
  if (mode === 'gaming') return personalitySnapshot('gaming-lobby');
  return personalitySnapshot('community-lounge');
}

function personalitySnapshot(personality: RoomPersonality): RoomPersonalitySnapshot {
  if (personality === 'collaborative-workshop') return { personality, label: 'Collaborative workshop', description: 'A place for collaborative discussion' };
  if (personality === 'learning-circle') return { personality, label: 'Learning circle', description: 'A place to share ideas and ask questions' };
  if (personality === 'gaming-lobby') return { personality, label: 'Gaming lobby', description: 'A place to stay connected while playing' };
  if (personality === 'focused-discussion') return { personality, label: 'Focused discussion', description: 'A place for careful conversation' };
  return { personality, label: 'Community lounge', description: 'A place to talk freely' };
}
