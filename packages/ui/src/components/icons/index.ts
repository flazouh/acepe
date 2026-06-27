export { default as ArrowRightIcon } from "./arrow-right-icon.svelte";
export { default as BuildIcon } from "./build-icon.svelte";
export { default as LoadingIcon } from "./loading-icon.svelte";
export { default as DotmTriangle17Spinner } from "./dotm-triangle-17-spinner.svelte";
export { default as DotmTriangle20Spinner } from "./dotm-triangle-20-spinner.svelte";
export { default as DotmSquare18Spinner } from "./dotm-square-18-spinner.svelte";
export { default as DotmHexSpinner } from "./dotm-hex-spinner.svelte";
export { default as DotmatrixTriangleLoader } from "./dotmatrix-triangle-loader.svelte";
export {
	DEFAULT_DOT_MATRIX_LOADER_ID,
	DEFAULT_LOADING_ICON_COLOR_ID,
	DOT_MATRIX_LOADER_OPTIONS,
	LEGACY_LOADER_ID_MAP,
	LOADING_ICON_COLOR_OPTIONS,
	isDotMatrixLoaderId,
	isLoadingIconColorId,
	loadingIconColorHex,
	loadingIconPreference,
	normalizeDotMatrixLoaderId,
	normalizeLoadingIconColorId,
	type DotMatrixLoaderId,
	type DotMatrixLoaderOption,
	type LoadingIconColorId,
} from "./loading-icon-preferences.svelte.js";
export {
	resolveDotmatrixLoaderRoute,
	type DotmatrixLoaderRoute,
	type DotmHexLoaderVariant,
	type DotmTriangleLoaderVariant,
} from "./dotmatrix/dotmatrix-loader-routing.js";
export { DOTMATRIX_REGISTRY_MANIFEST, type DotmatrixRegistryId } from "./dotmatrix/dotmatrix-registry.js";
export { default as DotmatrixRegistryLoader } from "./dotmatrix/dotmatrix-registry-loader.svelte";
export {
	DOTMATRIX_LOADER_CONFIGS,
	DOTMATRIX_LOADER_IDS,
	getDotmatrixLoaderConfig,
	type DotmatrixLoaderId,
} from "./dotmatrix/loaders/index.js";
export type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "./dotmatrix/loader-types.js";
export { default as PlanIcon } from "./plan-icon.svelte";
export { default as RevertIcon } from "./revert-icon.svelte";

// Notion-backed general icon glyphs (phosphor/tabler/lucide replacements).
export * from "./glyphs/index.js";
