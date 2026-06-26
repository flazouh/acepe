<!--
  Ported from @dotmatrix/dotm-hex-1..10
  (https://dotmatrix.zzzzshawn.cloud/r/dotm-hex-1.json through dotm-hex-10.json).
  Accepts registry ids (dotm-hex-2) and legacy Acepe ids (prism-bloom).
  The original React loaders compute a phase in JS. This Svelte port samples the same
  opacity formulas into SVG opacity animations, so the icon stays app-wide and lightweight.
-->
<script lang="ts">
	import { cn } from "../../lib/utils";
	import { LEGACY_LOADER_ID_MAP } from "./loading-icon-preferences.svelte.js";
	import type { DotmHexLoaderVariant } from "./dotmatrix/dotmatrix-loader-routing.js";

	type HexSpinnerInput = DotmHexLoaderVariant | keyof typeof LEGACY_LOADER_ID_MAP;

	interface Props {
		class?: string;
		style?: string;
		role?: string;
		"aria-label"?: string;
		size?: number;
		dotSize?: number;
		color?: string;
		animated?: boolean;
		speed?: number;
		variant?: HexSpinnerInput;
	}

	interface HexPoint {
		x: number;
		y: number;
		angle: number;
		radius: number;
	}

	interface HexCell {
		row: number;
		col: number;
		key: string;
		cx: number;
		cy: number;
	}

	type FrameMark = "x" | "o";
	type HexFrame = Readonly<Record<string, FrameMark>>;

	let {
		class: className = "",
		style: styleAttr = "",
		role = undefined,
		"aria-label": ariaLabel = undefined,
		size = 24,
		dotSize = 2.55,
		color = "#bf8700",
		animated = true,
		speed = undefined,
		variant = "dotm-hex-2",
	}: Props = $props();

	function resolveHexVariant(input: HexSpinnerInput): DotmHexLoaderVariant {
		const legacyMatch = LEGACY_LOADER_ID_MAP[input];
		if (legacyMatch !== undefined && legacyMatch.startsWith("dotm-hex-")) {
			return legacyMatch as DotmHexLoaderVariant;
		}
		return input as DotmHexLoaderVariant;
	}

	const resolvedVariant = $derived(resolveHexVariant(variant));

	const ROW_COUNTS = [3, 4, 5, 4, 3] as const;
	const HEX_ORBIT_BASE_OPACITY = 0.1;
	const HEX_ORBIT_MID_OPACITY = 0.2;
	const HEX_ORBIT_HIGH_OPACITY = 0.96;
	const HEX_ORBIT_CENTER_OPACITY = 0.1;
	const HEX_ORBIT_TRAIL_SPAN = 5;
	const HEX_ORBIT_PERIMETER_PATH = [
		"0,0",
		"0,1",
		"0,2",
		"1,3",
		"2,4",
		"3,3",
		"4,2",
		"4,1",
		"4,0",
		"3,0",
		"2,0",
		"1,0",
	] as const;
	const HEX_ORBIT_PATH_LEN = HEX_ORBIT_PERIMETER_PATH.length;
	const HEX_ORBIT_HALF_PATH = HEX_ORBIT_PATH_LEN / 2;
	const HEX_ROW_PITCH_RATIO = Math.sqrt(3) / 2;
	const SAMPLE_COUNT = 24;
	const TWO_PI = Math.PI * 2;
	const HOURGLASS_FRAMES: readonly HexFrame[] = [
		{
			"0,0": "x",
			"0,1": "x",
			"0,2": "x",
			"1,1": "o",
			"1,2": "o",
			"2,2": "x",
			"3,1": "o",
			"3,2": "o",
			"4,0": "x",
			"4,1": "x",
			"4,2": "x",
		},
		{
			"0,1": "o",
			"1,0": "x",
			"1,1": "x",
			"1,2": "x",
			"1,3": "x",
			"2,2": "o",
			"3,0": "x",
			"3,1": "x",
			"3,2": "x",
			"3,3": "x",
			"4,1": "o",
		},
		{
			"0,1": "x",
			"1,1": "x",
			"1,2": "x",
			"2,0": "o",
			"2,1": "x",
			"2,2": "x",
			"2,3": "x",
			"2,4": "o",
			"3,1": "x",
			"3,2": "x",
			"4,1": "x",
		},
		{
			"0,0": "o",
			"0,2": "o",
			"1,0": "x",
			"1,3": "x",
			"2,1": "x",
			"2,2": "o",
			"2,3": "x",
			"3,0": "x",
			"3,3": "x",
			"4,0": "o",
			"4,2": "o",
		},
	];
	const GLYPH_FRAMES: readonly HexFrame[] = [
		{
			"0,1": "x",
			"1,1": "o",
			"1,2": "o",
			"2,0": "x",
			"2,2": "x",
			"2,4": "x",
			"3,1": "o",
			"3,2": "o",
			"4,1": "x",
		},
		{
			"0,0": "x",
			"0,2": "x",
			"1,0": "o",
			"1,3": "o",
			"2,1": "x",
			"2,2": "o",
			"2,3": "x",
			"3,0": "o",
			"3,3": "o",
			"4,0": "x",
			"4,2": "x",
		},
		{
			"0,1": "o",
			"1,0": "x",
			"1,3": "x",
			"2,0": "o",
			"2,2": "x",
			"2,4": "o",
			"3,0": "x",
			"3,3": "x",
			"4,1": "o",
		},
		{
			"0,0": "o",
			"0,2": "o",
			"1,1": "x",
			"1,2": "x",
			"2,1": "o",
			"2,3": "o",
			"3,1": "x",
			"3,2": "x",
			"4,0": "o",
			"4,2": "o",
		},
	];
	const VERTEX_PATH = ["0,2", "1,3", "2,4", "3,3", "4,2", "3,0", "2,0", "1,0", "0,0"] as const;
	const ECHO_BY_VERTEX: Readonly<Record<(typeof VERTEX_PATH)[number], readonly string[]>> = {
		"0,2": ["0,1", "1,2"],
		"1,3": ["1,2", "2,3"],
		"2,4": ["2,3", "2,2"],
		"3,3": ["3,2", "2,3"],
		"4,2": ["4,1", "3,2"],
		"3,0": ["3,1", "2,1"],
		"2,0": ["2,1", "2,2"],
		"1,0": ["1,1", "2,1"],
		"0,0": ["0,1", "1,1"],
	};

	const isDecorative = $derived(role === undefined && ariaLabel === undefined);
	const defaultSpeed = $derived(speed ?? speedForVariant(resolvedVariant));
	const cycleMs = $derived(cycleMsForVariant(resolvedVariant) / (defaultSpeed > 0 ? defaultSpeed : 1));
	const rootStyle = $derived(`width:${size}px;height:${size}px;color:${color};${styleAttr}`.trim());
	const gap = $derived(Math.max(0.25, (size - dotSize * ROW_COUNTS[2]) / (ROW_COUNTS[2] - 1)));
	const rowGap = $derived(Math.max(0.25, (dotSize + gap) * HEX_ROW_PITCH_RATIO - dotSize));
	const matrixWidth = $derived(dotSize * ROW_COUNTS[2] + gap * (ROW_COUNTS[2] - 1));
	const matrixHeight = $derived(dotSize * ROW_COUNTS.length + rowGap * (ROW_COUNTS.length - 1));
	const offsetX = $derived((size - matrixWidth) / 2);
	const offsetY = $derived((size - matrixHeight) / 2);
	const cells = $derived.by<HexCell[]>(() => {
		const nextCells: HexCell[] = [];
		for (let row = 0; row < ROW_COUNTS.length; row += 1) {
			const count = ROW_COUNTS[row] ?? 1;
			const rowWidth = dotSize * count + gap * (count - 1);
			const rowX = offsetX + (matrixWidth - rowWidth) / 2;
			for (let col = 0; col < count; col += 1) {
				nextCells.push({
					row,
					col,
					key: `${row},${col}`,
					cx: rowX + col * (dotSize + gap) + dotSize / 2,
					cy: offsetY + row * (dotSize + rowGap) + dotSize / 2,
				});
			}
		}
		return nextCells;
	});

	function pointForCell(row: number, col: number): HexPoint {
		const count = ROW_COUNTS[row] ?? 1;
		const x = col - (count - 1) / 2;
		const y = (row - 2) * HEX_ROW_PITCH_RATIO;
		return {
			x,
			y,
			angle: Math.atan2(y, x),
			radius: Math.sqrt(x * x + y * y),
		};
	}

	function angularDistance(a: number, b: number): number {
		return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
	}

	function triangularWave(value: number): number {
		const wrapped = ((value % 1) + 1) % 1;
		return 1 - Math.abs(wrapped * 2 - 1);
	}

	function wrappedDistance(a: number, b: number, bandCount: number): number {
		const diff = Math.abs(a - b) % bandCount;
		return Math.min(diff, bandCount - diff);
	}

	function modF(value: number, modulo: number): number {
		return ((value % modulo) + modulo) % modulo;
	}

	function wavePeak(value: number): number {
		const wrapped = ((value % 1) + 1) % 1;
		return Math.max(0, 1 - Math.abs(wrapped * 2 - 1) / 0.55);
	}

	function ripple(value: number, width: number): number {
		const wrapped = ((value % 1) + 1) % 1;
		const distance = Math.min(wrapped, 1 - wrapped);
		return Math.max(0, 1 - distance / width);
	}

	function smoothstep01(edge0: number, edge1: number, x: number): number {
		if (edge1 <= edge0) {
			return x >= edge1 ? 1 : 0;
		}
		const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
		return t * t * (3 - 2 * t);
	}

	function glowAlongHexOrbitPath(head: number, pathIndex: number | null): number {
		if (pathIndex === null) {
			return HEX_ORBIT_BASE_OPACITY;
		}
		const distance = modF(head - pathIndex, HEX_ORBIT_PATH_LEN);
		const glow = 1 - smoothstep01(0, HEX_ORBIT_TRAIL_SPAN, distance);
		return HEX_ORBIT_BASE_OPACITY + glow * (HEX_ORBIT_HIGH_OPACITY - HEX_ORBIT_BASE_OPACITY);
	}

	function opacityForHexOrbitCell(row: number, col: number, phase: number): number {
		const id = `${row},${col}`;
		if (id === "2,2") {
			return HEX_ORBIT_CENTER_OPACITY;
		}
		const pathIndex = HEX_ORBIT_PERIMETER_PATH.indexOf(id as (typeof HEX_ORBIT_PERIMETER_PATH)[number]);
		const normalizedPathIndex = pathIndex === -1 ? null : pathIndex;
		const headA = phase * HEX_ORBIT_PATH_LEN;
		const headB = modF(headA + HEX_ORBIT_HALF_PATH, HEX_ORBIT_PATH_LEN);
		const perimeterGlow = Math.max(
			glowAlongHexOrbitPath(headA, normalizedPathIndex),
			glowAlongHexOrbitPath(headB, normalizedPathIndex) * 0.74,
		);
		if (normalizedPathIndex !== null) {
			return Math.min(HEX_ORBIT_HIGH_OPACITY, perimeterGlow);
		}
		const centerFalloff = col === 2 ? HEX_ORBIT_MID_OPACITY : 0.18;
		return Math.max(HEX_ORBIT_BASE_OPACITY, centerFalloff);
	}

	function frameOpacity(frames: readonly HexFrame[], row: number, col: number, phase: number): number {
		const frameIndex = Math.floor(phase * frames.length) % frames.length;
		const frame = frames[frameIndex] ?? frames[0];
		const mark = frame?.[`${row},${col}`];
		if (mark === "x") {
			return 0.98;
		}
		if (mark === "o") {
			return frames === HOURGLASS_FRAMES ? 0.32 : 0.46;
		}
		return 0.2;
	}

	function opacityForCell(row: number, col: number, phase: number, loaderVariant: DotmHexLoaderVariant): number {
		if (loaderVariant === "dotm-hex-1") {
			return opacityForHexOrbitCell(row, col, phase);
		}

		const point = pointForCell(row, col);

		if (loaderVariant === "dotm-hex-2") {
			if (point.radius < 0.01) {
				return 0.44 + Math.sin(phase * TWO_PI) * 0.18;
			}
			const rotation = phase * TWO_PI;
			const nearestSpoke = Math.min(
				angularDistance(point.angle, rotation),
				angularDistance(point.angle, rotation + TWO_PI / 3),
				angularDistance(point.angle, rotation + (TWO_PI * 2) / 3)
			);
			const spokeGlow = Math.max(0, 1 - nearestSpoke / 0.34);
			const outerPulse = 0.5 + 0.5 * Math.sin(phase * TWO_PI - point.radius * 2.2);
			const shellLift = point.radius > 1.7 ? outerPulse * 0.24 : 0;
			return Math.min(0.98, 0.08 + spokeGlow * 0.78 + shellLift);
		}

		if (loaderVariant === "dotm-hex-3") {
			const sweep = triangularWave(phase) * 3.9 - 1.95;
			const diagA = point.x * 0.86 + point.y * 0.5;
			const diagB = point.x * -0.86 + point.y * 0.5;
			const gateA = Math.max(0, 1 - Math.abs(diagA - sweep) / 0.55);
			const gateB = Math.max(0, 1 - Math.abs(diagB + sweep) / 0.55);
			const centerFlash =
				Math.max(0, 1 - Math.abs(sweep) / 0.68) * Math.max(0, 1 - point.radius / 1.9);
			const wake = 0.16 * Math.max(0, 1 - Math.abs(point.y - sweep * 0.22) / 1.2);
			return Math.min(0.96, 0.08 + gateA * 0.7 + gateB * 0.7 + centerFlash * 0.42 + wake);
		}

		if (loaderVariant === "dotm-hex-4") {
			const id = `${row},${col}`;
			const pathLen = VERTEX_PATH.length;
			const head = phase * pathLen;
			const vertexIndex = VERTEX_PATH.indexOf(id as (typeof VERTEX_PATH)[number]);
			let opacity = 0.08;
			if (vertexIndex >= 0) {
				const distance = modF(head - vertexIndex, pathLen);
				const glow = Math.max(0, 1 - distance / 2.2);
				opacity = Math.max(opacity, 0.08 + glow * 0.9);
			}
			for (let index = 0; index < pathLen; index += 1) {
				const vertex = VERTEX_PATH[index];
				if (vertex === undefined || !ECHO_BY_VERTEX[vertex].includes(id)) {
					continue;
				}
				const distance = modF(head - index, pathLen);
				const echo = Math.max(0, 1 - Math.abs(distance - 0.55) / 1.45);
				opacity = Math.max(opacity, 0.08 + echo * 0.52);
			}
			if (id === "2,2") {
				const centerBeat = 0.5 + 0.5 * Math.sin(phase * Math.PI * pathLen);
				opacity = Math.max(opacity, 0.36 + centerBeat * 0.22);
			}
			const softFill = Math.max(0, 1 - point.radius / 2.35) * 0.1;
			return Math.min(0.98, opacity + softFill);
		}

		if (loaderVariant === "dotm-hex-5") {
			const spiral = phase + point.radius * 0.18 + point.angle / TWO_PI;
			const counterSpiral = phase * 0.72 - point.radius * 0.16 - point.angle / TWO_PI;
			const core = point.radius < 0.1 ? 0.54 + Math.sin(phase * Math.PI * 4) * 0.26 : 0;
			return Math.min(0.96, 0.08 + wavePeak(spiral) * 0.7 + wavePeak(counterSpiral) * 0.231 + core);
		}

		if (loaderVariant === "dotm-hex-6") {
			const count = ROW_COUNTS[row] ?? 1;
			const x = col - (count - 1) / 2;
			const y = row - 2;
			const bandCount = 4;
			const downwardChevron = y + Math.abs(x) * 0.92 + 1.55;
			const upwardChevron = -y + Math.abs(x) * 0.92 + 1.55;
			const head = phase * bandCount;
			const primary = Math.max(0, 1 - wrappedDistance(downwardChevron, head, bandCount) / 0.78);
			const secondary = Math.max(
				0,
				1 - wrappedDistance(upwardChevron, head + bandCount / 2, bandCount) / 0.92
			);
			const centerLift = row === 2 && col === 2 ? 0.18 : 0;
			return Math.min(0.98, 0.1 + primary * 0.78 + secondary * 0.38 + centerLift);
		}

		if (loaderVariant === "dotm-hex-7") {
			return frameOpacity(HOURGLASS_FRAMES, row, col, phase);
		}

		if (loaderVariant === "dotm-hex-8") {
			return frameOpacity(GLYPH_FRAMES, row, col, phase);
		}

		if (loaderVariant === "dotm-hex-9") {
			if (point.radius < 0.1) {
				return 0.42 + Math.sin(phase * TWO_PI) * 0.2;
			}
			const rotation = phase * TWO_PI;
			const petalA = Math.max(0, 1 - angularDistance(point.angle, rotation) / 0.42);
			const petalB = Math.max(0, 1 - angularDistance(point.angle, rotation + Math.PI) / 0.42);
			const crossA = Math.max(0, 1 - angularDistance(point.angle, rotation + Math.PI / 2) / 0.52) * 0.46;
			const crossB =
				Math.max(0, 1 - angularDistance(point.angle, rotation + Math.PI * 1.5) / 0.52) * 0.46;
			const ring =
				(0.5 + 0.5 * Math.sin(phase * TWO_PI - point.radius * 2.7)) *
				(point.radius > 1.3 ? 0.22 : 0.1);
			const petalPeak = Math.max(petalA, petalB);
			if (petalPeak > 0.92) {
				return 0.98;
			}
			return Math.min(0.98, 0.15 + petalPeak * 0.82 + crossA + crossB + ring);
		}

		const lensCenter = Math.sin(phase * TWO_PI) * 1.15;
		const lensDistance = Math.abs(lensCenter - point.x * 0.88 - point.y * 0.16);
		const liquidLens = Math.max(0, 1 - lensDistance / 0.78);
		const wakeFront = ripple(phase + point.x * 0.12 - point.y * 0.045 + point.radius * 0.07, 0.16);
		const wakeBack =
			ripple(phase + 0.34 + point.x * 0.09 + point.y * 0.035 + point.radius * 0.05, 0.2) * 0.34;
		const verticalCompression =
			Math.max(0, 1 - Math.abs(Math.cos(phase * TWO_PI) * 1.18 - point.y * 1.25) / 1.1) * 0.18;
		const shellSheen =
			(0.5 + 0.5 * Math.sin(phase * TWO_PI - point.radius * 1.9)) *
			(point.radius > 1.35 ? 0.16 : 0.06);
		const core = point.radius < 0.1 ? 0.34 + Math.sin(phase * TWO_PI) * 0.1 : 0;
		return Math.min(
			0.98,
			0.09 + liquidLens * 0.72 + wakeFront * 0.38 + wakeBack + verticalCompression + shellSheen + core
		);
	}

	function sampledOpacityValues(row: number, col: number): string {
		if (!animated) {
			return opacityForCell(row, col, 0.12, resolvedVariant).toFixed(3);
		}
		const values: string[] = [];
		for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
			const phase = index / SAMPLE_COUNT;
			values.push(opacityForCell(row, col, phase, resolvedVariant).toFixed(3));
		}
		return values.join(";");
	}

	function speedForVariant(loaderVariant: DotmHexLoaderVariant): number {
		if (loaderVariant === "dotm-hex-1") return 1.6;
		if (loaderVariant === "dotm-hex-3") return 1.45;
		if (loaderVariant === "dotm-hex-4") return 1.5;
		if (loaderVariant === "dotm-hex-5") return 1.75;
		if (loaderVariant === "dotm-hex-6") return 1.55;
		if (loaderVariant === "dotm-hex-7") return 1.9;
		if (loaderVariant === "dotm-hex-8") return 1.35;
		if (loaderVariant === "dotm-hex-9") return 1.8;
		if (loaderVariant === "dotm-hex-10") return 1.55;
		return 1.7;
	}

	function cycleMsForVariant(loaderVariant: DotmHexLoaderVariant): number {
		if (loaderVariant === "dotm-hex-1") return 1500;
		if (loaderVariant === "dotm-hex-2") return 1500;
		if (loaderVariant === "dotm-hex-3") return 1850;
		if (loaderVariant === "dotm-hex-4") return 1650;
		if (loaderVariant === "dotm-hex-5") return 1450;
		if (loaderVariant === "dotm-hex-6") return 1260;
		if (loaderVariant === "dotm-hex-7") return 1520;
		if (loaderVariant === "dotm-hex-8") return 1400;
		if (loaderVariant === "dotm-hex-9") return 1650;
		return 1850;
	}
</script>

<svg
	class={cn("acepe-dotm-root", className)}
	style={rootStyle}
	width={size}
	height={size}
	viewBox={`0 0 ${size} ${size}`}
	fill="none"
	aria-hidden={isDecorative ? "true" : undefined}
	{role}
	aria-label={ariaLabel}
>
	{#each cells as cell (cell.key)}
		<circle
			class="acepe-dotm-dot"
			cx={cell.cx}
			cy={cell.cy}
			r={dotSize / 2}
			fill="currentColor"
			opacity={opacityForCell(cell.row, cell.col, 0.12, resolvedVariant)}
		>
			{#if animated}
				<animate
					attributeName="opacity"
					values={sampledOpacityValues(cell.row, cell.col)}
					dur={`${cycleMs}ms`}
					repeatCount="indefinite"
				/>
			{/if}
		</circle>
	{/each}
</svg>

<style>
	.acepe-dotm-root {
		display: inline-block;
		vertical-align: middle;
		overflow: visible;
	}
</style>
