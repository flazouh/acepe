import { describe, expect, test } from "bun:test";

import { CheckpointCard } from "../components/checkpoint/index.js";
import { AppSidebarLayout } from "../components/app-layout/index.js";
import {
	AppSidebarProjectGroup,
	ProjectHeader,
	ProjectHeaderOverflowMenu,
} from "../components/app-layout/index.js";
import { KanbanSceneBoard } from "../components/kanban/index.js";
import { UI_PACKAGE_FORBIDDEN_IMPORT_RULES } from "../../../../scripts/ui-package-forbidden-import-rules.ts";

describe("ui package boundary exports", () => {
	test("canonical MVC pattern Views are exported", () => {
		expect(CheckpointCard).toBeDefined();
		expect(AppSidebarLayout).toBeDefined();
		expect(AppSidebarProjectGroup).toBeDefined();
		expect(ProjectHeader).toBeDefined();
		expect(ProjectHeaderOverflowMenu).toBeDefined();
		expect(KanbanSceneBoard).toBeDefined();
	});

	test("forbidden import rules cover tauri and desktop store aliases", () => {
		const tauriRule = UI_PACKAGE_FORBIDDEN_IMPORT_RULES.find(
			(rule) => rule.id === "tauri-apps"
		);
		const storeRule = UI_PACKAGE_FORBIDDEN_IMPORT_RULES.find(
			(rule) => rule.id === "desktop-lib-store"
		);

		expect(tauriRule?.matches("@tauri-apps/api/core")).toBe(true);
		expect(storeRule?.matches("$lib/store/session-store.svelte.js")).toBe(true);
		expect(tauriRule?.matches("@acepe/ui")).toBe(false);
	});
});
