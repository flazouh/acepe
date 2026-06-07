import {
	AGENT_PANEL_ACTION_IDS,
	type AgentPanelActionDescriptor,
	type AgentPanelPlanSidebarItem,
} from "@acepe/ui/agent-panel/types";
import type { SessionPlanResponse } from "../../../../services/claude-history.js";

function derivePlanItems(plan: SessionPlanResponse): readonly AgentPanelPlanSidebarItem[] {
	const numberedItems: AgentPanelPlanSidebarItem[] = [];
	const checkboxItems: AgentPanelPlanSidebarItem[] = [];
	const lines = plan.content.split(/\r?\n/);

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
		if (numberedMatch) {
			numberedItems.push({
				id: `plan-numbered-${numberedItems.length + 1}`,
				label: numberedMatch[1] ?? line,
				status: "pending",
			});
			continue;
		}

		const checkboxMatch = line.match(/^- \[( |x|-)\]\s+(.+)$/i);
		if (!checkboxMatch) {
			continue;
		}

		let status: "pending" | "in_progress" | "done" | "blocked" = "pending";
		if ((checkboxMatch[1] ?? "").toLowerCase() === "x") {
			status = "done";
		}
		if ((checkboxMatch[1] ?? "") === "-") {
			status = "in_progress";
		}

		checkboxItems.push({
			id: `plan-checkbox-${checkboxItems.length + 1}`,
			label: checkboxMatch[2] ?? line,
			status,
		});
	}

	if (checkboxItems.length > 0) {
		return checkboxItems;
	}

	if (numberedItems.length > 0) {
		return numberedItems;
	}

	if (plan.summary) {
		return [
			{
				id: "plan-summary",
				label: plan.title,
				status: "in_progress",
				description: plan.summary,
			},
		];
	}

	return [];
}

export function buildDesktopPlanSidebar(
	plan: SessionPlanResponse | null | undefined,
	actions?: readonly AgentPanelActionDescriptor[]
) {
	if (!plan) {
		return null;
	}

	return {
		title: plan.title,
		items: derivePlanItems(plan),
		actions: actions ?? [
			{
				id: AGENT_PANEL_ACTION_IDS.plan.openDialog,
				label: "Open plan",
				state: "enabled",
			},
		],
	};
}
