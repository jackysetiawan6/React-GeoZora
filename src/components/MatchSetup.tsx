import React, { useMemo, useState, ReactNode, useEffect } from "react";
import {
	Clock3,
	Gamepad2,
	Map as MapIcon,
	MapPin,
	Zap,
	Settings,
	Crosshair,
	Search,
	Lock,
	Info,
	ChevronRight,
	Loader2,
} from "lucide-react";
import { useTheme } from "../lib/ThemeContext";
import {
	MAPS,
	MAP_CATEGORY_OPTIONS,
	MAX_SELECTED_MAPS,
	loadMapRegions,
	isMapDataLoaded,
	FALLBACK_LOCATIONS,
} from "../lib/MapRegions";
import type { MapCategory, MapRegion } from "../lib/MapRegions";
import { MODE_CONFIGS, type GameModeId } from "../lib/MatchGame";
import { cn } from "../lib/utils";
import { NumericInput, Toggle } from "./ui";

function SetupModeCard({
	active,
	disabled,
	title,
	subtitle,
	icon,
	onClick,
}: {
	active: boolean;
	disabled?: boolean;
	title: string;
	subtitle: string;
	icon: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors cursor-pointer outline-none relative border",
				active ?
					"bg-[var(--color-app-blue)]/10 border-[var(--color-app-blue)]/30"
				:	"text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)] border-transparent",
				disabled && "opacity-45 cursor-not-allowed",
			)}>
			<div className="flex items-center gap-3">
				<div
					className={cn(
						"w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
						active ?
							"bg-[var(--color-app-blue)] text-white"
						:	"bg-[var(--color-app-panel)] border border-[var(--color-app-border)] text-[var(--color-app-text-muted)]",
					)}>
					{icon}
				</div>
				<div className="flex-1 min-w-0">
					<div
						className={cn(
							"font-bold truncate",
							active ?
								"text-[var(--color-app-blue)]"
							:	"text-[var(--color-app-text)]",
						)}>
						{title}
					</div>
					<div className="text-[11px] text-[var(--color-app-text-muted)] truncate">
						{subtitle}
					</div>
				</div>
				{active && (
					<div className="w-2 h-2 rounded-full bg-[var(--color-app-blue)] shadow-[0_0_8px_rgba(59,130,246,0.6)] ml-2" />
				)}
			</div>
		</button>
	);
}

function GameSettingsPanel({
	selectedMode,
	customRounds,
	setCustomRounds,
	customSeconds,
	setCustomSeconds,
	noMoving,
	setNoMoving,
	noPanning,
	setNoPanning,
	noZooming,
	setNoZooming,
	enableTimeMultiplier,
	setEnableTimeMultiplier,
}: {
	selectedMode: GameModeId;
	customRounds: number | "";
	setCustomRounds: (value: number | "") => void;
	customSeconds: number | "";
	setCustomSeconds: (value: number | "") => void;
	noMoving: boolean;
	setNoMoving: (val: boolean) => void;
	noPanning: boolean;
	setNoPanning: (val: boolean) => void;
	noZooming: boolean;
	setNoZooming: (val: boolean) => void;
	enableTimeMultiplier: boolean;
	setEnableTimeMultiplier: (val: boolean) => void;
}) {
	const isCreator = selectedMode === "creatorRoom";
	const rounds = selectedMode === "headToHead" ? 10 : 5;
	const seconds = selectedMode === "headToHead" ? 30 : 60;

	return (
		<div className="flex flex-col gap-4">
			<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
				<Gamepad2 className="w-4 h-4" /> Game Settings
			</h3>
			<div className="grid grid-cols-2 gap-3">
				{isCreator ?
					<>
						<NumericInput
							label="Rounds"
							min={5}
							max={30}
							value={customRounds}
							onChange={setCustomRounds}
						/>
						<NumericInput
							label="Time"
							min={20}
							max={90}
							step={5}
							value={customSeconds}
							onChange={setCustomSeconds}
							suffix="s"
						/>

						<div className="col-span-2 flex flex-col gap-3 mt-1 bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] p-4 rounded-xl">
							<Toggle
								label="No Moving"
								checked={noMoving}
								onChange={setNoMoving}
							/>
							<Toggle
								label="No Panning"
								checked={noPanning}
								onChange={setNoPanning}
							/>
							<Toggle
								label="No Zooming"
								checked={noZooming}
								onChange={setNoZooming}
							/>
							<Toggle
								label="Time Multiplier"
								checked={enableTimeMultiplier}
								onChange={setEnableTimeMultiplier}
							/>
						</div>
					</>
				:	<>
						<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] p-4 rounded-xl">
							<span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] block mb-2">
								Rounds
							</span>
							<span className="text-lg font-mono font-bold text-[var(--color-app-text)]">
								{rounds}
							</span>
						</div>
						<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] p-4 rounded-xl">
							<span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] block mb-2">
								Time
							</span>
							<span className="text-lg font-mono font-bold text-[var(--color-app-text)]">
								{seconds}s
							</span>
						</div>
					</>
				}
			</div>
		</div>
	);
}

