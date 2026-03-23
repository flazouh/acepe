import type { PanelViewState } from "../../../logic/panel-visibility.js";

export type PanelBranchLookupDecision =
	| { readonly kind: "lookup"; readonly path: string }
	| { readonly kind: "clear" }
	| { readonly kind: "noop" };

export interface PanelBranchLookupInput {
	readonly lookupPath: string | null;
	readonly viewKind: PanelViewState["kind"];
}

export interface PanelBranchLookupController {
	next(input: PanelBranchLookupInput): PanelBranchLookupDecision;
}

export function createPanelBranchLookupController(): PanelBranchLookupController {
	let activeLookupPath: string | null = null;

	return {
		next(input) {
			if (!input.lookupPath || input.viewKind === "project_selection") {
				activeLookupPath = null;
				return { kind: "clear" };
			}

			if (activeLookupPath === input.lookupPath) {
				return { kind: "noop" };
			}

			activeLookupPath = input.lookupPath;
			return { kind: "lookup", path: input.lookupPath };
		},
	};
}
