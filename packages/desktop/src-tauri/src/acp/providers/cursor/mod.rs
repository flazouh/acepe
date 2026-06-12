//! Cursor provider module — one home for Cursor ACP adapter concerns.
//!
//! ## Ingress edge map (R3)
//!
//! Classification table: `acp/reconciler/providers/cursor.rs` (plan 009 home; referenced, not moved).
//!
//! | Edge | Entry | Normalizer | Tests |
//! |------|-------|------------|-------|
//! | Live parse | `acp/parsers/cursor_parser.rs` via `acp_fields::extract_tool_call_id` | `acp_fields::normalize_tool_call_id` | `parsers/tests/cursor_ingress_edges.rs` |
//! | History restore | `session_converter/cursor.rs` + `fullsession.rs` | `acp_fields::normalize_tool_call_id` | `cursor_ingress_edges.rs`, `session_converter/cursor.rs` tests |
//! | Enrichment index | `cursor/enrichment.rs` `build_persisted_tool_use_index` | `acp_fields::normalize_tool_call_id` | enrichment inline tests (`enriches_sparse_*`, `persisted_tool_use_index_*`) |
//! | Snapshot rehydration | `transcript_projection/snapshot.rs` + `display_id.rs` | `acp_fields::normalize_tool_call_id` | `cursor_ingress_edges.rs` `snapshot_rehydration_*` |

mod enrichment;
mod provider;

pub use provider::CursorProvider;

#[cfg(test)]
pub(crate) use enrichment::{clear_test_tool_use_cache, seed_test_tool_use_cache};
