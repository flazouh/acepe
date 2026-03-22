import type { ThemeRegistration } from 'shiki';

import { createMarkdownRenderer } from '@acepe/ui/markdown';

let cursorDarkTheme: ThemeRegistration | null = null;
let cursorLightTheme: ThemeRegistration | null = null;

async function loadDarkTheme(): Promise<ThemeRegistration> {
	if (cursorDarkTheme) return cursorDarkTheme;
	const response = await fetch('/themes/cursor.theme.json');
	if (!response.ok) throw new Error(`Failed to load dark theme: ${response.statusText}`);
	cursorDarkTheme = await response.json();
	return cursorDarkTheme!;
}

async function loadLightTheme(): Promise<ThemeRegistration> {
	if (cursorLightTheme) return cursorLightTheme;
	const response = await fetch('/themes/cursor-light.theme.json');
	if (!response.ok) throw new Error(`Failed to load light theme: ${response.statusText}`);
	cursorLightTheme = await response.json();
	return cursorLightTheme!;
}

const api = createMarkdownRenderer({
	loadDarkTheme,
	loadLightTheme,
	languages: [
		'javascript',
		'typescript',
		'jsx',
		'tsx',
		'json',
		'markdown',
		'html',
		'css',
		'bash',
		'shell',
		'python',
		'ruby',
		'rust',
		'go',
		'sql'
	]
});

export function preInitializeMarkdown(): void {
	api.preInitializeMarkdown();
}
