use std::collections::HashMap;
use std::sync::OnceLock;

static SHELL_ENV_CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();

/// Strategy for building agent subprocess environment.
pub enum EnvStrategy<'a> {
    /// Pass full process env + shell env (for bundled/trusted agents: Claude, Codex)
    FullInherit,
    /// Only pass explicitly listed keys from process + shell env (for downloaded agents: Cursor, OpenCode)
    Allowlist(&'a [&'a str]),
}

/// Build a complete environment map for spawning an agent subprocess.
pub fn build_env(strategy: EnvStrategy) -> HashMap<String, String> {
    let process_env: HashMap<String, String> = std::env::vars().collect();
    let shell_env = SHELL_ENV_CACHE.get();
    build_env_from(strategy, process_env, shell_env)
}

/// Get the PATH string to pass to subprocesses.
/// fix-path-env sets the process-wide PATH from the login shell at startup (main.rs),
/// so std::env::var("PATH") already contains the full shell PATH.
pub fn get_enhanced_path_string() -> String {
    std::env::var("PATH").unwrap_or_default()
}

/// Pre-warm the shell env cache. Call from async startup context.
pub async fn prewarm() {
    if SHELL_ENV_CACHE.get().is_some() {
        return;
    }
    match tokio::task::spawn_blocking(capture_login_shell_env).await {
        Ok(Ok(env)) => {
            tracing::info!(entries = env.len(), "Shell environment captured");
            let _ = SHELL_ENV_CACHE.set(env);
        }
        Ok(Err(e)) => tracing::warn!("Shell env capture failed: {e}"),
        Err(e) => tracing::warn!("Shell env task panicked: {e}"),
    }
}

fn capture_login_shell_env() -> Result<HashMap<String, String>, String> {
    let start = std::time::Instant::now();
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    if !std::path::Path::new(&shell).exists() {
        return Err(format!("Shell not found: {shell}"));
    }

    let output = std::process::Command::new(&shell)
        .args(["-lc", "env -0"])
        .env("DISABLE_AUTO_UPDATE", "true")
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .output()
        .map_err(|e| format!("Failed to spawn {shell}: {e}"))?;

    tracing::debug!(
        elapsed_ms = start.elapsed().as_millis(),
        "Shell spawn completed"
    );

    if !output.status.success() {
        return Err(format!("Shell exited with {}", output.status));
    }

    Ok(parse_env_output(&output.stdout))
}

