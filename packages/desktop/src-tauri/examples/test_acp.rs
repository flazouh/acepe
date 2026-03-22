//! CLI tool to test ACP session operations.
//!
//! Run with:
//!   cd packages/desktop/src-tauri
//!   cargo run --example test_acp -- --session-id <ID> --project-path <PATH>

use acepe_lib::acp::client::AcpClient;
use acepe_lib::acp::registry::AgentRegistry;
use acepe_lib::acp::types::{CanonicalAgentId, ContentBlock, PromptRequest};
use std::env;
use std::path::PathBuf;

#[tokio::main]
async fn main() {
    // Initialize tracing for debug output
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .init();

    // Parse command line args
    let args: Vec<String> = env::args().collect();

    let session_id = args
        .iter()
        .position(|x| x == "--session-id")
        .and_then(|i| args.get(i + 1))
        .expect("Usage: test_acp --session-id <ID> --project-path <PATH>");

    let project_path = args
        .iter()
        .position(|x| x == "--project-path")
        .and_then(|i| args.get(i + 1))
        .expect("Usage: test_acp --session-id <ID> --project-path <PATH>");

    println!("\n========================================");
    println!("Testing ACP Send Prompt");
    println!("Session ID: {}", session_id);
    println!("Project Path: {}", project_path);
    println!("========================================\n");

    // Create registry and get provider
    let registry = AgentRegistry::new();
    let provider = registry
        .get(&CanonicalAgentId::ClaudeCode)
        .expect("claude-code agent not found")
        .clone();

    // Create client (no AppHandle needed for testing)
    // Use project_path as cwd so subprocess spawns in correct directory
    println!("1. Creating ACP client...");
    let cwd = PathBuf::from(project_path);
    let mut client =
        AcpClient::new_with_provider(provider, None, cwd).expect("Failed to create client");

    // Start subprocess
    println!("2. Starting subprocess...");
    if let Err(e) = client.start().await {
        println!("   ERROR starting: {}", e);
        return;
    }

    // Initialize
    println!("3. Initializing...");
    match client.initialize().await {
        Ok(resp) => println!("   Initialized: protocol v{}", resp.protocol_version),
        Err(e) => {
            println!("   ERROR initializing: {}", e);
            return;
        }
    }

    // Resume session
    println!("4. Resuming session...");
    let resume_result = client
        .resume_session(session_id.to_string(), project_path.to_string())
        .await;
    match resume_result {
        Ok(resp) => {
            println!("   Session resumed successfully!");
            // Per ACP protocol: ResumeSessionResponse does NOT include sessionId
            println!("   Using session_id from request: {}", session_id);
            println!("   Current model: {}", resp.models.current_model_id);
            println!("   Current mode: {}", resp.modes.current_mode_id);
        }
        Err(e) => {
            println!("   ERROR resuming session:");
            println!("   {}", e);
            println!("\n   Full error: {:#?}", e);
            return;
        }
    };

    // Send prompt
    println!("5. Sending prompt...");
    let prompt_request = PromptRequest {
        // Use the session_id from the new_session response (same as resume request)
        session_id: session_id.to_string(),
        prompt: vec![ContentBlock::Text {
            text: "Hello, this is a test message from the CLI tool.".to_string(),
        }],
        stream: Some(true),
    };

    println!(
        "   Using session_id for prompt: {}",
        prompt_request.session_id
    );

    match client.send_prompt(prompt_request).await {
        Ok(resp) => {
            println!("   Prompt sent successfully!");
            println!("   Response: {:#?}", resp);
        }
        Err(e) => {
            println!("   ERROR sending prompt:");
            println!("   {}", e);
            println!("\n   Full error chain: {:#?}", e);
        }
    }

    // Cleanup
    println!("\n6. Stopping client...");
    client.stop();

    println!("\n========================================");
    println!("Test complete");
    println!("========================================\n");
}
