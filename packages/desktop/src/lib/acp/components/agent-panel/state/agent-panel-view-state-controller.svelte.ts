/**
 * AgentPanelViewStateController — owns panel view-state derivation
 * (derivePanelViewState / panelViewKind), hoisted from agent-panel.svelte.
 */

import {
	derivePanelViewState,
	type PanelViewState,
	type PanelViewStateInput,
} from "../../../logic/panel-visibility.js";

export interface AgentPanelViewStateControllerDeps {
	getViewStateInput: () => PanelViewStateInput;
}

export class AgentPanelViewStateController {
	readonly #deps: AgentPanelViewStateControllerDeps;

	constructor(deps: AgentPanelViewStateControllerDeps) {
		this.#deps = deps;
	}

	readonly viewState = $derived.by((): PanelViewState => {
		return derivePanelViewState(this.#deps.getViewStateInput());
	});

	readonly panelViewKind = $derived(this.viewState.kind);
}
