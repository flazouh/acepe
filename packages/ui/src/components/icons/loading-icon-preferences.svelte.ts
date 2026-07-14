import { createSubscriber } from "svelte/reactivity";

/**
 * Shared color choices for the Hugeicons spinner used by loading states.
 * The spinner shape is fixed so every loading indicator uses the same icon set.
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
	return isLoadingIconColorId(value) ? value : DEFAULT_LOADING_ICON_COLOR_ID;
}

export function loadingIconColorHex(id: LoadingIconColorId): string {
	const match = LOADING_ICON_COLOR_OPTIONS.find((option) => option.id === id);
	return match?.hex ?? "#bf8700";
}

let globalLoadingIconColor: LoadingIconColorId = DEFAULT_LOADING_ICON_COLOR_ID;
const loadingIconPreferenceSubscribers = new Set<() => void>();
const subscribeLoadingIconPreference = createSubscriber((update) => {
	loadingIconPreferenceSubscribers.add(update);
	return () => loadingIconPreferenceSubscribers.delete(update);
});

function notifyLoadingIconPreferenceSubscribers(): void {
	for (const update of loadingIconPreferenceSubscribers) {
		update();
	}
}

export const loadingIconPreference = {
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
