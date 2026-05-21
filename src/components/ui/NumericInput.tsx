import React from "react";
import { cn } from "../../lib/utils";

interface NumericInputProps {
	label?: string;
	value: number | "";
	onChange: (value: number | "") => void;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	error?: string;
	suffix?: string;
	className?: string;
	placeholder?: string;
}

export function NumericInput({
	label,
	value,
	onChange,
	min,
	max,
	step = 1,
	disabled = false,
	error,
	suffix,
	className,
	placeholder,
}: NumericInputProps) {
	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.value === "") {
			onChange("");
			return;
		}

		let num = Number(e.target.value);

		if (isNaN(num)) return;

		if (min !== undefined) num = Math.max(min, num);
		if (max !== undefined) num = Math.min(max, num);

		onChange(num);
	};

	return (
		<label className={cn("block", className)}>
			{label && (
				<span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] block mb-2">
					{label}
				</span>
			)}
			<div className="flex items-center gap-1">
				<input
					type="number"
					value={value}
					onChange={handleChange}
					min={min}
					max={max}
					step={step}
					disabled={disabled}
					placeholder={placeholder}
					aria-invalid={error ? "true" : "false"}
					className={cn(
						"flex-1 bg-transparent text-[var(--color-app-text)] font-mono text-lg font-bold outline-none",
						"border border-[var(--color-app-border-light)] rounded-xl px-4 py-3 transition-colors w-full min-w-0",
						"focus:border-[var(--color-app-blue)]/50 focus:ring-1 focus:ring-[var(--color-app-blue)]/30",
						"disabled:opacity-50 disabled:cursor-not-allowed",
						error && "border-red-500/50 focus:ring-red-500/30",
					)}
				/>
				{suffix && (
					<span className="text-sm font-bold text-[var(--color-app-text-muted)]">
						{suffix}
					</span>
				)}
			</div>
			{error && <p className="text-xs text-red-500/70 mt-1" role="alert">{error}</p>}
		</label>
	);
}
