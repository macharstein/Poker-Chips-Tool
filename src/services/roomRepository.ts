import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  get,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
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
import {
  canUseHostedRooms,
  createHostedRoom,
  dispatchHostedAction,
  joinHostedRoom,
  leaveHostedRoom,
  subscribeHostedRoom,
  type HostedRoomRole,
  type HostedRoomSubscribeContext,
} from '@/services/hostedRoomService';

export type TransportMode = 'p2p' | 'firebase' | 'local';
export type RoomRole = HostedRoomRole;

export type RoomSession = {
  roomId: string;
  code: string;
  playerId: string;
  mode: TransportMode;
  role?: RoomRole;
  peerId?: string;
  hostPeerId?: string;
};

export type RoomSubscription = {
  unsubscribe: () => void;
};

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
};

const localRooms: Record<string, RoomState> = {};
const localRoomCodes: Record<string, string> = {};
const localListeners: Record<string, Set<(room: RoomState | null) => void>> = {};
const LOCAL_STATE_KEY = 'pocket-poker-chips.local-state.v1';
const LOCAL_CHANNEL_NAME = 'pocket-poker-chips.local-rooms';

let localUserCounter = 0;
let localHydrated = false;
let localBroadcastChannel: BroadcastChannel | undefined;

type LocalStoredState = {
  rooms: Record<string, RoomState>;
  roomCodes: Record<string, string>;
  updatedAt: number;
};

export function getFirebaseConfigStatus() {
  const config = readFirebaseConfig();
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const configured = missing.length === 0;
  const defaultMode = configured ? getOnlineTransportMode() : 'local';
  return {
    configured,
    missing,
    defaultMode,
    label: getTransportLabel(defaultMode),
  };
}

export async function createRoom(params: {
  adminName: string;
  settings?: Partial<RoomSettings>;
}): Promise<RoomSession> {
  if (getFirebaseConfigStatus().configured) {
    const onlineMode = getOnlineTransportMode();
    if (onlineMode === 'local') {
      return createLocalRoom(params);
    }
    if (onlineMode === 'p2p') {
      return createHostedRoom({
        adminName: params.adminName,
        settings: params.settings,
        database: getDatabase(getFirebaseApp()),
        getUserId: getFirebaseUserId,
      });
    }
    return createFirebaseRoom(params);
  }
  return createLocalRoom(params);
}

export async function joinRoom(params: { code: string; playerName: string }): Promise<RoomSession> {
  if (getFirebaseConfigStatus().configured) {
    const onlineMode = getOnlineTransportMode();
    if (onlineMode === 'local') {
      return joinLocalRoom(params);
    }
    if (onlineMode === 'p2p') {
      return joinHostedRoom({
        code: params.code,
        playerName: params.playerName,
        database: getDatabase(getFirebaseApp()),
        getUserId: getFirebaseUserId,
      });
    }
    return joinFirebaseRoom(params);
  }
  return joinLocalRoom(params);
}

export function subscribeRoom(
  roomId: string,
  mode: TransportMode,
  onRoom: (room: RoomState | null) => void,
  context?: HostedRoomSubscribeContext
): RoomSubscription {
  if (mode === 'p2p') {
    return subscribeHostedRoom({
      roomId,
      database: getDatabase(getFirebaseApp()),
      getUserId: getFirebaseUserId,
      context,
      onRoom,
    });
  }

  if (mode === 'firebase') {
    const database = getDatabase(getFirebaseApp());
    const unsubscribe = onValue(ref(database, `rooms/${roomId}`), (snapshot) => {
      onRoom(snapshot.val() as RoomState | null);
    });
    return { unsubscribe };
  }

  ensureLocalHydrated();
  localListeners[roomId] ??= new Set();
  localListeners[roomId].add(onRoom);
  onRoom(clone(localRooms[roomId] ?? null));
  return {
    unsubscribe: () => {
      localListeners[roomId]?.delete(onRoom);
    },
  };
}

