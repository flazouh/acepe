import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const STEP_COUNT = 24;
const BASE_OPACITY = 0.07;
const MID_OPACITY = 0.34;
const HIGH_OPACITY = 0.95;

const ORBIT_POINTS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 3],
  [3, 3],
  [3, 2],
  [3, 1],
  [2, 1]
];

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase: p }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const t =
        runtime.reducedMotion || p === "idle"
          ? 0
          : Math.floor(runtime.cyclePhase * ORBIT_POINTS.length) % ORBIT_POINTS.length;
      const [headRow, headCol] = ORBIT_POINTS[t]!;
      const [tailRow, tailCol] = ORBIT_POINTS[(t + ORBIT_POINTS.length - 1) % ORBIT_POINTS.length]!;

      let opacity = BASE_OPACITY;
      if (row === headRow && col === headCol) {
        opacity = HIGH_OPACITY;
      } else if (row === tailRow && col === tailCol) {
        opacity = 0.62;
      } else if ((col === 1 || col === 3) && (row === 1 || row === 2 || row === 3)) {
        opacity = MID_OPACITY;
      } else if (row === 2 && col === 2) {
        opacity = 0.2;
      }

      return { style: { opacity } };
  };
}

export const dotm_circular_19_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-19",
  defaultSpeed: 1.6,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1280,
  },
  createAnimationResolver,
};
