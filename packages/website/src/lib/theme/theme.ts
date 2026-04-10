import { writable } from "svelte/store";

export const THEME_STORAGE_KEY = "acepe-theme";

export const websiteThemes = ["dark", "light"] as const;

export type WebsiteTheme = (typeof websiteThemes)[number];

function getInitialStoreValue(): WebsiteTheme {
	if (typeof document === "undefined") return "dark";
	const t = document.documentElement.dataset.theme;
	return t === "light" || t === "dark" ? t : "dark";
}

export const websiteThemeStore = writable<WebsiteTheme>(getInitialStoreValue());

export function isWebsiteTheme(value: string | null): value is WebsiteTheme {
	return value === "dark" || value === "light";
}

export function getInitialTheme(storedTheme: string | null): WebsiteTheme {
	return isWebsiteTheme(storedTheme) ? storedTheme : "dark";
}

export function getToggledTheme(currentTheme: WebsiteTheme): WebsiteTheme {
	return currentTheme === "dark" ? "light" : "dark";
}

export function applyThemeToDocument(theme: WebsiteTheme, rootElement: HTMLElement): void {
	rootElement.dataset.theme = theme;
	rootElement.style.colorScheme = theme;
}
