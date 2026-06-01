import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RoomQrCode } from '@/components/RoomQrCode';
import {
  canCheck,
  getCallAmount,
  getOrderedPlayers,
  getShowdownPots,
  type HandPhase,
  type PotPayout,
  type Player,
  type PokerAction,
  type RoomState,
  type ShowdownPot,
} from '@/domain/poker';
import {
  attachPresence,
  createShareValue,
  dispatchRoomAction,
  leaveRoom,
  subscribeRoom,
  type RoomRole,
  type TransportMode,
} from '@/services/roomRepository';

type SettingsDraft = Record<'startingStack' | 'smallBlind' | 'bigBlind' | 'blindIntervalMinutes', string>;
type ConfirmState = {
  title: string;
  body: string;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => void;
};

export default function RoomScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    roomId?: string;
    playerId?: string;
    mode?: TransportMode;
    code?: string;
    role?: RoomRole;
    peerId?: string;
    hostPeerId?: string;
  }>();
  const roomId = firstParam(params.roomId);
  const actorId = firstParam(params.playerId);
  const mode = normalizeMode(firstParam(params.mode));
  const role = normalizeRole(firstParam(params.role));
  const code = firstParam(params.code);
  const peerId = firstParam(params.peerId);
  const hostPeerId = firstParam(params.hostPeerId);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [guestName, setGuestName] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('500');
  const [raiseAmount, setRaiseAmount] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isShowPanelOpen, setIsShowPanelOpen] = useState(false);
  const [dismissedCompleteHandId, setDismissedCompleteHandId] = useState('');

  useEffect(() => {
    if (!roomId) {
      return;
    }

    const subscription = subscribeRoom(roomId, mode, setRoom, {
      actorId,
      code,
      role,
      peerId,
      hostPeerId,
    });
    let detachPresence: (() => void) | undefined;
    let cancelled = false;
    if (actorId) {
      attachPresence({ roomId, playerId: actorId, mode })
        .then((detach) => {
          if (cancelled) {
            detach();
          } else {
            detachPresence = detach;
          }
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : 'Presence failed.'));
    }

    return () => {
      cancelled = true;
      detachPresence?.();
      subscription.unsubscribe();
    };
  }, [actorId, code, hostPeerId, mode, peerId, role, roomId]);

  const players = useMemo(() => (room ? getOrderedPlayers(room) : []), [room]);
  const isAdmin = Boolean(room && actorId && room.adminUid === actorId);
  const activePlayer = room?.hand?.activePlayerId ? room.players[room.hand.activePlayerId] : undefined;
  const currentPlayer = actorId ? room?.players[actorId] : undefined;
  const isCurrentTurn = Boolean(room?.hand?.activePlayerId && room.hand.activePlayerId === actorId);
  const shareValue = room ? createShareValue(room.code) : '';
  const winnerIds = room?.hand?.result?.winnerIds ?? [];

  const send = async (action: PokerAction) => {
    if (!roomId || !actorId) {
      setError('Missing room session.');
      return;
    }
    setBusyAction(action.type);
    setError('');
    try {
      await dispatchRoomAction({ roomId, mode, actorId, action });
      if (action.type === 'RAISE_TO') {
        setRaiseAmount('');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action rejected.');
    } finally {
      setBusyAction('');
    }
  };

  const requestLeave = () => {
    setConfirm({
      title: 'Leave room?',
      body: 'Are you sure you want to leave the room?',
      confirmText: 'Leave room',
      danger: true,
      onConfirm: () => {
        void leaveRoom({ roomId, mode }).finally(() => router.replace('/'));
      },
    });
  };

  const requestStartGame = () => {
    setConfirm({
      title: 'Start game?',
      body: 'Start the game?',
      confirmText: 'Start game',
      onConfirm: () => {
        void send({ type: 'START_HAND' });
      },
    });
  };

  if (!roomId || !actorId) {
    return (
      <EmptyState
        title="Room session missing"
        body="Go back and create or join a room again."
        onBack={() => router.replace('/')}
      />
    );
  }

  if (!room) {
    return (
      <View style={styles.screen}>
        <SafeAreaView style={styles.centerState}>
          <ActivityIndicator color="#F4C95D" />
          <Text style={styles.mutedText}>Opening room...</Text>
        </SafeAreaView>
      </View>
    );
  }

  const saveSettings = (draft: SettingsDraft) =>
    send({
      type: 'ADMIN_UPDATE_SETTINGS',
      settings: {
        startingStack: toNumber(draft.startingStack, room.settings.startingStack),
        smallBlind: toNumber(draft.smallBlind, room.settings.smallBlind),
        bigBlind: toNumber(draft.bigBlind, room.settings.bigBlind),
        blindIntervalMinutes: toNumber(draft.blindIntervalMinutes, room.settings.blindIntervalMinutes),
      },
    });

  const addGuest = () => {
    const name = guestName.trim();
    if (!name) {
      return;
    }
    setGuestName('');
    send({ type: 'ADMIN_ADD_PLAYER', name });
  };

  const effectiveSelectedPlayerId = selectedPlayerId || players[0]?.id || '';
  const selectedPlayer = effectiveSelectedPlayerId
    ? room.players[effectiveSelectedPlayerId]
    : undefined;
  const callAmount = currentPlayer && room.hand ? getCallAmount(room, currentPlayer.id) : 0;
  const canCurrentPlayerCheck = currentPlayer && room.hand ? canCheck(room, currentPlayer.id) : false;

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}>
            <View style={styles.topBar}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                onPress={requestLeave}>
                <SymbolView
                  tintColor="#E8ECE8"
                  name={{ ios: 'chevron.left', android: 'arrow_back', web: 'chevron_left' }}
                  size={18}
                />
              </Pressable>
              <View style={styles.roomTitleBlock}>
                <Text style={styles.roomTitle}>Room {room.code}</Text>
                <Text style={styles.roomSubtitle}>
                  {getModeLabel(mode)} | v{room.version}
                </Text>
              </View>
              {isAdmin ? (
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.adminTopButton, pressed && styles.pressed]}
                  onPress={() => setIsAdminOpen(true)}>
                  <SymbolView
                    tintColor="#F4C95D"
                    name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }}
                    size={18}
                  />
                  <Text style={styles.adminTopButtonText}>Admin</Text>
                </Pressable>
              ) : null}
              <View style={[styles.liveDot, room.status === 'active' && styles.liveDotActive]} />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {room.hand?.result ? (
              <WinnerBanner room={room} currentPlayerId={actorId} />
            ) : null}

            {room.status === 'lobby' ? (
              <LobbyView
                room={room}
                players={players}
                shareValue={shareValue}
                isAdmin={isAdmin}
                guestName={guestName}
                setGuestName={setGuestName}
                onShare={() => Share.share({ message: `Pocket Poker Chips room ${room.code}` })}
                onSaveSettings={saveSettings}
                onAddGuest={addGuest}
                onStart={requestStartGame}
                onToggleSittingOut={(playerId) =>
                  send({ type: 'ADMIN_TOGGLE_SITTING_OUT', playerId })
                }
                winnerIds={winnerIds}
              />
            ) : (
              <TableView
                room={room}
                players={players}
                activePlayer={activePlayer}
                currentPlayer={currentPlayer}
                isAdmin={isAdmin}
                isCurrentTurn={isCurrentTurn}
                canCheck={canCurrentPlayerCheck}
                callAmount={callAmount}
                raiseAmount={raiseAmount}
                setRaiseAmount={setRaiseAmount}
                onAction={send}
                winnerIds={winnerIds}
                onShowStatus={() => setIsShowPanelOpen(true)}
              />
            )}

            {busyAction ? (
              <View style={styles.submittingRow}>
                <ActivityIndicator color="#F4C95D" />
                <Text style={styles.mutedText}>Submitting {busyAction.toLowerCase()}...</Text>
              </View>
            ) : null}

            <HandStrengthGuide isOpen={isGuideOpen} onToggle={() => setIsGuideOpen(!isGuideOpen)} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <ConfirmDialog confirm={confirm} onCancel={() => setConfirm(null)} />
      {isAdmin ? (
        <AdminPanelModal
          visible={isAdminOpen}
          room={room}
          players={players}
          selectedPlayer={selectedPlayer}
          selectedPlayerId={effectiveSelectedPlayerId}
          setSelectedPlayerId={setSelectedPlayerId}
          adjustAmount={adjustAmount}
          setAdjustAmount={setAdjustAmount}
          onAction={send}
          onClose={() => setIsAdminOpen(false)}
        />
      ) : null}
      {isAdmin && room.hand?.phase === 'showdown' && room.hand.pot > 0 ? (
        <ShowdownResolver
          key={room.hand.id}
          room={room}
          players={players}
          onResolve={(payouts) => send({ type: 'ADMIN_RESOLVE_SHOWDOWN', payouts })}
        />
      ) : null}
      {isAdmin && room.hand?.phase === 'complete' && room.hand.id !== dismissedCompleteHandId ? (
        <NextHandDialog
          room={room}
          players={players}
          onClose={() => setDismissedCompleteHandId(room.hand?.id ?? '')}
          onContinue={() => {
            setDismissedCompleteHandId(room.hand?.id ?? '');
            void send({ type: 'START_HAND' });
          }}
        />
      ) : null}
      <ShowStatusModal
        visible={isShowPanelOpen}
        room={room}
        players={players}
        onClose={() => setIsShowPanelOpen(false)}
      />
    </View>
  );
}

