import type { AppTabStatus } from "@acepe/ui/app-layout";

import type { TabBarTab } from "../../store/tab-bar-utils.js";

export function deriveAppTabStatus(
	tab: Pick<TabBarTab, "isUnseen" | "state" | "workBucket">
): AppTabStatus {
	if (tab.workBucket === "error") {
		return "error";
	}

	if (tab.state.pendingInput.kind !== "none") {
		return "question";
	}

	if (
		(tab.workBucket === "planning" || tab.workBucket === "working") &&
		tab.state.activity.kind !== "paused"
	) {
		return "running";
	}

	if (tab.isUnseen) {
		return "unseen";
	}

	return "idle";
}
