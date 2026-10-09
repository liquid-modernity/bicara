import { emitGagaEvent, initializeGagaBoundary } from '@live-voice/gaga-bridge';
import { MeshPeerManager, VoiceEngine } from '@live-voice/rtc-core';
import type {
  ConnectionQuality,
  Participant,
  ServerSignalMessage,
  SignalingParticipant,
  TurnConfigurationResponse,
  VoiceMode
} from '@live-voice/shared-types';
import { SignalingClient } from '@live-voice/signaling-client';
import { normalizeDisplayName, normalizeRoomId } from '@live-voice/voice-domain';
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
const localeSelect = $('#locale-select') as HTMLSelectElement;
const installButton = $('#install-button') as HTMLButtonElement;
const audioEnableButton = $('#enable-audio-button') as HTMLButtonElement;
const audioOutputWrap = $('#audio-output-wrap');
const audioOutputSelect = $('#audio-output') as HTMLSelectElement;
const capacityLabel = $('#capacity-label');
const offlineBanner = $('#offline-banner');
const pttHint = $('#ptt-hint');

const SIGNALING_URL = import.meta.env.PUBLIC_SIGNALING_URL?.trim() || 'http://127.0.0.1:8787';
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
let participants = new Map<string, Participant>();
let serverParticipants = new Map<string, SignalingParticipant>();
let stopSpeakingMonitor: (() => void) | undefined;
let qualityTimer: number | undefined;
const peerRecoveryTimers = new Map<string, number>();
let beforeInstallPrompt: BeforeInstallPromptEvent | undefined;
let locale = detectLocale();
let t = createTranslator(locale);

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

initializeGagaBoundary();
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
    emitGagaEvent('gaga:voice-mode-changed', { mode });
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

  signaling.onState((state) => {
    if (state === 'connecting') setConnectionStatus('connecting');
    if (state === 'reconnecting') setConnectionStatus('reconnecting');
    if (state === 'failed') {
      setConnectionStatus('failed');
      showError(t('genericError'));
    }
  });
  signaling.onMessage((message) => {
    void handleSignal(message).catch(() => {
      showError(t('genericError'));
    });
  });

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
  window.addEventListener('beforeunload', () => leaveRoom(false));
}

async function joinRoom(): Promise<void> {
  clearError();
  displayName = normalizeDisplayName(nameInput.value);
  roomId = normalizeRoomId(roomInput.value);

  if (!displayName) {
    nameInput.focus();
    return;
  }
  if (!roomId) {
    roomInput.focus();
    return;
  }
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    showError(t('secureRequired'));
    return;
  }
  if (!navigator.onLine) {
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
      onConnectionState: handlePeerConnectionState
    });

    muted = mode === 'push-to-talk';
    voice.setMuted(muted);
    localStorage.setItem('live-voice-display-name', displayName);

    participants.clear();
    serverParticipants.clear();
    participants.set(participantId, localParticipant());

    stopSpeakingMonitor?.();
    stopSpeakingMonitor = voice.monitorLocalSpeaking((active) => {
      speaking = active;
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
    emitGagaEvent('gaga:room-join-requested', { roomId, participantId });
    render();
  } catch (error) {
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
      serverParticipants = new Map(message.participants.map((participant) => [participant.id, participant]));
      participants = new Map([[participantId, localParticipant()]]);
      for (const participant of message.participants) upsertRemoteParticipant(participant);
      setConnectionStatus('connected');
      joinButton.disabled = false;
      joinButton.textContent = t('join');
      signaling.send({ type: 'participant.update', payload: { muted, speaking } });

      for (const participant of message.participants) {
        if (participant.id === participantId) continue;
        const offer = await mesh?.createOffer(participant.id, true);
        if (offer) signaling.send({ type: 'signal.offer', targetId: participant.id, payload: offer });
      }
      emitGagaEvent('gaga:room-joined', { roomId, participantId, participantCount: participants.size });
      render();
      break;
    }
    case 'participant.joined':
      serverParticipants.set(message.participant.id, message.participant);
      upsertRemoteParticipant(message.participant);
      render();
      break;
    case 'participant.updated':
      serverParticipants.set(message.participant.id, message.participant);
      upsertRemoteParticipant(message.participant);
      render();
      break;
    case 'participant.left':
      serverParticipants.delete(message.participantId);
      participants.delete(message.participantId);
      mesh?.remove(message.participantId);
      removeRemoteAudio(message.participantId);
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
      if (!message.recoverable) leaveRoom();
      break;
    case 'pong':
      break;
  }
}

