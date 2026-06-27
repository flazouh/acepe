import { Colors } from "@acepe/ui/colors";
import {
	BookOpen,
	Bug,
	GitBranch,
	Recycle,
	Sparkle,
	TestTube,
	Wrench,
} from "phosphor-svelte";
import type { Component } from "svelte";

export interface BranchPrefix {
	readonly label: string;
	readonly value: string;
	readonly icon: Component;
	readonly color: string;
}

export const BRANCH_PREFIXES: readonly BranchPrefix[] = [
	{ label: "None", value: "", icon: GitBranch, color: Colors.purple },
	{ label: "feat", value: "feat/", icon: Sparkle, color: "var(--success)" },
	{ label: "fix", value: "fix/", icon: Bug, color: Colors.red },
	{ label: "chore", value: "chore/", icon: Wrench, color: Colors.orange },
	{ label: "refactor", value: "refactor/", icon: Recycle, color: Colors.cyan },
	{ label: "docs", value: "docs/", icon: BookOpen, color: Colors.yellow },
	{ label: "test", value: "test/", icon: TestTube, color: Colors.pink },
];

export const DEFAULT_BRANCH_PREFIX = BRANCH_PREFIXES[0];
