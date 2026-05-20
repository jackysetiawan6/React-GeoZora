import React from "react";
import { cn } from "../../lib/utils";

interface ToggleButtonProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	className?: string;
}

export function ToggleButton({
	label,
	checked,
	onChange,
	disabled = false,
	className,
}: ToggleButtonProps) {
	return (
		<button
			onClick={() => !disabled && onChange(!checked)}
			disabled={disabled}
			className={cn(
				"flex items-center justify-between w-full px-4 py-3 rounded-xl border transition-all text-sm font-medium",
				checked ?
					"bg-red-500/10 border-red-500/30 text-red-100"
				:	"bg-[var(--color-app-panel)] border-[var(--color-app-border-light)] text-[var(--color-app-text-muted)]",
				"disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-opacity-80",
				className,
			)}>
			<span>{label}</span>
			<div
				className={cn(
					"w-4 h-4 rounded-full border-2 transition-colors",
					checked ? "bg-red-500 border-red-400" : "border-slate-600",
				)}
			/>
		</button>
	);
}
