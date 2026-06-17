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
			background: "#1b1a18",
			foreground: "#f8f5ee",
			cursor: "#f8f5ee",
			cursorAccent: "#1b1a18",
			selectionBackground: "#2c2b29",
			selectionForeground: "#f8f5ee",
			black: "#292928",
			red: "#bf616a",
			green: "#a3be8c",
			yellow: "#ebcb8b",
			blue: "#88c0d0",
			magenta: "#b48ead",
			cyan: "#8fbcbb",
			white: "#a5a39d",
			brightBlack: "#5f5d59",
			brightRed: "#bf616a",
			brightGreen: "#a3be8c",
			brightYellow: "#ebcb8b",
			brightBlue: "#88c0d0",
			brightMagenta: "#b48ead",
			brightCyan: "#8fbcbb",
			brightWhite: "#f8f5ee",
		};
	}

	return {
		background: "#ffffff",
		foreground: "#0a0907",
		cursor: "#0a0907",
		cursorAccent: "#ffffff",
		selectionBackground: "#f0eeeb",
		selectionForeground: "#0a0907",
		black: "#dfdeda",
		red: "#8B2D2D",
		green: "#5A7A3A",
		yellow: "#B5840D",
		blue: "#4A6A8A",
		magenta: "#8A5A7A",
		cyan: "#4A7A7A",
		white: "#5f5d59",
		brightBlack: "#918f8b",
		brightRed: "#A03030",
		brightGreen: "#6A8A4A",
		brightYellow: "#C5940D",
		brightBlue: "#5A7A9A",
		brightMagenta: "#9A6A8A",
		brightCyan: "#5A8A8A",
		brightWhite: "#0a0907",
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
