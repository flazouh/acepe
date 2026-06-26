import type { DotmatrixLoaderConfig } from "../loader-types.js";
import { dotm_circular_1_config } from "./dotm-circular-1.js";
import { dotm_circular_10_config } from "./dotm-circular-10.js";
import { dotm_circular_11_config } from "./dotm-circular-11.js";
import { dotm_circular_12_config } from "./dotm-circular-12.js";
import { dotm_circular_13_config } from "./dotm-circular-13.js";
import { dotm_circular_14_config } from "./dotm-circular-14.js";
import { dotm_circular_15_config } from "./dotm-circular-15.js";
import { dotm_circular_16_config } from "./dotm-circular-16.js";
import { dotm_circular_17_config } from "./dotm-circular-17.js";
import { dotm_circular_18_config } from "./dotm-circular-18.js";
import { dotm_circular_19_config } from "./dotm-circular-19.js";
import { dotm_circular_2_config } from "./dotm-circular-2.js";
import { dotm_circular_20_config } from "./dotm-circular-20.js";
import { dotm_circular_3_config } from "./dotm-circular-3.js";
import { dotm_circular_4_config } from "./dotm-circular-4.js";
import { dotm_circular_5_config } from "./dotm-circular-5.js";
import { dotm_circular_6_config } from "./dotm-circular-6.js";
import { dotm_circular_7_config } from "./dotm-circular-7.js";
import { dotm_circular_8_config } from "./dotm-circular-8.js";
import { dotm_circular_9_config } from "./dotm-circular-9.js";
import { dotm_square_1_config } from "./dotm-square-1.js";
import { dotm_square_10_config } from "./dotm-square-10.js";
import { dotm_square_11_config } from "./dotm-square-11.js";
import { dotm_square_12_config } from "./dotm-square-12.js";
import { dotm_square_13_config } from "./dotm-square-13.js";
import { dotm_square_14_config } from "./dotm-square-14.js";
import { dotm_square_15_config } from "./dotm-square-15.js";
import { dotm_square_16_config } from "./dotm-square-16.js";
import { dotm_square_17_config } from "./dotm-square-17.js";
import { dotm_square_18_config } from "./dotm-square-18.js";
import { dotm_square_19_config } from "./dotm-square-19.js";
import { dotm_square_2_config } from "./dotm-square-2.js";
import { dotm_square_20_config } from "./dotm-square-20.js";
import { dotm_square_3_config } from "./dotm-square-3.js";
import { dotm_square_4_config } from "./dotm-square-4.js";
import { dotm_square_5_config } from "./dotm-square-5.js";
import { dotm_square_6_config } from "./dotm-square-6.js";
import { dotm_square_7_config } from "./dotm-square-7.js";
import { dotm_square_8_config } from "./dotm-square-8.js";
import { dotm_square_9_config } from "./dotm-square-9.js";

export const DOTMATRIX_LOADER_CONFIGS: Record<string, DotmatrixLoaderConfig> = {
  "dotm-circular-1": dotm_circular_1_config,
  "dotm-circular-10": dotm_circular_10_config,
  "dotm-circular-11": dotm_circular_11_config,
  "dotm-circular-12": dotm_circular_12_config,
  "dotm-circular-13": dotm_circular_13_config,
  "dotm-circular-14": dotm_circular_14_config,
  "dotm-circular-15": dotm_circular_15_config,
  "dotm-circular-16": dotm_circular_16_config,
  "dotm-circular-17": dotm_circular_17_config,
  "dotm-circular-18": dotm_circular_18_config,
  "dotm-circular-19": dotm_circular_19_config,
  "dotm-circular-2": dotm_circular_2_config,
  "dotm-circular-20": dotm_circular_20_config,
  "dotm-circular-3": dotm_circular_3_config,
  "dotm-circular-4": dotm_circular_4_config,
  "dotm-circular-5": dotm_circular_5_config,
  "dotm-circular-6": dotm_circular_6_config,
  "dotm-circular-7": dotm_circular_7_config,
  "dotm-circular-8": dotm_circular_8_config,
  "dotm-circular-9": dotm_circular_9_config,
  "dotm-square-1": dotm_square_1_config,
  "dotm-square-10": dotm_square_10_config,
  "dotm-square-11": dotm_square_11_config,
  "dotm-square-12": dotm_square_12_config,
  "dotm-square-13": dotm_square_13_config,
  "dotm-square-14": dotm_square_14_config,
  "dotm-square-15": dotm_square_15_config,
  "dotm-square-16": dotm_square_16_config,
  "dotm-square-17": dotm_square_17_config,
  "dotm-square-18": dotm_square_18_config,
  "dotm-square-19": dotm_square_19_config,
  "dotm-square-2": dotm_square_2_config,
  "dotm-square-20": dotm_square_20_config,
  "dotm-square-3": dotm_square_3_config,
  "dotm-square-4": dotm_square_4_config,
  "dotm-square-5": dotm_square_5_config,
  "dotm-square-6": dotm_square_6_config,
  "dotm-square-7": dotm_square_7_config,
  "dotm-square-8": dotm_square_8_config,
  "dotm-square-9": dotm_square_9_config,
};

export function getDotmatrixLoaderConfig(id: string): DotmatrixLoaderConfig | undefined {
  return DOTMATRIX_LOADER_CONFIGS[id];
}

export const DOTMATRIX_LOADER_IDS = ['dotm-circular-1', 'dotm-circular-10', 'dotm-circular-11', 'dotm-circular-12', 'dotm-circular-13', 'dotm-circular-14', 'dotm-circular-15', 'dotm-circular-16', 'dotm-circular-17', 'dotm-circular-18', 'dotm-circular-19', 'dotm-circular-2', 'dotm-circular-20', 'dotm-circular-3', 'dotm-circular-4', 'dotm-circular-5', 'dotm-circular-6', 'dotm-circular-7', 'dotm-circular-8', 'dotm-circular-9', 'dotm-square-1', 'dotm-square-10', 'dotm-square-11', 'dotm-square-12', 'dotm-square-13', 'dotm-square-14', 'dotm-square-15', 'dotm-square-16', 'dotm-square-17', 'dotm-square-18', 'dotm-square-19', 'dotm-square-2', 'dotm-square-20', 'dotm-square-3', 'dotm-square-4', 'dotm-square-5', 'dotm-square-6', 'dotm-square-7', 'dotm-square-8', 'dotm-square-9'] as const;
export type DotmatrixLoaderId = (typeof DOTMATRIX_LOADER_IDS)[number];
