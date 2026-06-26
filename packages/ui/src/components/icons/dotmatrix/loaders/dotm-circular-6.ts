import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.08;
const ORBIT_OPACITY = 0.96;
const NEAR_ORBIT_OPACITY = 0.34;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase: p }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const t = runtime.reducedMotion || p === "idle" ? 0 : runtime.cyclePhase * Math.PI * 2;
      const angle = Math.atan2(y, x);
      const ring = Math.sqrt(x * x + y * y);

      const angularPhase = ((angle - t * 0.95 + Math.PI * 4) % (Math.PI * 2)) / ((Math.PI * 2) / 3);
      const sectorPos = angularPhase - Math.floor(angularPhase);
      const sectorPulse = Math.max(0, 1 - Math.abs(sectorPos - 0.5) * 2);
      const ringPhase = 0.5 + 0.5 * Math.cos(ring * 3.2 + t * 1.7);
      const score = 0.74 * sectorPulse + 0.26 * ringPhase;

      let opacity = BASE_OPACITY;
      if (score > 0.84) {
        opacity = ORBIT_OPACITY;
      } else if (score > 0.63) {
        opacity = 0.62;
      } else if (score > 0.44) {
        opacity = NEAR_ORBIT_OPACITY;
      }

      if (x === 0 && y === 0) {
        return { style: { opacity: Math.max(opacity, NEAR_ORBIT_OPACITY) } };
      }
      return { style: { opacity } };
  };
}

export const dotm_circular_6_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-6",
  defaultSpeed: 1.6,
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
