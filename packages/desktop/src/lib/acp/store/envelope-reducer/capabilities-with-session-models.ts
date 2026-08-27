import type {
	AvailableModel,
	ModelsForDisplay,
	SessionGraphCapabilities,
} from "../../../services/acp-types.js";

type SessionModelState = NonNullable<SessionGraphCapabilities["models"]>;

/**
 * One place that decides which optional keys a model state carries, so the two
 * writers below cannot disagree. `exactOptionalPropertyTypes` forbids writing
 * `undefined` into an optional key, and an absent `availableModels` is not the
 * same claim as an empty one: capability-projection.ts reports an absent
 * `models` object as `null` ("no provider answered yet") and an empty
 * `availableModels` as an empty list.
 */
function sessionModelState(input: {
	readonly currentModelId: string | null;
	readonly availableModels: ReadonlyArray<AvailableModel> | undefined;
	readonly modelsDisplay: ModelsForDisplay | undefined;
}): SessionModelState {
	if (input.availableModels === undefined) {
		return input.modelsDisplay === undefined
			? { currentModelId: input.currentModelId }
			: { currentModelId: input.currentModelId, modelsDisplay: input.modelsDisplay };
	}
	const availableModels = [...input.availableModels];
	return input.modelsDisplay === undefined
		? { currentModelId: input.currentModelId, availableModels }
		: {
				currentModelId: input.currentModelId,
				availableModels,
				modelsDisplay: input.modelsDisplay,
			};
}

/**
 * The model a session runs, written onto an existing capabilities projection
 * and nothing else. `capabilitiesWithSessionMode` is the mode counterpart, and
 * the reasoning is the same: this is one narrow fact, every other capability
 * belongs to a different producer, and a model change is not evidence about any
 * of them.
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
	return {
		models: sessionModelState({
			currentModelId,
			availableModels: previous?.availableModels,
			modelsDisplay: previous?.modelsDisplay,
		}),
		modes: capabilities.modes ?? null,
		availableCommands: capabilities.availableCommands,
		configOptions: capabilities.configOptions,
		autonomousEnabled: capabilities.autonomousEnabled,
	};
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
	return {
		models: sessionModelState({
			currentModelId: previous?.currentModelId ?? null,
			availableModels,
			modelsDisplay: previous?.modelsDisplay,
		}),
		modes: capabilities.modes ?? null,
		availableCommands: capabilities.availableCommands,
		configOptions: capabilities.configOptions,
		autonomousEnabled: capabilities.autonomousEnabled,
	};
}
