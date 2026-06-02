import type { Database, Unsubscribe } from 'firebase/database';
import {
  get,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';

import {
  applyPokerAction,
  createRoomState,
  type PokerAction,
  type RoomSettings,
  type RoomState,
} from '@/domain/poker';

export type HostedRoomRole = 'host' | 'guest';

export type HostedRoomSession = {
  roomId: string;
  code: string;
  playerId: string;
  mode: 'p2p';
  role: HostedRoomRole;
  peerId: string;
  hostPeerId?: string;
};

export type HostedRoomSubscribeContext = {
  actorId?: string;
  code?: string;
  role?: HostedRoomRole;
  peerId?: string;
  hostPeerId?: string;
};

type HostedRoomDirectory = {
  roomId: string;
  code: string;
  hostUid: string;
  hostPeerId: string;
  hostName: string;
  status: 'active' | 'stale' | 'closed';
  createdAt: number;
  heartbeatAt: number;
  expiresAt: number;
  peers?: Record<string, HostedPeerSignal>;
};

type HostedPeerSignal = {
  id: string;
  uid: string;
  playerId: string;
  name: string;
  status: 'joining' | 'connected' | 'disconnected';
  createdAt: number;
  lastSeenAt: number;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  offerCandidates?: Record<string, RTCIceCandidateInit>;
  answerCandidates?: Record<string, RTCIceCandidateInit>;
};

type StoredHostedRoom = {
  role: HostedRoomRole;
  roomId: string;
  code: string;
  playerId: string;
  peerId: string;
  hostPeerId?: string;
  playerName: string;
  room?: RoomState;
  updatedAt: number;
};

type StoredHostedState = {
  rooms: Record<string, StoredHostedRoom>;
  updatedAt: number;
};

type HostPeerConnection = {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  candidateUnsubscribe?: Unsubscribe;
  seenCandidateIds: Set<string>;
};

type HostRuntime = {
  role: 'host';
  database: Database;
  roomId: string;
  code: string;
  playerId: string;
  hostPeerId: string;
  hostName: string;
  room: RoomState;
  listeners: Set<(room: RoomState | null) => void>;
  peers: Record<string, HostPeerConnection>;
  peerUnsubscribe?: Unsubscribe;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  stopped: boolean;
};

type GuestRuntime = {
  role: 'guest';
  database: Database;
  roomId: string;
  code: string;
  playerId: string;
  peerId: string;
  hostPeerId: string;
  playerName: string;
  room: RoomState | null;
  listeners: Set<(room: RoomState | null) => void>;
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  answerUnsubscribe?: Unsubscribe;
  candidateUnsubscribe?: Unsubscribe;
  directoryUnsubscribe?: Unsubscribe;
  pingTimer?: ReturnType<typeof setInterval>;
  staleTimer?: ReturnType<typeof setInterval>;
  seenCandidateIds: Set<string>;
  remoteDescriptionSet: boolean;
  lastHostSeenAt: number;
  stopped: boolean;
};

type GuestToHostMessage =
  | {
      type: 'join_room';
      playerId: string;
      peerId: string;
      name: string;
      sentAt: number;
    }
  | {
      type: 'player_action';
      playerId: string;
      peerId: string;
      action: PokerAction;
      requestId: string;
      sentAt: number;
    }
  | {
      type: 'ping';
      playerId: string;
      peerId: string;
      sentAt: number;
    };

type HostToGuestMessage =
  | { type: 'room_snapshot'; room: RoomState; sentAt: number }
  | { type: 'action_rejected'; message: string; requestId?: string; sentAt: number }
  | { type: 'host_paused'; sentAt: number }
  | { type: 'pong'; sentAt: number };

const HEARTBEAT_INTERVAL_MS = 10_000;
const ROOM_TTL_MS = 45_000;
const GUEST_STALE_AFTER_MS = 25_000;
const FIREBASE_OPERATION_TIMEOUT_MS = 15_000;
const HOSTED_STATE_KEY = 'pocket-poker-chips.hosted-state.v1';
const PEER_CONFIGURATION: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const hostRuntimes: Record<string, HostRuntime> = {};
const guestRuntimes: Record<string, GuestRuntime> = {};

export function canUseHostedRooms() {
  return (
    isWebRuntime() &&
    typeof globalThis.RTCPeerConnection !== 'undefined' &&
    typeof globalThis.RTCSessionDescription !== 'undefined'
  );
}

export async function createHostedRoom(params: {
  adminName: string;
  settings?: Partial<RoomSettings>;
  database: Database;
  getUserId: () => Promise<string>;
}): Promise<HostedRoomSession> {
  requireHostedSupport();
  const playerId = await withTimeout(
    params.getUserId(),
    'Firebase sign-in timed out. Check that Anonymous Auth is enabled and macharstein.github.io is an authorized Auth domain.'
  );
  const code = await createAvailableHostedCode(params.database);
  const roomId = `p2p-${code.toLowerCase()}-${randomId(8)}`;
  const hostPeerId = createPeerId(playerId);
  const room = createRoomState({
    id: roomId,
    code,
    adminUid: playerId,
    adminName: params.adminName,
    settings: params.settings,
  });

  const now = Date.now();
  const directory: HostedRoomDirectory = {
    roomId,
    code,
    hostUid: playerId,
    hostPeerId,
    hostName: params.adminName,
    status: 'active',
    createdAt: now,
    heartbeatAt: now,
    expiresAt: now + ROOM_TTL_MS,
  };

  await withTimeout(
    set(ref(params.database, `p2pRooms/${code}`), directory),
    'Creating the hosted room timed out. Check the Realtime Database URL and publish firebase.database.rules.json.'
  );
  const runtime = createHostRuntime({
    database: params.database,
    room,
    code,
    playerId,
    hostPeerId,
    hostName: params.adminName,
  });
  storeHostedRoom({
    role: 'host',
    roomId,
    code,
    playerId,
    peerId: hostPeerId,
    hostPeerId,
    playerName: params.adminName,
    room,
    updatedAt: now,
  });
  await startHostSignaling(runtime);

  return {
    roomId,
    code,
    playerId,
    mode: 'p2p',
    role: 'host',
    peerId: hostPeerId,
    hostPeerId,
  };
}

export async function joinHostedRoom(params: {
  code: string;
  playerName: string;
  database: Database;
  getUserId: () => Promise<string>;
}): Promise<HostedRoomSession> {
  requireHostedSupport();
  const playerId = await withTimeout(
    params.getUserId(),
    'Firebase sign-in timed out. Check that Anonymous Auth is enabled and this domain is authorized in Firebase Auth.'
  );
  const code = normalizeCode(params.code);
  const directorySnapshot = await withTimeout(
    get(ref(params.database, `p2pRooms/${code}`)),
    'Looking up the hosted room timed out. Check the Realtime Database URL and rules.'
  );
  const directory = directorySnapshot.val() as HostedRoomDirectory | null;
  if (!directory || isHostedDirectoryStale(directory)) {
    throw new Error('Hosted room code not found or the host is offline.');
  }

  const peerId = createPeerId(playerId);
  const runtime = await createGuestRuntime({
    database: params.database,
    directory,
    playerId,
    peerId,
    playerName: params.playerName,
  });

  storeHostedRoom({
    role: 'guest',
    roomId: directory.roomId,
    code,
    playerId,
    peerId,
    hostPeerId: directory.hostPeerId,
    playerName: params.playerName,
    room: runtime.room ?? undefined,
    updatedAt: Date.now(),
  });

  return {
    roomId: directory.roomId,
    code,
    playerId,
    mode: 'p2p',
    role: 'guest',
    peerId,
    hostPeerId: directory.hostPeerId,
  };
}

export function subscribeHostedRoom(params: {
  roomId: string;
  database: Database;
  getUserId: () => Promise<string>;
  context?: HostedRoomSubscribeContext;
  onRoom: (room: RoomState | null) => void;
}) {
  const existing = hostRuntimes[params.roomId] ?? guestRuntimes[params.roomId];
  if (existing) {
    existing.listeners.add(params.onRoom);
    params.onRoom(clone(existing.room));
    return {
      unsubscribe: () => existing.listeners.delete(params.onRoom),
    };
  }

  const stored = readStoredHostedRoom(params.roomId);
  if (stored?.room) {
    params.onRoom(clone(stored.room));
  }

  if (stored?.role === 'host' && stored.room) {
    const runtime = createHostRuntime({
      database: params.database,
      room: stored.room,
      code: stored.code,
      playerId: stored.playerId,
      hostPeerId: stored.hostPeerId ?? stored.peerId,
      hostName: stored.playerName,
    });
    runtime.listeners.add(params.onRoom);
    void params.getUserId().then(() => startHostSignaling(runtime)).catch(() => markHostRuntimePaused(runtime));
    return {
      unsubscribe: () => runtime.listeners.delete(params.onRoom),
    };
  }

  if (stored?.role === 'guest' && stored.hostPeerId) {
    void reconnectStoredGuest(params.database, stored)
      .then((runtime) => {
        runtime.listeners.add(params.onRoom);
        params.onRoom(clone(runtime.room));
      })
      .catch(() => {
        if (stored.room) {
          params.onRoom(clone({ ...stored.room, status: 'paused' }));
        }
      });
  }

  return { unsubscribe: () => undefined };
}

export async function dispatchHostedAction(params: {
  roomId: string;
  actorId: string;
  action: PokerAction;
}) {
  const hostRuntime = hostRuntimes[params.roomId];
  if (hostRuntime) {
    applyHostAction(hostRuntime, params.action, params.actorId);
    return;
  }

  const guestRuntime = guestRuntimes[params.roomId];
  if (!guestRuntime) {
    throw new Error('Hosted room connection is not ready.');
  }
  if (guestRuntime.channel.readyState !== 'open') {
    throw new Error('Waiting for the host connection.');
  }

  sendChannelMessage(guestRuntime.channel, {
    type: 'player_action',
    playerId: params.actorId,
    peerId: guestRuntime.peerId,
    action: params.action,
    requestId: randomId(10),
    sentAt: Date.now(),
  });
}

export async function leaveHostedRoom(params: { roomId: string }) {
  const hostRuntime = hostRuntimes[params.roomId];
  if (hostRuntime) {
    await stopHostRuntime(hostRuntime, 'stale');
    return;
  }

  const guestRuntime = guestRuntimes[params.roomId];
  if (guestRuntime) {
    await stopGuestRuntime(guestRuntime);
  }
}

function createHostRuntime(params: {
  database: Database;
  room: RoomState;
  code: string;
  playerId: string;
  hostPeerId: string;
  hostName: string;
}): HostRuntime {
  const existing = hostRuntimes[params.room.id];
  if (existing) {
    return existing;
  }

  const runtime: HostRuntime = {
    role: 'host',
    database: params.database,
    roomId: params.room.id,
    code: params.code,
    playerId: params.playerId,
    hostPeerId: params.hostPeerId,
    hostName: params.hostName,
    room: params.room,
    listeners: new Set(),
    peers: {},
    stopped: false,
  };
  hostRuntimes[params.room.id] = runtime;
  return runtime;
}

async function startHostSignaling(runtime: HostRuntime) {
  if (runtime.stopped) {
    return;
  }

  const roomRef = ref(runtime.database, `p2pRooms/${runtime.code}`);
  const now = Date.now();
  await withTimeout(
    update(roomRef, {
      roomId: runtime.roomId,
      code: runtime.code,
      hostUid: runtime.playerId,
      hostPeerId: runtime.hostPeerId,
      hostName: runtime.hostName,
      status: 'active',
      heartbeatAt: now,
      expiresAt: now + ROOM_TTL_MS,
    }),
    'Starting the hosted room timed out. Check Realtime Database rules for p2pRooms.'
  );
  void onDisconnect(roomRef).update({
    status: 'stale',
    heartbeatAt: serverTimestamp(),
    expiresAt: Date.now() + ROOM_TTL_MS,
  }).catch(() => undefined);

  runtime.heartbeatTimer = setInterval(() => {
    void update(roomRef, {
      status: 'active',
      heartbeatAt: Date.now(),
      expiresAt: Date.now() + ROOM_TTL_MS,
    }).catch(() => markHostRuntimePaused(runtime));
  }, HEARTBEAT_INTERVAL_MS);

  runtime.peerUnsubscribe?.();
  runtime.peerUnsubscribe = onValue(ref(runtime.database, `p2pRooms/${runtime.code}/peers`), (snapshot) => {
    const peers = (snapshot.val() ?? {}) as Record<string, HostedPeerSignal>;
    Object.entries(peers).forEach(([peerId, peer]) => {
      if (peer.offer && !runtime.peers[peerId]) {
        void answerPeerOffer(runtime, peerId, peer);
      }
    });
  });
}

async function answerPeerOffer(runtime: HostRuntime, peerId: string, peer: HostedPeerSignal) {
  const pc = new RTCPeerConnection(PEER_CONFIGURATION);
  const peerConnection: HostPeerConnection = {
    pc,
    seenCandidateIds: new Set(),
  };
  runtime.peers[peerId] = peerConnection;

  pc.ondatachannel = (event) => {
    peerConnection.channel = event.channel;
    attachHostChannel(runtime, peerId, event.channel);
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      void writeIceCandidate(
        runtime.database,
        `p2pRooms/${runtime.code}/peers/${peerId}/answerCandidates`,
        event.candidate
      );
    }
  };

  const offer = peer.offer;
  if (!offer) {
    return;
  }
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await withTimeout(
    update(ref(runtime.database, `p2pRooms/${runtime.code}/peers/${peerId}`), {
      answer: serializeDescription(answer),
      status: 'connected',
      lastSeenAt: Date.now(),
    }),
    'Answering the player connection timed out. Check Realtime Database rules for p2pRooms peers.'
  );

  peerConnection.candidateUnsubscribe = onValue(
    ref(runtime.database, `p2pRooms/${runtime.code}/peers/${peerId}/offerCandidates`),
    (snapshot) => {
      const candidates = (snapshot.val() ?? {}) as Record<string, RTCIceCandidateInit>;
      Object.entries(candidates).forEach(([candidateId, candidate]) => {
        if (peerConnection.seenCandidateIds.has(candidateId)) {
          return;
        }
        peerConnection.seenCandidateIds.add(candidateId);
        void pc.addIceCandidate(candidate).catch(() => undefined);
      });
    }
  );
}

