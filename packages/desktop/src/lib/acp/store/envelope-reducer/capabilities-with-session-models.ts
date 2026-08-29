import type {
	AvailableModel,
	ModelsForDisplay,
	SessionGraphCapabilities,
} from "../../../services/acp-types.js";

type SessionModelState = NonNullable<SessionGraphCapabilities["models"]>;

/**
 * A model state carrying only the keys it has an answer for.
 *
 * `exactOptionalPropertyTypes` forbids writing `undefined` into an optional
 * key, and an absent key is not the same claim as an empty value: an absent
 * `models` object reads as `null` in capability-projection.ts ("no provider
 * answered yet") while an empty `availableModels` reads as an empty list.
 */
function sessionModelState(input: {
	readonly currentModelId: string | null;
	readonly availableModels: ReadonlyArray<AvailableModel> | undefined;
	readonly modelsDisplay: ModelsForDisplay | undefined;
}): SessionModelState {
	const state: {
		currentModelId: string | null;
		availableModels?: AvailableModel[];
		modelsDisplay?: ModelsForDisplay;
	} = { currentModelId: input.currentModelId };
	if (input.availableModels !== undefined) {
		state.availableModels = [...input.availableModels];
	}
	if (input.modelsDisplay !== undefined) {
		state.modelsDisplay = input.modelsDisplay;
	}
	return state;
}

/**
 * A new model state written onto an existing capabilities projection, and
 * nothing else. `capabilitiesWithSessionMode` is the mode counterpart and the
 * reasoning is the same: every other capability here belongs to a different
 * producer -- the modes, the available commands, the config options, the
 * autonomous flag -- so a model fact is not evidence about any of them.
 */
function capabilitiesWithModelState(
	capabilities: SessionGraphCapabilities,
	models: SessionModelState
): SessionGraphCapabilities {
	return {
		models,
		modes: capabilities.modes ?? null,
		availableCommands: capabilities.availableCommands,
		configOptions: capabilities.configOptions,
		autonomousEnabled: capabilities.autonomousEnabled,
	};
}

/**
 * The model a session runs.
 *
 * The catalog is a separate writer below, because the two facts have different
 * owners. A provider owns its catalog and answers once per session; the user
 * owns the choice and may change it every turn. Writing one must never restate
 * the other, or a catalog arriving late would erase the model just picked.
 */
export function capabilitiesWithSessionModel(
	capabilities: SessionGraphCapabilities,
	currentModelId: string
): SessionGraphCapabilities {
	const previous = capabilities.models ?? null;
	return capabilitiesWithModelState(
		capabilities,
		sessionModelState({
			currentModelId,
			availableModels: previous?.availableModels,
			modelsDisplay: previous?.modelsDisplay,
		})
	);
}

/**
 * The models a session's provider reports it can run, replacing whatever
 * catalog the session held. A provider is the only authority on its own
 * catalog, so its latest answer wins outright -- there is no merge to do and no
 * constant left to merge with.
 */
export function capabilitiesWithSessionModels(
	capabilities: SessionGraphCapabilities,
	availableModels: ReadonlyArray<AvailableModel>
): SessionGraphCapabilities {
	const previous = capabilities.models ?? null;
	return capabilitiesWithModelState(
		capabilities,
		sessionModelState({
			currentModelId: previous?.currentModelId ?? null,
			availableModels,
			modelsDisplay: previous?.modelsDisplay,
		})
	);
}
