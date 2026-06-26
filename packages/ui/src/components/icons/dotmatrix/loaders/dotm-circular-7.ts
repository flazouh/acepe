import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.08;
const GATE_OPACITY = 0.92;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase: p }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const t = runtime.reducedMotion || p === "idle" ? 0 : runtime.cyclePhase * Math.PI * 2;
      const ring = Math.sqrt(x * x + y * y);
      const angle = Math.atan2(y, x);

      const petalWave = 0.5 + 0.5 * Math.cos(5 * angle - t * 1.7);
      const ringWave = 0.5 + 0.5 * Math.cos(ring * 3.3 - t * 1.2);
      const chordWave = 0.5 + 0.5 * Math.cos((x + y) * 1.6 + t * 1.35);

      // Sharpen contrast so lit cells form clear, visible groups.
      const petalGate = Math.pow(petalWave, 2.2);
      const blend = 0.68 * petalGate + 0.22 * ringWave + 0.1 * chordWave;
      const opacity = BASE_OPACITY + (GATE_OPACITY - BASE_OPACITY) * blend;

      return { style: { opacity } };
  };
}

export const dotm_circular_7_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-7",
  defaultSpeed: 1.8,
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