function attachHostChannel(runtime: HostRuntime, peerId: string, channel: RTCDataChannel) {
  channel.onopen = () => {
    sendRoomSnapshot(channel, runtime.room);
  };
  channel.onmessage = (event) => {
    const message = parseMessage<GuestToHostMessage>(event.data);
    if (!message) {
      return;
    }
    runtime.peers[peerId].channel = channel;

    if (message.type === 'ping') {
      sendChannelMessage(channel, { type: 'pong', sentAt: Date.now() });
      void update(ref(runtime.database, `p2pRooms/${runtime.code}/peers/${peerId}`), {
        status: 'connected',
        lastSeenAt: Date.now(),
      });
      return;
    }

    if (message.type === 'join_room') {
      try {
        applyHostAction(
          runtime,
          { type: 'JOIN_ROOM', playerId: message.playerId, name: message.name },
          message.playerId
        );
      } catch (error) {
        sendActionRejected(channel, error, undefined);
      }
      return;
    }

    if (message.type === 'player_action') {
      try {
        applyHostAction(runtime, message.action, message.playerId);
      } catch (error) {
        sendActionRejected(channel, error, message.requestId);
      }
    }
  };
  channel.onclose = () => {
    void update(ref(runtime.database, `p2pRooms/${runtime.code}/peers/${peerId}`), {
      status: 'disconnected',
      lastSeenAt: Date.now(),
    });
  };
}

