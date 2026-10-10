import type { AudioState, ConnectionQuality, ConnectionState, Participant } from '@live-voice/shared-types';

export type AdaptivePresence =
  | 'present'
  | 'speaking'
  | 'listening'
  | 'quiet'
  | 'joining'
  | 'unstable'
  | 'reconnecting'
  | 'returning'
  | 'left';

export interface PresenceInput {
  audioState: AudioState;
  connectionState: ConnectionState;
  connectionQuality: ConnectionQuality;
}

export function resolvePresence(input: PresenceInput): AdaptivePresence {
  if (input.connectionState === 'closed') return 'left';
  if (input.audioState === 'returning') return 'returning';
  if (input.connectionState === 'failed') return 'reconnecting';
  if (input.connectionState === 'connecting' || input.connectionState === 'requesting-microphone') return 'joining';
  if (input.connectionState === 'reconnecting') return 'reconnecting';
  if (input.connectionQuality === 'poor' || input.audioState === 'unstable' || input.audioState === 'poor-connection') return 'unstable';
  if (input.audioState === 'speaking') return 'speaking';
  if (input.audioState === 'listening') return 'listening';
  if (input.audioState === 'muted') return 'quiet';
  if (input.connectionState === 'connected') return 'present';
  return 'joining';
}

export function participantPresence(participant: Participant): AdaptivePresence {
  return resolvePresence({
    audioState: participant.audioState,
    connectionState: participant.connectionState,
    connectionQuality: participant.connectionQuality
  });
}
