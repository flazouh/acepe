import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { trBlPathNormFromIndex } from "../dotmatrix-core.js";

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, index, row, col, phase }) => {
  if (!isActive) {
    return { className: "dmx-inactive" };
  }

  const path = trBlPathNormFromIndex(index);
  const slice = row + (4 - col);
  const parity = slice % 2;
  const style = {
    "--dmx-path": path,
    "--dmx-diagonal-parity": parity
  } as DmxStyleProperties;

  if (runtime.reducedMotion || phase === "idle") {
    return {
      style: Object.assign({}, style, { opacity: parity === 0 ? 0.88 : 0.14 })
    };
  }

  return { className: "dmx-diagonal-alt-sweep", style };
  };
}

export const dotm_square_1_config: DotmatrixLoaderConfig = {
  id: "dotm-square-1",
  defaultSpeed: 1.1,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  createAnimationResolver,
};
