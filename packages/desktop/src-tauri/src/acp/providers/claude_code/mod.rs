//! Claude Code provider module — one home for Claude Code ACP adapter concerns.
//!
//! ## Ingress edge map (R3)
//!
//! Classification table: `acp/reconciler/providers/claude_code.rs` (plan 009 home; referenced, not moved).
//!
//! Fewer live ingress edges than Cursor — no JSONL enrichment index or Cursor-style tool-use cache.
//!
//! | Edge | Entry | Notes |
//! |------|-------|-------|
//! | Live parse | `acp/parsers/claude_code_parser.rs` | CcSdk / ACP session updates |
//! | History restore | `acp/session/ingress` HistorySource + fold | Provider history JSONL |
//! | Settings overlay | `claude_code/settings.rs` | Session model/mode defaults from config |
//! | Model catalog | `claude_code/model_catalog.rs` | Cached CLI `--help` model discovery |

pub(crate) mod context_window;
pub(crate) mod model_catalog;
mod provider;
pub(crate) mod settings;

pub use provider::ClaudeCodeProvider;
