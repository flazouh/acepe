import type {
	DmxStyleProperties,
	DotAnimationContext,
	DotAnimationResolver,
	DotMatrixPhase,
	DotShape,
	MatrixPattern,
} from "./dotmatrix-core.js";
import {
	MATRIX_SIZE,
	clamp01Dmx,
	cx,
	distanceFromCenter,
	dmxBloomHaloSpreadClass,
	dmxBloomRootActive,
	dmxDotBloomParts,
	getMatrix5Layout,
	getPatternIndexes,
	indexToCoord,
	manhattanDistance,
	normalizedRadius,
	polarAngle,
	remapOpacityToTriplet,
	resolveDmxBoxOuterDim,
	resolveDmxColorTokens,
} from "./dotmatrix-core.js";
import type { DotMatrixColorPreset } from "./dotmatrix-core.js";

export interface DotmatrixBaseDot {
	index: number;
	className: string;
	style: DmxStyleProperties;
}

export interface DotmatrixBaseViewModel {
	rootClassName: string;
	rootStyle: DmxStyleProperties;
	gridGap: number;
	dots: DotmatrixBaseDot[];
	useWrapper: boolean;
	wrapperStyle: DmxStyleProperties | null;
	wrapperClassName: string;
}

export interface BuildDotmatrixBaseOptions {
	size: number;
	dotSize: number;
	color: string;
	colorPreset?: DotMatrixColorPreset;
	speed: number;
	pattern: MatrixPattern;
	dotShape: DotShape;
	muted: boolean;
	bloom: boolean;
	halo: number;
	phase: DotMatrixPhase;
	reducedMotion: boolean;
	animationResolver: DotAnimationResolver;
	opacityBase?: number;
	opacityMid?: number;
	opacityPeak?: number;
	cellPadding?: number;
	boxSize?: number;
	minSize?: number;
	dotClassName?: string;
	className?: string;
}

function mergeStyle(
	base: DmxStyleProperties,
	patch: DmxStyleProperties | undefined
): DmxStyleProperties {
	if (!patch) {
		return base;
	}
	const merged: DmxStyleProperties = {};
	for (const key of Object.keys(base)) {
		merged[key] = base[key];
	}
	for (const key of Object.keys(patch)) {
		merged[key] = patch[key];
	}
	return merged;
}

function styleToString(style: DmxStyleProperties): string {
	const parts: string[] = [];
	for (const key of Object.keys(style)) {
		const value = style[key];
		if (value === undefined) {
			continue;
		}
		const cssKey = key.startsWith("--") ? key : key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
		parts.push(`${cssKey}:${value}`);
	}
	return parts.join(";");
}

export { styleToString as dotmatrixStyleToString };

