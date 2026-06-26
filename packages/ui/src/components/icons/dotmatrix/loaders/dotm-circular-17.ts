import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.07;
const MID_OPACITY = 0.34;
const HIGH_OPACITY = 0.95;
/** Discrete checker frames per loop (must stay integer for `(row + col + t) % 2`). */
const CHECKER_STEPS = 4;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase: dmxPhase }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const holdStill = runtime.reducedMotion || dmxPhase === "idle";
      const t = holdStill
        ? 0
        : Math.floor(runtime.cyclePhase * CHECKER_STEPS) % CHECKER_STEPS;
      const parity = (row + col + t) % 2;
      const brailleBias = col === 1 || col === 3;
      const centerBias = row === 2 || col === 2;

      let opacity = BASE_OPACITY;
      if (parity === 0 && brailleBias) {
        opacity = HIGH_OPACITY;
      } else if (parity === 0 || centerBias) {
        opacity = MID_OPACITY;
      } else if (brailleBias) {
        opacity = 0.24;
      }

      return { style: { opacity } };
  };
}

export const dotm_circular_17_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-17",
  defaultSpeed: 1.55,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1500,
  },
  createAnimationResolver,
};
