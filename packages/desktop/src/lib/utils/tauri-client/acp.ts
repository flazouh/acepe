import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import type { AgentInfo } from "../../acp/store/api.js";
import type { ResumeSessionResult } from "../../acp/store/types.js";
import type { InteractionReplyRequest } from "../../acp/types/interaction-reply-request.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type { SessionStateEnvelope } from "../../services/acp-types.js";
import { ACP_PREFIX } from "./commands.js";
import { invokeAsync } from "./invoke.js";
import type { CustomAgentConfig } from "./types.js";

const acpCommands = TAURI_COMMAND_CLIENT.acp;

export const acp = {
	initialize: (): ResultAsync<unknown, AppError> => {
		return acpCommands.initialize.invoke<unknown>();
	},

	newSession: (
		cwd: string,
		agentId?: string,
		launchToken?: string
	): ResultAsync<ResumeSessionResult, AppError> => {
		return acpCommands.new_session.invoke<ResumeSessionResult>({ cwd, agentId, launchToken });
	},

	listPreconnectionCommands: (
		cwd: string,
		agentId: string
	): ResultAsync<
		Array<{ name: string; description: string; input?: { hint: string } | null }>,
		AppError
	> => {
		return acpCommands.list_preconnection_commands.invoke<
			Array<{ name: string; description: string; input?: { hint: string } | null }>
		>({ cwd, agentId });
	},

	resumeSession: (
		sessionId: string,
		cwd: string,
		attemptId: number,
		agentId?: string,
		launchModeId?: string,
		openToken?: string
	): ResultAsync<void, AppError> => {
		return acpCommands.resume_session.invoke<void>({
			sessionId,
			cwd,
			attemptId,
			agentId,
			launchModeId,
			openToken,
		});
	},

	forkSession: (
		sessionId: string,
		cwd: string,
		agentId?: string
	): ResultAsync<ResumeSessionResult, AppError> => {
		return acpCommands.fork_session.invoke<ResumeSessionResult>({ sessionId, cwd, agentId });
	},

	setModel: (sessionId: string, modelId: string): ResultAsync<void, AppError> => {
		return acpCommands.set_model.invoke<void>({ sessionId, modelId });
	},

	setMode: (sessionId: string, modeId: string): ResultAsync<void, AppError> => {
		return acpCommands.set_mode.invoke<void>({ sessionId, modeId });
	},

	setSessionAutonomous: (sessionId: string, enabled: boolean): ResultAsync<void, AppError> => {
		return acpCommands.set_session_autonomous.invoke<void>({ sessionId, enabled });
	},

	setConfigOption: (
		sessionId: string,
		configId: string,
		value: string
	): ResultAsync<unknown, AppError> => {
		return acpCommands.set_config_option.invoke<unknown>({ sessionId, configId, value });
	},

	sendPrompt: (
		sessionId: string,
		request: ReadonlyArray<Record<string, unknown> & { type: string }>
	): ResultAsync<void, AppError> => {
		return acpCommands.send_prompt.invoke<void>({ sessionId, request });
	},

	cancel: (sessionId: string): ResultAsync<void, AppError> => {
		return acpCommands.cancel.invoke<void>({ sessionId });
	},

	replyPermission: (
		sessionId: string,
		permissionId: string,
		reply: "once" | "always" | "reject"
	): ResultAsync<void, AppError> => {
		return acpCommands.reply_permission.invoke<void>({ sessionId, permissionId, reply });
	},

	replyQuestion: (
		sessionId: string,
		questionId: string,
		answers: unknown
	): ResultAsync<void, AppError> => {
		return acpCommands.reply_question.invoke<void>({ sessionId, questionId, answers });
	},

	replyInteraction: (request: InteractionReplyRequest): ResultAsync<void, AppError> => {
		return acpCommands.reply_interaction.invoke<void>({
			request: {
				sessionId: request.sessionId,
				interactionId: request.interactionId,
				replyHandler: serializeInteractionReplyHandler(request.replyHandler),
				payload: serializeInteractionReplyPayload(request.payload),
			},
		});
	},

	respondInboundRequest: (
		sessionId: string,
		requestId: number,
		result: unknown
	): ResultAsync<void, AppError> => {
		return acpCommands.respond_inbound_request.invoke<void>({ sessionId, requestId, result });
	},

	listAgents: (): ResultAsync<AgentInfo[], AppError> => {
		return acpCommands.list_agents.invoke<AgentInfo[]>();
	},

	installAgent: (agentId: string): ResultAsync<void, AppError> => {
		return acpCommands.install_agent.invoke<void>({ agentId });
	},

	uninstallAgent: (agentId: string): ResultAsync<void, AppError> => {
		return acpCommands.uninstall_agent.invoke<void>({ agentId });
	},

	closeSession: (sessionId: string): ResultAsync<void, AppError> => {
		return acpCommands.close_session.invoke<void>({ sessionId });
	},

	registerCustomAgent: (config: CustomAgentConfig): ResultAsync<void, AppError> => {
		return acpCommands.register_custom_agent.invoke<void>({ config });
	},

	getEventBridgeInfo: (): ResultAsync<{ eventsUrl: string }, AppError> => {
		return acpCommands.get_event_bridge_info.invoke<{ eventsUrl: string }>();
	},

	getSessionState: (sessionId: string): ResultAsync<SessionStateEnvelope, AppError> => {
		return acpCommands.get_session_state.invoke<SessionStateEnvelope>({ sessionId });
	},

	rpcCall(method: string, params: Record<string, unknown>): ResultAsync<unknown, AppError> {
		const command = `${ACP_PREFIX}${method.replace("/", "_")}`;
		return invokeAsync(command, params);
	},
};

function serializeInteractionReplyHandler(
	replyHandler: InteractionReplyRequest["replyHandler"]
): Record<string, unknown> {
	return {
		kind: replyHandler.kind === "json-rpc" ? "json_rpc" : "http",
		requestId: String(replyHandler.requestId),
	};
}

function serializeInteractionReplyPayload(
	payload: InteractionReplyRequest["payload"]
): Record<string, unknown> {
	switch (payload.kind) {
		case "permission":
			return {
				kind: "permission",
				reply: payload.reply,
				option_id: payload.optionId,
			};
		case "question":
			return {
				kind: "question",
				answers: payload.answers,
				answer_map: payload.answerMap,
			};
		case "question_cancel":
			return {
				kind: "question_cancel",
			};
		case "plan_approval":
			return {
				kind: "plan_approval",
				approved: payload.approved,
			};
	}
}
