/**
 * Interaction-reply handlers for the agent panel controller.
 *
 * Extracted verbatim from agent-panel.svelte. These handlers read reactive
 * scalars via accessor functions and act through stores/api; none of them
 * write component-local `$state`, so they live cleanly outside the component.
 */

import type {
	AgentPanelPlanActionEvent,
	AgentPanelQuestionSelectEvent,
	AgentToolFileSelectEvent,
} from "@acepe/ui/agent-panel";
import { toast } from "svelte-sonner";
import { api } from "../../../store/api.js";
import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { PermissionStore } from "../../../store/permission-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import {
	createLegacyInteractionReplyHandler,
	normalizeInteractionReplyHandler,
} from "../../../types/reply-handler.js";
import { resolveProjectFileReference } from "../../messages/logic/file-chip-diff-enhancer.js";

export interface AgentPanelInteractionHandlerDeps {
	getSessionId: () => string | null;
	getEffectiveProjectPath: () => string | null;
	getSessionProjectPath: () => string | null;
	getEffectivePanelId: () => string;
	sessionStore: SessionStore;
	permissionStore: PermissionStore;
	panelStore: PanelStore;
}

export function createAgentPanelInteractionHandlers(deps: AgentPanelInteractionHandlerDeps) {
	function handleQuestionSelect(event: AgentPanelQuestionSelectEvent): void {
		const sessionId = deps.getSessionId();
		if (sessionId === null) {
			toast.error("Question is not ready yet.");
			return;
		}

		const semanticInteractionId = event.interactionId ?? event.entryId;
		const interaction = deps.sessionStore.getSessionQuestionInteraction(
			sessionId,
			semanticInteractionId
		);
		if (interaction === null) {
			toast.error("Question is no longer available.");
			return;
		}

		const payload = interaction.payload.Question;
		const question = payload.questions[event.questionIndex];
		if (question === undefined) {
			toast.error("Question option is no longer available.");
			return;
		}

		const replyHandler =
			normalizeInteractionReplyHandler(interaction.reply_handler ?? payload.replyHandler) ??
			createLegacyInteractionReplyHandler(interaction.id, interaction.json_rpc_request_id);
		const answers = [
			{
				questionIndex: event.questionIndex,
				answers: [event.label],
			},
		];
		const answerMap: Record<string, string | string[]> = {};
		answerMap[question.question] = question.multiSelect ? [event.label] : event.label;

		void api
			.replyInteraction({
				sessionId: interaction.session_id,
				interactionId: interaction.id,
				replyHandler,
				payload: {
					kind: "question",
					answers,
					answerMap,
				},
			})
			.match(
				() => {},
				(error) => {
					toast.error(`Failed to answer question: ${error.message}`);
				}
			);
	}

	function handleToolFileSelect(event: AgentToolFileSelectEvent): void {
		const projectPath = deps.getEffectiveProjectPath() ?? deps.getSessionProjectPath();
		if (!projectPath) {
			toast.error("No project is available for this file.");
			return;
		}

		const fileReference = resolveProjectFileReference(event.filePath, projectPath);
		deps.panelStore.openFilePanel(fileReference.filePath, projectPath, {
			ownerPanelId: deps.getEffectivePanelId(),
			...(fileReference.targetLine !== undefined ? { targetLine: fileReference.targetLine } : {}),
			...(fileReference.targetColumn !== undefined
				? { targetColumn: fileReference.targetColumn }
				: {}),
		});
	}

	function findPermissionForPlanAction(event: AgentPanelPlanActionEvent) {
		const sessionId = deps.getSessionId();
		if (!sessionId) {
			return undefined;
		}
		if (event.toolCallId === undefined) {
			return undefined;
		}

		return deps.permissionStore.getForToolCall(sessionId, event.toolCallId);
	}

	function replyToPlanPermission(event: AgentPanelPlanActionEvent, reply: "once" | "reject"): void {
		const permission = findPermissionForPlanAction(event);
		if (permission === undefined) {
			toast.error("Plan approval is no longer available.");
			return;
		}

		void deps.permissionStore.reply(permission.id, reply).match(
			() => {},
			(error) => {
				toast.error(`Failed to answer plan approval: ${error.message}`);
			}
		);
	}

	function handlePlanBuild(event: AgentPanelPlanActionEvent): void {
		replyToPlanPermission(event, "once");
	}

	function handlePlanCancel(event: AgentPanelPlanActionEvent): void {
		replyToPlanPermission(event, "reject");
	}

	function isPlanActionAvailable(event: AgentPanelPlanActionEvent): boolean {
		return findPermissionForPlanAction(event) !== undefined;
	}

	return {
		handleQuestionSelect,
		handleToolFileSelect,
		findPermissionForPlanAction,
		replyToPlanPermission,
		handlePlanBuild,
		handlePlanCancel,
		isPlanActionAvailable,
	};
}
