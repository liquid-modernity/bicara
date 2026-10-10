import type { ActivityTimelineEntry } from './timeline';

export type CommunityMomentType =
  | 'first-gathering'
  | 'returning-member'
  | 'collaborative-session'
  | 'active-discussion'
  | 'workshop-completed'
  | 'community-milestone';

export interface CommunityMoment {
  id: string;
  type: CommunityMomentType;
  label: string;
  at: number;
}

export function createCommunityMoment(type: CommunityMomentType, label: string, at = Date.now()): CommunityMoment {
  return {
    id: `${type}-${at}`,
    type,
    label,
    at
  };
}

export function communityMomentsFromTimeline(timeline: ActivityTimelineEntry[], participantCount: number): CommunityMoment[] {
  const moments: CommunityMoment[] = [];
  const firstJoin = timeline.find((moment) => moment.type === 'participant-joined');
  const activeDiscussion = timeline.find((moment) => moment.type === 'conversation-active' || moment.type === 'discussion-opened');
  const completed = timeline.find((moment) => moment.type === 'session-ended');
  if (firstJoin) moments.push(createCommunityMoment('first-gathering', 'First gathering', firstJoin.at));
  if (activeDiscussion) moments.push(createCommunityMoment('active-discussion', 'Discussion continued', activeDiscussion.at));
  if (participantCount >= 3 && activeDiscussion) moments.push(createCommunityMoment('collaborative-session', 'Collaborative session', activeDiscussion.at));
  if (completed) moments.push(createCommunityMoment('workshop-completed', 'Workshop completed', completed.at));
  return moments.slice(-4);
}
