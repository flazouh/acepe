import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";

import { AgentError, AppError } from "../../acp/errors/app-error.js";
import type { AgentInfo } from "../../acp/store/api.js";
import type { ResumeSessionResult } from "../../acp/store/types.js";
import type { InteractionReplyRequest } from "../../acp/types/interaction-reply-request.js";
import type {
	ComposerMcpCatalog,
	ResolvedCapabilities,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateEnvelope,
} from "../../services/acp-types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import { ACP_PREFIX } from "./commands.js";
import { invokeAsync } from "./invoke.js";
import type { CustomAgentConfig } from "./types.js";

const acpCommands = TAURI_COMMAND_CLIENT.acp;

interface EventBridgeInfo {
	readonly eventsUrl: string;
}

interface SessionConnectionReadiness {
	readonly graphRevision: number;
	readonly lifecycle: SessionGraphLifecycle;
	readonly capabilities: SessionGraphCapabilities;
}

let cachedEventBridgeInfo: EventBridgeInfo | null = null;
let pendingEventBridgeInfo: Promise<EventBridgeInfo> | null = null;

function toEventBridgeError(error: unknown): AppError {
	if (error instanceof AppError) {
		return error;
	}
	return new AgentError(
		"get_event_bridge_info",
		error instanceof Error ? error : new Error(String(error))
	);
}

function getCachedEventBridgeInfo(): Effect.Effect<EventBridgeInfo, AppError> {
	if (cachedEventBridgeInfo !== null) {
		return Effect.succeed(cachedEventBridgeInfo);
	}
	const existingPending = pendingEventBridgeInfo;
	if (existingPending !== null) {
		return fromPromise(() => existingPending, toEventBridgeError);
	}

	const pending = Effect.runPromise(
		acpCommands.get_event_bridge_info.invoke<EventBridgeInfo>(),
	).then(
		(info) => {
			cachedEventBridgeInfo = info;
			pendingEventBridgeInfo = null;
			return info;
		},
		(error: unknown) => {
			pendingEventBridgeInfo = null;
			throw error;
		},
	);
	pendingEventBridgeInfo = pending;

	return fromPromise(() => pending, toEventBridgeError);
}

