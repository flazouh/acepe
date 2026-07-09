export type BrandShaderColorTuple = readonly [string, string, string, string];

export type BrandShaderPalette = {
	background: string;
	colors: BrandShaderColorTuple;
	softness: number;
	intensity: number;
	noise: number;
};

export const BRAND_SHADER_DARK_PALETTE: BrandShaderPalette = {
	background: "#1a1a1a",
	colors: ["#F77E2C", "#ff8558", "#d69d5c", "#ffb380"],
	softness: 0.3,
	intensity: 0.8,
	noise: 0.15,
};

export const BRAND_SHADER_LUMINAR_PALETTE: BrandShaderPalette = {
	background: "#ece0ff",
	colors: ["#ff9ad1", "#a9c2ff", "#ffc69d", "#b79bff"],
	softness: 0.9,
	intensity: 0.55,
	noise: 0.5,
};

/** Default bounded panel — static blob mix within the card. */
export const BRAND_SHADER_LUMINAR_PANEL_PALETTE: BrandShaderPalette = {
	background: "#ece0ff",
	colors: ["#ff9ad1", "#a9c2ff", "#ffc69d", "#b79bff"],
	softness: 0.65,
	intensity: 0.62,
	noise: 0.48,
};

/** Higher contrast, tighter color bands for small surfaces. */
export const BRAND_SHADER_LUMINAR_PANEL_VIVID_PALETTE: BrandShaderPalette = {
	background: "#e8d4ff",
	colors: ["#ff7ebf", "#8fb4ff", "#ffb07a", "#9d7bff"],
	softness: 0.42,
	intensity: 0.82,
	noise: 0.38,
};

/** Dreamy, low-contrast wash. */
export const BRAND_SHADER_LUMINAR_PANEL_SOFT_PALETTE: BrandShaderPalette = {
	background: "#f3edff",
	colors: ["#ffc8e4", "#c5d8ff", "#ffe0c4", "#d4c4ff"],
	softness: 0.88,
	intensity: 0.45,
	noise: 0.55,
};

/** Pink-forward luminar mix. */
export const BRAND_SHADER_LUMINAR_PANEL_ROSE_PALETTE: BrandShaderPalette = {
	background: "#fae8f3",
	colors: ["#ff6eb4", "#f0a8d0", "#ffc2a8", "#c9a0ff"],
	softness: 0.58,
	intensity: 0.7,
	noise: 0.44,
};

/** Acepe orange grain tuned for compact cards. */
export const BRAND_SHADER_ACEPE_PANEL_PALETTE: BrandShaderPalette = {
	background: "#1f1f1f",
	colors: ["#F77E2C", "#ff9a5c", "#e8b060", "#ffbf80"],
	softness: 0.38,
	intensity: 0.72,
	noise: 0.22,
};
