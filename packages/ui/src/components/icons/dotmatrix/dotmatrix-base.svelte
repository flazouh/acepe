<script lang="ts">
	import { cn } from "../../../lib/utils";
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
		type DotAnimationResolver,
		type DotMatrixColorPreset,
		type DotMatrixPhase,
		type DotShape,
		type MatrixPattern,
	} from "./dotmatrix-core.js";
	import "./dotmatrix-loader.css";

	interface Props {
		class?: string;
		style?: string;
		role?: string;
		"aria-label"?: string;
		size?: number;
		dotSize?: number;
		color?: string;
		colorPreset?: DotMatrixColorPreset;
		speed?: number;
		pattern?: MatrixPattern;
		dotShape?: DotShape;
		muted?: boolean;
		bloom?: boolean;
		halo?: number;
		dotClassName?: string;
		phase?: DotMatrixPhase;
		reducedMotion?: boolean;
		animationResolver: DotAnimationResolver;
		opacityBase?: number;
		opacityMid?: number;
		opacityPeak?: number;
		cellPadding?: number;
		boxSize?: number;
		minSize?: number;
		onMouseEnter?: () => void;
		onMouseLeave?: () => void;
	}

	let {
		class: className = "",
		style: styleAttr = "",
		role = "status",
		"aria-label": ariaLabel = "Loading",
		size = 24,
		dotSize = 3,
		color = "currentColor",
		colorPreset = undefined,
		speed = 1,
		pattern = "diamond",
		dotShape = "circle",
		muted = false,
		bloom = false,
		halo = 0,
		dotClassName = undefined,
		phase = "loadingRipple",
		reducedMotion = false,
		animationResolver,
		opacityBase = undefined,
		opacityMid = undefined,
		opacityPeak = undefined,
		cellPadding = undefined,
		boxSize = undefined,
		minSize = undefined,
		onMouseEnter = undefined,
		onMouseLeave = undefined,
	}: Props = $props();

	const patternIndexes = $derived(new Set(getPatternIndexes(pattern)));
	const safeSpeed = $derived(speed > 0 ? speed : 1);
	const speedScale = $derived(1 / safeSpeed);
	const layout = $derived(getMatrix5Layout(size, dotSize, cellPadding));
	const boxLayout = $derived(resolveDmxBoxOuterDim({ boxSize, minSize }));
	const scale = $derived(
		boxLayout.useWrapper && layout.matrixSpan > 0
			? boxLayout.outerDim / layout.matrixSpan
			: 1,
	);
	const center = Math.floor(MATRIX_SIZE / 2);
	const ob = $derived(clamp01Dmx(opacityBase));
	const om = $derived(clamp01Dmx(opacityMid));
	const op = $derived(clamp01Dmx(opacityPeak));
	const unit = $derived(dotSize + layout.gap);
	const colorTokens = $derived(resolveDmxColorTokens(color, colorPreset));

	const dmxVarStyle = $derived.by(() => {
		const styleParts: string[] = [
			`width:${layout.matrixSpan}px`,
			`height:${layout.matrixSpan}px`,
			`--dmx-speed:${speedScale}`,
			`--dmx-dot-size:${dotSize}px`,
			`--dmx-halo-level:${halo}`,
			`--dmx-dot-fill:${colorTokens.dotFill}`,
			`color:${colorTokens.resolvedColor}`,
		];
		if (ob !== undefined) {
			styleParts.push(`--dmx-opacity-base:${ob}`);
		}
		if (om !== undefined) {
			styleParts.push(`--dmx-opacity-mid:${om}`);
		}
		if (op !== undefined) {
			styleParts.push(`--dmx-opacity-peak:${op}`);
		}
		if (boxLayout.useWrapper) {
			styleParts.push(`transform:scale(${scale})`, "transform-origin:center center");
		} else if (minSize !== undefined) {
			styleParts.push(`min-width:${minSize}px`, `min-height:${minSize}px`);
		}
		if (styleAttr.length > 0) {
			styleParts.push(styleAttr);
		}
		return styleParts.join(";");
	});

	function dotPartsForIndex(index: number): { className: string; style: string } {
		const { row, col } = indexToCoord(index);
		const isActive = patternIndexes.has(index);
		const distance = distanceFromCenter(index);
		const angle = polarAngle(index);
		const radiusNormalizedValue = normalizedRadius(index);
		const manhattan = manhattanDistance(index);
		const deltaX = (col - center) * unit;
		const deltaY = (row - center) * unit;

		const animationState = animationResolver({
			index,
			row,
			col,
			distanceFromCenter: distance,
			angleFromCenter: angle,
			radiusNormalized: radiusNormalizedValue,
			manhattanDistance: manhattan,
			phase,
			isActive,
			reducedMotion,
		});

		const styleParts: string[] = [
			`width:${dotSize}px`,
			`height:${dotSize}px`,
			`--dmx-distance:${distance}`,
			`--dmx-row:${row}`,
			`--dmx-col:${col}`,
			`--dmx-x:${deltaX}px`,
			`--dmx-y:${deltaY}px`,
			`--dmx-angle:${angle}`,
			`--dmx-radius:${radiusNormalizedValue}`,
			`--dmx-manhattan:${manhattan}`,
		];

		let bloomDot = false;
		if (animationState.style) {
			for (const [key, value] of Object.entries(animationState.style)) {
				if (value === undefined) {
					continue;
				}
				if (key === "opacity" && typeof value === "number") {
					const remappedOpacity = remapOpacityToTriplet(value, ob, om, op);
					styleParts.push(`opacity:${remappedOpacity}`);
					const parts = dmxDotBloomParts(true, value, bloom, halo, ob, om, op);
					styleParts.push(`--dmx-bloom-level:${parts.level}`);
					bloomDot = parts.bloomDot;
				} else {
					styleParts.push(`${key}:${String(value)}`);
				}
			}
		} else if (isActive) {
			const parts = dmxDotBloomParts(true, 0, bloom, halo, ob, om, op);
			if (parts.level > 0) {
				styleParts.push(`--dmx-bloom-level:${parts.level}`);
			}
			bloomDot = parts.bloomDot;
		}

		if (!isActive) {
			styleParts.push("opacity:0", "visibility:hidden", "pointer-events:none", "animation:none");
		}

		return {
			className: cx(
				"dmx-dot",
				!isActive && "dmx-inactive",
				bloomDot && "dmx-bloom-dot",
				dotClassName,
				animationState.className,
			),
			style: styleParts.join(";"),
		};
	}
	const dotCells = Array.from({ length: MATRIX_SIZE * MATRIX_SIZE }, (_, index) => index);
