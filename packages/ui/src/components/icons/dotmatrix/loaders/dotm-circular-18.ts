import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.07;
const MID_OPACITY = 0.33;
const HIGH_OPACITY = 0.95;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const t = runtime.reducedMotion || phase === "idle" ? 0 : Math.floor((runtime.cyclePhase) * 6);
      const pulseRow = t % 3; // 0..2
      const topRow = pulseRow;
      const bottomRow = 4 - pulseRow;
      const pairCols = [1, 3];

      let opacity = BASE_OPACITY;
      if ((row === topRow || row === bottomRow) && pairCols.includes(col)) {
        opacity = HIGH_OPACITY;
      } else if ((row === topRow || row === bottomRow) && col === 2) {
        opacity = 0.58;
      } else if ((row === 2 || col === 2) && pairCols.includes(col) === false) {
        opacity = MID_OPACITY;
      } else if (pairCols.includes(col)) {
        opacity = 0.22;
      }

      return { style: { opacity } };
  };
}

export const dotm_circular_18_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-18",
  defaultSpeed: 1.75,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1550,
  },
  createAnimationResolver,
};
