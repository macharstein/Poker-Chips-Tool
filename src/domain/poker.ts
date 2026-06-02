export type RoomStatus = 'lobby' | 'active' | 'paused' | 'ended';
export type PlayerStatus = 'active' | 'folded' | 'allIn' | 'sittingOut' | 'disconnected' | 'out';
export type HandPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export type Player = {
  id: string;
  name: string;
  seat: number;
  stack: number;
  status: PlayerStatus;
  committedThisStreet: number;
  committedThisHand: number;
  lastSeenAt: number;
  deviceId?: string;
};

export type RoomSettings = {
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  blindLevel: number;
  blindIntervalMinutes: number;
  dealerSeat: number;
  minRaise: number;
  maxPlayers: number;
};

export type HandState = {
  id: string;
  number: number;
  phase: HandPhase;
  pot: number;
  currentBet: number;
  minRaise: number;
  dealerPlayerId: string;
  smallBlindPlayerId: string;
  bigBlindPlayerId: string;
  activePlayerId: string | null;
  lastAggressorPlayerId: string | null;
  actedThisStreet: Record<string, true>;
  result?: HandResult;
  startedAt: number;
  endedAt?: number;
};

export type HandResult = {
  winnerIds: string[];
  payouts: PotPayout[];
  reason: 'fold' | 'showdown' | 'admin';
  resolvedAt: number;
};

export type PotPayout = {
  playerId: string;
  amount: number;
  potId?: string;
};

export type ShowdownPot = {
  id: string;
  label: string;
  amount: number;
  contributionCap: number;
  eligiblePlayerIds: string[];
};

export type RoomEvent = {
  id: string;
  handId?: string;
  type: PokerAction['type'];
  playerId?: string;
  actorId: string;
  amount?: number;
  note?: string;
  createdAt: number;
  sequenceNumber: number;
};

export type RoomSnapshot = Pick<RoomState, 'players' | 'settings' | 'hand' | 'status'>;

export type RoomState = {
  id: string;
  code: string;
  adminUid: string;
  status: RoomStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
  settings: RoomSettings;
  players: Record<string, Player>;
  hand?: HandState;
  events: Record<string, RoomEvent>;
  undoStack: RoomSnapshot[];
};

export type PokerAction =
  | { type: 'JOIN_ROOM'; playerId: string; name: string; seat?: number; deviceId?: string }
  | { type: 'ADMIN_ADD_PLAYER'; name: string; playerId?: string; seat?: number }
  | { type: 'ADMIN_UPDATE_SETTINGS'; settings: Partial<RoomSettings> }
  | { type: 'START_HAND' }
  | { type: 'FOLD'; playerId: string }
  | { type: 'CHECK_CALL'; playerId: string }
  | { type: 'RAISE_TO'; playerId: string; amount: number }
  | { type: 'SHOW'; playerId?: string }
  | { type: 'ADMIN_AWARD_POT'; playerId: string; amount?: number }
  | { type: 'ADMIN_RESOLVE_SHOWDOWN'; payouts: PotPayout[] }
  | { type: 'ADMIN_ADJUST_STACK'; playerId: string; amount: number; note?: string }
  | { type: 'ADMIN_SET_DEALER'; playerId: string }
  | { type: 'ADMIN_SET_ACTIVE_PLAYER'; playerId: string }
  | { type: 'ADMIN_TOGGLE_SITTING_OUT'; playerId: string }
  | { type: 'ADMIN_PAUSE' }
  | { type: 'ADMIN_RESUME' }
  | { type: 'ADMIN_END_HAND' }
  | { type: 'ADMIN_UNDO' };

export type ApplyOptions = {
  actorId: string;
  now?: number;
};

const DEFAULT_SETTINGS: RoomSettings = {
  smallBlind: 25,
  bigBlind: 50,
  startingStack: 5000,
  blindLevel: 1,
  blindIntervalMinutes: 20,
  dealerSeat: 0,
  minRaise: 50,
  maxPlayers: 9,
};

const PHASE_ORDER: HandPhase[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

export function createRoomState(params: {
  id: string;
  code: string;
  adminUid: string;
  adminName: string;
  settings?: Partial<RoomSettings>;
  now?: number;
}): RoomState {
  const now = params.now ?? Date.now();
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...params.settings });
  return {
    id: params.id,
    code: params.code,
    adminUid: params.adminUid,
    status: 'lobby',
    version: 0,
    createdAt: now,
    updatedAt: now,
    settings,
    players: {
      [params.adminUid]: createPlayer({
        id: params.adminUid,
        name: params.adminName,
        seat: 0,
        stack: settings.startingStack,
        now,
      }),
    },
    events: {},
    undoStack: [],
  };
}

