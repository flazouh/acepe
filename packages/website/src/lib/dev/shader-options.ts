import {
	colorPanelsFragmentShader,
	GrainGradientShapes,
	getShaderColorFromString,
	grainGradientFragmentShader,
	meshGradientFragmentShader,
	neuroNoiseFragmentShader,
	perlinNoiseFragmentShader,
	ShaderFitOptions,
	type ShaderMountUniforms,
	smokeRingFragmentShader,
	spiralFragmentShader,
	staticMeshGradientFragmentShader,
	WarpPatterns,
	warpFragmentShader,
	wavesFragmentShader,
} from "@paper-design/shaders";
import type { ShaderKind, ShaderPalette, ShaderParamValues } from "./shader-preference-store.js";

export type NumberParamDef = {
	kind: "number";
	id: string;
	label: string;
	default: number;
	min: number;
	max: number;
	step: number;
};

export type EnumOption = { value: number; label: string };

export type EnumParamDef = {
	kind: "enum";
	id: string;
	label: string;
	default: number;
	options: readonly EnumOption[];
};

export type BoolParamDef = {
	kind: "bool";
	id: string;
	label: string;
	default: 0 | 1;
};

export type ShaderParamDef = NumberParamDef | EnumParamDef | BoolParamDef;

export type ShaderOption = {
	fragment: string;
	uniforms: ShaderMountUniforms;
	webgl: { alpha: boolean; premultipliedAlpha: boolean };
	speed: number;
};

export type ShaderDefinition = {
	label: string;
	/** How many palette colors this shader uses (0..4). 0 means palette is ignored. */
	colorCount: 0 | 1 | 2 | 3 | 4;
	/** Whether the shader consumes the palette background color. */
	usesBackground: boolean;
	/** Whether the shader supports speed animation. */
	animated: boolean;
	/** Default scale for sizing uniforms. */
	scale: number;
	params: readonly ShaderParamDef[];
	build: (ctx: ShaderBuildContext) => ShaderOption;
};

export type ShaderBuildContext = {
	palette: ShaderPalette;
	values: ShaderParamValues;
	width: number;
	height: number;
	noise: HTMLImageElement | undefined;
	speed: number;
};

function paramValue(def: ShaderParamDef, values: ShaderParamValues): number {
	const raw = values[def.id];
	return typeof raw === "number" && Number.isFinite(raw) ? raw : def.default;
}

function withSizing(
	target: ShaderMountUniforms,
	width: number,
	height: number,
	scale: number
): void {
	target.u_fit = ShaderFitOptions.cover;
	target.u_scale = scale;
	target.u_rotation = 0;
	target.u_originX = 0.5;
	target.u_originY = 0.5;
	target.u_offsetX = 0;
	target.u_offsetY = 0;
	target.u_worldWidth = width;
	target.u_worldHeight = height;
}

const OPAQUE_WEBGL = { alpha: false, premultipliedAlpha: false } as const;

const SHAPE_ENUM_GRAIN: readonly EnumOption[] = [
	{ value: GrainGradientShapes.wave, label: "Wave" },
	{ value: GrainGradientShapes.dots, label: "Dots" },
	{ value: GrainGradientShapes.truchet, label: "Truchet" },
	{ value: GrainGradientShapes.corners, label: "Corners" },
	{ value: GrainGradientShapes.ripple, label: "Ripple" },
	{ value: GrainGradientShapes.blob, label: "Blob" },
];

const WARP_SHAPE_ENUM: readonly EnumOption[] = [
	{ value: WarpPatterns.checks, label: "Checks" },
	{ value: WarpPatterns.stripes, label: "Stripes" },
	{ value: WarpPatterns.edge, label: "Edge" },
];

const WAVES_SHAPE_ENUM: readonly EnumOption[] = [
	{ value: 0, label: "Zigzag" },
	{ value: 1, label: "Sine" },
	{ value: 2, label: "Irregular A" },
	{ value: 3, label: "Irregular B" },
];

function colorsVec(palette: ShaderPalette, count: number): number[][] {
	const out: number[][] = [];
	for (let i = 0; i < count; i += 1) {
		out.push(getShaderColorFromString(palette.colors[i]));
	}
	return out;
}

// ─── definitions ─────────────────────────────────────────────────────────────

