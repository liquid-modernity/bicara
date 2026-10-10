import { initializeGagaRuntime } from '@live-voice/gaga-bridge';
import { MeshPeerManager, VoiceEngine } from '@live-voice/rtc-core';
import type { PeerQualityMetrics } from '@live-voice/rtc-core';
import type {
  ConnectionQuality,
  Participant,
  ServerSignalMessage,
  SignalingParticipant,
  TurnConfigurationResponse,
  VoiceMode
} from '@live-voice/shared-types';
import { SignalingClient } from '@live-voice/signaling-client';
import {
  defaultConversationGroup,
  normalizeDisplayName,
  normalizeRoomId,
  normalizeRoomMode,
  participantPresence,
  qualityPolicy,
  qualityFromScore,
  roomModeProfile,
  roomPulse,
  scoreConnectionQuality,
  type AdaptivePresence,
  type RoomMode
} from '@live-voice/voice-domain';
import { createTranslator, detectLocale, type Locale, type TranslationKey } from '../lib/i18n';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const joinView = $('#join-view');
const roomView = $('#room-view');
const joinForm = $('#join-form') as HTMLFormElement;
const nameInput = $('#display-name') as HTMLInputElement;
const roomInput = $('#room-id') as HTMLInputElement;
const joinButton = $('#join-button') as HTMLButtonElement;
const muteButton = $('#mute-button') as HTMLButtonElement;
const leaveButton = $('#leave-button') as HTMLButtonElement;
const pttButton = $('#ptt-button') as HTMLButtonElement;
const copyButton = $('#copy-link') as HTMLButtonElement;
const participantList = $('#participant-list');
const statusLabel = $('#connection-status');
const qualityLabel = $('#quality-status');
const roomTitle = $('#room-title');
const errorBox = $('#error-box');
const audioBin = $('#remote-audio-bin');
const modeSelect = $('#voice-mode') as HTMLSelectElement;
const roomModeSelect = $('#room-mode') as HTMLSelectElement;
const localeSelect = $('#locale-select') as HTMLSelectElement;
const installButton = $('#install-button') as HTMLButtonElement;
const audioEnableButton = $('#enable-audio-button') as HTMLButtonElement;
const audioOutputWrap = $('#audio-output-wrap');
const audioOutputSelect = $('#audio-output') as HTMLSelectElement;
const capacityLabel = $('#capacity-label');
const offlineBanner = $('#offline-banner');
const pttHint = $('#ptt-hint');
const pulseLabel = $('#room-pulse');
const optimizingLabel = $('#optimizing-label');
const diagnosticsPanel = document.querySelector<HTMLPreElement>('#diagnostics-panel');

const DIAGNOSTICS_ENABLED = import.meta.env.DEV;
const PARTICIPANT_RECONNECT_GRACE_MS = 15_000;
const ADAPTIVE_AUDIO_COOLDOWN_MS = 8_000;
const SIGNALING_URL = resolveSignalingUrl();
const DEFAULT_ROOM = normalizeRoomId(import.meta.env.PUBLIC_DEFAULT_ROOM || 'general') || 'general';
const configuredMaxParticipants = Number(import.meta.env.PUBLIC_MAX_PARTICIPANTS || '10');
const MAX_PARTICIPANTS = Number.isFinite(configuredMaxParticipants)
  ? Math.min(25, Math.max(2, Math.round(configuredMaxParticipants)))
  : 10;

const participantId = getOrCreateParticipantId();
const signaling = new SignalingClient();
const voice = new VoiceEngine();
let mesh: MeshPeerManager | undefined;
let roomId = '';
let displayName = '';
let muted = true;
let speaking = false;
const storedMode = localStorage.getItem('live-voice-mode');
let mode: VoiceMode = storedMode === 'push-to-talk' ? 'push-to-talk' : 'open-mic';
let roomMode: RoomMode = normalizeRoomMode(localStorage.getItem('live-voice-room-mode'));
let participants = new Map<string, Participant>();
let stopSpeakingMonitor: (() => void) | undefined;
let qualityTimer: number | undefined;
const peerRecoveryTimers = new Map<string, number>();
const participantRemovalTimers = new Map<string, number>();
const peerMetrics = new Map<string, PeerMetrics>();
const peerQualityState = new Map<string, ConnectionQuality | 'reconnecting'>();
const remoteVolumes = new Map<string, number>();
const localMutedPeers = new Set<string>();
let roomMetrics = createRoomMetrics();
let lastSignalingState: 'connecting' | 'open' | 'closed' | 'reconnecting' | 'failed' | undefined;
let focusedPeerId: string | undefined;
let lastSpeakingAt = 0;
let overlapCount = 0;
let wasOverlapping = false;
let activeAudioBitrate = roomModeProfile(roomMode).maxAudioBitrate;
let lastAudioProfileAt = 0;
let beforeInstallPrompt: BeforeInstallPromptEvent | undefined;
let locale = detectLocale();
let t = createTranslator(locale);

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PeerMetrics {
  startedAt: number;
  connectionTimeline: string[];
  iceTimeline: string[];
  reconnectAttempts: number;
}

interface RoomMetrics {
  joinAttempts: number;
  joinSuccesses: number;
  joinFailures: number;
  reconnectCount: number;
  roomStartedAt: number;
  lastJoinRequestedAt: number;
}

type ClientLogDetail = Record<string, unknown>;

const gaga = initializeGagaRuntime({
  applicationId: 'live-voice',
  config: {
    defaultRoom: DEFAULT_ROOM,
    maxParticipants: MAX_PARTICIPANTS,
    supportedModes: ['open-mic', 'push-to-talk'],
    supportedRoomModes: ['open', 'workshop', 'learning', 'gaming']
  }
});
setupInitialState();
setupEvents();
registerServiceWorker();
renderStaticText();
render();

