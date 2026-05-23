import { describe, expect, it } from "vitest";

import type { InteractionSnapshot, OperationSnapshot } from "../../../services/acp-types.js";
import { getInteractionSnapshotArrayPatch } from "../../session-state/interaction-snapshot-array-patch.js";
import { getOperationSnapshotArrayPatch } from "../../session-state/operation-snapshot-array-patch.js";
import {
	mergeInteractionSnapshots,
	mergeOperationSnapshots,
} from "../session-store.svelte.js";

function createOperationSnapshot(overrides: Partial<OperationSnapshot> = {}): OperationSnapshot {
	return {
		id: overrides.id ?? "op-1",
		session_id: overrides.session_id ?? "session-1",
		tool_call_id: overrides.tool_call_id ?? "tool-1",
		name: overrides.name ?? "bash",
		kind: overrides.kind ?? "execute",
		provider_status: overrides.provider_status ?? "in_progress",
		operation_state: overrides.operation_state ?? "running",
		awaiting_plan_approval: overrides.awaiting_plan_approval ?? false,
		source_link: overrides.source_link ?? {
			kind: "transcript_linked",
			entry_id: "tool-1",
		},
		operation_provenance_key: overrides.operation_provenance_key ?? "tool-1",
		title: overrides.title ?? "Run command",
		arguments: overrides.arguments ?? { kind: "execute", command: "pwd" },
		progressive_arguments: overrides.progressive_arguments ?? null,
		result: overrides.result ?? null,
		command: overrides.command ?? "pwd",
		normalized_todos: overrides.normalized_todos ?? null,
		parent_tool_call_id: overrides.parent_tool_call_id ?? null,
		parent_operation_id: overrides.parent_operation_id ?? null,
		child_tool_call_ids: overrides.child_tool_call_ids ?? [],
		child_operation_ids: overrides.child_operation_ids ?? [],
	};
}

function createInteractionSnapshot(
	overrides: Partial<InteractionSnapshot> = {}
): InteractionSnapshot {
	return {
		id: overrides.id ?? "interaction-1",
		session_id: overrides.session_id ?? "session-1",
		kind: overrides.kind ?? "Permission",
		state: overrides.state ?? "Pending",
		json_rpc_request_id: overrides.json_rpc_request_id ?? null,
		reply_handler: overrides.reply_handler ?? null,
		tool_reference: overrides.tool_reference ?? null,
		responded_at_event_seq: overrides.responded_at_event_seq ?? null,
		response: overrides.response ?? null,
		payload: overrides.payload ?? {
			Permission: {
				id: overrides.id ?? "interaction-1",
				sessionId: overrides.session_id ?? "session-1",
				jsonRpcRequestId: null,
				replyHandler: null,
				permission: "edit",
				patterns: [],
				metadata: null,
				always: [],
				autoAccepted: false,
				tool: null,
			},
		},
		canonical_operation_id: overrides.canonical_operation_id ?? null,
	};
}

