export type ExtractedSvgShape = {
	readonly tag: "path" | "circle" | "rect" | "line" | "polyline" | "polygon";
	readonly attributes: Readonly<Record<string, string>>;
};