function setupInitialState(): void {
  const url = new URL(window.location.href);
  const roomFromUrl = normalizeRoomId(url.searchParams.get('room') ?? '');
  roomInput.value = roomFromUrl || DEFAULT_ROOM;
  nameInput.value = localStorage.getItem('live-voice-display-name') ?? '';
  modeSelect.value = mode;
  roomModeSelect.value = roomMode;
  localeSelect.value = locale;
  updateOnlineState();
}

function setupEvents(): void {
  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void joinRoom();
  });

  muteButton.addEventListener('click', () => {
    if (mode === 'push-to-talk') return;
    setMuted(!muted);
  });

  leaveButton.addEventListener('click', () => leaveRoom());
  copyButton.addEventListener('click', () => void copyRoomLink());
  audioEnableButton.addEventListener('click', () => void resumeRemoteAudio());
  audioOutputSelect.addEventListener('change', () => void setAudioOutput(audioOutputSelect.value));
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void refreshAudioOutputs());

  modeSelect.addEventListener('change', () => {
    mode = modeSelect.value === 'push-to-talk' ? 'push-to-talk' : 'open-mic';
    localStorage.setItem('live-voice-mode', mode);
    if (mode === 'push-to-talk') setMuted(true);
    renderControls();
    gaga.emit('gaga:voice-mode-changed', { mode });
  });

  roomModeSelect.addEventListener('change', () => {
    roomMode = normalizeRoomMode(roomModeSelect.value);
    localStorage.setItem('live-voice-room-mode', roomMode);
    gaga.emit('gaga:room.mode', { mode: roomMode });
    void applyAdaptiveAudio();
    render();
  });

  localeSelect.addEventListener('change', () => {
    locale = localeSelect.value === 'en-US' ? 'en-US' : 'id-ID';
    localStorage.setItem('live-voice-locale', locale);
    t = createTranslator(locale);
    document.documentElement.lang = locale;
    renderStaticText();
    render();
    if (!roomView.hidden) void refreshAudioOutputs();
  });

  const beginPtt = (event: Event) => {
    if (mode !== 'push-to-talk' || roomView.hidden) return;
    event.preventDefault();
    setMuted(false);
    pttButton.classList.add('gaga-is-speaking');
  };
  const endPtt = (event: Event) => {
    if (mode !== 'push-to-talk' || roomView.hidden) return;
    event.preventDefault();
    setMuted(true);
    pttButton.classList.remove('gaga-is-speaking');
  };
  pttButton.addEventListener('pointerdown', beginPtt);
  pttButton.addEventListener('pointerup', endPtt);
  pttButton.addEventListener('pointercancel', endPtt);
  pttButton.addEventListener('pointerleave', endPtt);

  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (event.code !== 'Space' || event.repeat || target?.matches('input, textarea, select, [contenteditable]')) return;
    if (target?.matches('button') && target !== pttButton) return;
    beginPtt(event);
  });
  window.addEventListener('keyup', (event) => {
    const target = event.target as HTMLElement | null;
    if (event.code !== 'Space' || target?.matches('input, textarea, select, [contenteditable]')) return;
    if (target?.matches('button') && target !== pttButton) return;
    endPtt(event);
  });

  gaga.lifecycle.use(signaling.onState((state) => {
    if (state === 'connecting') setConnectionStatus('connecting');
    if (state === 'reconnecting') {
      if (lastSignalingState !== 'reconnecting') {
        roomMetrics.reconnectCount += 1;
        markAllRemoteParticipants('reconnecting');
        gaga.emit('gaga:voice.reconnecting', { roomId, participantId });
        logRoomMetrics('room.reconnect');
      }
      setConnectionStatus('reconnecting');
    }
    if (state === 'failed') {
      setConnectionStatus('failed');
      markAllRemoteParticipants('offline');
      showError(t('genericError'));
    }
    lastSignalingState = state;
  }));
  gaga.lifecycle.use(signaling.onMessage((message) => {
    void handleSignal(message).catch(() => {
      showError(t('genericError'));
    });
  }));

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    beforeInstallPrompt = event as BeforeInstallPromptEvent;
    installButton.hidden = false;
  });
  installButton.addEventListener('click', () => void installPwa());
  window.addEventListener('appinstalled', () => {
    beforeInstallPrompt = undefined;
    installButton.hidden = true;
  });

  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  window.addEventListener('beforeunload', () => {
    leaveRoom(false);
    gaga.destroy();
  });
}

async function joinRoom(): Promise<void> {
  clearError();
  roomMetrics.joinAttempts += 1;
  roomMetrics.lastJoinRequestedAt = Date.now();
  displayName = normalizeDisplayName(nameInput.value);
  roomId = normalizeRoomId(roomInput.value);

  if (!displayName) {
    recordJoinFailure('display-name');
    nameInput.focus();
    return;
  }
  if (!roomId) {
    recordJoinFailure('room-id');
    roomInput.focus();
    return;
  }
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    recordJoinFailure('secure-context');
    showError(t('secureRequired'));
    return;
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    recordJoinFailure('media-devices');
    showError(t('micMissing'));
    setConnectionStatus('failed');
    return;
  }
  if (!navigator.onLine) {
    recordJoinFailure('offline');
    showError(t('offline'));
    return;
  }

  joinButton.disabled = true;
  joinButton.textContent = t('joining');
  setConnectionStatus('requesting-microphone');

  try {
    const stream = await voice.startMicrophone();
    const iceServers = await loadIceServers();
    await refreshAudioOutputs();
    mesh = new MeshPeerManager(stream, iceServers, {
      sendIce: (targetId, candidate) => signaling.send({ type: 'signal.ice', targetId, payload: candidate }),
      onRemoteStream: attachRemoteStream,
      onConnectionState: handlePeerConnectionState,
      onIceConnectionState: handlePeerIceConnectionState
    });

    muted = mode === 'push-to-talk';
    voice.setMuted(muted);
    localStorage.setItem('live-voice-display-name', displayName);

    participants.clear();
    peerMetrics.clear();
    peerQualityState.clear();
    remoteVolumes.clear();
    localMutedPeers.clear();
    focusedPeerId = undefined;
    lastSpeakingAt = 0;
    overlapCount = 0;
    wasOverlapping = false;
    activeAudioBitrate = roomModeProfile(roomMode).maxAudioBitrate;
    lastAudioProfileAt = 0;
    participantRemovalTimers.forEach((timer) => window.clearTimeout(timer));
    participantRemovalTimers.clear();
    participants.set(participantId, localParticipant());
    gaga.emit('gaga:voice.participant.joining', { roomId, participantId });

    stopSpeakingMonitor?.();
    stopSpeakingMonitor = voice.monitorLocalSpeaking((active) => {
      speaking = active;
      if (active) lastSpeakingAt = Date.now();
      updateLocalParticipant();
      signaling.send({ type: 'participant.update', payload: { speaking: active } });
    });

    signaling.connect({
      baseUrl: SIGNALING_URL,
      roomId,
      participantId,
      displayName
    });

    joinView.hidden = true;
    roomView.hidden = false;
    roomTitle.textContent = roomId;
    updateUrlRoom(roomId);
    startQualityMonitor();
    gaga.emit('gaga:room-join-requested', { roomId, participantId, roomMode });
    logRoomMetrics('room.join_requested');
    render();
  } catch (error) {
    recordJoinFailure(mapMediaFailureReason(error));
    joinButton.disabled = false;
    joinButton.textContent = t('join');
    showError(mapMediaError(error));
    setConnectionStatus('failed');
    voice.stop();
    mesh?.closeAll();
    mesh = undefined;
  }
}

