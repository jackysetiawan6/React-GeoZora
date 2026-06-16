import { X, ChevronRight, RefreshCw, Loader2, Globe, Users, Clock, Compass } from "lucide-react";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../lib/utils";
import { useFocusTrap } from "../lib/useFocusTrap";
import { supabase } from "../lib/supabase";

interface JoinRoomModalProps {
	onClose: () => void;
	onJoin: (code: string) => void;
}

interface PublicRoomEntry {
	id: string;
	host_display_name: string;
	participant_count: number;
	total_rounds: number;
	round_seconds: number;
	no_moving: boolean;
	no_panning: boolean;
	no_zooming: boolean;
	enable_time_multiplier: boolean;
	selected_maps: string[];
	created_at: string;
}

export default function JoinRoomModal({ onClose, onJoin }: JoinRoomModalProps) {
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [publicRooms, setPublicRooms] = useState<PublicRoomEntry[]>([]);
	const [isLoadingRooms, setIsLoadingRooms] = useState(true);
	const modalRef = useRef<HTMLDivElement>(null);

	useFocusTrap(modalRef, true);

	const fetchRooms = useCallback(async () => {
		setIsLoadingRooms(true);
		try {
			const { data, error: rpcError } = await supabase.rpc("list_public_rooms");
			if (rpcError) {
				console.error("Error calling list_public_rooms:", rpcError);
			} else {
				setPublicRooms(data || []);
			}
		} catch (err) {
			console.error("Failed to fetch public rooms:", err);
		} finally {
			setIsLoadingRooms(false);
		}
	}, []);

	useEffect(() => {
		void fetchRooms();
	}, [fetchRooms]);

	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", handleEscape);
		return () => window.removeEventListener("keydown", handleEscape);
	}, [onClose]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!code.trim()) {
			setError("Please enter a room code");
			return;
		}
		onJoin(code.trim().toUpperCase());
	};

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
				onClick={onClose}
			/>

			{/* Content */}
			<div
				ref={modalRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="join-title"
				className="relative w-full max-w-lg bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300 flex flex-col max-h-[90vh]">
				
				<div className="p-6 flex flex-col overflow-hidden">
					{/* Header */}
					<div className="flex items-center justify-between mb-4">
						<h2
							id="join-title"
							className="text-xl font-bold text-[var(--color-app-text)] flex items-center gap-2">
							Join Creator Room
						</h2>
						<button
							onClick={onClose}
							aria-label="Close modal"
							className="text-[var(--color-app-text-muted)] hover:text-[var(--color-app-text)] transition-colors cursor-pointer">
							<X className="w-5 h-5" />
						</button>
					</div>

					{/* Section 1: Public Rooms List */}
					<div className="flex flex-col mb-6 min-h-0 flex-1">
						<div className="flex items-center justify-between mb-3">
							<span className="text-xs font-black uppercase tracking-widest text-[var(--color-app-text-muted)]">
								Active Public Rooms
							</span>
							<button
								onClick={fetchRooms}
								disabled={isLoadingRooms}
								className="text-xs text-[var(--color-app-blue)] hover:text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
								<RefreshCw className={cn("w-3.5 h-3.5", isLoadingRooms && "animate-spin")} />
								Refresh
							</button>
						</div>

						<div className={cn(
							"bg-[var(--color-app-bg)]/40 border border-[var(--color-app-border-light)] rounded-xl overflow-y-auto max-h-56 p-2 flex flex-col gap-2 min-h-24",
							(isLoadingRooms || publicRooms.length === 0) && "justify-center"
						)}>
							{isLoadingRooms ? (
								<div className="flex flex-col items-center justify-center py-6 gap-2 text-[var(--color-app-text-muted)]">
									<Loader2 className="w-6 h-6 animate-spin text-[var(--color-app-blue)]" />
									<span className="text-xs font-medium">Scanning for active rooms...</span>
								</div>
							) : publicRooms.length === 0 ? (
								<div className="text-center py-8 text-[var(--color-app-text-muted)]">
									<Globe className="w-8 h-8 mx-auto mb-2 opacity-40 text-[var(--color-app-text-muted)]" />
									<p className="text-xs font-bold uppercase tracking-wide">No active rooms found</p>
									<p className="text-[11px] mt-1 opacity-70">Create a room and invite others to play!</p>
								</div>
							) : (
								<div className="flex flex-col gap-2">
									{publicRooms.map(room => (
										<button
											key={room.id}
											onClick={() => onJoin(room.id)}
											className="w-full text-left bg-[var(--color-app-panel)] border border-[var(--color-app-border-light)] hover:border-[var(--color-app-blue)]/50 p-3.5 rounded-xl transition-all flex items-center justify-between gap-4 group cursor-pointer hover:bg-[var(--color-app-hover)]">
											<div className="flex-1 min-w-0 flex flex-col gap-1.5">
												<div className="flex items-center gap-2">
													<span className="font-bold text-sm text-[var(--color-app-text)] truncate">
														🎮 {room.host_display_name}'s Room
													</span>
													<span className="text-[10px] font-black uppercase bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30 shrink-0 flex items-center gap-1">
														<Users className="w-2.5 h-2.5" />
														{room.participant_count}/30
													</span>
												</div>
												<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--color-app-text-muted)] font-medium">
													<span className="font-mono bg-[var(--color-app-bg)] px-1.5 py-0.5 rounded border border-[var(--color-app-border-light)] font-bold text-[var(--color-app-text)] tracking-wider">
														{room.id}
													</span>
													<span>•</span>
													<span>{room.total_rounds} rds</span>
													<span>•</span>
													<span>{room.round_seconds}s</span>
													{room.no_moving && (
														<>
															<span>•</span>
															<span className="text-red-400">🚫 Move</span>
														</>
													)}
													{room.enable_time_multiplier && (
														<>
															<span>•</span>
															<span className="text-yellow-400">⚡ Bonus</span>
														</>
													)}
												</div>
											</div>
											<div className="text-xs font-black uppercase text-[var(--color-app-blue)] group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
												Join <ChevronRight className="w-4 h-4" />
											</div>
										</button>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Divider */}
					<div className="relative flex py-2 items-center mb-4">
						<div className="flex-grow border-t border-[var(--color-app-border-light)]"></div>
						<span className="flex-shrink mx-4 text-[10px] font-black text-[var(--color-app-text-muted)] uppercase tracking-wider">Or Join By Code</span>
						<div className="flex-grow border-t border-[var(--color-app-border-light)]"></div>
					</div>

					{/* Section 2: Join by Code */}
					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<div className="relative">
							<input
								type="text"
								value={code}
								onChange={e => {
									setCode(e.target.value.toUpperCase());
									setError(null);
								}}
								placeholder="Enter room code (e.g. AB12CD)"
								maxLength={6}
								aria-invalid={error ? "true" : "false"}
								aria-describedby={error ? "join-error" : undefined}
								className={cn(
									"w-full bg-[var(--color-app-bg)]/60 border h-14 rounded-xl px-4 text-center text-xl font-mono font-bold tracking-[0.2em] text-[var(--color-app-text)] outline-none transition-all placeholder:text-[var(--color-app-text-muted)] placeholder:tracking-normal placeholder:text-sm",
									error ?
										"border-red-500 focus:border-red-500"
									:	"border-[var(--color-app-border-light)] focus:border-[var(--color-app-blue)]",
								)}
							/>
							{error && (
								<p
									id="join-error"
									className="text-xs text-red-500 mt-2 text-center font-medium animate-in slide-in-from-top-1"
									role="alert">
									{error}
								</p>
							)}
						</div>

						<button
							type="submit"
							className="w-full h-12 bg-[var(--color-app-blue)] hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 group cursor-pointer">
							Join Match
							<ChevronRight
								className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
								aria-hidden="true"
							/>
						</button>
					</form>
				</div>

				<div className="bg-[var(--color-app-bg)] p-4 border-t border-[var(--color-app-border-light)] text-center shrink-0">
					<p className="text-[10px] text-[var(--color-app-text-muted)] uppercase tracking-widest font-black">
						Ensure you have a stable internet connection
					</p>
				</div>
			</div>
		</div>
	);
}
