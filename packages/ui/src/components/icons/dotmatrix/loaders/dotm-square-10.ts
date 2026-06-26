import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { MATRIX_SIZE } from "../dotmatrix-core.js";

const ROWS = MATRIX_SIZE;

const BASE_OPACITY = 0.08;
const PEAK_OPACITY = 1;
const DECAY = 0.72;
const COL_WARP = 0.07;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, row, col, phase }) => {
      if (!isActive) {
        return { className: "dmx-inactive" };
      }

      if (runtime.reducedMotion || phase === "idle") {
        const falloff = (ROWS - 1 - row) / Math.max(1, ROWS - 1);
        return { style: { opacity: BASE_OPACITY + falloff * 0.38 } };
      }

      const colGain = 1 + COL_WARP * Math.sin(col * 1.72 + runtime.cycleStep * 0.61);

      if (row > runtime.cycleStep) {
        return { style: { opacity: BASE_OPACITY } };
      }

      const age = runtime.cycleStep - row;
      const trail = Math.exp(-age * DECAY);
      const opacity = BASE_OPACITY + (PEAK_OPACITY - BASE_OPACITY) * trail * colGain;

      return { style: { opacity: Math.min(PEAK_OPACITY, opacity) } };
  };
}

export const dotm_square_10_config: DotmatrixLoaderConfig = {
  id: "dotm-square-10",
  defaultSpeed: 2.5,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  cycleHook: {
    type: "steppedCycle" as const,
    cycleMsBase: 1500,
    steps: 24,
  },
  createAnimationResolver,
};