async function handleSignal(message: ServerSignalMessage): Promise<void> {
  switch (message.type) {
    case 'room.welcome': {
      roomMetrics.joinSuccesses += 1;
      roomMetrics.roomStartedAt = Date.now();
      participants = new Map([[participantId, localParticipant()]]);
      for (const participant of message.participants) upsertRemoteParticipant(participant);
      setConnectionStatus('connected');
      gaga.emit('gaga:voice.participant.connected', { roomId, participantId });
      joinButton.disabled = false;
      joinButton.textContent = t('join');
      signaling.send({ type: 'participant.update', payload: { muted, speaking } });

      for (const participant of message.participants) {
        if (participant.id === participantId) continue;
        const offer = await mesh?.createOffer(participant.id, true);
        if (offer) signaling.send({ type: 'signal.offer', targetId: participant.id, payload: offer });
      }
      const conversationGroup = defaultConversationGroup(roomId, [...participants.keys()], roomMode);
      gaga.emit('gaga:room-joined', { roomId, participantId, participantCount: participants.size });
      gaga.emit('gaga:voice.joined', {
        roomId,
        participantId,
        roomMode,
        participantCount: participants.size,
        conversationGroupId: conversationGroup.id,
        conversationParticipants: conversationGroup.participants.length
      });
      logRoomMetrics('room.joined');
      render();
      break;
    }
    case 'participant.joined':
      cancelParticipantRemoval(message.participant.id);
      upsertRemoteParticipant(message.participant);
      logRoomMetrics('room.participant_joined');
      render();
      break;
    case 'participant.updated':
      upsertRemoteParticipant(message.participant);
      if (message.participant.speaking) lastSpeakingAt = Date.now();
      render();
      break;
    case 'participant.left':
      markParticipantReconnecting(message.participantId);
      mesh?.remove(message.participantId);
      scheduleParticipantRemoval(message.participantId);
      logRoomMetrics('room.participant_left');
      render();
      break;
    case 'signal.offer': {
      const answer = await mesh?.acceptOffer(message.senderId, message.payload);
      if (answer) signaling.send({ type: 'signal.answer', targetId: message.senderId, payload: answer });
      break;
    }
    case 'signal.answer':
      await mesh?.acceptAnswer(message.senderId, message.payload);
      break;
    case 'signal.ice':
      await mesh?.addIce(message.senderId, message.payload);
      break;
    case 'error':
      showError(message.code === 'ROOM_FULL' ? t('roomFull') : message.message || t('genericError'));
      recordJoinFailure(message.code);
      if (!message.recoverable) leaveRoom();
      break;
    case 'pong':
      break;
  }
}

function leaveRoom(updateUi = true): void {
  if (roomMetrics.joinAttempts > 0 || participants.size > 0) logRoomMetrics('room.left');
  signaling.send({ type: 'room.leave' });
  signaling.close();
  mesh?.closeAll();
  mesh = undefined;
  peerRecoveryTimers.forEach((timer) => window.clearTimeout(timer));
  peerRecoveryTimers.clear();
  participantRemovalTimers.forEach((timer) => window.clearTimeout(timer));
  participantRemovalTimers.clear();
  voice.stop();
  stopSpeakingMonitor?.();
  stopSpeakingMonitor = undefined;
  if (qualityTimer) window.clearInterval(qualityTimer);
  qualityTimer = undefined;
  audioBin.replaceChildren();
  participants.clear();
  peerMetrics.clear();
  peerQualityState.clear();
  remoteVolumes.clear();
  localMutedPeers.clear();
  roomMetrics = createRoomMetrics();
  lastSignalingState = undefined;
  focusedPeerId = undefined;
  lastSpeakingAt = 0;
  overlapCount = 0;
  wasOverlapping = false;
  speaking = false;
  muted = true;

  if (updateUi) {
    roomView.hidden = true;
    joinView.hidden = false;
    joinButton.disabled = false;
    joinButton.textContent = t('join');
    setConnectionStatus('closed');
    nameInput.focus();
    gaga.emit('gaga:room-left', { roomId, participantId });
    render();
  }
}

function setMuted(nextMuted: boolean): void {
  muted = nextMuted;
  voice.setMuted(muted);
  if (muted && speaking) speaking = false;
  updateLocalParticipant();
  signaling.send({ type: 'participant.update', payload: { muted, speaking } });
  gaga.emit(muted ? 'gaga:voice-muted' : 'gaga:voice-unmuted', { participantId });
  renderControls();
  renderParticipants();
}

function updateLocalParticipant(): void {
  participants.set(participantId, localParticipant());
  renderParticipants();
}

