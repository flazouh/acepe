/**
 * Derives store-facing composer UI contract from the composer machine snapshot
 * plus session runtime policy inputs.
 */

import type { SnapshotFrom } from "xstate";
import type { composerMachine } from "./composer-machine.js";
import type { SessionRuntimeState } from "./session-ui-state.js";
import type { DefaultSubmitAction } from "./submit-intent.js";
import {
	isPrimaryButtonDisabled,
	resolveDefaultSubmitAction,
	resolveEnterKeyIntent,
	resolvePrimaryButtonIntent,
	type SubmitIntent,
} from "./submit-intent.js";

export type ComposerMachineSnapshot = SnapshotFrom<typeof composerMachine>;

export function getComposerPhase(
	snapshot: ComposerMachineSnapshot
): "interactive" | "configBlocking" | "dispatching" {
	const v = snapshot.value;
	if (v === "configBlocking" || v === "dispatching") {
		return v;
	}
	return "interactive";
}

/**
 * Store-facing composer policy shape exposed through SessionStore.
 */
export interface StoreComposerState {
	readonly canSubmit: boolean;
	readonly isBlocked: boolean;
	readonly isDispatching: boolean;
	readonly selectorsDisabled: boolean;
	readonly committedModeId: string | null;
	readonly committedModelId: string | null;
	readonly committedAutonomousEnabled: boolean;
	readonly provisionalModeId: string | null;
	readonly provisionalModelId: string | null;
	readonly provisionalAutonomousEnabled: boolean | null;
	readonly boundGeneration: number;
}

export interface DeriveComposerStateInput {
	readonly machineSnapshot: ComposerMachineSnapshot;
	readonly runtime: SessionRuntimeState | null;
}

export function deriveStoreComposerState(input: DeriveComposerStateInput): StoreComposerState {
	const phase = getComposerPhase(input.machineSnapshot);
	const ctx = input.machineSnapshot.context;
	const isBlocked = phase === "configBlocking";
	const isDispatching = phase === "dispatching";
	const selectorsDisabled = isBlocked || isDispatching;

	const runtimeCanSubmit = input.runtime?.canSubmit ?? false;
	const canSubmit = runtimeCanSubmit && !isBlocked && !isDispatching;

	return {
		canSubmit,
		isBlocked,
		isDispatching,
		selectorsDisabled,
		committedModeId: ctx.committedModeId,
		committedModelId: ctx.committedModelId,
		committedAutonomousEnabled: ctx.committedAutonomousEnabled,
		provisionalModeId: ctx.provisionalModeId,
		provisionalModelId: ctx.provisionalModelId,
		provisionalAutonomousEnabled: ctx.provisionalAutonomousEnabled,
		boundGeneration: ctx.boundGeneration,
	};
}

export interface ComposerInteractionInput {
	readonly hasDraftInput: boolean;
	readonly hasSessionId: boolean;
	readonly isAgentBusy: boolean;
	readonly isStreaming: boolean;
	readonly isShiftPressed: boolean;
	/** Canonical submit disabled from runtime + host (matches agent-input `isSubmitDisabled`). */
	readonly isSubmitDisabled: boolean;
	readonly hasBlockingComposerConfig: boolean;
	readonly isComposerDispatching: boolean;
}

export interface ComposerInteractionState {
	readonly defaultSubmitAction: DefaultSubmitAction;
	readonly primaryButtonIntent: SubmitIntent;
	readonly primaryButtonDisabled: boolean;
}

export function deriveComposerInteractionState(
	input: ComposerInteractionInput
): ComposerInteractionState {
	const primaryButtonIntent = resolvePrimaryButtonIntent({
		hasDraftInput: input.hasDraftInput,
		isAgentBusy: input.isAgentBusy,
		isStreaming: input.isStreaming,
		isShiftPressed: input.isShiftPressed,
	});

	const defaultSubmitAction = resolveDefaultSubmitAction({
		hasDraftInput: input.hasDraftInput,
		hasSessionId: input.hasSessionId,
		isAgentBusy: input.isAgentBusy,
		isStreaming: input.isStreaming,
		isSubmitDisabled: input.isSubmitDisabled,
		hasBlockingComposerConfig: input.hasBlockingComposerConfig,
		isComposerDispatching: input.isComposerDispatching,
	});

	const primaryButtonDisabled = isPrimaryButtonDisabled({
		hasDraftInput: input.hasDraftInput,
		isComposerDispatching: input.isComposerDispatching,
		isAgentBusy: input.isAgentBusy,
		isSubmitDisabled: input.isSubmitDisabled,
		primaryButtonIntent,
		hasBlockingComposerConfig: input.hasBlockingComposerConfig,
	});

	return {
		defaultSubmitAction,
		primaryButtonIntent,
		primaryButtonDisabled,
	};
}

/** Enter-key intent uses the same blocking/dispatch policy as the composer machine. */
export function resolveComposerEnterKeyIntent(
	policy: Pick<
		ComposerInteractionInput,
		| "hasDraftInput"
		| "isAgentBusy"
		| "hasBlockingComposerConfig"
		| "isComposerDispatching"
		| "isSubmitDisabled"
	>,
	key: Pick<KeyboardEvent, "shiftKey" | "metaKey" | "ctrlKey">
): SubmitIntent {
	return resolveEnterKeyIntent({
		hasDraftInput: policy.hasDraftInput,
		isAgentBusy: policy.isAgentBusy,
		shiftKey: key.shiftKey,
		metaKey: key.metaKey,
		ctrlKey: key.ctrlKey,
		hasBlockingComposerConfig: policy.hasBlockingComposerConfig,
		isComposerDispatching: policy.isComposerDispatching,
		isSubmitDisabled: policy.isSubmitDisabled,
	});
}
