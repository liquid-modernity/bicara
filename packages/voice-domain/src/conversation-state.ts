import type { Participant } from '@live-voice/shared-types';
import { participantPresence } from './presence';
import type { RoomMode } from './room-mode';
import { roomModeProfile } from './room-mode';

export interface ConversationGroup {
  id: string;
  participants: string[];
  mode: RoomMode;
}

export type RoomPulse =
  | 'quiet-room'
  | 'conversation-active'
  | 'single-speaker'
  | 'multiple-speakers'
  | 'everyone-listening'
  | 'people-returning';

export interface RoomPulseSnapshot {
  pulse: RoomPulse;
  activeSpeakers: string[];
  listeningParticipants: string[];
  speakingCount: number;
  listeningCount: number;
  silenceDurationMs: number;
  overlapCount: number;
  reconnectingParticipants: number;
  returningParticipants: number;
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
  const listeningParticipants = participants
    .filter((participant) => participantPresence(participant) === 'listening' || participantPresence(participant) === 'present')
    .map((participant) => participant.id);
  const speakingCount = activeSpeakers.length;
  const listeningCount = listeningParticipants.length;
  const reconnectingParticipants = participants.filter((participant) => participantPresence(participant) === 'reconnecting').length;
  const returningParticipants = participants.filter((participant) => participantPresence(participant) === 'returning').length;
  const profile = roomModeProfile(mode);
  const now = options.now ?? Date.now();
  const silenceDurationMs = speakingCount === 0 && options.lastSpeakingAt ? Math.max(0, now - options.lastSpeakingAt) : 0;
  const pulse: RoomPulse = reconnectingParticipants > 0 || returningParticipants > 0
    ? 'people-returning'
    : speakingCount === 0
      ? socialQuietPulse(listeningCount, participants.length, silenceDurationMs)
      : speakingCount >= profile.overlapWarningThreshold
        ? 'multiple-speakers'
        : speakingCount === 1
          ? 'single-speaker'
          : 'conversation-active';

  return {
    pulse,
    activeSpeakers,
    listeningParticipants,
    speakingCount,
    listeningCount,
    silenceDurationMs,
    overlapCount: options.overlapCount ?? 0,
    reconnectingParticipants,
    returningParticipants,
    participantCount: participants.length
  };
}

export function conversationSnapshot(input: ConversationStateInput): RoomPulseSnapshot {
  return roomPulse(input.participants, input.mode, input);
}

function socialQuietPulse(listeningCount: number, participantCount: number, silenceDurationMs: number): RoomPulse {
  if (participantCount > 1 && listeningCount === participantCount) return 'everyone-listening';
  if (silenceDurationMs > 0 && silenceDurationMs < 20_000) return 'conversation-active';
  return 'quiet-room';
}
