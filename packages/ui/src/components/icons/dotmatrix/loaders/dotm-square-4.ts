import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import {
	middleRingAntiClockwiseNormFromIndex,
	middleRingAntiClockwiseOrderValue,
	outerRingClockwiseNormFromIndex,
	outerRingClockwiseOrderValue,
} from "../dotmatrix-core.js";

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
	return ({ isActive, index, row, col, phase }) => {
		if (!isActive) {
			return { className: "dmx-inactive" };
		}

		const isCenter = row === 2 && col === 2;
		if (isCenter) {
			return { className: "dmx-inactive" };
		}

		const outerOrder = outerRingClockwiseOrderValue(index);
		if (outerOrder >= 0) {
			const outerNorm = outerRingClockwiseNormFromIndex(index);
			const style: DmxStyleProperties = { "--dmx-outer-order": outerOrder };
			if (runtime.reducedMotion || phase === "idle") {
				return {
					style: Object.assign({}, style, { opacity: 0.2 + outerNorm * 0.72 }),
				};
			}
			return { className: "dmx-outer-snake", style };
		}

		const middleOrder = middleRingAntiClockwiseOrderValue(index);
		const middleNorm = middleRingAntiClockwiseNormFromIndex(index);
		const style: DmxStyleProperties = { "--dmx-middle-order": middleOrder };
		if (runtime.reducedMotion || phase === "idle") {
			return {
				style: Object.assign({}, style, { opacity: 0.2 + middleNorm * 0.72 }),
			};
		}

		return { className: "dmx-middle-snake", style };
	};
}

export const dotm_square_4_config: DotmatrixLoaderConfig = {
	id: "dotm-square-4",
	defaultSpeed: 1.35,
	defaultPattern: "full",
	defaultSize: 36,
	defaultDotSize: 5,
	maskType: "none",
	createAnimationResolver,
};
