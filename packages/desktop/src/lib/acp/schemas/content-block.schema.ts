import * as Schema from "effect/Schema";

/**
 * Embedded resource schema per ACP protocol specification.
 *
 * @see https://agentclientprotocol.com/protocol/schema#contentblock
 */
export const EmbeddedResourceSchema = Schema.Struct({
	uri: Schema.String,
	text: Schema.optionalKey(Schema.String),
	blob: Schema.optionalKey(Schema.String),
	mimeType: Schema.optionalKey(Schema.String),
});

/**
 * Content block schema per ACP protocol specification.
 *
 * Uses a union based on the 'type' field.
 * Matches the Rust backend enum structure exactly.
 *
 * @see https://agentclientprotocol.com/protocol/schema#contentblock
 */
export const ContentBlockSchema = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("text"),
		text: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("image"),
		data: Schema.String,
		mimeType: Schema.String,
		uri: Schema.optionalKey(Schema.String),
	}),
	Schema.Struct({
		type: Schema.Literal("audio"),
		data: Schema.String,
		mimeType: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("resource"),
		resource: EmbeddedResourceSchema,
	}),
	Schema.Struct({
		type: Schema.Literal("resource_link"),
		uri: Schema.String,
		name: Schema.String,
		title: Schema.optionalKey(Schema.String),
		description: Schema.optionalKey(Schema.String),
		mimeType: Schema.optionalKey(Schema.String),
		size: Schema.optionalKey(Schema.Number),
	}),
]);

/**
 * TypeScript type inferred from the schema.
 * This ensures type safety at compile time and runtime validation.
 */
export type ContentBlock = typeof ContentBlockSchema.Type;

/**
 * Embedded resource type inferred from schema.
 */
export type EmbeddedResource = typeof EmbeddedResourceSchema.Type;
