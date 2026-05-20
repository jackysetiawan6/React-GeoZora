import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import {
	Plus,
	Trash2,
	Edit2,
	Save,
	X,
	Map as MapIcon,
	Globe,
	Search,
	CheckCircle2,
	AlertCircle,
	Shield,
	MessageSquareWarning,
	ExternalLink,
	Gamepad2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/AuthContext";
import { NumericInput, Toggle, Dropdown } from "./ui";
import { toast } from "sonner";

interface Region {
	id: string;
	name: string;
	flag: string;
	flag_image?: string | null;
	background?: string | null;
	categories: string[];
	is_enabled: boolean;
	min_lat: number;
	max_lat: number;
	min_lng: number;
	max_lng: number;
	camera_zoom?: number | null;
	camera_min_zoom?: number | null;
	camera_max_zoom?: number | null;
}

interface Fallback {
	id: string;
	region_id: string;
	lat: number;
	lng: number;
	is_enabled?: boolean;
}

interface Feedback {
	id: string;
	user_id: string;
	player_name?: string | null;
	type: string;
	message: string;
	details: any;
	status: string;
	created_at: string;
	profiles?: { display_name: string; email: string };
}

interface AdminGameMode {
	id: string;
	label: string;
	description: string;
	rounds: number;
	seconds: number;
	multiplayer: boolean;
	enabled: boolean;
	bg_img: string;
	icon: string;
	sort_order: number;
}

export default function AdminPanel() {
	const { user } = useAuth();
	const [activeView, setActiveView] = useState<
		"regions" | "fallbacks" | "feedbacks" | "modes"
	>("regions");
	const [regions, setRegions] = useState<Region[]>([]);
	const [fallbacks, setFallbacks] = useState<Fallback[]>([]);
	const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
	const [modes, setModes] = useState<AdminGameMode[]>([]);
	const [loading, setLoading] = useState(true);
	const [search, setSearch] = useState("");
	const [fallbackSearch, setFallbackSearch] = useState("");
	const [feedbackSearch, setFeedbackSearch] = useState("");
	const [modeSearch, setModeSearch] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	const [editRegion, setEditRegion] = useState<Partial<Region> | null>(null);
	const [editFallback, setEditFallback] = useState<Partial<Fallback> | null>(
		null,
	);
	const [editMode, setEditMode] = useState<Partial<AdminGameMode> | null>(null);
	const [message, setMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	useEffect(() => {
		if (!user?.isAdmin) return;
		loadData();
	}, [user]);

	// Auto-dismiss messages after 4 seconds
	useEffect(() => {
		if (!message) return;
		const t = setTimeout(() => setMessage(null), 4000);
		return () => clearTimeout(t);
	}, [message]);

	const loadData = async () => {
		setLoading(true);
		const [rRes, fRes, fbRes, pRes, mRes] = await Promise.all([
			supabase.from("map_regions").select("*").order("name"),
			supabase.from("map_fallback_locations").select("*").order("region_id"),
			supabase
				.from("feedbacks")
				.select("*")
				.order("created_at", { ascending: false }),
			supabase.from("profiles").select("id, display_name, email"),
			supabase.from("game_modes").select("*").order("sort_order"),
		]);
		if (rRes.data) setRegions(rRes.data);
		if (fRes.data) setFallbacks(fRes.data);
		if (mRes.data) setModes(mRes.data);
		if (fbRes.data) {
			const profilesById = new Map(
				(pRes.data || []).map(profile => [profile.id, profile]),
			);

			setFeedbacks(
				fbRes.data.map(feedback => ({
					...feedback,
					profiles: profilesById.get(feedback.user_id) || undefined,
				})) as Feedback[],
			);
		}
		setLoading(false);
	};

	const handleSaveRegion = async () => {
		if (!editRegion || !editRegion.id?.trim()) {
			setMessage({ type: "error", text: "Region ID is required." });
			return;
		}
		setIsSaving(true);
		try {
			const isNew = !regions.find(r => r.id === editRegion.id);
			const { error } =
				isNew ?
					await supabase.from("map_regions").insert(editRegion as Region)
				:	await supabase
						.from("map_regions")
						.update(editRegion as Region)
						.eq("id", editRegion.id);
			if (error) throw error;
			setMessage({
				type: "success",
				text: isNew ? "Region created!" : "Region updated!",
			});
			setEditRegion(null);
			loadData();
		} catch (err: any) {
			setMessage({
				type: "error",
				text: err?.message || "Failed to save region",
			});
		} finally {
			setIsSaving(false);
		}
	};

	const handleSaveFallback = async () => {
		if (!editFallback || !editFallback.region_id) return;
		setIsSaving(true);
		try {
			if (editFallback.id) {
				const { error } = await supabase
					.from("map_fallback_locations")
					.update(editFallback)
					.eq("id", editFallback.id);
				if (error) throw error;
			} else {
				const { error } = await supabase
					.from("map_fallback_locations")
					.insert(editFallback);
				if (error) throw error;
			}
			setMessage({ type: "success", text: "Fallback saved!" });
			setEditFallback(null);
			loadData();
		} catch (err) {
			setMessage({ type: "error", text: "Failed to save fallback" });
		} finally {
			setIsSaving(false);
		}
	};

	const handleSaveMode = async () => {
		if (!editMode || !editMode.id?.trim()) {
			setMessage({ type: "error", text: "Mode ID is required." });
			return;
		}
		setIsSaving(true);
		try {
			const isNew = !modes.find(m => m.id === editMode.id);
			const { error } =
				isNew ?
					await supabase.from("game_modes").insert(editMode as AdminGameMode)
				:	await supabase
						.from("game_modes")
						.update(editMode as AdminGameMode)
						.eq("id", editMode.id);
			if (error) throw error;
			setMessage({
				type: "success",
				text: isNew ? "Mode created!" : "Mode updated!",
			});
			setEditMode(null);
			loadData();
		} catch (err: any) {
			setMessage({
				type: "error",
				text: err?.message || "Failed to save mode",
			});
		} finally {
			setIsSaving(false);
		}
	};

	const handleDeleteMode = async (id: string) => {
		if (!confirm("Are you sure you want to delete this game mode?")) return;
		await supabase.from("game_modes").delete().eq("id", id);
		loadData();
	};

	const handleDeleteRegion = async (id: string) => {
		if (!confirm("Are you sure? This will delete all associated fallbacks."))
			return;
		await supabase.from("map_regions").delete().eq("id", id);
		loadData();
	};

	const handleDeleteFallback = async (id: string) => {
		if (!confirm("Are you sure?")) return;
		await supabase.from("map_fallback_locations").delete().eq("id", id);
		loadData();
	};

	const handleClearFeedbacks = async () => {
		if (
			!confirm("Clear ALL player feedback and reports? This cannot be undone.")
		)
			return;
		try {
			const { error } = await supabase
				.from("feedbacks")
				.delete()
				.not("id", "is", null);
			if (error) throw error;
			setMessage({ type: "success", text: "All feedback cleared!" });
			loadData();
		} catch (err) {
			setMessage({ type: "error", text: "Failed to clear feedback" });
		}
	};

	const handleDeleteFeedback = async (id: string) => {
		if (!confirm("Delete this feedback entry?")) return;
		try {
			const { error } = await supabase.from("feedbacks").delete().eq("id", id);
			if (error) throw error;
			setMessage({ type: "success", text: "Feedback deleted." });
			loadData();
		} catch (err) {
			setMessage({ type: "error", text: "Failed to delete feedback" });
		}
	};

	const handleUpdateFeedbackStatus = async (id: string, status: string) => {
		try {
			const { error } = await supabase
				.from("feedbacks")
				.update({ status })
				.eq("id", id);
			if (error) throw error;
			setMessage({ type: "success", text: "Feedback updated!" });
			loadData();
		} catch (err) {
			setMessage({ type: "error", text: "Failed to update feedback" });
		}
	};

	const openStreetView = (lat: number, lng: number) => {
		// Use the stable /@lat,lng,3a Street View URL format
		const url = `https://www.google.com/maps/@${lat},${lng},3a,75y,0h,90t/data=!3m1!1e1`;
		window.open(url, "_blank", "noopener,noreferrer");
		toast.success("Opening Street View in new tab", {
			description: `Latitude: ${lat}, Longitude: ${lng}`,
		});
	};

	if (!user?.isAdmin) {
		return (
			<div className="h-[60vh] flex flex-col items-center justify-center text-center p-8">
				<Shield className="w-16 h-16 text-red-500/20 mb-4" />
				<h1 className="text-2xl font-black text-[var(--color-app-text)] mb-2">
					Access Denied
				</h1>
				<p className="text-[var(--color-app-text-muted)] max-w-md">
					You do not have administrative privileges to access this area. If you
					believe this is an error, please contact the system owner.
				</p>
			</div>
		);
	}

	const filteredRegions = regions.filter(
		r =>
			r.name.toLowerCase().includes(search.toLowerCase()) ||
			r.id.toLowerCase().includes(search.toLowerCase()),
	);

	const filteredFallbacks = fallbacks.filter(f => {
		const region = regions.find(r => r.id === f.region_id);
		const q = fallbackSearch.toLowerCase();
		return (
			f.region_id.toLowerCase().includes(q) ||
			(region?.name || "").toLowerCase().includes(q) ||
			String(f.lat).includes(q) ||
			String(f.lng).includes(q)
		);
	});

	const filteredFeedbacks = feedbacks.filter(f => {
		const q = feedbackSearch.toLowerCase();
		return (
			(f.player_name || "").toLowerCase().includes(q) ||
			(f.profiles?.display_name || "").toLowerCase().includes(q) ||
			f.message.toLowerCase().includes(q) ||
			f.type.toLowerCase().includes(q) ||
			f.status.toLowerCase().includes(q)
		);
	});

	const filteredModes = modes.filter(m => {
		const q = modeSearch.toLowerCase();
		return (
			m.label.toLowerCase().includes(q) ||
			m.id.toLowerCase().includes(q) ||
			m.description.toLowerCase().includes(q)
		);
	});

	return (
		<>
			<div className="w-full h-full min-h-0 flex flex-col xl:flex-row gap-8 text-[var(--color-app-text)] font-sans">
				{/* Sidebar Navigation */}
				<aside className="w-full xl:w-80 flex flex-col gap-6 flex-shrink-0 min-h-0 xl:overflow-y-auto no-scrollbar pb-6 rounded-2xl">
					<div>
						<h1 className="text-3xl font-bold tracking-tight mb-2">
							Admin Console
						</h1>
						<p className="text-[var(--color-app-text-muted)] text-sm leading-relaxed">
							System configuration and data management.
						</p>
					</div>

					<div className="flex flex-col gap-2">
						<button
							onClick={() => setActiveView("regions")}
							className={cn(
								"w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors border",
								activeView === "regions" ?
									"bg-[var(--color-app-blue)]/10 text-[var(--color-app-blue)] font-bold border-[var(--color-app-blue)]/20 shadow-inner"
								:	"text-[var(--color-app-text-muted)] hover:text-white hover:bg-[var(--color-app-hover)] border-transparent",
							)}>
							<div className="flex items-center gap-2">
								<Globe className="w-4 h-4" /> Map Regions
							</div>
						</button>
						<button
							onClick={() => setActiveView("fallbacks")}
							className={cn(
								"w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors border",
								activeView === "fallbacks" ?
									"bg-[var(--color-app-blue)]/10 text-[var(--color-app-blue)] font-bold border-[var(--color-app-blue)]/20 shadow-inner"
								:	"text-[var(--color-app-text-muted)] hover:text-white hover:bg-[var(--color-app-hover)] border-transparent",
							)}>
							<div className="flex items-center gap-2">
								<MapIcon className="w-4 h-4" /> Fallbacks
							</div>
						</button>
						<button
							onClick={() => setActiveView("feedbacks")}
							className={cn(
								"w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors border",
								activeView === "feedbacks" ?
									"bg-[var(--color-app-blue)]/10 text-[var(--color-app-blue)] font-bold border-[var(--color-app-blue)]/20 shadow-inner"
								:	"text-[var(--color-app-text-muted)] hover:text-white hover:bg-[var(--color-app-hover)] border-transparent",
							)}>
							<div className="flex items-center gap-2">
								<MessageSquareWarning className="w-4 h-4" /> Player Feedbacks
							</div>
						</button>
						<button
							onClick={() => setActiveView("modes")}
							className={cn(
								"w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors border",
								activeView === "modes" ?
									"bg-[var(--color-app-blue)]/10 text-[var(--color-app-blue)] font-bold border-[var(--color-app-blue)]/20 shadow-inner"
								:	"text-[var(--color-app-text-muted)] hover:text-white hover:bg-[var(--color-app-hover)] border-transparent",
							)}>
							<div className="flex items-center gap-2">
								<Gamepad2 className="w-4 h-4" /> Game Modes
							</div>
						</button>
					</div>
				</aside>

				<main className="flex-1 flex flex-col min-w-0 h-full min-h-0 overflow-hidden relative">
					{message && (
						<div
							className={cn(
								"mb-4 p-3 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300",
								message.type === "success" ?
									"bg-green-500/10 text-green-500 border border-green-500/20"
								:	"bg-red-500/10 text-red-500 border border-red-500/20",
							)}>
							{message.type === "success" ?
								<CheckCircle2 className="w-5 h-5 flex-shrink-0" />
							:	<AlertCircle className="w-5 h-5 flex-shrink-0" />}
							<p className="text-sm font-medium">{message.text}</p>
						</div>
					)}

					<div className="flex-1 min-h-0 flex flex-col overflow-hidden pb-12 pr-2">
						{activeView === "regions" && (
							<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-2xl shadow-xl overflow-hidden flex flex-col flex-1 min-h-0">
								<div className="p-4 border-b border-[var(--color-app-border-light)] flex flex-col md:flex-row items-center justify-between gap-4">
									<div className="relative w-full md:w-80">
										<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-app-text-muted)]" />
										<input
											type="text"
											placeholder="Search regions..."
											value={search}
											onChange={e => setSearch(e.target.value)}
											className="w-full bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/50"
										/>
									</div>
									<button
										onClick={() =>
											setEditRegion({
												id: "",
												name: "",
												flag: "🌍",
												categories: [],
												is_enabled: true,
												min_lat: -90,
												max_lat: 90,
												min_lng: -180,
												max_lng: 180,
											})
										}
										className="w-full md:w-auto bg-[var(--color-app-blue)] hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 shadow shadow-blue-500/20 transition-all text-sm">
										<Plus className="w-4 h-4" /> Add Region
									</button>
								</div>

								<div className="flex-1 min-h-0 overflow-auto">
									<table className="w-full min-w-[1200px] text-left">
										<thead>
											<tr className="bg-[var(--color-app-bg)]/50 text-[var(--color-app-text-muted)] text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
												<th className="px-4 py-2">ID</th>
												<th className="px-4 py-2">Region</th>
												<th className="px-4 py-2">Flag Image</th>
												<th className="px-4 py-2">Background</th>
												<th className="px-4 py-2">Categories</th>
												<th className="px-4 py-2">Camera</th>
												<th className="px-4 py-2">Status</th>
												<th className="px-4 py-2 text-right">Actions</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[var(--color-app-border-light)]">
											{loading ?
												<tr>
													<td
														colSpan={8}
														className="p-6 text-center text-[var(--color-app-text-muted)] italic text-sm">
														Loading regions...
													</td>
												</tr>
											: filteredRegions.length === 0 ?
												<tr>
													<td
														colSpan={8}
														className="p-6 text-center text-[var(--color-app-text-muted)] italic text-sm">
														No regions found
													</td>
												</tr>
											:	filteredRegions.map(region => (
													<tr
														key={region.id}
														className="hover:bg-[var(--color-app-hover)]/40 transition-colors group">
														<td className="px-4 py-2.5 text-xs font-mono text-[var(--color-app-text-muted)]">
															{region.id}
														</td>
														<td className="px-4 py-2.5">
															<div className="flex items-center gap-2">
																<span className="text-base">{region.flag}</span>
																<span className="font-bold text-sm text-[var(--color-app-text)]">
																	{region.name}
																</span>
															</div>
														</td>
														<td className="px-4 py-2.5 text-xs text-[var(--color-app-text-muted)]">
															{region.flag_image ?
																<a
																	className="underline decoration-dotted underline-offset-4 hover:text-[var(--color-app-text)]"
																	href={region.flag_image}
																	target="_blank"
																	rel="noreferrer">
																	Preview
																</a>
															:	"—"}
														</td>
														<td
															className="px-4 py-2.5 text-xs text-[var(--color-app-text-muted)] max-w-[260px] truncate"
															title={region.background || undefined}>
															{region.background || "—"}
														</td>
														<td className="px-4 py-2.5 text-xs text-[var(--color-app-text-muted)]">
															{(region.categories || []).join(", ") || "—"}
														</td>
														<td className="px-4 py-2.5 text-xs text-[var(--color-app-text-muted)] whitespace-nowrap">
															{region.camera_zoom ?? "def"} /{" "}
															{region.camera_min_zoom ?? "def"} /{" "}
															{region.camera_max_zoom ?? "def"}
														</td>
														<td className="px-4 py-2.5">
															<span
																className={cn(
																	"px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider",
																	region.is_enabled ?
																		"bg-green-500/10 text-green-500"
																	:	"bg-red-500/10 text-red-500",
																)}>
																{region.is_enabled ? "Active" : "Disabled"}
															</span>
														</td>
														<td className="px-4 py-2.5 text-right">
															<div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
																<button
																	onClick={() => setEditRegion(region)}
																	className="p-1.5 text-[var(--color-app-text-muted)] hover:text-[var(--color-app-blue)] transition-colors">
																	<Edit2 className="w-3.5 h-3.5" />
																</button>
																<button
																	onClick={() => handleDeleteRegion(region.id)}
																	className="p-1.5 text-[var(--color-app-text-muted)] hover:text-red-500 transition-colors">
																	<Trash2 className="w-3.5 h-3.5" />
																</button>
															</div>
														</td>
													</tr>
												))
											}
										</tbody>
									</table>
								</div>
							</div>
						)}

						{activeView === "fallbacks" && (
							<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-2xl shadow-xl overflow-hidden flex flex-col flex-1 min-h-0">
								<div className="p-4 border-b border-[var(--color-app-border-light)] flex flex-col md:flex-row items-center justify-between gap-4">
									<div className="relative w-full md:w-80">
										<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-app-text-muted)]" />
										<input
											type="text"
											placeholder="Search locations..."
											value={fallbackSearch}
											onChange={e => setFallbackSearch(e.target.value)}
											className="w-full bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/50"
										/>
									</div>
									<button
										onClick={() =>
											setEditFallback({
												region_id: regions[0]?.id || "",
												lat: 0,
												lng: 0,
												is_enabled: true,
											})
										}
										className="w-full md:w-auto bg-[var(--color-app-blue)] hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 shadow shadow-blue-500/20 transition-all text-sm">
										<Plus className="w-4 h-4" /> Add Fallback
									</button>
								</div>

								<div className="flex-1 min-h-0 overflow-auto">
									<table className="w-full min-w-[1200px] text-left">
										<thead>
											<tr className="bg-[var(--color-app-bg)]/50 text-[var(--color-app-text-muted)] text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
												<th className="px-4 py-2">Region</th>
												<th className="px-4 py-2">Latitude</th>
												<th className="px-4 py-2">Longitude</th>
												<th className="px-4 py-2">Status</th>
												<th className="px-4 py-2">Preview</th>
												<th className="px-4 py-2 text-right">Actions</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[var(--color-app-border-light)]">
											{loading ?
												<tr>
													<td
														colSpan={6}
														className="p-6 text-center text-[var(--color-app-text-muted)] italic text-sm">
														Loading fallbacks...
													</td>
												</tr>
											: filteredFallbacks.length === 0 ?
												<tr>
													<td
														colSpan={6}
														className="p-6 text-center text-[var(--color-app-text-muted)] italic text-sm">
														{fallbackSearch ?
															"No locations match your search"
														:	"No fallbacks defined"}
													</td>
												</tr>
											:	filteredFallbacks.map(f => {
													const region = regions.find(
														r => r.id === f.region_id,
													);
													return (
														<tr
															key={f.id}
															className="hover:bg-[var(--color-app-hover)]/40 transition-colors group">
															<td className="px-4 py-2.5">
																<div className="flex items-center gap-2">
																	<span className="text-base">
																		{region?.flag || "🌍"}
																	</span>
																	<span className="font-bold text-sm text-[var(--color-app-text)]">
																		{region?.name || f.region_id}
																	</span>
																</div>
															</td>
															<td className="px-4 py-2.5 text-xs font-mono">
																{f.lat.toFixed(6)}
															</td>
															<td className="px-4 py-2.5 text-xs font-mono">
																{f.lng.toFixed(6)}
															</td>
															<td className="px-4 py-2.5">
																<span
																	className={cn(
																		"px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider",
																		f.is_enabled === false ?
																			"bg-red-500/10 text-red-500"
																		:	"bg-green-500/10 text-green-500",
																	)}>
																	{f.is_enabled === false ?
																		"Disabled"
																	:	"Active"}
																</span>
															</td>
															<td className="px-4 py-2.5">
																<a
																	href={`https://www.google.com/maps/@${f.lat},${f.lng},3a,75y,0h,90t/data=!3m1!1e1`}
																	target="_blank"
																	rel="noopener noreferrer"
																	onClick={() => {
																		toast.success(
																			"Opening Street View in new tab",
																			{
																				description: `Latitude: ${f.lat.toFixed(4)}, Longitude: ${f.lng.toFixed(4)}`,
																			},
																		);
																	}}
																	className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[var(--color-app-blue)]/10 text-[var(--color-app-blue)] hover:bg-[var(--color-app-blue)]/20 transition-colors whitespace-nowrap">
																	<ExternalLink className="w-3 h-3" /> View on
																	Map
																</a>
															</td>
															<td className="px-4 py-2.5 text-right">
																<div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
																	<button
																		onClick={() => setEditFallback(f)}
																		className="p-1.5 text-[var(--color-app-text-muted)] hover:text-[var(--color-app-blue)] transition-colors">
																		<Edit2 className="w-3.5 h-3.5" />
																	</button>
																	<button
																		onClick={() => handleDeleteFallback(f.id)}
																		className="p-1.5 text-[var(--color-app-text-muted)] hover:text-red-500 transition-colors">
																		<Trash2 className="w-3.5 h-3.5" />
																	</button>
																</div>
															</td>
														</tr>
													);
												})
											}
										</tbody>
									</table>
								</div>
							</div>
						)}

						{activeView === "feedbacks" && (
							<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-2xl shadow-xl overflow-hidden flex flex-col flex-1 min-h-0">
								<div className="p-4 border-b border-[var(--color-app-border-light)] flex flex-col md:flex-row items-center justify-between gap-4">
									<div className="relative w-full md:w-80">
										<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-app-text-muted)]" />
										<input
											type="text"
											placeholder="Search feedbacks..."
											value={feedbackSearch}
											onChange={e => setFeedbackSearch(e.target.value)}
											className="w-full bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/50"
										/>
									</div>
									<button
										onClick={handleClearFeedbacks}
										className="w-full md:w-auto bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 shadow shadow-red-500/20 transition-all text-sm">
										<Trash2 className="w-4 h-4" /> Clear All
									</button>
								</div>
								<div className="flex-1 min-h-0 overflow-auto">
									<table className="w-full min-w-[1200px] text-left">
										<thead>
											<tr className="bg-[var(--color-app-bg)]/50 text-[var(--color-app-text-muted)] text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
												<th className="px-4 py-2">User</th>
												<th className="px-4 py-2">Type</th>
												<th className="px-4 py-2">Message</th>
												<th className="px-4 py-2">Status</th>
												<th className="px-4 py-2">Date</th>
												<th className="px-4 py-2 text-right">Actions</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[var(--color-app-border-light)]">
											{loading ?
												<tr>
													<td
														colSpan={6}
														className="p-6 text-center text-[var(--color-app-text-muted)] italic text-sm">
														Loading feedbacks...
													</td>
												</tr>
											: filteredFeedbacks.length === 0 ?
												<tr>
													<td
														colSpan={6}
														className="p-6 text-center text-[var(--color-app-text-muted)] italic text-sm">
														{feedbackSearch ?
															"No feedbacks match your search"
														:	"No feedbacks yet"}
													</td>
												</tr>
											:	filteredFeedbacks.map(f => (
													<tr
														key={f.id}
														className="hover:bg-[var(--color-app-hover)]/40 transition-colors group">
														<td className="px-4 py-2.5">
															<div className="font-bold text-sm text-[var(--color-app-text)]">
																{f.profiles?.display_name ||
																	f.player_name ||
																	"Unknown"}
															</div>
															<div className="text-[10px] text-[var(--color-app-text-muted)]">
																{f.profiles?.email || "No email"}
															</div>
														</td>
														<td className="px-4 py-2.5">
															<span
																className={cn(
																	"px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider",
																	f.type === "report" ?
																		"bg-red-500/10 text-red-500"
																	:	"bg-[var(--color-app-blue)]/10 text-[var(--color-app-blue)]",
																)}>
																{f.type}
															</span>
														</td>
														<td
															className="px-4 py-2.5 max-w-[200px] truncate text-sm"
															title={f.message}>
															{f.message}
															{f.details && (
																<div className="text-[9px] text-[var(--color-app-text-muted)] font-mono mt-0.5 truncate border border-[var(--color-app-border)] p-1 rounded">
																	{JSON.stringify(f.details)}
																</div>
															)}
														</td>
														<td className="px-4 py-2.5">
															<span
																className={cn(
																	"px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider",
																	f.status === "open" ?
																		"bg-amber-500/10 text-amber-500"
																	: f.status === "done" ?
																		"bg-green-500/10 text-green-500"
																	:	"bg-gray-500/10 text-gray-400",
																)}>
																{f.status}
															</span>
														</td>
														<td className="px-4 py-2.5 text-xs text-[var(--color-app-text-muted)] whitespace-nowrap border-gray">
															{new Date(f.created_at).toLocaleDateString()}
														</td>
														<td className="px-4 py-2.5 text-right">
															<div className="flex flex-col md:flex-row items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
																{f.status !== "done" && (
																	<button
																		onClick={() =>
																			handleUpdateFeedbackStatus(f.id, "done")
																		}
																		className="px-3 py-1.5 text-[10px] bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded font-bold transition-colors">
																		Done
																	</button>
																)}
																{f.status === "open" && (
																	<button
																		onClick={() =>
																			handleUpdateFeedbackStatus(
																				f.id,
																				"acknowledged",
																			)
																		}
																		className="px-3 py-1.5 text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 rounded font-bold transition-colors">
																		Ack
																	</button>
																)}
																<button
																	onClick={() => handleDeleteFeedback(f.id)}
																	className="p-1.5 text-[var(--color-app-text-muted)] hover:text-red-500 transition-colors">
																	<Trash2 className="w-3.5 h-3.5" />
																</button>
															</div>
														</td>
													</tr>
												))
											}
										</tbody>
									</table>
								</div>
							</div>
						)}
						{activeView === "modes" && (
							<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] rounded-2xl shadow-xl overflow-hidden flex flex-col flex-1 min-h-0">
								<div className="p-4 border-b border-[var(--color-app-border-light)] flex flex-col md:flex-row items-center justify-between gap-4">
									<div className="relative w-full md:w-80">
										<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-app-text-muted)]" />
										<input
											type="text"
											placeholder="Search game modes..."
											value={modeSearch}
											onChange={e => setModeSearch(e.target.value)}
											className="w-full bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/50"
										/>
									</div>
									<button
										onClick={() =>
											setEditMode({
												id: "",
												label: "",
												description: "",
												rounds: 5,
												seconds: 60,
												multiplayer: false,
												enabled: true,
												bg_img: "",
												icon: "Gamepad2",
												sort_order: 0,
											})
										}
										className="w-full md:w-auto bg-[var(--color-app-blue)] hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 shadow shadow-blue-500/20 transition-all text-sm">
										<Plus className="w-4 h-4" /> Add Mode
									</button>
								</div>

								<div className="flex-1 min-h-0 overflow-auto">
									<table className="w-full min-w-[800px] text-left">
										<thead>
											<tr className="bg-[var(--color-app-bg)]/50 text-[var(--color-app-text-muted)] text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
												<th className="px-4 py-2">ID</th>
												<th className="px-4 py-2">Label</th>
												<th className="px-4 py-2">Icon</th>
												<th className="px-4 py-2">Rounds / Secs</th>
												<th className="px-4 py-2">Multiplayer</th>
												<th className="px-4 py-2">Status</th>
												<th className="px-4 py-2 text-right">Actions</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[var(--color-app-border-light)]">
											{loading ?
												<tr>
													<td colSpan={7} className="p-6 text-center text-sm">
														Loading...
													</td>
												</tr>
											: filteredModes.length === 0 ?
												<tr>
													<td colSpan={7} className="p-6 text-center text-sm">
														No modes found
													</td>
												</tr>
											:	filteredModes.map(mode => (
													<tr
														key={mode.id}
														className="hover:bg-[var(--color-app-hover)]/40 transition-colors group">
														<td className="px-4 py-2.5 text-xs font-mono text-[var(--color-app-text-muted)]">
															{mode.id}
														</td>
														<td className="px-4 py-2.5 font-bold text-sm">
															{mode.label}
														</td>
														<td className="px-4 py-2.5 text-sm">{mode.icon}</td>
														<td className="px-4 py-2.5 text-sm">
															{mode.rounds} / {mode.seconds}s
														</td>
														<td className="px-4 py-2.5 text-sm">
															{mode.multiplayer ? "Yes" : "No"}
														</td>
														<td className="px-4 py-2.5">
															<span
																className={cn(
																	"px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider",
																	mode.enabled ?
																		"bg-green-500/10 text-green-500"
																	:	"bg-red-500/10 text-red-500",
																)}>
																{mode.enabled ? "Active" : "Disabled"}
															</span>
														</td>
														<td className="px-4 py-2.5 text-right">
															<div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
																<button
																	onClick={() => setEditMode(mode)}
																	className="p-1.5 text-[var(--color-app-text-muted)] hover:text-[var(--color-app-blue)] transition-colors">
																	<Edit2 className="w-3.5 h-3.5" />
																</button>
																<button
																	onClick={() => handleDeleteMode(mode.id)}
																	className="p-1.5 text-[var(--color-app-text-muted)] hover:text-red-500 transition-colors">
																	<Trash2 className="w-3.5 h-3.5" />
																</button>
															</div>
														</td>
													</tr>
												))
											}
										</tbody>
									</table>
								</div>
							</div>
						)}
					</div>
				</main>
			</div>

			{/* Edit Maps/Fallback Modals — rendered outside overflow wrapper to avoid stacking context issues */}
			{(editRegion || editFallback) && (
				<div className="fixed inset-0 z-[400] flex items-center justify-center p-4 overflow-y-auto">
					<div
						className="absolute inset-0 bg-black/60 backdrop-blur-md"
						onClick={() => {
							setEditRegion(null);
							setEditFallback(null);
						}}
					/>

					{editRegion && (
						<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl w-[min(95vw,900px)] relative z-10 shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
							<div className="p-5 border-b border-[var(--color-app-border-light)] flex items-center justify-between sticky top-0 bg-[var(--color-app-panel)] z-10">
								<h2 className="text-lg font-black text-[var(--color-app-text)]">
									{editRegion.id === "" ?
										"Add New Region"
									:	`Edit Region: ${editRegion.name}`}
								</h2>
								<button
									onClick={() => setEditRegion(null)}
									className="p-1.5 hover:bg-[var(--color-app-hover)] rounded-full transition-colors">
									<X className="w-5 h-5 text-[var(--color-app-text-muted)]" />
								</button>
							</div>

							<div className="p-6 flex flex-col gap-6 overflow-y-auto flex-1">
								{/* Basic Info */}
								<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
									<div className="flex flex-col gap-1.5">
										<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
											ID (Unique)
										</label>
										<input
											type="text"
											value={editRegion.id}
											onChange={e =>
												setEditRegion({ ...editRegion, id: e.target.value })
											}
											className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
										/>
									</div>
									<div className="flex flex-col gap-1.5">
										<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
											Name
										</label>
										<input
											type="text"
											value={editRegion.name}
											onChange={e =>
												setEditRegion({ ...editRegion, name: e.target.value })
											}
											className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
										/>
									</div>
									<div className="flex flex-col gap-1.5">
										<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
											Flag Emoji
										</label>
										<input
											type="text"
											value={editRegion.flag}
											onChange={e =>
												setEditRegion({ ...editRegion, flag: e.target.value })
											}
											className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
										/>
									</div>
									<div className="flex flex-col gap-1.5 justify-center mt-2">
										<Toggle
											label="Enable Region"
											checked={editRegion.is_enabled ?? true}
											onChange={checked =>
												setEditRegion({
													...editRegion,
													is_enabled: checked,
												})
											}
										/>
									</div>
								</div>

								{/* Media & Display */}
								<div className="border-t border-[var(--color-app-border-light)] pt-4">
									<h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] mb-3">
										Media & Display
									</h3>
									<div className="flex flex-col gap-4">
										<div className="flex flex-col gap-1.5">
											<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
												Flag Image URL
											</label>
											<div className="flex items-start gap-3">
												<input
													type="text"
													placeholder="https://flagcdn.com/..."
													value={editRegion.flag_image || ""}
													onChange={e =>
														setEditRegion({
															...editRegion,
															flag_image: e.target.value || null,
														})
													}
													className="flex-1 bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
												/>
												{editRegion.flag_image && (
													<div className="flex-shrink-0 pt-1">
														<img
															src={editRegion.flag_image}
															alt="preview"
															className="w-16 h-10 rounded-lg border border-[var(--color-app-border)] object-cover"
															onError={() => {}}
														/>
													</div>
												)}
											</div>
										</div>
										<div className="flex flex-col gap-1.5">
											<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
												Background (CSS/URL)
											</label>
											<input
												type="text"
												placeholder="linear-gradient(...) or url(...)"
												value={editRegion.background || ""}
												onChange={e =>
													setEditRegion({
														...editRegion,
														background: e.target.value || null,
													})
												}
												className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
											/>
										</div>
									</div>
								</div>

								{/* Categories */}
								<div className="border-t border-[var(--color-app-border-light)] pt-4">
									<h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] mb-3">
										Categories
									</h3>
									<div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
										{["popular", "asia", "europe", "americas", "oceania"].map(
											cat => (
												<label
													key={cat}
													className="flex items-center gap-2 cursor-pointer">
													<input
														type="checkbox"
														checked={(editRegion.categories || []).includes(
															cat,
														)}
														onChange={e => {
															const cats = editRegion.categories || [];
															if (e.target.checked) {
																setEditRegion({
																	...editRegion,
																	categories: [...cats, cat],
																});
															} else {
																setEditRegion({
																	...editRegion,
																	categories: cats.filter(c => c !== cat),
																});
															}
														}}
														className="w-4 h-4 rounded border-[var(--color-app-border)] bg-[var(--color-app-bg)] cursor-pointer"
													/>
													<span className="text-xs font-medium text-[var(--color-app-text)] capitalize">
														{cat}
													</span>
												</label>
											),
										)}
									</div>
								</div>

								{/* Boundary Coordinates */}
								<div className="border-t border-[var(--color-app-border-light)] pt-4">
									<h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] mb-3">
										Boundary Coordinates
									</h3>
									<div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-3">
										{["min_lat", "max_lat", "min_lng", "max_lng"].map(
											fieldKey =>
												React.createElement(NumericInput, {
													key: fieldKey,
													label: fieldKey.replace("_", " "),
													value:
														(editRegion[fieldKey as keyof Region] as number) ??
														0,
													onChange: (val: number | "") =>
														setEditRegion({
															...editRegion,
															[fieldKey]: val === "" ? 0 : val,
														}),
													step: 0.0001,
												} as any),
										)}
									</div>
								</div>

								{/* Camera Zoom Settings */}
								<div className="border-t border-[var(--color-app-border-light)] pt-4">
									<h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] mb-3">
										Camera Zoom Settings
									</h3>
									<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
										<NumericInput
											label="Zoom"
											value={editRegion.camera_zoom ?? ""}
											onChange={val =>
												setEditRegion({
													...editRegion,
													camera_zoom: val === "" ? null : val,
												})
											}
											step={0.1}
											placeholder="Default"
										/>
										<NumericInput
											label="Min Zoom"
											value={editRegion.camera_min_zoom ?? ""}
											onChange={val =>
												setEditRegion({
													...editRegion,
													camera_min_zoom: val === "" ? null : val,
												})
											}
											step={0.1}
											placeholder="Default"
										/>
										<NumericInput
											label="Max Zoom"
											value={editRegion.camera_max_zoom ?? ""}
											onChange={val =>
												setEditRegion({
													...editRegion,
													camera_max_zoom: val === "" ? null : val,
												})
											}
											step={0.1}
											placeholder="Default"
										/>
									</div>
								</div>
							</div>

							<div className="p-4 bg-[var(--color-app-bg)]/30 border-t border-[var(--color-app-border-light)] flex justify-end gap-3">
								<button
									onClick={() => setEditRegion(null)}
									disabled={isSaving}
									className="px-4 py-1.5 rounded-lg text-sm font-bold text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors disabled:opacity-50">
									Cancel
								</button>
								<button
									onClick={handleSaveRegion}
									disabled={isSaving}
									className="bg-[var(--color-app-blue)] hover:bg-blue-600 disabled:opacity-60 text-white px-5 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow shadow-blue-500/20 transition-all text-sm">
									{isSaving ?
										<>
											<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{" "}
											Saving...
										</>
									:	<>
											<Save className="w-4 h-4" /> Save Region
										</>
									}
								</button>
							</div>
						</div>
					)}

					{editFallback && (
						<div className="bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl w-[min(96vw,42rem)] max-w-none relative z-10 shadow-2xl animate-in zoom-in-95 duration-200">
							<div className="p-5 border-b border-[var(--color-app-border-light)] flex items-center justify-between">
								<h2 className="text-lg font-black text-[var(--color-app-text)]">
									{editFallback.id ? "Edit Fallback" : "Add Fallback"}
								</h2>
								<button
									onClick={() => setEditFallback(null)}
									className="p-1.5 hover:bg-[var(--color-app-hover)] rounded-full transition-colors">
									<X className="w-5 h-5 text-[var(--color-app-text-muted)]" />
								</button>
							</div>

							<div className="p-6 flex flex-col gap-4">
								<div className="flex flex-col gap-1.5">
									<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
										Region
									</label>
									<select
										value={editFallback.region_id}
										onChange={e =>
											setEditFallback({
												...editFallback,
												region_id: e.target.value,
											})
										}
										className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30">
										{regions.map(r => (
											<option key={r.id} value={r.id}>
												{r.flag} {r.name}
											</option>
										))}
									</select>
								</div>
								<div className="grid grid-cols-2 gap-3">
									<div className="flex flex-col gap-1.5">
										<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
											Latitude
										</label>
										<input
											type="number"
											step="0.000001"
											value={editFallback.lat}
											onChange={e =>
												setEditFallback({
													...editFallback,
													lat: parseFloat(e.target.value),
												})
											}
											className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
										/>
									</div>
									<div className="flex flex-col gap-1.5">
										<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
											Longitude
										</label>
										<input
											type="number"
											step="0.000001"
											value={editFallback.lng}
											onChange={e =>
												setEditFallback({
													...editFallback,
													lng: parseFloat(e.target.value),
												})
											}
											className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
										/>
									</div>
								</div>
								<div className="flex flex-col gap-1.5 justify-center mt-2">
									<Toggle
										label="Enable Fallback"
										checked={editFallback.is_enabled ?? true}
										onChange={checked =>
											setEditFallback({
												...editFallback,
												is_enabled: checked,
											})
										}
									/>
								</div>
							</div>

							<div className="p-4 bg-[var(--color-app-bg)]/30 border-t border-[var(--color-app-border-light)] flex justify-end gap-3">
								<button
									onClick={() => setEditFallback(null)}
									disabled={isSaving}
									className="px-4 py-1.5 rounded-lg text-sm font-bold text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors disabled:opacity-50">
									Cancel
								</button>
								<button
									onClick={handleSaveFallback}
									disabled={isSaving}
									className="bg-[var(--color-app-blue)] hover:bg-blue-600 disabled:opacity-60 text-white px-5 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow shadow-blue-500/20 transition-all text-sm">
									{isSaving ?
										<>
											<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{" "}
											Saving...
										</>
									:	<>
											<Save className="w-4 h-4" /> Save Fallback
										</>
									}
								</button>
							</div>
						</div>
					)}

					{/* Removed Edit Mode Modal from inside editRegion container */}
				</div>
			)}

			{/* Edit Mode Modal */}
			{editMode && (
				<div className="fixed inset-0 z-[400] flex items-center justify-center p-4 overflow-y-auto">
					<div
						className="absolute inset-0 bg-black/60 backdrop-blur-md"
						onClick={() => setEditMode(null)}
					/>
					<div
						className="relative w-full max-w-md bg-[var(--color-app-bg)] rounded-2xl shadow-2xl overflow-hidden border border-[var(--color-app-border)] animate-in fade-in zoom-in-95 duration-200"
						onClick={e => e.stopPropagation()}>
						<div className="p-5 border-b border-[var(--color-app-border-light)] flex items-center justify-between bg-[var(--color-app-panel)]">
							<h2 className="text-xl font-bold flex items-center gap-2">
								<Gamepad2 className="w-5 h-5 text-[var(--color-app-blue)]" />
								Edit Game Mode
							</h2>
							<button
								onClick={() => setEditMode(null)}
								className="text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors p-1 bg-white/5 hover:bg-white/10 rounded-lg">
								<X className="w-5 h-5" />
							</button>
						</div>

						<div className="p-5 flex flex-col gap-4">
							<div className="flex flex-col gap-1.5">
								<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
									ID (Unique)
								</label>
								<input
									type="text"
									value={editMode.id}
									onChange={e =>
										setEditMode({ ...editMode, id: e.target.value })
									}
									className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
									Label
								</label>
								<input
									type="text"
									value={editMode.label}
									onChange={e =>
										setEditMode({ ...editMode, label: e.target.value })
									}
									className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
									Description
								</label>
								<textarea
									rows={2}
									value={editMode.description}
									onChange={e =>
										setEditMode({ ...editMode, description: e.target.value })
									}
									className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30 resize-none"
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
										Rounds
									</label>
									<input
										type="number"
										value={editMode.rounds}
										onChange={e =>
											setEditMode({
												...editMode,
												rounds: parseInt(e.target.value) || 0,
											})
										}
										className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
										Seconds
									</label>
									<input
										type="number"
										value={editMode.seconds}
										onChange={e =>
											setEditMode({
												...editMode,
												seconds: parseInt(e.target.value) || 0,
											})
										}
										className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
									/>
								</div>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<label className="text-[10px] font-black uppercase text-[var(--color-app-text-muted)] tracking-widest">
										Sort Order
									</label>
									<input
										type="number"
										value={editMode.sort_order ?? 0}
										onChange={e =>
											setEditMode({
												...editMode,
												sort_order: parseInt(e.target.value) || 0,
											})
										}
										className="bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-app-blue)]/30"
									/>
								</div>
								<div className="flex flex-col gap-1.5 justify-center mt-2">
									<Toggle
										label="Enabled"
										checked={editMode.enabled ?? true}
										onChange={checked =>
											setEditMode({ ...editMode, enabled: checked })
										}
									/>
								</div>
							</div>
						</div>

						<div className="p-4 bg-[var(--color-app-bg)]/30 border-t border-[var(--color-app-border-light)] flex justify-end gap-3">
							<button
								onClick={() => setEditMode(null)}
								disabled={isSaving}
								className="px-4 py-1.5 rounded-lg text-sm font-bold text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors disabled:opacity-50">
								Cancel
							</button>
							<button
								onClick={handleSaveMode}
								disabled={isSaving}
								className="bg-[var(--color-app-blue)] hover:bg-blue-600 disabled:opacity-60 text-white px-5 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow shadow-blue-500/20 transition-all text-sm">
								{isSaving ?
									<>
										<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{" "}
										Saving...
									</>
								:	<>
										<Save className="w-4 h-4" /> Save Mode
									</>
								}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
