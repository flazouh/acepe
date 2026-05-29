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
}
