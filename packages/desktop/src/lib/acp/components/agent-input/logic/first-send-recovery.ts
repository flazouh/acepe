import type { FailureReason } from "$lib/services/acp-types.js";
import { AuthenticationRequiredError, CreationFailureError } from "../../../errors/app-error.js";
import { PanelConnectionState } from "../../../types/panel-connection-state.js";
import type { Attachment } from "../types/attachment.js";
import type { InlineImageReference } from "../types/inline-image-reference.js";

export interface ComposerRestoreSnapshot {
	draft: string;
	attachments: Attachment[];
	inlineTextEntries: Array<[string, string]>;
	inlineImageEntries: Array<[string, InlineImageReference]>;
}

export interface ComposerRestoreTarget {
	message: string;
	attachments: Attachment[];
	clearInlineReferenceMaps(): void;
	updateInlineText(refId: string, text: string): void;
	updateInlineImage(refId: string, image: InlineImageReference): void;
}

function cloneAttachment(attachment: Attachment): Attachment {
	const base: Attachment = {
		id: attachment.id,
		type: attachment.type,
		path: attachment.path,
		displayName: attachment.displayName,
		extension: attachment.extension,
	};
	if (attachment.content !== undefined) {
		return {
			id: base.id,
			type: base.type,
			path: base.path,
			displayName: base.displayName,
			extension: base.extension,
			content: attachment.content,
		};
	}
	return base;
}

export function restoreComposerStateAfterFailedSend(
	target: ComposerRestoreTarget,
	snapshot: ComposerRestoreSnapshot
): void {
	target.message = snapshot.draft;
	target.clearInlineReferenceMaps();
	for (let i = 0; i < snapshot.inlineTextEntries.length; i += 1) {
		const entry = snapshot.inlineTextEntries[i];
		const refId = entry[0];
		const text = entry[1];
		target.updateInlineText(refId, text);
	}
	for (let i = 0; i < snapshot.inlineImageEntries.length; i += 1) {
		const entry = snapshot.inlineImageEntries[i];
		const refId = entry[0];
		const image = entry[1];
		target.updateInlineImage(refId, image);
	}
	const cloned: Attachment[] = [];
	for (let i = 0; i < snapshot.attachments.length; i += 1) {
		cloned.push(cloneAttachment(snapshot.attachments[i]));
	}
	target.attachments = cloned;
}

/**
 * Walk the error cause chain for the canonical `FailureReason` carried by a
 * `CreationFailureError`. Returns the first one found, or `null` when no
 * creation failure in the chain carries a cross-cutting classification.
 *
 * This is what lets a pre-session creation failure (e.g. an interactive
 * sign-in requirement) render the same curated, lifecycle-driven card the
 * resume path produces, instead of the raw tripled creation message.
 */
export function findCreationFailureReason(error: Error): FailureReason | null {
	let current: Error | undefined = error;
	let depth = 0;
	while (current !== undefined && depth < 10) {
		if (current instanceof CreationFailureError && current.failureReason !== null) {
			return current.failureReason;
		}
		const cause: unknown = current.cause;
		current = cause instanceof Error ? cause : undefined;
		depth += 1;
	}
	return null;
}

/**
 * Walk the error cause chain for an {@link AuthenticationRequiredError}. Returns
 * the agent name and sign-in instructions when the pre-session activation failed
 * solely because the agent needs an interactive sign-in, or `null` otherwise.
 *
 * Authentication-required is NOT a failure: it's an expected, recoverable
 * precondition. Recovering it here lets the panel render a neutral sign-in card
 * above the composer instead of routing into the connection-error scene.
 */
export function findAuthenticationRequirement(
	error: Error
): { agent: string; instructions: string } | null {
	let current: Error | undefined = error;
	let depth = 0;
	while (current !== undefined && depth < 10) {
		if (current instanceof AuthenticationRequiredError) {
			return { agent: current.agent, instructions: current.instructions };
		}
		const cause: unknown = current.cause;
		current = cause instanceof Error ? cause : undefined;
		depth += 1;
	}
	return null;
}

export function formatPreSessionSendFailure(error: Error): string {
	const segments: string[] = [];
	let current: Error | undefined = error;
	while (current !== undefined) {
		segments.push(current.message);
		const cause: unknown = current.cause;
		if (cause instanceof Error) {
			current = cause;
		} else {
			break;
		}
	}
	return segments.join(" ");
}

export function shouldDisableSendForFailedFirstSend(params: {
	hasSession: boolean;
	panelConnectionState: PanelConnectionState;
}): boolean {
	if (params.hasSession) {
		return false;
	}
	return params.panelConnectionState === PanelConnectionState.ERROR;
}
