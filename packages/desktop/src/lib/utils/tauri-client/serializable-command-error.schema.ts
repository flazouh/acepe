import { z } from "zod";
import { SerializableAcpErrorSchema } from "../../acp/errors/serializable-acp-error.schema.js";

export const CommandErrorClassificationSchema = z.enum(["expected", "unexpected"]);

const SerializableCommandErrorDomainSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("acp"),
		data: SerializableAcpErrorSchema,
	}),
]);

const SerializableCommandErrorDiagnosticsSchema = z.object({
	summary: z.string(),
});

export const SerializableCommandErrorSchema = z.object({
	commandName: z.string(),
	classification: CommandErrorClassificationSchema,
	backendCorrelationId: z.string(),
	message: z.string(),
	backendEventId: z.string().optional(),
	domain: SerializableCommandErrorDomainSchema.optional(),
	diagnostics: SerializableCommandErrorDiagnosticsSchema.optional(),
});

export type CommandErrorClassification = z.infer<typeof CommandErrorClassificationSchema>;
export type SerializableCommandError = z.infer<typeof SerializableCommandErrorSchema>;

export function parseSerializableCommandError(value: unknown): SerializableCommandError | null {
	const result = SerializableCommandErrorSchema.safeParse(value);
	return result.success ? result.data : null;
}
