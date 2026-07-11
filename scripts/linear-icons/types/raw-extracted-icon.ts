import type { ExtractedSvgShape } from "./extracted-svg-shape.js";
import type { LinearIconSourceSet } from "./linear-icon-source-set.js";
import type { LinearIconSourceType } from "./linear-icon-source-type.js";

export type RawExtractedIcon = {
	readonly originalName: string;
	readonly sourceChunk: string;
	readonly sourceType: LinearIconSourceType;
	readonly sourceSet: LinearIconSourceSet;
	readonly viewBox: string;
	readonly shapes: readonly ExtractedSvgShape[];
};
