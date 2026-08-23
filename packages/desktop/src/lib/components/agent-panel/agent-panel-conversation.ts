import {
	EventId,
	type RpcProjectedMessage,
	type RpcProjectedPendingApproval,
	type RpcProjectedSessionActivity,
	type RpcSessionSnapshot,
	type Sequence,
} from "@acepe/contracts";
import type {
	AgentAssistantEntry,
	AgentPanelConversationEntry,
	AgentPanelConversationModel,
	AgentUserEntry,
} from "@acepe/ui/agent-panel/types";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import { compactionEntryFromProjectedMessage } from "./agent-panel-compaction.ts";
import {
	type AgentPanelActivityProjection,
	toolRowFromActivityProjection,
	toolRowFromPendingApproval,
} from "./agent-panel-tool-row.ts";

export type { AgentPanelActivityProjection } from "./agent-panel-tool-row.ts";

export type AgentPanelKeyedRow = {
	readonly eachKey: EventId;
	readonly entry: AgentPanelConversationEntry;
};

export type AgentPanelConversation = {
	readonly rows: ReadonlyArray<AgentPanelKeyedRow>;
	readonly conversation: AgentPanelConversationModel;
};

type PendingRow = {
	readonly sequence: Sequence;
	readonly order: number;
	readonly brandedId: string;
	readonly entry: AgentPanelConversationEntry;
};

const pendingRowOrder: Order.Order<PendingRow> = Order.combine(
	Order.mapInput(Order.Number, (row: PendingRow) => row.sequence),
	Order.mapInput(Order.Number, (row: PendingRow) => row.order)
);

const RPC_ACTIVITY_TITLE = "activity";

const activitiesFromRpcSnapshot = (
	activities: ReadonlyArray<RpcProjectedSessionActivity>
): ReadonlyArray<AgentPanelActivityProjection> =>
	Arr.map(activities, (row) => ({
		activityId: row.activityId,
		sessionId: row.sessionId,
		sequence: row.sequence,
		statusSequence: row.sequence,
		kind: "tool",
		toolCallId: null,
		operationId: null,
		status: "pending",
		title: RPC_ACTIVITY_TITLE,
		path: null,
	}));

const userEntryFromMessage = (
	message: Extract<RpcProjectedMessage, { readonly rowType: "user" }>
): AgentUserEntry => ({
	id: message.messageId,
	type: "user",
	text: message.content.text,
});

const assistantEntryFromMessage = (
	message: Extract<RpcProjectedMessage, { readonly rowType: "assistant" }>
): AgentAssistantEntry => ({
	id: message.messageId,
	type: "assistant",
	markdown: message.content.text,
});

const entryFromMessage = (message: RpcProjectedMessage): AgentPanelConversationEntry => {
	if (message.rowType === "user") {
		return userEntryFromMessage(message);
	}
	if (message.rowType === "assistant") {
		return assistantEntryFromMessage(message);
	}
	return compactionEntryFromProjectedMessage(message);
};

const withEachKey = (
	entry: AgentPanelConversationEntry,
	eachKey: EventId
): AgentPanelConversationEntry => {
	if (entry.id === eachKey) {
		return entry;
	}
	return { ...entry, id: eachKey };
};

const assignEachKeys = (rows: ReadonlyArray<PendingRow>): ReadonlyArray<AgentPanelKeyedRow> => {
	const used = new Set<string>();
	return Arr.map(rows, (row) => {
		let candidate = row.brandedId;
		if (used.has(candidate)) {
			candidate = `${row.brandedId}:${String(row.sequence)}`;
		}
		let suffix = 2;
		while (used.has(candidate)) {
			candidate = `${row.brandedId}:${String(row.sequence)}:${String(suffix)}`;
			suffix += 1;
		}
		const eachKey = EventId.make(candidate);
		used.add(eachKey);
		return {
			eachKey,
			entry: withEachKey(row.entry, eachKey),
		};
	});
};

const pendingFromMessages = (
	messages: ReadonlyArray<RpcProjectedMessage>
): ReadonlyArray<PendingRow> =>
	Arr.map(messages, (message, index) => ({
		sequence: message.sequence,
		order: index,
		brandedId: message.messageId,
		entry: entryFromMessage(message),
	}));

const pendingFromActivities = (
	activities: ReadonlyArray<AgentPanelActivityProjection>,
	orderOffset: number
): ReadonlyArray<PendingRow> =>
	Arr.map(activities, (activity, index) => ({
		sequence: activity.sequence,
		order: orderOffset + index,
		brandedId: activity.activityId,
		entry: toolRowFromActivityProjection(activity),
	}));

const pendingFromApprovals = (
	approvals: ReadonlyArray<RpcProjectedPendingApproval>,
	orderOffset: number
): ReadonlyArray<PendingRow> =>
	Arr.map(approvals, (approval, index) => ({
		sequence: approval.sequence,
		order: orderOffset + index,
		brandedId: approval.approvalRequestId,
		entry: toolRowFromPendingApproval(approval),
	}));

export const conversationFromProjections = (input: {
	readonly messages: ReadonlyArray<RpcProjectedMessage>;
	readonly activities: ReadonlyArray<AgentPanelActivityProjection>;
	readonly pendingApprovals?: ReadonlyArray<RpcProjectedPendingApproval>;
}): AgentPanelConversation => {
	const messageRows = pendingFromMessages(input.messages);
	const activityRows = pendingFromActivities(input.activities, messageRows.length);
	const approvalRows = pendingFromApprovals(
		input.pendingApprovals === undefined ? Arr.empty() : input.pendingApprovals,
		messageRows.length + activityRows.length
	);
	const merged = Arr.sort(
		Arr.appendAll(Arr.appendAll(messageRows, activityRows), approvalRows),
		pendingRowOrder
	);
	const rows = assignEachKeys(merged);
	return {
		rows,
		conversation: {
			entries: Arr.map(rows, (row) => row.entry),
			isStreaming: false,
		},
	};
};

export const conversationFromSnapshot = (input: {
	readonly snapshot: RpcSessionSnapshot;
	readonly activities?: ReadonlyArray<AgentPanelActivityProjection>;
}): AgentPanelConversation => {
	const activities =
		input.activities === undefined
			? activitiesFromRpcSnapshot(input.snapshot.activities)
			: input.activities;
	return conversationFromProjections({
		messages: input.snapshot.messages,
		activities,
		pendingApprovals: input.snapshot.pendingApprovals,
	});
};