export function applyPokerAction(room: RoomState, action: PokerAction, options: ApplyOptions) {
  if (action.type === 'ADMIN_UNDO') {
    return undoLastAction(room, action, options);
  }

  const now = options.now ?? Date.now();
  const next = cloneRoom(room);
  const snapshot = createSnapshot(next);

  switch (action.type) {
    case 'JOIN_ROOM':
      joinRoom(next, action, now);
      break;
    case 'ADMIN_ADD_PLAYER':
      requireAdmin(next, options.actorId);
      addGuestPlayer(next, action, now);
      break;
    case 'ADMIN_UPDATE_SETTINGS':
      requireAdmin(next, options.actorId);
      requireLobby(next);
      next.settings = normalizeSettings({ ...next.settings, ...action.settings });
      Object.values(next.players).forEach((player) => {
        if (player.committedThisHand === 0 && player.committedThisStreet === 0) {
          player.stack = next.settings.startingStack;
        }
      });
      break;
    case 'START_HAND':
      requireAdmin(next, options.actorId);
      startHand(next, now);
      break;
    case 'FOLD':
      requireActiveTurn(next, action.playerId);
      fold(next, action.playerId, now);
      break;
    case 'CHECK_CALL':
      requireActiveTurn(next, action.playerId);
      checkOrCall(next, action.playerId, now);
      break;
    case 'RAISE_TO':
      requireActiveTurn(next, action.playerId);
      raiseTo(next, action.playerId, action.amount, now);
      break;
    case 'SHOW':
      if (action.playerId) {
        requireActiveTurn(next, action.playerId);
      } else {
        requireAdmin(next, options.actorId);
      }
      show(next, now);
      break;
    case 'ADMIN_AWARD_POT':
      requireAdmin(next, options.actorId);
      awardPot(next, action.playerId, action.amount, now);
      break;
    case 'ADMIN_RESOLVE_SHOWDOWN':
      requireAdmin(next, options.actorId);
      resolveShowdown(next, action.payouts, now);
      break;
    case 'ADMIN_ADJUST_STACK':
      requireAdmin(next, options.actorId);
      adjustStack(next, action.playerId, action.amount);
      break;
    case 'ADMIN_SET_DEALER':
      requireAdmin(next, options.actorId);
      setDealer(next, action.playerId);
      break;
    case 'ADMIN_SET_ACTIVE_PLAYER':
      requireAdmin(next, options.actorId);
      setActivePlayer(next, action.playerId);
      break;
    case 'ADMIN_TOGGLE_SITTING_OUT':
      requireAdmin(next, options.actorId);
      toggleSittingOut(next, action.playerId);
      break;
    case 'ADMIN_PAUSE':
      requireAdmin(next, options.actorId);
      if (next.status === 'active') {
        next.status = 'paused';
      }
      break;
    case 'ADMIN_RESUME':
      requireAdmin(next, options.actorId);
      if (next.status === 'paused') {
        next.status = 'active';
      }
      break;
    case 'ADMIN_END_HAND':
      requireAdmin(next, options.actorId);
      completeHand(next, now);
      break;
  }

  return commit(next, action, options.actorId, snapshot, now);
}

export function getOrderedPlayers(room: RoomState) {
  return Object.values(room.players).sort((a, b) => a.seat - b.seat);
}

export function getActivePlayers(room: RoomState) {
  return getOrderedPlayers(room).filter((player) => player.status === 'active');
}

export function getNonFoldedHandPlayers(room: RoomState) {
  return getOrderedPlayers(room).filter(
    (player) => player.status === 'active' || player.status === 'allIn'
  );
}

export function getCallAmount(room: RoomState, playerId: string) {
  const hand = requireHand(room);
  const player = requirePlayer(room, playerId);
  return Math.max(0, hand.currentBet - player.committedThisStreet);
}

export function canCheck(room: RoomState, playerId: string) {
  return getCallAmount(room, playerId) === 0;
}

