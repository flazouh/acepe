import { expect, test } from "bun:test";

import {
	AgentAttachedFilePane,
	AgentPanelBrowserHeader,
	AgentPanelBrowserPanel,
	AgentPanelReviewContent,
	AgentPanelTerminalDrawer,
} from "../index.js";
import {
	AgentAttachedFilePane as RootAgentAttachedFilePane,
	AgentPanelBrowserHeader as RootAgentPanelBrowserHeader,
	AgentPanelBrowserPanel as RootAgentPanelBrowserPanel,
	AgentPanelReviewContent as RootAgentPanelReviewContent,
	AgentPanelTerminalDrawer as RootAgentPanelTerminalDrawer,
} from "../../../index.js";

test("shared optional surface exports are defined", () => {
	expect(AgentPanelReviewContent).toBeDefined();
	expect(RootAgentPanelReviewContent).toBeDefined();
	expect(AgentPanelTerminalDrawer).toBeDefined();
	expect(RootAgentPanelTerminalDrawer).toBeDefined();
	expect(AgentAttachedFilePane).toBeDefined();
	expect(RootAgentAttachedFilePane).toBeDefined();
	expect(AgentPanelBrowserHeader).toBeDefined();
	expect(RootAgentPanelBrowserHeader).toBeDefined();
	expect(AgentPanelBrowserPanel).toBeDefined();
	expect(RootAgentPanelBrowserPanel).toBeDefined();
});
