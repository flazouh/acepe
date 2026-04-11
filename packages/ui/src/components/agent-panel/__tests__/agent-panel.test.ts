import { expect, test } from "bun:test";

import { AgentPanel } from "../index.js";
import { AgentPanel as RootAgentPanel } from "../../../index.js";

test("shared agent panel root exports are defined", () => {
	expect(AgentPanel).toBeDefined();
	expect(RootAgentPanel).toBeDefined();
});
