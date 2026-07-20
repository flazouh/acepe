import type { TranscriptViewportRow } from "../../../../services/acp-types.js";
import type { LocalPlaceholderRow } from "./local-placeholder-row.js";

export type RenderableTranscriptRow = TranscriptViewportRow | LocalPlaceholderRow;
