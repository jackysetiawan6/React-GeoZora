import { useState } from "react";
import { Wrench, Settings, RefreshCw, Sun, Moon, ShieldAlert } from "lucide-react";
import { useTheme } from "../lib/ThemeContext";

export default function Maintenance() {
	const { theme, toggleTheme } = useTheme();
	const [isChecking, setIsChecking] = useState(false);

	const handleCheckStatus = () => {
		setIsChecking(true);
		// Simulate network request to check status
		setTimeout(() => {
			window.location.reload();
		}, 1200);
	};

	return (
		<div className="min-h-screen w-screen bg-[var(--color-app-bg)] text-[var(--color-app-text)] flex flex-col items-center justify-center font-sans relative overflow-hidden px-4 select-none transition-colors duration-300">
			{/* Custom styles for float and rotate animations */}
			<style>{`
				@keyframes float-blob-1 {
					0%, 100% { transform: translate(0px, 0px) scale(1); }
					33% { transform: translate(30px, -50px) scale(1.1); }
					66% { transform: translate(-20px, 20px) scale(0.9); }
				}
				@keyframes float-blob-2 {
					0%, 100% { transform: translate(0px, 0px) scale(1); }
					50% { transform: translate(-40px, 40px) scale(1.15); }
				}
				.animate-blob-1 {
					animation: float-blob-1 15s infinite ease-in-out;
				}
				.animate-blob-2 {
					animation: float-blob-2 18s infinite ease-in-out;
				}
			`}</style>

			{/* Ambient Glowing Background Blobs */}
			<div className="absolute inset-0 overflow-hidden pointer-events-none">
				<div className="absolute top-[10%] left-[20%] w-[350px] md:w-[500px] h-[350px] md:h-[500px] bg-[var(--color-app-blue)]/15 rounded-full blur-[100px] md:blur-[130px] animate-blob-1" />
				<div className="absolute bottom-[10%] right-[15%] w-[300px] md:w-[450px] h-[300px] md:h-[450px] bg-[var(--color-app-purple)]/10 rounded-full blur-[100px] md:blur-[130px] animate-blob-2" />
			</div>

			{/* Top Bar with Theme Toggle */}
			<header className="absolute top-6 right-6 z-20">
				<button
					onClick={toggleTheme}
					aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
					className="p-3 bg-[var(--color-app-panel)] border border-[var(--color-app-border)] hover:bg-[var(--color-app-hover)] text-[var(--color-app-text)] rounded-xl transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-lg backdrop-blur-md"
				>
					{theme === "dark" ? (
						<Sun className="w-5 h-5 text-amber-400 animate-pulse" />
					) : (
						<Moon className="w-5 h-5 text-indigo-600" />
					)}
				</button>
			</header>

			{/* Main Maintenance Glassmorphic Card */}
			<main className="relative w-full max-w-lg bg-[var(--color-app-panel)]/40 border border-[var(--color-app-border)] backdrop-blur-2xl rounded-3xl p-8 md:p-12 shadow-2xl flex flex-col items-center text-center z-10 animate-in fade-in zoom-in-95 duration-500">
				{/* Top decorative gradient border */}
				<div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-transparent via-[var(--color-app-blue)] to-[var(--color-app-purple)] rounded-t-3xl" />

				{/* Animated Icons Container */}
				<div className="relative w-24 h-24 mb-8 flex items-center justify-center">
					{/* Outer spinning gear */}
					<Settings className="w-20 h-20 text-[var(--color-app-blue)]/30 animate-[spin_10s_linear_infinite]" />
					{/* Inner reverse-spinning gear */}
					<Settings className="absolute w-12 h-12 text-[var(--color-app-purple)]/40 animate-[spin_6s_linear_infinite_reverse]" />
					{/* Center pulsing Wrench */}
					<div className="absolute bg-[var(--color-app-panel)] p-4 rounded-2xl border border-[var(--color-app-border)] shadow-xl animate-[pulse_2s_infinite]">
						<Wrench className="w-8 h-8 text-[var(--color-app-blue)]" />
					</div>
				</div>

				{/* Title with Gradient Text */}
				<h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-[var(--color-app-text)] via-[var(--color-app-text)] to-[var(--color-app-text-muted)] bg-clip-text text-transparent mb-4 leading-tight">
					Scheduled Maintenance
				</h1>

				{/* Message */}
				<p className="text-[var(--color-app-text-muted)] text-base md:text-md mb-8 leading-relaxed max-w-md">
					GeoZora is currently receiving some server upgrades and map optimizations to bring you a smoother and more accurate geoguess experience.
				</p>

				{/* Status Message Footer */}
				<div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-semibold mb-8">
					<ShieldAlert className="w-3.5 h-3.5" />
					Matchmaking and lobbies are temporarily offline
				</div>

				{/* Action Buttons */}
				<div className="flex flex-col sm:flex-row gap-4 w-full">
					<button
						onClick={handleCheckStatus}
						disabled={isChecking}
						className="flex-1 flex items-center justify-center gap-2.5 px-6 py-3.5 bg-gradient-to-r from-[var(--color-app-blue)] to-[var(--color-app-blue)]/80 hover:from-[var(--color-app-blue)] hover:to-[var(--color-app-blue)] text-white font-bold rounded-2xl shadow-lg shadow-blue-500/15 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 disabled:shadow-none cursor-pointer text-sm"
					>
						<RefreshCw className={`w-4 h-4 ${isChecking ? "animate-spin" : ""}`} />
						{isChecking ? "Checking System Status..." : "Check Status"}
					</button>
				</div>
			</main>


			{/* Footer Copyright */}
			<footer className="absolute bottom-6 text-[var(--color-app-text-muted)]/60 text-xs z-10">
				&copy; {new Date().getFullYear()} GeoZora. All rights reserved.
			</footer>
		</div>
	);
}
