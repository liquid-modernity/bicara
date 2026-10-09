import { DurableObject } from 'cloudflare:workers';
import type { ClientSignalMessage, SignalingParticipant } from '@live-voice/shared-types';

interface Env {
  ROOMS: DurableObjectNamespace<VoiceRoom>;
  MAX_PARTICIPANTS?: string;
  ALLOWED_ORIGINS?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  TURN_TTL_SECONDS?: string;
}

interface SocketAttachment {
  participantId: string;
  displayName: string;
  roomId: string;
  muted: boolean;
  speaking: boolean;
  joinedAt: number;
}

type ClientMessage = ClientSignalMessage;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_MESSAGE_BYTES = 96 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const cors = corsHeaders(request, env);

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }

      if (url.pathname === '/health') {
        return Response.json({ ok: true, service: 'live-voice-signaling', version: '0.0.8' }, { headers: cors });
      }

      if (url.pathname === '/turn') {
        if (!originAllowed(request, env)) {
          logWorkerEvent('worker.origin_denied', { metric: 'rejected_connection', path: url.pathname, origin: request.headers.get('Origin') ?? 'missing' });
          return jsonError('ORIGIN_NOT_ALLOWED', 403, cors);
        }
        return turnConfiguration(env, cors);
      }

      if (url.pathname === '/signal') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          logWorkerEvent('worker.websocket_required', { metric: 'rejected_connection', path: url.pathname });
          return jsonError('WEBSOCKET_REQUIRED', 426, cors);
        }
        if (!originAllowed(request, env)) {
          logWorkerEvent('worker.origin_denied', { metric: 'rejected_connection', path: url.pathname, origin: request.headers.get('Origin') ?? 'missing' });
          return jsonError('ORIGIN_NOT_ALLOWED', 403, cors);
        }

        const roomId = normalizeRoomId(url.searchParams.get('room') ?? '');
        const participantId = normalizeParticipantId(url.searchParams.get('participant') ?? '');
        const displayName = normalizeDisplayName(url.searchParams.get('name') ?? '');
        if (!roomId || !participantId || !displayName) {
          logWorkerEvent('worker.invalid_join', {
            metric: 'rejected_connection',
            hasRoom: Boolean(roomId),
            hasParticipant: Boolean(participantId),
            hasDisplayName: Boolean(displayName)
          });
          return jsonError('INVALID_JOIN', 400, cors);
        }

        const room = env.ROOMS.getByName(roomId);
        const forwarded = new URL(request.url);
        forwarded.pathname = '/internal/connect';
        forwarded.searchParams.set('room', roomId);
        forwarded.searchParams.set('participant', participantId);
        forwarded.searchParams.set('name', displayName);
        forwarded.searchParams.set('max', String(maxParticipants(env)));
        return room.fetch(new Request(forwarded, request));
      }

      return new Response('Not found', { status: 404, headers: cors });
    } catch (error) {
      logWorkerEvent('worker.error', { metric: 'do_exception', reason: errorReason(error) });
      return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500, headers: JSON_HEADERS });
    }
  }
};