export const acp = {
	initialize: (): Effect.Effect<unknown, AppError> => {
		return acpCommands.initialize.invoke<unknown>();
	},

	authenticateAgent: (agentId: string): Effect.Effect<void, AppError> => {
		return acpCommands.authenticate_agent.invoke<void>({ agentId });
	},

	cancelAgentAuthentication: (agentId: string): Effect.Effect<void, AppError> => {
		return acpCommands.cancel_agent_authentication.invoke<void>({ agentId });
	},

	newSession: (
		cwd: string,
		agentId?: string,
		launchToken?: string,
		initialModelId?: string,
		initialModeId?: string
	): Effect.Effect<ResumeSessionResult, AppError> => {
		return acpCommands.new_session.invoke<ResumeSessionResult>({
			cwd,
			agentId,
			launchToken,
			initialModelId,
			initialModeId,
		});
	},

	listPreconnectionCommands: (
		cwd: string,
		agentId: string
	): Effect.Effect<
		Array<{ name: string; description: string; input?: { hint: string } | null }>,
		AppError
	> => {
		return acpCommands.list_preconnection_commands.invoke<
			Array<{ name: string; description: string; input?: { hint: string } | null }>
		>({ cwd, agentId });
	},

	listPreconnectionCapabilities: (
		cwd: string,
		agentId: string
	): Effect.Effect<ResolvedCapabilities, AppError> => {
		return invokeAsync(`${ACP_PREFIX}list_preconnection_capabilities`, {
			cwd,
			agentId,
		}) as Effect.Effect<ResolvedCapabilities, AppError>;
	},

	getComposerMcpCatalog: (
		cwd: string,
		agentId: string,
		sessionId: string | null
	): Effect.Effect<ComposerMcpCatalog, AppError> => {
		return acpCommands.get_composer_mcp_catalog.invoke<ComposerMcpCatalog>({
			cwd,
			agentId,
			sessionId,
		});
	},

	resumeSession: (
		sessionId: string,
		cwd: string,
		attemptId: number,
		agentId?: string,
		launchModeId?: string,
		openToken?: string
	): Effect.Effect<void, AppError> => {
		return acpCommands.resume_session.invoke<void>({
			sessionId,
			cwd,
			attemptId,
			agentId,
			launchModeId,
			openToken,
		});
	},

	unarchiveSession: (sessionId: string): Effect.Effect<void, AppError> => {
		return acpCommands.unarchive_session.invoke<void>({ sessionId });
	},

	forkSession: (
		sessionId: string,
		cwd: string,
		agentId?: string
	): Effect.Effect<ResumeSessionResult, AppError> => {
		return acpCommands.fork_session.invoke<ResumeSessionResult>({ sessionId, cwd, agentId });
	},

	setModel: (sessionId: string, modelId: string): Effect.Effect<void, AppError> => {
		return acpCommands.set_model.invoke<void>({ sessionId, modelId });
	},

	setMode: (sessionId: string, modeId: string): Effect.Effect<void, AppError> => {
		return acpCommands.set_mode.invoke<void>({ sessionId, modeId });
	},

	setSessionAutonomous: (sessionId: string, enabled: boolean): Effect.Effect<void, AppError> => {
		return acpCommands.set_session_autonomous.invoke<void>({ sessionId, enabled });
	},

	setConfigOption: (
		sessionId: string,
		configId: string,
		value: string
	): Effect.Effect<unknown, AppError> => {
		return acpCommands.set_config_option.invoke<unknown>({ sessionId, configId, value });
	},

	sendPrompt: (
		sessionId: string,
		request: ReadonlyArray<Record<string, unknown> & { type: string }>,
		attemptId?: string
	): Effect.Effect<void, AppError> => {
		return acpCommands.send_prompt.invoke<void>({ sessionId, request, attemptId });
	},

	cancel: (sessionId: string): Effect.Effect<void, AppError> => {
		return acpCommands.cancel.invoke<void>({ sessionId });
	},

	replyInteraction: (request: InteractionReplyRequest): Effect.Effect<void, AppError> => {
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
	): Effect.Effect<void, AppError> => {
		return acpCommands.respond_inbound_request.invoke<void>({ sessionId, requestId, result });
	},

	listAgents: (): Effect.Effect<AgentInfo[], AppError> => {
		return acpCommands.list_agents.invoke<AgentInfo[]>();
	},

	installAgent: (agentId: string): Effect.Effect<void, AppError> => {
		return acpCommands.install_agent.invoke<void>({ agentId });
	},

	uninstallAgent: (agentId: string): Effect.Effect<void, AppError> => {
		return acpCommands.uninstall_agent.invoke<void>({ agentId });
	},

	closeSession: (sessionId: string): Effect.Effect<void, AppError> => {
		return acpCommands.close_session.invoke<void>({ sessionId });
	},

	registerCustomAgent: (config: CustomAgentConfig): Effect.Effect<void, AppError> => {
		return acpCommands.register_custom_agent.invoke<void>({ config });
	},

	getEventBridgeInfo: (): Effect.Effect<EventBridgeInfo, AppError> => {
		return getCachedEventBridgeInfo();
	},

	getSessionState: (sessionId: string): Effect.Effect<SessionStateEnvelope, AppError> => {
		return acpCommands.get_session_state.invoke<SessionStateEnvelope>({ sessionId });
	},

	getSessionConnectionReadiness: (
		sessionId: string
	): Effect.Effect<SessionConnectionReadiness, AppError> => {
		return acpCommands.get_session_connection_readiness.invoke<SessionConnectionReadiness>({
			sessionId,
		});
	},

	rpcCall(method: string, params: Record<string, unknown>): Effect.Effect<unknown, AppError> {
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
		case "computer_permission":
			return {
				kind: "computer_permission",
				accepted: payload.accepted,
				scope: payload.scope,
			};
	}
}
