use super::*;

impl AcpClient {
    pub(super) fn has_next_spawn_config(&self) -> bool {
        self.provider
            .as_ref()
            .is_some_and(|provider| self.spawn_config_index + 1 < provider.spawn_configs().len())
    }

    pub(super) fn advance_spawn_config(&mut self) -> bool {
        if self.has_next_spawn_config() {
            self.spawn_config_index += 1;
            return true;
        }
        false
    }

    /// Start the ACP agent subprocess
    ///
    /// Uses tokio::process::Command for non-blocking subprocess spawning.
    /// This prevents blocking the async executor during subprocess startup.
    pub async fn start(&mut self) -> AcpResult<()> {
        tracing::info!("Starting ACP client");

        // Get the working directory
        let cwd = self.cwd.clone();

        // Note: cwd was already validated by validate_session_cwd() before reaching here.
        // Skipping redundant is_dir() to avoid duplicate macOS TCC prompts for protected folders.

        tracing::info!(cwd = %cwd.display(), "ACP client will spawn in working directory");

        // Get the provider's spawn configurations
        let provider_id = match &self.provider {
            Some(provider) => provider.id().to_string(),
            None => {
                // Fallback to claude-code-acp if no provider is set
                tracing::error!("No provider set, using default claude-code-acp");
                return Err(AcpError::NoProviderConfigured);
            }
        };

        let saved_overrides = if let Some(app_handle) = &self.app_handle {
            match load_saved_agent_env_overrides(app_handle).await {
                Ok(saved_overrides) => Some(saved_overrides),
                Err(error) => {
                    tracing::warn!(
                        agent_id = %provider_id,
                        error = %error,
                        "Failed to load saved agent env overrides"
                    );
                    None
                }
            }
        } else {
            None
        };

        let agent_type = self
            .provider
            .as_ref()
            .map(|provider| provider.parser_agent_type())
            .unwrap_or(AgentType::ClaudeCode);

        loop {
            let provider = self
                .provider
                .as_ref()
                .ok_or(AcpError::NoProviderConfigured)?;
            let spawn_configs = provider.spawn_configs();
            let total_spawn_configs = spawn_configs.len();
            let Some(mut spawn_config) = spawn_configs.get(self.spawn_config_index).cloned() else {
                return Err(AcpError::InvalidState(format!(
                    "Spawn config index {} out of range for provider {}",
                    self.spawn_config_index, provider_id
                )));
            };

            if let Some(saved_overrides) = &saved_overrides {
                spawn_config.env = apply_saved_agent_env_overrides(
                    &provider_id,
                    spawn_config.env,
                    saved_overrides,
                );
            }

            tracing::info!(
                command = %spawn_config.command,
                args = ?spawn_config.args,
                cwd = %cwd.display(),
                attempt = self.spawn_config_index + 1,
                total_attempts = total_spawn_configs,
                "Spawning agent subprocess"
            );

            let mut cmd = Command::new(&spawn_config.command);
            cmd.args(&spawn_config.args);
            cmd.current_dir(&cwd);

            // Clear inherited env and set only what the provider explicitly provides.
            // Without env_clear(), subprocess inherits full process env, making
            // allowlist-based providers (Cursor, OpenCode) ineffective.
            cmd.env_clear();
            for (key, value) in &spawn_config.env {
                cmd.env(key, value);
            }

            // On Unix, spawn in a new process group (setsid) so we can kill the entire
            // subprocess tree when stopping the client. Without this, child processes
            // become orphans when we kill the immediate child.
            #[cfg(unix)]
            unsafe {
                cmd.pre_exec(|| {
                    nix::unistd::setsid().map_err(std::io::Error::other)?;
                    Ok(())
                });
            }

            let command_str = spawn_config.command.clone();
            let mut child = match cmd
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(child) => child,
                Err(error) => {
                    let redacted_cmd = command_str
                        .split_whitespace()
                        .next()
                        .unwrap_or("unknown")
                        .to_string();
                    tracing::error!(
                        command = %redacted_cmd,
                        error = %error,
                        attempt = self.spawn_config_index + 1,
                        total_attempts = total_spawn_configs,
                        "Failed to spawn subprocess"
                    );

                    if self.advance_spawn_config() {
                        tracing::warn!(
                            agent_id = %provider_id,
                            next_attempt = self.spawn_config_index + 1,
                            total_attempts = total_spawn_configs,
                            "Retrying agent startup with fallback launcher after spawn failure"
                        );
                        continue;
                    }

                    return Err(AcpError::SubprocessSpawnFailed {
                        command: command_str,
                        source: error,
                    });
                }
            };

            tracing::info!(pid = ?child.id(), "Subprocess spawned successfully");

            // Store the process group ID (same as PID since we used setsid)
            #[cfg(unix)]
            {
                self.pgid = child.id();
                tracing::info!(pgid = ?self.pgid, "Subprocess process group stored for cleanup");
            }

            // Store stdin writer for sending responses to inbound requests
            let stdin = child.stdin.take();
            {
                let mut guard = self.stdin_writer.lock().await;
                *guard = stdin;
            }

            // Spawn a tokio task to read from stderr and log errors
            let stderr = child.stderr.take().ok_or_else(|| {
                AcpError::InvalidState("Failed to get stderr handle from subprocess".to_string())
            })?;
            let stderr_buffer = crate::acp::client_loop::new_stderr_buffer();
            spawn_stderr_reader(
                stderr,
                MAX_LOGGED_SUBPROCESS_LINE_BYTES,
                stderr_buffer.clone(),
            );

            // Spawn a tokio task to read from stdout asynchronously
            let stdout = child.stdout.take().ok_or_else(|| {
                AcpError::InvalidState("Failed to get stdout handle from subprocess".to_string())
            })?;
            let app_handle = self.app_handle.clone();
            let dispatcher =
                AcpUiEventDispatcher::new(app_handle.clone(), DispatchPolicy::default());
            self.dispatcher = Some(dispatcher.clone());
            spawn_stdout_reader(
                stdout,
                StdoutLoopContext {
                    pending: self.pending_requests.clone(),
                    stdin_writer: self.stdin_writer.clone(),
                    prompt_sessions: self.prompt_request_sessions.clone(),
                    app_handle: app_handle.clone(),
                    dispatcher: dispatcher.clone(),
                    permission_tracker: self.permission_tracker.clone(),
                    web_search_dedup: self.web_search_dedup.clone(),
                    active_session_id: self.active_session_id.clone(),
                    inbound_response_adapters: self.inbound_response_adapters.clone(),
                    is_replay_active: self.is_replay_active.clone(),
                    provider: self.provider.clone(),
                    agent_type,
                    max_logged_line_bytes: MAX_LOGGED_SUBPROCESS_LINE_BYTES,
                    stderr_buffer: stderr_buffer.clone(),
                },
            );

            // Shared child handle for death monitor and stop()
            let child_shared = StdArc::new(std::sync::Mutex::new(Some(child)));
            spawn_death_monitor(
                child_shared.clone(),
                self.pending_requests.clone(),
                self.permission_tracker.clone(),
                self.web_search_dedup.clone(),
                dispatcher.clone(),
                stderr_buffer,
            );

            self.child = Some(child_shared);
            tracing::info!("ACP client started successfully");
            return Ok(());
        }
    }

    /// Stop the ACP client and kill the entire subprocess tree.
    ///
    /// On Unix, sends SIGKILL to the process group (negative PGID) which kills
    /// the immediate child AND all its descendants.
    /// This prevents orphaned processes when the app exits.
    ///
    /// Note: Must be sync because it's called from Drop.
    pub fn stop(&mut self) {
        if let Some(child_arc) = self.child.take() {
            let mut guard = child_arc.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(mut child) = guard.take() {
                #[cfg(unix)]
                {
                    if let Some(pgid) = self.pgid.take() {
                        // Kill the entire process group (negative PID = process group)
                        tracing::info!(pgid = pgid, "Killing subprocess process group");
                        let _ = nix::sys::signal::killpg(
                            nix::unistd::Pid::from_raw(pgid as i32),
                            nix::sys::signal::Signal::SIGKILL,
                        );
                    } else {
                        // Fallback: kill just the immediate child
                        tracing::warn!(
                            "No PGID stored, falling back to killing immediate child only"
                        );
                        let _ = child.start_kill();
                    }
                }
                #[cfg(not(unix))]
                {
                    let _ = child.start_kill();
                }
            }
        }

        // Drain any tracked permissions so UI tool cards transition to Failed
        if let Some(ref dispatcher) = self.dispatcher {
            drain_permissions_as_failed(&self.permission_tracker, dispatcher);
        }
    }
}
