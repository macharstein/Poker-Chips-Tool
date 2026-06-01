# Pocket Poker Chips

Pocket Poker Chips is an Expo + React Native app for tracking poker chip stacks in a shared room without physical chips. On web, configured Firebase projects default to host-run peer-to-peer rooms: Firebase stores the room code and WebRTC signaling only, while the host browser owns the poker room state.

## Run

```bash
npm install
npm run start
```

Useful targets:

```bash
npm run ios
npm run android
npm run web
npm run build:web
npm run lint
npm run typecheck
```

## Deploy to GitHub Pages

This repository is configured for GitHub Pages at:

```txt
https://macharstein.github.io/Poker-Chips-Tool/
```

The app uses Expo web export with `experiments.baseUrl` set to `/Poker-Chips-Tool`, which matches the GitHub repository path.

To publish:

1. Push the project to the `main` branch on `macharstein/Poker-Chips-Tool`.
2. In GitHub, open `Settings > Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to `main`, or manually run the `Deploy Web` workflow from the `Actions` tab.

The workflow runs typecheck, lint, exports the web build to `dist`, and deploys that artifact to GitHub Pages.

If the public URL shows this README instead of the app, GitHub Pages is still set to `Deploy from a branch`. Change `Settings > Pages > Build and deployment > Source` to `GitHub Actions`, then rerun the `Deploy Web` workflow.

For real multiplayer on the published website, add these repository secrets in `Settings > Secrets and variables > Actions`:

```txt
EXPO_PUBLIC_FIREBASE_API_KEY
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
EXPO_PUBLIC_FIREBASE_DATABASE_URL
EXPO_PUBLIC_FIREBASE_PROJECT_ID
EXPO_PUBLIC_FIREBASE_APP_ID
```

If these are missing, the published site still loads but uses local demo mode, which does not sync rooms across different devices.

## Firebase Setup

Create a Firebase project with Anonymous Auth and Realtime Database enabled, then set these Expo public variables:

```bash
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_DATABASE_URL=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
```

Default transport behavior:

```txt
Web + Firebase configured: host-run P2P rooms
Native + Firebase configured: full Firebase realtime rooms
No Firebase config: local demo mode
```

To force the older full-Firebase room storage path for debugging, set:

```bash
EXPO_PUBLIC_ROOM_TRANSPORT=firebase
```

To force local demo mode:

```bash
EXPO_PUBLIC_ROOM_TRANSPORT=local
```

Without Firebase values the app falls back to local demo mode. On web, local rooms are persisted in browser storage and broadcast across tabs in the same browser, which is useful for testing multiple players locally. Local mode does not sync across separate devices.

Database rules live in `firebase.database.rules.json`. The `p2pRooms` tree stores only room directory/signaling data. The older `rooms` and `roomCodes` trees remain for full-Firebase mode. The client reducer still performs poker-rule validation. For competitive or public rooms, move the reducer into a trusted Cloud Function.

## Product Scope

Implemented:

- Create and join rooms by code
- QR display and QR scanning
- Host-run web rooms with Firebase-backed WebRTC signaling
- Firebase Realtime Database repository with transaction-based actions
- Local fallback repository
- Lobby setup for stacks, blinds, blind interval, seats, and guest players
- Table view with pot, current bet, active turn, stacks, dealer/SB/BB markers
- Player actions: fold, check/call, raise-to, show
- Player status modal from Show
- Admin controls: undo, pause/resume, end hand, award pot, adjust stacks, set dealer, set active player, force fold/check-call
- Community-card stage indicator
- Showdown pot resolution with side-pot-style winner selection
- Hand strength guide
- Pure TypeScript poker reducer

Deferred:

- Blind timer automation
- Admin transfer
- Bluetooth/local mesh mode
- Server-authoritative Cloud Function reducer
