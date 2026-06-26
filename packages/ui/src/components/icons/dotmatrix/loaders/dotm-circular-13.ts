import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const STEP_COUNT = 28;
const BASE_OPACITY = 0.07;
const STRAND_OPACITY = 0.95;
const NEAR_STRAND_OPACITY = 0.5;
const BRIDGE_OPACITY = 0.3;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const t = runtime.reducedMotion || phase === "idle" ? 0 : (runtime.cycleStep / STEP_COUNT) * Math.PI * 2;

      const strandOffset = Math.sin(y * 1.35 + t * 1.3) * 1.15;
      const leftStrand = -strandOffset;
      const rightStrand = strandOffset;
      const leftDistance = Math.abs(x - leftStrand);
      const rightDistance = Math.abs(x - rightStrand);
      const strandDistance = Math.min(leftDistance, rightDistance);
      const bridgeOn = Math.cos(y * 2 + t * 2.1) > 0.55;
      const isBetweenStrands = x > Math.min(leftStrand, rightStrand) && x < Math.max(leftStrand, rightStrand);

      let opacity = BASE_OPACITY;
      if (strandDistance < 0.34) {
        opacity = STRAND_OPACITY;
      } else if (strandDistance < 0.8) {
        opacity = NEAR_STRAND_OPACITY;
      } else if (bridgeOn && isBetweenStrands) {
        opacity = BRIDGE_OPACITY;
      }

      return { style: { opacity } };
  };
}

export const dotm_circular_13_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-13",
  defaultSpeed: 1.55,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "steppedCycle" as const,
    cycleMsBase: 1750,
    steps: 24,
  },
  createAnimationResolver,
};
