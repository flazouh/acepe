import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines class names using clsx and merges Tailwind CSS classes intelligently.
 * Handles conditional classes, arrays, and objects while resolving Tailwind conflicts.
 * @param inputs - Class values to merge (strings, arrays, objects, or conditionals)
 * @returns Merged class string with Tailwind conflicts resolved
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Removes the `child` property from a type if it exists.
 * Useful for component props that shouldn't accept a child slot.
 */
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;

/**
 * Removes the `children` property from a type if it exists.
 * Useful for component props that shouldn't accept children.
 */
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;

/**
 * Removes both `child` and `children` properties from a type.
 * Combines WithoutChild and WithoutChildren for components that accept neither.
 */
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;

/**
 * Extends a type with an optional ref property for DOM element references.
 * @template T - The base props type
 * @template U - The HTML element type (defaults to HTMLElement)
 */
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
	ref?: U | null;
};
