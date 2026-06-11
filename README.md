# GeoZora

![GeoZora Banner](./assets/geozora_banner.png)

**GeoZora** is a premium, real-time multiplayer geography guessing game inspired by GeoGuessr. Players are placed in random Google Street View locations around the world and must pinpoint their location on a map. Built using **React**, **Vite**, **TypeScript**, and **Supabase**, it features a sleek dark mode design with real-time multiplayer lobbies, ELO ratings, level progression, and comprehensive anti-cheat enforcement.

---

## 🚀 Key Features

*   **🎮 Game Modes:**
    *   **Classic Mode:** Single-player gameplay to practice and explore locations, with XP gains and profile level-up progression.
    *   **Head-to-Head Duel:** Real-time 1v1 competitive matchmaking with server-validated ELO changes, matchmaking queue, and presence-based disconnect handling.
    *   **Creator Room Mode:** Custom private rooms supporting up to 30 players. The room master can customize rounds count, round timer, map regions, and navigation constraints (no moving, no panning, no zooming).
*   **📡 Real-time Communication:** Powered by Supabase Broadcast and Presence channels to sync guesses, scores, ready states, and participant activity instantly.
*   **🛡️ Anti-Cheat Enforcement:** Includes built-in developer tools detection and telemetry verification. Prevents inspect-element usage and client-side coordinate spoofing by validating all guesses server-side via PL/pgSQL database functions.
*   **🏆 ELO & Level System:** Fully integrated database schema tracking user experience points (XP), ELO ratings, rank titles, average scores, and custom achievements.
*   **🗺️ Map Regions:** Support for custom map filters (World, Europe, Asia, North America, etc.) using optimized street view coordinates.

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
*   `profiles`: Stores user data, including display names, total XP, current ELO rating, games played, and last average score.
*   `match_rooms`: Represents active gameplay lobbies containing participant lists, ready states, scores, round targets (Street View locations), and rules constraints.
*   `match_history`: Logs historic matches with final scores, ELO changes, XP earned, game rules, and matching region configurations.
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
    git clone https://github.com/your-username/React-GeoZora.git
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
    VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
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