const grainGradient: ShaderDefinition = {
	label: "Grain Gradient",
	colorCount: 4,
	usesBackground: true,
	animated: true,
	scale: 1.25,
	params: [
		{
			kind: "enum",
			id: "shape",
			label: "Shape",
			default: GrainGradientShapes.wave,
			options: SHAPE_ENUM_GRAIN,
		},
		{ kind: "number", id: "softness", label: "Softness", default: 0.6, min: 0, max: 1, step: 0.01 },
		{
			kind: "number",
			id: "intensity",
			label: "Intensity",
			default: 0.14,
			min: 0,
			max: 1.5,
			step: 0.01,
		},
		{ kind: "number", id: "noise", label: "Grain", default: 0.56, min: 0, max: 1, step: 0.01 },
		{ kind: "number", id: "scale", label: "Scale", default: 1.25, min: 0.5, max: 3, step: 0.05 },
	],
	build: ({ palette, values, width, height, noise }) => {
		const u: ShaderMountUniforms = {
			u_colorBack: getShaderColorFromString(palette.background),
			u_colors: colorsVec(palette, 4),
			u_colorsCount: 4,
			u_softness: paramValue(grainGradient.params[1], values),
			u_intensity: paramValue(grainGradient.params[2], values),
			u_noise: paramValue(grainGradient.params[3], values),
			u_shape: paramValue(grainGradient.params[0], values),
			u_noiseTexture: noise,
		};
		withSizing(u, width, height, paramValue(grainGradient.params[4], values));
		return {
			fragment: grainGradientFragmentShader,
			uniforms: u,
			webgl: OPAQUE_WEBGL,
			speed: 0,
		};
	},
};