function applyHostAction(runtime: HostRuntime, action: PokerAction, actorId: string) {
  runtime.room = applyPokerAction(runtime.room, action, { actorId });
  storeHostedRoom({
    role: 'host',
    roomId: runtime.roomId,
    code: runtime.code,
    playerId: runtime.playerId,
    peerId: runtime.hostPeerId,
    hostPeerId: runtime.hostPeerId,
    playerName: runtime.hostName,
    room: runtime.room,
    updatedAt: Date.now(),
  });
  emitHostRoom(runtime);
  broadcastHostRoom(runtime);
}

async function createGuestRuntime(params: {
  database: Database;
  directory: HostedRoomDirectory;
  playerId: string;
  peerId: string;
  playerName: string;
}): Promise<GuestRuntime> {
  const pc = new RTCPeerConnection(PEER_CONFIGURATION);
  const channel = pc.createDataChannel('pocket-poker-chips');
  const runtime: GuestRuntime = {
    role: 'guest',
    database: params.database,
    roomId: params.directory.roomId,
    code: params.directory.code,
    playerId: params.playerId,
    peerId: params.peerId,
    hostPeerId: params.directory.hostPeerId,
    playerName: params.playerName,
    room: null,
    listeners: new Set(),
    pc,
    channel,
    seenCandidateIds: new Set(),
    remoteDescriptionSet: false,
    lastHostSeenAt: Date.now(),
    stopped: false,
  };
  guestRuntimes[runtime.roomId] = runtime;

  attachGuestChannel(runtime);
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      void writeIceCandidate(
        params.database,
        `p2pRooms/${runtime.code}/peers/${runtime.peerId}/offerCandidates`,
        event.candidate
      );
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await withTimeout(
    set(ref(params.database, `p2pRooms/${runtime.code}/peers/${runtime.peerId}`), {
      id: runtime.peerId,
      uid: runtime.playerId,
      playerId: runtime.playerId,
      name: runtime.playerName,
      status: 'joining',
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      offer: serializeDescription(offer),
    }),
    'Joining the hosted room timed out. Check Realtime Database rules for p2pRooms peers.'
  );
  void onDisconnect(ref(params.database, `p2pRooms/${runtime.code}/peers/${runtime.peerId}`)).update({
    status: 'disconnected',
    lastSeenAt: serverTimestamp(),
  }).catch(() => undefined);

  runtime.answerUnsubscribe = onValue(
    ref(params.database, `p2pRooms/${runtime.code}/peers/${runtime.peerId}/answer`),
    (snapshot) => {
      const answer = snapshot.val() as RTCSessionDescriptionInit | null;
      if (!answer || runtime.remoteDescriptionSet) {
        return;
      }
      runtime.remoteDescriptionSet = true;
      void pc.setRemoteDescription(answer).catch(() => undefined);
    }
  );

  runtime.candidateUnsubscribe = onValue(
    ref(params.database, `p2pRooms/${runtime.code}/peers/${runtime.peerId}/answerCandidates`),
    (snapshot) => {
      const candidates = (snapshot.val() ?? {}) as Record<string, RTCIceCandidateInit>;
      Object.entries(candidates).forEach(([candidateId, candidate]) => {
        if (runtime.seenCandidateIds.has(candidateId)) {
          return;
        }
        runtime.seenCandidateIds.add(candidateId);
        void pc.addIceCandidate(candidate).catch(() => undefined);
      });
    }
  );

  watchHostedDirectory(runtime);
  return runtime;
}

