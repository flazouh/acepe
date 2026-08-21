import * as Context from "effect/Context"
import type { HistoryImporterShape } from "../importer.ts"

export class CursorHistory extends Context.Service<CursorHistory, HistoryImporterShape>()(
	"@acepe/server/history/Services/CursorHistory"
) {}
