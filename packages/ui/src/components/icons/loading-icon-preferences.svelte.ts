import { createSubscriber } from "svelte/reactivity";

export const DOT_MATRIX_LOADER_OPTIONS = [
	{
		id: "prism-bloom",
		label: "Prism Bloom",
	},
	{
		id: "honey-gate",
		label: "Honey Gate",
	},
	{
		id: "vertex-relay",
		label: "Vertex Relay",
	},
	{
		id: "spiral-lattice",
		label: "Spiral Lattice",
	},
	{
		id: "chevron-march",
		label: "Chevron March",
	},
	{
		id: "hourglass-flip",
		label: "Hourglass Flip",
	},
	{
		id: "glyph-flip",
		label: "Glyph Flip",
	},
	{
		id: "petal-shimmer",
		label: "Petal Shimmer",
	},
	{
		id: "liquid-vortex",
		label: "Liquid Vortex",
	},
	{
		id: "arc-spin",
		label: "Arc Spin",
	},
] as const;

export type DotMatrixLoaderId =
	(typeof DOT_MATRIX_LOADER_OPTIONS)[number]["id"];

export const DEFAULT_DOT_MATRIX_LOADER_ID: DotMatrixLoaderId = "prism-bloom";

/**
 * Curated Tailwind 500-shade palette for the loading indicator color picker.
 * Values are the Tailwind v3 default 500 hex codes.
 */
export const LOADING_ICON_COLOR_OPTIONS = [
	{ id: "amber", label: "Amber", hex: "#bf8700" },
	{ id: "red", label: "Red", hex: "#ef4444" },
	{ id: "orange", label: "Orange", hex: "#f97316" },
	{ id: "yellow", label: "Yellow", hex: "#eab308" },
	{ id: "lime", label: "Lime", hex: "#84cc16" },
	{ id: "green", label: "Green", hex: "#22c55e" },
	{ id: "emerald", label: "Emerald", hex: "#10b981" },
	{ id: "teal", label: "Teal", hex: "#14b8a6" },
	{ id: "cyan", label: "Cyan", hex: "#06b6d4" },
	{ id: "sky", label: "Sky", hex: "#0ea5e9" },
	{ id: "blue", label: "Blue", hex: "#3b82f6" },
	{ id: "indigo", label: "Indigo", hex: "#6366f1" },
	{ id: "violet", label: "Violet", hex: "#8b5cf6" },
	{ id: "purple", label: "Purple", hex: "#a855f7" },
	{ id: "fuchsia", label: "Fuchsia", hex: "#d946ef" },
	{ id: "pink", label: "Pink", hex: "#ec4899" },
	{ id: "rose", label: "Rose", hex: "#f43f5e" },
	{ id: "slate", label: "Slate", hex: "#64748b" },
] as const;

export type LoadingIconColorId =
	(typeof LOADING_ICON_COLOR_OPTIONS)[number]["id"];

export const DEFAULT_LOADING_ICON_COLOR_ID: LoadingIconColorId = "amber";

export function isLoadingIconColorId(
	value: string | null | undefined,
): value is LoadingIconColorId {
	return LOADING_ICON_COLOR_OPTIONS.some((option) => option.id === value);
}

export function normalizeLoadingIconColorId(
	value: string | null | undefined,
): LoadingIconColorId {
	if (isLoadingIconColorId(value)) {
		return value;
	}
	return DEFAULT_LOADING_ICON_COLOR_ID;
}

export function loadingIconColorHex(id: LoadingIconColorId): string {
	const match = LOADING_ICON_COLOR_OPTIONS.find((option) => option.id === id);
	return match?.hex ?? "#bf8700";
}

let globalLoadingIconVariant: DotMatrixLoaderId = DEFAULT_DOT_MATRIX_LOADER_ID;
let globalLoadingIconColor: LoadingIconColorId = DEFAULT_LOADING_ICON_COLOR_ID;
const loadingIconPreferenceSubscribers = new Set<() => void>();
const subscribeLoadingIconPreference = createSubscriber((update) => {
	loadingIconPreferenceSubscribers.add(update);
	return () => {
		loadingIconPreferenceSubscribers.delete(update);
	};
});

function notifyLoadingIconPreferenceSubscribers(): void {
	for (const update of loadingIconPreferenceSubscribers) {
		update();
	}
}

export function isDotMatrixLoaderId(
	value: string | null | undefined,
): value is DotMatrixLoaderId {
	return DOT_MATRIX_LOADER_OPTIONS.some((option) => option.id === value);
}

export function normalizeDotMatrixLoaderId(
	value: string | null | undefined,
): DotMatrixLoaderId {
	if (isDotMatrixLoaderId(value)) {
		return value;
	}
	return DEFAULT_DOT_MATRIX_LOADER_ID;
}

export const loadingIconPreference = {
	get variant(): DotMatrixLoaderId {
		subscribeLoadingIconPreference();
		return globalLoadingIconVariant;
	},
	setVariant(value: DotMatrixLoaderId): void {
		if (globalLoadingIconVariant === value) {
			return;
		}
		globalLoadingIconVariant = value;
		notifyLoadingIconPreferenceSubscribers();
	},
	get colorId(): LoadingIconColorId {
		subscribeLoadingIconPreference();
		return globalLoadingIconColor;
	},
	get colorHex(): string {
		subscribeLoadingIconPreference();
		return loadingIconColorHex(globalLoadingIconColor);
	},
	setColor(value: LoadingIconColorId): void {
		if (globalLoadingIconColor === value) {
			return;
		}
		globalLoadingIconColor = value;
		notifyLoadingIconPreferenceSubscribers();
	},
};
