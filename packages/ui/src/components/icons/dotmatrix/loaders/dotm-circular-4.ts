import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.08;
const SWEEP_OPACITY = 0.96;
const NEAR_SWEEP_OPACITY = 0.36;
const RING_OPACITY = 0.22;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase: p }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const centerRow = row - 2;
      const centerCol = col - 2;
      const radius = Math.hypot(centerRow, centerCol);
      const theta = (runtime.reducedMotion || p === "idle" ? 0 : runtime.cyclePhase) * Math.PI * 2;
      const sweepX = Math.cos(theta);
      const sweepY = Math.sin(theta);
      const projection = centerCol * sweepX + centerRow * sweepY;
      const perpendicular = Math.abs(centerCol * sweepY - centerRow * sweepX);

      if (radius < 0.5) {
        return { style: { opacity: 0.62 } };
      }

      if (projection > 0.3 && perpendicular < 0.55) {
        return { style: { opacity: SWEEP_OPACITY } };
      }

      if (projection > 0 && perpendicular < 1.15) {
        return { style: { opacity: NEAR_SWEEP_OPACITY } };
      }

      if (radius > 1.6 && radius < 2.3) {
        return { style: { opacity: RING_OPACITY } };
      }

      return { style: { opacity: BASE_OPACITY } };
  };
}

export const dotm_circular_4_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-4",
  defaultSpeed: 1.55,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1800,
  },
  createAnimationResolver,
};
