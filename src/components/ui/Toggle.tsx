import React from "react";
import { cn } from "../../lib/utils";

interface ToggleProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	className?: string;
}

export function Toggle({
	label,
	checked,
	onChange,
	disabled = false,
	className,
}: ToggleProps) {
	return (
		<label
			className={cn(
				"flex items-center gap-3 cursor-pointer",
				disabled && "opacity-50 cursor-not-allowed",
				className,
			)}>
			<div className="relative inline-flex items-center flex-shrink-0">
				<input
					type="checkbox"
					role="switch"
					aria-checked={checked}
					checked={checked}
					onChange={e => !disabled && onChange(e.target.checked)}
					disabled={disabled}
					className="sr-only peer"
				/>
				<div
					className={cn(
						"w-11 h-6 rounded-full transition-colors duration-200 ease-in-out border flex items-center justify-start",
						"peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-app-blue)] peer-focus-visible:outline-offset-2",
						checked ?
							"bg-[var(--color-app-blue)] border-[var(--color-app-blue)]"
						:	"bg-[var(--color-app-bg)] border-[var(--color-app-border)]",
					)}>
					<div
						className={cn(
							"w-5 h-5 rounded-full transition-transform duration-200 ease-in-out bg-white shadow-sm ml-0.5",
							checked ? "translate-x-5" : "translate-x-0 opacity-70",
						)}
					/>
				</div>
			</div>
			<span className="text-sm font-medium text-[var(--color-app-text)]">
				{label}
			</span>
		</label>
	);
}
