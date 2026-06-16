/**
 * Web Audio API AudioManager for GeoZora
 * Synthesizes background music (BGM) and sound effects (SFX) completely programmatically.
 * Features an upbeat retro chiptune step sequencer.
 */

export type SfxType =
	| "click"
	| "hover"
	| "roundStart"
	| "guessSubmit"
	| "reveal"
	| "tick"
	| "gameOver"
	| "join";

export interface AudioSettings {
	isMuted: boolean;
	musicVolume: number; // 0 to 1
	sfxVolume: number; // 0 to 1
}

const DEFAULT_SETTINGS: AudioSettings = {
	isMuted: false,
	musicVolume: 0.35,
	sfxVolume: 0.5,
};

type Listener = (settings: AudioSettings) => void;

class AudioManager {
	private audioCtx: AudioContext | null = null;
	private settings: AudioSettings = { ...DEFAULT_SETTINGS };
	private listeners: Set<Listener> = new Set();

	// Audio routing nodes
	private musicGainNode: GainNode | null = null;
	private sfxGainNode: GainNode | null = null;

	// BGM Audio nodes
	private bgmElement: HTMLAudioElement | null = null;
	private bgmSource: MediaElementAudioSourceNode | null = null;

	private isPlayingMusic = false;

	constructor() {
		// Load settings from localStorage
		try {
			const saved = localStorage.getItem("geozora_audio_settings");
			if (saved) {
				const parsed = JSON.parse(saved);
				this.settings = {
					isMuted: typeof parsed.isMuted === "boolean" ? parsed.isMuted : DEFAULT_SETTINGS.isMuted,
					musicVolume: typeof parsed.musicVolume === "number" ? Math.max(0, Math.min(1, parsed.musicVolume)) : DEFAULT_SETTINGS.musicVolume,
					sfxVolume: typeof parsed.sfxVolume === "number" ? Math.max(0, Math.min(1, parsed.sfxVolume)) : DEFAULT_SETTINGS.sfxVolume,
				};
			}
		} catch (e) {
			console.warn("Failed to load audio settings", e);
		}
	}

	/**
	 * Lazy-initializes the AudioContext and sets up the routing nodes.
	 */
	public init() {
		if (this.audioCtx) return;

		try {
			const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
			if (!AudioContextClass) {
				console.warn("Web Audio API is not supported in this browser.");
				return;
			}
			this.audioCtx = new AudioContextClass();

			// Main SFX and Music Gain nodes
			this.musicGainNode = this.audioCtx.createGain();
			this.sfxGainNode = this.audioCtx.createGain();

			// Create HTML5 Audio element for looping BGM
			this.bgmElement = new Audio("/audio/bgm.mp3");
			this.bgmElement.loop = true;

			// Create media source and connect to music gain node
			this.bgmSource = this.audioCtx.createMediaElementSource(this.bgmElement);
			this.bgmSource.connect(this.musicGainNode);

			// Wire up music nodes to destination
			this.musicGainNode.connect(this.audioCtx.destination);

			// Wire up SFX node directly
			this.sfxGainNode.connect(this.audioCtx.destination);

			this.updateGains();
		} catch (err) {
			console.error("Failed to initialize AudioContext", err);
		}
	}

	public async resume(): Promise<void> {
		this.init();
		if (this.audioCtx && this.audioCtx.state === "suspended") {
			await this.audioCtx.resume();
		}
	}

