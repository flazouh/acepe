/**
 * Service interfaces for domain service extraction.
 *
 * These narrow interfaces break circular dependencies by allowing
 * extracted services to depend on interfaces rather than concrete classes.
 */

export type { IBoundaryManager } from "./boundary-manager.js";
export type { ICapabilitiesManager } from "./capabilities-manager.js";
export type { IChunkAggregator } from "./chunk-aggregator-interface.js";
export type { IConnectionManager } from "./connection-manager.js";
export type { IEntryIndex } from "./entry-index.js";
export type { IEntryManager } from "./entry-manager.js";
export type { IEntryStoreInternal } from "./entry-store-internal.js";
export type { IHotStateManager } from "./hot-state-manager.js";
export type { ISessionStateReader } from "./session-state-reader.js";
export type { ISessionStateWriter } from "./session-state-writer.js";
export type { IToolCallManager } from "./tool-call-manager-interface.js";
