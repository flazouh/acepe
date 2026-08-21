import * as Context from "effect/Context"
import type { HistoryImporterShape } from "../importer.ts"

export class OpenCodeHistory extends Context.Service<OpenCodeHistory, HistoryImporterShape>()(
	"@acepe/server/history/Services/OpenCodeHistory"
) {}
