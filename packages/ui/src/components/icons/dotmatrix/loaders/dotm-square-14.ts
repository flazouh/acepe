import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { rowMajorIndex } from "../dotmatrix-core.js";

type FrameCell = "." | "o" | "x";

const BASE_OPACITY = 0.08;
const MID_OPACITY = 0.52;
const PEAK_OPACITY = 1;
const SMOOTH_TRANSITION = "opacity 180ms cubic-bezier(0.4, 0, 0.2, 1)";

const FRAME_MASKS: readonly string[] = [
  // Diagonal star
  "x...x" + ".x.x." + "..o.." + ".x.x." + "x...x",
  // Diamond bloom
  "..x.." + ".oxo." + "xooox" + ".oxo." + "..x..",
  // Petal ring
  ".x.x." + "x.o.x" + "..o.." + "x.o.x" + ".x.x.",
  // Crossed lattice
  "x.x.x" + ".o.o." + "x.o.x" + ".o.o." + "x.x.x"
];

const FRAME_SEQUENCE: readonly number[] = [0, 1, 2, 3, 2, 1];

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
        return { style: { opacity: PEAK_OPACITY, transition: SMOOTH_TRANSITION } };
      }
      if (cell === "o") {
        return { style: { opacity: MID_OPACITY, transition: SMOOTH_TRANSITION } };
      }
      return { style: { opacity: BASE_OPACITY, transition: SMOOTH_TRANSITION } };
  };
}

export const dotm_square_14_config: DotmatrixLoaderConfig = {
  id: "dotm-square-14",
  defaultSpeed: 1.25,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  cycleHook: {
    type: "steppedCycle" as const,
    cycleMsBase: 1700,
    steps: FRAME_SEQUENCE.length,
  },
  createAnimationResolver,
};
