import { useEffect, RefObject } from "react";

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
	useEffect(() => {
		if (!active || !ref.current) return;

		const element = ref.current;
		
		// Find all focusable elements
		const getFocusable = () => {
			const queried = element.querySelectorAll<HTMLElement>(
				'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex="0"], [contenteditable]'
			);
			return (Array.from(queried) as HTMLElement[]).filter(el => {
				const style = window.getComputedStyle(el);
				return el.tabIndex !== -1 && style.display !== 'none' && style.visibility !== 'hidden';
			});
		};

		const focusable = getFocusable();
		const firstElement = focusable[0];
		const lastElement = focusable[focusable.length - 1];

		if (firstElement) {
			firstElement.focus();
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Tab") return;

			const currentFocusable = getFocusable();
			if (currentFocusable.length === 0) {
				e.preventDefault();
				return;
			}

			const first = currentFocusable[0];
			const last = currentFocusable[currentFocusable.length - 1];

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};

		element.addEventListener("keydown", handleKeyDown);
		return () => {
			element.removeEventListener("keydown", handleKeyDown);
		};
	}, [ref, active]);
}
