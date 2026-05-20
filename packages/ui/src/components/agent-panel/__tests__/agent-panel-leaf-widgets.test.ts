import { expect, test } from "bun:test";
import {
	AgentPanelErrorCard,
	AgentPanelInstallCard,
	AgentPanelWorktreeTogglePill,
	AgentPanelScrollToBottomButton,
	AgentPanelWorktreeSetupCard,
	AgentPanelWorktreeStatusDisplay,
} from "../index.js";
import {
	AgentPanelErrorCard as RootAgentPanelErrorCard,
	AgentPanelInstallCard as RootAgentPanelInstallCard,
	AgentPanelWorktreeTogglePill as RootAgentPanelWorktreeTogglePill,
	AgentPanelScrollToBottomButton as RootAgentPanelScrollToBottomButton,
	AgentPanelWorktreeSetupCard as RootAgentPanelWorktreeSetupCard,
	AgentPanelWorktreeStatusDisplay as RootAgentPanelWorktreeStatusDisplay,
} from "../../../index.js";

test("shared leaf widget exports are defined", () => {
	expect(AgentPanelScrollToBottomButton).toBeDefined();
	expect(AgentPanelErrorCard).toBeDefined();
	expect(AgentPanelInstallCard).toBeDefined();
	expect(AgentPanelWorktreeTogglePill).toBeDefined();
	expect(AgentPanelWorktreeSetupCard).toBeDefined();
	expect(AgentPanelWorktreeStatusDisplay).toBeDefined();
	expect(RootAgentPanelScrollToBottomButton).toBeDefined();
	expect(RootAgentPanelErrorCard).toBeDefined();
	expect(RootAgentPanelInstallCard).toBeDefined();
	expect(RootAgentPanelWorktreeTogglePill).toBeDefined();
	expect(RootAgentPanelWorktreeSetupCard).toBeDefined();
	expect(RootAgentPanelWorktreeStatusDisplay).toBeDefined();
});
