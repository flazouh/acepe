use super::*;
use crate::acp::provider::SpawnConfig;
use crate::acp::runtime_resolver::{resolve_effective_runtime, AgentEnvOverrides};
use crate::commands::observability::{expected_acp_command_result, CommandResult};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use tokio_util::sync::CancellationToken;

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const VERIFY_TIMEOUT: Duration = Duration::from_secs(5);

fn active_authentications() -> &'static Mutex<HashMap<String, CancellationToken>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthenticationCommandError {
    Cancelled,
    Failed,
    TimedOut,
}

async fn run_authentication_command(
    provider_id: &str,
    config: &SpawnConfig,
    cwd: &Path,
    overrides: Option<&AgentEnvOverrides>,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<(), AuthenticationCommandError> {
    let runtime = resolve_effective_runtime(provider_id, cwd, config, overrides);
    let mut command = Command::new(&runtime.command);
    command
        .args(&runtime.args)
        .current_dir(&runtime.cwd)
        .env_clear()
        .envs(&runtime.env)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|_| AuthenticationCommandError::Failed)?;

    tokio::select! {
        status = child.wait() => match status {
            Ok(exit) if exit.success() => Ok(()),
            _ => Err(AuthenticationCommandError::Failed),
        },
        _ = cancel.cancelled() => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(AuthenticationCommandError::Cancelled)
        },
        _ = sleep(timeout) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(AuthenticationCommandError::TimedOut)
        },
    }
}

fn safe_error(error: AuthenticationCommandError) -> SerializableAcpError {
    let message = match error {
        AuthenticationCommandError::Cancelled => "Sign-in was cancelled.",
        AuthenticationCommandError::Failed => "Sign-in did not complete. Please try again.",
        AuthenticationCommandError::TimedOut => "Sign-in timed out. Please try again.",
    };
    SerializableAcpError::ProtocolError {
        message: message.to_string(),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn acp_authenticate_agent(
    app: AppHandle,
    agent_id: CanonicalAgentId,
) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_authenticate_agent",
        async {
            let registry = app.state::<Arc<AgentRegistry>>();
            let provider =
                registry
                    .get(&agent_id)
                    .ok_or_else(|| SerializableAcpError::ProtocolError {
                        message: "Agent is not available for sign-in.".to_string(),
                    })?;
            let action = provider.authentication_action().ok_or_else(|| {
                SerializableAcpError::ProtocolError {
                    message: "This agent does not support in-app sign-in.".to_string(),
                }
            })?;
            let key = agent_id.to_string();
            let cancel = CancellationToken::new();
            {
                let mut active = active_authentications().lock().await;
                if active.contains_key(&key) {
                    return Err(SerializableAcpError::ProtocolError {
                        message: "Sign-in is already in progress.".to_string(),
                    });
                }
                active.insert(key.clone(), cancel.clone());
            }

            let overrides = crate::acp::runtime_resolver::load_saved_agent_env_overrides(&app)
                .await
                .ok();
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let login_result = run_authentication_command(
                provider.id(),
                &action.login,
                &cwd,
                overrides.as_ref(),
                LOGIN_TIMEOUT,
                &cancel,
            )
            .await;
            let result = match login_result {
                Ok(()) => {
                    run_authentication_command(
                        provider.id(),
                        &action.verify,
                        &cwd,
                        overrides.as_ref(),
                        VERIFY_TIMEOUT,
                        &cancel,
                    )
                    .await
                }
                Err(error) => Err(error),
            };
            active_authentications().lock().await.remove(&key);
            result.map_err(safe_error)
        }
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn acp_cancel_agent_authentication(agent_id: CanonicalAgentId) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_cancel_agent_authentication",
        async {
            let key = agent_id.to_string();
            let active = active_authentications().lock().await;
            let cancel = active
                .get(&key)
                .ok_or_else(|| SerializableAcpError::ProtocolError {
                    message: "No sign-in is currently running.".to_string(),
                })?;
            cancel.cancel();
            Ok(())
        }
        .await,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(command: &str) -> SpawnConfig {
        SpawnConfig {
            command: command.to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            env_strategy: None,
        }
    }

    #[tokio::test]
    async fn runner_accepts_successful_process() {
        let cancel = CancellationToken::new();
        let result = run_authentication_command(
            "cursor",
            &config("/usr/bin/true"),
            Path::new("/tmp"),
            None,
            Duration::from_secs(1),
            &cancel,
        )
        .await;

        assert_eq!(result, Ok(()));
    }

    #[tokio::test]
    async fn runner_maps_process_failure_without_output() {
        let cancel = CancellationToken::new();
        let result = run_authentication_command(
            "cursor",
            &config("/usr/bin/false"),
            Path::new("/tmp"),
            None,
            Duration::from_secs(1),
            &cancel,
        )
        .await;

        assert_eq!(result, Err(AuthenticationCommandError::Failed));
    }
}
