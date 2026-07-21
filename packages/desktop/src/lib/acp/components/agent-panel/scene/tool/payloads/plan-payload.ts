import type { JsonValue } from "../../../../../../services/converted-session-types.js";
import type { ToolCall } from "../../../../../types/tool-call.js";
import { parsePlanMarkdown } from "../../../../../utils/plan-parser.js";

export function readStringField(value: JsonValue | null | undefined, key: string): string | null {
	if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	const field = value[key];
	return typeof field === "string" && field.trim().length > 0 ? field : null;
}

export function normalizePlanString(value: string | null | undefined): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function mapPlanPayload(toolCall: ToolCall): {
	planTitle?: string | null;
	planContent?: string | null;
	planStatus?: "streaming" | "interactive" | "approved" | "rejected" | "building";
} {
	if (toolCall.kind !== "exit_plan_mode" && toolCall.kind !== "create_plan") {
		return {};
	}

	const rawPlan =
		(toolCall.arguments.kind === "planMode"
			? normalizePlanString(toolCall.arguments.plan)
			: null) ??
		readStringField(toolCall.result, "plan") ??
		readStringField(toolCall.result, "content");
	const planContent = rawPlan !== null && rawPlan !== undefined ? rawPlan : null;
	const parsedPlan = planContent !== null ? parsePlanMarkdown(planContent) : null;
	const planTitle =
		toolCall.arguments.kind === "planMode"
			? (normalizePlanString(toolCall.arguments.title) ?? parsedPlan?.title ?? null)
			: (parsedPlan?.title ?? null);

	return {
		planTitle,
		planContent,
		planStatus:
			toolCall.status === "failed"
				? "rejected"
				: toolCall.status === "completed"
					? "approved"
					: planContent !== null &&
							(toolCall.kind === "exit_plan_mode" || toolCall.awaitingPlanApproval === true)
						? "interactive"
						: toolCall.awaitingPlanApproval === true
							? "interactive"
							: "streaming",
	};
}
