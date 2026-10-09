import type { ConnectionQuality } from '@live-voice/shared-types';

export interface PeerCallbacks {
  sendIce: (targetId: string, candidate: RTCIceCandidateInit) => void;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onConnectionState: (peerId: string, state: RTCPeerConnectionState) => void;
  onIceConnectionState: (peerId: string, state: RTCIceConnectionState) => void;
}

export interface PeerQualityMetrics {
  peerId: string;
  rttMs: number | null;
  packetLossRatio: number | null;
  jitterMs: number | null;
  bitrateKbps: number | null;
  iceState: RTCIceConnectionState;
  iceStateDurationMs: number;
  iceStateDurationsMs: Partial<Record<RTCIceConnectionState, number>>;
}

interface PeerRecord {
  connection: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  iceState: RTCIceConnectionState;
  iceStateChangedAt: number;
  iceStateDurationsMs: Partial<Record<RTCIceConnectionState, number>>;
  lastStats?: {
    timestamp: number;
    bytesSent: number;
    bytesReceived: number;
  };
}

export class VoiceEngine {
  private stream: MediaStream | undefined;
  private audioContext: AudioContext | undefined;
  private localAnalyser: AnalyserNode | undefined;
  private localSpeakingTimer: number | undefined;
  private muted = true;

  async startMicrophone(): Promise<MediaStream> {
    if (this.stream?.active) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: false
    });
    this.setMuted(this.muted);
    return this.stream;
  }

  getStream(): MediaStream | undefined {
    return this.stream;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  isMuted(): boolean {
    return this.muted;
  }

  monitorLocalSpeaking(onChange: (speaking: boolean) => void): () => void {
    if (!this.stream) return () => undefined;
    this.audioContext ??= new AudioContext();
    void this.audioContext.resume().catch(() => undefined);
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.localAnalyser = this.audioContext.createAnalyser();
    this.localAnalyser.fftSize = 512;
    source.connect(this.localAnalyser);

    const data = new Uint8Array(this.localAnalyser.fftSize);
    let previous = false;
    let quietFrames = 0;

    const sample = () => {
      if (!this.localAnalyser) return;
      this.localAnalyser.getByteTimeDomainData(data);
      let energy = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / data.length);
      const active = !this.muted && rms > 0.035;
      quietFrames = active ? 0 : quietFrames + 1;
      const speaking = active || (previous && quietFrames < 3);
      if (speaking !== previous) {
        previous = speaking;
        onChange(speaking);
      }
      this.localSpeakingTimer = window.setTimeout(sample, 120);
    };

    sample();
    return () => {
      if (this.localSpeakingTimer) window.clearTimeout(this.localSpeakingTimer);
      this.localSpeakingTimer = undefined;
      this.localAnalyser?.disconnect();
      this.localAnalyser = undefined;
    };
  }

  stop(): void {
    if (this.localSpeakingTimer) window.clearTimeout(this.localSpeakingTimer);
    this.localSpeakingTimer = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    void this.audioContext?.close();
    this.audioContext = undefined;
  }
}

export class MeshPeerManager {
  private peers = new Map<string, PeerRecord>();

  constructor(
    private readonly localStream: MediaStream,
    private readonly iceServers: RTCIceServer[],
    private readonly callbacks: PeerCallbacks
  ) {}

  async createOffer(peerId: string, iceRestart = false): Promise<RTCSessionDescriptionInit> {
    const peer = this.ensurePeer(peerId);
    const offer = await peer.connection.createOffer({ offerToReceiveAudio: true, iceRestart });
    await peer.connection.setLocalDescription(offer);
    return offer;
  }

