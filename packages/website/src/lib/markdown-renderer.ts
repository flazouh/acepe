import { createMarkdownRenderer } from "@acepe/ui/markdown";
import type { ThemeRegistration } from "shiki";

let cursorDarkTheme: ThemeRegistration | null = null;
let cursorLightTheme: ThemeRegistration | null = null;

async function loadDarkTheme(): Promise<ThemeRegistration> {
	if (cursorDarkTheme) return cursorDarkTheme;
	const response = await fetch("/themes/cursor.theme.json");
	if (!response.ok) throw new Error(`Failed to load dark theme: ${response.statusText}`);
	cursorDarkTheme = await response.json();
	if (!cursorDarkTheme) throw new Error("Failed to load dark theme");
	return cursorDarkTheme;
}

async function loadLightTheme(): Promise<ThemeRegistration> {
	if (cursorLightTheme) return cursorLightTheme;
	const response = await fetch("/themes/cursor-light.theme.json");
	if (!response.ok) throw new Error(`Failed to load light theme: ${response.statusText}`);
	cursorLightTheme = await response.json();
	if (!cursorLightTheme) throw new Error("Failed to load light theme");
	return cursorLightTheme;
}

export const WEBSITE_MARKDOWN_LANGUAGES = [
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"json",
	"markdown",
	"html",
	"css",
	"bash",
	"shell",
	"svelte",
	"python",
	"ruby",
	"rust",
	"go",
	"sql",
] as const;

const api = createMarkdownRenderer({
	loadDarkTheme,
	loadLightTheme,
	languages: WEBSITE_MARKDOWN_LANGUAGES,
});

export function preInitializeMarkdown(): void {
	api.preInitializeMarkdown();
}
