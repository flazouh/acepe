import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";

// User-defined origin is cell (2,2) in a 1-based 5x5 grid => (row=1,col=1) in zero-based coords.
const ORIGIN_ROW = 1;
const ORIGIN_COL = 1;
const MAX_MANHATTAN = 6;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, row, col, phase }) => {
  if (!isActive) {
    return { className: "dmx-inactive" };
  }

  const ring = Math.max(
    0,
    Math.min(MAX_MANHATTAN, Math.abs(row - ORIGIN_ROW) + Math.abs(col - ORIGIN_COL))
  );
  const style = {
    "--dmx-center-ripple-ring": ring
  } as DmxStyleProperties;

  if (runtime.reducedMotion || phase === "idle") {
    return {
      style: Object.assign({}, style, { opacity: 0.2 + (1 - ring / MAX_MANHATTAN) * 0.75 })
    };
  }

  return { className: "dmx-center-origin-ripple", style };
  };
}

export const dotm_square_12_config: DotmatrixLoaderConfig = {
  id: "dotm-square-12",
  defaultSpeed: 1.35,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  createAnimationResolver,
};
