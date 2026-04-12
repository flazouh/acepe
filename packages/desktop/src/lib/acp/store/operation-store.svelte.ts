import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { ContentBlock, EditDelta, ToolArguments } from "../../services/converted-session-types.js";
import type {
	Operation,
	OperationIdentity,
	OperationIdentityAlias,
	OperationIdentityProof,
} from "../types/operation.js";
import type { ToolCall, ToolCallUpdate } from "../types/tool-call.js";

const OPERATION_STORE_KEY = Symbol("operation-store");

function createSessionToolKey(sessionId: string, toolCallId: string): string {
	return `${sessionId}::${toolCallId}`;
}

function normalizeCommand(value: string | null | undefined): string | null {
	if (value == null) {
		return null;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}

	return trimmed.replace(/\s+/g, " ");
}

function extractCommandFromArguments(argumentsValue: ToolArguments | undefined): string | null {
	if (argumentsValue?.kind !== "execute") {
		return null;
	}

	return normalizeCommand(argumentsValue.command);
}

type LegacyTextContentBlock = { type: "content"; content: { type: "text"; text: string } };
type ResultContentBlock = ContentBlock | LegacyTextContentBlock;

function isTerminalStatus(status: ToolCall["status"] | null | undefined): boolean {
	return status === "completed" || status === "failed";
}

function resolveNextStatus(
	currentStatus: ToolCall["status"] | null | undefined,
	nextStatus: ToolCall["status"] | null | undefined
): ToolCall["status"] | null | undefined {
	if (!nextStatus) {
		return currentStatus;
	}

	if (isTerminalStatus(currentStatus) && !isTerminalStatus(nextStatus)) {
		return currentStatus;
	}

	return nextStatus;
}

function extractResultFromContent(content: ResultContentBlock[] | null | undefined): string | null {
	if (!content || !Array.isArray(content) || content.length === 0) {
		return null;
	}

	const textParts: string[] = [];
	for (const block of content) {
		if (block.type === "text") {
			textParts.push(block.text);
			continue;
		}

		if (block.type === "content" && block.content.type === "text") {
			textParts.push(block.content.text);
		}
	}

	return textParts.length > 0 ? textParts.join("\n") : null;
}

function mergeOptionalString(
	incoming: string | null | undefined,
	current: string | null | undefined
): string | null | undefined {
	return incoming ?? current;
}

function editDeltaDetailScore(edit: EditDelta): number {
	return (
		Number(Boolean(edit.file_path)) +
		Number("move_from" in edit && Boolean(edit.move_from)) +
		Number(edit.type === "writeFile" ? Boolean(edit.previous_content) : Boolean(edit.old_text)) +
		Number(
			edit.type === "writeFile"
				? Boolean(edit.content)
				: edit.type === "replaceText"
					? Boolean(edit.new_text)
					: false
		)
	);
}

function mergeEditDelta(current: EditDelta, incoming: EditDelta): EditDelta {
	if (current.type === "replaceText" && incoming.type === "replaceText") {
		return {
			type: "replaceText",
			file_path: mergeOptionalString(incoming.file_path, current.file_path),
			move_from: mergeOptionalString(incoming.move_from, current.move_from),
			old_text: mergeOptionalString(incoming.old_text, current.old_text),
			new_text: mergeOptionalString(incoming.new_text, current.new_text),
		};
	}

	if (current.type === "writeFile" && incoming.type === "writeFile") {
		return {
			type: "writeFile",
			file_path: mergeOptionalString(incoming.file_path, current.file_path),
			move_from: mergeOptionalString(incoming.move_from, current.move_from),
			previous_content: mergeOptionalString(
				incoming.previous_content,
				current.previous_content
			),
			content: mergeOptionalString(incoming.content, current.content),
		};
	}

	if (current.type === "deleteFile" && incoming.type === "deleteFile") {
		return {
			type: "deleteFile",
			file_path: mergeOptionalString(incoming.file_path, current.file_path),
			old_text: mergeOptionalString(incoming.old_text, current.old_text),
		};
	}

	return editDeltaDetailScore(incoming) >= editDeltaDetailScore(current) ? incoming : current;
}

