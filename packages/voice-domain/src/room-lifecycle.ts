import type { RoomActivityState } from './activity-state';

export type RoomLifecycleState = 'created' | 'active' | 'quiet' | 'paused' | 'completed';

export interface RoomLifecycle {
  roomId: string;
  state: RoomLifecycleState;
  createdAt: number;
  lastActiveAt?: number;
  lastConversationAt?: number;
  completedAt?: number;
}

export function createRoomLifecycle(roomId: string, createdAt = Date.now()): RoomLifecycle {
  return {
    roomId,
    state: 'created',
    createdAt
  };
}

export function updateRoomLifecycle(lifecycle: RoomLifecycle, activity: RoomActivityState, at = Date.now()): RoomLifecycle {
  if (activity === 'ended' || activity === 'closing') {
    return { ...lifecycle, state: 'completed', completedAt: at };
  }
  if (activity === 'active' || activity === 'gathering') {
    return { ...lifecycle, state: 'active', lastActiveAt: at, lastConversationAt: at };
  }
  if (activity === 'quiet') {
    return { ...lifecycle, state: 'quiet' };
  }
  return lifecycle.state === 'created' ? lifecycle : { ...lifecycle, state: 'paused' };
}
