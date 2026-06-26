import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { isWithinCircularMask, rowMajorIndex } from "../dotmatrix-core.js";

const RING_PATH: readonly number[] = [
  rowMajorIndex(0, 1),
  rowMajorIndex(0, 2),
  rowMajorIndex(0, 3),
  rowMajorIndex(1, 4),
  rowMajorIndex(2, 4),
  rowMajorIndex(3, 4),
  rowMajorIndex(4, 3),
  rowMajorIndex(4, 2),
  rowMajorIndex(4, 1),
  rowMajorIndex(3, 0),
  rowMajorIndex(2, 0),
  rowMajorIndex(1, 0)
];

const LOOP_LEN = RING_PATH.length;
const BASE_OPACITY = 0.08;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ index, row, col, phase }) => {
    if (!isWithinCircularMask(row, col)) {
      return { className: "dmx-inactive" };
    }

    const onRing = RING_PATH.indexOf(index);
    if (onRing === -1) {
      return { style: { opacity: row === 2 && col === 2 ? 0.18 : BASE_OPACITY } };
    }

    if (runtime.reducedMotion || phase === "idle") {
      return { style: { opacity: 0.28 + (onRing / (LOOP_LEN - 1)) * 0.58 } };
    }

    return {
      className: "dmx-circular2-ring",
      style: { "--dmx-ring-order": onRing } as DmxStyleProperties
    };
  };
}

export const dotm_circular_2_config: DotmatrixLoaderConfig = {
  id: "dotm-circular-2",
  defaultSpeed: 1.8,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "circular",
  createAnimationResolver,
};