export function getShowdownPots(room: RoomState): ShowdownPot[] {
  const players = getOrderedPlayers(room);
  const contributors = players.filter((player) => player.committedThisHand > 0);
  const levels = Array.from(new Set(contributors.map((player) => player.committedThisHand))).sort(
    (a, b) => a - b
  );
  const pots: ShowdownPot[] = [];
  let previousLevel = 0;

  levels.forEach((level) => {
    const sliceContributors = contributors.filter((player) => player.committedThisHand >= level);
    const amount = sliceContributors.length * (level - previousLevel);
    const eligiblePlayerIds = sliceContributors
      .filter((player) => player.status !== 'folded')
      .map((player) => player.id);

    if (amount > 0 && eligiblePlayerIds.length > 0) {
      pots.push({
        id: `pot-${level}`,
        label: pots.length === 0 ? 'Main pot' : `Side pot ${pots.length}`,
        amount,
        contributionCap: level,
        eligiblePlayerIds,
      });
    }
    previousLevel = level;
  });

  if (pots.length === 0) {
    const hand = room.hand;
    const eligiblePlayerIds = getNonFoldedHandPlayers(room).map((player) => player.id);
    if (hand && hand.pot > 0 && eligiblePlayerIds.length > 0) {
      return [
        {
          id: 'pot-main',
          label: 'Main pot',
          amount: hand.pot,
          contributionCap: hand.currentBet,
          eligiblePlayerIds,
        },
      ];
    }
  }

  return pots;
}

function joinRoom(room: RoomState, action: Extract<PokerAction, { type: 'JOIN_ROOM' }>, now: number) {
  if (room.status !== 'lobby' && room.players[action.playerId]) {
    room.players[action.playerId].status = 'active';
    room.players[action.playerId].lastSeenAt = now;
    return;
  }

  if (room.players[action.playerId]) {
    room.players[action.playerId].name = sanitizeName(action.name);
    room.players[action.playerId].lastSeenAt = now;
    if (action.deviceId) {
      room.players[action.playerId].deviceId = action.deviceId;
    } else {
      delete room.players[action.playerId].deviceId;
    }
    return;
  }

  requireLobby(room);
  const seat = action.seat ?? getNextOpenSeat(room);
  room.players[action.playerId] = createPlayer({
    id: action.playerId,
    name: action.name,
    seat,
    stack: room.settings.startingStack,
    now,
    deviceId: action.deviceId,
  });
}

function addGuestPlayer(
  room: RoomState,
  action: Extract<PokerAction, { type: 'ADMIN_ADD_PLAYER' }>,
  now: number
) {
  requireLobby(room);
  const playerId = action.playerId ?? `guest-${now}-${Object.keys(room.players).length}`;
  const seat = action.seat ?? getNextOpenSeat(room);
  room.players[playerId] = createPlayer({
    id: playerId,
    name: action.name,
    seat,
    stack: room.settings.startingStack,
    now,
  });
}

function startHand(room: RoomState, now: number) {
  requireLobbyOrComplete(room);
  const eligible = getOrderedPlayers(room).filter(
    (player) =>
      player.stack > 0 &&
      player.status !== 'sittingOut' &&
      player.status !== 'disconnected' &&
      player.status !== 'out'
  );
  if (eligible.length < 2) {
    throw new Error('At least two seated players are required.');
  }

  eligible.forEach((player) => {
    player.status = 'active';
    player.committedThisStreet = 0;
    player.committedThisHand = 0;
  });

  const previousDealerId = room.hand?.dealerPlayerId;
  const dealer =
    previousDealerId && eligible.some((player) => player.id === previousDealerId)
      ? nextEligibleAfter(eligible, previousDealerId)
      : eligible.find((player) => player.seat >= room.settings.dealerSeat) ?? eligible[0];
  const smallBlind = eligible.length === 2 ? dealer : nextEligibleAfter(eligible, dealer.id);
  const bigBlind = nextEligibleAfter(eligible, smallBlind.id);

  const hand: HandState = {
    id: `hand-${(room.hand?.number ?? 0) + 1}-${now}`,
    number: (room.hand?.number ?? 0) + 1,
    phase: 'preflop',
    pot: 0,
    currentBet: 0,
    minRaise: room.settings.bigBlind,
    dealerPlayerId: dealer.id,
    smallBlindPlayerId: smallBlind.id,
    bigBlindPlayerId: bigBlind.id,
    activePlayerId: null,
    lastAggressorPlayerId: bigBlind.id,
    actedThisStreet: {},
    startedAt: now,
  };
  room.hand = hand;
  room.status = 'active';
  room.settings.dealerSeat = dealer.seat;
  postBlind(room, smallBlind.id, room.settings.smallBlind);
  postBlind(room, bigBlind.id, room.settings.bigBlind);
  hand.currentBet = Math.max(
    room.players[smallBlind.id].committedThisStreet,
    room.players[bigBlind.id].committedThisStreet
  );
  hand.activePlayerId = nextEligibleAfter(eligible, bigBlind.id).id;
}

