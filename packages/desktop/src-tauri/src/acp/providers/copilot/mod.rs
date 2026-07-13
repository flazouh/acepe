//! GitHub Copilot provider module — one home for Copilot ACP adapter concerns.
//!
//! ## Ingress edge map (R3)
//!
//! Classification table: `acp/session/ingress/tool_identity/providers/copilot.rs` (plan 009 home; referenced, not moved).
//!
//! Fewer live ingress edges than Cursor — no enrichment index; history model discovery via catalog.
//!
//! | Edge | Entry | Notes |
//! |------|-------|-------|
//! | Live parse | `acp/parsers/copilot_parser.rs` | ACP stdio session updates |
//! | History restore | Copilot session state / event files | `discover_copilot_history_models` in provider |
//! | Settings overlay | `copilot/settings.rs` | `.copilot/config.json` defaults |
//! | Model catalog | `copilot/model_catalog.rs` | Cached ACP model list |

pub(crate) mod model_catalog;
mod provider;
pub(crate) mod settings;

pub use provider::CopilotProvider;
