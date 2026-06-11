import { useState, useRef, useEffect } from "react";
import { Volume2, VolumeX, Volume1 } from "lucide-react";
import { useAudioSettings } from "../../lib/audioManager";
import { Toggle } from "./Toggle";
import { cn } from "../../lib/utils";

interface AudioSettingsControlProps {
	align?: "left" | "right";
}

export function AudioSettingsControl({ align = "right" }: AudioSettingsControlProps) {
	const { settings, setMute, setMusicVolume, setSfxVolume, playSfx } = useAudioSettings();
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);

	const lastPlayedRef = useRef<number>(0);

	// Close on click outside
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		}

		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
		}
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [isOpen]);

	// Play a sample click SFX when SFX volume is adjusted
	const handleSfxChange = (val: number) => {
		setSfxVolume(val);

		// Throttle click sound to not play more than once every 200ms
		const now = Date.now();
		if (now - lastPlayedRef.current > 200) {
			playSfx("click");
			lastPlayedRef.current = now;
		}
	};

	const toggleMute = () => {
		const nextMuted = !settings.isMuted;
		setMute(nextMuted);
		if (!nextMuted) {
			playSfx("click");
		}
	};

	// Determine volume icon based on settings
	const getIcon = () => {
		if (settings.isMuted) return <VolumeX className="w-5 h-5 text-red-400" />;
		const avgVolume = (settings.musicVolume + settings.sfxVolume) / 2;
		if (avgVolume < 0.1) return <VolumeX className="w-5 h-5 text-[var(--color-app-text-muted)]" />;
		if (avgVolume < 0.4) return <Volume1 className="w-5 h-5 text-[var(--color-app-text-muted)]" />;
		return <Volume2 className="w-5 h-5 text-[var(--color-app-blue)]" />;
	};

	return (
		<div className="relative flex-shrink-0" ref={containerRef}>
			<button
				onClick={() => {
					playSfx("click");
					setIsOpen(!isOpen);
				}}
				className={cn(
					"relative text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors p-1.5 rounded-full hover:bg-[var(--color-app-hover)] flex items-center justify-center cursor-pointer",
					isOpen && "text-[var(--color-app-text)] bg-[var(--color-app-hover)]"
				)}
				aria-label="Audio Settings"
				aria-expanded={isOpen}
			>
				{getIcon()}
			</button>

			{isOpen && (
				<div
					className={cn(
						"absolute mt-4 w-[280px] bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl shadow-2xl p-5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 z-[999] backdrop-blur-xl",
						align === "right" ? "right-0" : "left-0"
					)}
					role="menu"
				>
					<div className="flex flex-col gap-4">
						<div className="flex items-center justify-between border-b border-[var(--color-app-border-light)] pb-3">
							<h3 className="font-bold text-[var(--color-app-text)] text-sm">
								Audio Controls
							</h3>
							<Toggle
								label="Mute All"
								checked={settings.isMuted}
								onChange={toggleMute}
							/>
						</div>

						{/* Music Slider */}
						<div className="flex flex-col gap-2">
							<div className="flex justify-between items-center text-xs font-semibold">
								<span className="text-[var(--color-app-text-muted)]">Music Volume</span>
								<span className="text-[var(--color-app-blue)] font-mono">
									{settings.isMuted ? "Muted" : `${Math.round(settings.musicVolume * 100)}%`}
								</span>
							</div>
							<input
								type="range"
								min="0"
								max="1"
								step="0.05"
								value={settings.musicVolume}
								onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
								disabled={settings.isMuted}
								className={cn(
									"w-full h-1.5 bg-[var(--color-app-border)] rounded-lg appearance-none cursor-pointer accent-[var(--color-app-blue)] outline-none transition-opacity",
									settings.isMuted && "opacity-40 cursor-not-allowed"
								)}
							/>
						</div>

						{/* SFX Slider */}
						<div className="flex flex-col gap-2">
							<div className="flex justify-between items-center text-xs font-semibold">
								<span className="text-[var(--color-app-text-muted)]">Sound Effects</span>
								<span className="text-[var(--color-app-blue)] font-mono">
									{settings.isMuted ? "Muted" : `${Math.round(settings.sfxVolume * 100)}%`}
								</span>
							</div>
							<input
								type="range"
								min="0"
								max="1"
								step="0.05"
								value={settings.sfxVolume}
								onChange={(e) => handleSfxChange(parseFloat(e.target.value))}
								disabled={settings.isMuted}
								className={cn(
									"w-full h-1.5 bg-[var(--color-app-border)] rounded-lg appearance-none cursor-pointer accent-[var(--color-app-blue)] outline-none transition-opacity",
									settings.isMuted && "opacity-40 cursor-not-allowed"
								)}
							/>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