export async function dispatchRoomAction(params: {
  roomId: string;
  mode: TransportMode;
  actorId: string;
  action: PokerAction;
}) {
  if (params.mode === 'p2p') {
    return dispatchHostedAction({
      roomId: params.roomId,
      actorId: params.actorId,
      action: params.action,
    });
  }

  if (params.mode === 'firebase') {
    const database = getDatabase(getFirebaseApp());
    const roomRef = ref(database, `rooms/${params.roomId}`);
    let actionError: Error | undefined;
    const result = await runTransaction(
      roomRef,
      (current: RoomState | null) => {
        if (!current) {
          actionError = new Error('Room not found.');
          return undefined;
        }
        try {
          return applyPokerAction(current, params.action, { actorId: params.actorId });
        } catch (error) {
          actionError = error instanceof Error ? error : new Error('Action rejected.');
          return undefined;
        }
      },
      { applyLocally: false }
    );

    if (actionError) {
      throw actionError;
    }
    if (!result.committed) {
      throw new Error('Action was rejected because the room changed.');
    }
    return;
  }

  ensureLocalHydrated();
  const room = localRooms[params.roomId];
  if (!room) {
    throw new Error('Room not found.');
  }
  localRooms[params.roomId] = applyPokerAction(room, params.action, { actorId: params.actorId });
  persistLocalState();
  emitLocalRoom(params.roomId);
}

export async function leaveRoom(params: { roomId: string; mode: TransportMode }) {
  if (params.mode === 'p2p') {
    await leaveHostedRoom({ roomId: params.roomId });
  }
}

export async function attachPresence(params: {
  roomId: string;
  playerId: string;
  mode: TransportMode;
}) {
  if (params.mode !== 'firebase') {
    return () => {};
  }

  const database = getDatabase(getFirebaseApp());
  const playerRef = ref(database, `rooms/${params.roomId}/players/${params.playerId}`);
  await update(playerRef, { status: 'active', lastSeenAt: Date.now() });
  const disconnect = onDisconnect(playerRef);
  await disconnect.update({ status: 'disconnected', lastSeenAt: serverTimestamp() });
  return () => {
    disconnect.cancel();
  };
}

export function createShareValue(code: string) {
  if (isWebRuntime() && window.location?.origin) {
    const basePath = window.location.pathname.startsWith('/Poker-Chips-Tool')
      ? '/Poker-Chips-Tool/'
      : '/';
    return `${window.location.origin}${basePath}?code=${encodeURIComponent(code)}`;
  }
  return `pokerchipstool://join?code=${encodeURIComponent(code)}`;
}

export function parseRoomCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code') ?? url.pathname.split('/').filter(Boolean).pop();
    return normalizeCode(code ?? trimmed);
  } catch {
    return normalizeCode(trimmed);
  }
}

async function createFirebaseRoom(params: {
  adminName: string;
  settings?: Partial<RoomSettings>;
}): Promise<RoomSession> {
  const userId = await getFirebaseUserId();
  const database = getDatabase(getFirebaseApp());
  const code = await createAvailableCode();
  const roomId = `room-${code.toLowerCase()}-${randomId(8)}`;
  const room = createRoomState({
    id: roomId,
    code,
    adminUid: userId,
    adminName: params.adminName,
    settings: params.settings,
  });

  await set(ref(database, `rooms/${roomId}`), room);
  await set(ref(database, `roomCodes/${code}`), roomId);
  return { roomId, code, playerId: userId, mode: 'firebase' };
}

async function joinFirebaseRoom(params: {
  code: string;
  playerName: string;
}): Promise<RoomSession> {
  const userId = await getFirebaseUserId();
  const code = normalizeCode(params.code);
  const database = getDatabase(getFirebaseApp());
  const codeSnapshot = await get(ref(database, `roomCodes/${code}`));
  const roomId = codeSnapshot.val() as string | null;
  if (!roomId) {
    throw new Error('Room code not found.');
  }

  await dispatchRoomAction({
    roomId,
    mode: 'firebase',
    actorId: userId,
    action: { type: 'JOIN_ROOM', playerId: userId, name: params.playerName },
  });
  return { roomId, code, playerId: userId, mode: 'firebase' };
}

function createLocalRoom(params: {
  adminName: string;
  settings?: Partial<RoomSettings>;
}): RoomSession {
  ensureLocalHydrated();
  const playerId = createLocalPlayerId();
  const code = createLocalCode();
  const roomId = `local-${code.toLowerCase()}`;
  const room = createRoomState({
    id: roomId,
    code,
    adminUid: playerId,
    adminName: params.adminName,
    settings: params.settings,
  });
  localRooms[roomId] = room;
  localRoomCodes[code] = roomId;
  persistLocalState();
  emitLocalRoom(roomId);
  return { roomId, code, playerId, mode: 'local' };
}

function joinLocalRoom(params: { code: string; playerName: string }): RoomSession {
  ensureLocalHydrated();
  const code = normalizeCode(params.code);
  const roomId = localRoomCodes[code];
  if (!roomId) {
    throw new Error('Local room not found. In local mode, open the second tab in the same browser.');
  }
  const playerId = createLocalPlayerId();
  localRooms[roomId] = applyPokerAction(
    localRooms[roomId],
    { type: 'JOIN_ROOM', playerId, name: params.playerName },
    { actorId: playerId }
  );
  persistLocalState();
  emitLocalRoom(roomId);
  return { roomId, code, playerId, mode: 'local' };
}

