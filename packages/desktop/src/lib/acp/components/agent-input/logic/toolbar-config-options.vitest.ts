import { describe, expect, it } from "vitest";

import { getToolbarConfigOptions } from "./toolbar-config-options.js";

describe("toolbar-config-options", () => {
	it("filters out duplicated mode and model selectors", () => {
		expect(
			getToolbarConfigOptions([
				{
					id: "mode",
					name: "Mode",
					category: "mode",
					type: "select",
					currentValue: "build",
					options: [{ name: "Build", value: "build" }],
				},
				{
					id: "model",
					name: "Model",
					category: "model",
					type: "select",
					currentValue: "gpt-5-codex",
					options: [{ name: "GPT-5 Codex", value: "gpt-5-codex" }],
				},
				{
					id: "fast_mode",
					name: "Fast Mode",
					category: "fast_mode",
					type: "boolean",
					currentValue: false,
					presentation: "compactSpeed",
				},
			])
		).toEqual([
			{
				id: "fast_mode",
				name: "Fast Mode",
				category: "fast_mode",
				type: "boolean",
				currentValue: false,
					presentation: "compactSpeed",
			},
		]);
	});

	it("keeps selectable reasoning and service tier controls", () => {
		expect(
			getToolbarConfigOptions([
				{
					id: "thought_level",
					name: "Reasoning",
					category: "thought_level",
					type: "select",
					currentValue: "medium",
					presentation: "compactReasoning",
					options: [
						{ name: "Low", value: "low" },
						{ name: "Medium", value: "medium" },
					],
				},
				{
					id: "service_tier",
					name: "Fast Mode",
					category: "service_tier",
					type: "select",
					currentValue: "standard",
					presentation: "compactSpeed",
					options: [
						{ name: "Standard", value: "standard" },
						{ name: "Fast", value: "fast" },
					],
				},
			])
		).toEqual([
			{
				id: "thought_level",
				name: "Reasoning",
				category: "thought_level",
				type: "select",
				currentValue: "medium",
					presentation: "compactReasoning",
				options: [
					{ name: "Low", value: "low" },
					{ name: "Medium", value: "medium" },
				],
			},
			{
				id: "service_tier",
				name: "Fast Mode",
				category: "service_tier",
				type: "select",
				currentValue: "standard",
					presentation: "compactSpeed",
				options: [
					{ name: "Standard", value: "standard" },
					{ name: "Fast", value: "fast" },
				],
			},
		]);
	});

	it("keeps reasoning controls when model ids look like effort variants without canonical display metadata", () => {
		expect(
			getToolbarConfigOptions(
				[
					{
						id: "thought_level",
						name: "Reasoning Effort",
						category: "thought_level",
						type: "select",
						currentValue: "medium",
					presentation: "compactReasoning",
						options: [
							{ name: "Low", value: "low" },
							{ name: "Medium", value: "medium" },
						],
					},
					{
						id: "service_tier",
						name: "Fast Mode",
						category: "service_tier",
						type: "select",
						currentValue: "standard",
					presentation: "compactSpeed",
						options: [
							{ name: "Standard", value: "standard" },
							{ name: "Fast", value: "fast" },
						],
					},
				],
				[
					{ id: "gpt-5.2-codex/low", name: "gpt-5.2-codex/low" },
					{ id: "gpt-5.2-codex/medium", name: "gpt-5.2-codex/medium" },
					{ id: "gpt-5.2-codex/high", name: "gpt-5.2-codex/high" },
				]
			)
		).toEqual([
			{
				id: "thought_level",
				name: "Reasoning Effort",
				category: "thought_level",
				type: "select",
				currentValue: "medium",
					presentation: "compactReasoning",
				options: [
					{ name: "Low", value: "low" },
					{ name: "Medium", value: "medium" },
				],
			},
			{
				id: "service_tier",
				name: "Fast Mode",
				category: "service_tier",
				type: "select",
				currentValue: "standard",
					presentation: "compactSpeed",
				options: [
					{ name: "Standard", value: "standard" },
					{ name: "Fast", value: "fast" },
				],
			},
		]);
	});

	it("drops reasoning controls when canonical model display already owns effort", () => {
		expect(
			getToolbarConfigOptions(
				[
					{
						id: "thought_level",
						name: "Reasoning Effort",
						category: "thought_level",
						type: "select",
						currentValue: "medium",
					presentation: "compactReasoning",
						options: [
							{ name: "Low", value: "low" },
							{ name: "Medium", value: "medium" },
						],
					},
					{
						id: "service_tier",
						name: "Fast Mode",
						category: "service_tier",
						type: "select",
						currentValue: "standard",
					presentation: "compactSpeed",
						options: [
							{ name: "Standard", value: "standard" },
							{ name: "Fast", value: "fast" },
						],
					},
				],
				[
					{ id: "gpt-5.2-codex/low", name: "gpt-5.2-codex/low" },
					{ id: "gpt-5.2-codex/medium", name: "gpt-5.2-codex/medium" },
				],
				{
					groups: [
						{
							label: "GPT-5.2 Codex",
							models: [
								{ modelId: "gpt-5.2-codex/low", displayName: "low" },
								{ modelId: "gpt-5.2-codex/medium", displayName: "medium" },
							],
						},
					],
					presentation: {
						displayFamily: "codexReasoningEffort",
						usageMetrics: "spendAndContext",
					},
				}
			)
		).toEqual([
			{
				id: "service_tier",
				name: "Fast Mode",
				category: "service_tier",
				type: "select",
				currentValue: "standard",
					presentation: "compactSpeed",
				options: [
					{ name: "Standard", value: "standard" },
					{ name: "Fast", value: "fast" },
				],
			},
		]);
	});

	it("drops non-interactive options without values to choose from", () => {
		expect(
			getToolbarConfigOptions([
				{
					id: "status",
					name: "Status",
					category: "status",
					type: "label",
					currentValue: "ready",
					presentation: "advanced",
				},
			])
		).toEqual([]);
	});

	it("drops provider controls that are already represented by mode and autonomous UI", () => {
		expect(
			getToolbarConfigOptions([
				{
					id: "reasoning_effort",
					name: "Reasoning Effort",
					category: "reasoning",
					type: "select",
					currentValue: "medium",
					presentation: "compactReasoning",
					options: [
						{ name: "Low", value: "low" },
						{ name: "Medium", value: "medium" },
					],
				},
				{
					id: "agent",
					name: "Agent",
					category: "agent",
					type: "select",
					currentValue: "copilot",
					presentation: "hidden",
					options: [{ name: "Copilot", value: "copilot" }],
				},
				{
					id: "allow_all",
					name: "Allow All",
					category: "permission",
					type: "boolean",
					currentValue: false,
					presentation: "hidden",
				},
			])
		).toEqual([
			{
				id: "reasoning_effort",
				name: "Reasoning Effort",
				category: "reasoning",
				type: "select",
				currentValue: "medium",
					presentation: "compactReasoning",
				options: [
					{ name: "Low", value: "low" },
					{ name: "Medium", value: "medium" },
				],
			},
		]);
	});
});
