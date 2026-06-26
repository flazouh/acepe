import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { MATRIX_SIZE } from "../dotmatrix-core.js";

const ROWS = MATRIX_SIZE;
const COLS = MATRIX_SIZE;

/** Steps 0..FILL_LAST: column `c` gains one row from the bottom each tick, delayed by `c` (col 0 full at `ROWS`, last col at `ROWS + COLS - 1`). */
const FILL_LAST = ROWS + COLS - 1;

const BLINK_STEPS = 4;
const BLINK_OPACITIES = [0.38, 1, 0.38, 1] as const;

const DRAIN_LAST = FILL_LAST;

/** fillTick 0..FILL_LAST → drainTick 0..DRAIN_LAST → + blink in between */
const SEQUENCE_LEN = FILL_LAST + 1 + BLINK_STEPS + DRAIN_LAST + 1;

const BASE_OPACITY = 0.08;
const SETTLED_OPACITY = 0.52;
const CAP_OPACITY = 1;

function fillHeight(col: number, fillTick: number): number {
  return Math.max(0, Math.min(ROWS, fillTick - col));
}

function drainHeight(col: number, drainTick: number): number {
  return Math.max(0, Math.min(ROWS, ROWS - Math.max(0, drainTick - col)));
}

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, row, col, phase }) => {
      const step = runtime.cycleStep;
      if (!isActive) {
        return { className: "dmx-inactive" };
      }

      if (runtime.reducedMotion || phase === "idle") {
        return { style: { opacity: BASE_OPACITY } };
      }

      let height = 0;
      let blinkOpacity: number | null = null;

      if (step <= FILL_LAST) {
        height = fillHeight(col, step);
      } else if (step < FILL_LAST + 1 + BLINK_STEPS) {
        height = ROWS;
        blinkOpacity = BLINK_OPACITIES[step - (FILL_LAST + 1)] ?? 1;
      } else {
        const drainTick = step - (FILL_LAST + 1 + BLINK_STEPS);
        height = drainHeight(col, drainTick);
      }

      const bottomRow = ROWS - 1;
      const topLitRow = ROWS - height;
      const isLit = height > 0 && row >= topLitRow && row <= bottomRow;
      if (!isLit) {
        return { style: { opacity: BASE_OPACITY } };
      }

      if (blinkOpacity !== null) {
        return { style: { opacity: blinkOpacity } };
      }

      const isCap = row === topLitRow && height > 0 && height < ROWS;
      return {
        style: { opacity: isCap ? CAP_OPACITY : SETTLED_OPACITY }
      };
  };
}

export const dotm_square_8_config: DotmatrixLoaderConfig = {
  id: "dotm-square-8",
  defaultSpeed: 1.4,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  cycleHook: {
    type: "steppedCycle" as const,
    cycleMsBase: 2000,
    steps: SEQUENCE_LEN,
  },
  createAnimationResolver,
};
