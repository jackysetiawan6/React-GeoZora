import React, { useState, useRef, useEffect } from "react";
import { cn } from "../../lib/utils";
import { ChevronDown } from "lucide-react";

interface DropdownOption {
	value: string | number;
	label: string;
}

interface DropdownProps {
	label?: string;
	value: string | number;
	onChange: (value: string | number) => void;
	options: DropdownOption[];
	disabled?: boolean;
	error?: string;
	className?: string;
}

export function Dropdown({
	label,
	value,
	onChange,
	options,
	disabled = false,
	error,
	className,
}: DropdownProps) {
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const selectedOption = options.find(opt => opt.value === value);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
			return () =>
				document.removeEventListener("mousedown", handleClickOutside);
		}
	}, [isOpen]);

	return (
		<div className={cn("block", className)} ref={containerRef}>
			{label && (
				<span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] block mb-2">
					{label}
				</span>
			)}
			<div className="relative">
				<button
					onClick={() => !disabled && setIsOpen(!isOpen)}
					disabled={disabled}
					className={cn(
						"w-full bg-[var(--color-app-bg)] border border-[var(--color-app-border)] rounded-xl px-4 py-3",
						"text-[var(--color-app-text)] font-medium text-left transition-colors",
						"focus:outline-none focus:border-[var(--color-app-blue)]/50 focus:ring-1 focus:ring-[var(--color-app-blue)]/30",
						"disabled:opacity-50 disabled:cursor-not-allowed",
						error && "border-red-500/50 focus:ring-red-500/30",
						isOpen &&
							"border-[var(--color-app-blue)]/50 ring-1 ring-[var(--color-app-blue)]/30",
					)}>
					<div className="flex items-center justify-between">
						<span>{selectedOption?.label || "Select..."}</span>
						<ChevronDown
							className={cn(
								"w-4 h-4 text-[var(--color-app-text-muted)] transition-transform",
								isOpen && "rotate-180",
							)}
						/>
					</div>
				</button>

				{isOpen && (
					<div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-xl shadow-lg z-50 overflow-hidden">
						{options.map(option => (
							<button
								key={option.value}
								onClick={() => {
									onChange(option.value);
									setIsOpen(false);
								}}
								className={cn(
									"w-full text-left px-4 py-3 transition-colors text-sm font-medium",
									option.value === value ?
										"bg-[var(--color-app-blue)]/10 text-[var(--color-app-blue)] border-l-2 border-[var(--color-app-blue)]"
									:	"text-[var(--color-app-text)] hover:bg-[var(--color-app-hover)]",
								)}>
								{option.label}
							</button>
						))}
					</div>
				)}
			</div>
			{error && <p className="text-xs text-red-500/70 mt-1">{error}</p>}
		</div>
	);
}
