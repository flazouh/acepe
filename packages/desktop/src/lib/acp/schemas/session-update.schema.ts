import { z } from "zod";

/**
 * Schema for raw ACP session update format.
 *
 * Raw format has sessionId at top level:
 * { sessionId: "...", update: {...} }
 */
export const RawSessionUpdateSchema = z.object({
	sessionId: z.string().min(1),
	update: z.record(z.string(), z.unknown()),
});

/**
 * TypeScript type inferred from the schema.
 */
export type RawSessionUpdate = z.infer<typeof RawSessionUpdateSchema>;
