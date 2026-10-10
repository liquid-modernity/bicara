import type {
  ActivityTimelineEntry,
  CommunityMoment,
  ParticipantMemory,
  RoomIdentity
} from '@live-voice/voice-domain';

export interface IntelligenceContext {
  room: RoomIdentity;
  participants: ParticipantMemory[];
  activityTimeline: ActivityTimelineEntry[];
  communityMoments: CommunityMoment[];
}

export interface IntelligenceResult {
  message?: string;
  confidence?: number;
}

export interface IntelligenceAdapter {
  analyze(context: IntelligenceContext): Promise<IntelligenceResult | undefined>;
  summarize(context: IntelligenceContext): Promise<IntelligenceResult | undefined>;
  suggest(context: IntelligenceContext): Promise<IntelligenceResult | undefined>;
}

export class NullIntelligenceAdapter implements IntelligenceAdapter {
  async analyze(_context: IntelligenceContext): Promise<undefined> {
    return undefined;
  }

  async summarize(_context: IntelligenceContext): Promise<undefined> {
    return undefined;
  }

  async suggest(_context: IntelligenceContext): Promise<undefined> {
    return undefined;
  }
}