	public subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener({ ...this.settings });
		return () => {
			this.listeners.delete(listener);
		};
	}

	public getSettings(): AudioSettings {
		return { ...this.settings };
	}

	public updateSettings(newSettings: Partial<AudioSettings>) {
		this.settings = { ...this.settings, ...newSettings };
		this.updateGains();
		this.notifyListeners();

		try {
			localStorage.setItem("geozora_audio_settings", JSON.stringify(this.settings));
		} catch (e) {
			console.warn("Failed to save audio settings", e);
		}
	}

	private notifyListeners() {
		this.listeners.forEach(l => l({ ...this.settings }));
	}

	private updateGains() {
		const isMuted = this.settings.isMuted;
		const mVol = isMuted ? 0 : this.settings.musicVolume;
		const sVol = isMuted ? 0 : this.settings.sfxVolume;

		if (this.musicGainNode && this.audioCtx) {
			// Pre-recorded MP3 tracks can clip/be loud, we use a balanced gain scale
			this.musicGainNode.gain.setValueAtTime(mVol * 0.22, this.audioCtx.currentTime);
		}
		if (this.sfxGainNode && this.audioCtx) {
			this.sfxGainNode.gain.setValueAtTime(sVol * 0.38, this.audioCtx.currentTime);
		}
	}

	// ─── BACKGROUND MUSIC (BGM) PLAYER ──────────────────────────

	public startMusic() {
		if (this.isPlayingMusic) return;
		this.init();
		if (!this.bgmElement) return;

		this.isPlayingMusic = true;

		// Resume the AudioContext (can be asynchronous, doesn't block play())
		if (this.audioCtx && this.audioCtx.state === "suspended") {
			void this.audioCtx.resume();
		}

		// Play BGM synchronously inside the user gesture handler
		this.bgmElement.play().catch(err => {
			console.warn("BGM playback blocked or failed:", err);
			this.isPlayingMusic = false;
		});
	}

	public stopMusic() {
		this.isPlayingMusic = false;
		if (this.bgmElement) {
			this.bgmElement.pause();
		}
	}

	// ─── GAME SOUND EFFECTS (SFX) SYNTHESIZER ──────────────────

	public playSfx(type: SfxType, score?: number) {
		void this.resume().then(() => {
			if (!this.audioCtx || !this.sfxGainNode || this.settings.isMuted) return;

			const ctx = this.audioCtx;
			const now = ctx.currentTime;

			switch (type) {
				case "click": {
					// Snap frequency sweep
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();

					osc.type = "sine";
					osc.frequency.setValueAtTime(950, now);
					osc.frequency.exponentialRampToValueAtTime(360, now + 0.075);

					gain.gain.setValueAtTime(0.42, now);
					gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

					osc.connect(gain);
					gain.connect(this.sfxGainNode);

					osc.start(now);
					osc.stop(now + 0.075);
					break;
				}

				case "hover": {
					// Satisfying high-pitched keyboard-like interface tick
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();

					osc.type = "triangle";
					osc.frequency.setValueAtTime(1800, now);
					osc.frequency.setValueAtTime(1400, now + 0.005);

					gain.gain.setValueAtTime(0.08, now); // extremely subtle
					gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

					osc.connect(gain);
					gain.connect(this.sfxGainNode);

					osc.start(now);
					osc.stop(now + 0.015);
					break;
				}

				case "roundStart": {
					// High-speed rising intro chime sweep
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();
					const filter = ctx.createBiquadFilter();

					filter.type = "lowpass";
					filter.frequency.setValueAtTime(220, now);
					filter.frequency.exponentialRampToValueAtTime(1800, now + 0.45);

					osc.type = "sawtooth";
					osc.frequency.setValueAtTime(196.00, now); // G3
					osc.frequency.linearRampToValueAtTime(392.00, now + 0.45); // G3 -> G4

					gain.gain.setValueAtTime(0, now);
					gain.gain.linearRampToValueAtTime(0.45, now + 0.08);
					gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

					osc.connect(filter);
					filter.connect(gain);
					gain.connect(this.sfxGainNode);

					osc.start(now);
					osc.stop(now + 0.65);

					// Bright C-Major arpeggio overlay
					const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
					notes.forEach((freq, index) => {
						const cOsc = ctx.createOscillator();
						const cGain = ctx.createGain();

						cOsc.type = "sine";
						cOsc.frequency.setValueAtTime(freq, now + index * 0.05);

						cGain.gain.setValueAtTime(0, now + index * 0.05);
						cGain.gain.linearRampToValueAtTime(0.35, now + index * 0.05 + 0.015);
						cGain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.05 + 0.5);

						cOsc.connect(cGain);
						cGain.connect(this.sfxGainNode);

						cOsc.start(now + index * 0.05);
						cOsc.stop(now + index * 0.05 + 0.55);
					});
					break;
				}

				case "guessSubmit": {
					// Bouncy slide sweep
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();

					osc.type = "sine";
					osc.frequency.setValueAtTime(280, now);
					osc.frequency.exponentialRampToValueAtTime(980, now + 0.18);

					gain.gain.setValueAtTime(0.01, now);
					gain.gain.linearRampToValueAtTime(0.48, now + 0.04);
					gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

					osc.connect(gain);
					gain.connect(this.sfxGainNode);

					osc.start(now);
					osc.stop(now + 0.19);
					break;
				}

				case "reveal": {
					const points = score ?? 0;
					let scale: number[] = [];

					if (points >= 4800) {
						// Masterful Sparkle G Major Pentatonic Chime
						scale = [392.0, 440.0, 493.88, 587.33, 783.99, 987.77, 1174.66];
					} else if (points >= 4000) {
						// Excellent: Major Triad
						scale = [261.63, 329.63, 392.0, 523.25, 659.25];
					} else if (points >= 2000) {
						// Good: Happy Major chord
						scale = [261.63, 329.63, 392.0];
					} else if (points > 0) {
						// Neutral
						scale = [220.0, 330.0];
					} else {
						// Dissonant low tritone
						scale = [110.0, 155.56];
					}

					const noteDuration = points >= 4000 ? 0.7 : 1.0;
					scale.forEach((freq, idx) => {
						const noteStart = now + idx * 0.06;
						const osc = ctx.createOscillator();
						const gain = ctx.createGain();

						osc.type = points === 0 ? "sawtooth" : "sine";
						osc.frequency.setValueAtTime(freq, noteStart);

						gain.gain.setValueAtTime(0, noteStart);
						gain.gain.linearRampToValueAtTime(points === 0 ? 0.22 : 0.45, noteStart + 0.01);
						gain.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDuration);

						if (points === 0) {
							const f = ctx.createBiquadFilter();
							f.type = "lowpass";
							f.frequency.setValueAtTime(250, noteStart);
							osc.connect(f);
							f.connect(gain);
						} else {
							osc.connect(gain);
						}

						gain.connect(this.sfxGainNode);
						osc.start(noteStart);
						osc.stop(noteStart + noteDuration + 0.05);
					});
					break;
				}

				case "tick": {
					// Tick click
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();

					osc.type = "triangle";
					osc.frequency.setValueAtTime(1100, now);

					gain.gain.setValueAtTime(0.2, now);
					gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

					osc.connect(gain);
					gain.connect(this.sfxGainNode);

					osc.start(now);
					osc.stop(now + 0.03);
					break;
				}

				case "join": {
					// Bubble popping chime
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();

					osc.type = "sine";
					osc.frequency.setValueAtTime(650, now);
					osc.frequency.exponentialRampToValueAtTime(1400, now + 0.1);

					gain.gain.setValueAtTime(0, now);
					gain.gain.linearRampToValueAtTime(0.38, now + 0.015);
					gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

					osc.connect(gain);
					gain.connect(this.sfxGainNode);

					osc.start(now);
					osc.stop(now + 0.11);
					break;
				}

				case "gameOver": {
					// Upbeat victory cadence
					const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 1046.50];
					scale.forEach((freq, idx) => {
						const noteStart = now + idx * 0.07;
						const osc = ctx.createOscillator();
						const gain = ctx.createGain();

						osc.type = "sine";
						osc.frequency.setValueAtTime(freq, noteStart);

						gain.gain.setValueAtTime(0, noteStart);
						gain.gain.linearRampToValueAtTime(0.38, noteStart + 0.015);
						gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 1.0);

						osc.connect(gain);
						gain.connect(this.sfxGainNode);

						osc.start(noteStart);
						osc.stop(noteStart + 1.1);
					});

					// Resolving C6 chord overlay
					const finalChord = [523.25, 659.25, 783.99, 987.77, 1046.50]; // C5, E5, G5, B5, C6
					const chordStart = now + scale.length * 0.07 + 0.08;
					finalChord.forEach(freq => {
						const osc = ctx.createOscillator();
						const gain = ctx.createGain();

						osc.type = "sine";
						osc.frequency.setValueAtTime(freq, chordStart);

						gain.gain.setValueAtTime(0, chordStart);
						gain.gain.linearRampToValueAtTime(0.38, chordStart + 0.2);
						gain.gain.exponentialRampToValueAtTime(0.001, chordStart + 2.5);

						osc.connect(gain);
						gain.connect(this.sfxGainNode);

						osc.start(chordStart);
						osc.stop(chordStart + 2.6);
					});
					break;
				}
			}
		});
	}
}

export const audioManager = new AudioManager();

import { useState, useEffect } from "react";

export function useAudioSettings() {
	const [settings, setSettings] = useState<AudioSettings>(() => audioManager.getSettings());

	useEffect(() => {
		const unsubscribe = audioManager.subscribe(updated => {
			setSettings(updated);
		});
		return unsubscribe;
	}, []);

	const setMute = (isMuted: boolean) => {
		audioManager.updateSettings({ isMuted });
	};

	const setMusicVolume = (musicVolume: number) => {
		audioManager.updateSettings({ musicVolume });
	};

	const setSfxVolume = (sfxVolume: number) => {
		audioManager.updateSettings({ sfxVolume });
	};

	return {
		settings,
		setMute,
		setMusicVolume,
		setSfxVolume,
		playSfx: (type: SfxType, score?: number) => audioManager.playSfx(type, score),
		startMusic: () => audioManager.startMusic(),
		stopMusic: () => audioManager.stopMusic(),
		resumeAudio: () => audioManager.resume(),
	};
}
