//! Cursor provider module — one home for Cursor ACP adapter concerns.
//!
//! ## Ingress edge map (R3)
//!
//! Classification table: `acp/session/ingress/tool_identity/providers/cursor.rs` (plan 009 home; referenced, not moved).
//!
//! | Edge | Entry | Normalizer | Tests |
//! |------|-------|------------|-------|
//! | Live parse | `acp/parsers/cursor_parser.rs` via `acp_fields::extract_tool_call_id` | `acp_fields::normalize_tool_call_id` | `parsers/tests/cursor_ingress_edges.rs` |
//! | Extensions | `cursor/extensions/` (`ask_question`, `create_plan`, `update_todos`, `task`, `generate_image`) | — | `cursor/extensions/tests.rs` |
//! | History restore | `acp/session/ingress/providers/cursor.rs` + fold | `acp_fields::normalize_tool_call_id` | `cursor_ingress_edges.rs` |
//! | Enrichment index | `cursor/enrichment.rs` `build_persisted_tool_use_index` | `acp_fields::normalize_tool_call_id` | enrichment inline tests (`enriches_sparse_*`, `persisted_tool_use_index_*`) |
//! | Snapshot rehydration | `transcript_projection/snapshot.rs` + `display_id.rs` | `acp_fields::normalize_tool_call_id` | `cursor_ingress_edges.rs` `snapshot_rehydration_*` |

mod enrichment;
mod extensions;
mod provider;
mod todo_sql;

pub use provider::CursorProvider;

pub use extensions::{
    adapt_cursor_response, cursor_extension_kind, is_cursor_extension_pre_tool,
    normalize_cursor_extension, CursorExtensionKind,
};

pub(crate) use todo_sql::parse_sql_todo_updates;

#[cfg(test)]
pub(crate) use enrichment::{clear_test_tool_use_cache, seed_test_tool_use_cache};
