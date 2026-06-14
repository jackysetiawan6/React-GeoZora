# GeoZora

[![GitHub Repository](https://img.shields.io/badge/GitHub-React--GeoZora-blue?logo=github)](https://github.com/jackysetiawan6/React-GeoZora)
[![Website](https://img.shields.io/badge/Website-geozora.vercel.app-green)](https://geozora.vercel.app)

![GeoZora Banner](./public/geozora_banner.png)

**GeoZora** is a premium, real-time multiplayer geography guessing game inspired by GeoGuessr. Players are placed in random Google Street View locations around the world and must pinpoint their location on a map. Built using **React**, **Vite**, **TypeScript**, and **Supabase**, it features a sleek dark mode design with real-time multiplayer lobbies, ELO ratings, level progression, and comprehensive anti-cheat enforcement.

---

## 🚀 Key Features

*   **🎮 Game Modes:**
    *   **Classic Mode:** Single-player gameplay to practice and explore locations, with XP gains and profile level-up progression.
    *   **Head-to-Head Duel:** Real-time 1v1 competitive matchmaking with server-validated ELO changes, matchmaking queue, and presence-based disconnect handling.
    *   **Creator Room Mode:** Custom private rooms supporting up to 30 players. The room master can customize rounds count, round timer, map regions, and navigation constraints (no moving, no panning, no zooming).
*   **⏱️ Match Countdown:** A fullscreen "3, 2, 1" countdown overlay with audio indicators triggers right before each round starts, ensuring players are prepared to play.
*   **📡 Real-time Communication:** Powered by Supabase Broadcast and Presence channels to sync guesses, scores, ready states, and participant activity instantly.
*   **🛡️ Anti-Cheat & Ban Appeal:** 
    *   Built-in developer tools detection and server-side telemetry validation prevent inspect-element usage and client-side coordinate spoofing.
    *   Allows banned users to log in and submit an official suspension appeal via a secure fullscreen appeal interface, rather than blocking authentication entirely.
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
│       ├── 01_core_schema.sql
│       ├── 02_maps_and_config.sql
│       ├── 03_gameplay_match.sql
│       ├── 04_chat_and_feedback.sql
│       ├── 05_anti_cheat_and_telemetry.sql
│       └── 06_rpc_maintenance_utilities.sql
└── src/                  # React Application Source Code
    ├── main.tsx          # App entry point
    ├── App.tsx           # Root component and main layout coordinator
    ├── index.css         # Global stylesheets, theme tokens, and animations
    ├── components/       # UI Components
    │   ├── AdminPanel.tsx           # Admin moderation and controls panel
    │   ├── GameModes.tsx            # Game mode selection cards
    │   ├── GlobeView.tsx            # Interactive 3D home globe backdrop
    │   ├── GuessMiniMap.tsx         # In-game interactive guessing map
    │   ├── Header.tsx               # Navigation and profile status bar
    │   ├── Hero.tsx                 # Home hero section with call-to-actions
    │   ├── Leaderboard.tsx          # Top player leaderboard rankings
    │   ├── LoginModal.tsx           # OAuth Google and Guest login modal
    │   ├── Match.tsx                # Game lifecycle and match controller
    │   ├── MatchSetup.tsx           # Single-player and room rules config
    │   ├── MatchSidebar.tsx         # Match score trackers and status sidebar
    │   ├── RoomLobby.tsx            # Creator Room multiplayer lobby component
    │   ├── ui/                      # Reusable core design components
    │   │   ├── AudioSettingsControl.tsx
    │   │   ├── DynamicBackground.tsx
    │   │   └── Toggle.tsx
    │   └── match/                   # Gameplay components
    │       ├── ChatPanel.tsx        # In-game real-time chat panel
    │       ├── MatchHud.tsx         # Round HUD overlays (timers, info)
    │       ├── MatchLoadingOverlay.tsx
    │       └── MatchRevealOverlay.tsx # Distance & score revelation map
    └── lib/              # Hooks, helpers, APIs, and state contexts
        ├── AuthContext.tsx          # Supabase Auth provider and profile syncer
        ├── MatchGame.tsx            # Game rules, math formulas, and constants
        ├── Matchmaking.tsx          # Room join/leave/create database calls
        ├── PlayerStats.tsx          # Level, ELO, and history progression APIs
        ├── antiCheat.ts             # Telemetry tracking and devtools monitor
        ├── audioManager.ts          # HTML5 Audio BGM & SFX controller
        ├── supabase.ts              # Initialized Supabase client with retry logic
        └── themeContext.tsx         # Global theme context provider (Dark/Light)
```

---

## 🛠️ Technology Stack

*   **Frontend:** React 18, Vite, TypeScript, TailwindCSS (for base layout structure), Lucide Icons
*   **Backend / Database:** Supabase (PostgreSQL)
*   **Realtime Network:** Supabase Realtime (Presence & Broadcast)
*   **APIs:** Google Maps JS API (Street View Service, Maps, Geocoder)

---

## 📦 Architecture & Database Design

GeoZora delegates critical state management and scoring logic to PostgreSQL functions (RPCs) to maintain a secure and authoritative game state.

### Key Database Tables
*   `profiles`: Stores user data, including display names, total XP, current ELO rating, games played, suspension status, and last average score.
*   `match_rooms`: Represents active gameplay lobbies containing participant lists, ready states, scores, round targets (Street View locations), and rules constraints.
*   `match_history`: Logs historic matches with final scores, ELO changes, XP earned, game rules, and matching region configurations.
*   `feedbacks`: Stores user feedback, bug reports, and ban appeals.
*   `notifications`: Real-time alerts sent to users for level-ups, ELO updates, and unlocked achievements.

### Authoritative PL/pgSQL RPCs
*   `submit_match_guess`: Securely verifies coordinate distance using the haversine formula, calculates scores server-side, detects telemetry anomalies, and records guess submissions.
*   `increment_player_stats`: Performs server-side validation of ELO and XP calculations before updating player profiles to block client injections.
*   `join_match_room` / `leave_match_room`: Manages atomic operations for multiplayer lobby joins and departures.

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
