import type { RoomMode } from './room-mode';
import { roomModeProfile } from './room-mode';

export type RoomRole = 'host' | 'participant' | 'listener';

export interface RoomRoleProfile {
  id: RoomRole;
  label: string;
  intent: string;
}

export const ROOM_ROLE_PROFILES: Record<RoomRole, RoomRoleProfile> = {
  host: {
    id: 'host',
    label: 'Host',
    intent: 'Leading the room'
  },
  participant: {
    id: 'participant',
    label: 'Participant',
    intent: 'Joining conversation'
  },
  listener: {
    id: 'listener',
    label: 'Listener',
    intent: 'Listening'
  }
};

export function defaultRoomRole(isFirstParticipant: boolean, mode: RoomMode): RoomRole {
  if (isFirstParticipant) return 'host';
  return roomModeProfile(mode).defaultRole;
}

export function roomRoleProfile(role: RoomRole): RoomRoleProfile {
  return ROOM_ROLE_PROFILES[role];
}
