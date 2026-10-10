export type RoomMode = 'open' | 'workshop' | 'learning' | 'gaming';

export interface RoomModeProfile {
  id: RoomMode;
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
    maxAudioBitrate: 32_000,
    recoveryDelayMs: { disconnected: 2_500, failed: 750, poor: 3_500 },
    overlapWarningThreshold: 3,
    preferredFocus: 'everyone'
  },
  workshop: {
    id: 'workshop',
    maxAudioBitrate: 28_000,
    recoveryDelayMs: { disconnected: 2_000, failed: 650, poor: 3_000 },
    overlapWarningThreshold: 2,
    preferredFocus: 'active-speaker'
  },
  learning: {
    id: 'learning',
    maxAudioBitrate: 30_000,
    recoveryDelayMs: { disconnected: 2_250, failed: 700, poor: 3_250 },
    overlapWarningThreshold: 2,
    preferredFocus: 'teacher'
  },
  gaming: {
    id: 'gaming',
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
