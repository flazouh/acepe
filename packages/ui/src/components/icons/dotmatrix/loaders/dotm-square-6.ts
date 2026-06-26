import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";

const COLUMN_HEIGHT = 5;

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, row, col, phase }) => {
      if (!isActive) {
        return { className: "dmx-inactive" };
      }

      const goesUp = col % 2 === 0;
      const position = goesUp ? COLUMN_HEIGHT - 1 - row : row;

      if (runtime.reducedMotion || phase === "idle") {
        return { style: { opacity: 0.22 + (position / (COLUMN_HEIGHT - 1)) * 0.66 } };
      }

      return {
        className: "dmx-square6-col-snake",
        style: { "--dmx-col-pos": position } as DmxStyleProperties
      };
  };
}

export const dotm_square_6_config: DotmatrixLoaderConfig = {
  id: "dotm-square-6",
  defaultSpeed: 2.2,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  createAnimationResolver,
};
