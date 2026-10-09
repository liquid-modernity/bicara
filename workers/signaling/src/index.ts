import { DurableObject } from 'cloudflare:workers';

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

type ClientMessage =
  | { type: 'signal.offer'; targetId: string; payload: RTCSessionDescriptionInit }
  | { type: 'signal.answer'; targetId: string; payload: RTCSessionDescriptionInit }
  | { type: 'signal.ice'; targetId: string; payload: RTCIceCandidateInit }
  | { type: 'participant.update'; payload: { muted?: boolean; speaking?: boolean } }
  | { type: 'room.leave' }
  | { type: 'ping'; payload?: { at: number } };

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_MESSAGE_BYTES = 96 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'live-voice-signaling', version: '0.0.4' }, { headers: cors });
    }

    if (url.pathname === '/turn') {
      if (!originAllowed(request, env)) return jsonError('ORIGIN_NOT_ALLOWED', 403, cors);
      return turnConfiguration(env, cors);
    }

    if (url.pathname === '/signal') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return jsonError('WEBSOCKET_REQUIRED', 426, cors);
      }
      if (!originAllowed(request, env)) return jsonError('ORIGIN_NOT_ALLOWED', 403, cors);

      const roomId = normalizeRoomId(url.searchParams.get('room') ?? '');
      const participantId = normalizeParticipantId(url.searchParams.get('participant') ?? '');
      const displayName = normalizeDisplayName(url.searchParams.get('name') ?? '');
      if (!roomId || !participantId || !displayName) return jsonError('INVALID_JOIN', 400, cors);

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
  }
};

export class VoiceRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/internal/connect' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const roomId = normalizeRoomId(url.searchParams.get('room') ?? '');
    const participantId = normalizeParticipantId(url.searchParams.get('participant') ?? '');
    const displayName = normalizeDisplayName(url.searchParams.get('name') ?? '');
    const max = clamp(Number(url.searchParams.get('max') ?? '10'), 2, 25);
    if (!roomId || !participantId || !displayName) return new Response('Invalid join', { status: 400 });

    const current = this.ctx.getWebSockets(roomId);
    const duplicate = current.find((socket) =>
      socket.readyState === WebSocket.OPEN && socketAttachment(socket)?.participantId === participantId
    );
    const activeOthers = current.filter((socket) =>
      socket.readyState === WebSocket.OPEN && socketAttachment(socket)?.participantId !== participantId
    );

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [roomId]);

    if (activeOthers.length >= max) {
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
    if (duplicate) duplicate.close(4001, 'replaced_by_reconnect');

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

    this.broadcast(roomId, {
      type: 'participant.joined',
      participant: publicParticipant(attachment)
    }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    const attachment = socketAttachment(socket);
    if (!attachment) return socket.close(4002, 'invalid_session');

    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) {
      return socket.close(4003, 'invalid_message');
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return safeSend(socket, { type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON payload.', recoverable: true });
    }

    if (!isClientMessage(message)) {
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
      this.broadcast(attachment.roomId, { type: 'participant.left', participantId: attachment.participantId }, socket);
    }
  }

  private findParticipant(roomId: string, participantId: string): WebSocket | undefined {
    return this.ctx.getWebSockets(roomId).find((socket) => socketAttachment(socket)?.participantId === participantId && socket.readyState === WebSocket.OPEN);
  }

  private broadcast(roomId: string, message: unknown, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets(roomId)) {
      if (socket !== except && socket.readyState === WebSocket.OPEN) safeSend(socket, message);
    }
  }
}

function publicParticipant(attachment: SocketAttachment) {
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
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== 'string') return false;
  if (message.type === 'ping' || message.type === 'room.leave') return true;
  if (message.type === 'participant.update') return Boolean(message.payload && typeof message.payload === 'object');
  if (message.type === 'signal.offer' || message.type === 'signal.answer' || message.type === 'signal.ice') {
    return typeof message.targetId === 'string' && Boolean(message.payload && typeof message.payload === 'object');
  }
  return false;
}

async function turnConfiguration(env: Env, headers: HeadersInit): Promise<Response> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return Response.json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }, { headers });
  }

  const ttl = clamp(Number(env.TURN_TTL_SECONDS ?? '43200'), 3600, 86400);
  const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ ttl })
  });

  if (!response.ok) {
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
  const configured = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (configured.length === 0) return false;
  const origin = request.headers.get('Origin');
  return origin != null && configured.includes(origin);
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
