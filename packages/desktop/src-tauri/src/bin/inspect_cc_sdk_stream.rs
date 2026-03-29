use std::path::PathBuf;

use cc_sdk::{ClaudeCodeOptions, ClaudeSDKClient, Message, Result};
use futures::StreamExt;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let prompt = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "Reply with exactly: hello".to_string());
    let cwd = args.get(2).cloned().unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .display()
            .to_string()
    });
    let include_partial_messages = args.iter().any(|arg| arg == "--include-partials");

    let mut builder = ClaudeCodeOptions::builder().cwd(PathBuf::from(&cwd));
    if include_partial_messages {
        builder = builder.include_partial_messages(true);
    }
    let options = builder.build();

    println!(
        "CONNECT cwd={} include_partial_messages={}",
        cwd, options.include_partial_messages
    );

    let mut client = ClaudeSDKClient::new(options);
    client.connect(Some(prompt)).await?;

    let mut stream = client.receive_messages().await;
    let mut index: usize = 0;
    while let Some(message) = stream.next().await {
        index += 1;
        match message? {
            Message::StreamEvent { event, .. } => {
                let event_type = event
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("unknown");
                let delta_type = event
                    .get("delta")
                    .and_then(|delta| delta.get("type"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                println!("MESSAGE {index}: StreamEvent event_type={event_type} delta_type={delta_type} raw={event}");
            }
            Message::Assistant { message } => {
                println!("MESSAGE {index}: Assistant blocks={:?}", message.content);
            }
            Message::Result {
                is_error,
                result,
                stop_reason,
                ..
            } => {
                println!(
                    "MESSAGE {index}: Result is_error={} stop_reason={:?} result={:?}",
                    is_error, stop_reason, result
                );
                break;
            }
            other => {
                println!("MESSAGE {index}: {:?}", other);
            }
        }
    }

    Ok(())
}
