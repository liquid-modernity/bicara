import type { ConnectionState, Participant, VoiceMode } from '@live-voice/shared-types';
export * from './conversation-state';
export * from './presence';
export * from './quality-state';
export * from './room-mode';

export interface VoiceRoomState {
  connection: ConnectionState;
  roomId: string;
  displayName: string;
  voiceMode: VoiceMode;
  muted: boolean;
  participants: Participant[];
}

export const initialVoiceRoomState = (): VoiceRoomState => ({
  connection: 'idle',
  roomId: '',
  displayName: '',
  voiceMode: 'open-mic',
  muted: true,
  participants: []
});

export function normalizeRoomId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 40);
}
