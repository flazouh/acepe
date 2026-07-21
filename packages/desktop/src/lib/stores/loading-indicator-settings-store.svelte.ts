import {
	DEFAULT_LOADING_ICON_COLOR_ID,
	isLoadingIconColorId,
	LOADING_ICON_COLOR_OPTIONS,
	type LoadingIconColorId,
	normalizeLoadingIconColorId,
} from "@acepe/ui/icons";
import { toast } from "svelte-sonner";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const LOADING_INDICATOR_COLOR_KEY: UserSettingKey = "loading_indicator_color";

class LoadingIndicatorSettingsStore {
	selectedColor = $state<LoadingIconColorId>(DEFAULT_LOADING_ICON_COLOR_ID);
	readonly colorOptions = LOADING_ICON_COLOR_OPTIONS;

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		const colorResult = await tauriClient.settings.get<string>(LOADING_INDICATOR_COLOR_KEY);
		if (colorResult.isOk()) {
			this.applyColor(normalizeLoadingIconColorId(colorResult.value));
		}

		this.initialized = true;
	}

	async setColor(value: string): Promise<void> {
		if (!isLoadingIconColorId(value)) {
			return;
		}

		this.applyColor(value);

		const result = await tauriClient.settings.set(LOADING_INDICATOR_COLOR_KEY, value);
		if (result.isErr()) {
			toast.error(result.error.message);
		}
	}

	private applyColor(value: LoadingIconColorId): void {
		this.selectedColor = value;
	}
}

export const loadingIndicatorSettingsStore = new LoadingIndicatorSettingsStore();
