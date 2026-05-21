import React, { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
	errorInfo: ErrorInfo | null;
	showDetails: boolean;
}

export default class ErrorBoundary extends React.Component<Props, State> {
	declare props: Props;
	declare setState: (
		state: Partial<State> | ((prevState: State) => Partial<State>),
		callback?: () => void
	) => void;

	public state: State = {
		hasError: false,
		error: null,
		errorInfo: null,
		showDetails: false,
	};

	public static getDerivedStateFromError(error: Error): Partial<State> {
		return { hasError: true, error };
	}

	public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
		this.setState({ errorInfo });
	}

	private handleReload = () => {
		window.location.reload();
	};

	private toggleDetails = () => {
		this.setState((prev) => ({ showDetails: !prev }));
	};

	public render() {
		if (this.state.hasError) {
			return (
				<div className="min-h-screen w-full flex items-center justify-center bg-[#0B0D19] text-slate-100 p-4 font-sans selection:bg-rose-500/30">
					{/* Ambient glow background */}
					<div className="absolute inset-0 overflow-hidden pointer-events-none">
						<div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-rose-500/10 rounded-full blur-[120px]" />
						<div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[100px]" />
					</div>

					{/* Glassmorphic Card */}
					<div className="relative w-full max-w-xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-xl rounded-2xl p-8 md:p-10 shadow-2xl flex flex-col items-center text-center overflow-hidden">
						{/* Card glow edge */}
						<div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-rose-500/40 to-transparent" />

						{/* Pulsing Icon */}
						<div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-6 animate-pulse">
							<AlertTriangle className="w-8 h-8 text-rose-400" />
						</div>

						{/* Gradient Title */}
						<h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent mb-3">
							Something went wrong
						</h1>

						<p className="text-slate-400 text-base max-w-md mb-8 leading-relaxed">
							GeoZora encountered an unexpected error. Don't worry, your progress has likely been saved. Let's try reloading the app.
						</p>

						{/* Actions */}
						<div className="flex flex-col sm:flex-row gap-4 w-full justify-center mb-6">
							<button
								onClick={this.handleReload}
								className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-medium rounded-xl shadow-lg shadow-rose-500/20 transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer w-full sm:w-auto"
							>
								<RefreshCw className="w-4 h-4" />
								Reload Application
							</button>
						</div>

						{/* Error details accordion */}
						{this.state.error && (
							<div className="w-full border-t border-white/[0.06] pt-4 mt-2">
								<button
									onClick={this.toggleDetails}
									className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors mx-auto cursor-pointer py-1"
								>
									{this.state.showDetails ? (
										<>
											Hide Technical Details <ChevronUp className="w-3.5 h-3.5" />
										</>
									) : (
										<>
											Show Technical Details <ChevronDown className="w-3.5 h-3.5" />
										</>
									)}
								</button>

								{this.state.showDetails && (
									<div className="mt-4 text-left bg-black/40 border border-white/[0.05] rounded-lg p-4 font-mono text-xs text-rose-300/90 overflow-auto max-h-48 scrollbar-thin scrollbar-thumb-white/10">
										<p className="font-bold mb-1">{this.state.error.toString()}</p>
										{this.state.errorInfo && (
											<pre className="whitespace-pre text-slate-400 mt-2 leading-5 text-[10px]">
												{this.state.errorInfo.componentStack}
											</pre>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
