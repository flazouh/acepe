use super::super::provider::{
    command_exists, AgentProvider, CommandAvailabilityCache, SpawnConfig,
};
use crate::acp::session_update::PlanSource;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Global resource directory path, set during app initialization
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Initialize the resource directory path. Call this during app setup.
pub fn set_resource_dir(path: PathBuf) {
    let _ = RESOURCE_DIR.set(path);
}

/// Get the resource directory (for use by other providers)
pub fn get_resource_dir() -> Option<&'static PathBuf> {
    RESOURCE_DIR.get()
}

/// Claude Code ACP Agent Provider
pub struct ClaudeCodeProvider;

impl AgentProvider for ClaudeCodeProvider {
    fn id(&self) -> &str {
        "claude-code"
    }

    fn name(&self) -> &str {
        "Claude Code"
    }

    fn spawn_config(&self) -> SpawnConfig {
        self.spawn_configs()
            .into_iter()
            .next()
            .expect("Claude provider must always return at least one spawn config")
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        resolve_claude_spawn_configs()
    }

    fn icon(&self) -> &str {
        "claude"
    }

    fn is_available(&self) -> bool {
        true
    }

    fn normalize_mode_id(&self, id: &str) -> String {
        match id {
            "default" | "acceptEdits" => "build".to_string(),
            other => other.to_string(),
        }
    }

    fn map_outbound_mode_id(&self, mode_id: &str) -> String {
        match mode_id {
            "build" => "default".to_string(),
            other => other.to_string(),
        }
    }

    fn default_plan_source(&self) -> PlanSource {
        PlanSource::Deterministic
    }

    fn uses_task_reconciler(&self) -> bool {
        true
    }
}

fn resolve_claude_spawn_configs() -> Vec<SpawnConfig> {
    let mut configs = Vec::new();

    if let Some(override_path) = std::env::var("CLAUDE_CODE_ACP_PATH")
        .ok()
        .filter(|path| !path.trim().is_empty())
    {
        push_unique_spawn_config(&mut configs, spawn_config_from_path(override_path));
    }

    let resource_dir = RESOURCE_DIR
        .get()
        .expect("RESOURCE_DIR must be set for Claude ACP");
    let bundled_path = resource_dir.join("acps/claude/claude-agent-acp");
    if bundled_path.exists() {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: bundled_path.to_string_lossy().to_string(),
                args: vec![],
                env: claude_env(),
            },
        );
    } else {
        tracing::warn!(
            path = %bundled_path.display(),
            "Bundled claude-agent-acp binary not found"
        );
    }

    if command_exists("claude-code-acp") {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "claude-code-acp".to_string(),
                args: vec![],
                env: claude_env(),
            },
        );
    }

    let command_cache = CommandAvailabilityCache::get();
    if command_cache.bunx {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "bunx".to_string(),
                args: vec!["@zed-industries/claude-code-acp".to_string()],
                env: claude_env(),
            },
        );
    }
    if command_cache.npx {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "npx".to_string(),
                args: vec![
                    "-y".to_string(),
                    "@zed-industries/claude-code-acp@latest".to_string(),
                ],
                env: claude_env(),
            },
        );
    }

    assert!(
        !configs.is_empty(),
        "Claude provider must have at least one launcher"
    );

    configs
}

fn spawn_config_from_path(path: String) -> SpawnConfig {
    if path.ends_with(".mjs") || path.ends_with(".js") {
        return SpawnConfig {
            command: "node".to_string(),
            args: vec![path],
            env: claude_env(),
        };
    }

    SpawnConfig {
        command: path,
        args: vec![],
        env: claude_env(),
    }
}

fn claude_env() -> std::collections::HashMap<String, String> {
    crate::shell_env::build_env(crate::shell_env::EnvStrategy::FullInherit)
}

fn push_unique_spawn_config(configs: &mut Vec<SpawnConfig>, candidate: SpawnConfig) {
    let exists = configs
        .iter()
        .any(|config| config.command == candidate.command && config.args == candidate.args);
    if !exists {
        configs.push(candidate);
    }
}

/// Sets RESOURCE_DIR to a temp dir with stub claude-agent-acp and codex-acp binaries.
/// Idempotent; safe to call from both Claude and Codex tests.
#[cfg(test)]
pub(crate) fn ensure_test_resource_dir() {
    use std::fs;
    use std::io::Write;
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let temp = tempfile::tempdir().expect("temp dir");
        let p = temp.path();
        fs::create_dir_all(p.join("acps/claude")).expect("create acps/claude");
        fs::create_dir_all(p.join("acps/codex")).expect("create acps/codex");
        fs::File::create(p.join("acps/claude/claude-agent-acp"))
            .expect("create stub")
            .write_all(b"stub")
            .expect("write stub");
        fs::File::create(p.join("acps/codex/codex-acp"))
            .expect("create stub")
            .write_all(b"stub")
            .expect("write stub");
        set_resource_dir(p.to_path_buf());
        Box::leak(Box::new(temp));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn spawn_config_never_panics() {
        ensure_test_resource_dir();
        let provider = ClaudeCodeProvider;
        let result = std::panic::catch_unwind(|| provider.spawn_config());

        assert!(result.is_ok(), "spawn_config should never panic");
        let config = result.expect("spawn_config should return config");
        assert!(
            !config.command.trim().is_empty(),
            "spawn command should never be empty"
        );
    }

    #[test]
    fn spawn_configs_prefer_explicit_override_path() {
        ensure_test_resource_dir();
        let provider = ClaudeCodeProvider;
        let override_path = "/tmp/custom-claude-agent-acp";

        std::env::set_var("CLAUDE_CODE_ACP_PATH", override_path);
        let configs = provider.spawn_configs();
        std::env::remove_var("CLAUDE_CODE_ACP_PATH");

        assert_eq!(configs[0].command, override_path);
        assert!(configs[0].args.is_empty());
    }

    #[test]
    fn spawn_configs_use_bundled_binary_when_no_override_is_set() {
        ensure_test_resource_dir();
        let provider = ClaudeCodeProvider;

        std::env::remove_var("CLAUDE_CODE_ACP_PATH");
        let configs = provider.spawn_configs();

        assert!(
            Path::new(&configs[0].command).ends_with("acps/claude/claude-agent-acp"),
            "expected bundled Claude ACP binary, got {}",
            configs[0].command
        );
    }
}
