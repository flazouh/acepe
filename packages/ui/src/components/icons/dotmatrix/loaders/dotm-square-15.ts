import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.08;
const STRAND_OPACITY = 1;
const BRIDGE_OPACITY = 0.58;
const NEAR_STRAND_OPACITY = 0.24;
/** Integer full sin periods per matrix cycle so phase 0 ≡ phase 1 (no wrap glitch). */
const STRAND_LOOPS = 2;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, row, col, phase }) => {
      if (!isActive) {
        return { className: "dmx-inactive" };
      }

      const u = runtime.reducedMotion || phase === "idle" ? 0 : runtime.cyclePhase;
      const rowPhase = u * STRAND_LOOPS * 2 * Math.PI + row * 1.24;
      const left = Math.round(1 + Math.sin(rowPhase));
      const right = 4 - left;
      const bridgeOn = Math.cos(rowPhase * 2) > 0.82;

      if (col === left || col === right) {
        return { style: { opacity: STRAND_OPACITY } };
      }

      if (bridgeOn && col > left && col < right) {
        return { style: { opacity: BRIDGE_OPACITY } };
      }

      if (Math.abs(col - left) === 1 || Math.abs(col - right) === 1) {
        return { style: { opacity: NEAR_STRAND_OPACITY } };
      }

      return { style: { opacity: BASE_OPACITY } };
  };
}

export const dotm_square_15_config: DotmatrixLoaderConfig = {
  id: "dotm-square-15",
  defaultSpeed: 1.25,
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
