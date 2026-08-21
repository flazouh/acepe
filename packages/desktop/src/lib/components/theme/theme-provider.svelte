<script lang="ts">
import * as Effect from "effect/Effect";
import { onMount } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { fontSizeSettingsStore } from "$lib/stores/font-size-settings-store.svelte.js";
import { loadingIndicatorSettingsStore } from "$lib/stores/loading-indicator-settings-store.svelte.js";
import { scheduleDeferredIdleWork } from "$lib/utils/deferred-work.js";
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
	return Effect.runPromise(
		settings.getRaw(USER_THEME_KEY).pipe(
			Effect.map((stored) => {
				if (stored !== null && isValidTheme(stored)) {
					return stored;
				}
				return null;
			}),
			Effect.catch(() => Effect.succeed(null))
		)
	);
}

function saveStoredTheme(value: Theme) {
	// Fire-and-forget - don't block on save
	void Effect.runPromise(
		settings.setRaw(USER_THEME_KEY, value).pipe(Effect.catch(() => Effect.void))
	);
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
	// Apply default theme immediately (will be overridden if DB has different value)
	applyTheme(theme);

	scheduleDeferredIdleWork(() => {
		void loadingIndicatorSettingsStore.initialize();
		void fontSizeSettingsStore.initialize();

		// Load stored theme from database after the first shell is measurable.
		loadStoredTheme().then((storedTheme) => {
			if (storedTheme !== null) {
				theme = storedTheme;
			}
			applyTheme(theme);
		});
	});

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
