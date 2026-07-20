import { writable } from "svelte/store";

export const THEME_STORAGE_KEY = "acepe-theme";

export const websiteThemePreferences = ["system", "light", "dark"] as const;

export type WebsiteThemePreference = (typeof websiteThemePreferences)[number];

/** Resolved appearance applied to the document. */
export type WebsiteTheme = "dark" | "light";

export function isWebsiteThemePreference(
	value: string | null | undefined
): value is WebsiteThemePreference {
	return value === "system" || value === "light" || value === "dark";
}

export function isWebsiteTheme(value: string | null | undefined): value is WebsiteTheme {
	return value === "dark" || value === "light";
}

/** Default preference when nothing is stored. */
export function getInitialThemePreference(storedTheme: string | null): WebsiteThemePreference {
	return isWebsiteThemePreference(storedTheme) ? storedTheme : "system";
}

/**
 * @deprecated Prefer {@link getInitialThemePreference}. Kept for callers that still
 * resolve a stored value into an immediate appearance without a media query.
 */
export function getInitialTheme(storedTheme: string | null): WebsiteTheme {
	const preference = getInitialThemePreference(storedTheme);
	if (preference === "light" || preference === "dark") {
		return preference;
	}
	return "dark";
}

export function prefersDarkColorScheme(
	mediaQuery: Pick<MediaQueryList, "matches"> | null | undefined
): boolean {
	return mediaQuery?.matches ?? true;
}

export function resolveEffectiveTheme(
	preference: WebsiteThemePreference,
	mediaQuery: Pick<MediaQueryList, "matches"> | null | undefined
): WebsiteTheme {
	if (preference === "light" || preference === "dark") {
		return preference;
	}
	return prefersDarkColorScheme(mediaQuery) ? "dark" : "light";
}

export function getToggledTheme(currentTheme: WebsiteTheme): WebsiteTheme {
	return currentTheme === "dark" ? "light" : "dark";
}

export function applyThemeToDocument(theme: WebsiteTheme, rootElement: HTMLElement): void {
	rootElement.dataset.theme = theme;
	rootElement.style.colorScheme = theme;
}

export function applyThemePreferenceToDocument(
	preference: WebsiteThemePreference,
	rootElement: HTMLElement,
	mediaQuery: Pick<MediaQueryList, "matches"> | null | undefined
): WebsiteTheme {
	const effective = resolveEffectiveTheme(preference, mediaQuery);
	rootElement.dataset.themePreference = preference;
	applyThemeToDocument(effective, rootElement);
	return effective;
}

function getInitialPreferenceStoreValue(): WebsiteThemePreference {
	if (typeof document === "undefined") return "system";
	const preference = document.documentElement.dataset.themePreference;
	if (isWebsiteThemePreference(preference)) return preference;
	return "system";
}

function getInitialEffectiveStoreValue(): WebsiteTheme {
	if (typeof document === "undefined") return "dark";
	const theme = document.documentElement.dataset.theme;
	return isWebsiteTheme(theme) ? theme : "dark";
}

export const websiteThemePreferenceStore = writable<WebsiteThemePreference>(
	getInitialPreferenceStoreValue()
);

/** Resolved light/dark for icon packs and other appearance-sensitive UI. */
export const websiteThemeStore = writable<WebsiteTheme>(getInitialEffectiveStoreValue());

export function setWebsiteThemePreference(
	preference: WebsiteThemePreference,
	options?: {
		rootElement?: HTMLElement;
		mediaQuery?: Pick<MediaQueryList, "matches"> | null;
		persist?: boolean;
	}
): WebsiteTheme {
	const rootElement =
		options?.rootElement ?? (typeof document !== "undefined" ? document.documentElement : null);
	const mediaQuery =
		options?.mediaQuery ??
		(typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null);
	const persist = options?.persist ?? true;

	websiteThemePreferenceStore.set(preference);

	if (persist && typeof window !== "undefined") {
		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, preference);
		} catch {
			// Ignore quota / private-mode failures.
		}
	}

	if (!rootElement) {
		const effective = resolveEffectiveTheme(preference, mediaQuery);
		websiteThemeStore.set(effective);
		return effective;
	}

	const effective = applyThemePreferenceToDocument(preference, rootElement, mediaQuery);
	websiteThemeStore.set(effective);
	return effective;
}
