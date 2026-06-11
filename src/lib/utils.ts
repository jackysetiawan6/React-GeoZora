import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getRankTitle(level: number): string {
  if (level >= 10) return 'Veteran';
  if (level >= 5) return 'Explorer';
  return 'Rookie';
}

export function getRankColor(level: number): string {
  if (level >= 10) return 'text-amber-500';
  if (level >= 5) return 'text-[var(--color-app-blue)]';
  return 'text-slate-400';
}
