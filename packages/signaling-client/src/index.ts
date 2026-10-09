import type { ClientSignalMessage, ServerSignalMessage } from '@live-voice/shared-types';

type MessageHandler = (message: ServerSignalMessage) => void;
type StateHandler = (state: 'connecting' | 'open' | 'closed' | 'reconnecting' | 'failed') => void;

export interface SignalingConnectOptions {
  baseUrl: string;
  roomId: string;
  participantId: string;
  displayName: string;
}

export class SignalingClient {
  private socket: WebSocket | undefined;
  private connectOptions: SignalingConnectOptions | undefined;
  private messageHandlers = new Set<MessageHandler>();
  private stateHandlers = new Set<StateHandler>();
  private reconnectTimer: number | undefined;
  private reconnectAttempts = 0;
  private intentionalClose = false;

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onState(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  connect(options: SignalingConnectOptions): void {
    this.connectOptions = options;
    this.intentionalClose = false;
    this.openSocket(false);
  }

  send(message: ClientSignalMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close(1000, 'client_leave');
    this.socket = undefined;
    this.emitState('closed');
  }

  private openSocket(reconnect: boolean): void {
    const options = this.connectOptions;
    if (!options) return;

    this.emitState(reconnect ? 'reconnecting' : 'connecting');
    const url = this.buildUrl(options);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      this.reconnectAttempts = 0;
      this.emitState('open');
    });

    socket.addEventListener('message', (event) => {
      if (socket !== this.socket || typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data) as ServerSignalMessage;
        this.messageHandlers.forEach((handler) => handler(message));
      } catch {
        // Ignore malformed server payloads. The worker validates protocol messages.
      }
    });

    socket.addEventListener('close', () => {
      if (socket !== this.socket) return;
      this.emitState('closed');
      if (!this.intentionalClose) this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      if (socket !== this.socket) return;
      // close event owns reconnect scheduling.
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || !this.connectOptions) return;
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 8) {
      this.emitState('failed');
      return;
    }

    const base = Math.min(12_000, 750 * 2 ** (this.reconnectAttempts - 1));
    const jitter = Math.floor(Math.random() * 400);
    this.emitState('reconnecting');
    this.reconnectTimer = window.setTimeout(() => this.openSocket(true), base + jitter);
  }

  private buildUrl(options: SignalingConnectOptions): string {
    const url = new URL(options.baseUrl, window.location.href);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    url.pathname = url.pathname.replace(/\/$/, '') + '/signal';
    url.searchParams.set('room', options.roomId);
    url.searchParams.set('participant', options.participantId);
    url.searchParams.set('name', options.displayName);
    return url.toString();
  }

  private emitState(state: Parameters<StateHandler>[0]): void {
    this.stateHandlers.forEach((handler) => handler(state));
  }
}
