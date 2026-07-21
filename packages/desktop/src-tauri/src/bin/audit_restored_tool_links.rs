use acepe_lib::db;
use acepe_lib::db::repository::SessionMetadataRepository;
use acepe_lib::history::commands::audit_restored_tool_links_cli;
use acepe_lib::history::commands::RestoredToolLinkAudit;
use sea_orm::Database;
use sea_orm::DbConn;

#[derive(Debug, Default)]
struct Args {
    db_path: Option<String>,
    session_id: Option<String>,
    project_path: Option<String>,
    agent_id: Option<String>,
    source_path: Option<String>,
    limit: usize,
    show_ok: bool,
}

#[tokio::main]
async fn main() {
    let args = match parse_args() {
        Ok(args) => args,
        Err(error) => {
            eprintln!("{error}");
            print_usage();
            std::process::exit(1);
        }
    };

    let db = match connect_db(args.db_path.as_deref()).await {
        Ok(db) => db,
        Err(error) => {
            eprintln!("Failed to open Acepe DB: {error}");
            std::process::exit(1);
        }
    };

    let exit_code = if let Some(session_id) = args.session_id.as_deref() {
        audit_one_session(&db, &args, session_id).await
    } else {
        audit_recent_sessions(&db, &args).await
    };

    std::process::exit(exit_code);
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        limit: 50,
        ..Args::default()
    };
    let mut raw_args = std::env::args().skip(1);

    while let Some(arg) = raw_args.next() {
        match arg.as_str() {
            "--db" => args.db_path = Some(next_value(&mut raw_args, "--db")?),
            "--session" => args.session_id = Some(next_value(&mut raw_args, "--session")?),
            "--project" => args.project_path = Some(next_value(&mut raw_args, "--project")?),
            "--agent" => args.agent_id = Some(next_value(&mut raw_args, "--agent")?),
            "--source" => args.source_path = Some(next_value(&mut raw_args, "--source")?),
            "--limit" => {
                let value = next_value(&mut raw_args, "--limit")?;
                args.limit = value
                    .parse::<usize>()
                    .map_err(|_| format!("--limit must be a number, got {value}"))?;
            }
            "--show-ok" => args.show_ok = true,
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
    }

    Ok(args)
}

fn next_value(raw_args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    raw_args
        .next()
        .ok_or_else(|| format!("{flag} needs a value"))
}

async fn connect_db(db_path: Option<&str>) -> Result<DbConn, Box<dyn std::error::Error>> {
    if let Some(db_path) = db_path {
        let database_url = format!("sqlite://{db_path}?mode=ro");
        return Ok(Database::connect(database_url).await?);
    }

    Ok(db::init_db(None).await?)
}

async fn audit_one_session(db: &DbConn, args: &Args, session_id: &str) -> i32 {
    let row = SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .unwrap_or(None);
    let descriptor = row.as_ref().map(|row| row.descriptor_facts());
    let project_path = args.project_path.clone().or_else(|| {
        descriptor
            .as_ref()
            .and_then(|facts| facts.project_path.clone())
    });
    let agent_id = args.agent_id.clone().or_else(|| {
        descriptor
            .as_ref()
            .and_then(|facts| facts.agent_id.as_ref())
            .map(|agent| agent.to_string_with_prefix())
    });
    let source_path = args
        .source_path
        .clone()
        .or_else(|| descriptor.and_then(|facts| facts.source_path));

    let Some(project_path) = project_path else {
        eprintln!("Missing project path. Pass --project or use a session stored in the Acepe DB.");
        return 1;
    };
    let Some(agent_id) = agent_id else {
        eprintln!("Missing agent id. Pass --agent or use a session stored in the Acepe DB.");
        return 1;
    };

    match audit_restored_tool_links_cli(session_id.to_string(), project_path, agent_id, source_path)
        .await
    {
        Ok(audit) => {
            print_audit(&audit);
            if audit.unresolved_count == 0 {
                0
            } else {
                2
            }
        }
        Err(error) => {
            eprintln!("{session_id}: {error}");
            1
        }
    }
}

async fn audit_recent_sessions(db: &DbConn, args: &Args) -> i32 {
    let rows = match SessionMetadataRepository::get_all(db).await {
        Ok(rows) => rows,
        Err(error) => {
            eprintln!("Failed to list sessions: {error}");
            return 1;
        }
    };

    let mut unresolved_sessions = 0usize;
    let mut errored_sessions = 0usize;
    let mut checked_sessions = 0usize;

    for row in rows.iter().take(args.limit) {
        let descriptor = row.descriptor_facts();
        let Some(project_path) = descriptor.project_path else {
            continue;
        };
        let Some(agent_id) = descriptor.agent_id else {
            continue;
        };
        checked_sessions += 1;

        match audit_restored_tool_links_cli(
            row.id.clone(),
            project_path,
            agent_id.to_string_with_prefix(),
            descriptor.source_path,
        )
        .await
        {
            Ok(audit) => {
                if audit.unresolved_count > 0 {
                    unresolved_sessions += 1;
                    print_audit(&audit);
                } else if args.show_ok {
                    print_audit(&audit);
                }
            }
            Err(error) => {
                errored_sessions += 1;
                eprintln!("{}: {}", row.id, error);
            }
        }
    }

    println!(
        "checked_sessions={} unresolved_sessions={} errored_sessions={}",
        checked_sessions, unresolved_sessions, errored_sessions
    );

    if unresolved_sessions > 0 {
        2
    } else if errored_sessions > 0 {
        1
    } else {
        0
    }
}

fn print_audit(audit: &RestoredToolLinkAudit) {
    println!(
        "session={} agent={} entries={} scoped_entries={} transcript_tools={} operations={} unresolved={}",
        audit.session_id,
        audit.agent_id,
        audit.entry_count,
        audit.scoped_entry_count,
        audit.transcript_tool_count,
        audit.operation_count,
        audit.unresolved_count
    );

    for row in audit.unresolved_rows.iter().take(20) {
        println!("  unresolved entry_id={} text={}", row.entry_id, row.text);
    }
}

fn print_usage() {
    eprintln!(
        "Usage: cargo run --bin audit_restored_tool_links -- [--db PATH] [--session ID] [--project PATH] [--agent AGENT] [--source PATH] [--limit N] [--show-ok]"
    );
}
