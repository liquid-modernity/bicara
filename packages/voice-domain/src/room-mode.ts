import type { RoomRole } from './roles';

export type RoomMode = 'open' | 'workshop' | 'learning' | 'gaming';

export interface RoomModeProfile {
  id: RoomMode;
  name: string;
  description: string;
  defaultRole: RoomRole;
  suggestedCopy: string;
  maxAudioBitrate: number;
  recoveryDelayMs: {
    disconnected: number;
    failed: number;
    poor: number;
  };
  overlapWarningThreshold: number;
  preferredFocus: 'everyone' | 'active-speaker' | 'teacher' | 'low-latency';
}

export const ROOM_MODE_PROFILES: Record<RoomMode, RoomModeProfile> = {
  open: {
    id: 'open',
    name: 'Open',
    description: 'Talk freely',
    defaultRole: 'participant',
    suggestedCopy: 'Talk freely',
    maxAudioBitrate: 32_000,
    recoveryDelayMs: { disconnected: 2_500, failed: 750, poor: 3_500 },
    overlapWarningThreshold: 3,
    preferredFocus: 'everyone'
  },
  workshop: {
    id: 'workshop',
    name: 'Workshop',
    description: 'Collaborate and build together',
    defaultRole: 'participant',
    suggestedCopy: 'Build ideas together',
    maxAudioBitrate: 28_000,
    recoveryDelayMs: { disconnected: 2_000, failed: 650, poor: 3_000 },
    overlapWarningThreshold: 2,
    preferredFocus: 'active-speaker'
  },
  learning: {
    id: 'learning',
    name: 'Learning',
    description: 'Share ideas and ask questions',
    defaultRole: 'listener',
    suggestedCopy: 'Share ideas and ask questions',
    maxAudioBitrate: 30_000,
    recoveryDelayMs: { disconnected: 2_250, failed: 700, poor: 3_250 },
    overlapWarningThreshold: 2,
    preferredFocus: 'teacher'
  },
  gaming: {
    id: 'gaming',
    name: 'Gaming',
    description: 'Stay connected with your squad',
    defaultRole: 'participant',
    suggestedCopy: 'Stay connected with your squad',
    maxAudioBitrate: 24_000,
    recoveryDelayMs: { disconnected: 1_200, failed: 400, poor: 2_000 },
    overlapWarningThreshold: 4,
    preferredFocus: 'low-latency'
  }
};

export function normalizeRoomMode(value: string | null | undefined): RoomMode {
  if (value === 'open-room' || value === 'lounge') return 'open';
  return isRoomMode(value) ? value : 'open';
}

export function roomModeProfile(mode: RoomMode): RoomModeProfile {
  return ROOM_MODE_PROFILES[mode];
}

export function isRoomMode(value: unknown): value is RoomMode {
  return value === 'open' || value === 'workshop' || value === 'learning' || value === 'gaming';
}