export class VoiceRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    try {
      return this.connectRequest(request);
    } catch (error) {
      logWorkerEvent('worker.do_exception', { metric: 'do_exception', reason: errorReason(error) });
      return new Response('Internal error', { status: 500 });
    }
  }

  private async connectRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/internal/connect' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      logWorkerEvent('worker.websocket_required', { metric: 'rejected_connection', path: url.pathname });
      return new Response('Expected WebSocket', { status: 426 });
    }

    const roomId = normalizeRoomId(url.searchParams.get('room') ?? '');
    const participantId = normalizeParticipantId(url.searchParams.get('participant') ?? '');
    const displayName = normalizeDisplayName(url.searchParams.get('name') ?? '');
    const max = clamp(Number(url.searchParams.get('max') ?? '10'), 2, 25);
    if (!roomId || !participantId || !displayName) {
      logWorkerEvent('worker.invalid_join', {
        metric: 'rejected_connection',
        hasRoom: Boolean(roomId),
        hasParticipant: Boolean(participantId),
        hasDisplayName: Boolean(displayName)
      });
      return new Response('Invalid join', { status: 400 });
    }

    const current = this.closeStaleSockets(roomId, this.ctx.getWebSockets(roomId));
    const duplicate = current.find((socket) =>
      socket.readyState === WebSocket.OPEN && socketAttachment(socket)?.participantId === participantId
    );
    const activeOthers = current.filter((socket) =>
      socket.readyState === WebSocket.OPEN && socketAttachment(socket)?.participantId !== participantId
    );

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [roomId]);

    if (activeOthers.length >= max) {
      logWorkerEvent('room.full', { metric: 'rejected_connection', roomId, participantCount: activeOthers.length, max });
      safeSend(server, {
        type: 'error',
        code: 'ROOM_FULL',
        message: 'Room participant limit reached.',
        recoverable: false
      });
      server.close(4004, 'room_full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const attachment: SocketAttachment = {
      participantId,
      displayName,
      roomId,
      muted: true,
      speaking: false,
      joinedAt: Date.now()
    };
    server.serializeAttachment(attachment);

    // Register the replacement before closing the old socket so the close handler
    // can see the replacement and does not broadcast a false participant.left.
    if (duplicate) {
      logWorkerEvent('participant.replaced', { metric: 'room', roomId, participantId, reconnectCount: 1 });
      duplicate.close(4001, 'replaced_by_reconnect');
    }

    const existingParticipants = this.ctx.getWebSockets(roomId)
      .filter((socket) => socket !== server
        && socket.readyState === WebSocket.OPEN
        && socketAttachment(socket)?.participantId !== participantId)
      .map((socket) => socketAttachment(socket))
      .filter((participant): participant is SocketAttachment => Boolean(participant));

    safeSend(server, {
      type: 'room.welcome',
      selfId: participantId,
      participants: existingParticipants.map(publicParticipant)
    });

    if (activeOthers.length === 0 && !duplicate) logWorkerEvent('room.created', { metric: 'room', roomId });
    logWorkerEvent('participant.joined', {
      metric: 'room',
      roomId,
      participantId,
      participantCount: activeOthers.length + 1,
      roomDurationMs: roomDurationMs(existingParticipants.map((participant) => participant.joinedAt).concat(attachment.joinedAt)),
      joinAccepted: true,
      reconnect: Boolean(duplicate)
    });

    this.broadcast(roomId, {
      type: 'participant.joined',
      participant: publicParticipant(attachment)
    }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    try {
      this.handleSocketMessage(socket, raw);
    } catch (error) {
      const attachment = socketAttachment(socket);
      logWorkerEvent('worker.do_exception', {
        metric: 'do_exception',
        reason: errorReason(error),
        roomId: attachment?.roomId ?? 'unknown',
        participantId: attachment?.participantId ?? 'unknown'
      });
      socket.close(1011, 'do_exception');
    }
  }

  private handleSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    const attachment = socketAttachment(socket);
    if (!attachment) {
      logWorkerEvent('worker.error', { metric: 'websocket_error', reason: 'invalid_session' });
      return socket.close(4002, 'invalid_session');
    }

    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) {
      logWorkerEvent('worker.invalid_message', { metric: 'rejected_connection', roomId: attachment.roomId, participantId: attachment.participantId, reason: 'size_or_type' });
      return socket.close(4003, 'invalid_message');
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      logWorkerEvent('worker.invalid_message', { metric: 'rejected_connection', roomId: attachment.roomId, participantId: attachment.participantId, reason: 'json' });
      return safeSend(socket, { type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON payload.', recoverable: true });
    }

    if (!isClientMessage(message)) {
      logWorkerEvent('worker.invalid_message', { metric: 'rejected_connection', roomId: attachment.roomId, participantId: attachment.participantId, reason: 'schema' });
      return safeSend(socket, { type: 'error', code: 'INVALID_MESSAGE', message: 'Unsupported signaling message.', recoverable: true });
    }

    if (message.type === 'ping') {
      return safeSend(socket, { type: 'pong', payload: message.payload });
    }

    if (message.type === 'room.leave') {
      socket.close(1000, 'client_leave');
      return;
    }

    if (message.type === 'participant.update') {
      const next: SocketAttachment = {
        ...attachment,
        muted: typeof message.payload.muted === 'boolean' ? message.payload.muted : attachment.muted,
        speaking: typeof message.payload.speaking === 'boolean' ? message.payload.speaking : attachment.speaking
      };
      if (next.muted) next.speaking = false;
      socket.serializeAttachment(next);
      this.broadcast(next.roomId, { type: 'participant.updated', participant: publicParticipant(next) });
      return;
    }

    const target = this.findParticipant(attachment.roomId, message.targetId);
    if (!target) {
      logWorkerEvent('worker.target_missing', { metric: 'rejected_connection', roomId: attachment.roomId, participantId: attachment.participantId, targetId: message.targetId });
      safeSend(socket, { type: 'error', code: 'TARGET_NOT_FOUND', message: 'Target participant is no longer connected.', recoverable: true });
      return;
    }

    safeSend(target, {
      type: message.type,
      senderId: attachment.participantId,
      payload: message.payload
    });
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    this.broadcastDepartureUnlessReplaced(socket);
    if (socket.readyState !== WebSocket.CLOSED) socket.close(code, reason);
  }

  webSocketError(socket: WebSocket): void {
    const attachment = socketAttachment(socket);
    logWorkerEvent('worker.error', {
      metric: 'websocket_error',
      reason: 'websocket_error',
      roomId: attachment?.roomId ?? 'unknown',
      participantId: attachment?.participantId ?? 'unknown'
    });
    this.broadcastDepartureUnlessReplaced(socket);
    socket.close(1011, 'websocket_error');
  }

  private broadcastDepartureUnlessReplaced(socket: WebSocket): void {
    const attachment = socketAttachment(socket);
    if (!attachment) return;

    const replacementExists = this.ctx
      .getWebSockets(attachment.roomId)
      .some((candidate) => candidate !== socket
        && candidate.readyState === WebSocket.OPEN
        && socketAttachment(candidate)?.participantId === attachment.participantId);

    if (!replacementExists) {
      logWorkerEvent('participant.left', {
        metric: 'room',
        roomId: attachment.roomId,
        participantId: attachment.participantId,
        ...this.roomSnapshot(attachment.roomId, socket)
      });
      this.broadcast(attachment.roomId, { type: 'participant.left', participantId: attachment.participantId }, socket);
    }
  }

  private closeStaleSockets(roomId: string, sockets: WebSocket[]): WebSocket[] {
    const active: WebSocket[] = [];
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        active.push(socket);
        continue;
      }
      const attachment = socketAttachment(socket);
      logWorkerEvent('participant.stale_socket_closed', {
        roomId,
        participantId: attachment?.participantId ?? 'unknown',
        readyState: socket.readyState
      });
      socket.close(4005, 'stale_socket');
    }
    return active;
  }

  private findParticipant(roomId: string, participantId: string): WebSocket | undefined {
    return this.ctx.getWebSockets(roomId).find((socket) => socketAttachment(socket)?.participantId === participantId && socket.readyState === WebSocket.OPEN);
  }

  private roomSnapshot(roomId: string, except?: WebSocket): { participantCount: number; roomDurationMs: number } {
    const joinedAt: number[] = [];
    for (const socket of this.ctx.getWebSockets(roomId)) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
      const attachment = socketAttachment(socket);
      if (attachment) joinedAt.push(attachment.joinedAt);
    }
    return {
      participantCount: joinedAt.length,
      roomDurationMs: roomDurationMs(joinedAt)
    };
  }

  private broadcast(roomId: string, message: unknown, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets(roomId)) {
      if (socket !== except && socket.readyState === WebSocket.OPEN) safeSend(socket, message);
    }
  }
}