function mergeToolArguments(currentArgs: ToolArguments, nextArgs: ToolArguments): ToolArguments {
	if (currentArgs.kind === "edit" && nextArgs.kind === "edit") {
		const maxLength = Math.max(currentArgs.edits.length, nextArgs.edits.length);
		const mergedEdits: EditDelta[] = [];

		for (let index = 0; index < maxLength; index += 1) {
			const currentEdit = currentArgs.edits[index];
			const incomingEdit = nextArgs.edits[index];
			if (currentEdit && incomingEdit) {
				mergedEdits.push(mergeEditDelta(currentEdit, incomingEdit));
				continue;
			}
			if (incomingEdit) {
				mergedEdits.push(incomingEdit);
				continue;
			}
			if (currentEdit) {
				mergedEdits.push(currentEdit);
			}
		}

		return {
			kind: "edit",
			edits: mergedEdits,
		};
	}

	return nextArgs;
}

function resolveOperationKind(
	currentKind: ToolCall["kind"],
	nextKind: ToolCall["kind"],
	normalizedQuestions: ToolCall["normalizedQuestions"]
): ToolCall["kind"] {
	const shouldPromoteTaskToQuestion =
		currentKind === "task" && nextKind === "question" && (normalizedQuestions?.length ?? 0) > 0;
	const shouldUpgradeGenericKind =
		(currentKind === undefined || currentKind === "other") &&
		nextKind !== undefined &&
		nextKind !== "other";

	if (shouldPromoteTaskToQuestion || shouldUpgradeGenericKind) {
		return nextKind;
	}

	return currentKind ?? nextKind;
}

function resolveOperationName(
	currentName: string | undefined,
	nextName: string | undefined
): string {
	if (nextName != null && nextName !== "Tool") {
		return nextName;
	}

	return currentName ?? nextName ?? "Tool";
}

export function createToolCallIdentityProof(toolCallId: string): OperationIdentityProof {
	return {
		kind: "tool-call-id",
		proof: "transport-tool-call-id",
		value: toolCallId,
	};
}

function createEntryIdentityProof(entryId: string): OperationIdentityProof {
	return {
		kind: "entry-id",
		proof: "transcript-entry-id",
		value: entryId,
	};
}

export function createExecuteCommandIdentityProof(
	command: string | null | undefined
): OperationIdentityProof | null {
	const normalizedCommand = normalizeCommand(command);
	if (normalizedCommand == null) {
		return null;
	}

	return {
		kind: "execute-command",
		proof: "canonical-execute-command",
		value: normalizedCommand,
	};
}

function createIdentityAlias(
	kind: OperationIdentityAlias["kind"],
	proof: OperationIdentityAlias["proof"],
	value: string | null | undefined
): OperationIdentityAlias | null {
	if (value == null || value.length === 0) {
		return null;
	}

	return { kind, proof, value };
}

export function buildOperationIdentity(input: {
	toolCallId: string;
	sourceEntryId: string | null;
	command: string | null;
}): OperationIdentity {
	const aliases: OperationIdentityAlias[] = [];
	const toolCallAlias = createIdentityAlias(
		"tool-call-id",
		"transport-tool-call-id",
		input.toolCallId
	);
	if (toolCallAlias != null) {
		aliases.push(toolCallAlias);
	}

	const entryAlias = input.sourceEntryId == null ? null : createIdentityAlias(
		"entry-id",
		"transcript-entry-id",
		input.sourceEntryId
	);
	if (entryAlias != null) {
		aliases.push(entryAlias);
	}

	const executeAlias = createExecuteCommandIdentityProof(input.command);
	if (executeAlias != null) {
		aliases.push({
			kind: executeAlias.kind,
			proof: executeAlias.proof,
			value: executeAlias.value,
		});
	}

	return {
		primary: toolCallAlias ?? {
			kind: "tool-call-id",
			proof: "transport-tool-call-id",
			value: input.toolCallId,
		},
		aliases,
	};
}

function createIdentityIndexKey(sessionId: string, proof: OperationIdentityProof): string {
	return `${sessionId}::${proof.kind}::${proof.proof}::${proof.value}`;
}

export function buildOperationId(sessionId: string, toolCallId: string): string {
	return `${sessionId}:${toolCallId}`;
}

export function extractToolOperationCommand(toolCall: ToolCall): string | null {
	const progressiveCommand = extractCommandFromArguments(toolCall.progressiveArguments);
	if (progressiveCommand !== null) {
		return progressiveCommand;
	}

	const argumentCommand = extractCommandFromArguments(toolCall.arguments);
	if (argumentCommand !== null) {
		return argumentCommand;
	}

	if (toolCall.title == null) {
		return null;
	}

	const titleMatch = /^`(.+)`$/.exec(toolCall.title);
	if (titleMatch?.[1] == null) {
		return null;
	}

	return normalizeCommand(titleMatch[1]);
}

