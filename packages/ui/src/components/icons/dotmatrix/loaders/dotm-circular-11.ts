import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.07;
const MID_OPACITY = 0.3;
const HIGH_OPACITY = 0.95;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase: p }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const ring = Math.sqrt(x * x + y * y);
      const t = runtime.reducedMotion || p === "idle" ? 0 : runtime.cyclePhase * Math.PI * 2;
      const angle = Math.atan2(y, x);
      const moonCenterX = Math.cos(t) * 0.7;
      const moonCenterY = Math.sin(t) * 0.7;
      const body = Math.hypot(x - moonCenterX, y - moonCenterY);
      const cutCenterX = moonCenterX + Math.cos(t) * 0.82;
      const cutCenterY = moonCenterY + Math.sin(t) * 0.82;
      const cut = Math.hypot(x - cutCenterX, y - cutCenterY);
      const rim = Math.max(0, 1 - Math.abs(body - 1.55) / 0.35);
      const halo = Math.max(0, 1 - Math.acos(Math.cos(angle - t)) / 0.9);

      let opacity = BASE_OPACITY;
      if (body < 1.55 && cut > 1.05) {
        opacity = HIGH_OPACITY;
      } else if (rim > 0.5) {
        opacity = MID_OPACITY + rim * 0.22;
      } else if (halo > 0.68 && ring > 1.2) {
        opacity = MID_OPACITY;
      }

      return { style: { opacity: Math.min(HIGH_OPACITY, opacity) } };
  };
}

export const dotm_circular_11_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-11",
  defaultSpeed: 1.65,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1850,
  },
  createAnimationResolver,
};
