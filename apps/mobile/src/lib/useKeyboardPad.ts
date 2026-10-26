// Android only: the height of the open keyboard, to pad a sheet or form so its fields stay above it.
// Since Expo SDK 54 Android apps are edge-to-edge and the window no longer shrinks when the keyboard opens,
// so KeyboardAvoidingView without a behaviour does nothing there. iOS keeps KeyboardAvoidingView "padding" — this is 0.
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardPad(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return h;
}
