/**
 * AgentPanelSessionController — owns the agent panel's session-derived reactive
 * state, hoisted out of the `agent-panel.svelte` god controller.
 *
 * Built incrementally across clusters (see
 * docs/plans/2026-05-29-002-refactor-agent-panel-session-controller-plan.md):
 *   - U1 (this commit): scaffold + accessor-dep constructor + scalar passthrough.
 *   - U2: identity/metadata derivations.
 *   - U3: canonical session-status derivations.
 *   - U4: error/connection state + mutators.
 *
 * Reactive scalars (`sessionId`, `panelId`) are passed as accessor functions so
 * the controller's `$derived` fields recompute when the underlying component
 * reactive sources change. Object/array-producing derivations MUST be
 * `$derived`/`$derived.by` FIELDS (not plain getters) to preserve memoization
 * and reference identity — see Decision 3 in the plan.
 */

import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";

export interface AgentPanelSessionControllerDeps {
	getSessionId: () => string | null;
	getPanelId: () => string | undefined;
	sessionStore: SessionStore;
	panelStore: PanelStore;
}

export class AgentPanelSessionController {
	readonly #deps: AgentPanelSessionControllerDeps;

	constructor(deps: AgentPanelSessionControllerDeps) {
		this.#deps = deps;
	}

	/** Cheap scalar passthrough — a plain getter is correct here (no memoized object). */
	get sessionId(): string | null {
		return this.#deps.getSessionId();
	}

	// ── Cluster A: session identity / metadata ──────────────────────────
	// Object-producing derivations are $derived FIELDS (not getters) so they
	// keep memoization + reference identity (plan Decision 3). The $derived.by
	// closures read this.#deps lazily on first access, after the constructor
	// has assigned it.

	/** Identity: id, projectPath, agentId, worktreePath (immutable - never changes). */
	readonly sessionIdentity = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.getSessionIdentity(id) : null;
	});

	/** Metadata: title, createdAt, updatedAt (rarely changes). */
	readonly sessionMetadata = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.getSessionMetadata(id) : null;
	});

	readonly sessionProjectPath = $derived(this.sessionIdentity?.projectPath ?? null);
	readonly sessionAgentId = $derived(this.sessionIdentity?.agentId ?? null);
	readonly sessionWorktreePath = $derived(this.sessionIdentity?.worktreePath ?? null);
	readonly sessionTitle = $derived(this.sessionMetadata?.title ?? null);

	/** Current model from canonical capabilities (for PR popover default). */
	readonly sessionCurrentModelId = $derived.by(() => {
		const id = this.#deps.getSessionId();
		return id ? this.#deps.sessionStore.getSessionCurrentModelId(id) : null;
	});

	/** Panel id with the default-panel fallback. */
	readonly effectivePanelId = $derived.by(() => this.#deps.getPanelId() ?? "default-panel");
}
