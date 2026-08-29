import * as Effect from "effect/Effect";
import { applyUiThemeToDocument, DEFAULT_UI_THEME, resolveUiThemeId } from "@acepe/ui/themes";

import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { settings } from "$lib/utils/tauri-client/settings.js";

const UI_THEME_FAMILY_KEY: UserSettingKey = "ui_theme_family";

/**
 * Which palette family theme.css paints. Independent of light/dark: a family
 * ships both appearances, and the `dark` class still decides which one shows.
 */
class UiThemeFamilyStore {
	familyId = $state<string>(DEFAULT_UI_THEME);

	setFamily(id: string, options?: { persist?: boolean }): void {
		const resolved = resolveUiThemeId(id);
		this.familyId = resolved;

		if (typeof document !== "undefined") {
			applyUiThemeToDocument(resolved, document.documentElement);
		}

		if (options?.persist === false) return;

		void Effect.runPromise(
			settings.setRaw(UI_THEME_FAMILY_KEY, resolved).pipe(Effect.catch(() => Effect.void))
		);
	}
}

export const uiThemeFamilyStore = new UiThemeFamilyStore();