export function buildDotmatrixBaseViewModel(options: BuildDotmatrixBaseOptions): DotmatrixBaseViewModel {
	const patternIndexes = new Set(getPatternIndexes(options.pattern));
	const safeSpeed = options.speed > 0 ? options.speed : 1;
	const speedScale = 1 / safeSpeed;
	const layout = getMatrix5Layout(options.size, options.dotSize, options.cellPadding);
	const box = resolveDmxBoxOuterDim({ boxSize: options.boxSize, minSize: options.minSize });
	const scale = box.useWrapper && layout.matrixSpan > 0 ? box.outerDim / layout.matrixSpan : 1;
	const center = Math.floor(MATRIX_SIZE / 2);
	const ob = clamp01Dmx(options.opacityBase);
	const om = clamp01Dmx(options.opacityMid);
	const op = clamp01Dmx(options.opacityPeak);
	const unit = options.dotSize + layout.gap;
	const tokens = resolveDmxColorTokens(options.color, options.colorPreset);

	const rootStyle: DmxStyleProperties = {
		width: layout.matrixSpan,
		height: layout.matrixSpan,
		"--dmx-speed": speedScale,
		"--dmx-dot-size": `${options.dotSize}px`,
		"--dmx-halo-level": options.halo,
		"--dmx-dot-fill": tokens.dotFill,
		color: tokens.resolvedColor,
	};
	if (ob !== undefined) {
		rootStyle["--dmx-opacity-base"] = ob;
	}
	if (om !== undefined) {
		rootStyle["--dmx-opacity-mid"] = om;
	}
	if (op !== undefined) {
		rootStyle["--dmx-opacity-peak"] = op;
	}
	if (box.useWrapper) {
		rootStyle.transform = `scale(${scale})`;
		rootStyle.transformOrigin = "center center";
	} else if (options.minSize !== undefined) {
		rootStyle.minWidth = options.minSize;
		rootStyle.minHeight = options.minSize;
	}

	const dots: DotmatrixBaseDot[] = [];
	for (let index = 0; index < MATRIX_SIZE * MATRIX_SIZE; index += 1) {
		const coord = indexToCoord(index);
		const row = coord.row;
		const col = coord.col;
		const isActive = patternIndexes.has(index);
		const ctx: DotAnimationContext = {
			index,
			row,
			col,
			distanceFromCenter: distanceFromCenter(index),
			angleFromCenter: polarAngle(index),
			radiusNormalized: normalizedRadius(index),
			manhattanDistance: manhattanDistance(index),
			phase: options.phase,
			isActive,
			reducedMotion: options.reducedMotion,
		};

		const animationState = options.animationResolver(ctx);
		let stylePatch: DmxStyleProperties | undefined = animationState.style
			? mergeStyle({}, animationState.style)
			: undefined;
		let isBloomDot = false;

		if (isActive) {
			const rawOpacity = stylePatch?.opacity;
			if (stylePatch !== undefined && typeof rawOpacity === "number") {
				const remappedOpacity = remapOpacityToTriplet(rawOpacity, ob, om, op);
				stylePatch = mergeStyle(stylePatch, { opacity: remappedOpacity });
				const parts = dmxDotBloomParts(true, rawOpacity, options.bloom, options.halo, ob, om, op);
				stylePatch = mergeStyle(stylePatch, { "--dmx-bloom-level": parts.level });
				isBloomDot = parts.bloomDot;
			} else {
				const parts = dmxDotBloomParts(true, 0, options.bloom, options.halo, ob, om, op);
				if (parts.level > 0) {
					stylePatch = mergeStyle(stylePatch ?? {}, { "--dmx-bloom-level": parts.level });
				}
				isBloomDot = parts.bloomDot;
			}
		}

		const deltaX = (col - center) * unit;
		const deltaY = (row - center) * unit;
		let dotStyle: DmxStyleProperties = {
			width: options.dotSize,
			height: options.dotSize,
			"--dmx-distance": ctx.distanceFromCenter,
			"--dmx-row": row,
			"--dmx-col": col,
			"--dmx-x": `${deltaX}px`,
			"--dmx-y": `${deltaY}px`,
			"--dmx-angle": ctx.angleFromCenter,
			"--dmx-radius": ctx.radiusNormalized,
			"--dmx-manhattan": ctx.manhattanDistance,
		};
		dotStyle = mergeStyle(dotStyle, stylePatch);

		if (!isActive) {
			dotStyle = mergeStyle(dotStyle, {
				opacity: 0,
				visibility: "hidden",
				pointerEvents: "none",
				animation: "none",
			});
		}

		dots.push({
			index,
			className: cx(
				"dmx-dot",
				!isActive && "dmx-inactive",
				isBloomDot && "dmx-bloom-dot",
				options.dotClassName,
				animationState.className
			),
			style: dotStyle,
		});
	}

	const rootClassName = cx(
		"dmx-root",
		`dmx-dot-shape-${options.dotShape}`,
		options.muted && "dmx-muted",
		dmxBloomRootActive(options.bloom, options.halo) && "dmx-bloom",
		dmxBloomHaloSpreadClass(options.halo),
		!box.useWrapper && options.className
	);

	const wrapperStyle = box.useWrapper
		? {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: box.outerDim,
				height: box.outerDim,
				minWidth: options.minSize,
				minHeight: options.minSize,
				overflow: "hidden",
			}
		: null;

	return {
		rootClassName,
		rootStyle,
		gridGap: layout.gap,
		dots,
		useWrapper: box.useWrapper,
		wrapperStyle,
		wrapperClassName: options.className ?? "",
	};
}