function publicParticipant(attachment: SocketAttachment): SignalingParticipant {
  return {
    id: attachment.participantId,
    displayName: attachment.displayName,
    muted: attachment.muted,
    speaking: attachment.speaking,
    joinedAt: attachment.joinedAt
  };
}

function socketAttachment(socket: WebSocket): SocketAttachment | undefined {
  try {
    return socket.deserializeAttachment() as SocketAttachment | undefined;
  } catch {
    return undefined;
  }
}

function safeSend(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'room.leave':
      return true;
    case 'ping':
      return value.payload === undefined
        || (isRecord(value.payload) && typeof value.payload.at === 'number' && Number.isFinite(value.payload.at));
    case 'participant.update':
      return isParticipantUpdate(value.payload);
    case 'signal.offer':
      return isTargetId(value.targetId) && isSessionDescription(value.payload, 'offer');
    case 'signal.answer':
      return isTargetId(value.targetId) && isSessionDescription(value.payload, 'answer');
    case 'signal.ice':
      return isTargetId(value.targetId) && isIceCandidate(value.payload);
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTargetId(value: unknown): value is string {
  return typeof value === 'string' && normalizeParticipantId(value) === value;
}

function isParticipantUpdate(value: unknown): value is { muted?: boolean; speaking?: boolean } {
  if (!isRecord(value)) return false;
  const mutedValid = value.muted === undefined || typeof value.muted === 'boolean';
  const speakingValid = value.speaking === undefined || typeof value.speaking === 'boolean';
  return mutedValid && speakingValid && (typeof value.muted === 'boolean' || typeof value.speaking === 'boolean');
}

function isSessionDescription(value: unknown, expectedType: 'offer' | 'answer'): boolean {
  if (!isRecord(value) || value.type !== expectedType) return false;
  return typeof value.sdp === 'string' && value.sdp.length > 0 && value.sdp.length <= 64 * 1024;
}

function isIceCandidate(value: unknown): boolean {
  if (!isRecord(value) || typeof value.candidate !== 'string' || value.candidate.length > 8192) return false;
  if (value.sdpMid !== undefined && value.sdpMid !== null && (typeof value.sdpMid !== 'string' || value.sdpMid.length > 256)) return false;
  if (value.sdpMLineIndex !== undefined && value.sdpMLineIndex !== null
      && (!Number.isInteger(value.sdpMLineIndex) || (value.sdpMLineIndex as number) < 0 || (value.sdpMLineIndex as number) > 65535)) return false;
  if (value.usernameFragment !== undefined && value.usernameFragment !== null
      && (typeof value.usernameFragment !== 'string' || value.usernameFragment.length > 256)) return false;
  return true;
}

async function turnConfiguration(env: Env, headers: HeadersInit): Promise<Response> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return Response.json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }, { headers });
  }

  const ttl = clamp(Number(env.TURN_TTL_SECONDS ?? '43200'), 3600, 86400);
  let response: Response;
  try {
    response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ ttl })
    });
  } catch (error) {
    logWorkerEvent('worker.error', { metric: 'worker_error', reason: 'turn_fetch_failed', detail: errorReason(error) });
    return Response.json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }, { status: 200, headers });
  }

  if (!response.ok) {
    logWorkerEvent('worker.error', { metric: 'worker_error', reason: 'turn_credentials_rejected', status: response.status });
    return Response.json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }, { status: 200, headers });
  }

  const data = await response.json();
  return Response.json(data, {
    headers: {
      ...Object.fromEntries(new Headers(headers).entries()),
      'cache-control': 'private, no-store'
    }
  });
}

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;

  const requestOrigin = new URL(request.url).origin;
  if (origin === requestOrigin) return true;

  const configured = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return configured.includes(origin);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = originAllowed(request, env);
  return {
    'access-control-allow-origin': allowed && origin ? origin : 'null',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'vary': 'Origin',
    'x-content-type-options': 'nosniff'
  };
}

function jsonError(code: string, status: number, headers: HeadersInit): Response {
  return Response.json({ error: code }, { status, headers });
}

function maxParticipants(env: Env): number {
  return clamp(Number(env.MAX_PARTICIPANTS ?? '10'), 2, 25);
}

function normalizeRoomId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function normalizeParticipantId(value: string): string {
  return /^[a-f0-9-]{16,64}$/i.test(value) ? value : '';
}

function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[<>]/g, '').slice(0, 40);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function roomDurationMs(joinedAt: number[]): number {
  if (joinedAt.length === 0) return 0;
  return Date.now() - Math.min(...joinedAt);
}

function logWorkerEvent(event: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'live-voice-signaling',
    event,
    ...detail
  }));
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
