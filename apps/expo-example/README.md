# Cutiva Expo example

A small Expo app that reframes a video to 9:16 on the phone with [`@cutiva/expo`](../../packages/expo): pick a landscape video, wait for the analysis, watch the vertical result, and tap a shot to focus another person, split or go wide.

It is not an npm workspace of the monorepo (React Native has its own dependency tree); it links `@cutiva/expo` and `@cutiva/core` from `packages/` (`metro.config.js` watches them).

```bash
npm run build                 # at the repo root: builds @cutiva/core and @cutiva/expo
cd apps/expo-example
npm install
npx expo run:ios              # builds a development build for a simulator or an iPhone (needs Xcode and CocoaPods)
npx expo run:android          # the same for an Android device or emulator
npx expo start --dev-client   # later runs, without rebuilding the native app
```

iOS needs Xcode and CocoaPods; Android needs JDK 17 and the Android SDK. Dependencies were resolved with `npm install --before=<two weeks ago>` so every package is at least two weeks old and the Expo modules match React Native 0.88.0 (a newer `expo-modules-core` expects 0.88.1 and crashes at launch on iOS).
