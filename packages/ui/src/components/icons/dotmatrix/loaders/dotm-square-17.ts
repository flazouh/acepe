import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.08;
const STRAND_OPACITY = 1;
const NEAR_STRAND_OPACITY = 0.24;
const STEP_COUNT = 20;
const HELIX_LOOP_RADIANS = (Math.PI * 2) / (STEP_COUNT - 1);

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, row, col, phase }) => {
      if (!isActive) {
        return { className: "dmx-inactive" };
      }

      const t = runtime.reducedMotion || phase === "idle" ? 0 : runtime.cyclePhase * STEP_COUNT;
      // Make first and last discrete frames identical to avoid loop jank.
      const rowPhase = t * HELIX_LOOP_RADIANS + row * 1.24;
      // One helix strand only, sweeping across full 5-column width.
      const strandCol = Math.round(2 + 2 * Math.sin(rowPhase));

      if (col === strandCol) {
        return { style: { opacity: STRAND_OPACITY } };
      }

      if (Math.abs(col - strandCol) === 1) {
        return { style: { opacity: NEAR_STRAND_OPACITY } };
      }

      return { style: { opacity: BASE_OPACITY } };
  };
}

export const dotm_square_17_config: DotmatrixLoaderConfig = {
  id: "dotm-square-17",
  defaultSpeed: 2.5,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1600,
  },
  createAnimationResolver,
};
