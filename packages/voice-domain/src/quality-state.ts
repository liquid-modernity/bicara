import type { ConnectionQuality } from '@live-voice/shared-types';
import type { RoomModeProfile } from './room-mode';

export type QualityScore = number;

export interface QualityInputs {
  rttMs?: number | null;
  packetLossRatio?: number | null;
  jitterMs?: number | null;
  bitrateKbps?: number | null;
  iceState?: RTCIceConnectionState | 'unknown';
}

export interface QualityPolicy {
  score: QualityScore;
  quality: ConnectionQuality | 'reconnecting';
  optimizing: boolean;
  maxAudioBitrate: number;
  shouldRecover: boolean;
}

export function scoreConnectionQuality(input: QualityInputs): QualityScore {
  let score = 100;
  const rttMs = normalizeNumber(input.rttMs);
  const packetLossRatio = normalizeNumber(input.packetLossRatio);
  const jitterMs = normalizeNumber(input.jitterMs);
  const bitrateKbps = normalizeNumber(input.bitrateKbps);

  if (rttMs != null) score -= clamp((rttMs - 120) / 8, 0, 32);
  if (packetLossRatio != null) score -= clamp(packetLossRatio * 420, 0, 42);
  if (jitterMs != null) score -= clamp((jitterMs - 20) / 2, 0, 24);
  if (bitrateKbps != null && bitrateKbps > 0) score -= clamp((18 - bitrateKbps) * 1.8, 0, 18);

  if (input.iceState === 'checking' || input.iceState === 'disconnected') score -= 18;
  if (input.iceState === 'failed' || input.iceState === 'closed') score -= 55;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function qualityFromScore(score: QualityScore): ConnectionQuality {
  if (score >= 80) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

export function qualityPolicy(scoreOrQuality: QualityScore | ConnectionQuality | 'reconnecting', profile: RoomModeProfile): QualityPolicy {
  const score = typeof scoreOrQuality === 'number'
    ? Math.max(0, Math.min(100, Math.round(scoreOrQuality)))
    : scoreOrQuality === 'reconnecting'
      ? 20
      : qualityScoreFloor(scoreOrQuality);
  const quality = scoreOrQuality === 'reconnecting' ? 'reconnecting' : qualityFromScore(score);

  if (quality === 'poor') {
    return { score, quality, optimizing: true, maxAudioBitrate: Math.min(profile.maxAudioBitrate, 18_000), shouldRecover: true };
  }
  if (quality === 'fair') {
    return { score, quality, optimizing: true, maxAudioBitrate: Math.min(profile.maxAudioBitrate, 24_000), shouldRecover: false };
  }
  if (quality === 'reconnecting') {
    return { score, quality, optimizing: true, maxAudioBitrate: Math.min(profile.maxAudioBitrate, 16_000), shouldRecover: true };
  }
  return { score, quality, optimizing: false, maxAudioBitrate: profile.maxAudioBitrate, shouldRecover: false };
}

function qualityScoreFloor(quality: ConnectionQuality): QualityScore {
  if (quality === 'good') return 90;
  if (quality === 'fair') return 65;
  if (quality === 'poor') return 35;
  return 100;
}

function normalizeNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
