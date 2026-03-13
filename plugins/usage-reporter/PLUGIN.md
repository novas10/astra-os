---
name: usage-reporter
version: 1.0.0
description: Tracks message counts, token usage, and per-channel/user statistics with daily summary reports.
author: AstraOS Team
permissions:
  - tools
  - hooks:message
  - hooks:response
  - cron
  - memory:read
  - memory:write
---

# Usage Reporter Plugin

Monitors all message and response traffic flowing through AstraOS, accumulating counters for messages, tokens, channels, and users. Exposes a tool for on-demand reports and logs a daily summary at midnight.

## Features

- **onMessage** hook -- counts incoming messages, tracks per-channel and per-user stats
- **onResponse** hook -- counts outgoing responses and accumulates token usage
- **usage_report** tool -- returns a snapshot of all usage statistics on demand
- **daily-usage-summary** cron job -- logs a summary at midnight and resets daily counters
- Automatic daily counter rollover when the date changes

## Tools

| Tool           | Input                    | Output                                         |
| -------------- | ------------------------ | ---------------------------------------------- |
| `usage_report` | `section?` (string enum) | Summary, channel counts, user counts, or all   |

### `section` parameter

| Value       | Returns                                    |
| ----------- | ------------------------------------------ |
| `"summary"` | Total and today's message/token counts     |
| `"channels"`| Per-channel message counts                 |
| `"users"`   | Per-user message counts                    |
| `"all"`     | Everything above combined (default)        |

## Data Persistence

All counters are stored in the plugin's key-value memory (`usageData` key) and survive restarts. Daily counters reset automatically at midnight or when the date changes between loads.

## Configuration

No configuration required.
