import { describe, expect, test } from "bun:test";

import { CheckpointCard } from "../components/checkpoint/index.js";
import { AppSidebarLayout } from "../components/app-layout/index.js";
import {
	AppSidebarProjectGroup,
	ProjectHeader,
	ProjectHeaderOverflowMenu,
} from "../components/app-layout/index.js";
import { KanbanSceneBoard } from "../components/kanban/index.js";

describe("ui package boundary exports", () => {
	test("canonical MVC pattern Views are exported", () => {
		expect(CheckpointCard).toBeDefined();
		expect(AppSidebarLayout).toBeDefined();
		expect(AppSidebarProjectGroup).toBeDefined();
		expect(ProjectHeader).toBeDefined();
		expect(ProjectHeaderOverflowMenu).toBeDefined();
		expect(KanbanSceneBoard).toBeDefined();
	});

});
