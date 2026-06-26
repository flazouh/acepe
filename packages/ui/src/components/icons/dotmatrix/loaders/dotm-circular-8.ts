import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.08;
const PULSE_CORE = 0.95;
const PULSE_RING = 0.44;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase: p }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const radius = Math.hypot(x, y);
      const beat = runtime.reducedMotion || p === "idle" ? 0 : Math.sin(runtime.cyclePhase * Math.PI * 2);
      const spike = runtime.reducedMotion || p === "idle" ? 0 : Math.sin(runtime.cyclePhase * Math.PI * 4);
      const pulse = Math.max(0, beat) + Math.max(0, spike) * 0.55;

      if (radius < 0.55) {
        return { style: { opacity: Math.min(1, 0.35 + pulse * PULSE_CORE) } };
      }
      if (radius < 1.65) {
        return { style: { opacity: 0.16 + pulse * PULSE_RING } };
      }
      return { style: { opacity: BASE_OPACITY + pulse * 0.08 } };
  };
}

export const dotm_circular_8_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-8",
  defaultSpeed: 1.95,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1400,
  },
  createAnimationResolver,
};