fn parse_env_output(bytes: &[u8]) -> HashMap<String, String> {
    String::from_utf8_lossy(bytes)
        .split('\0')
        .filter(|s| !s.is_empty())
        .filter_map(|entry| {
            let (key, value) = entry.split_once('=')?;
            // Validate key is a valid env var name
            if key.is_empty() || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
                return None;
            }
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

/// Exact-match vars that are NEVER forwarded to agent subprocesses.
const DENYLIST: &[&str] = &[
    // Language runtime injection
    "_JAVA_OPTIONS",
    "PERL5OPT",
    "NODE_OPTIONS",
    "PYTHONSTARTUP",
    "RUBYOPT",
    // Shell injection
    "BASH_ENV",
    "ENV",
    "PROMPT_COMMAND",
];

/// Prefix-based deny — blocks entire families of injection vectors.
const DENIED_PREFIXES: &[&str] = &[
    "DYLD_", // macOS dyld injection (all variants)
    "LD_",   // Linux ld injection (all variants)
];

fn is_denied(key: &str) -> bool {
    DENYLIST.contains(&key) || DENIED_PREFIXES.iter().any(|prefix| key.starts_with(prefix))
}

pub fn is_denied_env_key(key: &str) -> bool {
    is_denied(key)
}

fn build_env_from(
    strategy: EnvStrategy,
    process_env: HashMap<String, String>,
    shell_env: Option<&HashMap<String, String>>,
) -> HashMap<String, String> {
    let mut env = match strategy {
        EnvStrategy::FullInherit => {
            let mut env = process_env;
            // Strip denied vars from process env too (not just shell env)
            env.retain(|key, _| !is_denied(key));
            if let Some(shell) = shell_env {
                for (key, value) in shell {
                    if is_denied(key) {
                        continue;
                    }
                    env.entry(key.clone()).or_insert_with(|| value.clone());
                }
            }
            env
        }
        EnvStrategy::Allowlist(allowed) => {
            let mut env = HashMap::new();
            for &key in allowed {
                if is_denied(key) {
                    continue;
                }
                // Check process env first (takes precedence), then shell env
                if let Some(val) = process_env.get(key) {
                    env.insert(key.to_string(), val.clone());
                } else if let Some(shell) = shell_env {
                    if let Some(val) = shell.get(key) {
                        env.insert(key.to_string(), val.clone());
                    }
                }
            }
            env
        }
    };

    // PATH is always set from the enriched process PATH
    env.insert("PATH".to_string(), get_enhanced_path_string());
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_nul_delimited_env() {
        let output = b"AZURE_API_KEY=secret\0HOME=/Users/test\0MULTI=line1\nline2\0";
        let parsed = parse_env_output(output);

        assert_eq!(parsed.get("AZURE_API_KEY"), Some(&"secret".to_string()));
        assert_eq!(parsed.get("HOME"), Some(&"/Users/test".to_string()));
        assert_eq!(parsed.get("MULTI"), Some(&"line1\nline2".to_string()));
    }

    #[test]
    fn parse_rejects_malformed_entries() {
        let output = b"VALID=yes\0not-a-var\0=no_key\0ALSO_VALID=ok\0";
        let parsed = parse_env_output(output);

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed.get("VALID"), Some(&"yes".to_string()));
        assert_eq!(parsed.get("ALSO_VALID"), Some(&"ok".to_string()));
    }

    #[test]
    fn parse_handles_values_with_equals() {
        let output = b"CONNECTION=host=localhost;port=5432\0";
        let parsed = parse_env_output(output);
        assert_eq!(
            parsed.get("CONNECTION"),
            Some(&"host=localhost;port=5432".to_string())
        );
    }

    #[test]
    fn build_full_inherit_fills_missing_from_shell() {
        let process = HashMap::from([("HOME".into(), "/Users/test".into())]);
        let shell = HashMap::from([
            ("AZURE_API_KEY".into(), "secret".into()),
            ("HOME".into(), "/shell/home".into()),
        ]);

        let env = build_env_from(EnvStrategy::FullInherit, process, Some(&shell));

        assert_eq!(env.get("AZURE_API_KEY"), Some(&"secret".to_string()));
        // Process env takes precedence
        assert_eq!(env.get("HOME"), Some(&"/Users/test".to_string()));
    }

    #[test]
    fn build_allowlist_only_includes_listed_keys() {
        let process = HashMap::from([
            ("HOME".into(), "/Users/test".into()),
            ("SECRET".into(), "leaked".into()),
        ]);
        let shell = HashMap::from([("CURSOR_API_KEY".into(), "key123".into())]);
        let allowed = &["HOME", "CURSOR_API_KEY"];

        let env = build_env_from(EnvStrategy::Allowlist(allowed), process, Some(&shell));

        assert_eq!(env.get("HOME"), Some(&"/Users/test".to_string()));
        assert_eq!(env.get("CURSOR_API_KEY"), Some(&"key123".to_string()));
        assert!(!env.contains_key("SECRET"));
    }

    #[test]
    fn build_strips_dangerous_vars() {
        let process = HashMap::new();
        let shell = HashMap::from([
            ("DYLD_INSERT_LIBRARIES".into(), "/evil.dylib".into()),
            ("LD_PRELOAD".into(), "/evil.so".into()),
            ("NODE_OPTIONS".into(), "--require=/evil.js".into()),
            ("AZURE_API_KEY".into(), "safe".into()),
        ]);

        let env = build_env_from(EnvStrategy::FullInherit, process, Some(&shell));

        assert!(!env.contains_key("DYLD_INSERT_LIBRARIES"));
        assert!(!env.contains_key("LD_PRELOAD"));
        assert!(!env.contains_key("NODE_OPTIONS"));
        assert_eq!(env.get("AZURE_API_KEY"), Some(&"safe".to_string()));
    }

    #[test]
    fn build_survives_shell_capture_failure() {
        let process = HashMap::from([("HOME".into(), "/Users/test".into())]);
        let env = build_env_from(EnvStrategy::FullInherit, process, None);

        assert_eq!(env.get("HOME"), Some(&"/Users/test".to_string()));
    }

    #[test]
    fn build_always_sets_path() {
        let process = HashMap::new();
        let env = build_env_from(EnvStrategy::FullInherit, process, None);

        assert!(env.contains_key("PATH"));
    }

    #[test]
    fn allowlist_strips_dangerous_vars_even_if_listed() {
        let process = HashMap::from([("LD_PRELOAD".into(), "/evil.so".into())]);
        let allowed = &["PATH", "HOME", "LD_PRELOAD"];

        let env = build_env_from(EnvStrategy::Allowlist(allowed), process, None);

        assert!(!env.contains_key("LD_PRELOAD"));
        assert!(env.contains_key("PATH"));
    }

    #[test]
    fn full_inherit_strips_dangerous_vars_from_process_env() {
        let process = HashMap::from([
            ("DYLD_INSERT_LIBRARIES".into(), "/evil.dylib".into()),
            ("NODE_OPTIONS".into(), "--require=/evil.js".into()),
            ("HOME".into(), "/Users/test".into()),
        ]);

        let env = build_env_from(EnvStrategy::FullInherit, process, None);

        assert!(!env.contains_key("DYLD_INSERT_LIBRARIES"));
        assert!(!env.contains_key("NODE_OPTIONS"));
        assert_eq!(env.get("HOME"), Some(&"/Users/test".to_string()));
    }

    #[test]
    fn prefix_based_blocking_catches_dyld_and_ld_variants() {
        let process = HashMap::new();
        let shell = HashMap::from([
            ("DYLD_PRINT_LIBRARIES".into(), "1".into()),
            ("DYLD_FALLBACK_LIBRARY_PATH".into(), "/evil".into()),
            ("LD_DEBUG".into(), "all".into()),
            ("LD_PROFILE".into(), "1".into()),
            ("SAFE_VAR".into(), "ok".into()),
        ]);

        let env = build_env_from(EnvStrategy::FullInherit, process, Some(&shell));

        assert!(!env.contains_key("DYLD_PRINT_LIBRARIES"));
        assert!(!env.contains_key("DYLD_FALLBACK_LIBRARY_PATH"));
        assert!(!env.contains_key("LD_DEBUG"));
        assert!(!env.contains_key("LD_PROFILE"));
        assert_eq!(env.get("SAFE_VAR"), Some(&"ok".to_string()));
    }
}
