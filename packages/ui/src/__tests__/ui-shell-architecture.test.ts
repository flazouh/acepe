/**
 * UI shell architecture guard.
 *
 * Purpose:
 *   Protect the invariant that presentational shells in `@acepe/ui/app-layout`
 *   are dumb and self-contained: they must not transitively import `@tauri-apps/*`,
 *   any desktop store, app-specific runtime, or other forbidden dependency.
 *
 * How it works:
 *   Each shell is imported from the package barrel (`@acepe/ui/app-layout`).
 *   Merely resolving the barrel exercises the whole transitive import graph.
 *   If any shell pulls a forbidden dependency (e.g. a Tauri plugin that only
 *   resolves inside the desktop app), this test file fails to load and the
 *   suite fails — catching architectural drift before it ships.
 *
 * Append pattern:
 *   Units 3, 4, and 5 extend this file by adding new barrel imports at the
 *   top and matching `expect(...).toBeDefined()` assertions inside the
 *   existing `test("shells import without forbidden dependencies", ...)` block
 *   (or appending a new sibling block for a distinct barrel/package).
 *   Do NOT replace or restructure the file — append only.
 */

import { expect, test } from "bun:test";

import {
	AppQueueRow,
	AppSidebarFooter,
	AppSidebarProjectHeader,
} from "../components/app-layout/index.js";
import { AgentSelectorView } from "../components/agent-selector/index.js";
import { AgentInputView } from "../components/agent-input/index.js";
import { BranchPickerView } from "../components/branch-picker/index.js";
import { ProjectSelectorView } from "../components/project-selector/index.js";

test("Unit 1 shells import without forbidden dependencies", () => {
	expect(AppSidebarFooter).toBeDefined();
	expect(AppSidebarProjectHeader).toBeDefined();
	expect(AppQueueRow).toBeDefined();
});

test("Unit 3 selector shells import without forbidden dependencies", () => {
	expect(ProjectSelectorView).toBeDefined();
	expect(BranchPickerView).toBeDefined();
	expect(AgentSelectorView).toBeDefined();
});

test("Unit 4 agent input shell imports without forbidden dependencies", () => {
	expect(AgentInputView).toBeDefined();
});
