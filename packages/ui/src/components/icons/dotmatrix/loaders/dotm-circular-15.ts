import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const STEP_COUNT = 24;
const BASE_OPACITY = 0.07;
const MID_OPACITY = 0.34;
const HIGH_OPACITY = 0.95;

const BRAILLE_PHASES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["1,1", "2,1", "3,1", "1,3", "2,3", "3,3"]), // rails
  new Set(["1,1", "2,1", "3,1", "2,2", "1,3", "2,3", "3,3"]), // center bridge
  new Set(["1,1", "1,2", "1,3", "2,1", "2,3", "3,1", "3,2", "3,3"]), // top+bottom bars
  new Set(["1,1", "3,1", "2,2", "1,3", "3,3"]), // X-cross
  new Set(["2,1", "1,2", "3,2", "2,3"]), // plus motif
  new Set(["1,1", "2,1", "2,2", "2,3", "3,3"]) // diagonal sweep
];

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const ring = Math.sqrt(x * x + y * y);
      const count = BRAILLE_PHASES.length;
      const phaseIndex =
        runtime.reducedMotion || phase === "idle"
          ? 0
          : (() => {
              const t = Number.isFinite(runtime.cyclePhase) ? runtime.cyclePhase : 0;
              const raw = Math.floor(t * count);
              return ((raw % count) + count) % count;
            })();
      const activePattern = BRAILLE_PHASES[phaseIndex]!;
      const key = `${row},${col}`;
      const inPattern = activePattern.has(key);

      const previousIndex = (phaseIndex + BRAILLE_PHASES.length - 1) % BRAILLE_PHASES.length;
      const inPrevPattern = BRAILLE_PHASES[previousIndex]!.has(key);

      let opacity = BASE_OPACITY;
      if (inPattern) {
        opacity = HIGH_OPACITY;
      } else if (inPrevPattern) {
        opacity = MID_OPACITY;
      } else if (ring < 1.1) {
        opacity = 0.2;
      }

      return { style: { opacity } };
  };
}

export const dotm_circular_15_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-15",
  defaultSpeed: 1.65,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1680,
  },
  createAnimationResolver,
};
