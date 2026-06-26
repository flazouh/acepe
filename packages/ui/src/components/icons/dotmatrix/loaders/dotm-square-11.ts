import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, manhattanDistance, phase }) => {
  if (!isActive) {
    return { className: "dmx-inactive" };
  }

  const ring = Math.max(0, Math.min(4, manhattanDistance));
  const style = {
    "--dmx-ripple-ring": ring,
    "--dmx-ripple-parity": ring % 2
  } as DmxStyleProperties;

  if (runtime.reducedMotion || phase === "idle") {
    return {
      style: Object.assign({}, style, { opacity: 0.2 + (1 - ring / 4) * 0.72 })
    };
  }

  return { className: "dmx-ripple-echo", style };
  };
}

export const dotm_square_11_config: DotmatrixLoaderConfig = {
  id: "dotm-square-11",
  defaultSpeed: 1.25,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  createAnimationResolver,
};
