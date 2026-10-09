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

/** JSON-safe session description used by the signaling wire protocol. */
export interface SessionDescriptionPayload {
  type: 'answer' | 'offer' | 'pranswer' | 'rollback';
  sdp?: string;
}

/** JSON-safe ICE candidate used by the signaling wire protocol. */
export interface IceCandidatePayload {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** JSON-safe ICE server configuration returned by the TURN endpoint. */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type ClientSignalMessage =
  | { type: 'signal.offer'; targetId: string; payload: SessionDescriptionPayload }
  | { type: 'signal.answer'; targetId: string; payload: SessionDescriptionPayload }
  | { type: 'signal.ice'; targetId: string; payload: IceCandidatePayload }
  | { type: 'participant.update'; payload: { muted?: boolean; speaking?: boolean } }
  | { type: 'room.leave' }
  | { type: 'ping'; payload?: { at: number } };

export type ServerSignalMessage =
  | { type: 'room.welcome'; selfId: string; participants: SignalingParticipant[] }
  | { type: 'participant.joined'; participant: SignalingParticipant }
  | { type: 'participant.left'; participantId: string }
  | { type: 'participant.updated'; participant: SignalingParticipant }
  | { type: 'signal.offer'; senderId: string; payload: SessionDescriptionPayload }
  | { type: 'signal.answer'; senderId: string; payload: SessionDescriptionPayload }
  | { type: 'signal.ice'; senderId: string; payload: IceCandidatePayload }
  | { type: 'pong'; payload?: { at?: number } }
  | { type: 'error'; code: string; message: string; recoverable: boolean };

export interface TurnConfigurationResponse {
  iceServers: IceServerConfig[];
}
