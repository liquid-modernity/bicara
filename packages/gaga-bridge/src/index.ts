import {
  defineCapability,
  inspectCapability,
  serializeCapabilityDescriptor,
  type CapabilityInspection,
  type SerializableCapabilityDescriptor
} from '@gaga/engine/capabilities';
import {
  createDiagnostics,
  type DiagnosticEvent,
  type DiagnosticMetadata,
  type DiagnosticsSink
} from '@gaga/engine/diagnostics';
import { createRuntimeLifecycle, type RuntimeLifecycle } from '@gaga/engine-web/runtime/lifecycle';

export const GAGA_ENGINE_VERSION = '0.1.6' as const;
export const LIVE_VOICE_CAPABILITY_ID = 'gaga.capability.live-voice.rooms' as const;

export type LiveVoiceMode = 'open-mic' | 'push-to-talk';

export interface LiveVoiceGagaConfig {
  defaultRoom: string;
  maxParticipants: number;
  supportedModes: readonly LiveVoiceMode[];
}

export interface GagaRuntimeOptions {
  applicationId: 'live-voice';
  config: LiveVoiceGagaConfig;
  eventTarget?: EventTarget;
  diagnosticsSink?: DiagnosticsSink;
}

export interface GagaRuntimeBoundary {
  readonly version: typeof GAGA_ENGINE_VERSION;
  readonly applicationId: 'live-voice';
  readonly capability: SerializableCapabilityDescriptor;
  readonly inspection: CapabilityInspection;
}

export interface LiveVoiceGagaRuntime {
  readonly boundary: GagaRuntimeBoundary;
  readonly lifecycle: RuntimeLifecycle;
  emit<T extends DiagnosticMetadata>(name: `gaga:${string}`, detail: T): void;
  destroy(): boolean;
}

const liveVoiceCapability = defineCapability<LiveVoiceGagaConfig>({
  id: LIVE_VOICE_CAPABILITY_ID,
  version: '0.0.7',
  executionContext: 'BROWSER',
  stability: 'PUBLIC_EXPERIMENTAL',
  publicEntrypoint: '@live-voice/gaga-bridge',
  summary: 'Guest-first browser voice rooms using GAGA lifecycle contracts with WebRTC media transport.',
  dependencies: ['websocket', 'webrtc.peer-connection', 'media-devices.microphone'],
  operationalProfile: {
    clientRuntimeRequired: true,
    visitorNetworkRequired: true,
    persistentBackendRequired: true,
    thirdPartyProviderRequired: false,
    selfHostable: true,
    offlineCapable: false,
    buildTimeCapable: false
  },
  validateConfig(value) {
    if (!isRecord(value)) return { ok: false, reason: 'Config must be an object.' };
    if (typeof value.defaultRoom !== 'string' || value.defaultRoom.length === 0 || value.defaultRoom.length > 48) {
      return { ok: false, reason: 'defaultRoom must be a non-empty room id up to 48 characters.' };
    }
    const maxParticipants = value.maxParticipants;
    if (typeof maxParticipants !== 'number' || !Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 25) {
      return { ok: false, reason: 'maxParticipants must be an integer from 2 to 25.' };
    }
    if (!Array.isArray(value.supportedModes) || !value.supportedModes.every(isLiveVoiceMode)) {
      return { ok: false, reason: 'supportedModes must contain only supported Live Voice modes.' };
    }
    return { ok: true, value: value as unknown as LiveVoiceGagaConfig };
  }
});

let runtime: LiveVoiceGagaRuntime | undefined;

export function initializeGagaRuntime(options: GagaRuntimeOptions): LiveVoiceGagaRuntime {
  if (runtime) return runtime;

  const eventTarget = options.eventTarget ?? defaultEventTarget();
  const diagnostics = createDiagnostics({
    sink: options.diagnosticsSink ?? domDiagnosticsSink(eventTarget)
  });
  const lifecycle = createRuntimeLifecycle();
  lifecycle.start();

  const inspection = inspectCapability(liveVoiceCapability, {
    executionContext: 'BROWSER',
    availableDependencies: availableBrowserDependencies(),
    config: options.config
  });

  const boundary: GagaRuntimeBoundary = Object.freeze({
    version: GAGA_ENGINE_VERSION,
    applicationId: options.applicationId,
    capability: serializeCapabilityDescriptor(liveVoiceCapability),
    inspection
  });

  runtime = Object.freeze({
    boundary,
    lifecycle,
    emit<T extends DiagnosticMetadata>(name: `gaga:${string}`, detail: T) {
      const diagnostic = diagnostics.emit({
        namespace: 'gaga.live-voice',
        event: toDiagnosticEventName(name),
        capability: LIVE_VOICE_CAPABILITY_ID,
        engineVersion: GAGA_ENGINE_VERSION,
        severity: 'info',
        outcome: 'success',
        metadata: detail
      });
      dispatch(eventTarget, name, { ...detail, diagnostic });
    },
    destroy() {
      const destroyed = lifecycle.destroy();
      runtime = undefined;
      return destroyed;
    }
  });

  runtime.emit('gaga:engine-ready', {
    applicationId: boundary.applicationId,
    capability: boundary.capability.id,
    capabilityAvailable: boundary.inspection.availability.available,
    engineVersion: boundary.version
  });

  return runtime;
}

export function currentGagaRuntime(): LiveVoiceGagaRuntime | undefined {
  return runtime;
}

function availableBrowserDependencies(): readonly string[] {
  if (typeof window === 'undefined') return [];

  const dependencies: string[] = [];
  if ('WebSocket' in window) dependencies.push('websocket');
  if ('RTCPeerConnection' in window) dependencies.push('webrtc.peer-connection');
  if (typeof navigator.mediaDevices?.getUserMedia === 'function') dependencies.push('media-devices.microphone');
  return dependencies;
}

function domDiagnosticsSink(eventTarget: EventTarget | undefined): DiagnosticsSink {
  return {
    emit(event: DiagnosticEvent) {
      dispatch(eventTarget, 'gaga:diagnostic', event);
    }
  };
}

function dispatch<T>(eventTarget: EventTarget | undefined, name: string, detail: T): void {
  eventTarget?.dispatchEvent(new CustomEvent(name, { detail }));
}

function defaultEventTarget(): EventTarget | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function toDiagnosticEventName(name: `gaga:${string}`): `gaga.${string}` {
  return `gaga.live-voice.${name.slice('gaga:'.length).replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`;
}

function isLiveVoiceMode(value: unknown): value is LiveVoiceMode {
  return value === 'open-mic' || value === 'push-to-talk';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