function postBlind(room: RoomState, playerId: string, amount: number) {
  const hand = requireHand(room);
  const player = requirePlayer(room, playerId);
  const paid = Math.min(player.stack, amount);
  player.stack -= paid;
  player.committedThisStreet += paid;
  player.committedThisHand += paid;
  hand.pot += paid;
  if (player.stack === 0) {
    player.status = 'allIn';
  }
}

function fold(room: RoomState, playerId: string, now: number) {
  const player = requirePlayer(room, playerId);
  player.status = 'folded';
  requireHand(room).actedThisStreet[playerId] = true;
  settleOrAdvance(room, now);
}

function checkOrCall(room: RoomState, playerId: string, now: number) {
  const hand = requireHand(room);
  const player = requirePlayer(room, playerId);
  const amount = getCallAmount(room, playerId);
  if (amount > 0) {
    payIntoPot(hand, player, amount);
  }
  hand.actedThisStreet[playerId] = true;
  settleOrAdvance(room, now);
}

function raiseTo(room: RoomState, playerId: string, amount: number, now: number) {
  const hand = requireHand(room);
  const player = requirePlayer(room, playerId);
  const targetBet = Math.floor(amount);
  const maxTarget = player.committedThisStreet + player.stack;
  if (targetBet <= hand.currentBet) {
    throw new Error('Raise must be above the current bet.');
  }
  if (targetBet > maxTarget) {
    throw new Error('Raise exceeds this stack.');
  }

  const raiseSize = targetBet - hand.currentBet;
  const isAllIn = targetBet === maxTarget;
  if (!isAllIn && raiseSize < hand.minRaise) {
    throw new Error(`Minimum raise is ${hand.minRaise}.`);
  }

  payIntoPot(hand, player, targetBet - player.committedThisStreet);
  hand.currentBet = player.committedThisStreet;
  hand.minRaise = Math.max(hand.minRaise, raiseSize);
  hand.lastAggressorPlayerId = playerId;
  hand.actedThisStreet = { [playerId]: true };
  settleOrAdvance(room, now);
}

function payIntoPot(hand: HandState, player: Player, requestedAmount: number) {
  const paid = Math.min(player.stack, Math.max(0, Math.floor(requestedAmount)));
  player.stack -= paid;
  player.committedThisStreet += paid;
  player.committedThisHand += paid;
  hand.pot += paid;
  if (player.stack === 0) {
    player.status = 'allIn';
  }
}

function show(room: RoomState, now: number) {
  const hand = requireHand(room);
  hand.phase = 'showdown';
  hand.activePlayerId = null;
  hand.endedAt = now;
}

function awardPot(room: RoomState, playerId: string, amount: number | undefined, now: number) {
  const hand = requireHand(room);
  const player = requirePlayer(room, playerId);
  const payout = Math.min(hand.pot, Math.max(0, Math.floor(amount ?? hand.pot)));
  player.stack += payout;
  hand.pot -= payout;
  hand.result = {
    winnerIds: Array.from(new Set([...(hand.result?.winnerIds ?? []), playerId])),
    payouts: [...(hand.result?.payouts ?? []), { playerId, amount: payout, potId: 'admin-award' }],
    reason: 'admin',
    resolvedAt: now,
  };
  if (hand.pot === 0) {
    completeHand(room, now);
  }
}

function resolveShowdown(room: RoomState, payouts: PotPayout[], now: number) {
  const hand = requireHand(room);
  if (hand.phase !== 'showdown') {
    throw new Error('Showdown has not started.');
  }

  const cleanPayouts = payouts
    .map((payout) => ({
      ...payout,
      amount: Math.max(0, Math.floor(payout.amount)),
    }))
    .filter((payout) => payout.amount > 0);
  const payoutTotal = cleanPayouts.reduce((total, payout) => total + payout.amount, 0);
  if (payoutTotal !== hand.pot) {
    throw new Error('Payouts must exactly match the pot.');
  }

  cleanPayouts.forEach((payout) => {
    requirePlayer(room, payout.playerId).stack += payout.amount;
  });
  hand.pot = 0;
  hand.result = {
    winnerIds: Array.from(new Set(cleanPayouts.map((payout) => payout.playerId))),
    payouts: cleanPayouts,
    reason: 'showdown',
    resolvedAt: now,
  };
  completeHand(room, now);
}