function localParticipant(): Participant {
  return {
    id: participantId,
    displayName,
    audioState: muted ? 'muted' : speaking ? 'speaking' : 'listening',
    connectionState: roomView.hidden ? 'idle' : 'connected',
    connectionQuality: 'unknown',
    isLocal: true
  };
}

function upsertRemoteParticipant(remote: SignalingParticipant): void {
  if (remote.id === participantId) return;
  const previous = participants.get(remote.id);
  const wasRecovering = previous?.connectionState === 'reconnecting' || previous?.connectionState === 'failed';
  const previousQuality = previous?.connectionQuality ?? peerQualityState.get(remote.id) ?? 'unknown';
  participants.set(remote.id, {
    id: remote.id,
    displayName: remote.displayName,
    audioState: remote.muted ? 'muted' : remote.speaking ? 'speaking' : 'listening',
    connectionState: 'connected',
    connectionQuality: previousQuality === 'reconnecting' ? 'unknown' : previousQuality
  });
  peerQualityState.delete(remote.id);
  if (wasRecovering) {
    gaga.emit('gaga:voice.recovered', { roomId, participantId: remote.id });
    showSoftStatus(t('reconnected'));
  }
  gaga.emit('gaga:voice.participant.connected', { roomId, participantId: remote.id });
}

function attachRemoteStream(peerId: string, stream: MediaStream): void {
  let audio = document.querySelector<HTMLAudioElement>(`audio[data-peer-id="${CSS.escape(peerId)}"]`);
  if (!audio) {
    audio = document.createElement('audio');
    audio.dataset.peerId = peerId;
    audio.autoplay = true;
    audioBin.append(audio);
  }
  audio.srcObject = stream;
  applyRemoteAudioPreferences(peerId);
  void applyAudioOutput(audio, audioOutputSelect.value);
  void audio.play().then(() => {
    audioEnableButton.hidden = true;
  }).catch(() => {
    audioEnableButton.hidden = false;
  });
}

function removeRemoteAudio(peerId: string): void {
  document.querySelector<HTMLAudioElement>(`audio[data-peer-id="${CSS.escape(peerId)}"]`)?.remove();
}

function applyRemoteAudioPreferences(peerId?: string): void {
  const audioNodes = Array.from(audioBin.querySelectorAll<HTMLAudioElement>('audio'));
  for (const audio of audioNodes) {
    const id = audio.dataset.peerId ?? '';
    if (peerId && id !== peerId) continue;
    const baseVolume = remoteVolumes.get(id) ?? 1;
    const focusVolume = focusedPeerId && focusedPeerId !== id ? Math.min(baseVolume, 0.35) : baseVolume;
    audio.volume = Math.max(0, Math.min(1, focusVolume));
    audio.muted = localMutedPeers.has(id);
  }
}

function cancelParticipantRemoval(peerId: string): void {
  const timer = participantRemovalTimers.get(peerId);
  if (!timer) return;
  window.clearTimeout(timer);
  participantRemovalTimers.delete(peerId);
}

function markAllRemoteParticipants(state: AdaptivePresence): void {
  for (const participant of participants.values()) {
    if (participant.isLocal || participant.connectionState === 'closed') continue;
    applyPresenceToParticipant(participant, state);
    participants.set(participant.id, participant);
  }
  render();
}

function markParticipantReconnecting(peerId: string): void {
  const participant = participants.get(peerId);
  if (!participant) return;
  applyPresenceToParticipant(participant, 'reconnecting');
  peerQualityState.set(peerId, 'reconnecting');
  participants.set(peerId, participant);
  gaga.emit('gaga:voice.participant.reconnecting', { roomId, participantId: peerId });
}

function scheduleParticipantRemoval(peerId: string): void {
  cancelParticipantRemoval(peerId);
  const timer = window.setTimeout(() => {
    participantRemovalTimers.delete(peerId);
    const participant = participants.get(peerId);
    if (!participant) return;
    applyPresenceToParticipant(participant, 'left');
    participants.set(peerId, participant);
    peerMetrics.delete(peerId);
    peerQualityState.delete(peerId);
    localMutedPeers.delete(peerId);
    remoteVolumes.delete(peerId);
    if (focusedPeerId === peerId) focusedPeerId = undefined;
    removeRemoteAudio(peerId);
    gaga.emit('gaga:voice.participant.left', { roomId, participantId: peerId });
    render();
  }, PARTICIPANT_RECONNECT_GRACE_MS);
  participantRemovalTimers.set(peerId, timer);
}

function applyPresenceToParticipant(participant: Participant, presence: AdaptivePresence): void {
  if (presence === 'joining') {
    participant.connectionState = 'connecting';
    participant.audioState = 'joining';
    return;
  }
  if (presence === 'reconnecting') {
    participant.connectionState = 'reconnecting';
    participant.audioState = 'reconnecting';
    return;
  }
  if (presence === 'offline') {
    participant.connectionState = 'failed';
    participant.audioState = 'offline';
    return;
  }
  if (presence === 'left') {
    participant.connectionState = 'closed';
    participant.audioState = 'left';
    return;
  }
  if (presence === 'poor-connection') {
    participant.connectionState = 'connected';
    participant.connectionQuality = 'poor';
  }
}

async function resumeRemoteAudio(): Promise<void> {
  const audioNodes = Array.from(audioBin.querySelectorAll<HTMLAudioElement>('audio'));
  const results = await Promise.allSettled(audioNodes.map((audio) => audio.play()));
  if (results.every((result) => result.status === 'fulfilled')) audioEnableButton.hidden = true;
}

