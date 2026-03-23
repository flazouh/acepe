export type TerminalThemeMode = "light" | "dark";

export interface TerminalTheme {
	background: string;
	foreground: string;
	cursor: string;
	cursorAccent: string;
	selectionBackground: string;
	selectionForeground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
}

type CssVariableReader = (name: string) => string | null;

function createDefaultTheme(mode: TerminalThemeMode): TerminalTheme {
	if (mode === "dark") {
		return {
			background: "#1a1a1a",
			foreground: "#d8dee9",
			cursor: "#d8dee9",
			cursorAccent: "#1a1a1a",
			selectionBackground: "#2a2a2a",
			selectionForeground: "#ffffff",
			black: "#2a2a2a",
			red: "#bf616a",
			green: "#a3be8c",
			yellow: "#ebcb8b",
			blue: "#88c0d0",
			magenta: "#b48ead",
			cyan: "#8fbcbb",
			white: "#d8dee9",
			brightBlack: "#4c566a",
			brightRed: "#bf616a",
			brightGreen: "#a3be8c",
			brightYellow: "#ebcb8b",
			brightBlue: "#88c0d0",
			brightMagenta: "#b48ead",
			brightCyan: "#8fbcbb",
			brightWhite: "#eceff4",
		};
	}

	return {
		background: "#FAFAF8",
		foreground: "#0A0A09",
		cursor: "#0A0A09",
		cursorAccent: "#FAFAF8",
		selectionBackground: "#E8E3D8",
		selectionForeground: "#0A0A09",
		black: "#5C4A3D",
		red: "#8B2D2D",
		green: "#5A7A3A",
		yellow: "#B5840D",
		blue: "#4A6A8A",
		magenta: "#8A5A7A",
		cyan: "#4A7A7A",
		white: "#D4CCC4",
		brightBlack: "#7A6A5A",
		brightRed: "#A03030",
		brightGreen: "#6A8A4A",
		brightYellow: "#C5940D",
		brightBlue: "#5A7A9A",
		brightMagenta: "#9A6A8A",
		brightCyan: "#5A8A8A",
		brightWhite: "#F5F0EB",
	};
}

function coalesceColor(value: string | null, fallback: string): string {
	return value && value.length > 0 ? value : fallback;
}

export function resolveTerminalTheme(
	mode: TerminalThemeMode,
	readCssVariable: CssVariableReader
): TerminalTheme {
	const defaults = createDefaultTheme(mode);
	const background = readCssVariable("--background");
	const card = readCssVariable("--card");
	const foreground = readCssVariable("--foreground");
	const cardForeground = readCssVariable("--card-foreground");
	const muted = readCssVariable("--muted");
	const accent = readCssVariable("--accent");
	const accentForeground = readCssVariable("--accent-foreground");
	const mutedForeground = readCssVariable("--muted-foreground");
	const border = readCssVariable("--border");

	const resolvedBackground = coalesceColor(card, coalesceColor(background, defaults.background));
	const resolvedForeground = coalesceColor(
		cardForeground,
		coalesceColor(foreground, defaults.foreground)
	);
	const resolvedSelectionBackground = coalesceColor(
		accent,
		coalesceColor(muted, defaults.selectionBackground)
	);
	const resolvedSelectionForeground = coalesceColor(accentForeground, resolvedForeground);

	return {
		...defaults,
		background: resolvedBackground,
		foreground: resolvedForeground,
		cursor: resolvedForeground,
		cursorAccent: resolvedBackground,
		selectionBackground: resolvedSelectionBackground,
		selectionForeground: resolvedSelectionForeground,
		black: coalesceColor(border, defaults.black),
		white: coalesceColor(mutedForeground, defaults.white),
		brightBlack: coalesceColor(mutedForeground, defaults.brightBlack),
		brightWhite: resolvedForeground,
	};
}
