import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, ActivityIndicator } from 'react-native';
import {
  useFonts,
  Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold,
  Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black,
} from '@expo-google-fonts/archivo';

import { AppProvider } from '@/state/store';
import { color } from '@/theme/tokens';

export default function RootLayout() {
  const [loaded] = useFonts({
    Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold,
    Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black,
  });

  // The whole system is Archivo weights; rendering in a fallback face first
  // would reflow every screen, so hold until the family is ready.
  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, justifyContent: 'center' }}>
        <ActivityIndicator color={color.red} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.paper },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="active" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
          <Stack.Screen name="done" options={{ animation: 'fade', gestureEnabled: false }} />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
