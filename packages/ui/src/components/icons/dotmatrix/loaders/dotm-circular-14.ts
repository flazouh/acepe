import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask } from "../dotmatrix-core.js";

const STEP_COUNT = 30;
const BASE_OPACITY = 0.07;
const RUNG_OPACITY = 0.95;
const SIDE_OPACITY = 0.56;
const GHOST_OPACITY = 0.28;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ row, col, phase }) => {
      if (!isWithinCircularMask(row, col)) {
        return { className: "dmx-inactive" };
      }

      const x = col - 2;
      const y = row - 2;
      const phaseStep = runtime.reducedMotion || phase === "idle" ? 0 : Math.floor((runtime.cyclePhase) * 10);
      const activeRow = (phaseStep + 5) % 5;
      const rowDistance = Math.abs(row - activeRow);
      const swing = Math.sin((phaseStep / 10) * Math.PI * 2 + y * 0.9);
      const leftAnchor = Math.round(1 + swing);
      const rightAnchor = 4 - leftAnchor;

      let opacity = BASE_OPACITY;
      if (row === activeRow && col >= leftAnchor && col <= rightAnchor) {
        opacity = RUNG_OPACITY;
      } else if ((col === leftAnchor || col === rightAnchor) && rowDistance <= 1) {
        opacity = SIDE_OPACITY;
      } else if ((col === leftAnchor || col === rightAnchor) && rowDistance === 2) {
        opacity = GHOST_OPACITY;
      }

      if (x === 0 && y === 0 && rowDistance <= 1) {
        return { style: { opacity: Math.max(opacity, SIDE_OPACITY) } };
      }

      return { style: { opacity } };
  };
}

export const dotm_circular_14_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-14",
  defaultSpeed: 1.75,
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
