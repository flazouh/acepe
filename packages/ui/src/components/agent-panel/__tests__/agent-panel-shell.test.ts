import { expect, test } from "bun:test";

import {
	AgentPanelFooterChrome,
	AgentPanelShell,
	AgentPanelStatePanel,
} from "../index.js";
import {
	AgentPanelFooterChrome as RootAgentPanelFooterChrome,
	AgentPanelShell as RootAgentPanelShell,
	AgentPanelStatePanel as RootAgentPanelStatePanel,
} from "../../../index.js";

test("shared shell exports are defined", () => {
	expect(AgentPanelShell).toBeDefined();
	expect(AgentPanelStatePanel).toBeDefined();
	expect(AgentPanelFooterChrome).toBeDefined();
	expect(RootAgentPanelShell).toBeDefined();
	expect(RootAgentPanelStatePanel).toBeDefined();
	expect(RootAgentPanelFooterChrome).toBeDefined();
});
