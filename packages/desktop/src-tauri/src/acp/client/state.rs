use super::*;

/// Shared child handle so the death monitor and stop() can both access it.
/// Uses std::sync::Mutex because stop() is sync (called from Drop).
type ChildHandle = StdArc<std::sync::Mutex<Option<Child>>>;

/// ACP Client for communicating with ACP agents
pub struct AcpClient {
    pub(super) provider: Option<StdArc<dyn AgentProvider>>,
    pub(super) child: Option<ChildHandle>,
    /// Process group ID for killing the entire subprocess tree.
    /// On Unix, the child is spawned with setsid() so it becomes its own process group leader.
    /// Killing the negative PGID sends SIGKILL to all processes in the group.
    #[cfg(unix)]
    pub(super) pgid: Option<u32>,
    pub(super) spawn_config_index: usize,
    pub(super) request_id: StdArc<std::sync::Mutex<u64>>,
    pub(super) pending_requests: StdArc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    pub(super) app_handle: Option<AppHandle>,
    /// Stdin writer for sending responses to inbound requests (async)
    pub(super) stdin_writer: StdArc<Mutex<Option<ChildStdin>>>,
    /// Maps request IDs to session IDs for prompt requests.
    /// When a response comes in for one of these IDs, we emit a TurnComplete event.
    pub(super) prompt_request_sessions: StdArc<Mutex<HashMap<u64, String>>>,
    /// Working directory for the subprocess.
    /// Set at construction, used when spawning to ensure subprocess runs in correct directory.
    pub(super) cwd: PathBuf,
    /// Tracks in-flight permission requests for synthetic ToolCallUpdate emission on deny.
    pub(super) permission_tracker: StdArc<std::sync::Mutex<PermissionTracker>>,
    /// Deduplicates web search permission IDs against earlier notification IDs.
    pub(super) web_search_dedup: StdArc<std::sync::Mutex<WebSearchDedup>>,
    /// Captured recent stderr from the subprocess for shutdown/crash diagnostics.
    pub(super) stderr_buffer: Option<crate::acp::client_loop::StderrBuffer>,
    /// Shared dispatcher for emitting UI events outside the message loop (e.g. permission deny).
    /// Initialized in `start()`, reused in `respond_with_permission_tracking` and `stop()`.
    pub(super) dispatcher: Option<AcpUiEventDispatcher>,
    /// Tracks the active session ID for provider extension notifications that omit sessionId.
    pub(super) active_session_id: StdArc<std::sync::Mutex<Option<String>>>,
    /// Provider-specific response adapters for inbound requests, keyed by JSON-RPC request ID.
    pub(super) inbound_response_adapters:
        StdArc<std::sync::Mutex<HashMap<u64, CursorResponseAdapter>>>,
    /// Whether session/load replay is currently in progress.
    /// Set by ReplayGuard in resume_session(); auto-cancels all inbound requests during replay.
    pub(super) is_replay_active: StdArc<std::sync::atomic::AtomicBool>,
}

impl Clone for AcpClient {
    fn clone(&self) -> Self {
        Self {
            provider: self.provider.clone(),
            child: None,
            #[cfg(unix)]
            pgid: None,
            spawn_config_index: 0,
            request_id: StdArc::new(std::sync::Mutex::new(1)),
            pending_requests: StdArc::new(Mutex::new(HashMap::new())),
            app_handle: self.app_handle.clone(),
            stdin_writer: StdArc::new(Mutex::new(None)),
            prompt_request_sessions: StdArc::new(Mutex::new(HashMap::new())),
            cwd: self.cwd.clone(),
            permission_tracker: self.permission_tracker.clone(),
            web_search_dedup: self.web_search_dedup.clone(),
            stderr_buffer: None,
            dispatcher: None,
            active_session_id: self.active_session_id.clone(),
            inbound_response_adapters: self.inbound_response_adapters.clone(),
            is_replay_active: self.is_replay_active.clone(),
        }
    }
}

impl AcpClient {
    /// Create a new ACP client with a specific provider.
    ///
    /// The `app_handle` is optional - when `None`, event emission will be skipped.
    /// This allows using the client in test/CLI contexts without Tauri.
    ///
    /// The `cwd` is the working directory where the subprocess will be spawned.
    /// This ensures the agent runs in the correct project/worktree directory.
    pub fn new_with_provider(
        provider: StdArc<dyn AgentProvider>,
        app_handle: Option<AppHandle>,
        cwd: PathBuf,
    ) -> AcpResult<Self> {
        Ok(Self {
            provider: Some(provider),
            child: None,
            #[cfg(unix)]
            pgid: None,
            spawn_config_index: 0,
            request_id: StdArc::new(std::sync::Mutex::new(1)),
            pending_requests: StdArc::new(Mutex::new(HashMap::new())),
            app_handle,
            stdin_writer: StdArc::new(Mutex::new(None)),
            prompt_request_sessions: StdArc::new(Mutex::new(HashMap::new())),
            cwd,
            permission_tracker: StdArc::new(std::sync::Mutex::new(PermissionTracker::new())),
            web_search_dedup: StdArc::new(std::sync::Mutex::new(WebSearchDedup::new())),
            stderr_buffer: None,
            dispatcher: None,
            active_session_id: StdArc::new(std::sync::Mutex::new(None)),
            inbound_response_adapters: StdArc::new(std::sync::Mutex::new(HashMap::new())),
            is_replay_active: StdArc::new(std::sync::atomic::AtomicBool::new(false)),
        })
    }

    pub(super) fn set_active_session_id(&self, session_id: Option<String>) {
        if let Ok(mut active_session_id) = self.active_session_id.lock() {
            *active_session_id = session_id;
        }
    }
}
