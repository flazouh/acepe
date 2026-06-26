import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const STEP_COUNT = 36;
const BASE_OPACITY = 0.06;
const MID_OPACITY = 0.3;
const ARC_OPACITY = 0.96;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const ring = Math.sqrt(x * x + y * y);
      const angle = Math.atan2(y, x);
      const t = runtime.reducedMotion || phase === "idle" ? 0 : (runtime.cycleStep / STEP_COUNT) * Math.PI * 2;
      const stepBand = Math.floor((runtime.cycleStep / STEP_COUNT) * 8) % 8;
      const targetAngle = stepBand * (Math.PI / 4);
      const angleDelta = Math.acos(Math.cos(angle - targetAngle));
      const beam = Math.max(0, 1 - angleDelta / 0.42);
      const oppositeBeam = Math.max(0, 1 - Math.acos(Math.cos(angle - (targetAngle + Math.PI))) / 0.62);
      const spokePulse = Math.max(0, 1 - Math.abs(Math.abs(x) - Math.abs(y)) / 0.35);
      const ringTier = ring < 1 ? 0 : ring < 2 ? 1 : 2;

      let opacity = BASE_OPACITY;
      if (beam > 0.78 && ringTier >= 1) {
        opacity = ARC_OPACITY;
      } else if (beam > 0.48) {
        opacity = 0.62;
      } else if (oppositeBeam > 0.52 && ringTier === 2) {
        opacity = MID_OPACITY;
      } else if (spokePulse > 0.9 && ringTier > 0) {
        opacity = MID_OPACITY;
      }

      if (x === 0 && y === 0) {
        return { style: { opacity: Math.max(opacity, 0.26) } };
      }

      return { style: { opacity } };
  };
}

export const dotm_circular_12_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-12",
  defaultSpeed: 1.7,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "steppedCycle" as const,
    cycleMsBase: 1700,
    steps: 24,
  },
  createAnimationResolver,
};