function leaveRoom(updateUi = true): void {
  signaling.send({ type: 'room.leave' });
  signaling.close();
  mesh?.closeAll();
  mesh = undefined;
  peerRecoveryTimers.forEach((timer) => window.clearTimeout(timer));
  peerRecoveryTimers.clear();
  voice.stop();
  stopSpeakingMonitor?.();
  stopSpeakingMonitor = undefined;
  if (qualityTimer) window.clearInterval(qualityTimer);
  qualityTimer = undefined;
  audioBin.replaceChildren();
  participants.clear();
  serverParticipants.clear();
  speaking = false;
  muted = true;

  if (updateUi) {
    roomView.hidden = true;
    joinView.hidden = false;
    joinButton.disabled = false;
    joinButton.textContent = t('join');
    setConnectionStatus('closed');
    nameInput.focus();
    emitGagaEvent('gaga:room-left', { roomId, participantId });
    render();
  }
}

function setMuted(nextMuted: boolean): void {
  muted = nextMuted;
  voice.setMuted(muted);
  if (muted && speaking) speaking = false;
  updateLocalParticipant();
  signaling.send({ type: 'participant.update', payload: { muted, speaking } });
  emitGagaEvent(muted ? 'gaga:voice-muted' : 'gaga:voice-unmuted', { participantId });
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
  participants.set(remote.id, {
    id: remote.id,
    displayName: remote.displayName,
    audioState: remote.muted ? 'muted' : remote.speaking ? 'speaking' : 'listening',
    connectionState: 'connected',
    connectionQuality: 'unknown'
  });
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

async function resumeRemoteAudio(): Promise<void> {
  const audioNodes = Array.from(audioBin.querySelectorAll<HTMLAudioElement>('audio'));
  const results = await Promise.allSettled(audioNodes.map((audio) => audio.play()));
  if (results.every((result) => result.status === 'fulfilled')) audioEnableButton.hidden = true;
}

function handlePeerConnectionState(peerId: string, state: RTCPeerConnectionState): void {
  const participant = participants.get(peerId);
  if (!participant) return;
  participant.connectionState = state === 'connected' ? 'connected' : state === 'failed' ? 'failed' : 'reconnecting';
  participants.set(peerId, participant);
  renderParticipants();

  if (state === 'connected') {
    const timer = peerRecoveryTimers.get(peerId);
    if (timer) window.clearTimeout(timer);
    peerRecoveryTimers.delete(peerId);
    return;
  }

  // Only one deterministic side initiates recovery, preventing offer glare.
  if (state === 'failed' && participantId.localeCompare(peerId) < 0 && !peerRecoveryTimers.has(peerId)) {
    const timer = window.setTimeout(() => {
      peerRecoveryTimers.delete(peerId);
      void recoverPeer(peerId);
    }, 750);
    peerRecoveryTimers.set(peerId, timer);
  }
}

async function recoverPeer(peerId: string): Promise<void> {
  try {
    const offer = await mesh?.createOffer(peerId, true);
    if (offer) signaling.send({ type: 'signal.offer', targetId: peerId, payload: offer });
  } catch {
    // A later signaling reconnect will retry negotiation with the current room roster.
  }
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

async function updateQuality(): Promise<void> {
  const quality = (await mesh?.getAggregateQuality()) ?? 'unknown';
  qualityLabel.dataset.quality = quality;
  qualityLabel.textContent = qualityText(quality);
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

function render(): void {
  renderControls();
  renderParticipants();
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
    const item = document.createElement('li');
    item.className = `gaga-participant-card ${participant.audioState === 'speaking' ? 'gaga-is-speaking' : ''}`;

    const avatar = document.createElement('span');
    avatar.className = 'gaga-avatar';
    avatar.textContent = initials(participant.displayName);
    avatar.setAttribute('aria-hidden', 'true');

    const identity = document.createElement('span');
    identity.className = 'gaga-participant-identity';
    const name = document.createElement('strong');
    name.textContent = participant.isLocal ? `${participant.displayName} (${t('you')})` : participant.displayName;
    const state = document.createElement('small');
    state.textContent = participant.audioState === 'muted' ? t('muted') : participant.audioState === 'speaking' ? t('speaking') : t('listening');
    identity.append(name, state);

    const badge = document.createElement('span');
    badge.className = `gaga-audio-badge gaga-is-${participant.audioState}`;
    badge.textContent = participant.audioState === 'muted' ? '●' : participant.audioState === 'speaking' ? '◉' : '○';
    badge.setAttribute('aria-label', state.textContent);

    item.append(avatar, identity, badge);
    participantList.append(item);
  }
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
