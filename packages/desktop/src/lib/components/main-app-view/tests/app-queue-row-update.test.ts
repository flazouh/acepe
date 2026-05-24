import { describe, expect, it } from "vitest";
import type { QueueUpdateInput } from "$lib/acp/store/index.js";
import { resolveQueueUpdateInputs } from "../logic/app-queue-row-update.js";

describe("resolveQueueUpdateInputs", () => {
	it("uses an empty queue while derived queue inputs are not ready", () => {
		expect(resolveQueueUpdateInputs(undefined)).toEqual([]);
		expect(resolveQueueUpdateInputs(null)).toEqual([]);
	});

	it("preserves ready queue inputs", () => {
		const inputs: QueueUpdateInput[] = [];

		expect(resolveQueueUpdateInputs(inputs)).toBe(inputs);
	});
});
