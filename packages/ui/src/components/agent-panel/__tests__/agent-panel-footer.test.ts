import { expect, test } from "bun:test";

import { AgentPanelFooter } from "../index.js";
import { AgentPanelFooter as RootAgentPanelFooter } from "../../../index.js";

test("shared footer export is defined", () => {
	expect(AgentPanelFooter).toBeDefined();
	expect(RootAgentPanelFooter).toBeDefined();
});