function handlePeerConnectionState(peerId: string, state: RTCPeerConnectionState): void {
  const participant = participants.get(peerId);
  if (!participant) return;
  const metrics = recordPeerConnectionState(peerId, state);
  if (state === 'closed' && participantRemovalTimers.has(peerId)) {
    logClientEvent('webrtc.connection_state', { peerId, state, reconnectAttempts: metrics.reconnectAttempts });
    return;
  }
  participant.connectionState = peerUiState(state);
  if (participant.connectionState === 'reconnecting') participant.audioState = 'reconnecting';
  if (participant.connectionState === 'closed') participant.audioState = 'left';
  participants.set(peerId, participant);
  renderParticipants();

  gaga.emit('gaga:peer-connection-state', {
    peerId,
    state,
    reconnectAttempts: metrics.reconnectAttempts,
    timeline: metrics.connectionTimeline.join(',')
  });
  logClientEvent('webrtc.connection_state', { peerId, state, reconnectAttempts: metrics.reconnectAttempts });

  if (state === 'connected') {
    const timer = peerRecoveryTimers.get(peerId);
    if (timer) window.clearTimeout(timer);
    peerRecoveryTimers.delete(peerId);
    if (participant.audioState === 'reconnecting' || participant.connectionQuality === 'poor') {
      participant.audioState = 'listening';
      participant.connectionQuality = 'unknown';
      participants.set(peerId, participant);
      gaga.emit('gaga:voice.recovered', { roomId, participantId: peerId });
      showSoftStatus(t('reconnected'));
      render();
    }
    gaga.emit('gaga:peer-connected', { peerId });
    gaga.emit('gaga:voice.participant.connected', { roomId, participantId: peerId });
    return;
  }

  if (state === 'closed') {
    const timer = peerRecoveryTimers.get(peerId);
    if (timer) window.clearTimeout(timer);
    peerRecoveryTimers.delete(peerId);
    return;
  }

  const profile = roomModeProfile(roomMode);
  if (state === 'disconnected') schedulePeerRecovery(peerId, profile.recoveryDelayMs.disconnected, 'disconnected');
  if (state === 'failed') schedulePeerRecovery(peerId, profile.recoveryDelayMs.failed, 'failed');
}

function peerUiState(state: RTCPeerConnectionState): Participant['connectionState'] {
  if (state === 'connected') return 'connected';
  if (state === 'failed') return 'failed';
  if (state === 'closed') return 'closed';
  return 'reconnecting';
}

function schedulePeerRecovery(peerId: string, delayMs: number, reason: 'disconnected' | 'failed' | 'poor'): void {
  // Only one deterministic side initiates recovery, preventing offer glare.
  if (participantId.localeCompare(peerId) >= 0 || peerRecoveryTimers.has(peerId)) return;
  const metrics = metricsForPeer(peerId);
  metrics.reconnectAttempts += 1;
  gaga.emit('gaga:peer-recovery-scheduled', { peerId, reason, delayMs, reconnectAttempts: metrics.reconnectAttempts });
  logClientEvent('webrtc.recovery_scheduled', { peerId, reason, delayMs, reconnectAttempts: metrics.reconnectAttempts });
  const timer = window.setTimeout(() => {
    peerRecoveryTimers.delete(peerId);
    void recoverPeer(peerId, reason, metrics.reconnectAttempts);
  }, delayMs);
  peerRecoveryTimers.set(peerId, timer);
}

async function recoverPeer(peerId: string, reason: string, reconnectAttempts: number): Promise<void> {
  try {
    const offer = await mesh?.createOffer(peerId, true);
    if (offer) {
      signaling.send({ type: 'signal.offer', targetId: peerId, payload: offer });
      gaga.emit('gaga:peer-recovery-started', { peerId, reason, reconnectAttempts });
      logClientEvent('webrtc.recovery_started', { peerId, reason, reconnectAttempts });
      return;
    }
    gaga.emit('gaga:peer-recovery-failed', { peerId, reason: 'peer-manager-unavailable', reconnectAttempts });
    logClientEvent('webrtc.recovery_failed', { peerId, reason: 'peer-manager-unavailable', reconnectAttempts });
  } catch {
    gaga.emit('gaga:peer-recovery-failed', { peerId, reason, reconnectAttempts });
    logClientEvent('webrtc.recovery_failed', { peerId, reason, reconnectAttempts });
  }
}

function handlePeerIceConnectionState(peerId: string, state: RTCIceConnectionState): void {
  const metrics = recordPeerIceState(peerId, state);
  const failureReason = iceFailureReason(state);
  gaga.emit('gaga:peer-ice-state', {
    peerId,
    state,
    failureReason,
    reconnectAttempts: metrics.reconnectAttempts,
    timeline: metrics.iceTimeline.join(',')
  });
  logClientEvent('webrtc.ice_state', { peerId, state, failureReason, reconnectAttempts: metrics.reconnectAttempts });
}

function recordPeerConnectionState(peerId: string, state: RTCPeerConnectionState): PeerMetrics {
  const metrics = metricsForPeer(peerId);
  pushTimeline(metrics.connectionTimeline, metrics.startedAt, state);
  return metrics;
}

function recordPeerIceState(peerId: string, state: RTCIceConnectionState): PeerMetrics {
  const metrics = metricsForPeer(peerId);
  pushTimeline(metrics.iceTimeline, metrics.startedAt, state);
  return metrics;
}

function metricsForPeer(peerId: string): PeerMetrics {
  const existing = peerMetrics.get(peerId);
  if (existing) return existing;
  const created: PeerMetrics = {
    startedAt: Date.now(),
    connectionTimeline: [],
    iceTimeline: [],
    reconnectAttempts: 0
  };
  peerMetrics.set(peerId, created);
  return created;
}

function pushTimeline(timeline: string[], startedAt: number, state: string): void {
  timeline.push(`${state}@${Date.now() - startedAt}`);
  if (timeline.length > 12) timeline.shift();
}

function iceFailureReason(state: RTCIceConnectionState): string {
  if (state === 'failed') return navigator.onLine ? 'ice-negotiation-failed' : 'browser-offline';
  if (state === 'disconnected') return navigator.onLine ? 'ice-disconnected' : 'browser-offline';
  return 'none';
}

function createRoomMetrics(): RoomMetrics {
  return {
    joinAttempts: 0,
    joinSuccesses: 0,
    joinFailures: 0,
    reconnectCount: 0,
    roomStartedAt: 0,
    lastJoinRequestedAt: 0
  };
}