async function reconnectStoredGuest(database: Database, stored: StoredHostedRoom) {
  const directorySnapshot = await withTimeout(
    get(ref(database, `p2pRooms/${stored.code}`)),
    'Reconnecting to the hosted room timed out. Check the Realtime Database URL and rules.'
  );
  const directory = directorySnapshot.val() as HostedRoomDirectory | null;
  if (!directory || isHostedDirectoryStale(directory)) {
    throw new Error('Host is offline.');
  }
  const runtime = await createGuestRuntime({
    database,
    directory,
    playerId: stored.playerId,
    peerId: createPeerId(stored.playerId),
    playerName: stored.playerName,
  });
  runtime.room = stored.room ?? null;
  return runtime;
}

function attachGuestChannel(runtime: GuestRuntime) {
  runtime.channel.onopen = () => {
    runtime.lastHostSeenAt = Date.now();
    sendChannelMessage(runtime.channel, {
      type: 'join_room',
      playerId: runtime.playerId,
      peerId: runtime.peerId,
      name: runtime.playerName,
      sentAt: Date.now(),
    });
    void update(ref(runtime.database, `p2pRooms/${runtime.code}/peers/${runtime.peerId}`), {
      status: 'connected',
      lastSeenAt: Date.now(),
    });
    runtime.pingTimer = setInterval(() => {
      if (runtime.channel.readyState === 'open') {
        sendChannelMessage(runtime.channel, {
          type: 'ping',
          playerId: runtime.playerId,
          peerId: runtime.peerId,
          sentAt: Date.now(),
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  };
  runtime.channel.onmessage = (event) => {
    const message = parseMessage<HostToGuestMessage>(event.data);
    if (!message) {
      return;
    }
    runtime.lastHostSeenAt = Date.now();

    if (message.type === 'room_snapshot') {
      runtime.room = message.room;
      storeHostedRoom({
        role: 'guest',
        roomId: runtime.roomId,
        code: runtime.code,
        playerId: runtime.playerId,
        peerId: runtime.peerId,
        hostPeerId: runtime.hostPeerId,
        playerName: runtime.playerName,
        room: runtime.room,
        updatedAt: Date.now(),
      });
      emitGuestRoom(runtime);
      return;
    }

    if (message.type === 'action_rejected') {
      console.warn(message.message);
      return;
    }

    if (message.type === 'host_paused') {
      markGuestHostPaused(runtime);
    }
  };
  runtime.channel.onclose = () => markGuestHostPaused(runtime);
  runtime.staleTimer = setInterval(() => {
    if (Date.now() - runtime.lastHostSeenAt > GUEST_STALE_AFTER_MS) {
      markGuestHostPaused(runtime);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function watchHostedDirectory(runtime: GuestRuntime) {
  runtime.directoryUnsubscribe = onValue(ref(runtime.database, `p2pRooms/${runtime.code}`), (snapshot) => {
    const directory = snapshot.val() as HostedRoomDirectory | null;
    if (!directory || isHostedDirectoryStale(directory)) {
      markGuestHostPaused(runtime);
    }
  });
}

function emitHostRoom(runtime: HostRuntime) {
  runtime.listeners.forEach((listener) => listener(clone(runtime.room)));
}

function emitGuestRoom(runtime: GuestRuntime) {
  runtime.listeners.forEach((listener) => listener(clone(runtime.room)));
}

function broadcastHostRoom(runtime: HostRuntime) {
  Object.values(runtime.peers).forEach((peer) => {
    if (peer.channel?.readyState === 'open') {
      sendRoomSnapshot(peer.channel, runtime.room);
    }
  });
}

function sendRoomSnapshot(channel: RTCDataChannel, room: RoomState) {
  sendChannelMessage(channel, { type: 'room_snapshot', room, sentAt: Date.now() });
}

function sendActionRejected(channel: RTCDataChannel, error: unknown, requestId?: string) {
  sendChannelMessage(channel, {
    type: 'action_rejected',
    message: error instanceof Error ? error.message : 'Action rejected.',
    requestId,
    sentAt: Date.now(),
  });
}

function sendChannelMessage(channel: RTCDataChannel, message: GuestToHostMessage | HostToGuestMessage) {
  if (channel.readyState === 'open') {
    channel.send(JSON.stringify(message));
  }
}

function parseMessage<T>(data: unknown): T | null {
  if (typeof data !== 'string') {
    return null;
  }
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeIceCandidate(database: Database, path: string, candidate: RTCIceCandidate) {
  await set(push(ref(database, path)), serializeCandidate(candidate));
}

function serializeDescription(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  return {
    type: description.type,
    sdp: description.sdp ?? '',
  };
}

function serializeCandidate(candidate: RTCIceCandidate): RTCIceCandidateInit {
  return typeof candidate.toJSON === 'function'
    ? candidate.toJSON()
    : {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid,
      };
}

function markHostRuntimePaused(runtime: HostRuntime) {
  runtime.room = { ...runtime.room, status: 'paused' };
  emitHostRoom(runtime);
  broadcastHostRoom(runtime);
}

function markGuestHostPaused(runtime: GuestRuntime) {
  if (!runtime.room) {
    return;
  }
  runtime.room = { ...runtime.room, status: 'paused' };
  emitGuestRoom(runtime);
}

async function stopHostRuntime(runtime: HostRuntime, status: 'stale' | 'closed') {
  runtime.stopped = true;
  clearInterval(runtime.heartbeatTimer);
  runtime.peerUnsubscribe?.();
  Object.values(runtime.peers).forEach((peer) => {
    if (peer.channel?.readyState === 'open') {
      sendChannelMessage(peer.channel, { type: 'host_paused', sentAt: Date.now() });
    }
    peer.candidateUnsubscribe?.();
    peer.channel?.close();
    peer.pc.close();
  });
  await update(ref(runtime.database, `p2pRooms/${runtime.code}`), {
    status,
    heartbeatAt: Date.now(),
    expiresAt: Date.now() + ROOM_TTL_MS,
  }).catch(() => undefined);
  delete hostRuntimes[runtime.roomId];
}

async function stopGuestRuntime(runtime: GuestRuntime) {
  runtime.stopped = true;
  clearInterval(runtime.pingTimer);
  clearInterval(runtime.staleTimer);
  runtime.answerUnsubscribe?.();
  runtime.candidateUnsubscribe?.();
  runtime.directoryUnsubscribe?.();
  runtime.channel.close();
  runtime.pc.close();
  await update(ref(runtime.database, `p2pRooms/${runtime.code}/peers/${runtime.peerId}`), {
    status: 'disconnected',
    lastSeenAt: Date.now(),
  }).catch(() => undefined);
  delete guestRuntimes[runtime.roomId];
}

async function createAvailableHostedCode(database: Database) {
  for (let index = 0; index < 10; index += 1) {
    const code = createRoomCode();
    const snapshot = await withTimeout(
      get(ref(database, `p2pRooms/${code}`)),
      'Checking room code availability timed out. Check the Realtime Database URL from Firebase Console.'
    );
    const directory = snapshot.val() as HostedRoomDirectory | null;
    if (!directory) {
      return code;
    }
    if (isHostedDirectoryStale(directory)) {
      const removed = await remove(ref(database, `p2pRooms/${code}`))
        .then(() => true)
        .catch(() => false);
      if (removed) {
        return code;
      }
    }
  }
  throw new Error('Could not create a room code. Try again.');
}

function isHostedDirectoryStale(directory: HostedRoomDirectory, now = Date.now()) {
  return directory.status !== 'active' || directory.expiresAt < now || directory.heartbeatAt < now - ROOM_TTL_MS;
}

function storeHostedRoom(room: StoredHostedRoom) {
  if (!isWebRuntime()) {
    return;
  }
  const state = readStoredHostedState();
  state.rooms[room.roomId] = clone(room);
  state.updatedAt = Date.now();
  window.localStorage.setItem(HOSTED_STATE_KEY, JSON.stringify(state));
}

function readStoredHostedRoom(roomId: string) {
  return readStoredHostedState().rooms[roomId];
}

function readStoredHostedState(): StoredHostedState {
  if (!isWebRuntime()) {
    return { rooms: {}, updatedAt: Date.now() };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HOSTED_STATE_KEY) ?? '') as StoredHostedState;
    if (parsed.rooms) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { rooms: {}, updatedAt: Date.now() };
}

function requireHostedSupport() {
  if (!canUseHostedRooms()) {
    throw new Error('Host-run web rooms need a browser with WebRTC support.');
  }
}

function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = FIREBASE_OPERATION_TIMEOUT_MS) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function createPeerId(playerId: string) {
  return `${sanitizeFirebaseKey(playerId)}-${randomId(8)}`;
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(
    ''
  );
}

function randomId(length: number) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function normalizeCode(code: string) {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
}

function sanitizeFirebaseKey(value: string) {
  return value.replace(/[.#$\/[\]]/g, '-');
}

function isWebRuntime() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
