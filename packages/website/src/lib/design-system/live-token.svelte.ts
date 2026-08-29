import { browser } from "$app/environment";

import { resolveToken } from "./tokens.js";
import { themeVersion } from "./theme-version.svelte.js";

/**
 * Computed value of `--{name}` on the document root, kept current across theme
 * changes. Empty during SSR and for a token that is not declared.
 */
export function liveToken(name: string): string {
	if (!browser) return "";
	themeVersion();
	return resolveToken(name, document.documentElement);
}
