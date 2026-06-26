import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { rowMajorIndex } from "../dotmatrix-core.js";

type FrameCell = "." | "o" | "x";

const BASE_OPACITY = 0.08;
const ON_OPACITY = 0.56;
const PEAK_OPACITY = 1;

const FRAME_MASKS: readonly string[] = [
  // N
  "..x.." + "..x.." + "..o.." + "....." + ".....",
  // NE
  "....x" + "...x." + "..o.." + "....." + ".....",
  // E
  "....." + "....." + "..oxx" + "....." + ".....",
  // SE
  "....." + "....." + "..o.." + "...x." + "....x",
  // S
  "....." + "....." + "..o.." + "..x.." + "..x..",
  // SW
  "....." + "....." + "..o.." + ".x..." + "x....",
  // W
  "....." + "....." + "xxo.." + "....." + ".....",
  // NW
  "x...." + ".x..." + "..o.." + "....." + "....."
];

const FRAME_SEQUENCE: readonly number[] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7];

function maskCell(mask: string, row: number, col: number): FrameCell {
  return (mask[rowMajorIndex(row, col)] as FrameCell | undefined) ?? ".";
}

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  const frameIndex = FRAME_SEQUENCE[runtime.cycleStep] ?? 0;
  const mask = FRAME_MASKS[frameIndex] ?? FRAME_MASKS[0]!;
  return ({ isActive, row, col }) => {
      if (!isActive) {
        return { className: "dmx-inactive" };
      }

      const cell = maskCell(mask, row, col);
      if (cell === "x") {
        return { style: { opacity: PEAK_OPACITY } };
      }
      if (cell === "o") {
        return { style: { opacity: ON_OPACITY } };
      }
      return { style: { opacity: BASE_OPACITY } };
  };
}

export const dotm_square_13_config: DotmatrixLoaderConfig = {
  id: "dotm-square-13",
  defaultSpeed: 1.85,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  cycleHook: {
    type: "steppedCycle" as const,
    cycleMsBase: 1550,
    steps: FRAME_SEQUENCE.length,
  },
  createAnimationResolver,
};
