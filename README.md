# Pocket Poker Chips

Pocket Poker Chips is an Expo + React Native app for tracking poker chip stacks in a shared room without physical chips. Configured Firebase projects default to Firebase Realtime Database rooms so players can join reliably from different networks.

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

If these are missing, the GitHub Pages workflow fails instead of publishing a browser-only local demo by accident.

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
Firebase configured: Firebase realtime rooms
No Firebase config: room creation is blocked
```

Firebase realtime rooms are the recommended public-web default because they work across different home, mobile, campus, and office networks. Host-run P2P rooms are still available for experimentation:

```bash
EXPO_PUBLIC_ROOM_TRANSPORT=p2p
```

P2P mode uses WebRTC. It can work with only STUN on friendly networks, but restrictive NATs usually need a TURN relay server. Optional WebRTC relay variables:

```bash
EXPO_PUBLIC_WEBRTC_STUN_URL=stun:stun.l.google.com:19302
EXPO_PUBLIC_WEBRTC_TURN_URL=turn:your-turn-server.example.com:3478
EXPO_PUBLIC_WEBRTC_TURN_USERNAME=...
EXPO_PUBLIC_WEBRTC_TURN_CREDENTIAL=...
```

To force local demo mode:

```bash
EXPO_PUBLIC_ROOM_TRANSPORT=local
```

Without Firebase values, room creation is blocked so you do not accidentally publish a local-only build. On web, local rooms are still available only when `EXPO_PUBLIC_ROOM_TRANSPORT=local` is set. Local rooms are persisted in browser storage and broadcast across tabs in the same browser, which is useful for testing multiple players locally. Local mode does not sync across separate devices.

Database rules live in `firebase.database.rules.json`. Publish those rules in the Firebase console after changing them; GitHub Pages deploys the website, but it does not automatically update Realtime Database rules. The `rooms` and `roomCodes` trees power the default Firebase realtime mode, and `p2pRooms` stores only room directory/signaling data for optional P2P mode. The client reducer still performs poker-rule validation. For competitive or public rooms, move the reducer into a trusted Cloud Function.

## Product Scope

Implemented:

- Create and join rooms by code
- QR display and QR scanning
- Firebase Realtime Database repository with transaction-based actions
- Optional host-run web rooms with Firebase-backed WebRTC signaling
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
