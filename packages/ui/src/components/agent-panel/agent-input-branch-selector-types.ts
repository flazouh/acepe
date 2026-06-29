export type AgentInputBranchSelectorVariant =
	| "default"
	| "minimal"
	| "setupChip"
	| "setupChipGrouped";

export type AgentInputBranchListDisplay =
	| { kind: "loading"; message: string }
	| { kind: "failed"; message: string }
	| { kind: "empty"; message: string }
	| { kind: "branches"; branches: readonly string[] };