export class OperationStore {
	/**
	 * Canonical runtime owner for resolved tool execution state.
	 *
	 * `ToolCallManager` remains the mutation/reconciliation adapter that updates
	 * transcript entries. `OperationStore` is the canonical read/query layer
	 * those mutations feed so projection consumers stop reconstructing semantics
	 * from raw transport artifacts.
	 */
	private readonly operationsById = new SvelteMap<string, Operation>();
	private readonly operationIdByToolCallKey = new SvelteMap<string, string>();
	private readonly operationIdByEntryKey = new SvelteMap<string, string>();
	private readonly operationIdByIdentityKey = new SvelteMap<string, string | null>();
	private readonly sessionOperationIds = new SvelteMap<string, Array<string>>();

	upsertFromToolCall(
		sessionId: string,
		sourceEntryId: string | null,
		toolCall: ToolCall
	): Operation {
		return this.upsertToolCall(
			sessionId,
			sourceEntryId,
			toolCall,
			null,
			toolCall.parentToolUseId ?? null
		);
	}

	upsertFromToolCallUpdate(
		sessionId: string,
		sourceEntryId: string | null,
		update: ToolCallUpdate
	): Operation {
		const operationId = buildOperationId(sessionId, update.toolCallId);
		const existingOperation = this.operationsById.get(operationId);
		const startedAtMs = existingOperation?.startedAtMs ?? nowMs();
		const incomingStatus = update.status ?? existingOperation?.status ?? "pending";
		const nextStatus = resolveNextStatus(existingOperation?.status, incomingStatus);
		const extractedResult =
			update.result ?? update.rawOutput ?? extractResultFromContent(update.content);
		const isStructuredResult =
			existingOperation?.result !== null &&
			typeof existingOperation?.result === "object" &&
			!Array.isArray(existingOperation?.result);
		const shouldPreserveStructuredResult =
			isStructuredResult && typeof extractedResult === "string";
		const rawNextArguments =
			update.arguments ?? update.streamingArguments ?? existingOperation?.arguments ?? { kind: "other", raw: {} };
		const nextArguments =
			existingOperation?.arguments == null
				? rawNextArguments
				: mergeToolArguments(existingOperation.arguments, rawNextArguments);
		const nextProgressiveArguments = isTerminalStatus(nextStatus)
			? undefined
			: update.arguments != null
				? undefined
				: (update.streamingArguments ?? existingOperation?.progressiveArguments);

		const nextOperation = this.persistOperation(
			sessionId,
			{
				id: operationId,
				sessionId,
				toolCallId: update.toolCallId,
				sourceEntryId: sourceEntryId ?? existingOperation?.sourceEntryId ?? null,
				identity: buildOperationIdentity({
					toolCallId: update.toolCallId,
					sourceEntryId: sourceEntryId ?? existingOperation?.sourceEntryId ?? null,
					command: extractOperationCommand({
						title: update.title ?? existingOperation?.title ?? null,
						arguments: nextArguments,
						progressiveArguments: nextProgressiveArguments,
					}),
				}),
				name: resolveOperationName(existingOperation?.name, undefined),
				rawInput: existingOperation?.rawInput,
				kind: existingOperation?.kind,
				status: nextStatus ?? existingOperation?.status ?? "pending",
				title: update.title ?? existingOperation?.title,
				arguments: nextArguments,
				progressiveArguments: nextProgressiveArguments,
				result: shouldPreserveStructuredResult
					? (existingOperation?.result ?? null)
					: (extractedResult ?? existingOperation?.result ?? null),
				locations: update.locations ?? existingOperation?.locations,
				skillMeta: existingOperation?.skillMeta,
				normalizedQuestions:
					update.normalizedQuestions ?? existingOperation?.normalizedQuestions,
				normalizedTodos: update.normalizedTodos ?? existingOperation?.normalizedTodos,
				questionAnswer: existingOperation?.questionAnswer,
				awaitingPlanApproval: existingOperation?.awaitingPlanApproval ?? false,
				planApprovalRequestId: existingOperation?.planApprovalRequestId ?? null,
				startedAtMs,
				completedAtMs:
					existingOperation?.completedAtMs ??
					(isTerminalStatus(nextStatus) ? nowMs() : undefined),
				command: extractOperationCommand({
					title: update.title ?? existingOperation?.title ?? null,
					arguments: nextArguments,
					progressiveArguments: nextProgressiveArguments,
				}),
				parentToolCallId: existingOperation?.parentToolCallId ?? null,
				parentOperationId: existingOperation?.parentOperationId ?? null,
				childToolCallIds: existingOperation?.childToolCallIds ?? [],
				childOperationIds: existingOperation?.childOperationIds ?? [],
			},
			existingOperation
		);

		return nextOperation;
	}

