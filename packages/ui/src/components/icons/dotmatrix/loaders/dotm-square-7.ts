import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { rowMajorIndex } from "../dotmatrix-core.js";

type FrameCell = "." | "o" | "x" | "c";

const BASE_OPACITY = 0.08;
const SETTLED_OPACITY = 0.42;
const ACTIVE_OPACITY = 1;
const CLEAR_OPACITY = 0.88;
const IDLE_STEP = 10;

const FRAME_MASKS: readonly string[] = [
  "....." + "....." + "....." + "....." + "ooooo",
  "....." + "....." + "....." + "ooooo" + "ooooo",
  "....." + "....." + "ooooo" + "ooooo" + "ooooo",
  "....." + "ooooo" + "ooooo" + "ooooo" + "ooooo",
  "ooooo" + "ooooo" + "ooooo" + "ooooo" + "ooooo",
  "ccccc" + "ccccc" + "ccccc" + "ccccc" + "ccccc",
  "....." + "....." + "....." + "....." + ".....",
  "ccccc" + "ccccc" + "ccccc" + "ccccc" + "ccccc",
  "....." + "....." + "....." + "....." + ".....",
  "....." + "....." + "....." + "....." + "....."
];

const FRAME_SEQUENCE: readonly number[] = [0, 1, 2, 3, 4, 4, 5, 6, 7, 8, 9];

function maskCell(mask: string, row: number, col: number): FrameCell {
  return (mask[rowMajorIndex(row, col)] as FrameCell | undefined) ?? ".";
}

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, row, col }) => {
      if (!isActive) {
        return { className: "dmx-inactive" };
      }

      const frameIndex = FRAME_SEQUENCE[runtime.cycleStep % FRAME_SEQUENCE.length] ?? 0;
      const cell = maskCell(FRAME_MASKS[frameIndex]!, row, col);
      if (cell === "x") {
        return { style: { opacity: ACTIVE_OPACITY } };
      }
      if (cell === "o") {
        return { style: { opacity: SETTLED_OPACITY } };
      }
      if (cell === "c") {
        return { style: { opacity: CLEAR_OPACITY } };
      }
      return { style: { opacity: BASE_OPACITY } };
  };
}

export const dotm_square_7_config: DotmatrixLoaderConfig = {
  id: "dotm-square-7",
  defaultSpeed: 1.35,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  cycleHook: {
    type: "steppedCycle" as const,
    cycleMsBase: 1900,
    steps: FRAME_SEQUENCE.length,
  },
  createAnimationResolver,
};
