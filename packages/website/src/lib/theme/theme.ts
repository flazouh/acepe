import { writable } from "svelte/store";

export const THEME_STORAGE_KEY = "acepe-theme";

export const websiteThemes = ["dark"] as const;

export type WebsiteTheme = "dark";

export const websiteThemeStore = writable<WebsiteTheme>("dark");

export function isWebsiteTheme(value: string | null): value is WebsiteTheme {
	return value === "dark";
}

export function getInitialTheme(_storedTheme: string | null): WebsiteTheme {
	return "dark";
}

export function getToggledTheme(_currentTheme: WebsiteTheme): WebsiteTheme {
	return "dark";
}

export function applyThemeToDocument(_theme: WebsiteTheme, rootElement: HTMLElement): void {
	rootElement.dataset.theme = "dark";
	rootElement.style.colorScheme = "dark";
}
