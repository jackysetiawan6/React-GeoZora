import React, { useState, useRef, useEffect, useId } from "react";
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
	const id = useId();
	const labelId = `dropdown-label-${id}`;
	const listboxId = `dropdown-listbox-${id}`;

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

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (disabled) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " " || e.key === "Enter") {
			e.preventDefault();
			setIsOpen(true);
			setTimeout(() => {
				const activeEl = containerRef.current?.querySelector('[role="option"][aria-selected="true"]') as HTMLElement
					|| containerRef.current?.querySelector('[role="option"]') as HTMLElement;
				activeEl?.focus();
			}, 0);
		}
	};

	const handleOptionKeyDown = (e: React.KeyboardEvent, index: number) => {
		if (e.key === "Escape") {
			e.preventDefault();
			setIsOpen(false);
			containerRef.current?.querySelector("button")?.focus();
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			const nextBtn = containerRef.current?.querySelectorAll('[role="option"]')[index + 1] as HTMLElement;
			nextBtn?.focus();
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			const prevBtn = containerRef.current?.querySelectorAll('[role="option"]')[index - 1] as HTMLElement;
			if (prevBtn) {
				prevBtn.focus();
			} else {
				containerRef.current?.querySelector("button")?.focus();
			}
		} else if (e.key === " " || e.key === "Enter") {
			e.preventDefault();
			onChange(options[index].value);
			setIsOpen(false);
			containerRef.current?.querySelector("button")?.focus();
		}
	};

	return (
		<div className={cn("block", className)} ref={containerRef}>
			{label && (
				<span
					id={labelId}
					className="text-[10px] font-black uppercase tracking-widest text-[var(--color-app-text-muted)] block mb-2"
				>
					{label}
				</span>
			)}
			<div className="relative">
				<button
					type="button"
					onClick={() => !disabled && setIsOpen(!isOpen)}
					onKeyDown={handleKeyDown}
					disabled={disabled}
					role="combobox"
					aria-expanded={isOpen}
					aria-haspopup="listbox"
					aria-controls={listboxId}
					aria-labelledby={label ? labelId : undefined}
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
					<div
						id={listboxId}
						role="listbox"
						aria-labelledby={label ? labelId : undefined}
						className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-app-panel)] border border-[var(--color-app-border)] rounded-xl shadow-lg z-50 overflow-hidden">
						{options.map((option, index) => (
							<button
								key={option.value}
								type="button"
								role="option"
								aria-selected={option.value === value}
								onKeyDown={(e) => handleOptionKeyDown(e, index)}
								onClick={() => {
									onChange(option.value);
									setIsOpen(false);
									containerRef.current?.querySelector("button")?.focus();
								}}
								className={cn(
									"w-full text-left px-4 py-3 transition-colors text-sm font-medium focus:outline-none focus:bg-[var(--color-app-hover)]",
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
