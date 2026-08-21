import { fromPromise } from "@acepe/effect-result/fromPromise";
import { fromShikiTheme, renderMermaid as renderMermaidSvg } from "beautiful-mermaid";
import * as Effect from "effect/Effect";
import type { ThemeRegistration } from "shiki";

import { loadCursorLightTheme, loadCursorTheme } from "./shiki-theme.js";

/**
 * Diagram colors extracted from Shiki themes using beautiful-mermaid's fromShikiTheme.
 */
interface DiagramColors {
	bg: string;
	fg: string;
	line?: string;
	accent?: string;
	muted?: string;
	surface?: string;
	border?: string;
}

let darkColors: DiagramColors | null = null;
let lightColors: DiagramColors | null = null;
let isInitialized = false;

/**
 * Simple in-memory cache for rendered SVGs.
 * Key format: `${isDark}:${code}`
 */
const svgCache = new Map<string, string>();
const MAX_CACHE_SIZE = 50;

function getCacheKey(code: string, isDark: boolean): string {
	return `${isDark}:${code}`;
}

function addToCache(key: string, svg: string): void {
	// Evict oldest entries if cache is full
	if (svgCache.size >= MAX_CACHE_SIZE) {
		const firstKey = svgCache.keys().next().value;
		if (firstKey !== undefined) {
			svgCache.delete(firstKey);
		}
	}
	svgCache.set(key, svg);
}

/**
 * Extracts diagram colors from a Shiki theme registration.
 */
function extractColorsFromTheme(theme: ThemeRegistration): DiagramColors {
	return fromShikiTheme(theme) as DiagramColors;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/**
 * Initializes mermaid colors from Cursor themes.
 * Must be called before rendering diagrams.
 */
export function initializeMermaidColors(): Effect.Effect<void, Error> {
	if (isInitialized) {
		return Effect.succeed(undefined);
	}

	return loadCursorTheme().pipe(
		Effect.flatMap((darkTheme) => {
			darkColors = extractColorsFromTheme(darkTheme);
			return loadCursorLightTheme();
		}),
		Effect.map((lightTheme) => {
			lightColors = extractColorsFromTheme(lightTheme);
			isInitialized = true;
		}),
		Effect.mapError((error) => new Error(`Failed to initialize mermaid colors: ${error.message}`))
	);
}

/**
 * Renders mermaid code to SVG using beautiful-mermaid.
 * Results are cached to avoid re-rendering the same diagram.
 *
 * @param code - The mermaid diagram code to render
 * @param isDark - Whether to use dark theme colors
 * @returns Effect with SVG string on success or Error on failure
 */
export function renderMermaid(code: string, isDark: boolean = true): Effect.Effect<string, Error> {
	const trimmedCode = code.trim();
	if (!trimmedCode) {
		return Effect.fail(new Error("Empty mermaid code"));
	}

	// Check cache first
	const cacheKey = getCacheKey(trimmedCode, isDark);
	const cached = svgCache.get(cacheKey);
	if (cached) {
		return Effect.succeed(cached);
	}

	const colors = isDark ? darkColors : lightColors;

	if (!colors) {
		return initializeMermaidColors().pipe(Effect.flatMap(() => renderMermaid(trimmedCode, isDark)));
	}

	return fromPromise(
		() =>
			renderMermaidSvg(trimmedCode, {
				bg: colors.bg,
				fg: colors.fg,
				line: colors.line,
				accent: colors.accent,
				muted: colors.muted,
				surface: colors.surface,
				border: colors.border,
				transparent: true,
			}),
		toError
	).pipe(
		Effect.map((svg) => {
			addToCache(cacheKey, svg);
			return svg;
		})
	);
}

/**
 * Pre-initializes mermaid colors during app startup.
 * Call this early to eliminate cold-start delay for first diagram render.
 */
export function preInitializeMermaid(): Effect.Effect<void, Error> {
	return initializeMermaidColors();
}

/**
 * Checks if mermaid has been initialized.
 */
export function isMermaidInitialized(): boolean {
	return isInitialized;
}

/**
 * Resets initialization state and clears cache. Useful for testing.
 */
export function resetMermaidRenderer(): void {
	darkColors = null;
	lightColors = null;
	isInitialized = false;
	svgCache.clear();
}
