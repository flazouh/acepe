export { default as DotMatrixBase } from "./dotmatrix-base.svelte";

export {
	buildDotmatrixBaseViewModel,
	dotmatrixStyleToString,
} from "./dotmatrix-base-logic.js";

export type {
	BuildDotmatrixBaseOptions,
	DotmatrixBaseDot,
	DotmatrixBaseViewModel,
} from "./dotmatrix-base-logic.js";

export {
	MATRIX_SIZE,
	FULL_INDEXES,
	DIAMOND_INDEXES,
	OUTLINE_INDEXES,
	CROSS_INDEXES,
	RINGS_INDEXES,
	ROSE_INDEXES,
	DMX_BLOOM_OPACITY_MIN,
	createPathWaveResolver,
	buildDotMatrixRootStyle,
	dotMatrixRootClassNames,
	renderDotCell,
	cx,
	getPatternIndexes,
	rowMajorIndex,
	indexToCoord,
	distanceFromCenter,
	rowDistance,
	polarAngle,
	normalizedRadius,
	manhattanDistance,
	harmonicPhase,
	lissajousOffset,
	spiralOffset,
	isPrime,
	trBlPathNormFromIndex,
	snakePathNormFromIndex,
	snakePathOrderValue,
	spiralInwardNormFromIndex,
	spiralInwardOrderValue,
	outerRingClockwiseOrderValue,
	outerRingClockwiseNormFromIndex,
	middleRingAntiClockwiseOrderValue,
	middleRingAntiClockwiseNormFromIndex,
	diagonalSnakeOrderValue,
	diagonalSnakeNormFromIndex,
	rowWaveOrderValue,
	rowWaveNormFromIndex,
	colWaveNormFromIndex,
	concentricRingNormFromIndex,
	isWithinCircularMask,
	stylePx,
	styleOpacity,
	remapOpacityToTriplet,
	opacityToBloomLevel,
	remappedOpacityQualifiesForBloom,
	dmxBloomRootActive,
	dmxBloomHaloSpreadClass,
	dmxDotBloomParts,
	resolveDmxColorTokens,
	getMatrix5Layout,
	resolveDmxBoxOuterDim,
	clamp01Dmx,
} from "./dotmatrix-core.js";

export type {
	MatrixPattern,
	DotShape,
	DotMatrixPhase,
	DotMatrixColorPreset,
	DotMatrixCommonProps,
	DotAnimationContext,
	DotAnimationState,
	DotAnimationResolver,
	DmxStyleProperties,
	DotMatrixBaseRenderInput,
	DotCellRenderOutput,
} from "./dotmatrix-core.js";

export {
	usePrefersReducedMotion,
	useCyclePhase,
	useSteppedCycle,
	useDotMatrixPhases,
} from "./dotmatrix-hooks.svelte.js";

export type {
	UseCyclePhaseOptions,
	UseSteppedCycleOptions,
	UseDotMatrixPhasesOptions,
	DotMatrixPhasesResult,
} from "./dotmatrix-hooks.svelte.js";

export {
	DOTMATRIX_REGISTRY_MANIFEST,
	type DotmatrixRegistryId,
} from "./dotmatrix-registry.js";
