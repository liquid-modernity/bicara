import type { RoomMode } from './room-mode';

export interface RoomIdentity {
  id: string;
  name: string;
  purpose: string;
  mode: RoomMode;
  createdAt: number;
}

const MODE_PURPOSE: Record<RoomMode, string> = {
  open: 'Open Conversation',
  workshop: 'Workshop Room',
  learning: 'Learning Session',
  gaming: 'Gaming Party'
};

export function createRoomIdentity(roomId: string, mode: RoomMode, createdAt = Date.now()): RoomIdentity {
  return {
    id: roomId,
    name: humanRoomName(roomId),
    purpose: MODE_PURPOSE[mode],
    mode,
    createdAt
  };
}

export function humanRoomName(roomId: string): string {
  const normalized = roomId.trim();
  if (!normalized) return 'Live Voice Room';
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