function LobbyView({
  room,
  players,
  shareValue,
  isAdmin,
  guestName,
  setGuestName,
  onShare,
  onSaveSettings,
  onAddGuest,
  onStart,
  onToggleSittingOut,
  winnerIds,
}: {
  room: RoomState;
  players: Player[];
  shareValue: string;
  isAdmin: boolean;
  guestName: string;
  setGuestName: (value: string) => void;
  onShare: () => void;
  onSaveSettings: (settingsDraft: SettingsDraft) => void;
  onAddGuest: () => void;
  onStart: () => void;
  onToggleSittingOut: (playerId: string) => void;
  winnerIds: string[];
}) {
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(() => ({
    startingStack: String(room.settings.startingStack),
    smallBlind: String(room.settings.smallBlind),
    bigBlind: String(room.settings.bigBlind),
    blindIntervalMinutes: String(room.settings.blindIntervalMinutes),
  }));

  return (
    <>
      <View style={styles.joinBand}>
        <View style={styles.qrBlock}>
          <RoomQrCode value={shareValue} size={124} />
        </View>
        <View style={styles.joinCopy}>
          <Text style={styles.sectionTitle}>Lobby</Text>
          <Text style={styles.largeCode}>{room.code}</Text>
          <Text style={styles.mutedText}>{players.length}/{room.settings.maxPlayers} seats</Text>
          <Pressable style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]} onPress={onShare}>
            <Text style={styles.smallButtonText}>Share code</Text>
          </Pressable>
        </View>
      </View>

      {isAdmin ? (
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Game Setup</Text>
          <View style={styles.formGrid}>
            <NumberInput
              label="Stack"
              value={settingsDraft.startingStack}
              onChangeText={(startingStack) => setSettingsDraft({ ...settingsDraft, startingStack })}
            />
            <NumberInput
              label="SB"
              value={settingsDraft.smallBlind}
              onChangeText={(smallBlind) => setSettingsDraft({ ...settingsDraft, smallBlind })}
            />
            <NumberInput
              label="BB"
              value={settingsDraft.bigBlind}
              onChangeText={(bigBlind) => setSettingsDraft({ ...settingsDraft, bigBlind })}
            />
            <NumberInput
              label="Blind min"
              value={settingsDraft.blindIntervalMinutes}
              onChangeText={(blindIntervalMinutes) =>
                setSettingsDraft({ ...settingsDraft, blindIntervalMinutes })
              }
            />
          </View>
          <View style={styles.buttonRow}>
            <SecondaryButton title="Save setup" onPress={() => onSaveSettings(settingsDraft)} />
            <PrimaryButton title="Start hand" onPress={onStart} />
          </View>
          <View style={styles.addPlayerRow}>
            <TextInput
              value={guestName}
              onChangeText={setGuestName}
              placeholder="Guest player"
              placeholderTextColor="#7D8B80"
              style={styles.inlineInput}
            />
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.squareButton, pressed && styles.pressed]}
              onPress={onAddGuest}>
              <SymbolView
                tintColor="#14120A"
                name={{ ios: 'plus.circle.fill', android: 'add', web: 'add' }}
                size={18}
              />
            </Pressable>
          </View>
        </View>
      ) : null}

      <PlayerList
        players={players}
        activePlayerId={room.hand?.activePlayerId}
        winnerIds={winnerIds}
        onToggle={isAdmin ? onToggleSittingOut : undefined}
      />
    </>
  );
}