function recordJoinFailure(reason: string): void {
  roomMetrics.joinFailures += 1;
  gaga.emit('gaga:room-join-failed', { roomId, participantId, reason, ...roomMetricSnapshot() });
  logRoomMetrics('room.join_failed', { reason });
  renderDiagnostics('unknown', [], aggregatePeerQuality([]));
}

function mapMediaFailureReason(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  return 'unknown';
}

function logRoomMetrics(event: string, detail: ClientLogDetail = {}): void {
  const snapshot = roomMetricSnapshot();
  gaga.emit(`gaga:${event}`, { roomId, participantId, ...snapshot, ...detail });
  logClientEvent(event, { roomId, participantId, ...snapshot, ...detail });
}

function roomMetricSnapshot(): ClientLogDetail {
  return {
    roomDurationMs: roomDurationMs(),
    participantCount: participants.size,
    joinAttempts: roomMetrics.joinAttempts,
    joinSuccesses: roomMetrics.joinSuccesses,
    joinFailures: roomMetrics.joinFailures,
    joinSuccessRate: roomMetrics.joinAttempts > 0 ? round(roomMetrics.joinSuccesses / roomMetrics.joinAttempts, 3) : null,
    reconnectCount: roomMetrics.reconnectCount
  };
}

function roomDurationMs(): number {
  return roomMetrics.roomStartedAt > 0 ? Date.now() - roomMetrics.roomStartedAt : 0;
}

function qualityFromPeerMetrics(metrics: PeerQualityMetrics[]): ConnectionQuality {
  if (metrics.length === 0) return 'unknown';
  return qualityFromScore(worstQualityScore(metrics));
}

function worstQualityScore(metrics: PeerQualityMetrics[]): number {
  if (metrics.length === 0) return 100;
  return Math.min(...metrics.map((metric) => scoreConnectionQuality(metric)));
}

function aggregatePeerQuality(metrics: PeerQualityMetrics[]): ClientLogDetail {
  return {
    peerCount: metrics.length,
    qualityScore: metrics.length > 0 ? worstQualityScore(metrics) : null,
    avgRttMs: average(metrics.map((metric) => metric.rttMs)),
    packetLossPct: percentage(average(metrics.map((metric) => metric.packetLossRatio))),
    avgJitterMs: average(metrics.map((metric) => metric.jitterMs)),
    bitrateKbps: sum(metrics.map((metric) => metric.bitrateKbps)),
    maxIceStateDurationMs: max(metrics.map((metric) => metric.iceStateDurationMs)),
    totalPeerReconnects: [...peerMetrics.values()].reduce((total, metric) => total + metric.reconnectAttempts, 0)
  };
}

function renderDiagnostics(quality: ConnectionQuality, peerQuality: PeerQualityMetrics[], aggregate: ClientLogDetail): void {
  if (!DIAGNOSTICS_ENABLED || !diagnosticsPanel) return;
  diagnosticsPanel.hidden = false;
  diagnosticsPanel.textContent = JSON.stringify({
    room: roomMetricSnapshot(),
    quality,
    aggregate,
    peers: peerQuality
  }, null, 2);
}

function average(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numeric.length === 0) return null;
  return round(numeric.reduce((total, value) => total + value, 0) / numeric.length, 2);
}

function sum(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (numeric.length === 0) return null;
  return round(numeric.reduce((total, value) => total + value, 0), 2);
}

function max(values: number[]): number | null {
  const numeric = values.filter((value) => Number.isFinite(value));
  return numeric.length > 0 ? Math.max(...numeric) : null;
}

function percentage(value: number | null): number | null {
  return value == null ? null : round(value * 100, 2);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function logClientEvent(event: string, detail: ClientLogDetail): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...detail }));
}

async function loadIceServers(): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
  try {
    const base = new URL(SIGNALING_URL, window.location.href);
    base.protocol = base.protocol === 'wss:' ? 'https:' : base.protocol === 'ws:' ? 'http:' : base.protocol;
    base.pathname = base.pathname.replace(/\/$/, '') + '/turn';
    base.search = '';
    const response = await fetch(base, { headers: { Accept: 'application/json' } });
    if (!response.ok) return fallback;
    const data = (await response.json()) as TurnConfigurationResponse;
    return Array.isArray(data.iceServers) && data.iceServers.length > 0 ? data.iceServers : fallback;
  } catch {
    return fallback;
  }
}

function startQualityMonitor(): void {
  if (qualityTimer) window.clearInterval(qualityTimer);
  qualityTimer = window.setInterval(() => void updateQuality(), 5_000);
  void updateQuality();
}

async function applyAdaptiveAudio(score = 100): Promise<void> {
  const profile = roomModeProfile(roomMode);
  const policy = qualityPolicy(score, profile);
  const now = Date.now();
  const restoring = policy.maxAudioBitrate > activeAudioBitrate;
  const canApply = now - lastAudioProfileAt >= ADAPTIVE_AUDIO_COOLDOWN_MS || policy.maxAudioBitrate < activeAudioBitrate;
  if (!mesh || policy.maxAudioBitrate === activeAudioBitrate || !canApply) {
    updateOptimizingStatus(policy.optimizing);
    return;
  }

  const nextBitrate = restoring
    ? Math.min(policy.maxAudioBitrate, activeAudioBitrate + 4_000)
    : policy.maxAudioBitrate;
  activeAudioBitrate = nextBitrate;
  lastAudioProfileAt = now;
  await mesh.applyAudioProfile({ maxBitrate: nextBitrate });
  updateOptimizingStatus(policy.optimizing);
  gaga.emit('gaga:voice.audio.optimized', {
    roomId,
    participantId,
    roomMode,
    quality: policy.quality,
    score: policy.score,
    maxAudioBitrate: nextBitrate,
    restoring,
    shouldRecover: policy.shouldRecover
  });
  logClientEvent('webrtc.audio_optimized', {
    roomId,
    participantId,
    roomMode,
    quality: policy.quality,
    score: policy.score,
    maxAudioBitrate: nextBitrate,
    restoring,
    shouldRecover: policy.shouldRecover
  });
}