describe("session-state snapshot merges", () => {
	it("keeps operation arrays stable for duplicate object patches", () => {
		const operation = createOperationSnapshot();
		const current = [operation];

		expect(mergeOperationSnapshots(current, [operation])).toBe(current);
	});

	it("patches operation arrays lazily when one object changes", () => {
		const firstOperation = createOperationSnapshot({ id: "op-1" });
		const secondOperation = createOperationSnapshot({ id: "op-2", tool_call_id: "tool-2" });
		const patchedOperation = createOperationSnapshot({
			id: "op-2",
			tool_call_id: "tool-2",
			provider_status: "completed",
			operation_state: "completed",
		});
		const current = [firstOperation, secondOperation];

		const next = mergeOperationSnapshots(current, [patchedOperation]);

		expect(next).not.toBe(current);
		expect(next[0]).toBe(firstOperation);
		expect(next[1]).toBe(patchedOperation);
	});

	it("carries operation patch metadata for downstream read models", () => {
		const firstOperation = createOperationSnapshot({ id: "op-1" });
		const secondOperation = createOperationSnapshot({ id: "op-2", tool_call_id: "tool-2" });
		const patchedOperation = createOperationSnapshot({
			id: "op-2",
			tool_call_id: "tool-2",
			provider_status: "completed",
			operation_state: "completed",
		});
		const appendedOperation = createOperationSnapshot({
			id: "op-3",
			tool_call_id: "tool-3",
		});
		const current = [firstOperation, secondOperation];

		const next = mergeOperationSnapshots(current, [patchedOperation, appendedOperation]);
		const patch = getOperationSnapshotArrayPatch(next);

		expect(patch?.baseOperations).toBe(current);
		expect(patch?.patchedOperationsByIndex?.get(1)).toBe(patchedOperation);
		expect(patch?.appendedOperations).toEqual([appendedOperation]);
	});

	it("patches operation arrays without slicing the whole snapshot list", () => {
		const firstOperation = createOperationSnapshot({ id: "op-1" });
		const secondOperation = createOperationSnapshot({ id: "op-2", tool_call_id: "tool-2" });
		const patchedOperation = createOperationSnapshot({
			id: "op-2",
			tool_call_id: "tool-2",
			provider_status: "completed",
			operation_state: "completed",
		});
		const current = [firstOperation, secondOperation];
		const originalSlice = current.slice;

		current.slice = () => {
			throw new Error("must not copy whole operation snapshot list");
		};

		try {
			const next = mergeOperationSnapshots(current, [patchedOperation]);

			expect(Array.isArray(next)).toBe(true);
			expect(next).toHaveLength(2);
			expect(next[0]).toBe(firstOperation);
			expect(next[1]).toBe(patchedOperation);
			expect(next.map((operation) => operation.id)).toEqual(["op-1", "op-2"]);
			expect([...next][1]).toBe(patchedOperation);
		} finally {
			current.slice = originalSlice;
		}
	});

	it("appends operation patches without slicing the whole snapshot list", () => {
		const firstOperation = createOperationSnapshot({ id: "op-1" });
		const appendedOperation = createOperationSnapshot({
			id: "op-2",
			tool_call_id: "tool-2",
		});
		const current = [firstOperation];
		const originalSlice = current.slice;

		current.slice = () => {
			throw new Error("must not copy whole operation snapshot list");
		};

		try {
			const next = mergeOperationSnapshots(current, [appendedOperation]);

			expect(Array.isArray(next)).toBe(true);
			expect(next).toHaveLength(2);
			expect(next[0]).toBe(firstOperation);
			expect(next[1]).toBe(appendedOperation);
			expect(next.map((operation) => operation.id)).toEqual(["op-1", "op-2"]);
		} finally {
			current.slice = originalSlice;
		}
	});

	it("keeps interaction arrays stable for duplicate object patches", () => {
		const interaction = createInteractionSnapshot();
		const current = [interaction];

		expect(mergeInteractionSnapshots(current, [interaction])).toBe(current);
	});

	it("carries interaction patch metadata for downstream read models", () => {
		const firstInteraction = createInteractionSnapshot({ id: "interaction-1" });
		const secondInteraction = createInteractionSnapshot({ id: "interaction-2" });
		const patchedInteraction = createInteractionSnapshot({
			id: "interaction-2",
			state: "Answered",
		});
		const appendedInteraction = createInteractionSnapshot({ id: "interaction-3" });
		const current = [firstInteraction, secondInteraction];

		const next = mergeInteractionSnapshots(current, [patchedInteraction, appendedInteraction]);
		const patch = getInteractionSnapshotArrayPatch(next);

		expect(patch?.baseInteractions).toBe(current);
		expect(patch?.patchedInteractionsByIndex?.get(1)).toBe(patchedInteraction);
		expect(patch?.appendedInteractions).toEqual([appendedInteraction]);
	});
});
