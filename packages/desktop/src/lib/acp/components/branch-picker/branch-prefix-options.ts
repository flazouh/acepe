import { Colors } from "@acepe/ui/colors";
import { RecycleIcon, WrenchIcon } from "@acepe/ui/icons";
import type { RoundedIconName } from "@acepe/ui/icons";
import type { Component } from "svelte";

export interface BranchPrefix {
	readonly label: string;
	readonly value: string;
	readonly icon?: Component;
	readonly roundedIcon?: RoundedIconName;
	readonly color: string;
}

export const BRANCH_PREFIXES: readonly BranchPrefix[] = [
	{ label: "None", value: "", roundedIcon: "branch", color: Colors.purple },
	{ label: "feat", value: "feat/", roundedIcon: "sparkle", color: "var(--success)" },
	{ label: "fix", value: "fix/", roundedIcon: "bug", color: Colors.red },
	{ label: "chore", value: "chore/", icon: WrenchIcon, color: Colors.orange },
	{ label: "refactor", value: "refactor/", icon: RecycleIcon, color: Colors.cyan },
	{ label: "docs", value: "docs/", roundedIcon: "notebook", color: Colors.yellow },
	{ label: "test", value: "test/", roundedIcon: "flask", color: Colors.pink },
];

export const DEFAULT_BRANCH_PREFIX = BRANCH_PREFIXES[0];