const staticMeshGradient: ShaderDefinition = {
	label: "Static Mesh",
	colorCount: 4,
	usesBackground: false,
	animated: false,
	scale: 1.1,
	params: [
		{
			kind: "number",
			id: "positions",
			label: "Positions seed",
			default: 12,
			min: 0,
			max: 100,
			step: 1,
		},
		{ kind: "number", id: "waveX", label: "Wave X", default: 0.4, min: 0, max: 1, step: 0.01 },
		{
			kind: "number",
			id: "waveXShift",
			label: "Wave X shift",
			default: 0.2,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{ kind: "number", id: "waveY", label: "Wave Y", default: 0.4, min: 0, max: 1, step: 0.01 },
		{
			kind: "number",
			id: "waveYShift",
			label: "Wave Y shift",
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{ kind: "number", id: "mixing", label: "Mixing", default: 0.5, min: 0, max: 1, step: 0.01 },
		{
			kind: "number",
			id: "grainMixer",
			label: "Grain mix",
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "grainOverlay",
			label: "Grain overlay",
			default: 0.15,
			min: 0,
			max: 1,
			step: 0.01,
		},
	],
	build: ({ palette, values, width, height }) => {
		const u: ShaderMountUniforms = {
			u_colors: colorsVec(palette, 4),
			u_colorsCount: 4,
			u_positions: paramValue(staticMeshGradient.params[0], values),
			u_waveX: paramValue(staticMeshGradient.params[1], values),
			u_waveXShift: paramValue(staticMeshGradient.params[2], values),
			u_waveY: paramValue(staticMeshGradient.params[3], values),
			u_waveYShift: paramValue(staticMeshGradient.params[4], values),
			u_mixing: paramValue(staticMeshGradient.params[5], values),
			u_grainMixer: paramValue(staticMeshGradient.params[6], values),
			u_grainOverlay: paramValue(staticMeshGradient.params[7], values),
		};
		withSizing(u, width, height, staticMeshGradient.scale);
		return {
			fragment: staticMeshGradientFragmentShader,
			uniforms: u,
			webgl: OPAQUE_WEBGL,
			speed: 0,
		};
	},
};

const meshGradient: ShaderDefinition = {
	label: "Mesh Gradient",
	colorCount: 4,
	usesBackground: false,
	animated: true,
	scale: 1.15,
	params: [
		{
			kind: "number",
			id: "distortion",
			label: "Distortion",
			default: 0.75,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{ kind: "number", id: "swirl", label: "Swirl", default: 0.55, min: 0, max: 1, step: 0.01 },
		{
			kind: "number",
			id: "grainMixer",
			label: "Grain mix",
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "grainOverlay",
			label: "Grain overlay",
			default: 0.18,
			min: 0,
			max: 1,
			step: 0.01,
		},
	],
	build: ({ palette, values, width, height }) => {
		const u: ShaderMountUniforms = {
			u_colors: colorsVec(palette, 4),
			u_colorsCount: 4,
			u_distortion: paramValue(meshGradient.params[0], values),
			u_swirl: paramValue(meshGradient.params[1], values),
			u_grainMixer: paramValue(meshGradient.params[2], values),
			u_grainOverlay: paramValue(meshGradient.params[3], values),
		};
		withSizing(u, width, height, meshGradient.scale);
		return { fragment: meshGradientFragmentShader, uniforms: u, webgl: OPAQUE_WEBGL, speed: 0 };
	},
};

const warp: ShaderDefinition = {
	label: "Warp",
	colorCount: 4,
	usesBackground: false,
	animated: true,
	scale: 1.1,
	params: [
		{
			kind: "enum",
			id: "shape",
			label: "Pattern",
			default: WarpPatterns.edge,
			options: WARP_SHAPE_ENUM,
		},
		{
			kind: "number",
			id: "proportion",
			label: "Proportion",
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "softness",
			label: "Softness",
			default: 0.85,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "shapeScale",
			label: "Shape scale",
			default: 0.35,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "distortion",
			label: "Distortion",
			default: 0.6,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{ kind: "number", id: "swirl", label: "Swirl", default: 0.7, min: 0, max: 1, step: 0.01 },
		{
			kind: "number",
			id: "swirlIterations",
			label: "Swirl iters",
			default: 8,
			min: 0,
			max: 20,
			step: 1,
		},
	],
	build: ({ palette, values, width, height, noise }) => {
		const u: ShaderMountUniforms = {
			u_colors: colorsVec(palette, 4),
			u_colorsCount: 4,
			u_shape: paramValue(warp.params[0], values),
			u_proportion: paramValue(warp.params[1], values),
			u_softness: paramValue(warp.params[2], values),
			u_shapeScale: paramValue(warp.params[3], values),
			u_distortion: paramValue(warp.params[4], values),
			u_swirl: paramValue(warp.params[5], values),
			u_swirlIterations: paramValue(warp.params[6], values),
			u_noiseTexture: noise,
		};
		withSizing(u, width, height, warp.scale);
		return { fragment: warpFragmentShader, uniforms: u, webgl: OPAQUE_WEBGL, speed: 0 };
	},
};

const waves: ShaderDefinition = {
	label: "Waves",
	colorCount: 1,
	usesBackground: true,
	animated: false,
	scale: 1.0,
	params: [
		{ kind: "enum", id: "shape", label: "Shape", default: 1, options: WAVES_SHAPE_ENUM },
		{
			kind: "number",
			id: "frequency",
			label: "Frequency",
			default: 0.6,
			min: 0,
			max: 2,
			step: 0.01,
		},
		{
			kind: "number",
			id: "amplitude",
			label: "Amplitude",
			default: 0.45,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{ kind: "number", id: "spacing", label: "Spacing", default: 0.8, min: 0, max: 2, step: 0.01 },
		{
			kind: "number",
			id: "proportion",
			label: "Proportion",
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{ kind: "number", id: "softness", label: "Softness", default: 0.9, min: 0, max: 1, step: 0.01 },
	],
	build: ({ palette, values, width, height }) => {
		const colors = colorsVec(palette, 1);
		const u: ShaderMountUniforms = {
			u_colorFront: colors[0],
			u_colorBack: getShaderColorFromString(palette.background),
			u_shape: paramValue(waves.params[0], values),
			u_frequency: paramValue(waves.params[1], values),
			u_amplitude: paramValue(waves.params[2], values),
			u_spacing: paramValue(waves.params[3], values),
			u_proportion: paramValue(waves.params[4], values),
			u_softness: paramValue(waves.params[5], values),
		};
		withSizing(u, width, height, waves.scale);
		return { fragment: wavesFragmentShader, uniforms: u, webgl: OPAQUE_WEBGL, speed: 0 };
	},
};

const colorPanels: ShaderDefinition = {
	label: "Color Panels",
	colorCount: 4,
	usesBackground: true,
	animated: true,
	scale: 1.0,
	params: [
		{ kind: "number", id: "angle1", label: "Angle 1", default: 0.4, min: 0, max: 1, step: 0.01 },
		{ kind: "number", id: "angle2", label: "Angle 2", default: 0.7, min: 0, max: 1, step: 0.01 },
		{ kind: "number", id: "length", label: "Length", default: 1.6, min: 0, max: 4, step: 0.05 },
		{ kind: "bool", id: "edges", label: "Edges", default: 1 },
		{ kind: "number", id: "blur", label: "Blur", default: 0.35, min: 0, max: 1, step: 0.01 },
		{ kind: "number", id: "fadeIn", label: "Fade in", default: 0.4, min: 0, max: 1, step: 0.01 },
		{ kind: "number", id: "fadeOut", label: "Fade out", default: 0.6, min: 0, max: 1, step: 0.01 },
		{ kind: "number", id: "density", label: "Density", default: 0.8, min: 0, max: 1, step: 0.01 },
		{ kind: "number", id: "gradient", label: "Gradient", default: 0.6, min: 0, max: 1, step: 0.01 },
	],
	build: ({ palette, values, width, height }) => {
		const u: ShaderMountUniforms = {
			u_colors: colorsVec(palette, 4),
			u_colorsCount: 4,
			u_colorBack: getShaderColorFromString(palette.background),
			u_angle1: paramValue(colorPanels.params[0], values),
			u_angle2: paramValue(colorPanels.params[1], values),
			u_length: paramValue(colorPanels.params[2], values),
			u_edges: paramValue(colorPanels.params[3], values) > 0.5,
			u_blur: paramValue(colorPanels.params[4], values),
			u_fadeIn: paramValue(colorPanels.params[5], values),
			u_fadeOut: paramValue(colorPanels.params[6], values),
			u_density: paramValue(colorPanels.params[7], values),
			u_gradient: paramValue(colorPanels.params[8], values),
		};
		withSizing(u, width, height, colorPanels.scale);
		return { fragment: colorPanelsFragmentShader, uniforms: u, webgl: OPAQUE_WEBGL, speed: 0 };
	},
};

const neuroNoise: ShaderDefinition = {
	label: "Neuro Noise",
	colorCount: 2,
	usesBackground: true,
	animated: true,
	scale: 1.0,
	params: [
		{
			kind: "number",
			id: "brightness",
			label: "Brightness",
			default: 1.1,
			min: 0,
			max: 2,
			step: 0.01,
		},
		{
			kind: "number",
			id: "contrast",
			label: "Contrast",
			default: 0.75,
			min: 0,
			max: 2,
			step: 0.01,
		},
	],
	build: ({ palette, values, width, height }) => {
		const colors = colorsVec(palette, 2);
		const u: ShaderMountUniforms = {
			u_colorFront: colors[0],
			u_colorMid: colors[1],
			u_colorBack: getShaderColorFromString(palette.background),
			u_brightness: paramValue(neuroNoise.params[0], values),
			u_contrast: paramValue(neuroNoise.params[1], values),
		};
		withSizing(u, width, height, neuroNoise.scale);
		return { fragment: neuroNoiseFragmentShader, uniforms: u, webgl: OPAQUE_WEBGL, speed: 0 };
	},
};

const perlinNoise: ShaderDefinition = {
	label: "Perlin Noise",
	colorCount: 1,
	usesBackground: true,
	animated: true,
	scale: 1.0,
	params: [
		{
			kind: "number",
			id: "proportion",
			label: "Proportion",
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{ kind: "number", id: "softness", label: "Softness", default: 0.9, min: 0, max: 1, step: 0.01 },
		{ kind: "number", id: "octaveCount", label: "Octaves", default: 5, min: 1, max: 8, step: 1 },
		{
			kind: "number",
			id: "persistence",
			label: "Persistence",
			default: 0.55,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "lacunarity",
			label: "Lacunarity",
			default: 2.2,
			min: 0,
			max: 4,
			step: 0.05,
		},
	],
	build: ({ palette, values, width, height }) => {
		const colors = colorsVec(palette, 1);
		const u: ShaderMountUniforms = {
			u_colorFront: colors[0],
			u_colorBack: getShaderColorFromString(palette.background),
			u_proportion: paramValue(perlinNoise.params[0], values),
			u_softness: paramValue(perlinNoise.params[1], values),
			u_octaveCount: paramValue(perlinNoise.params[2], values),
			u_persistence: paramValue(perlinNoise.params[3], values),
			u_lacunarity: paramValue(perlinNoise.params[4], values),
		};
		withSizing(u, width, height, perlinNoise.scale);
		return { fragment: perlinNoiseFragmentShader, uniforms: u, webgl: OPAQUE_WEBGL, speed: 0 };
	},
};

const smokeRing: ShaderDefinition = {
	label: "Smoke Ring",
	colorCount: 4,
	usesBackground: true,
	animated: true,
	scale: 1.0,
	params: [
		{
			kind: "number",
			id: "noiseScale",
			label: "Noise scale",
			default: 1.2,
			min: 0,
			max: 3,
			step: 0.01,
		},
		{
			kind: "number",
			id: "thickness",
			label: "Thickness",
			default: 0.35,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{ kind: "number", id: "radius", label: "Radius", default: 0.55, min: 0, max: 1, step: 0.01 },
		{
			kind: "number",
			id: "innerShape",
			label: "Inner shape",
			default: 1,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "noiseIterations",
			label: "Iterations",
			default: 4,
			min: 1,
			max: 8,
			step: 1,
		},
	],
	build: ({ palette, values, width, height, noise }) => {
		const u: ShaderMountUniforms = {
			u_colorBack: getShaderColorFromString(palette.background),
			u_colors: colorsVec(palette, 4),
			u_colorsCount: 4,
			u_noiseScale: paramValue(smokeRing.params[0], values),
			u_thickness: paramValue(smokeRing.params[1], values),
			u_radius: paramValue(smokeRing.params[2], values),
			u_innerShape: paramValue(smokeRing.params[3], values),
			u_noiseIterations: paramValue(smokeRing.params[4], values),
			u_noiseTexture: noise,
		};
		withSizing(u, width, height, smokeRing.scale);
		return { fragment: smokeRingFragmentShader, uniforms: u, webgl: OPAQUE_WEBGL, speed: 0 };
	},
};

const spiral: ShaderDefinition = {
	label: "Spiral",
	colorCount: 1,
	usesBackground: true,
	animated: true,
	scale: 1.0,
	params: [
		{ kind: "number", id: "density", label: "Density", default: 0.45, min: 0, max: 1, step: 0.01 },
		{
			kind: "number",
			id: "distortion",
			label: "Distortion",
			default: 0.35,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "strokeWidth",
			label: "Stroke width",
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "strokeTaper",
			label: "Stroke taper",
			default: 0.4,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{
			kind: "number",
			id: "strokeCap",
			label: "Stroke cap",
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01,
		},
		{ kind: "number", id: "noise", label: "Noise", default: 0.35, min: 0, max: 1, step: 0.01 },
		{
			kind: "number",
			id: "noiseFrequency",
			label: "Noise freq",
			default: 2.2,
			min: 0,
			max: 5,
			step: 0.05,
		},
		{
			kind: "number",
			id: "softness",
			label: "Softness",
			default: 0.85,
			min: 0,
			max: 1,
			step: 0.01,
		},
	],
	build: ({ palette, values, width, height }) => {
		const colors = colorsVec(palette, 1);
		const u: ShaderMountUniforms = {
			u_colorBack: getShaderColorFromString(palette.background),
			u_colorFront: colors[0],
			u_density: paramValue(spiral.params[0], values),
			u_distortion: paramValue(spiral.params[1], values),
			u_strokeWidth: paramValue(spiral.params[2], values),
			u_strokeTaper: paramValue(spiral.params[3], values),
			u_strokeCap: paramValue(spiral.params[4], values),
			u_noise: paramValue(spiral.params[5], values),
			u_noiseFrequency: paramValue(spiral.params[6], values),
			u_softness: paramValue(spiral.params[7], values),
		};
		withSizing(u, width, height, spiral.scale);
		return { fragment: spiralFragmentShader, uniforms: u, webgl: OPAQUE_WEBGL, speed: 0 };
	},
};

export const SHADER_DEFINITIONS: Record<ShaderKind, ShaderDefinition> = {
	grainGradient,
	staticMeshGradient,
	meshGradient,
	warp,
	waves,
	colorPanels,
	neuroNoise,
	perlinNoise,
	smokeRing,
	spiral,
};

export function buildShader(
	kind: ShaderKind,
	palette: ShaderPalette,
	values: ShaderParamValues,
	speed: number,
	width: number,
	height: number,
	noiseTexture: HTMLImageElement | null
): ShaderOption {
	const def = SHADER_DEFINITIONS[kind];
	const option = def.build({
		palette,
		values,
		width,
		height,
		noise: noiseTexture ?? undefined,
		speed,
	});
	option.speed = def.animated ? speed : 0;
	return option;
}
