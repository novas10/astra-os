---
name: auto-tagger
version: 1.0.0
description: Automatically tags incoming messages with semantic labels (question, code, urgent, bug, etc.) using keyword matching.
author: AstraOS Team
permissions:
  - tools
  - hooks:message
  - memory:read
  - memory:write
---

# Auto-Tagger Plugin

Analyzes every incoming message and attaches semantic tags based on keyword and pattern matching. No LLM calls required -- runs entirely locally with zero latency overhead.

## Features

- **onMessage** hook -- automatically detects tags and attaches them as `message.metadata.autoTags`
- **tag_message** tool -- manually analyze any text and get back a list of tags
- Persists per-tag counts in plugin memory for analytics

## Detected Tags

| Tag              | Triggered By                                      |
| ---------------- | ------------------------------------------------- |
| `question`       | Question marks, "how to", "what is", etc.         |
| `code`           | Code fences, `function`, `import`, `const`, etc.  |
| `urgent`         | "urgent", "asap", "critical", P0/SEV-0            |
| `bug`            | "bug", "error", "crash", "not working"            |
| `feature-request`| "feature request", "can we add", "enhancement"    |
| `greeting`       | "hello", "hi", "hey", "good morning"              |
| `thanks`         | "thank you", "thanks", "appreciate"               |
| `link`           | Any URL (`https://...`)                            |

## Tools

| Tool          | Input            | Output                          |
| ------------- | ---------------- | ------------------------------- |
| `tag_message` | `text` (string)  | `{ text, tags, tagCount }`      |

## Configuration

No configuration required. Tagging rules are defined in the source and can be extended by editing `TAG_RULES` in `index.ts`.
