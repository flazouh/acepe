//! Codex provider module — one home for Codex native app-server adapter concerns.
//!
//! ## Ingress edge map (R3)
//!
//! Classification table: `acp/session/ingress/tool_identity/providers/codex.rs` (plan 009 home; referenced, not moved).
//!
//! Fewer live ingress edges than Cursor — native app-server protocol, no enrichment index.
//!
//! | Edge | Entry | Notes |
//! |------|-------|-------|
//! | Live parse | `acp/client/codex_native_events.rs` | App-server JSON events |
//! | Plan wrapper adapt | `codex/provider.rs` `adapt_codex_wrapper_plan_update` | Plan chunk normalization |
//! | History restore | Codex session persistence | Via native client state |

mod provider;

pub use provider::CodexProvider;

pub(crate) use provider::adapt_codex_wrapper_plan_update;