async function updateQuality(): Promise<void> {
  const peerQuality = (await mesh?.getPeerQualityMetrics()) ?? [];
  const quality = qualityFromPeerMetrics(peerQuality);
  const score = peerQuality.length > 0 ? worstQualityScore(peerQuality) : 100;
  const aggregate = aggregatePeerQuality(peerQuality);
  const profile = roomModeProfile(roomMode);
  for (const metric of peerQuality) {
    const peerScore = scoreConnectionQuality(metric);
    const peerQualityLabel = qualityFromScore(peerScore);
    const previousQuality = peerQualityState.get(metric.peerId);
    peerQualityState.set(metric.peerId, peerQualityLabel);
    const participant = participants.get(metric.peerId);
    if (participant) {
      participant.connectionQuality = peerQualityLabel;
      if (peerQualityLabel === 'poor') applyPresenceToParticipant(participant, 'poor-connection');
      participants.set(metric.peerId, participant);
    }
    if (previousQuality !== peerQualityLabel) {
      gaga.emit('gaga:voice.quality.changed', {
        roomId,
        participantId: metric.peerId,
        quality: peerQualityLabel,
        score: peerScore
      });
    }
    if (peerQualityLabel === 'poor' && metric.iceState !== 'connected' && metric.iceState !== 'completed') {
      schedulePeerRecovery(metric.peerId, profile.recoveryDelayMs.poor, 'poor');
    }
  }
  qualityLabel.dataset.quality = quality;
  qualityLabel.textContent = qualityText(quality);
  await applyAdaptiveAudio(score);
  gaga.emit('gaga:webrtc-quality-sample', {
    quality,
    score,
    ...aggregate,
    participantCount: participants.size,
    roomDurationMs: roomDurationMs(),
    reconnectCount: roomMetrics.reconnectCount
  });
  logClientEvent('webrtc.quality_sample', {
    quality,
    score,
    ...aggregate,
    participantCount: participants.size,
    roomDurationMs: roomDurationMs(),
    reconnectCount: roomMetrics.reconnectCount
  });
  renderDiagnostics(quality, peerQuality, aggregate);
  render();
}

function qualityText(quality: ConnectionQuality): string {
  if (quality === 'good') return t('qualityGood');
  if (quality === 'fair') return t('qualityFair');
  if (quality === 'poor') return t('qualityPoor');
  return t('qualityUnknown');
}

function setConnectionStatus(state: string): void {
  statusLabel.dataset.state = state;
  const key: TranslationKey = state === 'connected'
    ? 'connected'
    : state === 'reconnecting'
      ? 'reconnecting'
      : state === 'connecting' || state === 'requesting-microphone'
        ? 'connecting'
        : 'disconnected';
  statusLabel.textContent = t(key);
}

function updateOptimizingStatus(active: boolean): void {
  optimizingLabel.textContent = t('optimizingAudio');
  optimizingLabel.hidden = !active;
}

function showSoftStatus(message: string): void {
  optimizingLabel.textContent = message;
  optimizingLabel.hidden = false;
  window.setTimeout(() => {
    if (optimizingLabel.textContent === message) optimizingLabel.hidden = true;
  }, 2_500);
}

function render(): void {
  renderControls();
  renderParticipants();
  renderRoomPulse();
}

function renderControls(): void {
  muteButton.hidden = mode === 'push-to-talk';
  pttButton.hidden = mode !== 'push-to-talk';
  pttHint.hidden = mode !== 'push-to-talk';
  muteButton.textContent = muted ? t('unmute') : t('mute');
  muteButton.setAttribute('aria-pressed', String(!muted));
  pttButton.setAttribute('aria-pressed', String(!muted));
}

function renderParticipants(): void {
  participantList.replaceChildren();
  const sorted = [...participants.values()].sort((a, b) => Number(Boolean(b.isLocal)) - Number(Boolean(a.isLocal)) || a.displayName.localeCompare(b.displayName));

  for (const participant of sorted.slice(0, MAX_PARTICIPANTS)) {
    const presence = participantPresence(participant);
    const item = document.createElement('li');
    item.className = `gaga-participant-card gaga-presence-${presence} ${presence === 'speaking' ? 'gaga-is-speaking' : ''}`;

    const avatar = document.createElement('span');
    avatar.className = 'gaga-avatar';
    avatar.textContent = initials(participant.displayName);
    avatar.setAttribute('aria-hidden', 'true');

    const identity = document.createElement('span');
    identity.className = 'gaga-participant-identity';
    const name = document.createElement('strong');
    name.textContent = participant.isLocal ? `${participant.displayName} (${t('you')})` : participant.displayName;
    const state = document.createElement('small');
    state.textContent = presenceText(presence);
    identity.append(name, state);

    const badge = document.createElement('span');
    badge.className = `gaga-audio-badge gaga-is-${presence}`;
    badge.textContent = presenceGlyph(presence);
    badge.setAttribute('aria-label', state.textContent);

    item.append(avatar, identity, badge);
    if (!participant.isLocal && participant.connectionState !== 'closed') {
      item.append(remoteParticipantControls(participant.id));
    }
    participantList.append(item);
  }
}

function remoteParticipantControls(peerId: string): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'gaga-participant-controls';

  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.step = '5';
  volume.value = String(Math.round((remoteVolumes.get(peerId) ?? 1) * 100));
  volume.setAttribute('aria-label', t('volume'));
  volume.addEventListener('input', () => {
    remoteVolumes.set(peerId, Number(volume.value) / 100);
    applyRemoteAudioPreferences(peerId);
  });

  const focus = document.createElement('button');
  focus.type = 'button';
  focus.className = 'gaga-mini-button';
  focus.textContent = focusedPeerId === peerId ? t('unfocus') : t('focus');
  focus.addEventListener('click', () => {
    focusedPeerId = focusedPeerId === peerId ? undefined : peerId;
    applyRemoteAudioPreferences();
    renderParticipants();
  });

  const localMute = document.createElement('button');
  localMute.type = 'button';
  localMute.className = 'gaga-mini-button';
  localMute.textContent = localMutedPeers.has(peerId) ? t('unmute') : t('mute');
  localMute.addEventListener('click', () => {
    if (localMutedPeers.has(peerId)) localMutedPeers.delete(peerId);
    else localMutedPeers.add(peerId);
    applyRemoteAudioPreferences(peerId);
    renderParticipants();
  });

  controls.append(volume, focus, localMute);
  return controls;
}

