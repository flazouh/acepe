import type { LinearIconSourceSet } from "./linear-icon-source-set.js";
import type { LinearIconSourceType } from "./linear-icon-source-type.js";

export type LinearIconSourceOccurrence = {
	readonly originalName: string;
	readonly sourceChunk: string;
	readonly sourceType: LinearIconSourceType;
	readonly sourceSet: LinearIconSourceSet;
};