export default function MatchSetup({
	selectedMode,
	setSelectedMode,
	selectedMaps,
	setSelectedMaps,
	customRounds,
	setCustomRounds,
	customSeconds,
	setCustomSeconds,
	onStart,
	noMoving,
	setNoMoving,
	noPanning,
	setNoPanning,
	noZooming,
	setNoZooming,
	enableTimeMultiplier,
	setEnableTimeMultiplier,
}: {
	selectedMode: GameModeId;
	setSelectedMode: (mode: GameModeId) => void;
	selectedMaps: MapRegion[];
	setSelectedMaps: (maps: MapRegion[]) => void;
	customRounds: number | "";
	setCustomRounds: (value: number | "") => void;
	customSeconds: number | "";
	setCustomSeconds: (value: number | "") => void;
	onStart: () => void;
	noMoving: boolean;
	setNoMoving: (val: boolean) => void;
	noPanning: boolean;
	setNoPanning: (val: boolean) => void;
	noZooming: boolean;
	setNoZooming: (val: boolean) => void;
	enableTimeMultiplier: boolean;
	setEnableTimeMultiplier: (val: boolean) => void;
}) {
	const { theme } = useTheme();
	const [searchQuery, setSearchQuery] = useState("");
	const [activeCategory, setActiveCategory] = useState<"all" | MapCategory>(
		"all",
	);
	const [isLoadingMaps, setIsLoadingMaps] = useState(!isMapDataLoaded());

	useEffect(() => {
		if (!isMapDataLoaded()) {
			loadMapRegions()
				.catch(console.error)
				.finally(() => setIsLoadingMaps(false));
		}
	}, []);

	const isH2H = selectedMode === "headToHead";
	const currentModeConfig = MODE_CONFIGS[selectedMode];

	const startDisabled = selectedMaps.length === 0 || !currentModeConfig.enabled;

	const startLabel =
		selectedMaps.length === 0 ? "Select Map"
		: startDisabled ? "Coming Soon"
		: selectedMode === "headToHead" ? "Find Opponent"
		: selectedMode === "creatorRoom" ? "Create Room"
		: "Start Match";

	const toggleMapSelection = (mapKey: MapRegion) => {
		const alreadySelected = selectedMaps.includes(mapKey);
		const worldSelected = selectedMaps.includes("world");
		if (alreadySelected) {
			setSelectedMaps(selectedMaps.filter(key => key !== mapKey));
			return;
		}
		if (mapKey === "world") {
			setSelectedMaps(["world"]);
			return;
		}
		if (worldSelected) return;
		if (selectedMaps.length >= MAX_SELECTED_MAPS) return;
		setSelectedMaps([...selectedMaps, mapKey]);
	};

	const filteredMaps = useMemo(() => {
		const normalizedQuery = searchQuery.trim().toLowerCase();
		return (Object.keys(MAPS) as MapRegion[]).filter(mapKey => {
			const map = MAPS[mapKey];
			const matchesCategory =
				activeCategory === "all" || map.categories.includes(activeCategory);
			const matchesSearch =
				!normalizedQuery ||
				map.name.toLowerCase().includes(normalizedQuery) ||
				mapKey.toLowerCase().includes(normalizedQuery);
			return matchesCategory && matchesSearch;
		});
	}, [activeCategory, searchQuery, isLoadingMaps]);

	return (
		<div className="w-full h-full flex flex-col lg:flex-row gap-8 relative z-20 text-[var(--color-app-text)] font-sans">
			{/* Sidebar */}
			<aside className="w-full lg:w-64 flex-shrink-0 lg:sticky lg:top-0 lg:h-full lg:overflow-y-auto no-scrollbar pb-6">
				<div className="flex flex-col gap-8">
					<div>
						<h1 className="text-3xl font-bold tracking-tight mb-2">
							Match Setup
						</h1>
						<p className="text-[var(--color-app-text-muted)] text-sm leading-relaxed">
							Configure your game mode and rules before diving in.
						</p>
					</div>

					<div className="flex flex-col gap-3">
						<h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)] flex items-center gap-2">
							<Settings className="w-4 h-4" /> Game Mode
						</h3>
						<div className="flex flex-col gap-2">
							{Object.values(MODE_CONFIGS)
								.slice()
								.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
								.map(modeConfig =>
								React.createElement(SetupModeCard, {
									key: modeConfig.id,
									active: selectedMode === modeConfig.id,
									disabled: !modeConfig.enabled,
									title: modeConfig.label,
									subtitle: modeConfig.description,
									icon: React.createElement(
										"div",
										{ className: "w-4 h-4 [&>svg]:w-full [&>svg]:h-full" },
										modeConfig.icon,
									),
									onClick: () => setSelectedMode(modeConfig.id),
								} as any),
							)}
						</div>
					</div>

					<GameSettingsPanel
						selectedMode={selectedMode}
						customRounds={customRounds}
						setCustomRounds={setCustomRounds}
						customSeconds={customSeconds}
						setCustomSeconds={setCustomSeconds}
						noMoving={noMoving}
						setNoMoving={setNoMoving}
						noPanning={noPanning}
						setNoPanning={setNoPanning}
						noZooming={noZooming}
						setNoZooming={setNoZooming}
						enableTimeMultiplier={enableTimeMultiplier}
						setEnableTimeMultiplier={setEnableTimeMultiplier}
					/>
				</div>
			</aside>

			{/* Main */}
			<main className="flex-1 min-w-0 h-full overflow-y-auto no-scrollbar pb-12">
				<section className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-2xl shadow-xl overflow-hidden p-6 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 border-b border-[var(--color-app-border-light)] pb-4">
						<div>
							<div className="flex items-center gap-2 text-[var(--color-app-text)] font-bold text-xl">
								<MapIcon className="w-6 h-6 text-[var(--color-app-blue)]" />{" "}
								Select Map Region
							</div>
							<p className="text-xs text-[var(--color-app-text-muted)] mt-1">
								{isH2H ?
									"Head-to-head is locked to World map for competitive balance."
								:	`Choose World, or up to ${MAX_SELECTED_MAPS} specific countries.`
								}
							</p>
						</div>
						<button
							onClick={onStart}
							disabled={startDisabled}
							className={cn(
								"px-7 py-3 rounded-xl font-bold transition-all shadow-lg text-sm uppercase tracking-wider shrink-0",
								startDisabled ?
									"bg-[var(--color-app-hover)] cursor-not-allowed border border-[var(--color-app-border-light)] text-[var(--color-app-text-muted)] shadow-none"
								:	"bg-[var(--color-app-blue)] hover:bg-blue-500 hover:shadow-[0_0_20px_rgba(59,130,246,0.4)] text-white border border-transparent",
							)}>
							{startLabel}
						</button>
					</div>

					<div className="flex flex-col xl:flex-row xl:items-center gap-4 mb-4">
						<div className="relative flex-1">
							<Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-app-text-muted)]" />
							<input
								value={searchQuery}
								onChange={e => setSearchQuery(e.target.value)}
								placeholder="Search country..."
								className="w-full h-11 rounded-xl bg-[var(--color-app-bg)]/60 border border-[var(--color-app-border-light)] pl-11 pr-4 text-sm text-[var(--color-app-text)] placeholder:text-[var(--color-app-text-muted)] outline-none focus:border-[var(--color-app-blue)] transition-colors"
							/>
						</div>
						<div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 xl:pb-0">
							{MAP_CATEGORY_OPTIONS.map(category => {
								const active = activeCategory === category.id;
								return (
									<button
										key={category.id}
										onClick={() => setActiveCategory(category.id)}
										className={cn(
											"px-4 h-10 rounded-xl text-xs font-black uppercase tracking-wider border transition-all whitespace-nowrap",
											active ?
												"bg-[var(--color-app-blue)] text-white border-[var(--color-app-blue)] shadow-[0_0_16px_rgba(59,130,246,0.22)]"
											:	"bg-[var(--color-app-bg)]/50 text-[var(--color-app-text-muted)] border-[var(--color-app-border-light)] hover:text-[var(--color-app-text)] hover:border-gray-500",
										)}>
										{category.label}
									</button>
								);
							})}
						</div>
					</div>

					<div className="flex items-center justify-between gap-3 mb-4">
						<p className="text-xs text-[var(--color-app-text-muted)]">
							{selectedMaps.includes("world") ?
								"World selected"
							:	`Selected ${selectedMaps.length}/${MAX_SELECTED_MAPS}`}
						</p>
						{selectedMaps.length > 0 && (
							<button
								onClick={() => setSelectedMaps([])}
								className="text-xs font-bold text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors">
								Clear selection
							</button>
						)}
					</div>

					{isLoadingMaps ?
						<div className="min-h-[300px] flex flex-col items-center justify-center gap-3">
							<Loader2 className="w-10 h-10 text-[var(--color-app-blue)] animate-spin" />
							<p className="text-[var(--color-app-text-muted)] animate-pulse">
								Loading map catalogue...
							</p>
						</div>
					: filteredMaps.length > 0 ?
						<div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
							{filteredMaps.map(mapKey => {
								const active = selectedMaps.includes(mapKey);
								const map = MAPS[mapKey];
								const worldSelected = selectedMaps.includes("world");
								const selectionDisabled =
									!active &&
									(selectedMaps.length >= MAX_SELECTED_MAPS ||
										(worldSelected && mapKey !== "world"));

								const isLight = theme === "light";
								const isDisabled = selectionDisabled || (isH2H && mapKey !== "world");

								const overlayClass = isLight
									? active
										? "bg-white/20"
										: isDisabled
											? "bg-white/50"
											: "bg-white/40 group-hover:bg-white/25"
									: active
										? "bg-slate-950/52"
										: "bg-slate-950/74 group-hover:bg-slate-950/62";

								const flagColor = isLight
									? active
										? "text-blue-500"
										: isDisabled
											? "text-slate-400/50"
											: "text-slate-600/40"
									: active
										? "text-blue-300"
										: isDisabled
											? "text-slate-600/30"
											: "text-white/40";

								const nameColor = isLight
									? active
										? "text-blue-600 font-bold"
										: isDisabled
											? "text-slate-700 font-bold"
											: "text-slate-800 font-semibold"
									: active
										? "text-blue-300 font-bold"
										: isDisabled
											? "text-slate-500 font-bold"
											: "text-white font-bold";

								const locationsColor = isLight
									? active
										? "text-blue-500 font-bold"
										: isDisabled
											? "text-slate-500 font-medium"
											: "text-slate-600 font-medium"
									: active
										? "text-blue-200/80 font-medium"
										: isDisabled
											? "text-slate-600/70 font-medium"
											: "text-slate-300 font-medium";

								return (
									<button
										key={mapKey}
										onClick={() => toggleMapSelection(mapKey)}
										disabled={
											selectionDisabled || (isH2H && mapKey !== "world")
										}
										className={cn(
											"relative min-h-[132px] overflow-hidden flex flex-col items-center justify-center p-5 rounded-xl border-2 transition-all group outline-none",
											active ?
												"border-[var(--color-app-blue)] shadow-[0_0_18px_rgba(59,130,246,0.22)]"
											:	"border-[var(--color-app-border-light)] hover:border-gray-500",
											(selectionDisabled || (isH2H && mapKey !== "world")) &&
												"opacity-45 cursor-not-allowed hover:border-[var(--color-app-border-light)]",
										)}>
										<div
											className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-110"
											style={{
												backgroundImage:
													map.flagImage ?
														`url(${map.flagImage})`
													:	map.background,
											}}
										/>
										<div
											className={cn(
												"absolute inset-0 transition-colors",
												overlayClass
											)}
										/>
										{active && (
											<div className="absolute inset-0 bg-[var(--color-app-blue)]/10" />
										)}
										<div className="relative z-10 flex flex-col items-center justify-center text-center">
											<div className={cn(
												"text-4xl mb-3 drop-shadow-lg transform transition-transform group-hover:scale-110 transition-colors",
												flagColor
											)}>
												{map.flag}
											</div>
											<div
												className={cn(
													"font-bold text-sm leading-tight drop-shadow-md transition-colors",
													nameColor,
												)}>
												{map.name}
											</div>
											{FALLBACK_LOCATIONS[mapKey] && (
												<div className={cn(
													"mt-1 text-[10px] tracking-wide uppercase transition-colors",
													locationsColor
												)}>
													{FALLBACK_LOCATIONS[mapKey].length} locations
												</div>
											)}
										</div>
										{isH2H && mapKey !== "world" && (
											<div className="absolute inset-0 bg-black/40 flex items-center justify-center z-30">
												<Lock className="w-6 h-6 text-[var(--color-app-text-muted)]" />
											</div>
										)}
										{active && (
											<div className="absolute top-2 right-2 z-20 bg-[var(--color-app-blue)] text-white rounded-full min-w-6 h-6 px-1 flex items-center justify-center shadow-md">
												<span className="text-[11px] font-black">
													{selectedMaps.indexOf(mapKey) + 1}
												</span>
											</div>
										)}
									</button>
								);
							})}
						</div>
					:	<div className="min-h-[220px] rounded-2xl border border-dashed border-[var(--color-app-border-light)] bg-[var(--color-app-bg)]/40 flex flex-col items-center justify-center text-center px-6">
							<MapIcon className="w-9 h-9 text-[var(--color-app-text-muted)] mb-3" />
							<div className="text-[var(--color-app-text)] font-bold">
								No map found
							</div>
							<p className="text-sm text-[var(--color-app-text-muted)] mt-1">
								Try another keyword or switch to a different category.
							</p>
						</div>
					}

					<div className="mt-6 border-t border-[var(--color-app-border-light)] pt-5">
						<div className="text-xs text-[var(--color-app-text-muted)] flex items-center gap-2">
							<Clock3 className="w-4 h-4" />
							{selectedMode === "headToHead" ?
								'Clicking "Find Opponent" will search for a player near your ELO rating.'
							:	"Starting match takes a moment to locate valid panoramas."}
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}
