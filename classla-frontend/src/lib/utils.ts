import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getDisplayName(user: {
  first_name?: string;
  last_name?: string;
  email: string;
}): string {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return fullName || user.email;
}

export function compareByLastFirstName(
  a: { last_name?: string; first_name?: string },
  b: { last_name?: string; first_name?: string }
): number {
  const lastCmp = (a.last_name || "").localeCompare(b.last_name || "");
  if (lastCmp !== 0) return lastCmp;
  return (a.first_name || "").localeCompare(b.first_name || "");
}

export function getInitials(user: {
  first_name?: string;
  last_name?: string;
  email: string;
}): string {
  if (user.first_name) {
    return user.first_name.charAt(0) + (user.last_name?.charAt(0) || "");
  }
  return user.email.charAt(0);
}
