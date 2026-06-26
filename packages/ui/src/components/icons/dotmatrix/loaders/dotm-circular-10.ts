import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const STEP_COUNT = 30;
const BASE_OPACITY = 0.06;
const LOW_OPACITY = 0.2;
const MID_OPACITY = 0.48;
const HIGH_OPACITY = 0.94;

function moduloDistance(a: number, b: number, mod: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, mod - raw);
}

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const ring = Math.round(Math.sqrt(x * x + y * y));
      const tick = runtime.reducedMotion || phase === "idle" ? 0 : Math.floor((runtime.cyclePhase) * 10);
      const cellCode = (row * 3 + col * 5 + ring * 2) % 10;
      const d = moduloDistance(cellCode, tick, 10);
      const parityGate = (row + col + tick) % 2 === 0;

      let opacity = BASE_OPACITY;
      if (d === 0) {
        opacity = HIGH_OPACITY;
      } else if (d === 1) {
        opacity = MID_OPACITY;
      } else if (d === 2 || parityGate) {
        opacity = LOW_OPACITY;
      }

      if (x === 0 && y === 0) {
        return { style: { opacity: Math.max(opacity, MID_OPACITY) } };
      }

      return { style: { opacity } };
  };
}

export const dotm_circular_10_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-10",
  defaultSpeed: 1.75,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1600,
  },
  createAnimationResolver,
};
