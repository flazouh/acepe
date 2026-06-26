import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";

const BASE_OPACITY = 0.08;
const LIT_OPACITY = 0.94;
const CAP_OPACITY = 1;
const STEP_COUNT = 24;
const MAX_LEVEL = 5;

function clampLevel(value: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.round(value)));
}

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, row, col, phase }) => {
      if (!isActive) {
        return { className: "dmx-inactive" };
      }

      const t = runtime.reducedMotion || phase === "idle" ? 0 : runtime.cyclePhase * STEP_COUNT;
      const colPhase = t * 0.52 + col * 1.15;
      const level = clampLevel(1 + ((Math.sin(colPhase) + 1) / 2) * (MAX_LEVEL - 1));
      const topLitRow = MAX_LEVEL - level;

      if (row > topLitRow) {
        return { style: { opacity: LIT_OPACITY } };
      }
      if (row === topLitRow) {
        return { style: { opacity: CAP_OPACITY } };
      }
      return { style: { opacity: BASE_OPACITY } };
  };
}

export const dotm_square_18_config: DotmatrixLoaderConfig = {
  id: "dotm-square-18",
  defaultSpeed: 1.35,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  cycleHook: {
    type: "cyclePhase" as const,
    cycleMsBase: 1750,
  },
  createAnimationResolver,
};
