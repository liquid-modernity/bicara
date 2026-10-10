import type { FacilitationSessionState } from './activity-state';
import type { RoomRole } from './roles';

export type FacilitationAction = 'start-session' | 'end-session' | 'open-discussion' | 'quiet-room';

export interface FacilitationState {
  sessionState: FacilitationSessionState;
  localRole: RoomRole;
  updatedAt: number;
}

export function createFacilitationState(localRole: RoomRole, now = Date.now()): FacilitationState {
  return {
    sessionState: 'preparing',
    localRole,
    updatedAt: now
  };
}

export function canFacilitate(role: RoomRole): boolean {
  return role === 'host';
}

export function applyFacilitationAction(state: FacilitationState, action: FacilitationAction, now = Date.now()): FacilitationState {
  if (!canFacilitate(state.localRole)) return state;
  const sessionState: FacilitationSessionState = action === 'end-session'
    ? 'closing'
    : action === 'quiet-room'
      ? 'quiet'
      : 'open';
  return {
    ...state,
    sessionState,
    updatedAt: now
  };
}