async function createAvailableCode() {
  const database = getDatabase(getFirebaseApp());
  for (let index = 0; index < 10; index += 1) {
    const code = createRoomCode();
    const snapshot = await get(ref(database, `roomCodes/${code}`));
    if (!snapshot.exists()) {
      return code;
    }
  }
  throw new Error('Could not create a room code. Try again.');
}

function getFirebaseApp() {
  const config = readFirebaseConfig();
  if (!hasConfig(config)) {
    throw new Error('Firebase is not configured.');
  }
  return getApps().length > 0 ? getApp() : initializeApp(config);
}

async function getFirebaseUserId() {
  const auth = getAuth(getFirebaseApp());
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }
  const credentials = await signInAnonymously(auth);
  return credentials.user.uid;
}

function readFirebaseConfig(): FirebaseConfig {
  return {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ?? '',
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
  };
}

function hasConfig(config: FirebaseConfig) {
  return Object.values(config).every(Boolean);
}

function getOnlineTransportMode(): TransportMode {
  const forced = process.env.EXPO_PUBLIC_ROOM_TRANSPORT?.toLowerCase();
  if (forced === 'firebase') {
    return 'firebase';
  }
  if (forced === 'local') {
    return 'local';
  }
  if (forced === 'p2p' && !canUseHostedRooms()) {
    return 'firebase';
  }
  return canUseHostedRooms() ? 'p2p' : 'firebase';
}

function getTransportLabel(mode: TransportMode) {
  switch (mode) {
    case 'p2p':
      return 'Host-run P2P rooms';
    case 'firebase':
      return 'Firebase realtime rooms';
    case 'local':
      return 'Local demo mode';
  }
}

function createLocalPlayerId() {
  localUserCounter += 1;
  return `local-player-${localUserCounter}-${randomId(5)}`;
}

function createLocalCode() {
  let code = createRoomCode();
  while (localRoomCodes[code]) {
    code = createRoomCode();
  }
  return code;
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

function ensureLocalHydrated() {
  if (localHydrated) {
    return;
  }

  localHydrated = true;
  const stored = readStoredLocalState();
  if (stored) {
    replaceLocalState(stored);
  }

  if (!isWebRuntime()) {
    return;
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== LOCAL_STATE_KEY || !event.newValue) {
      return;
    }
    const state = parseLocalState(event.newValue);
    if (state) {
      replaceLocalState(state);
      emitAllLocalRooms();
    }
  });

  if ('BroadcastChannel' in globalThis) {
    localBroadcastChannel = new BroadcastChannel(LOCAL_CHANNEL_NAME);
    localBroadcastChannel.onmessage = (event: MessageEvent<LocalStoredState>) => {
      if (event.data?.rooms && event.data?.roomCodes) {
        replaceLocalState(event.data);
        emitAllLocalRooms();
      }
    };
  }
}

function persistLocalState() {
  if (!isWebRuntime()) {
    return;
  }

  const state: LocalStoredState = {
    rooms: localRooms,
    roomCodes: localRoomCodes,
    updatedAt: Date.now(),
  };
  const serialized = JSON.stringify(state);
  window.localStorage.setItem(LOCAL_STATE_KEY, serialized);
  localBroadcastChannel?.postMessage(clone(state));
}

function readStoredLocalState() {
  if (!isWebRuntime()) {
    return null;
  }
  return parseLocalState(window.localStorage.getItem(LOCAL_STATE_KEY));
}

function parseLocalState(serialized: string | null) {
  if (!serialized) {
    return null;
  }

  try {
    const parsed = JSON.parse(serialized) as LocalStoredState;
    if (parsed.rooms && parsed.roomCodes) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function replaceLocalState(state: LocalStoredState) {
  clearRecord(localRooms);
  clearRecord(localRoomCodes);
  Object.assign(localRooms, clone(state.rooms));
  Object.assign(localRoomCodes, clone(state.roomCodes));
}

function emitLocalRoom(roomId: string) {
  localListeners[roomId]?.forEach((listener) => listener(clone(localRooms[roomId] ?? null)));
}

function emitAllLocalRooms() {
  Object.keys(localListeners).forEach(emitLocalRoom);
}

function clearRecord(record: Record<string, unknown>) {
  Object.keys(record).forEach((key) => {
    delete record[key];
  });
}

function isWebRuntime() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
