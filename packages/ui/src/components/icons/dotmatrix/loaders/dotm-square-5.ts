import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { diagonalSnakeNormFromIndex, diagonalSnakeOrderValue } from "../dotmatrix-core.js";

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, index, phase }) => {
  if (!isActive) {
    return { className: "dmx-inactive" };
  }

  const order = diagonalSnakeOrderValue(index);
  const pathNorm = diagonalSnakeNormFromIndex(index);
  const style = { "--dmx-diagonal-snake-order": order } as DmxStyleProperties;

  if (runtime.reducedMotion || phase === "idle") {
    return {
      style: Object.assign({}, style, { opacity: 0.16 + pathNorm * 0.78 })
    };
  }

  return { className: "dmx-diagonal-snake", style };
  };
}

export const dotm_square_5_config: DotmatrixLoaderConfig = {
  id: "dotm-square-5",
  defaultSpeed: 1.35,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  createAnimationResolver,
};