function renderRoomPulse(): void {
  const visibleParticipants = [...participants.values()].filter((participant) => participant.connectionState !== 'closed' || participant.audioState === 'left');
  const snapshot = roomPulse(visibleParticipants, roomMode, {
    lastSpeakingAt,
    overlapCount
  });
  if (snapshot.speakingCount > 0) lastSpeakingAt = Date.now();
  const overlapping = snapshot.speakingCount > 1;
  if (overlapping && !wasOverlapping) overlapCount += 1;
  wasOverlapping = overlapping;
  pulseLabel.textContent = snapshot.pulse === 'quiet'
    ? t('pulseQuiet')
    : snapshot.speakingCount > 1
      ? `${snapshot.speakingCount} ${t('peopleSpeaking')}`
      : t('pulseActive');
}

function presenceText(presence: AdaptivePresence): string {
  if (presence === 'speaking') return t('speaking');
  if (presence === 'muted') return t('muted');
  if (presence === 'joining') return t('joiningState');
  if (presence === 'reconnecting') return t('reconnecting');
  if (presence === 'offline' || presence === 'poor-connection') return t('poorConnection');
  if (presence === 'left') return t('left');
  return t('listening');
}

function presenceGlyph(presence: AdaptivePresence): string {
  if (presence === 'speaking') return '◉';
  if (presence === 'muted') return '●';
  if (presence === 'reconnecting' || presence === 'joining') return '↻';
  if (presence === 'poor-connection' || presence === 'offline') return '!';
  if (presence === 'left') return '×';
  return '○';
}

function renderStaticText(): void {
  document.documentElement.lang = locale;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n as TranslationKey | undefined;
    if (key) element.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((element) => {
    const key = element.dataset.i18nAria as TranslationKey | undefined;
    if (key) element.setAttribute('aria-label', t(key));
  });
  nameInput.placeholder = locale === 'id-ID' ? 'Nama Anda' : 'Your name';
  roomInput.placeholder = locale === 'id-ID' ? 'contoh: operasi' : 'example: operations';
  joinButton.textContent = t('join');
  installButton.textContent = t('install');
  localeSelect.setAttribute('aria-label', t('language'));
  capacityLabel.textContent = `max ${MAX_PARTICIPANTS}`;
}

async function copyRoomLink(): Promise<void> {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  try {
    await navigator.clipboard.writeText(url.toString());
    const original = copyButton.textContent;
    copyButton.textContent = t('copied');
    window.setTimeout(() => {
      copyButton.textContent = original;
    }, 1_500);
  } catch {
    showError(t('copyFailed'));
  }
}

async function refreshAudioOutputs(): Promise<void> {
  const prototype = HTMLMediaElement.prototype as HTMLMediaElement & { setSinkId?: (deviceId: string) => Promise<void> };
  if (typeof prototype.setSinkId !== 'function' || !navigator.mediaDevices?.enumerateDevices) {
    audioOutputWrap.hidden = true;
    return;
  }

  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audiooutput');
    if (devices.length === 0) {
      audioOutputWrap.hidden = true;
      return;
    }

    const previous = localStorage.getItem('live-voice-audio-output') || 'default';
    audioOutputSelect.replaceChildren();
    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId || 'default';
      option.textContent = device.label || (index === 0 ? t('defaultOutput') : `${t('audioOutput')} ${index + 1}`);
      audioOutputSelect.append(option);
    });
    audioOutputSelect.value = devices.some((device) => device.deviceId === previous) ? previous : (devices[0]?.deviceId || 'default');
    audioOutputWrap.hidden = false;
    await setAudioOutput(audioOutputSelect.value);
  } catch {
    audioOutputWrap.hidden = true;
  }
}

async function setAudioOutput(deviceId: string): Promise<void> {
  localStorage.setItem('live-voice-audio-output', deviceId);
  const audioNodes = Array.from(audioBin.querySelectorAll<HTMLAudioElement>('audio'));
  await Promise.allSettled(audioNodes.map((audio) => applyAudioOutput(audio, deviceId)));
}

async function applyAudioOutput(audio: HTMLAudioElement, deviceId: string): Promise<void> {
  const sinkCapable = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof sinkCapable.setSinkId !== 'function') return;
  await sinkCapable.setSinkId(deviceId || 'default');
}

function updateUrlRoom(value: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('room', value);
  history.replaceState(null, '', url);
}

async function installPwa(): Promise<void> {
  if (!beforeInstallPrompt) return;
  await beforeInstallPrompt.prompt();
  await beforeInstallPrompt.userChoice;
  beforeInstallPrompt = undefined;
  installButton.hidden = true;
}

function updateOnlineState(): void {
  offlineBanner.hidden = navigator.onLine;
}

function showError(message: string): void {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.focus();
}

function clearError(): void {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function mapMediaError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return t('micDenied');
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return t('micMissing');
  }
  return t('genericError');
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

function getOrCreateParticipantId(): string {
  const key = 'live-voice-participant-id';
  const current = localStorage.getItem(key);
  if (current && /^[a-f0-9-]{16,64}$/i.test(current)) return current;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}

function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
  }
}

function resolveSignalingUrl(): string {
  const configured = import.meta.env.PUBLIC_SIGNALING_URL?.trim();
  if (configured) return configured;

  const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return isLocalDev ? 'http://127.0.0.1:8787' : window.location.origin;
}
