import type { LinearIconSourceSet } from "./linear-icon-source-set.js";
import type { LinearIconSourceType } from "./linear-icon-source-type.js";

export type NormalizedLinearIcon = {
	readonly originalName: string;
	readonly cleanName: string;
	readonly sourceChunk: string;
	readonly sourceType: LinearIconSourceType;
	readonly sourceSet: LinearIconSourceSet;
	readonly viewBox: string;
	readonly geometryHash: string;
	readonly svg: string;
	readonly duplicateOf: string | null;
};
