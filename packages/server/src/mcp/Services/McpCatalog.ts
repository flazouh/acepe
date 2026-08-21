import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { PlatformError } from "effect/PlatformError"
import type * as Schema from "effect/Schema"
import type { ComposerMcpCatalog, ResolveMcpCatalogInput } from "../Schemas.ts"

export type McpCatalogError = PlatformError | Schema.SchemaError

export interface McpCatalogShape {
	readonly resolve: (
		input: ResolveMcpCatalogInput
	) => Effect.Effect<ComposerMcpCatalog, McpCatalogError>
}

export class McpCatalog extends Context.Service<McpCatalog, McpCatalogShape>()(
	"@acepe/server/mcp/Services/McpCatalog"
) {}
