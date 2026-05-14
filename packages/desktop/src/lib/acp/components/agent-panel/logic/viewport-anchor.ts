export type TranscriptViewportAnchor =
	| {
			type: "tail";
	  }
	| {
			type: "row";
			rowKey: string;
			edge: "start" | "end";
			offsetPx: number;
	  }
	| {
			type: "offset";
			offsetPx: number;
	  };

export function createTailAnchor(): TranscriptViewportAnchor {
	return {
		type: "tail",
	};
}

export function createRowAnchor(rowKey: string, offsetPx: number): TranscriptViewportAnchor {
	return {
		type: "row",
		rowKey,
		edge: "start",
		offsetPx,
	};
}
