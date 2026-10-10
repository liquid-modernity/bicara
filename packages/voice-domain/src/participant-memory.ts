export interface ParticipantMemory {
  participantId: string;
  displayName: string;
  firstJoined: number;
  lastJoined: number;
  sessionsJoined: number;
  totalPresenceTime: number;
  returningCount: number;
  participationMoments: number;
}

export function createParticipantMemory(participantId: string, displayName: string, joinedAt = Date.now()): ParticipantMemory {
  return {
    participantId,
    displayName,
    firstJoined: joinedAt,
    lastJoined: joinedAt,
    sessionsJoined: 1,
    totalPresenceTime: 0,
    returningCount: 0,
    participationMoments: 0
  };
}

export function updateParticipantMemory(memory: ParticipantMemory | undefined, participantId: string, displayName: string, joinedAt = Date.now()): ParticipantMemory {
  if (!memory) return createParticipantMemory(participantId, displayName, joinedAt);
  return {
    ...memory,
    displayName,
    lastJoined: joinedAt,
    sessionsJoined: memory.sessionsJoined + 1,
    returningCount: memory.returningCount + 1
  };
}

export function completeParticipantPresence(memory: ParticipantMemory, joinedAt: number, leftAt = Date.now(), participationMoments = 0): ParticipantMemory {
  return {
    ...memory,
    totalPresenceTime: memory.totalPresenceTime + Math.max(0, leftAt - joinedAt),
    participationMoments: memory.participationMoments + participationMoments
  };
}
