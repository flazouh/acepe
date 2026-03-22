use crate::shell_env::get_enhanced_path_string;
use crate::terminal::registry::{TerminalRegistry, TerminalState};
use crate::terminal::types::{
    CreateTerminalRequest, CreateTerminalResponse, TerminalExitStatus, TerminalOutputResponse,
    WaitForExitResponse,
};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use uuid::Uuid;

/// Manages terminal lifecycle: creation, output reading, and cleanup
pub struct TerminalManager {
    registry: Arc<TerminalRegistry>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(TerminalRegistry::new()),
        }
    }

    /// Create a new terminal and start the command
    pub async fn create_terminal(
        &self,
        request: CreateTerminalRequest,
    ) -> Result<CreateTerminalResponse, String> {
        let terminal_id = Uuid::new_v4().to_string();

        tracing::info!(
            terminal_id = %terminal_id,
            session_id = %request.session_id,
            command = %request.command,
            args = ?request.args,
            cwd = ?request.cwd,
            "Creating terminal"
        );

        // Build command - wrap in shell to support pipes, && chains, etc.
        #[cfg(unix)]
        let mut cmd = {
            let mut c = Command::new("/bin/sh");
            c.arg("-c");
            c.arg(&request.command);
            c
        };

        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.arg("/C");
            c.arg(&request.command);
            c
        };

        // Note: request.args are ignored when using shell wrapper
        // The full command with args should be in request.command

        if let Some(ref cwd) = request.cwd {
            cmd.current_dir(cwd);
        }

        // Set enhanced PATH to include homebrew, nvm, bun, etc.
        // This is necessary because macOS GUI apps don't inherit the user's shell PATH.
        cmd.env("PATH", get_enhanced_path_string());

        for env_var in &request.env {
            cmd.env(&env_var.name, &env_var.value);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn process '{}': {}", request.command, e))?;

        // Take stdout and stderr
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Create terminal state
        let state = Arc::new(TerminalState::new(
            terminal_id.clone(),
            request.session_id.clone(),
            request.command.clone(),
            request.output_byte_limit,
            child,
        ));

        // Register in registry
        self.registry
            .insert(terminal_id.clone(), Arc::clone(&state));

        // Spawn output reader tasks and store handles for later awaiting
        let output_buffer = Arc::clone(&state.output_buffer);
        let truncated_flag = Arc::clone(&state.truncated);
        let limit = request.output_byte_limit;

        let reader_handles =
            Self::spawn_output_readers(stdout, stderr, output_buffer, truncated_flag, limit);
        *state.output_readers.lock().await = reader_handles;

        // Spawn exit watcher task
        let registry = Arc::clone(&self.registry);
        let tid = terminal_id.clone();
        tokio::spawn(async move {
            Self::watch_exit(registry, tid).await;
        });

        tracing::info!(
            terminal_id = %terminal_id,
            "Terminal created successfully"
        );

        Ok(CreateTerminalResponse { terminal_id })
    }

    /// Get current output from a terminal.
    ///
    /// When the process has exited, this defensively awaits any remaining reader
    /// tasks so the output buffer is guaranteed to be complete before returning.
    pub async fn get_output(&self, terminal_id: &str) -> Result<TerminalOutputResponse, String> {
        let state = self
            .registry
            .get(terminal_id)
            .ok_or_else(|| format!("Terminal not found: {}", terminal_id))?;

        // If exit_status is set, ensure output readers have completed.
        // This is a defensive check — watch_exit should already await readers
        // before storing exit_status, but this guards against any ordering gap.
        let exit_status = state.exit_status.lock().await.clone();
        if exit_status.is_some() {
            let readers = std::mem::take(&mut *state.output_readers.lock().await);
            for handle in readers {
                let _ = handle.await;
            }
        }

        let output = state.output_buffer.lock().await.clone();
        let truncated = *state.truncated.lock().await;

        tracing::debug!(
            terminal_id = %terminal_id,
            output_len = output.len(),
            has_exit_status = exit_status.is_some(),
            "terminal get_output"
        );

        Ok(TerminalOutputResponse {
            output,
            truncated,
            exit_status,
        })
    }

    /// Wait for terminal to exit
    pub async fn wait_for_exit(&self, terminal_id: &str) -> Result<WaitForExitResponse, String> {
        let state = self
            .registry
            .get(terminal_id)
            .ok_or_else(|| format!("Terminal not found: {}", terminal_id))?;

        // Check if already exited
        if let Some(status) = state.exit_status.lock().await.as_ref() {
            tracing::debug!(terminal_id = %terminal_id, "wait_for_exit: already exited (fast path)");
            return Ok(WaitForExitResponse {
                exit_code: status.exit_code,
                signal: status.signal.clone(),
            });
        }

        // Register waiter
        let (tx, rx) = oneshot::channel();
        state.exit_waiters.lock().await.push(tx);

        tracing::debug!(terminal_id = %terminal_id, "wait_for_exit: waiting on channel (slow path)");

        // Wait for exit
        let status = rx
            .await
            .map_err(|_| "Exit channel closed unexpectedly".to_string())?;

        tracing::debug!(
            terminal_id = %terminal_id,
            exit_code = ?status.exit_code,
            "wait_for_exit: channel received"
        );

        Ok(WaitForExitResponse {
            exit_code: status.exit_code,
            signal: status.signal,
        })
    }

    /// Kill a terminal process
    pub async fn kill(&self, terminal_id: &str) -> Result<(), String> {
        let state = self
            .registry
            .get(terminal_id)
            .ok_or_else(|| format!("Terminal not found: {}", terminal_id))?;

        let mut child_guard = state.child.lock().await;
        if let Some(ref mut child) = *child_guard {
            tracing::info!(terminal_id = %terminal_id, "Killing terminal process");
            child
                .kill()
                .await
                .map_err(|e| format!("Failed to kill process: {}", e))?;
        }

        Ok(())
    }

    /// Release terminal resources.
    /// Ensures any running process is terminated before removing terminal state.
    pub async fn release(&self, terminal_id: &str) -> Result<(), String> {
        let state = self
            .registry
            .remove(terminal_id)
            .ok_or_else(|| format!("Terminal not found: {}", terminal_id))?;

        let mut child_guard = state.child.lock().await;
        if let Some(ref mut child) = *child_guard {
            match child.try_wait() {
                Ok(Some(_)) => {
                    // Process already exited, nothing to do.
                }
                Ok(None) => {
                    tracing::info!(terminal_id = %terminal_id, "Releasing live terminal, killing process");
                    child
                        .kill()
                        .await
                        .map_err(|e| format!("Failed to kill process during release: {}", e))?;
                }
                Err(e) => {
                    tracing::warn!(
                        terminal_id = %terminal_id,
                        error = %e,
                        "Failed to inspect terminal process state during release"
                    );
                }
            }
        }

        tracing::info!(terminal_id = %terminal_id, "Terminal released");
        Ok(())
    }

    /// Release all terminals for a session (called when session closes)
    pub async fn release_session_terminals(&self, session_id: &str) {
        let terminals = self.registry.remove_session_terminals(session_id);

        for state in terminals {
            // Kill any still-running processes
            let mut child_guard = state.child.lock().await;
            if let Some(ref mut child) = *child_guard {
                let _ = child.kill().await;
            }
        }

        tracing::info!(
            session_id = %session_id,
            "Released all terminals for session"
        );
    }

    /// Read stdout and stderr into the output buffer.
    /// Returns JoinHandles so callers can await completion before reading output.
    fn spawn_output_readers(
        stdout: Option<tokio::process::ChildStdout>,
        stderr: Option<tokio::process::ChildStderr>,
        output_buffer: Arc<tokio::sync::Mutex<String>>,
        truncated_flag: Arc<tokio::sync::Mutex<bool>>,
        limit: Option<u64>,
    ) -> Vec<JoinHandle<()>> {
        let mut handles = Vec::new();

        // Read stdout
        if let Some(stdout) = stdout {
            let buffer = Arc::clone(&output_buffer);
            let truncated = Arc::clone(&truncated_flag);
            let stdout_limit = limit;

            handles.push(tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                Self::read_stream_chunks(reader, buffer, truncated, stdout_limit).await;
            }));
        }

        // Read stderr (merge into same buffer)
        if let Some(stderr) = stderr {
            let buffer = Arc::clone(&output_buffer);
            let truncated = Arc::clone(&truncated_flag);
            let stderr_limit = limit;

            handles.push(tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                Self::read_stream_chunks(reader, buffer, truncated, stderr_limit).await;
            }));
        }

        handles
    }

    /// Read output incrementally to avoid unbounded allocations from newline-delimited reads.
    async fn read_stream_chunks<R: AsyncRead + Unpin>(
        mut reader: R,
        output_buffer: Arc<tokio::sync::Mutex<String>>,
        truncated_flag: Arc<tokio::sync::Mutex<bool>>,
        limit: Option<u64>,
    ) {
        let mut chunk = [0_u8; 4096];

        loop {
            match reader.read(&mut chunk).await {
                Ok(0) => break,
                Ok(read_bytes) => {
                    let chunk_text = String::from_utf8_lossy(&chunk[..read_bytes]);
                    let mut buf = output_buffer.lock().await;
                    let mut trunc = truncated_flag.lock().await;

                    buf.push_str(&chunk_text);

                    if let Some(max_bytes) = limit {
                        Self::enforce_output_limit(&mut buf, max_bytes as usize, &mut trunc);
                    }
                }
                Err(error) => {
                    tracing::warn!(%error, "Error reading terminal output stream");
                    break;
                }
            }
        }
    }

    fn enforce_output_limit(buf: &mut String, max_bytes: usize, truncated: &mut bool) {
        if buf.len() <= max_bytes {
            return;
        }

        *truncated = true;
        let excess = buf.len() - max_bytes;
        let mut start = excess;
        while start < buf.len() && !buf.is_char_boundary(start) {
            start += 1;
        }
        buf.drain(..start);
    }

    /// Watch for process exit and notify waiters
    async fn watch_exit(registry: Arc<TerminalRegistry>, terminal_id: String) {
        let state = match registry.get(&terminal_id) {
            Some(s) => s,
            None => {
                tracing::warn!(terminal_id = %terminal_id, "Terminal not found in registry for exit watch");
                return;
            }
        };

        // Poll with try_wait so other operations (kill/release) can acquire the child lock.
        let exit_status = loop {
            let maybe_status = {
                let mut child_guard = state.child.lock().await;
                let Some(ref mut child) = *child_guard else {
                    return;
                };

                match child.try_wait() {
                    Ok(Some(status)) => {
                        *child_guard = None;
                        Some(Ok(status))
                    }
                    Ok(None) => None,
                    Err(error) => Some(Err(error)),
                }
            };

            match maybe_status {
                Some(Ok(status)) => {
                    let exit_code = status.code();
                    #[cfg(unix)]
                    let signal = {
                        use std::os::unix::process::ExitStatusExt;
                        status.signal().map(|s| format!("{}", s))
                    };
                    #[cfg(not(unix))]
                    let signal: Option<String> = None;

                    break TerminalExitStatus { exit_code, signal };
                }
                Some(Err(error)) => {
                    tracing::error!(
                        terminal_id = %terminal_id,
                        error = %error,
                        "Error waiting for process exit"
                    );
                    break TerminalExitStatus {
                        exit_code: None,
                        signal: None,
                    };
                }
                None => {
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
            }
        };

        tracing::info!(
            terminal_id = %terminal_id,
            exit_code = ?exit_status.exit_code,
            signal = ?exit_status.signal,
            "Terminal process exited"
        );

        // Wait for output reader tasks to finish so all stdout/stderr is buffered
        // before we notify waiters. Without this, fast commands (e.g. `ls`) can
        // exit before their output is fully read, causing empty tool results.
        let readers = std::mem::take(&mut *state.output_readers.lock().await);
        for handle in readers {
            let _ = handle.await;
        }

        // Store exit status
        *state.exit_status.lock().await = Some(exit_status.clone());

        // Notify all waiters
        let mut waiters = state.exit_waiters.lock().await;
        for tx in waiters.drain(..) {
            let _ = tx.send(exit_status.clone());
        }
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::types::CreateTerminalRequest;

    /// Regression test: fast commands like `echo` must have non-empty output
    /// after wait_for_exit completes. Previously, a race condition between
    /// stdout reader tasks and the exit watcher caused get_output to return
    /// an empty buffer for fast-completing commands.
    #[tokio::test]
    async fn fast_command_output_is_not_empty_after_exit() {
        let manager = TerminalManager::new();

        let request = CreateTerminalRequest {
            session_id: "test-session".to_string(),
            command: "echo hello_world".to_string(),
            args: vec![],
            cwd: None,
            env: vec![],
            output_byte_limit: Some(32_000),
        };

        let response = manager.create_terminal(request).await.unwrap();
        let terminal_id = &response.terminal_id;

        // Wait for exit
        let exit = manager.wait_for_exit(terminal_id).await.unwrap();
        assert_eq!(exit.exit_code, Some(0));

        // Get output — must contain the echoed text
        let output = manager.get_output(terminal_id).await.unwrap();
        assert!(
            output.output.contains("hello_world"),
            "Expected output to contain 'hello_world', got: {:?}",
            output.output,
        );
        assert!(output.exit_status.is_some(), "exit_status should be set");
    }

    /// Run many terminals concurrently to catch race conditions between stdout
    /// reader tasks and the exit watcher. Parallel execution is both faster and
    /// a harder stress test than sequential spawning.
    #[tokio::test]
    async fn fast_command_output_race_stress_test() {
        use futures::future::join_all;
        use std::sync::Arc;

        let manager = Arc::new(TerminalManager::new());
        let handles: Vec<_> = (0..20)
            .map(|i| {
                let manager = Arc::clone(&manager);
                let marker = format!("marker_{i}");
                tokio::spawn(async move {
                    let request = CreateTerminalRequest {
                        session_id: format!("stress-{i}"),
                        command: format!("echo {marker}"),
                        args: vec![],
                        cwd: None,
                        env: vec![],
                        output_byte_limit: Some(32_000),
                    };
                    let response = manager.create_terminal(request).await.unwrap();
                    let exit = manager.wait_for_exit(&response.terminal_id).await.unwrap();
                    assert_eq!(exit.exit_code, Some(0), "iteration {i}");
                    let output = manager.get_output(&response.terminal_id).await.unwrap();
                    assert!(
                        output.output.contains(&marker),
                        "iteration {i}: expected '{marker}' in output, got: {:?}",
                        output.output,
                    );
                })
            })
            .collect();

        for result in join_all(handles).await {
            result.unwrap();
        }
    }
}
