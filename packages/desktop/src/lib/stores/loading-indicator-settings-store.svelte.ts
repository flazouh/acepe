import {
	DEFAULT_DOT_MATRIX_LOADER_ID,
	DEFAULT_LOADING_ICON_COLOR_ID,
	DOT_MATRIX_LOADER_OPTIONS,
	LEGACY_LOADER_ID_MAP,
	LOADING_ICON_COLOR_OPTIONS,
	isDotMatrixLoaderId,
	isLoadingIconColorId,
	loadingIconPreference,
	normalizeDotMatrixLoaderId,
	type DotMatrixLoaderId,
	type LoadingIconColorId,
} from "@acepe/ui/icons";
import { toast } from "svelte-sonner";
import type { UserSettingKey } from "$lib/services/user-settings-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

const LOADING_INDICATOR_VARIANT_KEY: UserSettingKey = "loading_indicator_variant";
const LOADING_INDICATOR_COLOR_KEY: UserSettingKey = "loading_indicator_color";

class LoadingIndicatorSettingsStore {
	selectedVariant = $state<DotMatrixLoaderId>(DEFAULT_DOT_MATRIX_LOADER_ID);
	selectedColor = $state<LoadingIconColorId>(DEFAULT_LOADING_ICON_COLOR_ID);
	readonly options = DOT_MATRIX_LOADER_OPTIONS;
	readonly colorOptions = LOADING_ICON_COLOR_OPTIONS;

	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		const [variantResult, colorResult] = await Promise.all([
			tauriClient.settings.get<string>(LOADING_INDICATOR_VARIANT_KEY),
			tauriClient.settings.get<string>(LOADING_INDICATOR_COLOR_KEY),
		]);

		if (variantResult.isOk()) {
			this.applyVariant(normalizeDotMatrixLoaderId(variantResult.value));
		}
		if (colorResult.isOk() && isLoadingIconColorId(colorResult.value)) {
			this.applyColor(colorResult.value);
		}

		this.initialized = true;
	}

	async setVariant(value: string): Promise<void> {
		if (!isDotMatrixLoaderId(value) && LEGACY_LOADER_ID_MAP[value] === undefined) {
			return;
		}

		const normalized = normalizeDotMatrixLoaderId(value);
		this.applyVariant(normalized);

		const result = await tauriClient.settings.set(LOADING_INDICATOR_VARIANT_KEY, normalized);
		if (result.isErr()) {
			toast.error(result.error.message);
		}
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

	private applyVariant(value: DotMatrixLoaderId): void {
		this.selectedVariant = value;
		loadingIconPreference.setVariant(value);
	}

	private applyColor(value: LoadingIconColorId): void {
		this.selectedColor = value;
		loadingIconPreference.setColor(value);
	}
}

export const loadingIndicatorSettingsStore = new LoadingIndicatorSettingsStore();
