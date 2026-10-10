import type { Participant } from '@live-voice/shared-types';
import { participantPresence } from './presence';
import type { RoomMode } from './room-mode';
import { roomModeProfile } from './room-mode';

export interface ConversationGroup {
  id: string;
  participants: string[];
  mode: RoomMode;
}

export type RoomPulse = 'quiet' | 'balanced' | 'active' | 'overlap' | 'reconnecting';

export interface RoomPulseSnapshot {
  pulse: RoomPulse;
  activeSpeakers: string[];
  speakingCount: number;
  silenceDurationMs: number;
  overlapCount: number;
  reconnectingParticipants: number;
  participantCount: number;
}

export interface ConversationStateInput {
  participants: Participant[];
  mode: RoomMode;
  lastSpeakingAt?: number;
  overlapCount?: number;
  now?: number;
}

export function defaultConversationGroup(roomId: string, participantIds: string[], mode: RoomMode): ConversationGroup {
  return {
    id: roomId || 'main',
    participants: participantIds,
    mode
  };
}

export function roomPulse(participants: Participant[], mode: RoomMode, options: Omit<ConversationStateInput, 'participants' | 'mode'> = {}): RoomPulseSnapshot {
  const activeSpeakers = participants
    .filter((participant) => participantPresence(participant) === 'speaking')
    .map((participant) => participant.id);
  const speakingCount = activeSpeakers.length;
  const reconnectingParticipants = participants.filter((participant) => participantPresence(participant) === 'reconnecting').length;
  const profile = roomModeProfile(mode);
  const now = options.now ?? Date.now();
  const silenceDurationMs = speakingCount === 0 && options.lastSpeakingAt ? Math.max(0, now - options.lastSpeakingAt) : 0;
  const pulse: RoomPulse = reconnectingParticipants > 0
    ? 'reconnecting'
    : speakingCount === 0
      ? 'quiet'
      : speakingCount >= profile.overlapWarningThreshold
        ? 'overlap'
        : speakingCount === 1
          ? 'balanced'
          : 'active';

  return {
    pulse,
    activeSpeakers,
    speakingCount,
    silenceDurationMs,
    overlapCount: options.overlapCount ?? 0,
    reconnectingParticipants,
    participantCount: participants.length
  };
}

export function conversationSnapshot(input: ConversationStateInput): RoomPulseSnapshot {
  return roomPulse(input.participants, input.mode, input);
}
