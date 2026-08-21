import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { SerializableAcpErrorSchema } from "../../acp/errors/serializable-acp-error.schema.js";

export const CommandErrorClassificationSchema = Schema.Literals(["expected", "unexpected"]);

const SerializableCommandErrorDomainSchema = Schema.Struct({
	type: Schema.Literal("acp"),
	data: SerializableAcpErrorSchema,
});

const SerializableCommandErrorDiagnosticsSchema = Schema.Struct({
	summary: Schema.String,
});

export const SerializableCommandErrorSchema = Schema.Struct({
	commandName: Schema.String,
	classification: CommandErrorClassificationSchema,
	backendCorrelationId: Schema.String,
	message: Schema.String,
	backendEventId: Schema.optionalKey(Schema.String),
	domain: Schema.optionalKey(SerializableCommandErrorDomainSchema),
	diagnostics: Schema.optionalKey(SerializableCommandErrorDiagnosticsSchema),
});

export type CommandErrorClassification = typeof CommandErrorClassificationSchema.Type;
export type SerializableCommandError = typeof SerializableCommandErrorSchema.Type;

const decodeSerializableCommandError = decodeUnknown(
	SerializableCommandErrorSchema,
	() => null
);

export function parseSerializableCommandError(value: unknown): SerializableCommandError | null {
	const decoded = decodeSerializableCommandError(value);
	return Result.isSuccess(decoded) ? decoded.success : null;
}
