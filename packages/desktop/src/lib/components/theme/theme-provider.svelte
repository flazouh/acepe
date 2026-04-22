<script lang="ts">
import { ResultAsync } from "neverthrow";
import { onMount } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
import { settings } from "$lib/utils/tauri-client/settings.js";

import { setTheme, type Theme } from "./context.svelte.js";

const USER_THEME_KEY: UserSettingKey = "user_theme";

let {
	defaultTheme: defaultThemeProp = "system",
	children,
	...restProps
}: HTMLAttributes<HTMLDivElement> & {
	defaultTheme?: Theme;
} = $props();

function isValidTheme(value: unknown): value is Theme {
	return value === "light" || value === "dark" || value === "system";
}

async function loadStoredTheme(): Promise<Theme | null> {
	const result = await settings
		.getRaw(USER_THEME_KEY)
		.map((stored) => {
			if (stored !== null && isValidTheme(stored)) {
				return stored;
			}
			return null;
		})
		.mapErr(() => {
			// ignore errors
			return null;
		});

	return result.isOk() ? result.value : null;
}

function saveStoredTheme(value: Theme) {
	// Fire-and-forget - don't block on save
	settings.setRaw(USER_THEME_KEY, value).mapErr(() => {
		// ignore save errors
	});
}

function applyTheme(themeValue: Theme) {
	const root = document.documentElement;
	const effectiveTheme =
		themeValue === "system"
			? window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light"
			: themeValue;

	root.classList.remove("light", "dark");
	root.classList.add(effectiveTheme);
}

function setThemeValue(value: Theme) {
	theme = value;
	saveStoredTheme(value);
	applyTheme(value);
}

// Initialize with default, then load from database on mount
// svelte-ignore state_referenced_locally
let theme = $state<Theme>(defaultThemeProp);

onMount(() => {
	// Load stored theme from database (async, but fire-and-forget for initial load)
	loadStoredTheme().then((storedTheme) => {
		if (storedTheme !== null) {
			theme = storedTheme;
		}
		applyTheme(theme);
	});

	// Apply default theme immediately (will be overridden if DB has different value)
	applyTheme(theme);

	// Listen for system theme changes
	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const handleChange = () => {
		if (theme === "system") {
			applyTheme("system");
		}
	};
	mediaQuery.addEventListener("change", handleChange);

	return () => {
		mediaQuery.removeEventListener("change", handleChange);
	};
});

setTheme({
	theme: () => theme,
	setTheme: setThemeValue,
});
</script>

<div {...restProps}>{@render children?.()}</div>
