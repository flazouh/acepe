import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const STEP_COUNT = 25;
const BASE_OPACITY = 0.07;
const MID_OPACITY = 0.32;
const HIGH_OPACITY = 0.95;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      // Discrete steps: runtime.cyclePhase is continuous in [0, 1); fractional `t` breaks row === checks.
      const t =
        runtime.reducedMotion || phase === "idle" ? 0 : Math.floor(runtime.cyclePhase * STEP_COUNT) % STEP_COUNT;
      const activeRow = t % 5;
      const activeBrailleCol = Math.floor((t / 5) * 2) % 2; // left or right cell rail
      const railCol = activeBrailleCol === 0 ? 1 : 3;
      const nearCol = activeBrailleCol === 0 ? 2 : 2;
      const rowDistance = Math.abs(row - activeRow);

      let opacity = BASE_OPACITY;
      if (col === railCol && rowDistance === 0) {
        opacity = HIGH_OPACITY;
      } else if (col === railCol && rowDistance === 1) {
        opacity = MID_OPACITY;
      } else if (col === nearCol && rowDistance === 0) {
        opacity = 0.52;
      } else if ((col === 1 || col === 3) && rowDistance === 2) {
        opacity = 0.24;
      }

      return { style: { opacity } };
  };
}

export const dotm_circular_16_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-16",
  defaultSpeed: 1.1,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1700,
  },
  createAnimationResolver,
};
