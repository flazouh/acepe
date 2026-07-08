import { expect, test } from "bun:test";
import {
	AgentPanelErrorCard,
	AgentPanelInstallCard,
	AgentPanelPreSessionWorktreeCard,
	AgentPanelWorktreeSetupCard,
	AgentPanelWorktreeStatusDisplay,
} from "../index.js";
import {
	AgentPanelErrorCard as RootAgentPanelErrorCard,
	AgentPanelInstallCard as RootAgentPanelInstallCard,
	AgentPanelPreSessionWorktreeCard as RootAgentPanelPreSessionWorktreeCard,
	AgentPanelWorktreeSetupCard as RootAgentPanelWorktreeSetupCard,
	AgentPanelWorktreeStatusDisplay as RootAgentPanelWorktreeStatusDisplay,
} from "../../../index.js";

test("shared leaf widget exports are defined", () => {
	expect(AgentPanelErrorCard).toBeDefined();
	expect(AgentPanelInstallCard).toBeDefined();
	expect(AgentPanelPreSessionWorktreeCard).toBeDefined();
	expect(AgentPanelWorktreeSetupCard).toBeDefined();
	expect(AgentPanelWorktreeStatusDisplay).toBeDefined();
	expect(RootAgentPanelErrorCard).toBeDefined();
	expect(RootAgentPanelInstallCard).toBeDefined();
	expect(RootAgentPanelPreSessionWorktreeCard).toBeDefined();
	expect(RootAgentPanelWorktreeSetupCard).toBeDefined();
	expect(RootAgentPanelWorktreeStatusDisplay).toBeDefined();
});