function adjustStack(room: RoomState, playerId: string, amount: number) {
  const player = requirePlayer(room, playerId);
  player.stack = Math.max(0, player.stack + Math.floor(amount));
}

function setDealer(room: RoomState, playerId: string) {
  const player = requirePlayer(room, playerId);
  room.settings.dealerSeat = player.seat;
  if (room.hand) {
    room.hand.dealerPlayerId = playerId;
  }
}

function setActivePlayer(room: RoomState, playerId: string) {
  requirePlayer(room, playerId);
  const hand = requireHand(room);
  hand.activePlayerId = playerId;
}

function toggleSittingOut(room: RoomState, playerId: string) {
  const player = requirePlayer(room, playerId);
  player.status = player.status === 'sittingOut' ? 'active' : 'sittingOut';
}

function settleOrAdvance(room: RoomState, now: number) {
  const hand = requireHand(room);
  const contenders = getNonFoldedHandPlayers(room);
  if (contenders.length === 1) {
    const payout = hand.pot;
    contenders[0].stack += payout;
    hand.pot = 0;
    hand.result = {
      winnerIds: [contenders[0].id],
      payouts: [{ playerId: contenders[0].id, amount: payout, potId: 'fold-win' }],
      reason: 'fold',
      resolvedAt: now,
    };
    completeHand(room, now);
    return;
  }

  const actors = contenders.filter((player) => player.status === 'active');
  if (actors.length === 0) {
    show(room, now);
    return;
  }

  const bettingClosed = actors.every(
    (player) => player.committedThisStreet === hand.currentBet && hand.actedThisStreet[player.id]
  );
  if (bettingClosed) {
    advanceStreet(room, now);
    return;
  }

  const currentId = hand.activePlayerId ?? actors[0].id;
  hand.activePlayerId = nextEligibleAfter(actors, currentId).id;
}

function advanceStreet(room: RoomState, now: number) {
  const hand = requireHand(room);
  const currentIndex = PHASE_ORDER.indexOf(hand.phase);
  if (currentIndex < 0 || hand.phase === 'river') {
    show(room, now);
    return;
  }

  const nextPhase = PHASE_ORDER[currentIndex + 1];
  if (nextPhase === 'showdown') {
    show(room, now);
    return;
  }

  hand.phase = nextPhase;
  hand.currentBet = 0;
  hand.minRaise = room.settings.bigBlind;
  hand.lastAggressorPlayerId = null;
  hand.actedThisStreet = {};
  Object.values(room.players).forEach((player) => {
    player.committedThisStreet = 0;
  });

  const actors = getActivePlayers(room);
  hand.activePlayerId = actors.length > 0 ? nextEligibleAfter(actors, hand.dealerPlayerId).id : null;
}

function completeHand(room: RoomState, now: number) {
  const hand = requireHand(room);
  hand.phase = 'complete';
  hand.activePlayerId = null;
  hand.endedAt = now;
  room.status = 'lobby';
  Object.values(room.players).forEach((player) => {
    player.committedThisStreet = 0;
    player.committedThisHand = 0;
    if (player.status === 'folded' || player.status === 'allIn') {
      player.status = player.stack > 0 ? 'active' : 'out';
    } else if (player.stack <= 0) {
      player.status = 'out';
    }
  });
}

function undoLastAction(
  room: RoomState,
  action: Extract<PokerAction, { type: 'ADMIN_UNDO' }>,
  options: ApplyOptions
) {
  requireAdmin(room, options.actorId);
  const previous = room.undoStack[room.undoStack.length - 1];
  if (!previous) {
    throw new Error('No action to undo.');
  }

  const next = cloneRoom(room);
  next.players = previous.players;
  next.settings = previous.settings;
  next.hand = previous.hand;
  next.status = previous.status;
  next.undoStack = next.undoStack.slice(0, -1);
  return commit(next, action, options.actorId, undefined, options.now ?? Date.now());
}

