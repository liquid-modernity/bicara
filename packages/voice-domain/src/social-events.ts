export type SocialRoomEventType =
  | 'participant-joined'
  | 'participant-returned'
  | 'session-started'
  | 'session-ending'
  | 'discussion-opened'
  | 'conversation-started'
  | 'room-quiet';

export interface SocialRoomEvent {
  id: string;
  type: SocialRoomEventType;
  message: string;
  createdAt: number;
}

export function createSocialRoomEvent(type: SocialRoomEventType, message: string, createdAt = Date.now()): SocialRoomEvent {
  return {
    id: `${type}-${createdAt}`,
    type,
    message,
    createdAt
  };
}

export function shouldShowSocialEvent(previous: SocialRoomEvent | undefined, next: SocialRoomEvent, cooldownMs = 4_000): boolean {
  if (!previous) return true;
  if (previous.type !== next.type || previous.message !== next.message) return true;
  return next.createdAt - previous.createdAt >= cooldownMs;
}
