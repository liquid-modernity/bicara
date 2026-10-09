export type ConnectionState =
  | 'idle'
  | 'requesting-microphone'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed';

export type AudioState = 'muted' | 'listening' | 'speaking';
export type VoiceMode = 'open-mic' | 'push-to-talk';
export type ConnectionQuality = 'unknown' | 'good' | 'fair' | 'poor';

export interface Participant {
  id: string;
  displayName: string;
  audioState: AudioState;
  connectionState: ConnectionState;
  connectionQuality: ConnectionQuality;
  isLocal?: boolean;
}

export interface SignalingParticipant {
  id: string;
  displayName: string;
  muted: boolean;
  speaking: boolean;
  joinedAt: number;
}

export type ClientSignalMessage =
  | { type: 'signal.offer'; targetId: string; payload: RTCSessionDescriptionInit }
  | { type: 'signal.answer'; targetId: string; payload: RTCSessionDescriptionInit }
  | { type: 'signal.ice'; targetId: string; payload: RTCIceCandidateInit }
  | { type: 'participant.update'; payload: { muted?: boolean; speaking?: boolean } }
  | { type: 'room.leave' }
  | { type: 'ping'; payload?: { at: number } };

export type ServerSignalMessage =
  | { type: 'room.welcome'; selfId: string; participants: SignalingParticipant[] }
  | { type: 'participant.joined'; participant: SignalingParticipant }
  | { type: 'participant.left'; participantId: string }
  | { type: 'participant.updated'; participant: SignalingParticipant }
  | { type: 'signal.offer'; senderId: string; payload: RTCSessionDescriptionInit }
  | { type: 'signal.answer'; senderId: string; payload: RTCSessionDescriptionInit }
  | { type: 'signal.ice'; senderId: string; payload: RTCIceCandidateInit }
  | { type: 'pong'; payload?: { at?: number } }
  | { type: 'error'; code: string; message: string; recoverable: boolean };

export interface TurnConfigurationResponse {
  iceServers: RTCIceServer[];
}