</script>

{#if boxLayout.useWrapper}
	<div
		{role}
		aria-live="polite"
		aria-label={ariaLabel}
		class={cn("dmx-outer", className)}
		style={`width:${boxLayout.outerDim}px;height:${boxLayout.outerDim}px;`}
		onmouseenter={onMouseEnter}
		onmouseleave={onMouseLeave}
	>
		<div
			class={cx(
				"dmx-root",
				`dmx-dot-shape-${dotShape}`,
				muted && "dmx-muted",
				dmxBloomRootActive(bloom, halo) && "dmx-bloom",
				dmxBloomHaloSpreadClass(halo),
			)}
			style={dmxVarStyle}
		>
			<div class="dmx-grid" style={`gap:${layout.gap}px`}>
				{#each dotCells as index (index)}
					{@const dot = dotPartsForIndex(index)}
					<span aria-hidden="true" class={dot.className} style={dot.style}></span>
				{/each}
			</div>
		</div>
	</div>
{:else}
	<div
		{role}
		aria-live="polite"
		aria-label={ariaLabel}
		class={cn(
			"dmx-root",
			`dmx-dot-shape-${dotShape}`,
			muted && "dmx-muted",
			dmxBloomRootActive(bloom, halo) && "dmx-bloom",
			dmxBloomHaloSpreadClass(halo),
			className,
		)}
		style={dmxVarStyle}
		onmouseenter={onMouseEnter}
		onmouseleave={onMouseLeave}
	>
		<div class="dmx-grid" style={`gap:${layout.gap}px`}>
			{#each dotCells as index (index)}
				{@const dot = dotPartsForIndex(index)}
				<span aria-hidden="true" class={dot.className} style={dot.style}></span>
			{/each}
		</div>
	</div>
{/if}
