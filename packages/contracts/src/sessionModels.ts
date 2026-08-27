/**
 * The models a session can actually run, as a canonical fact.
 *
 * Nothing used to ask an agent what it offers. The list lived as a constant
 * beside the picker, so a model the provider had shipped since that constant
 * was written did not exist to the app at all. A provider knows its own
 * catalog: the adapter asks for it, encodes THIS shape onto a session event,
 * and every reader downstream -- the projection, the snapshot, the composer --
 * reads the provider's answer instead of a copy of it.
 *
 * The shape is deliberately provider-neutral. Claude reports `ModelInfo`
 * (value/displayName/description) over its SDK, OpenCode reports an HTTP
 * catalog, and Copilot and Cursor report models as ACP config options with
 * `category: "model"`. All three collapse into an id, a display name and an
 * optional description, so a second provider publishing into this fact needs
 * an adapter change and nothing else.
 */

import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { TrimmedNonEmptyString } from "./baseSchemas.ts"

export const SessionModelDescriptor = Schema.Struct({
	// The id the provider itself wants back when a model is selected.
	modelId: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	// The provider's own words about the model. Null for a provider that
	// publishes names only.
	description: Schema.NullOr(Schema.String),
})
export type SessionModelDescriptor = typeof SessionModelDescriptor.Type

export const SessionModelCatalog = Schema.Array(SessionModelDescriptor)
export type SessionModelCatalog = typeof SessionModelCatalog.Type

/**
 * What an adapter encodes onto a `SessionMetaUpdated` event's metadata once it
 * has asked its provider for the catalog, the same way every adapter already
 * publishes the `provider_session` fact. Provider-agnostic on purpose: the
 * projection that folds it must not know which provider answered.
 */
export const SessionModelsListedFact = Schema.Struct({
	contractKind: Schema.Literal("session_models"),
	models: SessionModelCatalog,
})
export type SessionModelsListedFact = typeof SessionModelsListedFact.Type

export const sessionModelsListedFact = (
	models: SessionModelCatalog,
): SessionModelsListedFact => ({
	contractKind: "session_models",
	models,
})

/**
 * The catalog an event's metadata carries, or null when it carries none.
 *
 * Null means "this event said nothing about models", never "this session has no
 * models": the fact rides the busiest event on a session, so a reader that
 * treated a silent metadata bag as an empty catalog would empty the picker on
 * every title change. Every reader -- the SQL projection, the live snapshot
 * fold, the desktop bridge -- decodes through this one function so the three
 * cannot disagree about what a session_models fact is.
 */
export const sessionModelsFromMetadata = (
	metadata: unknown,
): SessionModelCatalog | null => {
	const decoded = Schema.decodeUnknownOption(SessionModelsListedFact)(metadata)
	return Option.match(decoded, {
		onNone: () => null,
		onSome: (fact) => fact.models,
	})
}

/**
 * The catalog as a projection column holds it: JSON text, decoded back through
 * the same schema that wrote it. Null for a session whose provider was never
 * asked or never answered, and for every row written before the column existed.
 */
export const StoredSessionModelCatalog = SessionModelCatalog.pipe(
	Schema.fromJsonString,
	Schema.NullOr,
)

export const encodeStoredSessionModelCatalog = Schema.encodeEffect(StoredSessionModelCatalog)
