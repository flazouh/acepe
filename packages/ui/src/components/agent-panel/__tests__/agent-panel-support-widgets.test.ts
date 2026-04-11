import { expect, test } from "bun:test";

import {
	AgentPanelPlanHeader,
	AgentPanelModifiedFileRow,
	AgentPanelModifiedFilesTrailingControls,
	AgentPanelModifiedFilesHeader,
	AgentPanelPermissionBar,
	AgentPanelPrCard,
	AgentPanelPrStatusCard,
	AgentPanelQueueCardStrip,
	AgentPanelTodoHeader,
} from "../index.js";
import {
	AgentPanelPlanHeader as RootAgentPanelPlanHeader,
	AgentPanelModifiedFileRow as RootAgentPanelModifiedFileRow,
	AgentPanelModifiedFilesTrailingControls as RootAgentPanelModifiedFilesTrailingControls,
	AgentPanelModifiedFilesHeader as RootAgentPanelModifiedFilesHeader,
	AgentPanelPermissionBar as RootAgentPanelPermissionBar,
	AgentPanelPrCard as RootAgentPanelPrCard,
	AgentPanelPrStatusCard as RootAgentPanelPrStatusCard,
	AgentPanelQueueCardStrip as RootAgentPanelQueueCardStrip,
	AgentPanelTodoHeader as RootAgentPanelTodoHeader,
} from "../../../index.js";

test("shared support widget exports are defined", () => {
	expect(AgentPanelPlanHeader).toBeDefined();
	expect(RootAgentPanelPlanHeader).toBeDefined();
	expect(AgentPanelModifiedFileRow).toBeDefined();
	expect(RootAgentPanelModifiedFileRow).toBeDefined();
	expect(AgentPanelModifiedFilesTrailingControls).toBeDefined();
	expect(RootAgentPanelModifiedFilesTrailingControls).toBeDefined();
	expect(AgentPanelModifiedFilesHeader).toBeDefined();
	expect(RootAgentPanelModifiedFilesHeader).toBeDefined();
	expect(AgentPanelPermissionBar).toBeDefined();
	expect(RootAgentPanelPermissionBar).toBeDefined();
	expect(AgentPanelPrCard).toBeDefined();
	expect(RootAgentPanelPrCard).toBeDefined();
	expect(AgentPanelPrStatusCard).toBeDefined();
	expect(RootAgentPanelPrStatusCard).toBeDefined();
	expect(AgentPanelQueueCardStrip).toBeDefined();
	expect(RootAgentPanelQueueCardStrip).toBeDefined();
	expect(AgentPanelTodoHeader).toBeDefined();
	expect(RootAgentPanelTodoHeader).toBeDefined();
});
