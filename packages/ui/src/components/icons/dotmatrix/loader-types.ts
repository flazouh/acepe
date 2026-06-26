import type {
  DotAnimationResolver,
  DotMatrixPhase,
  MatrixPattern,
} from "./dotmatrix-core.js";

export interface DotmatrixLoaderRuntime {
  reducedMotion: boolean;
  matrixPhase: DotMatrixPhase;
  cyclePhase: number;
  cycleStep: number;
}

export type DotmatrixMaskType = "none" | "circular";

export interface DotmatrixLoaderConfig {
  id: string;
  defaultSpeed: number;
  defaultPattern: MatrixPattern;
  defaultSize: number;
  defaultDotSize: number;
  maskType: DotmatrixMaskType;
  cycleHook?: {
    type: "cyclePhase" | "steppedCycle";
    cycleMsBase: number;
    steps?: number | "dynamic";
  };
  createAnimationResolver: (runtime: DotmatrixLoaderRuntime) => DotAnimationResolver;
}
