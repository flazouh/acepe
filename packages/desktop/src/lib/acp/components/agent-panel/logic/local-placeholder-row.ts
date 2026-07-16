import type { VisibleLocalPlaceholderMode } from "./local-placeholder-mode.js";

export type LocalPlaceholderRow = {
	readonly rowId: string;
	readonly sourceEntryId: string;
	readonly kind: "localPlaceholder";
	readonly mode: VisibleLocalPlaceholderMode;
	readonly version: string;
	readonly anchorEligible: boolean;
	readonly activeStreamingTail: null;
};
