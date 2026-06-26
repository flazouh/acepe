import type { DotmatrixLoaderConfig, DotmatrixLoaderRuntime } from "../loader-types.js";
import type { DotAnimationResolver, DmxStyleProperties } from "../dotmatrix-core.js";
import { rowMajorIndex } from "../dotmatrix-core.js";

const SNAKE_TAIL = [1, 0.82, 0.68, 0.54, 0.42, 0.31, 0.22, 0.14] as const;
const BASE_OPACITY = 0.08;

function buildRowCyclePath(): number[] {
  const path: number[] = [];
  const push = (row: number, col: number) => path.push(rowMajorIndex(row, col));

  // 1st col: bottom -> top
  for (let row = 4; row >= 0; row -= 1) push(row, 0);
  // top to 3rd col
  push(0, 1);
  push(0, 2);
  // 3rd col: top -> bottom
  for (let row = 1; row <= 4; row += 1) push(row, 2);
  // bottom left to 2nd col
  push(4, 1);
  // 2nd col: bottom -> top
  for (let row = 3; row >= 0; row -= 1) push(row, 1);
  // top right to 4th col
  push(0, 2);
  push(0, 3);
  // 4th col: top -> bottom
  for (let row = 1; row <= 4; row += 1) push(row, 3);
  // bottom left to 3rd col
  push(4, 2);
  // 3rd col: bottom -> top
  for (let row = 3; row >= 0; row -= 1) push(row, 2);
  // top right to 5th col
  push(0, 3);
  push(0, 4);
  // 5th col: top -> bottom
  for (let row = 1; row <= 4; row += 1) push(row, 4);

  return path;
}

const ROUTE = buildRowCyclePath();
const ROUTE_LEN = ROUTE.length;
const VISITS_BY_INDEX = (() => {
  const visits = new Map<number, number[]>();
  for (let step = 0; step < ROUTE_LEN; step += 1) {
    const index = ROUTE[step]!;
    const list = visits.get(index) ?? [];
    list.push(step);
    visits.set(index, list);
  }
  return visits;
})();

function createAnimationResolver(runtime: DotmatrixLoaderRuntime): DotAnimationResolver {
  return ({ isActive, index }) => {
      if (!isActive) {
        return { className: "dmx-inactive" };
      }

      if (ROUTE_LEN <= 0) {
        return { style: { opacity: BASE_OPACITY } };
      }

      const visits = VISITS_BY_INDEX.get(index) ?? [];
      let opacity = BASE_OPACITY;
      for (const stepIndex of visits) {
        const distance = (runtime.cycleStep - stepIndex + ROUTE_LEN) % ROUTE_LEN;
        if (distance >= 0 && distance < SNAKE_TAIL.length) {
          opacity = Math.max(opacity, SNAKE_TAIL[distance]!);
        }
      }

      return { style: { opacity } };
  };
}

export const dotm_square_2_config: DotmatrixLoaderConfig = {
  id: "dotm-square-2",
  defaultSpeed: 1.15,
  defaultPattern: "full",
  defaultSize: 36,
  defaultDotSize: 5,
  maskType: "none",
  cycleHook: {
    type: "steppedCycle" as const,
    cycleMsBase: 1500,
    steps: ROUTE_LEN,
  },
  createAnimationResolver,
};