function commit(
  room: RoomState,
  action: PokerAction,
  actorId: string,
  snapshot: RoomSnapshot | undefined,
  now: number
) {
  room.version += 1;
  room.updatedAt = now;
  if (snapshot && shouldSnapshot(action)) {
    room.undoStack = [...room.undoStack.slice(-19), snapshot];
  }
  const sequenceNumber = room.version;
  const id = String(sequenceNumber).padStart(6, '0');
  const event: RoomEvent = {
    id,
    type: action.type,
    actorId,
    createdAt: now,
    sequenceNumber,
  };
  if (room.hand?.id) {
    event.handId = room.hand.id;
  }
  if ('playerId' in action) {
    event.playerId = action.playerId;
  }
  if ('amount' in action && action.amount !== undefined) {
    event.amount = action.amount;
  }
  if ('note' in action && action.note) {
    event.note = action.note;
  }
  room.events[id] = event;
  return room;
}

function shouldSnapshot(action: PokerAction) {
  return action.type !== 'JOIN_ROOM';
}

function createSnapshot(room: RoomState): RoomSnapshot {
  const snapshot: RoomSnapshot = {
    players: clone(room.players),
    settings: clone(room.settings),
    status: room.status,
  };
  if (room.hand) {
    snapshot.hand = clone(room.hand);
  }
  return snapshot;
}

function createPlayer(params: {
  id: string;
  name: string;
  seat: number;
  stack: number;
  now: number;
  deviceId?: string;
}): Player {
  const player: Player = {
    id: params.id,
    name: sanitizeName(params.name),
    seat: params.seat,
    stack: Math.max(0, Math.floor(params.stack)),
    status: 'active',
    committedThisStreet: 0,
    committedThisHand: 0,
    lastSeenAt: params.now,
  };
  if (params.deviceId) {
    player.deviceId = params.deviceId;
  }
  return player;
}

function normalizeSettings(settings: RoomSettings): RoomSettings {
  const smallBlind = Math.max(1, Math.floor(settings.smallBlind));
  const bigBlind = Math.max(smallBlind, Math.floor(settings.bigBlind));
  return {
    ...settings,
    smallBlind,
    bigBlind,
    startingStack: Math.max(bigBlind, Math.floor(settings.startingStack)),
    blindLevel: Math.max(1, Math.floor(settings.blindLevel)),
    blindIntervalMinutes: Math.max(1, Math.floor(settings.blindIntervalMinutes)),
    dealerSeat: Math.max(0, Math.floor(settings.dealerSeat)),
    minRaise: bigBlind,
    maxPlayers: Math.max(2, Math.floor(settings.maxPlayers)),
  };
}

function getNextOpenSeat(room: RoomState) {
  const occupied = new Set(Object.values(room.players).map((player) => player.seat));
  for (let seat = 0; seat < room.settings.maxPlayers; seat += 1) {
    if (!occupied.has(seat)) {
      return seat;
    }
  }
  throw new Error('This room is full.');
}

function nextEligibleAfter<T extends { id: string }>(players: T[], playerId: string) {
  const index = players.findIndex((player) => player.id === playerId);
  if (index < 0) {
    return players[0];
  }
  return players[(index + 1) % players.length];
}

function requireAdmin(room: RoomState, actorId: string) {
  if (room.adminUid !== actorId) {
    throw new Error('Only the room creator can do that.');
  }
}

function requireLobby(room: RoomState) {
  if (room.status !== 'lobby') {
    throw new Error('This can only be changed in the lobby.');
  }
}

function requireLobbyOrComplete(room: RoomState) {
  if (room.status !== 'lobby' && room.hand?.phase !== 'complete') {
    throw new Error('Finish the current hand first.');
  }
}

function requireActiveTurn(room: RoomState, playerId: string) {
  if (room.status !== 'active') {
    throw new Error('The room is not active.');
  }
  const hand = requireHand(room);
  if (hand.activePlayerId !== playerId) {
    throw new Error('It is not this player turn.');
  }
}

function requireHand(room: RoomState) {
  if (!room.hand) {
    throw new Error('No hand is active.');
  }
  return room.hand;
}

function requirePlayer(room: RoomState, playerId: string) {
  const player = room.players[playerId];
  if (!player) {
    throw new Error('Player not found.');
  }
  return player;
}

function sanitizeName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 28) : 'Player';
}

function cloneRoom(room: RoomState): RoomState {
  return clone(room);
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
