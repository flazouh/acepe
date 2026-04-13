import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type { AgentInfo } from "../../acp/store/api.js";
import type { ResumeSessionResult } from "../../acp/store/types.js";
import type { InteractionReplyRequest } from "../../acp/types/interaction-reply-request.js";
import type { SessionProjectionSnapshot } from "../../services/acp-types.js";
import { ACP_PREFIX, CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";
import type { CustomAgentConfig } from "./types.js";

export const acp = {
	initialize: (): ResultAsync<unknown, AppError> => {
		return invokeAsync(CMD.acp.initialize);
	},

	newSession: (
		cwd: string,
		agentId?: string,
		launchToken?: string
	): ResultAsync<ResumeSessionResult, AppError> => {
		return invokeAsync(CMD.acp.new_session, { cwd, agentId, launchToken });
	},

	listPreconnectionCommands: (
		cwd: string,
		agentId: string
	): ResultAsync<
		Array<{ name: string; description: string; input?: { hint: string } | null }>,
		AppError
	> => {
		return invokeAsync(CMD.acp.list_preconnection_commands, { cwd, agentId });
	},

	resumeSession: (
		sessionId: string,
		cwd: string,
		attemptId: number,
		agentId?: string,
		launchModeId?: string
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.resume_session, {
			sessionId,
			cwd,
			attemptId,
			agentId,
			launchModeId,
		});
	},

	forkSession: (
		sessionId: string,
		cwd: string,
		agentId?: string
	): ResultAsync<ResumeSessionResult, AppError> => {
		return invokeAsync(CMD.acp.fork_session, { sessionId, cwd, agentId });
	},

	setModel: (sessionId: string, modelId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.set_model, { sessionId, modelId });
	},

	setMode: (sessionId: string, modeId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.set_mode, { sessionId, modeId });
	},

	setSessionAutonomous: (sessionId: string, enabled: boolean): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.set_session_autonomous, { sessionId, enabled });
	},

	setConfigOption: (
		sessionId: string,
		configId: string,
		value: string
	): ResultAsync<unknown, AppError> => {
		return invokeAsync(CMD.acp.set_config_option, { sessionId, configId, value });
	},

	sendPrompt: (
		sessionId: string,
		request: ReadonlyArray<Record<string, unknown> & { type: string }>
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.send_prompt, { sessionId, request });
	},

	cancel: (sessionId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.cancel, { sessionId });
	},

	replyPermission: (
		sessionId: string,
		permissionId: string,
		reply: "once" | "always" | "reject"
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.reply_permission, { sessionId, permissionId, reply });
	},

	replyQuestion: (
		sessionId: string,
		questionId: string,
		answers: unknown
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.reply_question, { sessionId, questionId, answers });
	},

	replyInteraction: (request: InteractionReplyRequest): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.reply_interaction, {
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
		return invokeAsync(CMD.acp.respond_inbound_request, { sessionId, requestId, result });
	},

	listAgents: (): ResultAsync<AgentInfo[], AppError> => {
		return invokeAsync(CMD.acp.list_agents);
	},

	installAgent: (agentId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.install_agent, { agentId });
	},

	uninstallAgent: (agentId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.uninstall_agent, { agentId });
	},

	closeSession: (sessionId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.close_session, { sessionId });
	},

	registerCustomAgent: (config: CustomAgentConfig): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.acp.register_custom_agent, { config });
	},

	getEventBridgeInfo: (): ResultAsync<{ eventsUrl: string }, AppError> => {
		return invokeAsync(CMD.acp.get_event_bridge_info);
	},

	getSessionProjection: (sessionId: string): ResultAsync<SessionProjectionSnapshot, AppError> => {
		return invokeAsync(CMD.acp.get_session_projection, { sessionId });
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
