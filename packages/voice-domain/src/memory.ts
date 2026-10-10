import { appendTimelineMoment, type ActivityTimelineEntry } from './timeline';

export interface SessionMemory {
  sessionId: string;
  roomId: string;
  startedAt: number;
  endedAt?: number;
  participants: string[];
  activityTimeline: ActivityTimelineEntry[];
  keyMoments: ActivityTimelineEntry[];
}

export function createSessionMemory(roomId: string, startedAt = Date.now()): SessionMemory {
  return {
    sessionId: `${roomId || 'room'}-${startedAt}`,
    roomId,
    startedAt,
    participants: [],
    activityTimeline: [],
    keyMoments: []
  };
}

export function addMemoryParticipant(memory: SessionMemory, participantName: string): SessionMemory {
  if (!participantName || memory.participants.includes(participantName)) return memory;
  return {
    ...memory,
    participants: [...memory.participants, participantName]
  };
}

export function addMemoryMoment(memory: SessionMemory, moment: ActivityTimelineEntry, keyMoment = false): SessionMemory {
  return {
    ...memory,
    activityTimeline: appendTimelineMoment(memory.activityTimeline, moment),
    keyMoments: keyMoment ? appendTimelineMoment(memory.keyMoments, moment, 12) : memory.keyMoments
  };
}

export function completeSessionMemory(memory: SessionMemory, endedAt = Date.now()): SessionMemory {
  return {
    ...memory,
    endedAt
  };
}
