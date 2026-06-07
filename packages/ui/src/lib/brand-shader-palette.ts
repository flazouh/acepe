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
