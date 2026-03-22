# Acepe i18n Translation Tool

Automated translation of UI strings using Claude Haiku via OpenRouter API.

## Features

- **High-quality translations** using Claude Haiku 4.5
- **Consistent terminology** via customizable glossary
- **Incremental mode** - only translates missing/new keys
- **Dry-run mode** - preview changes before applying
- **Beautiful CLI** with progress indicators

## Setup

1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Set the environment variable:

```bash
export OPENROUTER_API_KEY=your-api-key
```

## Usage

```bash
# Translate missing keys for all 67 languages
bun run translate:haiku

# Re-translate all keys (full refresh)
bun run translate:haiku --all

# Only translate a specific language
bun run translate:haiku --lang=fr
bun run translate:haiku --lang=ja

# Preview what would be translated
bun run translate:haiku --dry-run
```

## Architecture

```
scripts/i18n/
├── index.ts              # Main entry point
├── cli.ts                # CLI interface with spinners/colors
├── config.ts             # Glossary and language names
├── file-service.ts       # File I/O operations
├── translation-service.ts # OpenRouter API client
├── types.ts              # TypeScript interfaces
└── README.md             # This file
```

## Terminology Glossary

The glossary in `config.ts` ensures consistent translation of key terms:

| English   | French            | Spanish            | German         |
| --------- | ----------------- | ------------------ | -------------- |
| thread    | fil               | hilo               | Thread         |
| session   | session           | sesión             | Sitzung        |
| agent     | agent             | agente             | Agent          |
| project   | projet            | proyecto           | Projekt        |
| workspace | espace de travail | espacio de trabajo | Arbeitsbereich |

Add more terms to the glossary to maintain consistency.

## Cost Estimate

Using Claude Haiku via OpenRouter:

- ~$0.25 per 1M input tokens
- ~$1.25 per 1M output tokens

Translating 50 keys to 67 languages costs approximately **$0.05-0.10** per full run.

## Comparison with inlang

| Feature             | inlang machine translate | This tool         |
| ------------------- | ------------------------ | ----------------- |
| Translation quality | Generic MT               | Context-aware LLM |
| Terminology         | Inconsistent             | Glossary-enforced |
| Speed               | Fast                     | Moderate          |
| Cost                | Free (limited)           | ~$0.05-0.10/run   |
| Reliability         | Buggy (SQLite errors)    | Production-grade  |
