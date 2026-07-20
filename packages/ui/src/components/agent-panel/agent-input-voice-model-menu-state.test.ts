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
		isDownloadable: true,
	},
	{
		id: "large",
		name: "Large",
		sizeBytes: 1.5 * 1024 * 1024 * 1024,
		isDownloaded: false,
		isDownloadable: true,
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

	it("labels unconfigured external speech backend without a fake file size", () => {
		const rows = getVoiceModelRows({
			models: [
				{
					id: "external",
					name: "Speech to text",
					sizeBytes: 0,
					isDownloaded: false,
					isDownloadable: false,
				},
			],
			selectedModelId: "external",
			downloadingModelId: null,
		});

		expect(rows[0]?.sizeLabel).toBe("Not configured");
	});

	it("labels configured external speech backend as ready", () => {
		const rows = getVoiceModelRows({
			models: [
				{
					id: "external",
					name: "Speech to text",
					sizeBytes: 0,
					isDownloaded: true,
					isDownloadable: false,
				},
			],
			selectedModelId: "external",
			downloadingModelId: null,
		});

		expect(rows[0]?.sizeLabel).toBe("Ready");
	});

	it("sorts models by tier before building rows", () => {
		const unsorted: AgentInputVoiceModel[] = [
			{
				id: "large",
				name: "Large",
				sizeBytes: 1024,
				isDownloaded: true,
				isDownloadable: true,
			},
			{
				id: "tiny",
				name: "Tiny",
				sizeBytes: 512,
				isDownloaded: true,
				isDownloadable: true,
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
