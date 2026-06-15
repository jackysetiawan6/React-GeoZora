# GeoZora

[![GitHub Repository](https://img.shields.io/badge/GitHub-React--GeoZora-blue?logo=github)](https://github.com/jackysetiawan6/React-GeoZora)
[![Website](https://img.shields.io/badge/Website-geozora.vercel.app-green)](https://geozora.vercel.app)

![GeoZora Banner](./public/geozora_banner.png)

**GeoZora** is a premium, real-time multiplayer geography guessing game inspired by GeoGuessr. Players are placed in random Google Street View locations around the world and must pinpoint their location on a map. Built using **React**, **Vite**, **TypeScript**, and **Supabase**, it features a sleek dark mode design with real-time multiplayer lobbies, ELO ratings, level progression, and comprehensive anti-cheat enforcement.

---

## 🚀 Key Features

*   **🎮 Game Modes:**
    *   **Classic Mode:** Single-player gameplay to practice and explore locations, with XP gains and profile level-up progression.
    *   **VS AI Mode:** Practice and test your skills against 5 difficulty levels of automated bots in single-player mode, featuring realistic, randomized delays and guessing ranges:
        1.  🎒 **Lost Lucy (Level 1 - Easy):** Navigates blindly. Guesses range from 2,000km to 6,000km away; takes 15–25s.
        2.  🥾 **Wandering Will (Level 2 - Medium-Easy):** Takes the scenic route. Guesses range from 1,000km to 2,000km away; takes 12–20s.
        3.  🧭 **Navigator Nick (Level 3 - Medium):** Calibrates via sun angle. Guesses range from 400km to 1,000km away; takes 10–18s.
        4.  🧠 **Geographer Grace (Level 4 - Hard):** Identifies specific tree species and bollards. Guesses range from 100km to 400km away; takes 8–15s.
        5.  🤖 **T-1000 GeoBot (Level 5 - Expert):** Pixel-perfect machine scan. Guesses range from 0km to 100km away; takes 4–8s.
    *   **Head-to-Head Duel:** Real-time 1v1 competitive matchmaking with server-validated ELO changes, matchmaking queue, and presence-based disconnect handling.
    *   **Creator Room Mode:** Custom private rooms supporting up to 30 players. The room master can customize rounds count, round timer, map regions, and navigation constraints (no moving, no panning, no zooming).
*   **⏱️ Match Countdown:** A fullscreen "3, 2, 1" countdown overlay with audio indicators triggers right before each round starts, ensuring players are prepared to play.
*   **📡 Real-time Communication:** Powered by Supabase Broadcast and Presence channels to sync guesses, scores, ready states, and participant activity instantly.
*   **💾 Guest Account Saving & Linking:** Allows guest accounts to link their progress to a Google Account via Supabase OAuth `linkIdentity`. This automatically syncs Google's profile name and picture, merges ELO/XP/match history, and prevents account removal by the database cleanup cron job.
*   **🛡️ Anti-Cheat & Ban Appeal:** 
    *   **Developer Console Interception**: Real-time timing-based debugger halts, dimension differential checks, and multi-vector console print traps (RegExp/Function toString overrides) to detect docked and detached/new-window developer consoles.
    *   **DOM State Protection**: Custom runtime proxies on `Object.keys`, `Object.getOwnPropertyNames`, and `Reflect.ownKeys` hide internal `__reactFiber$` and `__reactContainer$` keys on DOM elements from cheat scripts.
    *   **Network Request Isolation**: Sandboxed iframe-based `fetch` method bypasses global fetch overrides set up by Tampermonkey scripts, securing Supabase database requests.
    *   **Obfuscation**: Production code built using `Terser` to compress structure and mangle internal variables and properties.
    *   **Suspension Appeal Interface**: Allows suspended/banned users to submit appeals directly from a secure moderation screen.
*   **🏆 ELO & Level System:** Fully integrated database schema tracking user experience points (XP), ELO ratings, rank titles, average scores, and custom achievements.
*   **🗺️ Map Regions:** Support for custom map filters (World, Europe, Asia, North America, etc.) using optimized street view coordinates.

---

## 📂 Project Structure

```
React-GeoZora/
├── .env.example          # Sample environment variables configuration
├── eslint.config.js      # ESLint configuration
├── index.html            # Main HTML entry point
├── package.json          # Dependency and script definitions
├── tsconfig.json         # TypeScript configuration
├── vite.config.ts        # Vite build configuration
├── assets/               # Branding and design banner resources
│   └── geozora_banner.png
├── public/               # Static assets folder (served at root)
│   ├── logo.png          # High-quality GeoZora game logo
│   └── favicon.png       # Site favicon
├── supabase/             # Supabase configuration & migrations
│   └── migrations/
│       ├── 01_core_schema.sql                   # Profiles, progression ELO, ban policies
│       ├── 02_maps_and_config.sql               # Default maps and regions coordinates
│       ├── 03_gameplay_match.sql                # Matchmaking queue, rooms, match history
│       ├── 04_chat_and_feedback.sql             # Chat messages, feedback logs, appeals
│       ├── 05_anti_cheat_and_telemetry.sql      # Client telemetry and devtools violations
│       ├── 06_rpc_gameplay.sql                  # Authoritative gameplay RPCs (guesses, ELO)
│       ├── 07_rpc_matchmaking.sql               # Multiplayer matchmaking queue RPCs
│       ├── 08_rpc_chat_and_feedback.sql         # Real-time chat messaging RPCs
│       └── 09_rpc_maintenance_utilities.sql     # Admin maintenance, cleanups, offline checks
└── src/                  # React Application Source Code
    ├── main.tsx          # App entry point
    ├── App.tsx           # Root component and main layout coordinator
    ├── index.css         # Global stylesheets, theme tokens, and animations
    ├── vite-env.d.ts     # Vite environment types
    ├── components/       # UI Components
    │   ├── AdminPanel.tsx           # Admin moderation and controls panel
    │   ├── ErrorBoundary.tsx        # React global boundary capturing crash states
    │   ├── FeedbackModal.tsx        # In-game feedback / bug reporter modal
    │   ├── GameModes.tsx            # Game mode selection cards
    │   ├── GlobeView.tsx            # Interactive 3D home globe backdrop
    │   ├── GuessMiniMap.tsx         # In-game interactive guessing map
    │   ├── Header.tsx               # Navigation and profile status bar
    │   ├── Hero.tsx                 # Home hero section with call-to-actions
    │   ├── JoinRoomModal.tsx        # Join private room via code dialog
    │   ├── Leaderboard.tsx          # Top player leaderboard rankings
    │   ├── LoginModal.tsx           # OAuth Google and Guest login modal
    │   ├── Maintenance.tsx          # Standalone site maintenance display screen
    │   ├── Match.tsx                # Game lifecycle and match controller
    │   ├── MatchHistory.tsx         # History list of previous matches and scores
    │   ├── MatchSetup.tsx           # Single-player and room rules config
    │   ├── MatchSidebar.tsx         # Match score trackers and status sidebar
    │   ├── MatchmakingLobby.tsx     # Competitive matchmaking loading screen
    │   ├── NetworkStatusIndicator.tsx # Alert badge showing offline connection states
    │   ├── Profile.tsx              # Player settings and Google linking banner
    │   ├── RoomChat.tsx             # Room lobby mini-chat panel
    │   ├── RoomLobby.tsx            # Creator Room multiplayer lobby component
    │   ├── ui/                      # Reusable core design components
    │   │   ├── AudioSettingsControl.tsx
    │   │   ├── Dropdown.tsx         # Custom styled select dropdown menu
    │   │   ├── DynamicBackground.tsx
    │   │   ├── NumericInput.tsx     # Input box with number validation
    │   │   ├── Toggle.tsx
    │   │   └── index.ts             # Export barrel for UI components
    │   └── match/                   # Gameplay components
    │       ├── ChatPanel.tsx        # In-game real-time chat panel
    │       ├── MatchFinishedOverlay.tsx # Final match recap and score summary
    │       ├── MatchHud.tsx         # Round HUD overlays (timers, info)
    │       ├── MatchLoadingOverlay.tsx
    │       ├── MatchRevealOverlay.tsx # Distance & score revelation map
    │       ├── ReportModal.tsx      # Cheat/behavior reporting form
    │       ├── VirtualChatPanel.tsx # Virtualized chat optimizer for large lobbies
    │       ├── useDoubleBufferedStreetView.tsx # Custom streetview precaching hook
    │       └── useStreetViewTargetQueue.tsx    # Hook managing street view location queues
    └── lib/              # Hooks, helpers, APIs, and state contexts
        ├── AuthContext.tsx          # Supabase Auth provider and profile syncer
        ├── ConnectionHealthMonitor.ts # Monitors network ping and supabase socket health
        ├── MapRegions.tsx           # Map boundary geometries and filters definitions
        ├── MatchGame.tsx            # Game rules, math formulas, and constants
        ├── Matchmaking.tsx          # Room join/leave/create database calls
        ├── MessageBatcher.ts        # Batches real-time chat messages for throttle control
        ├── PlayerStats.tsx          # Level, ELO, and history progression APIs
        ├── RoomPresenceMonitor.ts   # Synchronizes active participant list inside rooms
        ├── ThemeContext.tsx         # Theme provider wrapper (Dark/Light)
        ├── antiCheat.ts             # Telemetry tracking and devtools monitor
        ├── audioManager.ts          # HTML5 Audio BGM & SFX controller
        ├── chatTypes.ts             # Shared chat TypeScript declarations
        ├── chatUtils.ts             # Message formatting and validation utilities
        ├── googleMapsLoader.tsx     # Loader utility for Google Maps JS API script
        ├── matchSessionPersistence.ts # Stores gameplay state in sessionStorage on reload
        ├── reactFiberProtect.ts     # Traps to hide React internals from enumeration
        ├── supabase.ts              # Supabase client with sandboxed fetch & retry logic
        ├── types.ts                 # Common global TypeScript declarations
        ├── useFocusTrap.ts          # Accessibility focus trap hook for dialog boxes
        ├── useNetworkStatus.ts      # Listeners tracking network online/offline states
        ├── userPreferencesCache.ts  # Caches display settings in localStorage
        └── utils.ts                 # ELO rank calculators and style mergers
```

---

## 🛠️ Technology Stack

*   **Frontend:** React 19, Vite, TypeScript, TailwindCSS (for base layout structure), Lucide Icons
*   **Backend / Database:** Supabase (PostgreSQL)
*   **Realtime Network:** Supabase Realtime (Presence & Broadcast)
*   **APIs:** Google Maps JS API (Street View Service, Maps, Geocoder)

---

## 📦 Architecture & Database Design

GeoZora delegates critical state management and scoring logic to PostgreSQL functions (RPCs) to maintain a secure and authoritative game state.

### Key Database Tables
*   `profiles`: Stores user data, including display names, total XP, current ELO rating, games played, suspension status, and last average score.
*   `exp_history`: Tracks experience point (XP) gains over time.
*   `notifications`: Real-time alerts sent to users for level-ups, ELO updates, and unlocked achievements.
*   `activity_logs`: Logs user actions (like logins/logouts) for auditing.
*   `matchmaking_queue`: Temporary queue tracking users waiting for head-to-head matches.
*   `match_rooms`: Represents active gameplay lobbies containing participant lists, ready states, scores, round targets (Street View locations), and rules constraints.
*   `match_history`: Logs historic matches with final scores, ELO changes, XP earned, game rules, and matching region configurations.
*   `room_messages`: In-game chat messages synchronized via real-time websockets.
*   `feedbacks`: Stores user feedback, bug reports, and ban appeals.
*   `cheat_logs`: Automatically records devtools violations, client telemetry mismatches, and suspected cheats.

### Authoritative PL/pgSQL RPCs
*   `sync_profile`: Connects client session details to database profiles, auto-handles guest-to-Google transitions, and generates unique guest names.
*   `submit_match_guess`: Securely verifies coordinate distance using the haversine formula, calculates scores server-side, detects telemetry anomalies, and records guess submissions.
*   `increment_player_stats`: Performs server-side validation of ELO and XP calculations before updating player profiles to block client injections.
*   `join_match_room` / `leave_match_room`: Manages atomic operations for multiplayer lobby joins and departures.
*   `delete_guest_profile`: Safely purges a guest profile when they manually log out.
*   `cleanup_inactive_guests`: An admin-only maintenance procedure scheduled via pg_cron to remove stale guest entries.

---

## 🔧 Getting Started

### Prerequisites
*   Node.js (v18 or higher)
*   NPM or PNPM
*   A Supabase Project
*   A Google Maps API Key (with Street View and Geocoding APIs enabled)

### Local Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/jackysetiawan6/React-GeoZora.git
    cd React-GeoZora
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Environment Variables:**
    Create a `.env` file in the root directory based on `.env.example`:
    ```env
    VITE_SUPABASE_URL=your_supabase_url
    VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
    VITE_GOOGLE_MAPS_PLATFORM_KEY=your_google_maps_platform_key
    VITE_IS_MAINTENANCE_MODE=false
    ```

4.  **Database Migrations:**
    Apply the SQL scripts under the `supabase/migrations/` folder directly to your Supabase SQL Editor.

5.  **Run Development Server:**
    ```bash
    npm run dev
    ```

6.  **Build for Production:**
    ```bash
    npm run build
    ```

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request if you want to suggest improvements, report bugs, or add new map regions.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
