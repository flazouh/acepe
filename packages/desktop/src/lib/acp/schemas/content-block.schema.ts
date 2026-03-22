import { z } from "zod";

/**
 * Embedded resource schema per ACP protocol specification.
 *
 * @see https://agentclientprotocol.com/protocol/schema#contentblock
 */
export const EmbeddedResourceSchema = z.object({
	uri: z.string(),
	text: z.string().optional(),
	blob: z.string().optional(),
	mimeType: z.string().optional(),
});

/**
 * Content block schema per ACP protocol specification.
 *
 * Uses discriminated union based on the 'type' field.
 * Matches the Rust backend enum structure exactly.
 *
 * @see https://agentclientprotocol.com/protocol/schema#contentblock
 */
export const ContentBlockSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("text"),
		text: z.string(),
	}),
	z.object({
		type: z.literal("image"),
		data: z.string(),
		mimeType: z.string(),
		uri: z.string().optional(),
	}),
	z.object({
		type: z.literal("audio"),
		data: z.string(),
		mimeType: z.string(),
	}),
	z.object({
		type: z.literal("resource"),
		resource: EmbeddedResourceSchema,
	}),
	z.object({
		type: z.literal("resource_link"),
		uri: z.string(),
		name: z.string(),
		title: z.string().optional(),
		description: z.string().optional(),
		mimeType: z.string().optional(),
		size: z.number().optional(),
	}),
]);

/**
 * TypeScript type inferred from the Zod schema.
 * This ensures type safety at compile time and runtime validation.
 */
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

/**
 * Embedded resource type inferred from schema.
 */
export type EmbeddedResource = z.infer<typeof EmbeddedResourceSchema>;
