---
name: hello-world
version: 1.0.0
description: A minimal starter plugin that greets users and logs heartbeats. Great template for learning the AstraOS plugin system.
author: AstraOS Team
permissions:
  - tools
  - hooks:message
  - cron
  - memory:read
  - memory:write
---

# Hello World Plugin

The simplest possible AstraOS plugin. Use this as a starting template when building your own plugins.

## Features

- **hello** tool -- returns a greeting with the current server time
- **onMessage** hook -- logs every incoming message for observability
- **heartbeat** cron job -- prints a pulse every 5 minutes

## Tools

| Tool    | Input             | Output                          |
| ------- | ----------------- | ------------------------------- |
| `hello` | `name?` (string)  | `{ greeting, time, plugin, hostVersion }` |

## Configuration

No configuration required. Drop the folder into `plugins/` and go.