  async acceptOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    const peer = this.ensurePeer(peerId);
    await peer.connection.setRemoteDescription(offer);
    await this.flushIce(peer);
    const answer = await peer.connection.createAnswer();
    await peer.connection.setLocalDescription(answer);
    return answer;
  }

  async acceptAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    await peer.connection.setRemoteDescription(answer);
    await this.flushIce(peer);
  }

  async addIce(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.ensurePeer(peerId);
    if (!peer.connection.remoteDescription) {
      peer.pendingIce.push(candidate);
      return;
    }
    await peer.connection.addIceCandidate(candidate);
  }

  remove(peerId: string): void {
    this.peers.get(peerId)?.connection.close();
    this.peers.delete(peerId);
  }

  async getAggregateQuality(): Promise<ConnectionQuality> {
    const metrics = await this.getPeerQualityMetrics();
    if (metrics.length === 0) return 'unknown';
    let worstScore = 0;

    for (const metric of metrics) {
      const rttMs = metric.rttMs ?? 0;
      const loss = metric.packetLossRatio ?? 0;
      const score = rttMs > 400 || loss > 0.08 ? 2 : rttMs > 200 || loss > 0.03 ? 1 : 0;
      worstScore = Math.max(worstScore, score);
    }

    return worstScore === 2 ? 'poor' : worstScore === 1 ? 'fair' : 'good';
  }

  async getPeerQualityMetrics(): Promise<PeerQualityMetrics[]> {
    const snapshots: PeerQualityMetrics[] = [];
    for (const [peerId, peer] of this.peers) {
      const stats = await peer.connection.getStats();
      let rttMs: number | null = null;
      let packetsLost = 0;
      let packetsReceived = 0;
      let jitterMs: number | null = null;
      let bytesSent = 0;
      let bytesReceived = 0;
      let timestamp = 0;

      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
          rttMs = Math.round(Number(report.currentRoundTripTime) * 1000);
        }
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packetsLost += Number(report.packetsLost ?? 0);
          packetsReceived += Number(report.packetsReceived ?? 0);
          if (report.jitter != null) jitterMs = Math.max(jitterMs ?? 0, Math.round(Number(report.jitter) * 1000));
          bytesReceived += Number(report.bytesReceived ?? 0);
          timestamp = Math.max(timestamp, Number(report.timestamp ?? 0));
        }
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          bytesSent += Number(report.bytesSent ?? 0);
          timestamp = Math.max(timestamp, Number(report.timestamp ?? 0));
        }
      });

      let bitrateKbps: number | null = null;
      const previous = peer.lastStats;
      if (previous && timestamp > previous.timestamp) {
        const deltaBytes = Math.max(0, bytesSent + bytesReceived - previous.bytesSent - previous.bytesReceived);
        bitrateKbps = Math.round((deltaBytes * 8) / ((timestamp - previous.timestamp) / 1000) / 1000);
      }
      if (timestamp > 0) peer.lastStats = { timestamp, bytesSent, bytesReceived };

      const packetTotal = packetsLost + packetsReceived;
      const iceDurations = this.currentIceDurations(peer);
      snapshots.push({
        peerId,
        rttMs,
        packetLossRatio: packetTotal > 0 ? packetsLost / packetTotal : null,
        jitterMs,
        bitrateKbps,
        iceState: peer.iceState,
        iceStateDurationMs: Date.now() - peer.iceStateChangedAt,
        iceStateDurationsMs: iceDurations
      });
    }
    return snapshots;
  }

  closeAll(): void {
    this.peers.forEach(({ connection }) => connection.close());
    this.peers.clear();
  }

  private ensurePeer(peerId: string): PeerRecord {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle'
    });
    const record: PeerRecord = {
      connection,
      pendingIce: [],
      iceState: connection.iceConnectionState,
      iceStateChangedAt: Date.now(),
      iceStateDurationsMs: {}
    };
    this.peers.set(peerId, record);

    this.localStream.getTracks().forEach((track) => connection.addTrack(track, this.localStream));

    connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) this.callbacks.sendIce(peerId, event.candidate.toJSON());
    });

    connection.addEventListener('track', (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.callbacks.onRemoteStream(peerId, stream);
    });

    connection.addEventListener('connectionstatechange', () => {
      this.callbacks.onConnectionState(peerId, connection.connectionState);
    });

    connection.addEventListener('iceconnectionstatechange', () => {
      this.recordIceState(record, connection.iceConnectionState);
      this.callbacks.onIceConnectionState(peerId, connection.iceConnectionState);
    });

    return record;
  }

  private recordIceState(peer: PeerRecord, nextState: RTCIceConnectionState): void {
    if (peer.iceState === nextState) return;
    const now = Date.now();
    peer.iceStateDurationsMs[peer.iceState] = (peer.iceStateDurationsMs[peer.iceState] ?? 0) + now - peer.iceStateChangedAt;
    peer.iceState = nextState;
    peer.iceStateChangedAt = now;
  }

  private currentIceDurations(peer: PeerRecord): Partial<Record<RTCIceConnectionState, number>> {
    return {
      ...peer.iceStateDurationsMs,
      [peer.iceState]: (peer.iceStateDurationsMs[peer.iceState] ?? 0) + Date.now() - peer.iceStateChangedAt
    };
  }

  private async flushIce(peer: PeerRecord): Promise<void> {
    const queued = peer.pendingIce.splice(0);
    for (const candidate of queued) {
      await peer.connection.addIceCandidate(candidate);
    }
  }
}
