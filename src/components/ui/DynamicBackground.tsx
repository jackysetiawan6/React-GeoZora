import { useEffect, useRef } from "react";
import { useTheme } from "../../lib/ThemeContext";

interface Particle {
	x: number;
	y: number;
	size: number;
	speedX: number;
	speedY: number;
	opacity: number;
	fadeDirection: number;
}

export function DynamicBackground() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const { theme } = useTheme();
	const themeRef = useRef(theme);

	useEffect(() => {
		themeRef.current = theme;
	}, [theme]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let animationFrameId: number;
		let width = 0;
		let height = 0;

		// Particles configuration
		const particles: Particle[] = [];
		const maxParticles = 40;

		// Setup dimensions
		const resize = () => {
			const dpr = window.devicePixelRatio || 1;
			width = window.innerWidth;
			height = window.innerHeight;
			canvas.width = width * dpr;
			canvas.height = height * dpr;
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			ctx.scale(dpr, dpr);
		};

		resize();
		window.addEventListener("resize", resize);

		// Initialize particles
		for (let i = 0; i < maxParticles; i++) {
			particles.push({
				x: Math.random() * width,
				y: Math.random() * height,
				size: Math.random() * 1.5 + 0.5,
				speedX: (Math.random() - 0.5) * 0.15,
				speedY: (Math.random() - 0.5) * 0.15,
				opacity: Math.random() * 0.5 + 0.1,
				fadeDirection: Math.random() > 0.5 ? 1 : -1,
			});
		}

		// Grid & Blob variables
		let gridOffset = 0;
		const gridSpeed = 0.05;

		// Glowing Blobs (Slow orbiting points)
		const blobs = [
			{ x: 0, y: 0, radius: 0, targetRadius: 0, angle: 0, speed: 0.0007, color: "" },
			{ x: 0, y: 0, radius: 0, targetRadius: 0, angle: Math.PI, speed: 0.0005, color: "" },
		];

		// Render Loop
		const render = () => {
			// 1. Clear background & draw theme base
			ctx.clearRect(0, 0, width, height);

			const isDark = themeRef.current === "dark";

			// Base fill
			ctx.fillStyle = isDark ? "#070b14" : "#f8fafc";
			ctx.fillRect(0, 0, width, height);

			// Update blob position/sizes
			blobs[0].angle += blobs[0].speed;
			blobs[1].angle += blobs[1].speed;

			blobs[0].radius = width * 0.45;
			blobs[1].radius = width * 0.35;

			// Blob orbits
			blobs[0].x = width * 0.3 + Math.cos(blobs[0].angle) * (width * 0.15);
			blobs[0].y = height * 0.2 + Math.sin(blobs[0].angle * 0.8) * (height * 0.1);
			blobs[0].color = isDark ? "rgba(59, 130, 246, 0.09)" : "rgba(186, 230, 253, 0.22)"; // Cyan/Blue

			blobs[1].x = width * 0.7 + Math.sin(blobs[1].angle) * (width * 0.12);
			blobs[1].y = height * 0.7 + Math.cos(blobs[1].angle * 1.2) * (height * 0.12);
			blobs[1].color = isDark ? "rgba(139, 92, 246, 0.06)" : "rgba(224, 204, 250, 0.25)"; // Purple/Lilac

			// Draw glowing blobs
			blobs.forEach(b => {
				const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius);
				grad.addColorStop(0, b.color);
				grad.addColorStop(1, "rgba(0,0,0,0)");
				ctx.fillStyle = grad;
				ctx.beginPath();
				ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
				ctx.fill();
			});

			// 2. Draw Latitude/Longitude Grid Lines (Geographical aesthetic)
			gridOffset += gridSpeed;
			ctx.lineWidth = 0.5;
			ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.015)" : "rgba(15, 23, 42, 0.015)";
			ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.12)";
			ctx.font = "9px monospace";

			// Horizontal Latitude lines
			const latSpacing = 120;
			const startLat = Math.floor(-gridOffset) % latSpacing;
			for (let y = startLat; y < height; y += latSpacing) {
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(width, y);
				ctx.stroke();

				// Draw coordinates label (e.g. 30° N)
				const latValue = Math.round((height / 2 - y) * 0.15);
				const label = `${Math.abs(latValue)}° ${latValue >= 0 ? "N" : "S"}`;
				ctx.fillText(label, 15, y - 4);
			}

			// Vertical Longitude lines
			const lngSpacing = 150;
			const startLng = Math.floor(gridOffset * 0.6) % lngSpacing;
			for (let x = startLng; x < width; x += lngSpacing) {
				ctx.beginPath();
				ctx.moveTo(x, 0);
				ctx.lineTo(x, height);
				ctx.stroke();

				// Draw coordinates label (e.g. 120° W)
				const lngValue = Math.round((width / 2 - x) * 0.2);
				const label = `${Math.abs(lngValue)}° ${lngValue >= 0 ? "W" : "E"}`;
				ctx.fillText(label, x + 4, 15);
			}

			// 3. Draw Stars/Particles
			particles.forEach(p => {
				// Move particles
				p.x += p.speedX;
				p.y += p.speedY;

				// Wrap edges
				if (p.x < 0) p.x = width;
				if (p.x > width) p.x = 0;
				if (p.y < 0) p.y = height;
				if (p.y > height) p.y = 0;

				// Pulse opacity
				p.opacity += p.fadeDirection * 0.002;
				if (p.opacity > 0.6) {
					p.opacity = 0.6;
					p.fadeDirection = -1;
				} else if (p.opacity < 0.05) {
					p.opacity = 0.05;
					p.fadeDirection = 1;
				}

				// Draw particle
				ctx.fillStyle = isDark
					? `rgba(255, 255, 255, ${p.opacity})`
					: `rgba(59, 130, 246, ${p.opacity})`;
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
				ctx.fill();
			});

			animationFrameId = requestAnimationFrame(render);
		};

		render();

		return () => {
			window.removeEventListener("resize", resize);
			cancelAnimationFrame(animationFrameId);
		};
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className="fixed inset-0 w-full h-full pointer-events-none z-0 overflow-hidden"
			style={{ mixBlendMode: "normal" }}
		/>
	);
}