function TableView({
  room,
  players,
  activePlayer,
  currentPlayer,
  isAdmin,
  isCurrentTurn,
  canCheck: currentCanCheck,
  callAmount,
  raiseAmount,
  setRaiseAmount,
  onAction,
  winnerIds,
  onShowStatus,
}: {
  room: RoomState;
  players: Player[];
  activePlayer?: Player;
  currentPlayer?: Player;
  isAdmin: boolean;
  isCurrentTurn: boolean;
  canCheck: boolean;
  callAmount: number;
  raiseAmount: string;
  setRaiseAmount: (value: string) => void;
  onAction: (action: PokerAction) => void;
  winnerIds: string[];
  onShowStatus: () => void;
}) {
  const hand = room.hand;
  const minRaiseTo = hand ? hand.currentBet + hand.minRaise : room.settings.bigBlind;
  const allInTarget = currentPlayer
    ? currentPlayer.committedThisStreet + currentPlayer.stack
    : minRaiseTo;

  return (
    <>
      <View style={styles.tableSurface}>
        <View style={styles.handHeader}>
          <Text style={styles.phaseText}>{hand?.phase.toUpperCase() ?? 'WAITING'}</Text>
          <Text style={styles.handNumber}>Hand {hand?.number ?? 0}</Text>
        </View>
        <CommunityCards phase={hand?.phase ?? 'preflop'} />
        <TurnBanner activePlayer={activePlayer} currentPlayer={currentPlayer} />
        <View style={styles.potCenter}>
          <Text style={styles.potLabel}>Pot</Text>
          <Text style={styles.potAmount}>{formatChips(hand?.pot ?? 0)}</Text>
          <Text style={styles.currentBet}>Bet {formatChips(hand?.currentBet ?? 0)}</Text>
          <Text style={styles.activeTurn}>
            {activePlayer ? `${activePlayer.name} acts` : 'Betting closed'}
          </Text>
        </View>
        <View style={styles.seatGrid}>
          {players.map((player) => (
            <PlayerSeat
              key={player.id}
              player={player}
              room={room}
              isCurrentUser={currentPlayer?.id === player.id}
              isWinner={winnerIds.includes(player.id)}
            />
          ))}
        </View>
      </View>

      {isCurrentTurn && currentPlayer ? (
        <View style={styles.actionDock}>
          <View style={styles.actionRow}>
            <DangerButton title="Fold" onPress={() => onAction({ type: 'FOLD', playerId: currentPlayer.id })} />
            <PrimaryButton
              title={currentCanCheck ? 'Check' : `Call ${formatChips(callAmount)}`}
              onPress={() => onAction({ type: 'CHECK_CALL', playerId: currentPlayer.id })}
            />
          </View>
          <View style={styles.raiseRow}>
            <TextInput
              value={raiseAmount}
              onChangeText={setRaiseAmount}
              placeholder={`Raise to ${minRaiseTo}`}
              placeholderTextColor="#7D8B80"
              keyboardType="number-pad"
              style={styles.inlineInput}
            />
            <SecondaryButton
              title="2x BB"
              onPress={() => setRaiseAmount(String(room.settings.bigBlind * 2))}
            />
            <SecondaryButton title="All-in" onPress={() => setRaiseAmount(String(allInTarget))} />
          </View>
          <PrimaryButton
            title="Confirm raise"
            onPress={() =>
              onAction({
                type: 'RAISE_TO',
                playerId: currentPlayer.id,
                amount: toNumber(raiseAmount, minRaiseTo),
              })
            }
          />
          <SecondaryButton
            title="Show"
            onPress={onShowStatus}
          />
        </View>
      ) : (
        <View style={styles.waitingBand}>
          <Text style={styles.mutedText}>
            {currentPlayer ? 'Waiting for your turn.' : 'Spectating this room.'}
          </Text>
          <SecondaryButton title="Show players" onPress={onShowStatus} />
        </View>
      )}
    </>
  );
}

