//! Example demonstrating usage with dotenv for environment variable management
//!
//! This example shows how to use a .env file to manage configuration
//! including account information, model selection, and other settings.
//!
//! # Setup
//!
//! 1. Add dotenv to your Cargo.toml:
//!    ```toml
//!    [dependencies]
//!    dotenv = "0.15"
//!    ```
//!
//! 2. Create a .env file in your project root:
//!    ```bash
//!    cp examples/.env.example .env
//!    ```
//!
//! 3. Edit .env with your settings:
//!    ```
//!    ANTHROPIC_USER_EMAIL=your-email@example.com
//!    CLAUDE_MODEL=claude-sonnet-4-5-20250929
//!    ```
//!
//! # Usage
//!
//! ```bash
//! cargo run --example with_dotenv
//! ```

use cc_sdk::{ClaudeCodeOptions, ClaudeSDKClient, Message, Result};
use futures::StreamExt;

#[tokio::main]
async fn main() -> Result<()> {
    println!("╔════════════════════════════════════════════╗");
    println!("║   Claude Code with .env Configuration     ║");
    println!("╚════════════════════════════════════════════╝\n");

    // Load .env file (if using dotenv crate)
    // dotenv::dotenv().ok();

    // For this example, we'll just show how to read env vars
    // In a real application with dotenv, variables are automatically loaded

    println!("📋 Configuration from environment:");
    println!("─────────────────────────────────────────────");

    // Read account email
    let account_email = std::env::var("ANTHROPIC_USER_EMAIL")
        .unwrap_or_else(|_| "Not set (will attempt auto-detection)".to_string());
    println!("  Account: {}", account_email);

    // Read model preference
    let model = std::env::var("CLAUDE_MODEL").unwrap_or_else(|_| "Default (Sonnet)".to_string());
    println!("  Model: {}", model);

    // Read max output tokens
    let max_tokens = std::env::var("CLAUDE_CODE_MAX_OUTPUT_TOKENS")
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(8000);
    println!("  Max output tokens: {}", max_tokens);

    println!("─────────────────────────────────────────────\n");

    // Build options from environment variables
    let mut builder = ClaudeCodeOptions::builder();

    // Set model if specified
    if let Ok(model_name) = std::env::var("CLAUDE_MODEL") {
        builder = builder.model(model_name);
    }

    // Set max output tokens
    builder = builder.max_output_tokens(max_tokens);

    let options = builder.build();

    // Create and connect client
    let mut client = ClaudeSDKClient::new(options);

    println!("🔌 Connecting to Claude CLI...");
    client.connect(None).await?;
    println!("   ✅ Connected\n");

    // Verify account information
    println!("👤 Verifying account...");
    match client.get_account_info().await {
        Ok(info) => {
            println!("   ✅ {}\n", info);
        }
        Err(e) => {
            println!("   ⚠️  Could not verify: {}", e);
            println!("   Tip: Set ANTHROPIC_USER_EMAIL in .env file\n");
        }
    }

    // Send a test query
    println!("💬 Sending test query...\n");
    client
        .send_user_message("What is 2 + 2?".to_string())
        .await?;

    // Receive response
    let mut messages = client.receive_messages().await;
    while let Some(msg_result) = messages.next().await {
        match msg_result? {
            Message::Assistant { message } => {
                for block in message.content {
                    if let cc_sdk::ContentBlock::Text(text) = block {
                        println!("🤖 Claude: {}\n", text.text);
                    }
                }
            }
            Message::Result {
                duration_ms,
                usage,
                total_cost_usd,
                ..
            } => {
                println!("─────────────────────────────────────────────");
                println!("📊 Response Stats:");
                println!("   Duration: {}ms", duration_ms);

                if let Some(usage_json) = usage {
                    if let Some(input_tokens) = usage_json.get("input_tokens") {
                        println!("   Input tokens: {}", input_tokens);
                    }
                    if let Some(output_tokens) = usage_json.get("output_tokens") {
                        println!("   Output tokens: {}", output_tokens);
                    }
                }

                if let Some(cost) = total_cost_usd {
                    println!("   Cost: ${:.6}", cost);
                }
                println!("─────────────────────────────────────────────\n");
                break;
            }
            _ => {}
        }
    }

    // Disconnect
    println!("🔌 Disconnecting...");
    client.disconnect().await?;
    println!("   ✅ Session ended\n");

    Ok(())
}
