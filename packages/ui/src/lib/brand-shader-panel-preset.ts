import { GrainGradientShapes, ShaderFitOptions } from "@paper-design/shaders";

import type { BrandShaderPalette } from "../../lib/brand-shader-palette.js";

export type BrandShaderPanelShape = "blob" | "wave" | "corners" | "ripple" | "dots";

export interface BrandShaderPanelPreset {
	readonly palette: BrandShaderPalette;
	readonly shape: number;
	readonly fit: number;
	readonly scale: number;
	readonly speed: number;
	readonly rotation: number;
}

const panelShapeByName: Readonly<Record<BrandShaderPanelShape, number>> = {
	blob: GrainGradientShapes.blob,
	wave: GrainGradientShapes.wave,
	corners: GrainGradientShapes.corners,
	ripple: GrainGradientShapes.ripple,
	dots: GrainGradientShapes.dots,
};

export function buildBrandShaderPanelPreset(input: {
	palette: BrandShaderPalette;
	shape: BrandShaderPanelShape;
	scale: number;
	fit?: number;
	speed?: number;
	rotation?: number;
}): BrandShaderPanelPreset {
	return {
		palette: input.palette,
		shape: panelShapeByName[input.shape],
		fit: input.fit ?? ShaderFitOptions.contain,
		scale: input.scale,
		speed: input.speed ?? 0,
		rotation: input.rotation ?? 0,
	};
}
