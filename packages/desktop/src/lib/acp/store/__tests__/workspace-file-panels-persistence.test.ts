import { describe, expect, it } from "bun:test";

import { hydratePersistedFilePanels, serializeFilePanels } from "../workspace-store.svelte.js";

describe("workspace file panel persistence helpers", () => {
	it("serializes file panel state", () => {
		const serialized = serializeFilePanels([
			{
				id: "panel-1",
				filePath: "README.md",
				projectPath: "/workspace/app",
				ownerPanelId: "agent-panel-1",
				width: 520,
			},
		]);

		expect(serialized).toEqual([
			{
				id: "panel-1",
				filePath: "README.md",
				projectPath: "/workspace/app",
				ownerPanelId: "agent-panel-1",
				width: 520,
			},
		]);
	});

	it("hydrates persisted file panels with fresh ids", () => {
		const ids = ["hydrated-1", "hydrated-2"];
		let index = 0;
		const idFactory = () => {
			const nextId = ids[index];
			index += 1;
			return nextId;
		};

		const hydrated = hydratePersistedFilePanels(
			[
				{
					id: "persisted-1",
					filePath: "README.md",
					projectPath: "/workspace/app",
					ownerPanelId: "agent-panel-1",
					width: 520,
				},
				{
					filePath: "config.yml",
					projectPath: "/workspace/app",
					width: 640,
				},
			],
			idFactory
		);

		expect(hydrated).toEqual([
			{
				id: "persisted-1",
				filePath: "README.md",
				projectPath: "/workspace/app",
				ownerPanelId: "agent-panel-1",
				width: 520,
			},
			{
				id: "hydrated-1",
				filePath: "config.yml",
				projectPath: "/workspace/app",
				ownerPanelId: null,
				width: 640,
			},
		]);
	});
});
