import { describe, expect, it } from "vitest";

import {
	formatVoiceModelSize,
	getVoiceModelRows,
	type AgentInputVoiceModel,
} from "./agent-input-voice-model-menu-state.js";

const models: AgentInputVoiceModel[] = [
	{
		id: "tiny",
		name: "Tiny",
		sizeBytes: 76 * 1024 * 1024,
		isDownloaded: true,
	},
	{
		id: "large",
		name: "Large",
		sizeBytes: 1.5 * 1024 * 1024 * 1024,
		isDownloaded: false,
	},
];

describe("agent input voice model menu state", () => {
	it("formats megabyte model sizes", () => {
		expect(formatVoiceModelSize(76 * 1024 * 1024)).toBe("76 MB");
	});

	it("formats gigabyte model sizes with one decimal", () => {
		expect(formatVoiceModelSize(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
	});

	it("builds row state for selected and downloading models", () => {
		expect(
			getVoiceModelRows({
				models,
				selectedModelId: "tiny",
				downloadingModelId: "large",
			})
		).toEqual([
			{
				model: models[0],
				sizeLabel: "76 MB",
				isSelected: true,
				isDownloading: false,
			},
			{
				model: models[1],
				sizeLabel: "1.5 GB",
				isSelected: false,
				isDownloading: true,
			},
		]);
	});

	it("sorts models by tier before building rows", () => {
		const unsorted: AgentInputVoiceModel[] = [
			{
				id: "large",
				name: "Large",
				sizeBytes: 1024,
				isDownloaded: true,
			},
			{
				id: "tiny",
				name: "Tiny",
				sizeBytes: 512,
				isDownloaded: true,
			},
		];

		expect(
			getVoiceModelRows({
				models: unsorted,
				selectedModelId: null,
				downloadingModelId: null,
			}).map((row) => row.model.id)
		).toEqual(["tiny", "large"]);
	});
});
