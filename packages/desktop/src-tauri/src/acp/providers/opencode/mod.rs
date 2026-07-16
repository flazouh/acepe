//! OpenCode provider module — one home for OpenCode HTTP adapter concerns.
//!
//! ## Ingress edge map (R3)
//!
//! Classification table: `acp/reconciler/providers/open_code.rs` (plan 009 home; referenced, not moved).
//!
//! Fewer live ingress edges than Cursor — HTTP REST + SSE transport, no ACP JSON-RPC enrichment index.
//!
//! | Edge | Entry | Notes |
//! |------|-------|-------|
//! | Live parse | `acp/opencode/` HTTP client + event mapping | SSE session updates |
//! | History restore | OpenCode server history API | Via HTTP client, not local JSONL |
//! | Settings overlay | `opencode/settings.rs` | Global + project `opencode.json` defaults |

mod provider;
pub(crate) mod settings;

pub use provider::OpenCodeProvider;

pub(crate) use provider::resolve_opencode_spawn_configs;
