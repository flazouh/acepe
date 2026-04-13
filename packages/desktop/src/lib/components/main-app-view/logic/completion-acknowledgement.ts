import type { UnseenStore } from "$lib/acp/store/index.js";

export type CompletionAttentionAction = "mark_seen" | "mark_unseen" | "noop";

export type CompletionAttentionEvent =
	| { readonly kind: "panel-focused" }
	| { readonly kind: "explicit-reveal" }
	| { readonly kind: "turn-complete"; readonly panelIsFocused: boolean };

export interface CompletionAttentionPanel {
	readonly id: string;
	readonly sessionId: string | null;
}

export function resolveCompletionAttentionAction(
	event: CompletionAttentionEvent
): CompletionAttentionAction {
	if (event.kind === "panel-focused") {
		return "noop";
	}

	if (event.kind === "explicit-reveal") {
		return "mark_seen";
	}

	return event.panelIsFocused ? "mark_seen" : "mark_unseen";
}

export function applyCompletionAttentionAction(
	unseenStore: Pick<UnseenStore, "markSeen" | "markUnseen">,
	panelId: string,
	event: CompletionAttentionEvent
): void {
	const action = resolveCompletionAttentionAction(event);
	if (action === "mark_seen") {
		unseenStore.markSeen(panelId);
		return;
	}

	if (action === "mark_unseen") {
		unseenStore.markUnseen(panelId);
	}
}

export function acknowledgeExplicitPanelReveal(
	unseenStore: Pick<UnseenStore, "markSeen" | "markUnseen">,
	panel: CompletionAttentionPanel | null | undefined
): void {
	if (!panel || panel.sessionId === null) {
		return;
	}

	applyCompletionAttentionAction(unseenStore, panel.id, { kind: "explicit-reveal" });
}

export function performExplicitPanelReveal(
	unseenStore: Pick<UnseenStore, "markSeen" | "markUnseen">,
	panel: CompletionAttentionPanel | null | undefined,
	reveal: () => void
): void {
	reveal();
	acknowledgeExplicitPanelReveal(unseenStore, panel);
}
