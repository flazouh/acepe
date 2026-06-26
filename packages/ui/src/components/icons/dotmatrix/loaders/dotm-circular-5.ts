import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.08;
const BLADE_OPACITY = 0.94;
const HALO_OPACITY = 0.34;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase: p }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const radius = Math.hypot(x, y);
      const angle = Math.atan2(y, x);
      const theta = (runtime.reducedMotion || p === "idle" ? 0 : runtime.cyclePhase) * Math.PI * 2;
      const pinwheel = Math.cos(angle * 4 - theta * 2.2);
      const radialGate = Math.sin(radius * 2.1 - theta * 1.25);

      if (radius < 0.6) {
        return { style: { opacity: 0.66 } };
      }

      if (pinwheel > 0.48 && radialGate > -0.25) {
        return { style: { opacity: BLADE_OPACITY } };
      }

      if (pinwheel > 0.1) {
        return { style: { opacity: HALO_OPACITY } };
      }

      return { style: { opacity: BASE_OPACITY } };
  };
}

export const dotm_circular_5_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-5",
  defaultSpeed: 1.7,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1650,
  },
  createAnimationResolver,
};
