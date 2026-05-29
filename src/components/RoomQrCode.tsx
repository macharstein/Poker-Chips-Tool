import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { toQR } from 'toqr';

type RoomQrCodeProps = {
  value: string;
  size?: number;
};

export function RoomQrCode({ value, size = 132 }: RoomQrCodeProps) {
  const matrix = useMemo(() => {
    const encoded = toQR(value);
    const width = Math.sqrt(encoded.length);
    return { encoded, width };
  }, [value]);

  const moduleSize = size / matrix.width;

  return (
    <View style={[styles.wrapper, { padding: Math.max(8, moduleSize * 4) }]}>
      <View style={{ width: size, height: size }}>
        {Array.from({ length: matrix.width }).map((_, row) => (
          <View key={row} style={styles.row}>
            {Array.from({ length: matrix.width }).map((__, column) => {
              const filled = matrix.encoded[row * matrix.width + column] === 1;
              return (
                <View
                  key={`${row}-${column}`}
                  style={[
                    styles.module,
                    {
                      width: moduleSize,
                      height: moduleSize,
                      backgroundColor: filled ? '#111312' : '#FFFFFF',
                    },
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
  },
  module: {
    flexShrink: 0,
  },
});
