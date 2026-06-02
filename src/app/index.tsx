import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  cleanupInactiveRooms,
  createRoom,
  getFirebaseConfigStatus,
  joinRoom,
  parseRoomCode,
  type RoomSession,
} from '@/services/roomRepository';

export default function EntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const configStatus = useMemo(() => getFirebaseConfigStatus(), []);
  const initialJoinCode = parseRoomCode(firstParam(params.code));
  const [adminName, setAdminName] = useState('Host');
  const [joinName, setJoinName] = useState('Player');
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [startingStack, setStartingStack] = useState('5000');
  const [smallBlind, setSmallBlind] = useState('25');
  const [bigBlind, setBigBlind] = useState('50');
  const [blindMinutes, setBlindMinutes] = useState('20');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void cleanupInactiveRooms().catch(() => undefined);
  }, []);

  const openRoom = (session: RoomSession) => {
    router.push({
      pathname: '/room/[roomId]',
      params: {
        roomId: session.roomId,
        playerId: session.playerId,
        mode: session.mode,
        code: session.code,
        role: session.role,
        peerId: session.peerId,
        hostPeerId: session.hostPeerId,
      },
    });
  };

  const handleCreate = async () => {
    setIsSubmitting(true);
    setPendingMessage(
      configStatus.defaultMode === 'p2p' ? 'Creating hosted room in Firebase...' : 'Creating room...'
    );
    setError('');
    try {
      const session = await createRoom({
        adminName,
        settings: {
          startingStack: toNumber(startingStack, 5000),
          smallBlind: toNumber(smallBlind, 25),
          bigBlind: toNumber(bigBlind, 50),
          blindIntervalMinutes: toNumber(blindMinutes, 20),
        },
      });
      openRoom(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the room.');
    } finally {
      setIsSubmitting(false);
      setPendingMessage('');
    }
  };

  const handleJoin = async () => {
    setIsSubmitting(true);
    setPendingMessage(
      configStatus.defaultMode === 'p2p' ? 'Finding host and connecting...' : 'Joining room...'
    );
    setError('');
    try {
      const session = await joinRoom({ code: joinCode, playerName: joinName });
      openRoom(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not join the room.');
    } finally {
      setIsSubmitting(false);
      setPendingMessage('');
    }
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>P</Text>
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.kicker}>Chip stacks, no chip case</Text>
                <Text style={styles.title}>Pocket Poker Chips</Text>
                <Text style={styles.subtitle}>
                  Run a clean poker-night ledger from the phones already at the table.
                </Text>
              </View>
            </View>

            <View style={styles.statusStrip}>
              <View style={[styles.statusDot, configStatus.configured && styles.statusDotLive]} />
              <Text style={styles.statusText}>{configStatus.label}</Text>
            </View>
            {!configStatus.canCreateRooms ? (
              <Text style={styles.warningText}>
                Shared rooms need Firebase Realtime Database config. Local mode is only for same-browser
                testing.
              </Text>
            ) : null}

            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>Create Room</Text>
                <SymbolView
                  tintColor="#F4C95D"
                  name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
                  size={20}
                />
              </View>

              <LabeledInput label="Host name" value={adminName} onChangeText={setAdminName} />
              <View style={styles.formGrid}>
                <LabeledInput
                  label="Starting stack"
                  value={startingStack}
                  onChangeText={setStartingStack}
                  keyboardType="number-pad"
                />
                <LabeledInput
                  label="Small blind"
                  value={smallBlind}
                  onChangeText={setSmallBlind}
                  keyboardType="number-pad"
                />
                <LabeledInput
                  label="Big blind"
                  value={bigBlind}
                  onChangeText={setBigBlind}
                  keyboardType="number-pad"
                />
                <LabeledInput
                  label="Blind minutes"
                  value={blindMinutes}
                  onChangeText={setBlindMinutes}
                  keyboardType="number-pad"
                />
              </View>

              <PrimaryButton title="Create room" onPress={handleCreate} disabled={isSubmitting} />
            </View>

            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>Join Room</Text>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                  onPress={() => router.push('/scan')}>
                  <SymbolView
                    tintColor="#E8ECE8"
                    name={{ ios: 'qrcode.viewfinder', android: 'qr_code_scanner', web: 'qr_code' }}
                    size={19}
                  />
                </Pressable>
              </View>

              <LabeledInput label="Player name" value={joinName} onChangeText={setJoinName} />
              <LabeledInput
                label="Room code"
                value={joinCode}
                onChangeText={(value) => setJoinCode(parseRoomCode(value))}
                autoCapitalize="characters"
                maxLength={8}
              />
              <PrimaryButton title="Join room" onPress={handleJoin} disabled={isSubmitting} />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {isSubmitting ? (
              <View style={styles.submittingRow}>
                <ActivityIndicator color="#F4C95D" />
                <Text style={styles.statusText}>{pendingMessage}</Text>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

type LabeledInputProps = ComponentProps<typeof TextInput> & {
  label: string;
};

function LabeledInput({ label, style, ...props }: LabeledInputProps) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#7D8B80"
        style={[styles.input, style]}
        selectionColor="#F4C95D"
        {...props}
      />
    </View>
  );
}

function PrimaryButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      onPress={onPress}>
      <Text style={styles.primaryButtonText}>{title}</Text>
    </Pressable>
  );
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? '';
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
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  hero: {
    paddingTop: 18,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  brandMark: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#B5293B',
    borderWidth: 4,
    borderColor: '#F4C95D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 27,
  },
  heroCopy: {
    flex: 1,
    gap: 3,
  },
  kicker: {
    color: '#F4C95D',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: '#F7FAF6',
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '900',
  },
  subtitle: {
    color: '#A9B6AC',
    fontSize: 14,
    lineHeight: 20,
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: '#17211C',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#26372E',
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 9,
    backgroundColor: '#D69A3A',
  },
  statusDotLive: {
    backgroundColor: '#37C978',
  },
  statusText: {
    color: '#DCE5DE',
    fontSize: 13,
    fontWeight: '700',
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
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelTitle: {
    color: '#F7FAF6',
    fontSize: 18,
    fontWeight: '900',
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  inputGroup: {
    gap: 6,
    flexGrow: 1,
    minWidth: 132,
  },
  label: {
    color: '#A9B6AC',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#344B3E',
    backgroundColor: '#0E1512',
    paddingHorizontal: 13,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#F4C95D',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#16120A',
    fontSize: 16,
    fontWeight: '900',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#24352C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.74,
  },
  disabled: {
    opacity: 0.55,
  },
  errorText: {
    color: '#FF8D7B',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  warningText: {
    color: '#F4C95D',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
  },
  submittingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
});
