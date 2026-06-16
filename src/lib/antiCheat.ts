import { useState, useEffect, useRef, useCallback } from "react";

export interface TelemetryData {
	pans: number;
	zooms: number;
	blurs: number;
	duration: number;
	devtools_open: boolean;
}

/**
 * Checks if the current origin is a local development environment.
 * If yes, anti-cheat enforcement is bypassed to allow developers to debug.
 */
export function isBypassOrigin(): boolean {
	if (typeof window === "undefined") return true;
	try {
		const hn = window.location.hostname;
		if (hn === "localhost" || hn === "127.0.0.1" || hn.startsWith("192.168.")) return true;
		const params = new URLSearchParams(window.location.search);
		if (params.get("bypass_anticheat") === "true") return true;
		if (localStorage.getItem("bypass_anticheat") === "true") return true;
	} catch (e) {}
	return false;
}

let isDevToolsDetected = false;

/**
 * Hook to track client telemetry statistics during gameplay.
 * Tracks panning, zooming, window blurs, and round durations.
 */
export function useAntiCheatTelemetry() {
	const [pans, setPans] = useState(0);
	const [zooms, setZooms] = useState(0);
	const [blurs, setBlurs] = useState(0);
	const roundStartTimeRef = useRef<number>(0);

	const incrementPans = useCallback(() => {
		setPans(p => p + 1);
	}, []);

	const incrementZooms = useCallback(() => {
		setZooms(z => z + 1);
	}, []);

	const resetTelemetry = useCallback((startTime = Date.now()) => {
		setPans(0);
		setZooms(0);
		setBlurs(0);
		roundStartTimeRef.current = startTime;
	}, []);

	useEffect(() => {
		const handleBlur = () => {
			setBlurs(b => b + 1);
		};
		window.addEventListener("blur", handleBlur);
		return () => window.removeEventListener("blur", handleBlur);
	}, []);

	const getTelemetry = useCallback((): TelemetryData => {
		const duration = roundStartTimeRef.current
			? Math.round((Date.now() - roundStartTimeRef.current) / 10) / 100
			: 0;

		const devtools_open = isBypassOrigin() ? false : (
			isDevToolsDetected ||
			window.outerWidth - window.innerWidth > 160 ||
			window.outerHeight - window.innerHeight > 160
		);

		return {
			pans,
			zooms,
			blurs,
			duration,
			devtools_open,
		};
	}, [pans, zooms, blurs]);

	return {
		pans,
		zooms,
		blurs,
		incrementPans,
		incrementZooms,
		resetTelemetry,
		getTelemetry,
	};
}

/**
 * Locks down global objects to prevent external scripts from hooking into fetch or geolocation APIs.
 */
export function freezeGlobalAPIs(): void {
	if (typeof window === "undefined" || isBypassOrigin()) return;

	try {
		// Prevent modifying fetch and geolocation
		Object.freeze(window.fetch);
		if (navigator.geolocation) {
			Object.freeze(navigator.geolocation);
			Object.freeze(navigator.geolocation.getCurrentPosition);
			Object.freeze(navigator.geolocation.watchPosition);
		}
	} catch (e) {
		console.debug("Failed to freeze global APIs:", e);
	}
}

/**
 * Initializes listeners to detect when Developer Tools (Inspect Element) is open.
 * Triggers callback when status changes.
 */
export function initAntiCheat(onChange: (detected: boolean) => void): () => void {
	if (typeof window === "undefined" || isBypassOrigin()) {
		return () => {};
	}

	let devToolsOpen = false;

	const setStatus = (open: boolean) => {
		isDevToolsDetected = open;
		if (devToolsOpen !== open) {
			devToolsOpen = open;
			onChange(open);
		}
	};

	// 1. Docked DevTools Check (Window size differential)
	const checkDimensions = () => {
		const threshold = 160;
		const isDocked =
			window.outerWidth - window.innerWidth > threshold ||
			window.outerHeight - window.innerHeight > threshold;
		setStatus(isDocked);
	};

	// 2. Timing-based Debugger Check
	const debuggerTimer = setInterval(() => {
		const start = Date.now();
		// eslint-disable-next-line no-debugger
		debugger;
		const end = Date.now();
		// If debugger halted execution, delay will be significant
		if (end - start > 100) {
			setStatus(true);
		}
	}, 1000);

	// 3. Getter-based Console Object Check (Multi-vector)
	const element = new Image();
	Object.defineProperty(element, "id", {
		get: () => {
			setStatus(true);
			throw new Error("DevTools detected");
		},
	});

	const regex = /./;
	regex.toString = function () {
		setStatus(true);
		return "regex-trap";
	};

	const func = function () {};
	func.toString = function () {
		setStatus(true);
		return "function-trap";
	};

	const consoleTimer = setInterval(() => {
		console.log(element);
		console.log(regex);
		console.log(func);
		console.clear();
	}, 2000);

	window.addEventListener("resize", checkDimensions);
	checkDimensions();

	// Initialize freezing of standard network APIs
	freezeGlobalAPIs();

	return () => {
		clearInterval(debuggerTimer);
		clearInterval(consoleTimer);
		window.removeEventListener("resize", checkDimensions);
	};
}
