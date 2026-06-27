import { describe, expect, test } from "bun:test";

import {
	REASONING_EFFORT_SELECTOR_SIDE_OFFSET,
	REASONING_EFFORT_SELECTOR_TRIGGER_SIZE,
	REASONING_EFFORT_SELECTOR_VARIANT,
} from "./agent-input-reasoning-effort-trigger-props.js";

describe("agent input reasoning effort trigger props", () => {
	test("uses shared composer brain trigger chrome", () => {
		expect(REASONING_EFFORT_SELECTOR_VARIANT).toBe("ghost");
		expect(REASONING_EFFORT_SELECTOR_TRIGGER_SIZE).toBe("setupChipIcon");
		expect(REASONING_EFFORT_SELECTOR_SIDE_OFFSET).toBe(8);
	});
});
