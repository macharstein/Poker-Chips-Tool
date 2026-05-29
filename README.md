# Pocket Poker Chips

Pocket Poker Chips is an Expo + React Native app for tracking poker chip stacks in a shared room without physical chips. It supports local demo rooms out of the box and Firebase Realtime Database rooms when Firebase environment variables are configured.

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
npm run lint
npx tsc --noEmit
```

## Firebase Setup

Create a Firebase project with Anonymous Auth and Realtime Database enabled, then set these Expo public variables:

```bash
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_DATABASE_URL=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
```

Without these values the app falls back to local demo mode. On web, local rooms are persisted in browser storage and broadcast across tabs in the same browser, which is useful for testing multiple players locally. Local mode does not sync across separate devices; use Firebase for that.

Database rules live in `firebase.database.rules.json`. They are MVP rules: they enforce auth, room membership, and basic room shape. The client reducer still performs poker-rule validation. For competitive or public rooms, move the reducer into a trusted Cloud Function.

## Product Scope

Implemented:

- Create and join rooms by code
- QR display and QR scanning
- Firebase Realtime Database repository with transaction-based actions
- Local fallback repository
- Lobby setup for stacks, blinds, blind interval, seats, and guest players
- Table view with pot, current bet, active turn, stacks, dealer/SB/BB markers
- Player actions: fold, check/call, raise-to, show
- Admin controls: undo, pause/resume, end hand, award pot, adjust stacks, set dealer, set active player, force fold/check-call
- Pure TypeScript poker reducer

Deferred:

- Automated side-pot settlement
- Blind timer automation
- Admin transfer
- Bluetooth/local mesh mode
- Server-authoritative Cloud Function reducer
