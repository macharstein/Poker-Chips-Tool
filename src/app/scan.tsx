import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { parseRoomCode } from '@/services/roomRepository';

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const handleScan = ({ data }: BarcodeScanningResult) => {
    if (scanned) {
      return;
    }
    const code = parseRoomCode(data);
    if (!code) {
      return;
    }
    setScanned(true);
    router.replace({ pathname: '/', params: { code } });
  };

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.screen}>
        <SafeAreaView style={styles.permissionState}>
          <Text style={styles.title}>Camera access</Text>
          <Text style={styles.body}>Pocket Poker Chips uses the camera only to scan room QR codes.</Text>
          <PrimaryButton title="Allow camera" onPress={requestPermission} />
          <SecondaryButton title="Back" onPress={() => router.replace('/')} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView
        style={styles.camera}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleScan}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />
      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            onPress={() => router.replace('/')}>
            <SymbolView
              tintColor="#FFFFFF"
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'chevron_left' }}
              size={18}
            />
          </Pressable>
          <Text style={styles.topTitle}>Scan Room</Text>
          <View style={styles.backButtonSpacer} />
        </View>
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </View>
        <Text style={styles.scanText}>Frame the room QR code</Text>
      </SafeAreaView>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#101714',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingBottom: 60,
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  topTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 23, 20, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonSpacer: {
    width: 42,
  },
  scanFrame: {
    width: 248,
    height: 248,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderColor: '#F4C95D',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 5,
    borderLeftWidth: 5,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 5,
    borderRightWidth: 5,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 5,
    borderRightWidth: 5,
  },
  scanText: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(16, 23, 20, 0.75)',
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '900',
  },
  permissionState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  body: {
    color: '#A9B6AC',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    fontWeight: '700',
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: '#F4C95D',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    alignSelf: 'stretch',
  },
  primaryButtonText: {
    color: '#14120A',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: '#24352C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    alignSelf: 'stretch',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.72,
  },
});