function CommunityCards({ phase }: { phase: HandPhase }) {
  const revealed = getRevealedCommunityCardCount(phase);

  return (
    <View style={styles.communityCards}>
      {Array.from({ length: 5 }).map((_, index) => {
        const isRevealed = index < revealed;
        return (
          <View key={index} style={[styles.communityCard, isRevealed && styles.communityCardRevealed]}>
            <Text style={[styles.communityCardText, isRevealed && styles.communityCardTextRevealed]}>
              {index + 1}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function TurnBanner({
  activePlayer,
  currentPlayer,
}: {
  activePlayer?: Player;
  currentPlayer?: Player;
}) {
  const isYou = activePlayer && currentPlayer?.id === activePlayer.id;

  return (
    <View style={[styles.turnBanner, isYou && styles.turnBannerSelf]}>
      <Text style={styles.turnLabel}>Current turn</Text>
      <Text style={styles.turnName}>
        {activePlayer ? (isYou ? 'Your turn' : activePlayer.name) : 'Waiting for showdown'}
      </Text>
    </View>
  );
}

function WinnerBanner({
  room,
  currentPlayerId,
}: {
  room: RoomState;
  currentPlayerId: string;
}) {
  const result = room.hand?.result;
  if (!result) {
    return null;
  }

  const winnerNames = result.winnerIds
    .map((playerId) => room.players[playerId]?.name)
    .filter(Boolean)
    .join(', ');
  const currentPlayerWon = result.winnerIds.includes(currentPlayerId);
  const totalWon = result.payouts
    .filter((payout) => payout.playerId === currentPlayerId)
    .reduce((total, payout) => total + payout.amount, 0);

  return (
    <View style={[styles.winnerBanner, currentPlayerWon && styles.winnerBannerSelf]}>
      <Text style={styles.winnerBannerKicker}>
        {currentPlayerWon ? 'You won this hand' : 'Hand complete'}
      </Text>
      <Text style={styles.winnerBannerTitle}>
        {currentPlayerWon
          ? `You won ${formatChips(totalWon)}`
          : `${winnerNames || 'Winner'} won the hand`}
      </Text>
      <Text style={styles.winnerBannerMeta}>
        {result.reason === 'fold' ? 'Won after the last fold' : 'Pot resolved'}
      </Text>
    </View>
  );
}

function AdminPanelModal({
  visible,
  onClose,
  ...adminProps
}: {
  visible: boolean;
  onClose: () => void;
} & ComponentProps<typeof AdminPanel>) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.adminModalPanel}>
          <View style={styles.modalHeader}>
            <Text style={styles.confirmTitle}>Admin controls</Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.modalCloseButton, pressed && styles.pressed]}
              onPress={onClose}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <AdminPanel
              {...adminProps}
              onAction={(action) => {
                onClose();
                adminProps.onAction(action);
              }}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ShowdownResolver({
  room,
  players,
  onResolve,
}: {
  room: RoomState;
  players: Player[];
  onResolve: (payouts: PotPayout[]) => void;
}) {
  const pots = getShowdownPots(room);
  const [stepIndex, setStepIndex] = useState(0);
  const [winnersByPot, setWinnersByPot] = useState<Record<string, string[]>>({});
  const [localError, setLocalError] = useState('');
  const pot = pots[stepIndex];
  const selectedWinnerIds =
    winnersByPot[pot?.id ?? ''] ?? (pot?.eligiblePlayerIds.length === 1 ? pot.eligiblePlayerIds : []);

  const toggleWinner = (playerId: string) => {
    if (!pot) {
      return;
    }
    setLocalError('');
    const selected = new Set(selectedWinnerIds);
    if (selected.has(playerId)) {
      selected.delete(playerId);
    } else {
      selected.add(playerId);
    }
    setWinnersByPot({ ...winnersByPot, [pot.id]: Array.from(selected) });
  };

  const saveStep = () => {
    if (!pot) {
      return;
    }
    if (selectedWinnerIds.length === 0) {
      setLocalError('Pick at least one winner for this pot.');
      return;
    }

    const nextWinners = { ...winnersByPot, [pot.id]: selectedWinnerIds };
    setWinnersByPot(nextWinners);
    if (stepIndex < pots.length - 1) {
      setStepIndex(stepIndex + 1);
      return;
    }
    onResolve(buildShowdownPayouts(pots, nextWinners, players));
  };

  if (!pot) {
    return null;
  }

  return (
    <Modal transparent visible animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.showdownPanel}>
          <Text style={styles.confirmTitle}>Who won?</Text>
          <Text style={styles.confirmBody}>
            {pot.label} | {formatChips(pot.amount)} chips | Step {stepIndex + 1} of {pots.length}
          </Text>
          <Text style={styles.mutedText}>Choose winner(s) eligible for this pot.</Text>
          <View style={styles.showdownPlayerGrid}>
            {pot.eligiblePlayerIds.map((playerId) => {
              const player = room.players[playerId];
              const isSelected = selectedWinnerIds.includes(playerId);
              return (
                <Pressable
                  key={playerId}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.showdownPlayerButton,
                    isSelected && styles.showdownPlayerButtonSelected,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => toggleWinner(playerId)}>
                  <Text
                    style={[
                      styles.showdownPlayerText,
                      isSelected && styles.showdownPlayerTextSelected,
                    ]}>
                    {player?.name ?? 'Player'}
                  </Text>
                  <Text
                    style={[
                      styles.showdownPlayerMeta,
                      isSelected && styles.showdownPlayerTextSelected,
                    ]}>
                    Bet {formatChips(player?.committedThisHand ?? pot.contributionCap)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.confirmCancelButton, pressed && styles.pressed]}
              disabled={stepIndex === 0}
              onPress={() => setStepIndex(Math.max(0, stepIndex - 1))}>
              <Text style={styles.confirmCancelText}>Back</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.confirmPrimaryButton, pressed && styles.pressed]}
              onPress={saveStep}>
              <Text style={styles.confirmPrimaryText}>
                {stepIndex === pots.length - 1 ? 'Pay winners' : 'Next pot'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NextHandDialog({
  room,
  players,
  onClose,
  onContinue,
}: {
  room: RoomState;
  players: Player[];
  onClose: () => void;
  onContinue: () => void;
}) {
  const winnerIds = room.hand?.result?.winnerIds ?? [];

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.showdownPanel}>
          <Text style={styles.confirmTitle}>Continue to next hand?</Text>
          <Text style={styles.confirmBody}>Review balances before the next deal.</Text>
          <View style={styles.balanceReviewList}>
            {players.map((player) => (
              <View
                key={player.id}
                style={[
                  styles.balanceReviewRow,
                  winnerIds.includes(player.id) && styles.balanceReviewRowWinner,
                  isPlayerOut(player) && styles.balanceReviewRowOut,
                ]}>
                <Text style={styles.balanceReviewName}>{player.name}</Text>
                <Text
                  style={[
                    styles.balanceReviewStack,
                    winnerIds.includes(player.id) && styles.winnerBalanceText,
                  ]}>
                  {formatChips(player.stack)}
                </Text>
                {isPlayerOut(player) ? <Text style={styles.outBadge}>OUT</Text> : null}
              </View>
            ))}
          </View>
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.confirmCancelButton, pressed && styles.pressed]}
              onPress={onClose}>
              <Text style={styles.confirmCancelText}>Review lobby</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.confirmPrimaryButton, pressed && styles.pressed]}
              onPress={onContinue}>
              <Text style={styles.confirmPrimaryText}>Continue</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ShowStatusModal({
  visible,
  room,
  players,
  onClose,
}: {
  visible: boolean;
  room: RoomState;
  players: Player[];
  onClose: () => void;
}) {
  const hand = room.hand;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.showdownPanel}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.confirmTitle}>Player status</Text>
              <Text style={styles.confirmBody}>
                {hand ? `${hand.phase.toUpperCase()} | Pot ${formatChips(hand.pot)}` : 'No active hand'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.modalCloseButton, pressed && styles.pressed]}
              onPress={onClose}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.showStatusList}>
            {players.map((player) => {
              const isOut = isPlayerOut(player) || player.status === 'folded';
              return (
                <View
                  key={player.id}
                  style={[styles.showStatusRow, isOut && styles.showStatusRowOut]}>
                  <View style={styles.showStatusMain}>
                    <Text style={styles.showStatusName}>{player.name}</Text>
                    <Text style={styles.showStatusMeta}>
                      {isOut ? 'Out of hand' : 'In hand'} | {displayPlayerStatus(player)}
                    </Text>
                  </View>
                  <View style={styles.showStatusNumbers}>
                    <Text style={styles.showStatusAmount}>
                      Bet {formatChips(player.committedThisHand)}
                    </Text>
                    <Text style={styles.showStatusBalance}>
                      Stack {formatChips(player.stack)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AdminPanel({
  room,
  players,
  selectedPlayer,
  selectedPlayerId,
  setSelectedPlayerId,
  adjustAmount,
  setAdjustAmount,
  onAction,
}: {
  room: RoomState;
  players: Player[];
  selectedPlayer?: Player;
  selectedPlayerId: string;
  setSelectedPlayerId: (playerId: string) => void;
  adjustAmount: string;
  setAdjustAmount: (value: string) => void;
  onAction: (action: PokerAction) => void;
}) {
  const numericAmount = toNumber(adjustAmount, 0);
  const activePlayer = room.hand?.activePlayerId ? room.players[room.hand.activePlayerId] : undefined;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.sectionTitle}>Admin</Text>
        <Text style={styles.mutedText}>{room.status}</Text>
      </View>

      <View style={styles.buttonRow}>
        <SecondaryButton title="Undo" onPress={() => onAction({ type: 'ADMIN_UNDO' })} />
        <SecondaryButton
          title={room.status === 'paused' ? 'Resume' : 'Pause'}
          onPress={() => onAction({ type: room.status === 'paused' ? 'ADMIN_RESUME' : 'ADMIN_PAUSE' })}
        />
        <DangerButton title="End hand" onPress={() => onAction({ type: 'ADMIN_END_HAND' })} />
      </View>

      {activePlayer ? (
        <View style={styles.buttonRow}>
          <SecondaryButton
            title={`Force ${activePlayer.name} fold`}
            onPress={() => onAction({ type: 'FOLD', playerId: activePlayer.id })}
          />
          <SecondaryButton
            title="Force check/call"
            onPress={() => onAction({ type: 'CHECK_CALL', playerId: activePlayer.id })}
          />
        </View>
      ) : null}

      <Text style={styles.label}>Target player</Text>
      <View style={styles.playerPicker}>
        {players.map((player) => (
          <Pressable
            key={player.id}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.playerPickerButton,
              selectedPlayerId === player.id && styles.playerPickerButtonActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setSelectedPlayerId(player.id)}>
            <Text
              style={[
                styles.playerPickerText,
                selectedPlayerId === player.id && styles.playerPickerTextActive,
              ]}
              numberOfLines={1}>
              {player.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {selectedPlayer ? (
        <>
          <View style={styles.adjustRow}>
            <TextInput
              value={adjustAmount}
              onChangeText={setAdjustAmount}
              keyboardType="number-pad"
              placeholder="Amount"
              placeholderTextColor="#7D8B80"
              style={styles.inlineInput}
            />
            <SecondaryButton
              title="-"
              onPress={() =>
                onAction({
                  type: 'ADMIN_ADJUST_STACK',
                  playerId: selectedPlayer.id,
                  amount: -numericAmount,
                  note: 'Manual stack decrease',
                })
              }
            />
            <SecondaryButton
              title="+"
              onPress={() =>
                onAction({
                  type: 'ADMIN_ADJUST_STACK',
                  playerId: selectedPlayer.id,
                  amount: numericAmount,
                  note: 'Manual stack increase',
                })
              }
            />
          </View>
          <View style={styles.buttonRow}>
            <SecondaryButton
              title="Dealer"
              onPress={() => onAction({ type: 'ADMIN_SET_DEALER', playerId: selectedPlayer.id })}
            />
            <SecondaryButton
              title="Turn"
              onPress={() =>
                onAction({ type: 'ADMIN_SET_ACTIVE_PLAYER', playerId: selectedPlayer.id })
              }
            />
            <PrimaryButton
              title="Award pot"
              onPress={() =>
                onAction({ type: 'ADMIN_AWARD_POT', playerId: selectedPlayer.id })
              }
            />
          </View>
        </>
      ) : null}

      <View style={styles.eventLog}>
        {Object.values(room.events)
          .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
          .slice(0, 6)
          .map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <Text style={styles.eventType}>{event.type.replaceAll('_', ' ')}</Text>
              <Text style={styles.eventMeta}>#{event.sequenceNumber}</Text>
            </View>
          ))}
      </View>
    </View>
  );
}

function PlayerList({
  players,
  activePlayerId,
  winnerIds,
  onToggle,
}: {
  players: Player[];
  activePlayerId?: string | null;
  winnerIds?: string[];
  onToggle?: (playerId: string) => void;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.sectionTitle}>Seats</Text>
      <View style={styles.playerList}>
        {players.map((player) => {
          const isWinner = Boolean(winnerIds?.includes(player.id));
          const isOut = isPlayerOut(player);
          return (
            <View
              key={player.id}
              style={[styles.playerListRow, isWinner && styles.playerListRowWinner, isOut && styles.playerListRowOut]}>
              <View style={[styles.seatNumber, isOut && styles.seatNumberOut]}>
                <Text style={styles.seatNumberText}>{player.seat + 1}</Text>
              </View>
              <View style={styles.playerListMain}>
                <Text style={styles.playerName}>{player.name}</Text>
                <Text style={[styles.mutedText, isWinner && styles.winnerBalanceText]}>
                  {formatChips(player.stack)} | {displayPlayerStatus(player)}
                </Text>
              </View>
              {isWinner ? <Text style={styles.winnerBadge}>WIN</Text> : null}
              {activePlayerId === player.id ? <Text style={styles.activeBadge}>TURN</Text> : null}
              {isOut ? <Text style={styles.outBadge}>OUT</Text> : null}
              {onToggle ? (
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}
                  onPress={() => onToggle(player.id)}>
                  <Text style={styles.statusButtonText}>
                    {player.status === 'sittingOut' ? 'In' : 'Out'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function PlayerSeat({
  player,
  room,
  isCurrentUser,
  isWinner,
}: {
  player: Player;
  room: RoomState;
  isCurrentUser: boolean;
  isWinner: boolean;
}) {
  const hand = room.hand;
  const isDealer = hand?.dealerPlayerId === player.id;
  const isSmallBlind = hand?.smallBlindPlayerId === player.id;
  const isBigBlind = hand?.bigBlindPlayerId === player.id;
  const isActive = hand?.activePlayerId === player.id;

  const isOut = isPlayerOut(player);

  return (
    <View
      style={[
        styles.playerSeat,
        isActive && styles.playerSeatActive,
        isCurrentUser && styles.playerSeatSelf,
        isWinner && styles.playerSeatWinner,
        isOut && styles.playerSeatOut,
      ]}>
      <View style={styles.playerSeatTop}>
        <Text style={styles.playerSeatName} numberOfLines={1}>
          {player.name}
        </Text>
        <View style={styles.badgeRow}>
          {isDealer ? <Text style={styles.badge}>D</Text> : null}
          {isSmallBlind ? <Text style={styles.badge}>SB</Text> : null}
          {isBigBlind ? <Text style={styles.badge}>BB</Text> : null}
        </View>
      </View>
      <Text style={[styles.stackText, isWinner && styles.winnerBalanceText]}>
        {formatChips(player.stack)}
      </Text>
      <View style={styles.playerSeatBottom}>
        <Text style={styles.commitText}>Bet {formatChips(player.committedThisStreet)}</Text>
        <Text
          style={[
            styles.statusText,
            player.status !== 'active' && styles.statusTextWarn,
            isOut && styles.statusTextOut,
          ]}>
          {displayPlayerStatus(player)}
        </Text>
      </View>
    </View>
  );
}

function NumberInput({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.numberInputGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        placeholderTextColor="#7D8B80"
        style={styles.input}
      />
    </View>
  );
}

function PrimaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
      onPress={onPress}>
      <Text style={styles.primaryButtonText}>{title}</Text>
    </Pressable>
  );
}

function SecondaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
      onPress={onPress}>
      <Text style={styles.secondaryButtonText}>{title}</Text>
    </Pressable>
  );
}

function DangerButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
      onPress={onPress}>
      <Text style={styles.dangerButtonText}>{title}</Text>
    </Pressable>
  );
}

function HandStrengthGuide({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const hands = [
    ['Royal Flush', 'A K Q J 10, same suit'],
    ['Straight Flush', 'Five in order, same suit'],
    ['Four of a Kind', 'Four cards same rank'],
    ['Full House', 'Three of a kind plus pair'],
    ['Flush', 'Five same suit'],
    ['Straight', 'Five in order'],
    ['Three of a Kind', 'Three cards same rank'],
    ['Two Pair', 'Two separate pairs'],
    ['One Pair', 'One matching pair'],
    ['High Card', 'Highest card wins'],
  ] as const;

  return (
    <View style={styles.guidePanel}>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.guideHeader, pressed && styles.pressed]}
        onPress={onToggle}>
        <View style={styles.guideHeaderText}>
          <Text style={styles.guideTitle}>Hand strength guide</Text>
          <Text style={styles.guideSubtitle}>Strongest to weakest</Text>
        </View>
        <SymbolView
          tintColor="#F4C95D"
          name={{
            ios: isOpen ? 'chevron.up' : 'chevron.down',
            android: isOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down',
            web: isOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down',
          }}
          size={20}
        />
      </Pressable>

      {isOpen ? (
        <View style={styles.guideRows}>
          {hands.map(([name, description], index) => (
            <View key={name} style={styles.guideRow}>
              <Text style={styles.guideRank}>{index + 1}</Text>
              <View style={styles.guideHandText}>
                <Text style={styles.guideHandName}>{name}</Text>
                <Text style={styles.guideHandDescription}>{description}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ConfirmDialog({
  confirm,
  onCancel,
}: {
  confirm: ConfirmState | null;
  onCancel: () => void;
}) {
  return (
    <Modal transparent visible={Boolean(confirm)} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.confirmPanel}>
          <Text style={styles.confirmTitle}>{confirm?.title}</Text>
          <Text style={styles.confirmBody}>{confirm?.body}</Text>
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.confirmCancelButton, pressed && styles.pressed]}
              onPress={onCancel}>
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.confirmPrimaryButton,
                confirm?.danger && styles.confirmDangerButton,
                pressed && styles.pressed,
              ]}
              onPress={() => {
                const action = confirm?.onConfirm;
                onCancel();
                action?.();
              }}>
              <Text style={[styles.confirmPrimaryText, confirm?.danger && styles.confirmDangerText]}>
                {confirm?.confirmText}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function EmptyState({
  title,
  body,
  onBack,
}: {
  title: string;
  body: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.centerState}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.mutedText}>{body}</Text>
        <PrimaryButton title="Back home" onPress={onBack} />
      </SafeAreaView>
    </View>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? '';
}

function normalizeMode(value: string): TransportMode {
  if (value === 'p2p' || value === 'firebase') {
    return value;
  }
  return 'local';
}

function normalizeRole(value: string): RoomRole | undefined {
  if (value === 'host' || value === 'guest') {
    return value;
  }
  return undefined;
}

function getModeLabel(mode: TransportMode) {
  if (mode === 'p2p') {
    return 'Host-run';
  }
  if (mode === 'firebase') {
    return 'Realtime';
  }
  return 'Local';
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function formatChips(amount: number) {
  return Math.floor(amount).toLocaleString();
}

function getRevealedCommunityCardCount(phase: HandPhase) {
  if (phase === 'flop') {
    return 3;
  }
  if (phase === 'turn') {
    return 4;
  }
  if (phase === 'river' || phase === 'showdown' || phase === 'complete') {
    return 5;
  }
  return 0;
}

function buildShowdownPayouts(
  pots: ShowdownPot[],
  winnersByPot: Record<string, string[]>,
  players: Player[]
) {
  const payoutsByPlayer: Record<string, PotPayout> = {};
  const seatOrder = new Map(players.map((player, index) => [player.id, index]));

  pots.forEach((pot) => {
    const winners = (winnersByPot[pot.id] ?? [])
      .filter((playerId) => pot.eligiblePlayerIds.includes(playerId))
      .sort((a, b) => (seatOrder.get(a) ?? 0) - (seatOrder.get(b) ?? 0));
    if (winners.length === 0) {
      return;
    }

    const baseShare = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount % winners.length;
    winners.forEach((playerId, index) => {
      const amount = baseShare + (index < remainder ? 1 : 0);
      payoutsByPlayer[playerId] ??= { playerId, amount: 0, potId: pot.id };
      payoutsByPlayer[playerId].amount += amount;
    });
  });

  return Object.values(payoutsByPlayer);
}

function isPlayerOut(player: Player) {
  return player.status === 'out' || player.stack <= 0;
}

function displayPlayerStatus(player: Player) {
  return isPlayerOut(player) ? 'OUT' : player.status;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#101714',
  },
  safeArea: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 36,
    gap: 14,
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  topBar: {
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#1B2921',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2C4035',
  },
  roomTitleBlock: {
    flex: 1,
  },
  roomTitle: {
    color: '#F7FAF6',
    fontWeight: '900',
    fontSize: 23,
  },
  roomSubtitle: {
    color: '#A9B6AC',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  adminTopButton: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: '#24352C',
    borderWidth: 1,
    borderColor: '#38513F',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  adminTopButtonText: {
    color: '#F4C95D',
    fontSize: 12,
    fontWeight: '900',
  },
  liveDot: {
    width: 13,
    height: 13,
    borderRadius: 13,
    backgroundColor: '#D69A3A',
  },
  liveDotActive: {
    backgroundColor: '#37C978',
  },
  errorText: {
    color: '#FF8D7B',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  winnerBanner: {
    borderRadius: 8,
    backgroundColor: '#1F3325',
    borderWidth: 1,
    borderColor: '#3C6F4B',
    padding: 14,
    gap: 4,
  },
  winnerBannerSelf: {
    backgroundColor: '#263B20',
    borderColor: '#F4C95D',
  },
  winnerBannerKicker: {
    color: '#F4C95D',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  winnerBannerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  winnerBannerMeta: {
    color: '#C5D4C9',
    fontSize: 13,
    fontWeight: '800',
  },
  panel: {
    backgroundColor: '#17211C',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2B3D32',
    padding: 14,
    gap: 12,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#F7FAF6',
    fontSize: 18,
    fontWeight: '900',
  },
  mutedText: {
    color: '#A9B6AC',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  joinBand: {
    backgroundColor: '#1A2D22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#345344',
    padding: 14,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  qrBlock: {
    flexShrink: 0,
  },
  joinCopy: {
    flex: 1,
    gap: 7,
  },
  largeCode: {
    color: '#F4C95D',
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  numberInputGroup: {
    minWidth: 112,
    flexGrow: 1,
    gap: 6,
  },
  label: {
    color: '#A9B6AC',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#344B3E',
    backgroundColor: '#0E1512',
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  inlineInput: {
    flex: 1,
    minWidth: 110,
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#344B3E',
    backgroundColor: '#0E1512',
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  addPlayerRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#F4C95D',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
    flexGrow: 1,
  },
  primaryButtonText: {
    color: '#14120A',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#24352C',
    borderWidth: 1,
    borderColor: '#38513F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    flexGrow: 1,
  },
  secondaryButtonText: {
    color: '#E8ECE8',
    fontSize: 14,
    fontWeight: '900',
  },
  dangerButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#5E1D27',
    borderWidth: 1,
    borderColor: '#85313D',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    flexGrow: 1,
  },
  dangerButtonText: {
    color: '#FFE8E6',
    fontSize: 14,
    fontWeight: '900',
  },
  guidePanel: {
    backgroundColor: '#17211C',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2B3D32',
    overflow: 'hidden',
  },
  guideHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  guideHeaderText: {
    flex: 1,
    gap: 2,
  },
  guideTitle: {
    color: '#F7FAF6',
    fontSize: 16,
    fontWeight: '900',
  },
  guideSubtitle: {
    color: '#A9B6AC',
    fontSize: 12,
    fontWeight: '800',
  },
  guideRows: {
    borderTopWidth: 1,
    borderTopColor: '#2B3D32',
    padding: 10,
    gap: 7,
  },
  guideRow: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: '#111A16',
    borderWidth: 1,
    borderColor: '#25382E',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  guideRank: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#24352C',
    color: '#F4C95D',
    textAlign: 'center',
    lineHeight: 26,
    fontSize: 12,
    fontWeight: '900',
  },
  guideHandText: {
    flex: 1,
    gap: 1,
  },
  guideHandName: {
    color: '#F7FAF6',
    fontSize: 14,
    fontWeight: '900',
  },
  guideHandDescription: {
    color: '#A9B6AC',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 7, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  confirmPanel: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 8,
    backgroundColor: '#17211C',
    borderWidth: 1,
    borderColor: '#3A5545',
    padding: 18,
    gap: 12,
  },
  adminModalPanel: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '88%',
    borderRadius: 8,
    backgroundColor: '#101714',
    borderWidth: 1,
    borderColor: '#3A5545',
    padding: 14,
    gap: 12,
  },
  showdownPanel: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 8,
    backgroundColor: '#17211C',
    borderWidth: 1,
    borderColor: '#3A5545',
    padding: 18,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalCloseButton: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: '#24352C',
    borderWidth: 1,
    borderColor: '#38513F',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modalCloseText: {
    color: '#E8ECE8',
    fontSize: 13,
    fontWeight: '900',
  },
  confirmTitle: {
    color: '#F7FAF6',
    fontSize: 20,
    fontWeight: '900',
  },
  confirmBody: {
    color: '#D8E3DB',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  confirmCancelButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#24352C',
    borderWidth: 1,
    borderColor: '#38513F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    flex: 1,
  },
  confirmCancelText: {
    color: '#E8ECE8',
    fontWeight: '900',
    fontSize: 14,
  },
  confirmPrimaryButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#F4C95D',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    flex: 1,
  },
  confirmDangerButton: {
    backgroundColor: '#B5293B',
  },
  confirmPrimaryText: {
    color: '#14120A',
    fontWeight: '900',
    fontSize: 14,
  },
  confirmDangerText: {
    color: '#FFFFFF',
  },
  showdownPlayerGrid: {
    gap: 8,
  },
  showdownPlayerButton: {
    minHeight: 62,
    borderRadius: 8,
    backgroundColor: '#111A16',
    borderWidth: 1,
    borderColor: '#344B3E',
    padding: 11,
    justifyContent: 'center',
  },
  showdownPlayerButtonSelected: {
    backgroundColor: '#F4C95D',
    borderColor: '#F4C95D',
  },
  showdownPlayerText: {
    color: '#F7FAF6',
    fontSize: 16,
    fontWeight: '900',
  },
  showdownPlayerMeta: {
    color: '#A9B6AC',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  showdownPlayerTextSelected: {
    color: '#14120A',
  },
  balanceReviewList: {
    gap: 8,
  },
  balanceReviewRow: {
    minHeight: 52,
    borderRadius: 8,
    backgroundColor: '#111A16',
    borderWidth: 1,
    borderColor: '#25382E',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  balanceReviewRowWinner: {
    borderColor: '#F4C95D',
    backgroundColor: '#1D2A19',
  },
  balanceReviewRowOut: {
    borderColor: '#8C2734',
  },
  balanceReviewName: {
    color: '#F7FAF6',
    fontSize: 15,
    fontWeight: '900',
    flex: 1,
  },
  balanceReviewStack: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  showStatusList: {
    gap: 8,
  },
  showStatusRow: {
    minHeight: 66,
    borderRadius: 8,
    backgroundColor: '#111A16',
    borderWidth: 1,
    borderColor: '#25382E',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  showStatusRowOut: {
    borderColor: '#8C2734',
    backgroundColor: '#1D1416',
  },
  showStatusMain: {
    flex: 1,
    gap: 3,
  },
  showStatusName: {
    color: '#F7FAF6',
    fontSize: 16,
    fontWeight: '900',
  },
  showStatusMeta: {
    color: '#A9B6AC',
    fontSize: 12,
    fontWeight: '800',
  },
  showStatusNumbers: {
    alignItems: 'flex-end',
    gap: 3,
  },
  showStatusAmount: {
    color: '#F4C95D',
    fontSize: 13,
    fontWeight: '900',
  },
  showStatusBalance: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  squareButton: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: '#F4C95D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
  playerList: {
    gap: 8,
  },
  playerListRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#111A16',
    borderWidth: 1,
    borderColor: '#25382E',
  },
  playerListRowWinner: {
    borderColor: '#F4C95D',
    backgroundColor: '#1D2A19',
  },
  playerListRowOut: {
    borderColor: '#8C2734',
    boxShadow: '0 0 14px rgba(209, 61, 77, 0.45)',
  },
  seatNumber: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#26372E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatNumberOut: {
    backgroundColor: '#5E1D27',
  },
  seatNumberText: {
    color: '#F4C95D',
    fontWeight: '900',
  },
  playerListMain: {
    flex: 1,
  },
  playerName: {
    color: '#F7FAF6',
    fontSize: 16,
    fontWeight: '900',
  },
  activeBadge: {
    color: '#101714',
    backgroundColor: '#37C978',
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '900',
  },
  winnerBadge: {
    color: '#14120A',
    backgroundColor: '#F4C95D',
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '900',
  },
  outBadge: {
    color: '#FFFFFF',
    backgroundColor: '#B5293B',
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '900',
  },
  statusButton: {
    minWidth: 44,
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: '#24352C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  statusButtonText: {
    color: '#E8ECE8',
    fontWeight: '900',
    fontSize: 12,
  },
  tableSurface: {
    backgroundColor: '#173E2B',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#715A31',
    padding: 14,
    gap: 14,
  },
  handHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  phaseText: {
    color: '#F4C95D',
    fontSize: 13,
    fontWeight: '900',
  },
  handNumber: {
    color: '#D7E2D9',
    fontSize: 13,
    fontWeight: '800',
  },
  communityCards: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  communityCard: {
    width: 46,
    height: 62,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 201, 93, 0.38)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityCardRevealed: {
    backgroundColor: '#F7FAF6',
    borderColor: '#F4C95D',
  },
  communityCardText: {
    color: 'rgba(255, 255, 255, 0.42)',
    fontSize: 18,
    fontWeight: '900',
  },
  communityCardTextRevealed: {
    color: '#B5293B',
  },
  turnBanner: {
    borderRadius: 8,
    backgroundColor: '#0E2A1B',
    borderWidth: 1,
    borderColor: '#4D6B55',
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  turnBannerSelf: {
    borderColor: '#F4C95D',
    backgroundColor: '#263B20',
  },
  turnLabel: {
    color: '#A9B6AC',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  turnName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
  potCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    minHeight: 126,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#6F8A76',
    backgroundColor: '#0E2A1B',
  },
  potLabel: {
    color: '#A9B6AC',
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '900',
  },
  potAmount: {
    color: '#FFFFFF',
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '900',
  },
  currentBet: {
    color: '#F4C95D',
    fontSize: 14,
    fontWeight: '900',
  },
  activeTurn: {
    color: '#E1E8E2',
    fontSize: 14,
    marginTop: 4,
    fontWeight: '800',
  },
  seatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  playerSeat: {
    minWidth: 150,
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 112,
    borderRadius: 8,
    backgroundColor: '#111A16',
    borderWidth: 1,
    borderColor: '#2A3C32',
    padding: 11,
    gap: 8,
  },
  playerSeatActive: {
    borderColor: '#F4C95D',
    backgroundColor: '#1A261B',
  },
  playerSeatSelf: {
    borderColor: '#37C978',
  },
  playerSeatWinner: {
    borderColor: '#F4C95D',
    backgroundColor: '#1D2A19',
  },
  playerSeatOut: {
    borderColor: '#B5293B',
    boxShadow: '0 0 16px rgba(209, 61, 77, 0.5)',
  },
  playerSeatTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerSeatName: {
    color: '#F7FAF6',
    fontSize: 15,
    fontWeight: '900',
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  badge: {
    color: '#12120C',
    backgroundColor: '#F4C95D',
    borderRadius: 5,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '900',
  },
  stackText: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  playerSeatBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  commitText: {
    color: '#A9B6AC',
    fontSize: 12,
    fontWeight: '800',
  },
  statusText: {
    color: '#37C978',
    fontSize: 12,
    fontWeight: '900',
  },
  statusTextWarn: {
    color: '#F4C95D',
  },
  statusTextOut: {
    color: '#FF6B6B',
  },
  winnerBalanceText: {
    color: '#F4C95D',
    fontWeight: '900',
  },
  actionDock: {
    backgroundColor: '#17211C',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2B3D32',
    padding: 12,
    gap: 9,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  raiseRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  waitingBand: {
    backgroundColor: '#17211C',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2B3D32',
    padding: 14,
    alignItems: 'center',
  },
  adminQuickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  playerPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  playerPickerButton: {
    minHeight: 38,
    maxWidth: '48%',
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: '#24352C',
    borderWidth: 1,
    borderColor: '#38513F',
  },
  playerPickerButtonActive: {
    backgroundColor: '#F4C95D',
    borderColor: '#F4C95D',
  },
  playerPickerText: {
    color: '#E8ECE8',
    fontWeight: '900',
  },
  playerPickerTextActive: {
    color: '#14120A',
  },
  adjustRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  eventLog: {
    borderTopWidth: 1,
    borderTopColor: '#2B3D32',
    paddingTop: 8,
    gap: 6,
  },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  eventType: {
    color: '#DCE5DE',
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'lowercase',
  },
  eventMeta: {
    color: '#A9B6AC',
    fontWeight: '800',
    fontSize: 12,
  },
  submittingRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 8,
  },
  smallButton: {
    alignSelf: 'flex-start',
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: '#24352C',
    borderWidth: 1,
    borderColor: '#38513F',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  smallButtonText: {
    color: '#E8ECE8',
    fontSize: 13,
    fontWeight: '900',
  },
});
