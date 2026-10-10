import type { AudioState, ConnectionQuality, ConnectionState, Participant } from '@live-voice/shared-types';

export type AdaptivePresence =
  | 'speaking'
  | 'listening'
  | 'muted'
  | 'joining'
  | 'reconnecting'
  | 'offline'
  | 'left'
  | 'poor-connection';

export interface PresenceInput {
  audioState: AudioState;
  connectionState: ConnectionState;
  connectionQuality: ConnectionQuality;
}

export function resolvePresence(input: PresenceInput): AdaptivePresence {
  if (input.connectionState === 'closed') return 'left';
  if (input.connectionState === 'failed') return 'offline';
  if (input.connectionState === 'connecting' || input.connectionState === 'requesting-microphone') return 'joining';
  if (input.connectionState === 'reconnecting') return 'reconnecting';
  if (input.connectionQuality === 'poor') return 'poor-connection';
  return input.audioState;
}

export function participantPresence(participant: Participant): AdaptivePresence {
  return resolvePresence({
    audioState: participant.audioState,
    connectionState: participant.connectionState,
    connectionQuality: participant.connectionQuality
  });
}
