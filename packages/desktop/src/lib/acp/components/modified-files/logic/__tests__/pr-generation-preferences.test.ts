import { describe, expect, it } from "bun:test";

import {
	buildPrGenerationRequestConfig,
	buildPrGenerationPrefsForAgentSelection,
} from "../pr-generation-preferences.js";

const MODEL_A = { id: "model-a", name: "Model A" };
const MODEL_B = { id: "model-b", name: "Model B" };

describe("pr-generation-preferences", () => {
	it("clears a stale model override when the selected agent changes", () => {
		const prefs = buildPrGenerationPrefsForAgentSelection(
			"agent-b",
			"model-a",
			"custom instructions",
			[MODEL_B],
		);

		expect(prefs).toEqual({
			agentId: "agent-b",
			customPrompt: "custom instructions",
		});
	});

	it("omits an invalid model override from the create-pr request config", () => {
		const config = buildPrGenerationRequestConfig(
			"agent-b",
			"model-a",
			"custom instructions",
			[MODEL_B],
		);

		expect(config).toEqual({
			agentId: "agent-b",
			customPrompt: "custom instructions",
		});
	});

	it("retains a valid model override for the selected agent", () => {
		const config = buildPrGenerationRequestConfig(
			"agent-a",
			"model-a",
			undefined,
			[MODEL_A, MODEL_B],
		);

		expect(config).toEqual({
			agentId: "agent-a",
			modelId: "model-a",
		});
	});
});