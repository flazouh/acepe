pub mod claude_code;
pub mod codex;
pub mod copilot;
pub mod cursor;
pub mod custom;
pub mod forge;
pub mod opencode;

// Backward-compatible module paths for catalog callers outside this tree.
pub(crate) use claude_code::model_catalog as claude_code_model_catalog;
pub(crate) use copilot::model_catalog as copilot_model_catalog;

pub use claude_code::ClaudeCodeProvider;
pub use codex::CodexProvider;
pub use copilot::CopilotProvider;
pub use cursor::CursorProvider;
pub use custom::CustomAgentConfig;
pub use forge::ForgeProvider;
pub use opencode::OpenCodeProvider;
