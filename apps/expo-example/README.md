# Cutiva Expo example

A small Expo app that reframes a video to 9:16 on the phone with [`@cutiva/expo`](../../packages/expo): pick a landscape video, wait for the analysis, watch the vertical result, and tap a shot to focus another person, split or go wide.

It is not an npm workspace of the monorepo (React Native has its own dependency tree); it links `@cutiva/expo` and `@cutiva/core` from `packages/` (`metro.config.js` watches them).

```bash
npm run build                 # at the repo root: builds @cutiva/core and @cutiva/expo
cd apps/expo-example
npm install
npx expo run:android          # builds a development build and installs it on a device or emulator
npx expo start --dev-client   # later runs, without rebuilding the native app
```

Android only for now. Needs JDK 17 and the Android SDK.
