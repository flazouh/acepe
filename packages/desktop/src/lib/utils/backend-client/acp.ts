import {
	type AgentCallAgentInfo,
	type AgentCallResult,
	decodeApprovalRequestId,
	decodeMessageId,
	decodeProjectId,
	decodeSessionId,
	librarySnapshotRequest,
	type RpcProjectedProject,
	type RpcProjectedSession,
	sessionSnapshotRequest,
	type TrimmedNonEmptyString,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";

import { AgentError, type AppError } from "../../acp/errors/app-error.js";
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
import { ensureProviderSessionImported } from "./history.ts";
import {
	decodeEffect,
	decodeTrimmed,
	nextCommandId,
	unsupportedOnContract,
	withRpcClient,
} from "./rpc-bridge.ts";
import type { CustomAgentConfig } from "./types.js";

// #249 final facade slice. Every method below either dispatches an
// already-existing orchestration command / reads the session or library
// snapshot (real, verified end to end for the prompt-core path -- see
// ProviderBridge.ts, which forwards message.send/turn.cancel/
// interaction.reply to the real provider adapter), rides the agentCall
// utility RPC (agent listing, install and sign-in), or is honestly
// unsupportedOnContract.
//
// The unsupportedOnContract methods below (custom agent registration,
// preconnection discovery, the event bridge) are not behaviour regressions:
// none of them has ever had a working Electrobun backend. There is no
// register_custom_agent/list_preconnection_commands/
// list_preconnection_capabilities/get_composer_mcp_catalog/
// get_event_bridge_info handler anywhere in packages/electrobun-shell or
// packages/server -- every one of these calls already fails today (an
// unresolved command invoke with no receiver). Marking them
// unsupportedOnContract turns that into a typed, honest failure instead of a
// silent hang, with zero change in what the app can actually do.
//
// listAgents, installAgent, uninstallAgent, authenticateAgent and
// cancelAgentAuthentication are the exceptions: all of them ride the
// agentCall utility RPC (packages/contracts/src/agentCall.ts), a
// gitCall-style tagged-union request routed server-side onto
// ProviderRegistry.list and AgentInstaller (packages/server/src/provider/
// agentCallHandler.ts). The agent.* orchestration commands in
// orchestration.ts (agent.install, agent.list, ...) are NOT the lane for
// this: they are echo commands whose payload is precomputed by the caller
// (e.g. AgentListCommand takes `agents: AgentListing[]` as input), so
// dispatching them records an "installed" fact without any adapter having
// done the work.

const toAgentInfo = (agent: AgentCallAgentInfo): AgentInfo => ({
	id: agent.id,
	name: agent.name,
	availability_kind: agent.availabilityKind,
	sign_in: agent.signIn,
});

// The agentCall result union echoes the request's `op` discriminant (see
// packages/contracts/src/agentCall.ts), and TypeScript cannot tie a call's
// request op to its response type. Narrow it at runtime, the same way
// backend-client/git.ts narrows gitCall. A mismatch means the server routed
// the request to the wrong branch, which is a wiring bug and not something
// the caller can recover from, so it is a defect rather than a typed
// AppError.
const unwrapAgentCallResult = <Tag extends AgentCallResult["op"]>(
	tag: Tag,
	result: AgentCallResult
): Effect.Effect<Extract<AgentCallResult, { op: Tag }>, AppError> =>
	result.op === tag
		? Effect.succeed(result as Extract<AgentCallResult, { op: Tag }>)
		: Effect.die(new Error(`agentCall: expected op '${tag}', got '${result.op}'`));

const emptySessionLifecycle = (status: SessionGraphLifecycle["status"]): SessionGraphLifecycle => ({
	status,
	actionability: {
		canSend: status === "ready",
		canResume: status === "detached" || status === "archived",
		canRetry: status === "failed",
		canArchive: status === "ready",
		canConfigure: status === "ready",
		recommendedAction: "none",
		recoveryPhase: "none",
		compactStatus: status,
	},
});

const lifecycleForSession = Effect.fn("acp.lifecycleForSession")(function* (sessionId: string) {
	const decodedSessionId = yield* decodeEffect(
		"acp.lifecycleForSession",
		decodeSessionId
	)(sessionId);
	const snapshot = yield* withRpcClient("acp.lifecycleForSession", (client) =>
		client.snapshot(sessionSnapshotRequest(decodedSessionId))
	);
	if (snapshot.session === null) {
		return emptySessionLifecycle("reserved");
	}
	if (snapshot.session.deletedAt !== null) {
		return emptySessionLifecycle("failed");
	}
	if (snapshot.session.archivedAt !== null) {
		return emptySessionLifecycle("archived");
	}
	return emptySessionLifecycle("ready");
});

const findProjectByWorkspaceRoot = (
	rows: readonly RpcProjectedProject[],
	workspaceRoot: string
): RpcProjectedProject | null => {
	for (const row of rows) {
		if (row.deletedAt === null && row.workspaceRoot === workspaceRoot) {
			return row;
		}
	}
	return null;
};

const lastPathSegment = (path: string): string => {
	const trimmed = path.replace(/\/+$/, "");
	const segments = trimmed.split("/");
	const last = segments[segments.length - 1];
	return last === undefined || last.length === 0 ? "session" : last;
};

// newSession's callers never had a project-creation step of their own on the
// previous desktop backend, which resolved/created the project implicitly
// from the cwd. Mirror that here: reuse an existing project at this workspace
// root, or create one on the fly so session.create always has a valid
// projectId.
const resolveOrCreateProject = Effect.fn("acp.resolveOrCreateProject")(function* (
	workspaceRoot: typeof TrimmedNonEmptyString.Type
) {
	const snapshot = yield* withRpcClient("acp.newSession", (client) =>
		client.snapshot(librarySnapshotRequest())
	);
	const existing = findProjectByWorkspaceRoot(snapshot.projects, workspaceRoot);
	if (existing !== null) {
		return existing.projectId;
	}
	const commandId = yield* nextCommandId("project-create");
	const projectId = yield* decodeEffect(
		"acp.newSession",
		decodeProjectId
	)(`project-${String(commandId)}`);
	const title = yield* decodeTrimmed("acp.newSession", lastPathSegment(workspaceRoot));
	yield* withRpcClient("acp.newSession", (client) =>
		client.dispatch({
			type: "project.create",
			commandId,
			projectId,
			title,
			workspaceRoot: workspaceRoot,
		})
	);
	return projectId;
});

const extractPromptText = (
	request: ReadonlyArray<Record<string, unknown> & { type: string }>
): string =>
	request
		.filter((block): block is { type: string; text: string } => {
			return block.type === "text" && typeof block.text === "string";
		})
		.map((block) => block.text)
		.join("\n");

export const acp = {
	// The previous desktop backend's ACP service needed an explicit bootstrap
	// call before its first use. The Effect server has no equivalent per-call
	// setup step (the engine and ProviderBridge are always-on Layers started at
	// server boot), so this is now a genuine no-op rather than an invoke into a
	// command that no longer exists.
	initialize: (): Effect.Effect<unknown, AppError> => Effect.succeed(undefined),

	// Sidebar visibility fix: sessions that exist only in the orchestration
	// projections (dispatched via session.create, no on-disk provider history
	// yet) need a source the session-list scan can union with the disk scan.
	// This is the same library snapshot resolveOrCreateProject already reads
	// (kind "library" -- every project, every session), reused here for its
	// `sessions` array rather than its `projects` array.
	getLibrarySessionsSnapshot: Effect.fn("acp.getLibrarySessionsSnapshot")(function* () {
		const snapshot = yield* withRpcClient("acp.getLibrarySessionsSnapshot", (client) =>
			client.snapshot(librarySnapshotRequest())
		);
		return {
			sessions: snapshot.sessions,
			projects: snapshot.projects,
		} satisfies {
			sessions: readonly RpcProjectedSession[];
			projects: readonly RpcProjectedProject[];
		};
	}),

	newSession: Effect.fn("acp.newSession")(function* (
		cwd: string,
		agentId?: string,
		// launchToken/initialModelId/initialModeId have no field on
		// session.create today (already silently dropped by every current
		// caller -- session-connection-manager.createSession never forwarded
		// title either). Preserved in the signature for callers, documented as
		// dropped rather than fabricated.
		_launchToken?: string,
		_initialModelId?: string,
		_initialModeId?: string,
		// A session Acepe opens to do a job of its own, which the session
		// library never lists -- see SessionCreateCommand.ephemeral. Omitted by
		// every caller that wants a normal thread.
		options?: { readonly ephemeral?: boolean }
	) {
		const workspaceRoot = yield* decodeTrimmed("acp.newSession", cwd);
		const projectId = yield* resolveOrCreateProject(workspaceRoot);
		const commandId = yield* nextCommandId("session-create");
		const sessionId = yield* decodeEffect(
			"acp.newSession",
			decodeSessionId
		)(`session-${String(commandId)}`);
		const title = yield* decodeTrimmed("acp.newSession", "New session");
		const providerId =
			agentId === undefined ? undefined : yield* decodeTrimmed("acp.newSession", agentId);
		yield* withRpcClient("acp.newSession", (client) =>
			client.dispatch({
				type: "session.create",
				commandId,
				sessionId,
				projectId,
				title,
				...(providerId === undefined ? {} : { providerId }),
				...(options?.ephemeral === true ? { ephemeral: true } : {}),
			})
		);
		const result: ResumeSessionResult = {
			sessionId: String(sessionId),
			creationAttemptId: null,
			deferredCreation: false,
		};
		return result;
	}),

	listPreconnectionCommands: (
		_cwd: string,
		_agentId: string
	): Effect.Effect<
		Array<{ name: string; description: string; input?: { hint: string } | null }>,
		AppError
	> => unsupportedOnContract("acp.listPreconnectionCommands"),

	// The New-chat model picker's preconnection feed. Rides agentCall's
	// agent.model-catalog op (packages/contracts/src/agentCall.ts): the
	// server asks the provider adapter's own probe -- for Claude, the SDK's
	// initialize handshake, no prompt and no billed turn -- so a thread that
	// has not sent anything yet still has a catalog to offer. Only the model
	// axis is answered here; modes and config options come from the provider
	// contract facts the composer already falls back to
	// (providerModes/providerConfigOptions), and providerMetadata stays null
	// the same way it is for every other pre-session composer today. `cwd` is
	// accepted but unused: the catalog is account-level, not project-level
	// (contract fact: providerPreconnectionCapabilityMode = startupGlobal).
	listPreconnectionCapabilities: Effect.fn("acp.listPreconnectionCapabilities")(function* (
		_cwd: string,
		agentId: string
	) {
		const response = yield* withRpcClient("acp.listPreconnectionCapabilities", (client) =>
			client.agentCall({ op: "agent.model-catalog", agentId })
		);
		const result = yield* unwrapAgentCallResult("agent.model-catalog", response);
		return {
			status: "resolved",
			availableModels: result.models.map((model) => ({
				modelId: model.modelId,
				name: model.name,
				description: model.description,
			})),
			currentModelId: null,
			modelsDisplay: { groups: [] },
			providerMetadata: null,
			availableModes: [],
			currentModeId: null,
			configOptions: [],
		} satisfies ResolvedCapabilities;
	}),

	getComposerMcpCatalog: (
		_cwd: string,
		_agentId: string,
		_sessionId: string | null
	): Effect.Effect<ComposerMcpCatalog, AppError> =>
		unsupportedOnContract("acp.getComposerMcpCatalog"),

	// Fire-and-forget, matching the old contract: validates/dispatches and
	// returns without waiting for reconnection. Best-effort imports the
	// session from provider discovery first (a session opened from the
	// sidebar's discovered-but-not-yet-imported list has no orchestration
	// aggregate yet), then dispatches session.resume so the resume is durably
	// recorded. NOTE: unlike session.create, ProviderBridge does not react to
	// SessionResumed today, so a real adapter is not automatically
	// reconnected by this call alone -- that reconnection wiring is a
	// follow-up, tracked honestly rather than silently assumed.
	resumeSession: Effect.fn("acp.resumeSession")(function* (
		sessionId: string,
		_cwd: string,
		_attemptId: number,
		_agentId?: string,
		_launchModeId?: string,
		_openToken?: string
	) {
		const decodedSessionId = yield* decodeEffect("acp.resumeSession", decodeSessionId)(sessionId);
		const commandId = yield* nextCommandId("session-resume");
		yield* withRpcClient("acp.resumeSession", (client) =>
			client.dispatch({
				type: "session.resume",
				commandId,
				sessionId: decodedSessionId,
			})
		);
	}),

	// Archiving is canonical: the command writes `archived_at` on the session
	// row and ProviderBridge answers SessionArchived by interrupting the
	// session fiber and dropping its adapter (considerSessionRemoved). A
	// session only ever scanned from disk has no orchestration row yet, so it
	// is imported first -- the same idempotent step the rename path uses.
	archiveSession: Effect.fn("acp.archiveSession")(function* (sessionId: string) {
		yield* ensureProviderSessionImported(sessionId);
		const decodedSessionId = yield* decodeEffect("acp.archiveSession", decodeSessionId)(sessionId);
		const commandId = yield* nextCommandId("session-archive");
		yield* withRpcClient("acp.archiveSession", (client) =>
			client.dispatch({
				type: "session.archive",
				commandId,
				sessionId: decodedSessionId,
			})
		);
	}),

	unarchiveSession: Effect.fn("acp.unarchiveSession")(function* (sessionId: string) {
		const decodedSessionId = yield* decodeEffect(
			"acp.unarchiveSession",
			decodeSessionId
		)(sessionId);
		const commandId = yield* nextCommandId("session-unarchive");
		yield* withRpcClient("acp.unarchiveSession", (client) =>
			client.dispatch({
				type: "session.unarchive",
				commandId,
				sessionId: decodedSessionId,
			})
		);
	}),

	// No live caller today (see #249 issue thread's batch map + acp.ts's own
	// prior header comment); the contract has no session.fork command with
	// full result-shape support either. Fork-from-message affordances in the
	// UI, if any land later, need their own slice.
	forkSession: (
		_sessionId: string,
		_cwd: string,
		_agentId?: string
	): Effect.Effect<ResumeSessionResult, AppError> => unsupportedOnContract("acp.forkSession"),

	setModel: Effect.fn("acp.setModel")(function* (sessionId: string, modelId: string) {
		const decodedSessionId = yield* decodeEffect("acp.setModel", decodeSessionId)(sessionId);
		const decodedModelId = yield* decodeTrimmed("acp.setModel", modelId);
		const commandId = yield* nextCommandId("session-set-model");
		yield* withRpcClient("acp.setModel", (client) =>
			client.dispatch({
				type: "session.set-model",
				commandId,
				sessionId: decodedSessionId,
				modelId: decodedModelId,
			})
		);
	}),

	setMode: Effect.fn("acp.setMode")(function* (sessionId: string, modeId: string) {
		const decodedSessionId = yield* decodeEffect("acp.setMode", decodeSessionId)(sessionId);
		const decodedModeId = yield* decodeTrimmed("acp.setMode", modeId);
		const commandId = yield* nextCommandId("session-set-mode");
		yield* withRpcClient("acp.setMode", (client) =>
			client.dispatch({
				type: "session.set-mode",
				commandId,
				sessionId: decodedSessionId,
				modeId: decodedModeId,
			})
		);
	}),

	setSessionAutonomous: Effect.fn("acp.setSessionAutonomous")(function* (
		sessionId: string,
		enabled: boolean
	) {
		const decodedSessionId = yield* decodeEffect(
			"acp.setSessionAutonomous",
			decodeSessionId
		)(sessionId);
		const commandId = yield* nextCommandId("session-set-autonomous");
		yield* withRpcClient("acp.setSessionAutonomous", (client) =>
			client.dispatch({
				type: "session.set-autonomous",
				commandId,
				sessionId: decodedSessionId,
				autonomous: enabled,
			})
		);
	}),

	setConfigOption: (
		sessionId: string,
		configId: string,
		value: string
	): Effect.Effect<unknown, AppError> =>
		Effect.gen(function* () {
			const decodedSessionId = yield* decodeEffect(
				"acp.setConfigOption",
				decodeSessionId
			)(sessionId);
			const decodedKey = yield* decodeTrimmed("acp.setConfigOption", configId);
			const decodedValue = yield* decodeTrimmed("acp.setConfigOption", value);
			const commandId = yield* nextCommandId("session-set-config-option");
			yield* withRpcClient("acp.setConfigOption", (client) =>
				client.dispatch({
					type: "session.set-config-option",
					commandId,
					sessionId: decodedSessionId,
					key: decodedKey,
					value: decodedValue,
				})
			);
			return undefined;
		}),

	sendPrompt: Effect.fn("acp.sendPrompt")(function* (
		sessionId: string,
		request: ReadonlyArray<Record<string, unknown> & { type: string }>,
		_attemptId?: string
	) {
		const decodedSessionId = yield* decodeEffect("acp.sendPrompt", decodeSessionId)(sessionId);
		// Only text blocks are deliverable end to end today: ProviderBridge's
		// message.send reaction forwards a single `text` field to the adapter
		// (see considerMessageSent in ProviderBridge.ts). Non-text blocks
		// (images, files, ...) have no wire representation yet and are
		// dropped, not silently corrupted.
		const text = yield* decodeTrimmed("acp.sendPrompt", extractPromptText(request));
		const commandId = yield* nextCommandId("message-send");
		const messageId = yield* decodeEffect(
			"acp.sendPrompt",
			decodeMessageId
		)(`message-${String(commandId)}`);
		yield* withRpcClient("acp.sendPrompt", (client) =>
			client.dispatch({
				type: "message.send",
				commandId,
				sessionId: decodedSessionId,
				messageId,
				text,
			})
		);
	}),

	cancel: Effect.fn("acp.cancel")(function* (sessionId: string) {
		const decodedSessionId = yield* decodeEffect("acp.cancel", decodeSessionId)(sessionId);
		const commandId = yield* nextCommandId("turn-cancel");
		yield* withRpcClient("acp.cancel", (client) =>
			client.dispatch({
				type: "turn.cancel",
				commandId,
				sessionId: decodedSessionId,
			})
		);
	}),

	replyInteraction: Effect.fn("acp.replyInteraction")(function* (request: InteractionReplyRequest) {
		const decodedSessionId = yield* decodeEffect(
			"acp.replyInteraction",
			decodeSessionId
		)(request.sessionId);
		const decision = interactionReplyDecision(request.payload);
		if (decision === null) {
			// question / question_cancel replies carry a structured answer
			// (free text, multi-select) that interaction.reply's allow/deny
			// decision cannot represent, and no adapter today (ClaudeAdapter's
			// respondToPermission is the only wired reaction, permission-only)
			// consumes anything richer -- see ProviderBridge.considerInteractionReplied.
			return yield* unsupportedOnContract("acp.replyInteraction.question");
		}
		if (request.interactionId === undefined) {
			return yield* Effect.fail(
				new AgentError("acp.replyInteraction", new Error("interactionId is required to reply"))
			);
		}
		const approvalRequestId = yield* decodeEffect(
			"acp.replyInteraction",
			decodeApprovalRequestId
		)(request.interactionId);
		const commandId = yield* nextCommandId("interaction-reply");
		yield* withRpcClient("acp.replyInteraction", (client) =>
			client.dispatch({
				type: "interaction.reply",
				commandId,
				sessionId: decodedSessionId,
				approvalRequestId,
				decision,
			})
		);
	}),

	respondInboundRequest: Effect.fn("acp.respondInboundRequest")(function* (
		sessionId: string,
		requestId: number,
		result: unknown
	) {
		const decodedSessionId = yield* decodeEffect(
			"acp.respondInboundRequest",
			decodeSessionId
		)(sessionId);
		const decodedRequestId = yield* decodeTrimmed("acp.respondInboundRequest", String(requestId));
		const body = yield* decodeTrimmed(
			"acp.respondInboundRequest",
			result === undefined ? "null" : JSON.stringify(result)
		);
		const commandId = yield* nextCommandId("inbound-respond");
		yield* withRpcClient("acp.respondInboundRequest", (client) =>
			client.dispatch({
				type: "inbound.respond",
				commandId,
				sessionId: decodedSessionId,
				requestId: decodedRequestId,
				body,
			})
		);
	}),

	// Rides the agentCall utility RPC's agent.list op (packages/contracts/src/
	// agentCall.ts), routed server-side onto ProviderRegistry.list (packages/
	// server/src/provider/agentCallHandler.ts) -- the same registry
	// ProviderBridge resolves real adapters from for session.create, so this
	// only ever offers an agent Acepe can actually start a session with.
	listAgents: Effect.fn("acp.listAgents")(function* () {
		const response = yield* withRpcClient("acp.listAgents", (client) =>
			client.agentCall({ op: "agent.list" })
		);
		const result = yield* unwrapAgentCallResult("agent.list", response);
		return result.agents.map(toAgentInfo);
	}),

	// agent.install runs the server's AgentInstaller: registry fetch,
	// download, checksum verify, extract, write binary. It answers with the
	// agent list re-read from ProviderRegistry afterwards, so the caller
	// takes installedness from the backend that just changed it instead of
	// making a second list call that could disagree.
	//
	// This lane is request/response and the installer reports no progress,
	// so there is no percentage to hand a caller. The picker shows an
	// indeterminate installing state -- see agent-store.svelte.ts.
	installAgent: Effect.fn("acp.installAgent")(function* (agentId: string) {
		const response = yield* withRpcClient("acp.installAgent", (client) =>
			client.agentCall({ op: "agent.install", agentId })
		);
		const result = yield* unwrapAgentCallResult("agent.install", response);
		return {
			version: result.version,
			agents: result.agents.map(toAgentInfo),
		};
	}),

	uninstallAgent: Effect.fn("acp.uninstallAgent")(function* (agentId: string) {
		const response = yield* withRpcClient("acp.uninstallAgent", (client) =>
			client.agentCall({ op: "agent.uninstall", agentId })
		);
		const result = yield* unwrapAgentCallResult("agent.uninstall", response);
		return result.agents.map(toAgentInfo);
	}),

	// agent.authenticate runs the agent's own login command on the server and
	// waits for it. The call is long-running by nature: it is waiting on the
	// person finishing the login in their browser.
	//
	// The agent list comes back from the same call, re-read backend-side from
	// ProviderRegistry after the login command exited, so a credential store
	// the login just wrote is already reflected in it. Succeeding is still
	// not a verdict that this agent is authenticated -- read that off the
	// returned agent, and reconnect the session to settle the case where the
	// adapter looks somewhere the login did not write.
	//
	// An agent whose login the server cannot drive fails here with the
	// command to run instead. Read that from listAgents' `sign_in` before
	// offering a control rather than calling this to find out.
	authenticateAgent: Effect.fn("acp.authenticateAgent")(function* (agentId: string) {
		const response = yield* withRpcClient("acp.authenticateAgent", (client) =>
			client.agentCall({ op: "agent.authenticate", agentId })
		);
		const result = yield* unwrapAgentCallResult("agent.authenticate", response);
		return result.agents.map(toAgentInfo);
	}),

	// Stops the login command agent.authenticate is waiting on, which makes
	// that call fail with a cancelled message. `false` means there was no
	// sign-in running to stop.
	cancelAgentAuthentication: Effect.fn("acp.cancelAgentAuthentication")(function* (
		agentId: string
	) {
		const response = yield* withRpcClient("acp.cancelAgentAuthentication", (client) =>
			client.agentCall({ op: "agent.cancel-authentication", agentId })
		);
		const result = yield* unwrapAgentCallResult("agent.cancel-authentication", response);
		return result.cancelled;
	}),

	closeSession: Effect.fn("acp.closeSession")(function* (sessionId: string) {
		const decodedSessionId = yield* decodeEffect("acp.closeSession", decodeSessionId)(sessionId);
		const commandId = yield* nextCommandId("session-close");
		yield* withRpcClient("acp.closeSession", (client) =>
			client.dispatch({
				type: "session.close",
				commandId,
				sessionId: decodedSessionId,
			})
		);
	}),

	registerCustomAgent: (_config: CustomAgentConfig): Effect.Effect<void, AppError> =>
		unsupportedOnContract("acp.registerCustomAgent"),

	// SSE-over-HTTP bridge from the old backend. Under Electrobun, session
	// updates ride the `events` RPC stream (client.events(fromSequence), see
	// rpc.ts) instead -- there is no eventsUrl to hand out any more. See this
	// file's header comment: get_event_bridge_info has no Electrobun handler
	// and already fails on every call today.
	getEventBridgeInfo: (): Effect.Effect<{ readonly eventsUrl: string }, AppError> =>
		unsupportedOnContract("acp.getEventBridgeInfo"),

	getSessionState: Effect.fn("acp.getSessionState")(function* (sessionId: string) {
		const lifecycle = yield* lifecycleForSession(sessionId);
		const envelope: SessionStateEnvelope = {
			sessionId,
			graphRevision: 0,
			lastEventSeq: 0,
			payload: {
				kind: "lifecycle",
				lifecycle,
				revision: { graphRevision: 0, transcriptRevision: 0, lastEventSeq: 0 },
			},
		};
		return envelope;
	}),

	getSessionConnectionReadiness: Effect.fn("acp.getSessionConnectionReadiness")(function* (
		sessionId: string
	) {
		const lifecycle = yield* lifecycleForSession(sessionId);
		const capabilities: SessionGraphCapabilities = {};
		return {
			graphRevision: 0,
			lifecycle,
			capabilities,
		};
	}),

	// Reopen-session transcript hydration (see reopen-snapshot-graph.ts's
	// header comment): the `{sessionId}` contract snapshot carries the full
	// ordered `messages`/`turns`/`activities`/`pendingApprovals` a reopened
	// session needs to rebuild its canonical transcript, so hand callers the
	// raw snapshot rather than duplicating `lifecycleForSession`'s narrower
	// lifecycle-only projection of the same fetch.
	getSessionSnapshot: Effect.fn("acp.getSessionSnapshot")(function* (sessionId: string) {
		const decodedSessionId = yield* decodeEffect(
			"acp.getSessionSnapshot",
			decodeSessionId
		)(sessionId);
		return yield* withRpcClient("acp.getSessionSnapshot", (client) =>
			client.snapshot(sessionSnapshotRequest(decodedSessionId))
		);
	}),

	rpcCall(_method: string, _params: Record<string, unknown>): Effect.Effect<unknown, AppError> {
		// The old raw JSON-RPC passthrough into the ACP subprocess. No live
		// caller today, and the contract has no generic passthrough primitive
		// -- every real operation is a typed command/query now.
		return unsupportedOnContract("acp.rpcCall");
	},
};

function interactionReplyDecision(
	payload: InteractionReplyRequest["payload"]
): "allow" | "deny" | null {
	switch (payload.kind) {
		case "permission":
			return payload.reply === "reject" ? "deny" : "allow";
		case "plan_approval":
			return payload.approved ? "allow" : "deny";
		case "computer_permission":
			return payload.accepted ? "allow" : "deny";
		case "question":
		case "question_cancel":
			return null;
	}
}
