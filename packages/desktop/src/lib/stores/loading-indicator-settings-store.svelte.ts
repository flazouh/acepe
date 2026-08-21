import {
	DEFAULT_LOADING_ICON_COLOR_ID,
	isLoadingIconColorId,
	LOADING_ICON_COLOR_OPTIONS,
	type LoadingIconColorId,
	normalizeLoadingIconColorId,
} from "@acepe/ui/icons";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
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

		const colorResult = await Effect.runPromise(
			Effect.result(tauriClient.settings.get<string>(LOADING_INDICATOR_COLOR_KEY))
		);
		if (Result.isSuccess(colorResult)) {
			this.applyColor(normalizeLoadingIconColorId(colorResult.success));
		}

		this.initialized = true;
	}

	async setColor(value: string): Promise<void> {
		if (!isLoadingIconColorId(value)) {
			return;
		}

		this.applyColor(value);

		const result = await Effect.runPromise(
			Effect.result(tauriClient.settings.set(LOADING_INDICATOR_COLOR_KEY, value))
		);
		if (Result.isFailure(result)) {
			toast.error(result.failure.message);
		}
	}

	private applyColor(value: LoadingIconColorId): void {
		this.selectedColor = value;
	}
}

export const loadingIndicatorSettingsStore = new LoadingIndicatorSettingsStore();
