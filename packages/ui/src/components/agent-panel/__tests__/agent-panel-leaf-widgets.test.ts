import { expect, test } from "bun:test";
import {
	AgentPanelErrorCard,
	AgentPanelInstallCard,
	AgentPanelScrollToBottomButton,
	AgentPanelWorktreeSetupCard,
} from "../index.js";
import {
	AgentPanelErrorCard as RootAgentPanelErrorCard,
	AgentPanelInstallCard as RootAgentPanelInstallCard,
	AgentPanelScrollToBottomButton as RootAgentPanelScrollToBottomButton,
	AgentPanelWorktreeSetupCard as RootAgentPanelWorktreeSetupCard,
} from "../../../index.js";

test("shared leaf widget exports are defined", () => {
	expect(AgentPanelScrollToBottomButton).toBeDefined();
	expect(AgentPanelErrorCard).toBeDefined();
	expect(AgentPanelInstallCard).toBeDefined();
	expect(AgentPanelWorktreeSetupCard).toBeDefined();
	expect(RootAgentPanelScrollToBottomButton).toBeDefined();
	expect(RootAgentPanelErrorCard).toBeDefined();
	expect(RootAgentPanelInstallCard).toBeDefined();
	expect(RootAgentPanelWorktreeSetupCard).toBeDefined();
});