	getById(operationId: string): Operation | undefined {
		return this.operationsById.get(operationId);
	}

	findByIdentity(sessionId: string, proof: OperationIdentityProof): Operation | null {
		if (proof.kind === "tool-call-id") {
			return this.getByToolCallId(sessionId, proof.value) ?? null;
		}

		if (proof.kind === "entry-id") {
			return this.getByEntryId(sessionId, proof.value) ?? null;
		}

		const operationId = this.operationIdByIdentityKey.get(createIdentityIndexKey(sessionId, proof));
		if (operationId == null) {
			return null;
		}

		return this.operationsById.get(operationId) ?? null;
	}

	getByToolCallId(sessionId: string, toolCallId: string): Operation | undefined {
		const operationId = this.operationIdByToolCallKey.get(
			createSessionToolKey(sessionId, toolCallId)
		);
		if (operationId == null) {
			return undefined;
		}

		return this.operationsById.get(operationId);
	}

	getByEntryId(sessionId: string, entryId: string): Operation | undefined {
		const operationId = this.operationIdByEntryKey.get(createSessionToolKey(sessionId, entryId));
		if (operationId == null) {
			return undefined;
		}

		return this.operationsById.get(operationId);
	}

	getSessionOperations(sessionId: string): Array<Operation> {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		const operations: Array<Operation> = [];
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation != null) {
				operations.push(operation);
			}
		}
		return operations;
	}

	clearSession(sessionId: string): void {
		const operationIds = this.sessionOperationIds.get(sessionId) ?? [];
		for (const operationId of operationIds) {
			const operation = this.operationsById.get(operationId);
			if (operation == null) {
				continue;
			}

			this.operationsById.delete(operationId);
			this.operationIdByToolCallKey.delete(createSessionToolKey(sessionId, operation.toolCallId));
			if (operation.sourceEntryId != null) {
				this.operationIdByEntryKey.delete(createSessionToolKey(sessionId, operation.sourceEntryId));
			}
			for (const alias of operation.identity.aliases) {
				this.operationIdByIdentityKey.delete(
					createIdentityIndexKey(sessionId, {
						kind: alias.kind,
						proof: alias.proof,
						value: alias.value,
					})
				);
			}
		}

		this.sessionOperationIds.delete(sessionId);
	}

	private upsertToolCall(
		sessionId: string,
		sourceEntryId: string | null,
		toolCall: ToolCall,
		parentOperationId: string | null,
		parentToolCallId: string | null
	): Operation {
		const operationId = buildOperationId(sessionId, toolCall.id);
		const existingOperation = this.operationsById.get(operationId);
		const nextSourceEntryId = sourceEntryId ?? existingOperation?.sourceEntryId ?? null;
		const nextParentToolCallId = toolCall.parentToolUseId ?? parentToolCallId ?? null;
		const childToolCallIds: Array<string> = [];
		const childOperationIds: Array<string> = [];

		for (const childToolCall of toolCall.taskChildren ?? []) {
			const childOperation = this.upsertToolCall(
				sessionId,
				null,
				childToolCall,
				operationId,
				toolCall.id
			);
			childToolCallIds.push(childToolCall.id);
			childOperationIds.push(childOperation.id);
		}

		const nextOperation = this.persistOperation(
			sessionId,
			{
			id: operationId,
			sessionId,
			toolCallId: toolCall.id,
			sourceEntryId: nextSourceEntryId,
			identity: buildOperationIdentity({
				toolCallId: toolCall.id,
				sourceEntryId: nextSourceEntryId,
				command: extractToolOperationCommand(toolCall),
			}),
			name: resolveOperationName(existingOperation?.name, toolCall.name),
				rawInput: toolCall.rawInput ?? existingOperation?.rawInput,
			kind: resolveOperationKind(
				existingOperation?.kind,
				toolCall.kind,
				toolCall.normalizedQuestions ?? existingOperation?.normalizedQuestions ?? null
			),
			status: resolveNextStatus(existingOperation?.status, toolCall.status) ?? toolCall.status,
			title: toolCall.title ?? existingOperation?.title,
			arguments:
				existingOperation == null
					? toolCall.arguments
					: mergeToolArguments(existingOperation.arguments, toolCall.arguments),
			progressiveArguments:
				isTerminalStatus(toolCall.status)
					? undefined
					: (toolCall.progressiveArguments ?? existingOperation?.progressiveArguments),
			result: toolCall.result ?? existingOperation?.result ?? null,
			locations: toolCall.locations ?? existingOperation?.locations,
			skillMeta: toolCall.skillMeta ?? existingOperation?.skillMeta,
			normalizedQuestions:
				toolCall.normalizedQuestions ?? existingOperation?.normalizedQuestions,
			normalizedTodos: toolCall.normalizedTodos ?? existingOperation?.normalizedTodos,
			questionAnswer: toolCall.questionAnswer ?? existingOperation?.questionAnswer,
			awaitingPlanApproval: toolCall.awaitingPlanApproval,
			planApprovalRequestId:
				toolCall.awaitingPlanApproval
					? (toolCall.planApprovalRequestId ?? existingOperation?.planApprovalRequestId ?? null)
					: null,
			startedAtMs: toolCall.startedAtMs ?? existingOperation?.startedAtMs ?? nowMs(),
			completedAtMs:
				toolCall.completedAtMs ??
				existingOperation?.completedAtMs ??
				(isTerminalStatus(toolCall.status) ? nowMs() : undefined),
			command: extractToolOperationCommand(toolCall),
			parentToolCallId: nextParentToolCallId,
			parentOperationId,
			childToolCallIds,
			childOperationIds,
			},
			existingOperation
		);

		return nextOperation;
	}

	private persistOperation(
		sessionId: string,
		nextOperation: Operation,
		existingOperation: Operation | undefined
	): Operation {
		this.operationsById.set(nextOperation.id, nextOperation);
		this.operationIdByToolCallKey.set(
			createSessionToolKey(sessionId, nextOperation.toolCallId),
			nextOperation.id
		);

		if (existingOperation?.sourceEntryId != null && existingOperation.sourceEntryId !== nextOperation.sourceEntryId) {
			this.operationIdByEntryKey.delete(
				createSessionToolKey(sessionId, existingOperation.sourceEntryId)
			);
		}

		if (nextOperation.sourceEntryId != null) {
			this.operationIdByEntryKey.set(
				createSessionToolKey(sessionId, nextOperation.sourceEntryId),
				nextOperation.id
			);
		}

		if (existingOperation != null) {
			for (const alias of existingOperation.identity.aliases) {
				const aliasKey = createIdentityIndexKey(sessionId, {
					kind: alias.kind,
					proof: alias.proof,
					value: alias.value,
				});
				if (
					!nextOperation.identity.aliases.some(
						(nextAlias) =>
							nextAlias.kind === alias.kind &&
							nextAlias.proof === alias.proof &&
							nextAlias.value === alias.value
					)
				) {
					this.operationIdByIdentityKey.delete(aliasKey);
				}
			}
		}

		for (const alias of nextOperation.identity.aliases) {
			const aliasKey = createIdentityIndexKey(sessionId, {
				kind: alias.kind,
				proof: alias.proof,
				value: alias.value,
			});
			const existingAliasOperationId = this.operationIdByIdentityKey.get(aliasKey);
			if (!this.operationIdByIdentityKey.has(aliasKey) || existingAliasOperationId === nextOperation.id) {
				this.operationIdByIdentityKey.set(aliasKey, nextOperation.id);
				continue;
			}

			this.operationIdByIdentityKey.set(aliasKey, null);
		}

		const sessionOperationIds = this.sessionOperationIds.get(sessionId) ?? [];
		if (!sessionOperationIds.includes(nextOperation.id)) {
			const nextSessionOperationIds = sessionOperationIds.slice();
			nextSessionOperationIds.push(nextOperation.id);
			this.sessionOperationIds.set(sessionId, nextSessionOperationIds);
		}

		return nextOperation;
	}
}

function extractOperationCommand(source: {
	title: string | null | undefined;
	arguments: ToolArguments;
	progressiveArguments?: ToolArguments;
}): string | null {
	const progressiveCommand = extractCommandFromArguments(source.progressiveArguments);
	if (progressiveCommand !== null) {
		return progressiveCommand;
	}

	const argumentCommand = extractCommandFromArguments(source.arguments);
	if (argumentCommand !== null) {
		return argumentCommand;
	}

	if (source.title == null) {
		return null;
	}

	const titleMatch = /^`(.+)`$/.exec(source.title);
	if (titleMatch?.[1] == null) {
		return null;
	}

	return normalizeCommand(titleMatch[1]);
}

function nowMs(): number {
	return Date.now();
}

export function createOperationStore(): OperationStore {
	const store = new OperationStore();
	setContext(OPERATION_STORE_KEY, store);
	return store;
}

export function getOperationStore(): OperationStore {
	return getContext<OperationStore>(OPERATION_STORE_KEY);
}
