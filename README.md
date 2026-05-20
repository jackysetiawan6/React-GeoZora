# 🌍 React-GeoZora

A full-stack, **multiplayer geography guessing game** inspired by GeoGuessr. Players are dropped into a random Google Street View panorama and must pin the location on an interactive map. Points are awarded based on **distance accuracy** and **time remaining**.

> Built with React 19, TypeScript, Vite, TailwindCSS v4, Supabase, and the Google Maps Platform.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Game Modes](#game-modes)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Core Game Logic](#core-game-logic)
- [Matchmaking System](#matchmaking-system)
- [Database Schema](#database-schema)
- [Authentication](#authentication)
- [Scoring & Progression](#scoring--progression)
- [Environment Variables](#environment-variables)
- [Installation & Setup](#installation--setup)
- [Available Scripts](#available-scripts)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- 🌍 **Interactive 3D Globe** — Animated home screen globe powered by `react-globe.gl` and `three.js`
- 🗺️ **Google Street View Integration** — Real panoramas fetched via the Google Maps Street View API
- 🎮 **Multiple Game Modes** — Solo classic, ranked head-to-head, and private custom rooms
- 🔴 **Real-time Multiplayer** — Live opponent syncing via Supabase Realtime broadcast channels
- ⚡ **ELO Matchmaking** — Skill-based queue with dynamic range expansion
- 📊 **Leaderboards** — Global rankings by EXP with daily / weekly / all-time filters
- 🏆 **Achievements & EXP** — Progression system with unlockable achievements and notifications
- 👤 **User Profiles** — Avatar, stats, activity log, notification inbox, and preference settings
- 🗂️ **26 Playable Map Regions** — World + 25 countries across all continents
- 🛡️ **Admin Panel** — Manage map regions, fallback locations, and user feedback/reports
- 🔒 **Anti-Cheat** — Right-click, DevTools shortcuts, and View Source are globally blocked

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React 19 + TypeScript 5.8 |
| **Build Tool** | Vite 6 |
| **Styling** | TailwindCSS v4 (`@tailwindcss/vite`) |
| **Backend / Auth** | Supabase (PostgreSQL + Row-Level Security + Realtime) |
| **Maps** | Google Maps Platform (Street View Metadata API + Maps JavaScript API) |
| **3D Globe** | `react-globe.gl` + `three.js` |
| **Icons** | `lucide-react` |
| **Toasts** | `sonner` |
| **Utilities** | `clsx`, `tailwind-merge` |

---

## Game Modes

| Mode | Type | Rounds | Timer per Round | Notes |
|---|---|---|---|---|
| **Classic** | Solo | 5 | 60s | Earn EXP based on score |
| **Head-to-Head** | Ranked 1v1 | 10 | 30s | ELO + EXP affected; world map only |
| **Creator Room** | Private multiplayer | Custom | Custom | Invite others via 6-character room code |
| **Chaos Mode** | — | — | — | Coming soon |

### Creator Room Options
- Custom number of rounds and seconds per round
- Toggle: **No Moving**, **No Panning**, **No Zooming** (Street View constraints)
- Up to **3 map regions** selectable simultaneously

---

## Project Structure

```
React-GeoZora/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
├── supabase-schema.sql          # Full Supabase DB schema + seed data
├── .env.example                 # Environment variable template
│
└── src/
    ├── main.tsx                 # App entry point (AuthProvider + ThemeContext)
    ├── App.tsx                  # Root component: global state & tab routing
    ├── index.css                # Global styles + CSS custom properties
    │
    ├── components/              # UI / page-level components
    │   ├── Header.tsx           # Top nav bar, auth modals, notification bell
    │   ├── Hero.tsx             # Home page hero section with CTAs
    │   ├── GlobeView.tsx        # Animated 3D interactive globe
    │   ├── GameModes.tsx        # Game mode selector panel
    │   ├── MatchSetup.tsx       # Match configuration form
    │   ├── Match.tsx            # Core game screen (Street View + guess map)
    │   ├── MatchSidebar.tsx     # In-game score & round sidebar
    │   ├── GuessMiniMap.tsx     # Interactive Google Map for placing guesses
    │   ├── MatchmakingLobby.tsx # H2H queue lobby UI
    │   ├── RoomLobby.tsx        # Private room lobby + share code UI
    │   ├── Leaderboard.tsx      # Leaderboard with time-period filters
    │   ├── Profile.tsx          # User profile page (stats, settings, notifications)
    │   ├── AdminPanel.tsx       # Admin dashboard (maps, feedbacks)
    │   ├── LoginModal.tsx       # Sign in / sign up modal
    │   ├── JoinRoomModal.tsx    # Join a private room by code
    │   ├── FeedbackModal.tsx    # In-game feedback / location report form
    │   ├── NetworkStatusIndicator.tsx
    │   │
    │   └── match/               # Match sub-components & hooks
    │       ├── MatchHud.tsx                    # In-game HUD (timer, round counter, scores)
    │       ├── MatchFinishedOverlay.tsx         # End-of-game results screen
    │       ├── MatchRevealOverlay.tsx           # Per-round result reveal
    │       ├── MatchLoadingOverlay.tsx          # Loading spinner overlay
    │       ├── ReportModal.tsx                  # In-game location report modal
    │       ├── useDoubleBufferedStreetView.tsx  # Hook: background-preloads next panorama
    │       └── useStreetViewTargetQueue.tsx     # Hook: manages round target queue
    │
    └── lib/                     # Business logic, contexts & shared utilities
        ├── AuthContext.tsx       # Supabase auth context (email / OAuth / guest)
        ├── ThemeContext.tsx      # Dark/light theme context
        ├── supabase.ts           # Supabase client initialization
        ├── googleMapsLoader.tsx  # Singleton Google Maps JS API loader
        ├── MapRegions.tsx        # DB-backed map region cache (bounds, fallbacks)
        ├── MatchGame.tsx         # Core game logic (target generation, scoring, Street View)
        ├── Matchmaking.tsx       # Queue management, room CRUD, realtime broadcast
        ├── PlayerStats.tsx       # ELO / EXP calculation, DB read/write, achievements
        └── useNetworkStatus.ts   # Network connectivity hook
```

---

## Architecture Overview

The app is a **single-page application with tab-based routing** driven by a single `activeTab` state in `App.tsx`. No external router is used.

### Navigation Flow

```
Home
 ├── [Play] ──────────────────────→ Setup
 │                                   ├── Classic / Chaos → Match
 │                                   ├── Head-to-Head    → Matchmaking → Match
 │                                   └── Creator Room    → RoomLobby  → Match
 ├── Leaderboards
 ├── Profile
 └── Admin  (admin users only)
```

### Startup Sequence

On load, `App.tsx` runs two parallel async tasks before rendering the main UI:
1. **`testSupabaseConnection()`** — validates the backend is reachable
2. **`loadMapRegions()`** — fetches all enabled map regions and fallback locations from Supabase and populates in-memory caches (`MAPS`, `MAP_REGION_BOUNDS`, `FALLBACK_LOCATIONS`)

A full-screen loading spinner is shown until both resolve. A connection error screen is displayed on failure.

---

## Core Game Logic

### Street View Target Generation (`src/lib/MatchGame.tsx`)

For each round, the game:
1. Picks a random `lat/lng` within the selected map region's bounding box
2. Calls the **Google Street View Metadata API** to verify panorama coverage
3. If valid (status `OK` + `pano_id` returned), uses the snapped coordinates and pano ID
4. Retries up to **30 times** before falling back to curated `FALLBACK_LOCATIONS`
5. For multiplayer modes, a **session-based deduplication set** avoids repeating locations

### Double-Buffered Preloading

The `useDoubleBufferedStreetView` hook preloads the **next round's panorama in the background** while the player is actively guessing the current one, eliminating round-transition loading time.

### Scoring Formula

```
Distance Score = 5000 × e^(−distance_km / 1500)
Time Bonus     = 0.6 + 0.4 × (time_left / round_seconds)
Final Score    = round(Distance Score × Time Bonus)
```

- **Perfect guess at 0 km with full time remaining** → ~5000 points
- Score decays exponentially with distance
- A time bonus multiplier ranging from 0.6× (no time left) to 1.0× (instant guess)

### Distance Calculation

Uses the **Haversine formula** for great-circle distance between two lat/lng points on a sphere of radius 6371 km.

### Distance Display

Distances are rendered in the user's preferred metric:
- `km` (default) — e.g. `12.3 km`, `847 km`
- `miles` — e.g. `7.6 mi`, `526 mi`
- `ft` — e.g. `40,320 ft`

---

## Matchmaking System

Located in `src/lib/Matchmaking.tsx`.

### Queue Flow

```
joinQueue()
    │
    ├── Cleanup stale rooms (cleanup_user_rooms RPC)
    ├── Remove existing queue entry (leave_matchmaking_queue RPC)
    └── Upsert into matchmaking_queue with current ELO
         │
         ▼ (poll every 3 seconds)
    ┌─────────────────────────────────────────┐
    │ 1. Was I matched by someone else?       │ ──→ onMatched (isHost: false)
    │ 2. Can I match someone? (find_match RPC)│ ──→ onMatched (isHost: true)
    │ 3. Has 90 seconds elapsed?              │ ──→ onTimeout
    └─────────────────────────────────────────┘
         │
         ▼ (every 10 seconds)
    ELO range expands: ±150 → ±200 → ... → ±500
```

### `find_match` RPC

An atomic PostgreSQL function using `FOR UPDATE` locking to prevent race conditions when two players attempt to match simultaneously.

### In-Game Realtime Sync

Once matched, all game events are broadcast via a **Supabase Realtime channel** (`room:{roomId}`):

| Message Type | Sender | Purpose |
|---|---|---|
| `guess_submitted` | Any player | Share round score, distance, and guess coordinates |
| `round_advance` | Host | Signal all players to move to the next round |
| `game_over` | Host | Broadcast final scores and winner |
| `reset_match` | Host | Trigger a rematch with new targets |

---

## Database Schema

Full schema and seed data in [`supabase-schema.sql`](./supabase-schema.sql).

### Tables

| Table | Description |
|---|---|
| `profiles` | User record: display name, email, ELO, EXP, games played, admin flag, avatar, preferences, online status |
| `exp_history` | Time-stamped EXP gain log (used for time-filtered leaderboard queries) |
| `notifications` | In-app notification inbox per user (EXP gained, achievements unlocked) |
| `activity_logs` | Login/game event audit trail |
| `matchmaking_queue` | Live queue entries for H2H ELO matchmaking |
| `match_rooms` | Active, waiting, and completed game rooms (targets stored as JSONB) |
| `map_regions` | Playable map regions: bounds, flags, categories, camera config (admin-editable) |
| `map_fallback_locations` | Curated Street View-verified lat/lng fallbacks per region |
| `feedbacks` | Bug reports and feedback submitted in-game, reviewed in Admin Panel |

### Key RPC Functions

All RPCs use `SECURITY DEFINER` to enforce server-side access rules:

| Function | Description |
|---|---|
| `sync_profile` | Upsert user profile on login; generates unique `Guest #XXXX` names for anonymous users |
| `find_match` | Atomic ELO-range matchmaking with row-level locking |
| `close_match_room` | Host deletes their own room |
| `cleanup_user_rooms` | Remove all stale waiting rooms for a specific user |
| `leave_matchmaking_queue` | Atomically remove a user from the queue |
| `delete_guest_profile` | Delete an anonymous user profile on sign-out |
| `cleanup_inactive_guests` | Purge guest profiles inactive for more than N minutes |
| `get_time_filtered_exp` | Aggregate EXP within a time window for leaderboard display |

### Row-Level Security

All tables have RLS enabled. Key policies:
- Users can only read/update/delete **their own** profile, notifications, and activity logs
- Room updates are restricted to **participants** of that room
- Host can only delete **rooms they created**
- `map_regions` and `map_fallback_locations` are **publicly readable** (anon + authenticated)
- Feedbacks are readable only by **the submitter** or **admin users**

### Seeded Map Regions (26 total)

| Category | Regions |
|---|---|
| Popular | World, Indonesia, Japan, USA, Germany, United Kingdom |
| Asia | India, South Korea, Vietnam, Thailand, Philippines, Malaysia, Singapore |
| Europe | France, Italy, Spain, Netherlands, Norway, Sweden |
| Americas | Brazil, USA, Canada, Mexico, Argentina, Chile |
| Oceania | Australia, New Zealand |

---

## Authentication

Located in `src/lib/AuthContext.tsx`, built on **Supabase Auth**.

### Supported Auth Methods
- **Email / Password**
- **OAuth providers** (Google, etc. — configured in Supabase dashboard)
- **Anonymous / Guest** (`supabase.auth.signInAnonymously()`)

### Guest Account Lifecycle
1. On guest login, a unique `Guest #XXXX` name is generated (4-digit random, collision-checked)
2. Presence (`online_status`, `last_seen`) is updated every **2 minutes**
3. On browser close, the user is marked offline
4. Guest profiles inactive for **>10 minutes** are purged by `cleanup_inactive_guests` (called on every app load)
5. On explicit sign-out, the guest profile is deleted immediately via `delete_guest_profile` RPC

### Global Auth Guard
An effect in `App.tsx` automatically redirects unauthenticated users away from protected tabs (`Setup`, `Matchmaking`, `Match`, `RoomLobby`) back to `Home`.

---

## Scoring & Progression

### EXP System

| Event | Base EXP | Bonus |
|---|---|---|
| Classic game completed | 50 | +1 per 100 points scored |
| H2H Win | 100 | +1 per 100 points scored |
| H2H Draw | 60 | +1 per 100 points scored |
| H2H Loss | 30 | +1 per 100 points scored |

**Level** = `floor(totalEXP / 1000) + 1`

### ELO System (Head-to-Head only)

Standard Elo rating with **K-factor = 32**:

```
Expected Score = 1 / (1 + 10^((opponentElo − playerElo) / 400))
ELO Change     = round(32 × (actual − expected))
```
where `actual` = 1 (win), 0.5 (draw), or 0 (loss). ELO cannot drop below 0.

### Achievements

Unlocked achievements trigger in-app notifications:

| Achievement | Condition |
|---|---|
| 🥾 Rookie Explorer | Play 1 game |
| ✈️ World Traveler | Play 10 games |
| 🎖️ Seasoned Veteran | Reach Level 5 (5,000 EXP) |
| 🌟 Living Legend | Reach Level 10 (10,000 EXP) |
| 🏆 Pro Competitor | ELO ≥ 1,100 |
| 🎯 Elite Sniper | Average score ≥ 4,500 per round |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_GOOGLE_MAPS_PLATFORM_KEY=your-google-maps-api-key
```

### Required Google Maps APIs
Enable the following APIs in your Google Cloud project:
- **Maps JavaScript API** (interactive guess map)
- **Street View Static API** / **Street View Publish API** (panorama embed)
- **Street View Metadata API** (location validation — no billed usage for `OK` checks)

### Required Supabase Setup
1. Create a new Supabase project
2. Run `supabase-schema.sql` in the SQL editor to create all tables, policies, functions, and seed data
3. Enable **Anonymous Sign-ins** in Authentication → Providers → Anonymous
4. Enable any OAuth providers you want (e.g. Google) in Authentication → Providers

---

## Installation & Setup

### Prerequisites

- Node.js ≥ 18.0.0
- npm ≥ 9.0.0

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/jackysetiawan6/React-GeoZora.git
cd React-GeoZora

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your Supabase URL, anon key, and Google Maps API key

# 4. Start the development server
npm run dev
```

The app will be available at **`http://localhost:3000`**

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Vite development server on port 3000 |
| `npm run build` | Build the production bundle to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run TypeScript type-check (`tsc --noEmit`) |
| `npm run clean` | Delete the `dist/` build directory |

---

## Contributing

1. Fork the repository
2. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Commit your changes with a descriptive message:
   ```bash
   git commit -m "feat: add your feature description"
   ```
4. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
5. Open a Pull Request against the `main` branch

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

---

**Author:** [jackysetiawan6](https://github.com/jackysetiawan6)
