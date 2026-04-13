import { expect, test } from "bun:test";
import {
	AgentPanelErrorCard,
	AgentPanelInstallCard,
	AgentPanelPreSessionWorktreeCard,
	AgentPanelScrollToBottomButton,
	AgentPanelWorktreeSetupCard,
	AgentPanelWorktreeStatusDisplay,
} from "../index.js";
import {
	AgentPanelErrorCard as RootAgentPanelErrorCard,
	AgentPanelInstallCard as RootAgentPanelInstallCard,
	AgentPanelPreSessionWorktreeCard as RootAgentPanelPreSessionWorktreeCard,
	AgentPanelScrollToBottomButton as RootAgentPanelScrollToBottomButton,
	AgentPanelWorktreeSetupCard as RootAgentPanelWorktreeSetupCard,
	AgentPanelWorktreeStatusDisplay as RootAgentPanelWorktreeStatusDisplay,
} from "../../../index.js";

test("shared leaf widget exports are defined", () => {
	expect(AgentPanelScrollToBottomButton).toBeDefined();
	expect(AgentPanelErrorCard).toBeDefined();
	expect(AgentPanelInstallCard).toBeDefined();
	expect(AgentPanelPreSessionWorktreeCard).toBeDefined();
	expect(AgentPanelWorktreeSetupCard).toBeDefined();
	expect(AgentPanelWorktreeStatusDisplay).toBeDefined();
	expect(RootAgentPanelScrollToBottomButton).toBeDefined();
	expect(RootAgentPanelErrorCard).toBeDefined();
	expect(RootAgentPanelInstallCard).toBeDefined();
	expect(RootAgentPanelPreSessionWorktreeCard).toBeDefined();
	expect(RootAgentPanelWorktreeSetupCard).toBeDefined();
	expect(RootAgentPanelWorktreeStatusDisplay).toBeDefined();
});
