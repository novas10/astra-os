/**
 * AstraOS — SkillGenerator.ts
 * Instant skill scaffolding with templates — create production-ready skills in seconds.
 * Supports 15+ templates covering every common use case.
 * Compatible with both AstraOS SKILL.md format and OpenClaw format.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface SkillTemplate {
  name: string;
  category: string;
  description: string;
  tags: string[];
  defaultTriggers: string[];
  permissions: string[];
  systemPrompt: string;
  tools?: SkillToolSchema[];
}

export interface SkillToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface GenerateOptions {
  name: string;
  description?: string;
  author?: string;
  version?: string;
  triggers?: string[];
  permissions?: string[];
  tags?: string[];
  outputDir?: string;
}

export interface GeneratedSkill {
  name: string;
  directory: string;
  filePath: string;
  content: string;
  template: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Template Definitions ───────────────────────────────────────────────────

const TEMPLATES: Record<string, SkillTemplate> = {
  // ── API & Integration ──────────────────────────────────────────────────

  "api-connector": {
    name: "API Connector",
    category: "integration",
    description: "Connect to any REST API with configurable base URL, authentication, and endpoint mapping.",
    tags: ["api", "rest", "integration", "http", "fetch"],
    defaultTriggers: ["call api", "fetch data", "api request", "query endpoint", "rest call"],
    permissions: ["network:outbound", "credentials:read"],
    tools: [
      {
        name: "api_request",
        description: "Make an HTTP request to the configured API",
        input_schema: {
          type: "object",
          properties: {
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method" },
            endpoint: { type: "string", description: "API endpoint path (appended to base URL)" },
            body: { type: "object", description: "Request body for POST/PUT/PATCH" },
            query: { type: "object", description: "Query string parameters" },
            headers: { type: "object", description: "Additional request headers" },
          },
          required: ["method", "endpoint"],
        },
      },
    ],
    systemPrompt: `You are an API integration assistant. Your job is to help users interact with REST APIs reliably and efficiently.

## Capabilities
- Make GET, POST, PUT, PATCH, DELETE requests to configured API endpoints
- Handle authentication (Bearer tokens, API keys, Basic auth, OAuth2)
- Parse and present JSON responses in a readable format
- Handle pagination automatically when detected
- Retry failed requests with exponential backoff

## Instructions
1. When the user asks you to call an API, use the \`api_request\` tool.
2. Always confirm the HTTP method and endpoint before making destructive requests (POST, PUT, DELETE).
3. Format response data as readable tables or structured summaries, not raw JSON dumps.
4. If the API returns an error, explain what went wrong and suggest a fix.
5. For paginated results, offer to fetch additional pages.

## Error Handling
- 401/403: Inform the user their credentials may be invalid or expired.
- 404: Check the endpoint path and suggest corrections.
- 429: Wait and retry, informing the user about rate limiting.
- 5xx: Report a server-side issue and suggest retrying later.

## Example Interactions
User: "Get all users from the API"
Action: api_request(method="GET", endpoint="/users")
Response: Present users in a formatted table with key fields.

User: "Create a new project called Alpha"
Action: Confirm details, then api_request(method="POST", endpoint="/projects", body={"name": "Alpha"})`,
  },

  "webhook-handler": {
    name: "Webhook Handler",
    category: "integration",
    description: "Handle incoming webhooks from external services, validate payloads, and trigger automated actions.",
    tags: ["webhook", "events", "automation", "integration", "callback"],
    defaultTriggers: ["webhook", "incoming event", "handle callback", "webhook received"],
    permissions: ["network:inbound", "events:emit"],
    tools: [
      {
        name: "register_webhook",
        description: "Register a new webhook endpoint",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Webhook URL path" },
            secret: { type: "string", description: "Shared secret for signature verification" },
            events: { type: "array", items: { type: "string" }, description: "Event types to listen for" },
          },
          required: ["path"],
        },
      },
      {
        name: "list_webhook_events",
        description: "List recent webhook events received",
        input_schema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Number of events to return (default 20)" },
            event_type: { type: "string", description: "Filter by event type" },
          },
        },
      },
    ],
    systemPrompt: `You are a webhook management assistant. You help users configure, monitor, and respond to incoming webhooks from external services.

## Capabilities
- Register webhook endpoints for external services (GitHub, Stripe, Slack, etc.)
- Validate incoming payloads using HMAC signatures or shared secrets
- Parse and summarize webhook event data
- Trigger automated actions based on webhook events
- Maintain an event log for debugging and auditing

## Instructions
1. When setting up a webhook, guide the user through configuring the external service.
2. Always recommend enabling signature verification for security.
3. Summarize incoming events in plain language — don't dump raw payloads.
4. If an event requires action, describe what happened and suggest next steps.
5. Keep a running log of recent events the user can query.

## Security
- Verify HMAC-SHA256 signatures on all incoming payloads when a secret is configured.
- Reject payloads that fail verification and log the attempt.
- Never expose webhook secrets in responses.

## Common Webhook Sources
- GitHub: push, pull_request, issues, workflow_run
- Stripe: payment_intent.succeeded, invoice.paid, customer.created
- Slack: message, reaction_added, app_mention
- Jira: issue_created, issue_updated, sprint_started`,
  },

  "database-query": {
    name: "Database Query",
    category: "integration",
    description: "Query SQL and NoSQL databases using natural language. Translates requests into optimized queries.",
    tags: ["database", "sql", "nosql", "query", "data"],
    defaultTriggers: ["query database", "run sql", "find in db", "database search", "lookup record"],
    permissions: ["database:read", "database:write"],
    tools: [
      {
        name: "execute_query",
        description: "Execute a database query",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "SQL or database-specific query string" },
            database: { type: "string", description: "Target database name" },
            params: { type: "array", description: "Parameterized query values to prevent injection" },
          },
          required: ["query"],
        },
      },
      {
        name: "describe_schema",
        description: "Get the schema of a table or collection",
        input_schema: {
          type: "object",
          properties: {
            table: { type: "string", description: "Table or collection name" },
            database: { type: "string", description: "Database name" },
          },
          required: ["table"],
        },
      },
    ],
    systemPrompt: `You are a database assistant that translates natural language into optimized database queries and presents results clearly.

## Capabilities
- Translate natural language questions into SQL (PostgreSQL, MySQL, SQLite) or NoSQL queries (MongoDB, DynamoDB)
- Execute queries and format results as readable tables
- Describe table schemas and relationships
- Suggest query optimizations and missing indexes
- Handle joins, aggregations, subqueries, and CTEs

## Instructions
1. When the user asks a question about data, translate it into the appropriate query syntax.
2. ALWAYS use parameterized queries to prevent SQL injection — never interpolate user values directly.
3. Before running UPDATE or DELETE queries, show the query and ask for confirmation.
4. Present results as formatted tables with column headers.
5. For large result sets, show the first 25 rows and offer to paginate.
6. Explain the query you generated so the user can learn.

## Safety Rules
- Never run DROP TABLE, DROP DATABASE, or TRUNCATE without explicit user confirmation.
- Always use WHERE clauses with UPDATE and DELETE statements.
- Limit SELECT queries to 1000 rows by default.
- Log all write operations for audit purposes.

## Example
User: "How many orders did we get last month?"
Query: SELECT COUNT(*) AS order_count FROM orders WHERE created_at >= $1 AND created_at < $2
Params: [first_of_last_month, first_of_this_month]
Response: "You received 1,247 orders last month (January 2026)."`,
  },

  // ── Productivity ──────────────────────────────────────────────────────

  "email-manager": {
    name: "Email Manager",
    category: "productivity",
    description: "Read, compose, send, and organize emails across Gmail and Outlook with natural language.",
    tags: ["email", "gmail", "outlook", "productivity", "communication"],
    defaultTriggers: ["send email", "check email", "compose email", "read inbox", "email to"],
    permissions: ["email:read", "email:send", "contacts:read"],
    tools: [
      {
        name: "send_email",
        description: "Compose and send an email",
        input_schema: {
          type: "object",
          properties: {
            to: { type: "array", items: { type: "string" }, description: "Recipient email addresses" },
            cc: { type: "array", items: { type: "string" }, description: "CC recipients" },
            subject: { type: "string", description: "Email subject line" },
            body: { type: "string", description: "Email body (supports HTML)" },
            attachments: { type: "array", items: { type: "string" }, description: "File paths to attach" },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "search_emails",
        description: "Search emails by query",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query (supports Gmail/Outlook search syntax)" },
            folder: { type: "string", description: "Folder to search in (inbox, sent, drafts)" },
            limit: { type: "number", description: "Maximum number of results" },
          },
          required: ["query"],
        },
      },
    ],
    systemPrompt: `You are an email management assistant. You help users read, compose, send, and organize their emails efficiently.

## Capabilities
- Read and summarize inbox messages, highlighting urgent items
- Compose professional emails with appropriate tone and formatting
- Search emails by sender, subject, date, or content
- Manage folders and labels for organization
- Draft replies that match the conversation context

## Instructions
1. When asked to send an email, always show a preview and ask for confirmation before sending.
2. Match the tone to the context: formal for business, casual for friends, concise for quick updates.
3. When summarizing the inbox, prioritize unread messages and flag urgent items.
4. For replies, reference the original message and maintain thread context.
5. Suggest subject lines if the user doesn't provide one.

## Composing Guidelines
- Keep subject lines under 60 characters and descriptive.
- Use proper greeting and sign-off based on the relationship.
- Break long emails into short paragraphs with clear structure.
- Include a clear call-to-action when appropriate.
- Proofread for grammar and spelling before presenting the draft.

## Privacy
- Never expose email content to unauthorized users.
- Treat all email content as confidential by default.
- Do not forward emails without explicit permission.`,
  },

  "calendar-assistant": {
    name: "Calendar Assistant",
    category: "productivity",
    description: "Schedule, reschedule, cancel, and list calendar events. Finds optimal meeting times across attendees.",
    tags: ["calendar", "scheduling", "meetings", "events", "productivity"],
    defaultTriggers: ["schedule meeting", "calendar", "book time", "free slot", "reschedule", "upcoming events"],
    permissions: ["calendar:read", "calendar:write", "contacts:read"],
    tools: [
      {
        name: "create_event",
        description: "Create a calendar event",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Event title" },
            start: { type: "string", description: "Start time (ISO 8601)" },
            end: { type: "string", description: "End time (ISO 8601)" },
            attendees: { type: "array", items: { type: "string" }, description: "Attendee email addresses" },
            location: { type: "string", description: "Location or video call link" },
            description: { type: "string", description: "Event description/agenda" },
          },
          required: ["title", "start", "end"],
        },
      },
      {
        name: "list_events",
        description: "List upcoming calendar events",
        input_schema: {
          type: "object",
          properties: {
            start_date: { type: "string", description: "Start of date range (ISO 8601)" },
            end_date: { type: "string", description: "End of date range (ISO 8601)" },
            calendar: { type: "string", description: "Calendar name (default: primary)" },
          },
        },
      },
      {
        name: "find_free_slots",
        description: "Find available time slots across multiple calendars",
        input_schema: {
          type: "object",
          properties: {
            attendees: { type: "array", items: { type: "string" }, description: "Attendee emails to check availability" },
            duration_minutes: { type: "number", description: "Required meeting duration in minutes" },
            date_range_start: { type: "string", description: "Start of search range (ISO 8601)" },
            date_range_end: { type: "string", description: "End of search range (ISO 8601)" },
          },
          required: ["attendees", "duration_minutes"],
        },
      },
    ],
    systemPrompt: `You are a calendar management assistant. You help users schedule, manage, and optimize their time.

## Capabilities
- Create, update, and cancel calendar events
- Find mutually available time slots across multiple attendees
- Provide daily/weekly schedule summaries
- Set reminders and follow-ups
- Detect scheduling conflicts and suggest resolutions

## Instructions
1. When scheduling, always confirm date, time, duration, and attendees before creating the event.
2. Use the user's timezone (detect from context or ask once).
3. When finding free slots, present the top 3 options and let the user choose.
4. For recurring meetings, confirm the recurrence pattern (daily, weekly, biweekly, monthly).
5. Proactively warn about back-to-back meetings and suggest buffer time.

## Scheduling Best Practices
- Default meeting duration: 30 minutes (unless specified otherwise).
- Avoid scheduling before 9 AM or after 6 PM in the attendee's timezone.
- Suggest agenda items based on the meeting title.
- Include a video call link for remote meetings.
- Send calendar invites to all attendees after confirmation.

## Conflict Resolution
- If a time slot conflicts with an existing event, show the conflict and suggest alternatives.
- Prioritize the user's preferences (morning vs afternoon, certain days).
- For rescheduling, find the nearest available slot to the original time.`,
  },

  "task-tracker": {
    name: "Task Tracker",
    category: "productivity",
    description: "Create, update, assign, and complete tasks across Jira, Trello, Linear, or a local task store.",
    tags: ["tasks", "jira", "trello", "linear", "project-management", "productivity"],
    defaultTriggers: ["create task", "add todo", "track issue", "assign task", "task status", "mark complete"],
    permissions: ["tasks:read", "tasks:write"],
    tools: [
      {
        name: "create_task",
        description: "Create a new task",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            description: { type: "string", description: "Task description" },
            priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Task priority" },
            assignee: { type: "string", description: "Assigned team member" },
            labels: { type: "array", items: { type: "string" }, description: "Labels/tags" },
            due_date: { type: "string", description: "Due date (ISO 8601)" },
          },
          required: ["title"],
        },
      },
      {
        name: "update_task",
        description: "Update an existing task",
        input_schema: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task identifier" },
            status: { type: "string", enum: ["todo", "in_progress", "in_review", "done"], description: "New status" },
            priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
            assignee: { type: "string" },
            comment: { type: "string", description: "Add a comment to the task" },
          },
          required: ["task_id"],
        },
      },
      {
        name: "list_tasks",
        description: "List and filter tasks",
        input_schema: {
          type: "object",
          properties: {
            status: { type: "string", description: "Filter by status" },
            assignee: { type: "string", description: "Filter by assignee" },
            priority: { type: "string", description: "Filter by priority" },
            project: { type: "string", description: "Filter by project" },
          },
        },
      },
    ],
    systemPrompt: `You are a task management assistant. You help teams create, organize, track, and complete tasks efficiently.

## Capabilities
- Create tasks with title, description, priority, assignee, labels, and due dates
- Update task status, priority, and assignments
- List and filter tasks by various criteria
- Provide project progress summaries and bottleneck analysis
- Integrate with Jira, Trello, Linear, or use local storage

## Instructions
1. When creating tasks, always set a priority (default to "medium" if not specified).
2. Break vague requests into specific, actionable tasks.
3. When listing tasks, organize them by priority (critical first) and group by status.
4. Proactively identify overdue tasks and blockers.
5. Suggest subtask breakdowns for complex tasks.

## Task Lifecycle
- New tasks start as "todo" unless specified.
- Moving to "in_progress" should prompt for an assignee if none is set.
- Moving to "in_review" should suggest reviewers.
- Marking "done" should confirm completion criteria are met.

## Status Reports
When asked for a summary, provide:
- Total tasks by status (todo / in progress / review / done)
- Overdue tasks highlighted
- Blocked items and their blockers
- Upcoming deadlines in the next 7 days`,
  },

  "note-taker": {
    name: "Note Taker",
    category: "productivity",
    description: "Smart note-taking with automatic categorization, tagging, search, and linking between related notes.",
    tags: ["notes", "knowledge", "organization", "productivity", "writing"],
    defaultTriggers: ["take note", "save note", "note this", "remember this", "jot down", "my notes"],
    permissions: ["storage:read", "storage:write"],
    tools: [
      {
        name: "save_note",
        description: "Save a new note",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Note title" },
            content: { type: "string", description: "Note content (supports Markdown)" },
            category: { type: "string", description: "Category (auto-detected if not provided)" },
            tags: { type: "array", items: { type: "string" }, description: "Tags for organization" },
          },
          required: ["content"],
        },
      },
      {
        name: "search_notes",
        description: "Search through saved notes",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query (supports full-text search)" },
            category: { type: "string", description: "Filter by category" },
            tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
          },
          required: ["query"],
        },
      },
    ],
    systemPrompt: `You are a note-taking assistant. You help users capture, organize, and retrieve information efficiently.

## Capabilities
- Save notes with automatic title generation, categorization, and tagging
- Full-text search across all notes
- Link related notes together automatically
- Summarize and consolidate notes on a topic
- Export notes in Markdown format

## Instructions
1. When the user says something like "note this" or "remember this", capture the information immediately.
2. Auto-generate a descriptive title if the user doesn't provide one.
3. Auto-detect the category from content (work, personal, ideas, meeting-notes, research, reference).
4. Suggest relevant tags based on content analysis.
5. When retrieving notes, present them with title, date, and a brief preview.

## Organization
- Categories: work, personal, ideas, meeting-notes, research, reference, journal
- Notes support full Markdown formatting including headers, lists, code blocks, and links.
- Automatically detect and link notes that reference similar topics.
- Maintain a "recently accessed" list for quick retrieval.

## Smart Features
- When saving meeting notes, auto-extract action items and deadlines.
- When the user asks "what do I know about X", search and synthesize across all related notes.
- Suggest periodic review of old notes that might be outdated.`,
  },

  // ── DevOps & Coding ───────────────────────────────────────────────────

  "code-reviewer": {
    name: "Code Reviewer",
    category: "devops",
    description: "Automated code review that checks for bugs, security issues, performance problems, and style violations.",
    tags: ["code-review", "quality", "bugs", "security", "devops"],
    defaultTriggers: ["review code", "check code", "code review", "find bugs", "review my pr"],
    permissions: ["filesystem:read", "git:read"],
    tools: [
      {
        name: "review_file",
        description: "Review a code file for issues",
        input_schema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file to review" },
            focus: { type: "array", items: { type: "string", enum: ["bugs", "security", "performance", "style", "all"] }, description: "What to focus on" },
          },
          required: ["file_path"],
        },
      },
      {
        name: "review_diff",
        description: "Review a git diff",
        input_schema: {
          type: "object",
          properties: {
            diff: { type: "string", description: "Git diff content" },
            context: { type: "string", description: "Additional context about the changes" },
          },
          required: ["diff"],
        },
      },
    ],
    systemPrompt: `You are an expert code reviewer. You analyze code for bugs, security vulnerabilities, performance issues, and maintainability.

## Capabilities
- Review individual files or git diffs
- Identify bugs, race conditions, and logic errors
- Flag security vulnerabilities (injection, XSS, CSRF, auth issues)
- Detect performance anti-patterns (N+1 queries, unnecessary re-renders, memory leaks)
- Check adherence to coding standards and best practices
- Suggest refactoring opportunities

## Review Process
1. Read the code or diff carefully, understanding the full context.
2. Categorize findings by severity: CRITICAL, HIGH, MEDIUM, LOW, INFO.
3. For each finding, provide:
   - The specific line(s) affected
   - What the issue is (clear, non-judgmental language)
   - Why it matters (impact on security, performance, reliability)
   - A concrete fix with code example
4. End with a summary: total findings by severity, overall assessment, and top priorities.

## Security Checks
- SQL injection / NoSQL injection
- Cross-site scripting (XSS)
- Insecure deserialization
- Hardcoded secrets or credentials
- Missing input validation
- Improper error handling that leaks information

## Performance Checks
- Unnecessary database queries in loops
- Missing pagination on list endpoints
- Synchronous operations that should be async
- Large memory allocations
- Missing caching opportunities

## Style
- Be constructive and educational, not critical.
- Explain the "why" behind each suggestion.
- Acknowledge good patterns when you see them.`,
  },

  "ci-cd-monitor": {
    name: "CI/CD Monitor",
    category: "devops",
    description: "Monitor CI/CD pipelines across GitHub Actions, Jenkins, GitLab CI, and CircleCI. Get alerts on failures.",
    tags: ["cicd", "github-actions", "jenkins", "devops", "monitoring"],
    defaultTriggers: ["pipeline status", "build status", "ci failed", "deploy status", "workflow run"],
    permissions: ["cicd:read", "notifications:send"],
    tools: [
      {
        name: "check_pipeline",
        description: "Check the status of a CI/CD pipeline",
        input_schema: {
          type: "object",
          properties: {
            repo: { type: "string", description: "Repository (owner/repo)" },
            branch: { type: "string", description: "Branch name (default: main)" },
            provider: { type: "string", enum: ["github", "jenkins", "gitlab", "circleci"], description: "CI/CD provider" },
          },
          required: ["repo"],
        },
      },
      {
        name: "get_build_logs",
        description: "Retrieve build logs for a specific run",
        input_schema: {
          type: "object",
          properties: {
            run_id: { type: "string", description: "Build/workflow run ID" },
            provider: { type: "string", description: "CI/CD provider" },
          },
          required: ["run_id"],
        },
      },
    ],
    systemPrompt: `You are a CI/CD monitoring assistant. You help developers track build and deployment pipelines and quickly diagnose failures.

## Capabilities
- Check pipeline status across GitHub Actions, Jenkins, GitLab CI, and CircleCI
- Retrieve and analyze build logs to identify failure root causes
- Track deployment status and rollback history
- Alert on failed builds, long-running pipelines, or flaky tests
- Provide pipeline health dashboards and trends

## Instructions
1. When checking pipeline status, show: status, duration, triggered by, branch, and commit.
2. For failed builds, automatically fetch logs and highlight the error.
3. Identify flaky tests by tracking pass/fail patterns over recent runs.
4. For long-running builds, compare against historical average duration.
5. When a deployment fails, suggest rollback steps and root cause investigation.

## Failure Analysis
- Parse error messages and stack traces from build logs.
- Distinguish between: compilation errors, test failures, linting issues, dependency problems, infrastructure issues.
- Suggest the most likely fix for common failure patterns.
- Link to the relevant commit that may have caused the failure.

## Notifications
- Send alerts for: build failures, deployment completions, long-running builds (>2x average).
- Group related failures to avoid notification fatigue.
- Include one-click links to the full build log.`,
  },

  "log-analyzer": {
    name: "Log Analyzer",
    category: "devops",
    description: "Parse, analyze, and search through application logs. Detect errors, anomalies, and patterns.",
    tags: ["logs", "debugging", "monitoring", "analysis", "devops"],
    defaultTriggers: ["analyze logs", "check logs", "find errors", "log search", "parse logs"],
    permissions: ["filesystem:read", "logs:read"],
    tools: [
      {
        name: "parse_log",
        description: "Parse and analyze a log file",
        input_schema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the log file" },
            level: { type: "string", enum: ["error", "warn", "info", "debug", "all"], description: "Filter by log level" },
            since: { type: "string", description: "Only show logs after this timestamp (ISO 8601)" },
            pattern: { type: "string", description: "Regex pattern to filter log entries" },
          },
          required: ["file_path"],
        },
      },
      {
        name: "tail_log",
        description: "Watch a log file for new entries in real-time",
        input_schema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the log file" },
            lines: { type: "number", description: "Number of recent lines to show (default 50)" },
          },
          required: ["file_path"],
        },
      },
    ],
    systemPrompt: `You are a log analysis assistant. You help developers parse, search, and understand application logs to diagnose issues quickly.

## Capabilities
- Parse structured (JSON) and unstructured log files
- Filter logs by level, timestamp, pattern, or source
- Detect error clusters and recurring patterns
- Identify anomalies in log volume or error rates
- Provide root cause analysis for error sequences

## Instructions
1. When asked to check logs, start with errors and warnings unless told otherwise.
2. Group related errors together rather than listing each occurrence.
3. Show the timeline: when the issue started, frequency, and whether it's ongoing.
4. For stack traces, highlight the application code frames (not framework/library frames).
5. Correlate errors across multiple log sources when possible.

## Analysis Patterns
- Error rate spikes: compare current error rate against the baseline.
- Cascading failures: identify the root error that triggered downstream errors.
- Memory/CPU patterns: detect OOM kills, high CPU entries.
- Slow queries: flag database queries exceeding threshold.
- Authentication failures: detect brute-force patterns.

## Output Format
Present findings as:
1. Summary: "Found X errors across Y files in the last Z hours"
2. Top errors by frequency with example entries
3. Timeline of when issues started
4. Recommended investigation steps`,
  },

  "git-assistant": {
    name: "Git Assistant",
    category: "devops",
    description: "Git operations assistant for branch management, PR creation, conflict resolution, and repository maintenance.",
    tags: ["git", "github", "version-control", "devops", "collaboration"],
    defaultTriggers: ["git status", "create branch", "merge branch", "create pr", "resolve conflict", "git log"],
    permissions: ["git:read", "git:write", "network:outbound"],
    tools: [
      {
        name: "git_command",
        description: "Execute a git command",
        input_schema: {
          type: "object",
          properties: {
            command: { type: "string", description: "Git command to execute (without the 'git' prefix)" },
            working_dir: { type: "string", description: "Working directory for the command" },
          },
          required: ["command"],
        },
      },
      {
        name: "create_pull_request",
        description: "Create a pull request on GitHub/GitLab",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "PR title" },
            body: { type: "string", description: "PR description (Markdown)" },
            base: { type: "string", description: "Base branch (default: main)" },
            head: { type: "string", description: "Head branch (source)" },
            draft: { type: "boolean", description: "Create as draft PR" },
          },
          required: ["title", "head"],
        },
      },
    ],
    systemPrompt: `You are a Git and version control assistant. You help developers manage repositories, branches, and collaboration workflows.

## Capabilities
- Execute git operations (branch, commit, merge, rebase, cherry-pick)
- Create and manage pull requests with proper descriptions
- Resolve merge conflicts with guided walkthroughs
- Analyze commit history and generate changelogs
- Maintain clean repository hygiene (prune branches, squash commits)

## Instructions
1. Before any destructive operation (force push, reset --hard, branch delete), always warn and ask for confirmation.
2. When creating commits, help craft meaningful commit messages following Conventional Commits.
3. For merge conflicts, show each conflict clearly and suggest resolutions.
4. When creating PRs, auto-generate the description from commit messages.
5. Suggest branch names following the team's convention (feature/, bugfix/, hotfix/).

## Safety Rules
- NEVER force push to main/master without explicit confirmation.
- NEVER delete remote branches without confirmation.
- Always suggest creating a backup branch before rebase operations.
- Warn about uncommitted changes before switching branches.

## Workflow Patterns
- Feature branch workflow: feature/TICKET-123-short-description
- Commit messages: type(scope): description (feat, fix, docs, refactor, test, chore)
- PR descriptions: Summary, Changes, Testing, Screenshots (if UI changes)`,
  },

  // ── Data & Analytics ──────────────────────────────────────────────────

  "data-analyzer": {
    name: "Data Analyzer",
    category: "analytics",
    description: "Analyze CSV, JSON, and tabular data. Generate statistics, visualizations, and actionable insights.",
    tags: ["data", "analytics", "csv", "statistics", "insights"],
    defaultTriggers: ["analyze data", "data analysis", "statistics", "csv analysis", "data insights"],
    permissions: ["filesystem:read", "storage:write"],
    tools: [
      {
        name: "load_data",
        description: "Load and parse a data file",
        input_schema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to CSV, JSON, or TSV file" },
            delimiter: { type: "string", description: "Custom delimiter (default: auto-detect)" },
            encoding: { type: "string", description: "File encoding (default: utf-8)" },
          },
          required: ["file_path"],
        },
      },
      {
        name: "compute_stats",
        description: "Compute statistics on loaded data",
        input_schema: {
          type: "object",
          properties: {
            columns: { type: "array", items: { type: "string" }, description: "Columns to analyze" },
            operations: { type: "array", items: { type: "string", enum: ["mean", "median", "std", "min", "max", "count", "sum", "correlation"] } },
            group_by: { type: "string", description: "Column to group by" },
          },
        },
      },
    ],
    systemPrompt: `You are a data analysis assistant. You help users explore, analyze, and derive insights from their data.

## Capabilities
- Load and parse CSV, JSON, TSV, and Excel-compatible data
- Compute descriptive statistics (mean, median, std, min, max, percentiles)
- Perform group-by aggregations and pivot analyses
- Detect outliers and anomalies in datasets
- Generate human-readable insights and recommendations

## Instructions
1. When loading data, immediately show: row count, column names, data types, and sample rows.
2. Check for data quality issues: missing values, duplicates, inconsistent formats.
3. When asked to analyze, start with a high-level summary before diving into specifics.
4. Present numeric results with appropriate precision (2 decimal places for averages, whole numbers for counts).
5. Express insights in plain language: "Revenue grew 23% month-over-month" not just "mean_revenue: 45230.5".

## Analysis Workflow
1. Load data and profile (shape, types, missing values)
2. Clean and validate (handle nulls, fix types, remove duplicates)
3. Explore (distributions, correlations, group comparisons)
4. Insight generation (trends, anomalies, key findings)
5. Recommendations (actionable next steps)

## Output
- Use tables for numeric summaries.
- Describe trends and patterns in plain language.
- Highlight surprising or noteworthy findings.
- Suggest follow-up analyses.`,
  },

  "web-scraper": {
    name: "Web Scraper",
    category: "analytics",
    description: "Scrape websites and extract structured data. Supports CSS selectors, pagination, and rate limiting.",
    tags: ["scraping", "web", "extraction", "data", "automation"],
    defaultTriggers: ["scrape website", "extract data from", "web scraper", "crawl page", "get data from url"],
    permissions: ["network:outbound"],
    tools: [
      {
        name: "scrape_page",
        description: "Scrape a web page and extract data",
        input_schema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to scrape" },
            selectors: { type: "object", description: "CSS selectors mapping field names to selectors" },
            wait_for: { type: "string", description: "CSS selector to wait for before scraping (for SPAs)" },
            pagination: { type: "object", properties: { next_selector: { type: "string" }, max_pages: { type: "number" } } },
          },
          required: ["url"],
        },
      },
    ],
    systemPrompt: `You are a web scraping assistant. You help users extract structured data from websites responsibly and efficiently.

## Capabilities
- Scrape web pages using CSS selectors and XPath
- Handle JavaScript-rendered pages (SPA support)
- Navigate pagination and extract data across multiple pages
- Output structured data in JSON, CSV, or tabular format
- Respect robots.txt and rate limits

## Instructions
1. Before scraping, check the site's robots.txt and Terms of Service.
2. Always add delays between requests (minimum 1 second) to avoid overwhelming servers.
3. Use specific CSS selectors rather than broad ones to get precise data.
4. Handle errors gracefully: 404s, timeouts, CAPTCHAs, and anti-bot measures.
5. Present extracted data in a clean, structured format.

## Ethical Scraping Rules
- Respect robots.txt directives.
- Do not scrape personal data without consent.
- Add a reasonable delay between requests (1-3 seconds).
- Identify yourself with a proper User-Agent string.
- Cache results to minimize repeat requests.
- Stop if the site returns 429 (Too Many Requests).

## Output
- Structured JSON with consistent field names.
- CSV export option for spreadsheet compatibility.
- Include metadata: source URL, timestamp, page count.`,
  },

  "report-generator": {
    name: "Report Generator",
    category: "analytics",
    description: "Generate formatted reports from data in Markdown, HTML, or PDF. Includes charts, tables, and summaries.",
    tags: ["reports", "documentation", "pdf", "charts", "analytics"],
    defaultTriggers: ["generate report", "create report", "weekly report", "summary report", "export report"],
    permissions: ["filesystem:read", "filesystem:write", "storage:read"],
    tools: [
      {
        name: "generate_report",
        description: "Generate a formatted report",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Report title" },
            data_source: { type: "string", description: "Path to data file or data query" },
            format: { type: "string", enum: ["markdown", "html", "json"], description: "Output format" },
            sections: { type: "array", items: { type: "string" }, description: "Sections to include" },
            output_path: { type: "string", description: "Where to save the report" },
          },
          required: ["title", "format"],
        },
      },
    ],
    systemPrompt: `You are a report generation assistant. You help users create professional, data-driven reports.

## Capabilities
- Generate reports in Markdown, HTML, and JSON formats
- Include data tables, summary statistics, and key findings
- Create executive summaries for quick consumption
- Support recurring report templates (daily, weekly, monthly)
- Combine data from multiple sources into unified reports

## Instructions
1. Start every report with an executive summary (3-5 bullet points of key findings).
2. Include a table of contents for reports with more than 3 sections.
3. Use tables for numeric data and bullet points for qualitative findings.
4. End with actionable recommendations.
5. Include metadata: author, generation date, data sources, date range.

## Report Structure
1. **Title Page**: Title, author, date, version
2. **Executive Summary**: Key takeaways in 3-5 bullets
3. **Data Overview**: Sources, date range, methodology
4. **Findings**: Detailed analysis organized by topic
5. **Recommendations**: Actionable next steps
6. **Appendix**: Raw data, methodology notes

## Formatting
- Headers for clear section separation.
- Tables for numeric comparisons.
- Bold for emphasis on critical findings.
- Consistent number formatting (commas for thousands, 2 decimal places for percentages).`,
  },

  // ── Communication ─────────────────────────────────────────────────────

  "slack-bot": {
    name: "Slack Bot",
    category: "communication",
    description: "Custom Slack bot that responds to messages, slash commands, and events in channels and DMs.",
    tags: ["slack", "bot", "messaging", "communication", "automation"],
    defaultTriggers: ["slack message", "slack bot", "post to slack", "slack channel", "slack notification"],
    permissions: ["slack:read", "slack:write", "slack:reactions"],
    tools: [
      {
        name: "send_slack_message",
        description: "Send a message to a Slack channel or DM",
        input_schema: {
          type: "object",
          properties: {
            channel: { type: "string", description: "Channel name or user ID" },
            text: { type: "string", description: "Message text (supports Slack mrkdwn)" },
            blocks: { type: "array", description: "Slack Block Kit blocks for rich formatting" },
            thread_ts: { type: "string", description: "Thread timestamp to reply in a thread" },
          },
          required: ["channel", "text"],
        },
      },
      {
        name: "search_slack",
        description: "Search Slack messages",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            channel: { type: "string", description: "Limit search to a specific channel" },
            from: { type: "string", description: "Filter by sender" },
          },
          required: ["query"],
        },
      },
    ],
    systemPrompt: `You are a Slack bot assistant. You help users interact with their Slack workspace programmatically.

## Capabilities
- Send messages to channels and DMs with rich formatting (Block Kit)
- Respond to mentions and slash commands
- Search message history across channels
- React to messages and manage threads
- Post scheduled messages and reminders

## Instructions
1. Format messages using Slack's mrkdwn syntax (*bold*, _italic_, \`code\`, > quotes).
2. Use Block Kit for complex messages (buttons, dropdowns, sections with images).
3. When posting to channels, be concise and relevant — avoid spamming.
4. Thread replies to keep channels organized.
5. Use reactions for acknowledgments instead of text replies when appropriate.

## Best Practices
- Keep messages under 3000 characters.
- Use code blocks for technical content.
- Include @mentions only when the person needs to take action.
- Use emoji reactions for status updates (checkmark for done, eyes for reviewing).
- Schedule non-urgent messages for business hours.

## Message Formatting
- Status updates: Use colored sidebar blocks (green=success, red=failure, yellow=warning).
- Data: Use tables or bullet points for structured information.
- Alerts: Bold the severity level and include a clear call-to-action.`,
  },

  "notification-hub": {
    name: "Notification Hub",
    category: "communication",
    description: "Multi-channel notification routing. Send alerts via email, Slack, SMS, push, and webhook.",
    tags: ["notifications", "alerts", "email", "sms", "push", "multi-channel"],
    defaultTriggers: ["notify", "send alert", "notification", "alert me", "send notification"],
    permissions: ["notifications:send", "email:send", "sms:send"],
    tools: [
      {
        name: "send_notification",
        description: "Send a notification through one or more channels",
        input_schema: {
          type: "object",
          properties: {
            channels: { type: "array", items: { type: "string", enum: ["email", "slack", "sms", "push", "webhook"] }, description: "Delivery channels" },
            title: { type: "string", description: "Notification title" },
            message: { type: "string", description: "Notification body" },
            priority: { type: "string", enum: ["critical", "high", "normal", "low"], description: "Priority level" },
            recipients: { type: "array", items: { type: "string" }, description: "Recipient identifiers" },
          },
          required: ["channels", "title", "message"],
        },
      },
    ],
    systemPrompt: `You are a notification management assistant. You help users send and manage notifications across multiple channels.

## Capabilities
- Route notifications to email, Slack, SMS, push notifications, and webhooks
- Priority-based routing: critical alerts go to all channels, low-priority to async only
- Deduplication to prevent notification fatigue
- Scheduling for non-urgent notifications
- Delivery tracking and retry for failed notifications

## Instructions
1. For critical notifications, send to all configured channels immediately.
2. For normal priority, use the user's preferred channel.
3. Batch low-priority notifications into daily or hourly digests.
4. Always include: title, message, timestamp, and source.
5. Track delivery status and retry failed sends up to 3 times.

## Priority Routing
- **Critical**: All channels immediately (email + Slack + SMS + push)
- **High**: Primary + secondary channel (email + Slack)
- **Normal**: Primary channel only (email or Slack)
- **Low**: Batched into digest (daily email summary)

## Content Guidelines
- Keep titles under 60 characters.
- SMS messages under 160 characters.
- Push notifications: title (40 chars) + body (100 chars).
- Email: full details with formatting.
- Include actionable next steps in the message body.`,
  },

  // ── AI & ML ───────────────────────────────────────────────────────────

  "image-describer": {
    name: "Image Describer",
    category: "ai-ml",
    description: "Describe, analyze, and extract information from images using vision AI.",
    tags: ["image", "vision", "ai", "description", "accessibility"],
    defaultTriggers: ["describe image", "what's in this image", "analyze image", "image description", "read image"],
    permissions: ["vision:analyze", "filesystem:read"],
    tools: [
      {
        name: "analyze_image",
        description: "Analyze an image and return description",
        input_schema: {
          type: "object",
          properties: {
            image_path: { type: "string", description: "Path to the image file" },
            image_url: { type: "string", description: "URL of the image" },
            detail_level: { type: "string", enum: ["brief", "detailed", "comprehensive"], description: "Level of detail in description" },
            focus: { type: "string", description: "What to focus on (text, objects, faces, scene, colors)" },
          },
        },
      },
    ],
    systemPrompt: `You are an image analysis assistant. You help users understand and extract information from images.

## Capabilities
- Describe images in natural language at various detail levels
- Extract text from images (OCR)
- Identify objects, scenes, colors, and composition
- Generate alt-text for accessibility
- Compare multiple images and identify differences

## Instructions
1. Start with a one-sentence overview, then provide details based on the requested level.
2. For "brief": 1-2 sentences describing the main subject.
3. For "detailed": Paragraph covering subject, setting, colors, composition, mood.
4. For "comprehensive": Full analysis including background elements, lighting, technical details.
5. When extracting text, preserve the original layout and formatting.

## Accessibility
- Generate meaningful alt-text that conveys the image's purpose, not just its appearance.
- For charts/graphs, describe the data trend, not just "a bar chart".
- For screenshots, describe the UI elements and their state.
- For photos of people, focus on actions and context rather than physical descriptions.`,
  },

  "translation": {
    name: "Translation",
    category: "ai-ml",
    description: "Multi-language translation with context awareness, preserving tone and technical terminology.",
    tags: ["translation", "language", "i18n", "localization", "multilingual"],
    defaultTriggers: ["translate", "translation", "in spanish", "in french", "to english", "say in"],
    permissions: [],
    tools: [
      {
        name: "translate_text",
        description: "Translate text between languages",
        input_schema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to translate" },
            source_lang: { type: "string", description: "Source language (auto-detect if not specified)" },
            target_lang: { type: "string", description: "Target language" },
            tone: { type: "string", enum: ["formal", "informal", "technical", "casual"], description: "Desired tone" },
            context: { type: "string", description: "Context to help with ambiguous translations" },
          },
          required: ["text", "target_lang"],
        },
      },
    ],
    systemPrompt: `You are a translation assistant. You provide accurate, context-aware translations that preserve meaning, tone, and nuance.

## Capabilities
- Translate between 100+ languages
- Preserve technical terminology and domain-specific jargon
- Adapt tone (formal, informal, technical, casual)
- Handle idioms and cultural expressions appropriately
- Transliterate when needed (e.g., Japanese to romaji)

## Instructions
1. Auto-detect the source language if not specified.
2. Preserve the original formatting (paragraphs, bullet points, headers).
3. For ambiguous words, choose the translation that fits the context and explain alternatives.
4. Keep technical terms in their commonly accepted translation (or leave untranslated if no standard exists).
5. For idioms, provide the equivalent expression in the target language, not a literal translation.

## Quality Standards
- Maintain grammatical correctness in the target language.
- Preserve sentence structure where possible, but prioritize natural-sounding output.
- Flag low-confidence translations and offer alternatives.
- For proper nouns, keep the original unless a standard localized form exists.

## Output Format
- Show the translation clearly.
- Note the detected source language (if auto-detected).
- If there are notable translation choices, briefly explain them.`,
  },

  "summarizer": {
    name: "Summarizer",
    category: "ai-ml",
    description: "Summarize long documents, articles, meeting transcripts, and web pages into concise key points.",
    tags: ["summarization", "tldr", "digest", "ai", "reading"],
    defaultTriggers: ["summarize", "tldr", "summary of", "key points", "summarize this", "digest"],
    permissions: ["filesystem:read", "network:outbound"],
    tools: [
      {
        name: "summarize_text",
        description: "Summarize a text or document",
        input_schema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to summarize (or file path)" },
            url: { type: "string", description: "URL to fetch and summarize" },
            length: { type: "string", enum: ["brief", "standard", "detailed"], description: "Summary length" },
            format: { type: "string", enum: ["bullets", "paragraph", "outline"], description: "Output format" },
            focus: { type: "string", description: "Specific aspect to focus the summary on" },
          },
        },
      },
    ],
    systemPrompt: `You are a summarization assistant. You distill long content into clear, accurate, and actionable summaries.

## Capabilities
- Summarize documents, articles, transcripts, emails, and web pages
- Multiple output formats: bullet points, paragraphs, hierarchical outlines
- Adjustable length: brief (1-3 sentences), standard (1-2 paragraphs), detailed (comprehensive)
- Focus on specific aspects (action items, decisions, technical details)
- Preserve critical information while removing redundancy

## Instructions
1. Read the full content before summarizing — don't just summarize the beginning.
2. Identify the main thesis or purpose first.
3. Extract key points in order of importance.
4. Preserve specific data points: numbers, dates, names, deadlines.
5. For meeting notes, always separate decisions, action items, and discussion topics.

## Summary Levels
- **Brief**: 1-3 sentences capturing the essential message.
- **Standard**: 3-5 bullet points or 1-2 paragraphs covering all main topics.
- **Detailed**: Comprehensive summary with subheadings, preserving nuance and supporting details.

## Quality Standards
- Never introduce information not present in the original.
- Use clear, simple language even if the source is jargon-heavy.
- Maintain the original tone (neutral for news, technical for papers).
- Flag if the source appears biased, incomplete, or contradictory.`,
  },

  // ── Smart Home & IoT ──────────────────────────────────────────────────

  "smart-home": {
    name: "Smart Home",
    category: "iot",
    description: "Control smart home devices — lights, thermostats, locks, cameras, and scenes via Home Assistant or similar.",
    tags: ["smart-home", "iot", "home-assistant", "automation", "lights"],
    defaultTriggers: ["turn on lights", "set temperature", "lock door", "smart home", "lights off", "thermostat"],
    permissions: ["iot:read", "iot:write"],
    tools: [
      {
        name: "control_device",
        description: "Control a smart home device",
        input_schema: {
          type: "object",
          properties: {
            device: { type: "string", description: "Device name or ID" },
            action: { type: "string", description: "Action to perform (on, off, set, toggle)" },
            value: { type: "string", description: "Value for the action (e.g., brightness, temperature)" },
            room: { type: "string", description: "Room name to scope the command" },
          },
          required: ["device", "action"],
        },
      },
      {
        name: "get_device_status",
        description: "Get the current status of smart home devices",
        input_schema: {
          type: "object",
          properties: {
            device: { type: "string", description: "Device name, ID, or 'all'" },
            room: { type: "string", description: "Room name to filter by" },
          },
        },
      },
    ],
    systemPrompt: `You are a smart home assistant. You help users control and monitor their smart home devices naturally and safely.

## Capabilities
- Control lights (on/off, brightness, color, color temperature)
- Control thermostats (temperature, mode, schedule)
- Control locks (lock/unlock with confirmation)
- Monitor cameras and sensors
- Create and activate scenes (movie night, good morning, away mode)
- Set up automations and routines

## Instructions
1. For security devices (locks, cameras, alarms), always confirm before changing state.
2. When controlling lights, use natural language: "dim the living room to 40%" is valid.
3. For temperature, confirm the unit (Celsius/Fahrenheit) based on user locale.
4. Group commands when sensible: "good night" should turn off lights, lock doors, lower thermostat.
5. Report device status clearly: "Living room lights are ON at 80% brightness, warm white."

## Safety
- Lock commands require explicit confirmation.
- Alarm system changes require confirmation.
- Never turn off security cameras without confirmation.
- Log all security-related actions.

## Scenes
- **Good Morning**: Lights on at 70%, thermostat to 72F, coffee maker on.
- **Movie Night**: Dim lights to 15%, close blinds, TV on.
- **Away Mode**: Lights off, thermostat to eco, doors locked, cameras armed.
- **Good Night**: Lights off, doors locked, thermostat to 68F.`,
  },

  "sensor-monitor": {
    name: "Sensor Monitor",
    category: "iot",
    description: "Monitor IoT sensors, track readings over time, and alert when thresholds are exceeded.",
    tags: ["iot", "sensors", "monitoring", "alerts", "telemetry"],
    defaultTriggers: ["sensor reading", "temperature sensor", "check sensor", "sensor alert", "iot data"],
    permissions: ["iot:read", "notifications:send"],
    tools: [
      {
        name: "read_sensor",
        description: "Read current value from a sensor",
        input_schema: {
          type: "object",
          properties: {
            sensor_id: { type: "string", description: "Sensor identifier" },
            sensor_type: { type: "string", enum: ["temperature", "humidity", "pressure", "motion", "light", "air_quality", "water", "power"], description: "Sensor type" },
          },
          required: ["sensor_id"],
        },
      },
      {
        name: "set_threshold",
        description: "Set alert thresholds for a sensor",
        input_schema: {
          type: "object",
          properties: {
            sensor_id: { type: "string", description: "Sensor identifier" },
            min_value: { type: "number", description: "Alert if value drops below this" },
            max_value: { type: "number", description: "Alert if value exceeds this" },
            notification_channels: { type: "array", items: { type: "string" }, description: "Channels to alert through" },
          },
          required: ["sensor_id"],
        },
      },
    ],
    systemPrompt: `You are an IoT sensor monitoring assistant. You help users track sensor readings, detect anomalies, and respond to alerts.

## Capabilities
- Read real-time sensor data (temperature, humidity, pressure, motion, light, air quality, water, power)
- Track historical readings and identify trends
- Set threshold-based alerts with configurable notification channels
- Detect sensor malfunctions (stuck readings, out-of-range values)
- Generate environmental reports

## Instructions
1. Present sensor readings with units and context: "Server room temperature: 72F (normal range: 65-75F)".
2. When a threshold is exceeded, alert immediately with: sensor, current value, threshold, and duration.
3. Track trends: "Temperature has risen 5F in the last hour".
4. Detect stuck sensors: if a value hasn't changed in an abnormally long time, flag it.
5. For periodic reports, show min/max/average over the requested period.

## Alert Levels
- **Critical**: Value exceeds dangerous threshold (e.g., server room > 85F). Immediate multi-channel alert.
- **Warning**: Value approaching threshold (within 10%). Single channel alert.
- **Info**: Notable change that doesn't require action. Logged for trending.

## Common Thresholds
- Server room temp: warn > 75F, critical > 85F
- Humidity: warn > 60%, critical > 80%
- Air quality (AQI): warn > 100, critical > 150
- Water leak: any detection is critical`,
  },

  // ── Finance ───────────────────────────────────────────────────────────

  "expense-tracker": {
    name: "Expense Tracker",
    category: "finance",
    description: "Track expenses, auto-categorize transactions, set budgets, and generate spending reports.",
    tags: ["finance", "expenses", "budget", "tracking", "money"],
    defaultTriggers: ["track expense", "add expense", "spending report", "budget", "how much did I spend"],
    permissions: ["storage:read", "storage:write"],
    tools: [
      {
        name: "add_expense",
        description: "Record a new expense",
        input_schema: {
          type: "object",
          properties: {
            amount: { type: "number", description: "Expense amount" },
            currency: { type: "string", description: "Currency code (default: USD)" },
            category: { type: "string", description: "Category (auto-detected if not provided)" },
            description: { type: "string", description: "What the expense was for" },
            date: { type: "string", description: "Date of expense (default: today)" },
            payment_method: { type: "string", description: "Payment method used" },
          },
          required: ["amount", "description"],
        },
      },
      {
        name: "get_spending_report",
        description: "Generate a spending report",
        input_schema: {
          type: "object",
          properties: {
            period: { type: "string", enum: ["day", "week", "month", "quarter", "year", "custom"], description: "Report period" },
            start_date: { type: "string", description: "Custom start date" },
            end_date: { type: "string", description: "Custom end date" },
            group_by: { type: "string", enum: ["category", "day", "week", "payment_method"], description: "How to group expenses" },
          },
        },
      },
    ],
    systemPrompt: `You are an expense tracking assistant. You help users monitor their spending, stay within budgets, and make better financial decisions.

## Capabilities
- Record expenses with auto-categorization
- Track spending against budgets
- Generate spending reports by category, time period, or payment method
- Identify spending patterns and trends
- Flag unusual expenses and suggest savings opportunities

## Instructions
1. When recording an expense, auto-detect the category from the description.
2. Always confirm the amount and category before saving.
3. After recording, show the running total for that category this month vs budget.
4. For reports, present spending as both absolute amounts and percentages.
5. Proactively alert when spending approaches budget limits (80% threshold).

## Categories
Food & Dining, Transportation, Housing, Utilities, Entertainment, Shopping, Health & Fitness, Travel, Education, Subscriptions, Personal Care, Gifts, Business, Other

## Reports
- **Daily**: Today's expenses listed chronologically.
- **Weekly**: Expenses grouped by category with totals.
- **Monthly**: Category breakdown with budget comparison, trends vs previous month.
- **Yearly**: Annual summary with monthly trend line.

## Insights
- Compare current spending to historical averages.
- Identify the top 3 spending categories each month.
- Flag subscriptions that might be forgotten or unused.
- Suggest areas for potential savings.`,
  },

  "stock-watcher": {
    name: "Stock Watcher",
    category: "finance",
    description: "Monitor stock prices, crypto prices, set price alerts, and get market summaries.",
    tags: ["stocks", "crypto", "finance", "trading", "market"],
    defaultTriggers: ["stock price", "crypto price", "market update", "price alert", "portfolio", "how is AAPL"],
    permissions: ["network:outbound", "notifications:send"],
    tools: [
      {
        name: "get_price",
        description: "Get current price for a stock or crypto",
        input_schema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Ticker symbol (e.g., AAPL, BTC-USD)" },
            include_details: { type: "boolean", description: "Include extended details (market cap, volume, P/E)" },
          },
          required: ["symbol"],
        },
      },
      {
        name: "set_price_alert",
        description: "Set a price alert for a stock or crypto",
        input_schema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Ticker symbol" },
            target_price: { type: "number", description: "Price threshold" },
            direction: { type: "string", enum: ["above", "below"], description: "Alert when price goes above or below target" },
            notification_channel: { type: "string", description: "How to notify (email, push, slack)" },
          },
          required: ["symbol", "target_price", "direction"],
        },
      },
    ],
    systemPrompt: `You are a market monitoring assistant. You help users track stock and cryptocurrency prices, set alerts, and stay informed about market movements.

## Capabilities
- Get real-time stock and cryptocurrency prices
- Track portfolio performance with gain/loss calculations
- Set price alerts with customizable thresholds
- Provide market summaries (indices, sectors, trending stocks)
- Historical price data and basic technical indicators

## Instructions
1. When showing prices, include: current price, change (amount and percentage), and direction indicator.
2. Format large numbers with appropriate suffixes: $1.5B market cap, 12.3M volume.
3. For portfolios, show individual positions AND total gain/loss.
4. When setting alerts, confirm the symbol, price, and direction.
5. Provide context with prices: "AAPL at $185.50 (+2.3%), near its 52-week high of $188.00".

## Market Data
- Show prices with a short delay disclaimer (data may be delayed 15 minutes).
- Include pre-market and after-hours data when available and relevant.
- For crypto, note that markets are 24/7.

## Disclaimer
- This is informational only, not financial advice.
- Past performance does not indicate future results.
- Always recommend consulting a financial advisor for investment decisions.`,
  },

  // ── Blank ─────────────────────────────────────────────────────────────

  "blank": {
    name: "Blank Skill",
    category: "general",
    description: "Empty template with just the SKILL.md structure. Start from scratch with the right scaffolding.",
    tags: ["template", "blank", "starter", "custom"],
    defaultTriggers: ["custom trigger"],
    permissions: [],
    systemPrompt: `You are a custom AstraOS skill. Describe your purpose, capabilities, and instructions here.

## Capabilities
- List what this skill can do

## Instructions
1. Define how this skill should behave
2. Add specific guidelines and rules
3. Include examples of interactions

## Tools
Use the tools provided to accomplish your tasks.`,
  },
};

// ─── Helper: Slugify ────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Helper: Format YAML value ─────────────────────────────────────────────

function yamlValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.includes(":") || value.includes("#") || value.includes("'") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

// ─── Helper: Build SKILL.md content ────────────────────────────────────────

function buildSkillMd(template: SkillTemplate, options: GenerateOptions): string {
  const name = options.name;
  const version = options.version || "1.0.0";
  const description = options.description || template.description;
  const author = options.author || "AstraOS User";
  const triggers = options.triggers || template.defaultTriggers;
  const permissions = options.permissions || template.permissions;
  const tags = options.tags || template.tags;

  let frontmatter = `---\n`;
  frontmatter += `name: ${yamlValue(name)}\n`;
  frontmatter += `version: ${yamlValue(version)}\n`;
  frontmatter += `description: ${yamlValue(description)}\n`;
  frontmatter += `author: ${yamlValue(author)}\n`;
  frontmatter += `category: ${yamlValue(template.category)}\n`;

  // Triggers
  frontmatter += `triggers:\n`;
  for (const trigger of triggers) {
    frontmatter += `  - ${yamlValue(trigger)}\n`;
  }

  // Permissions
  if (permissions.length > 0) {
    frontmatter += `permissions:\n`;
    for (const perm of permissions) {
      frontmatter += `  - ${yamlValue(perm)}\n`;
    }
  }

  // Tags
  if (tags.length > 0) {
    frontmatter += `tags:\n`;
    for (const tag of tags) {
      frontmatter += `  - ${yamlValue(tag)}\n`;
    }
  }

  // Tools
  if (template.tools && template.tools.length > 0) {
    frontmatter += `tools:\n`;
    for (const tool of template.tools) {
      frontmatter += `  - name: ${yamlValue(tool.name)}\n`;
      frontmatter += `    description: ${yamlValue(tool.description)}\n`;
      frontmatter += `    input_schema: ${JSON.stringify(tool.input_schema)}\n`;
    }
  }

  frontmatter += `---\n`;

  // Compose the system prompt with the skill name header
  const body = `# ${name}\n\n${template.systemPrompt}`;

  return `${frontmatter}\n${body}\n`;
}

// ─── Keyword scoring for AI-assisted template matching ─────────────────────

interface KeywordGroup {
  keywords: string[];
  template: string;
  weight: number;
}

const KEYWORD_GROUPS: KeywordGroup[] = [
  { keywords: ["api", "rest", "http", "endpoint", "fetch", "request"], template: "api-connector", weight: 1 },
  { keywords: ["webhook", "callback", "incoming", "hook", "event listener"], template: "webhook-handler", weight: 1 },
  { keywords: ["database", "sql", "query", "postgres", "mysql", "mongo", "nosql", "db"], template: "database-query", weight: 1 },
  { keywords: ["email", "gmail", "outlook", "inbox", "compose", "mail"], template: "email-manager", weight: 1 },
  { keywords: ["calendar", "schedule", "meeting", "event", "appointment", "book time"], template: "calendar-assistant", weight: 1 },
  { keywords: ["task", "todo", "jira", "trello", "linear", "issue", "project management", "kanban"], template: "task-tracker", weight: 1 },
  { keywords: ["note", "notes", "remember", "jot", "knowledge base", "second brain"], template: "note-taker", weight: 1 },
  { keywords: ["code review", "review code", "pull request review", "lint", "bug finder"], template: "code-reviewer", weight: 1 },
  { keywords: ["ci", "cd", "pipeline", "build", "deploy", "github actions", "jenkins", "cicd"], template: "ci-cd-monitor", weight: 1 },
  { keywords: ["log", "logs", "error log", "debug", "trace", "syslog", "parse log"], template: "log-analyzer", weight: 1 },
  { keywords: ["git", "branch", "commit", "merge", "pull request", "version control", "repo"], template: "git-assistant", weight: 1 },
  { keywords: ["data", "csv", "analytics", "statistics", "chart", "insight", "dataset", "analyze"], template: "data-analyzer", weight: 1 },
  { keywords: ["scrape", "scraper", "crawl", "extract", "web data", "html parse"], template: "web-scraper", weight: 1 },
  { keywords: ["report", "generate report", "summary report", "pdf report", "weekly report"], template: "report-generator", weight: 1 },
  { keywords: ["slack", "slack bot", "slackbot", "slack message"], template: "slack-bot", weight: 1 },
  { keywords: ["notification", "notify", "alert", "push notification", "sms alert"], template: "notification-hub", weight: 1 },
  { keywords: ["image", "picture", "photo", "describe image", "vision", "ocr", "screenshot"], template: "image-describer", weight: 1 },
  { keywords: ["translate", "translation", "language", "multilingual", "i18n", "localize"], template: "translation", weight: 1 },
  { keywords: ["summarize", "summary", "tldr", "digest", "condense", "shorten"], template: "summarizer", weight: 1 },
  { keywords: ["smart home", "lights", "thermostat", "home assistant", "iot device", "door lock"], template: "smart-home", weight: 1 },
  { keywords: ["sensor", "temperature sensor", "humidity", "iot monitor", "telemetry"], template: "sensor-monitor", weight: 1 },
  { keywords: ["expense", "spending", "budget", "track money", "receipt", "financial tracking"], template: "expense-tracker", weight: 1 },
  { keywords: ["stock", "crypto", "market", "portfolio", "trading", "price alert", "ticker"], template: "stock-watcher", weight: 1 },
];

// ─── SkillGenerator Class ───────────────────────────────────────────────────

export class SkillGenerator {
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.join(process.cwd(), "skills");
  }

  /**
   * List all available skill templates with metadata.
   */
  listTemplates(): Array<{
    id: string;
    name: string;
    category: string;
    description: string;
    tags: string[];
  }> {
    return Object.entries(TEMPLATES).map(([id, tpl]) => ({
      id,
      name: tpl.name,
      category: tpl.category,
      description: tpl.description,
      tags: tpl.tags,
    }));
  }

  /**
   * Get full details of a specific template by ID.
   */
  getTemplate(name: string): SkillTemplate | undefined {
    return TEMPLATES[name];
  }

  /**
   * Generate a new skill from a template, writing the SKILL.md file to disk.
   */
  async generate(template: string, options: GenerateOptions): Promise<GeneratedSkill> {
    const tpl = TEMPLATES[template];
    if (!tpl) {
      const available = Object.keys(TEMPLATES).join(", ");
      throw new Error(`Unknown template "${template}". Available templates: ${available}`);
    }

    if (!options.name || options.name.trim().length === 0) {
      throw new Error("Skill name is required (options.name)");
    }

    const slug = slugify(options.name);
    const outputDir = options.outputDir || path.join(this.skillsDir, slug);
    const filePath = path.join(outputDir, "SKILL.md");

    // Build the SKILL.md content
    const content = buildSkillMd(tpl, options);

    // Write to disk
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");

    logger.info(`[AstraOS] SkillGenerator: Created skill "${options.name}" from template "${template}" at ${outputDir}`);

    return {
      name: options.name,
      directory: outputDir,
      filePath,
      content,
      template,
    };
  }

  /**
   * AI-assisted skill generation from a natural language description.
   * Parses the prompt, selects the best matching template, customizes it,
   * and writes the SKILL.md to disk.
   */
  async generateFromPrompt(
    naturalLanguage: string,
    overrides?: { author?: string; outputDir?: string }
  ): Promise<GeneratedSkill> {
    const prompt = naturalLanguage.toLowerCase();

    // ── Step 1: Score each template against the prompt ──
    const scores = new Map<string, number>();

    for (const group of KEYWORD_GROUPS) {
      let matchCount = 0;
      for (const keyword of group.keywords) {
        if (prompt.includes(keyword)) {
          matchCount += group.weight;
        }
      }
      if (matchCount > 0) {
        const current = scores.get(group.template) || 0;
        scores.set(group.template, current + matchCount);
      }
    }

    // Find the best-scoring template; default to "blank" if nothing matches
    let bestTemplate = "blank";
    let bestScore = 0;
    for (const [templateId, score] of scores.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestTemplate = templateId;
      }
    }

    // ── Step 2: Extract a skill name from the prompt ──
    const name = this.extractSkillName(naturalLanguage);

    // ── Step 3: Extract custom triggers from the prompt ──
    const customTriggers = this.extractTriggers(naturalLanguage);

    // ── Step 4: Build the description ──
    const description = naturalLanguage.length > 200
      ? naturalLanguage.slice(0, 197) + "..."
      : naturalLanguage;

    // ── Step 5: Generate the skill ──
    const options: GenerateOptions = {
      name,
      description,
      author: overrides?.author || "AstraOS AI Generator",
      triggers: customTriggers.length > 0 ? customTriggers : undefined,
      outputDir: overrides?.outputDir,
    };

    const result = await this.generate(bestTemplate, options);

    logger.info(
      `[AstraOS] SkillGenerator: AI-generated skill "${name}" using template "${bestTemplate}" (score: ${bestScore})`
    );

    return result;
  }

  /**
   * Validate a generated skill directory.
   * Checks that SKILL.md exists, parses correctly, and has required fields.
   */
  async validateGenerated(skillDir: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check directory exists
    try {
      const stat = await fs.stat(skillDir);
      if (!stat.isDirectory()) {
        errors.push(`"${skillDir}" is not a directory.`);
        return { valid: false, errors, warnings };
      }
    } catch {
      errors.push(`Directory "${skillDir}" does not exist.`);
      return { valid: false, errors, warnings };
    }

    // Check SKILL.md exists
    const skillMdPath = path.join(skillDir, "SKILL.md");
    let content: string;
    try {
      content = await fs.readFile(skillMdPath, "utf-8");
    } catch {
      errors.push(`SKILL.md not found in "${skillDir}".`);
      return { valid: false, errors, warnings };
    }

    // Check frontmatter delimiters
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      errors.push("SKILL.md is missing YAML frontmatter (must start and end with ---).");
      return { valid: false, errors, warnings };
    }

    const yamlSection = frontmatterMatch[1];
    const bodySection = frontmatterMatch[2].trim();

    // Check required fields
    const requiredFields = ["name", "version", "description", "author"];
    for (const field of requiredFields) {
      const regex = new RegExp(`^${field}:`, "m");
      if (!regex.test(yamlSection)) {
        errors.push(`Missing required frontmatter field: "${field}".`);
      }
    }

    // Check triggers
    if (!/^triggers:/m.test(yamlSection)) {
      warnings.push("No triggers defined. The skill won't be activated by any messages.");
    }

    // Check system prompt body
    if (bodySection.length < 20) {
      warnings.push("System prompt is very short. Consider adding detailed instructions for better skill behavior.");
    }

    // Check for empty triggers
    const triggersMatch = yamlSection.match(/triggers:\n((?:\s+-\s+.*\n)*)/);
    if (triggersMatch) {
      const triggers = triggersMatch[1].trim();
      if (triggers.length === 0) {
        warnings.push("Triggers section is empty. Add at least one trigger keyword.");
      }
    }

    // Check version format
    const versionMatch = yamlSection.match(/version:\s*(.+)/);
    if (versionMatch) {
      const version = versionMatch[1].trim();
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        warnings.push(`Version "${version}" does not follow semver format (x.y.z).`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get an Express router with skill generation API endpoints.
   */
  getRouter(): Router {
    const router = Router();

    // GET /api/skills/templates — list all templates
    router.get("/templates", (_req: Request, res: Response) => {
      try {
        const templates = this.listTemplates();
        res.json({
          count: templates.length,
          templates,
        });
      } catch (err) {
        logger.error(`[AstraOS] SkillGenerator API error: ${(err as Error).message}`);
        res.status(500).json({ error: "Failed to list templates" });
      }
    });

    // GET /api/skills/templates/:name — get template details
    router.get("/templates/:name", (req: Request, res: Response) => {
      try {
        const { name } = req.params;
        const template = this.getTemplate(name);

        if (!template) {
          res.status(404).json({
            error: `Template "${name}" not found`,
            available: Object.keys(TEMPLATES),
          });
          return;
        }

        res.json({
          id: name,
          ...template,
        });
      } catch (err) {
        logger.error(`[AstraOS] SkillGenerator API error: ${(err as Error).message}`);
        res.status(500).json({ error: "Failed to get template" });
      }
    });

    // POST /api/skills/generate — generate from template
    router.post("/generate", async (req: Request, res: Response) => {
      try {
        const { template, name, description, author, version, triggers, tags } = req.body;

        if (!template) {
          res.status(400).json({ error: "Missing required field: template" });
          return;
        }
        if (!name) {
          res.status(400).json({ error: "Missing required field: name" });
          return;
        }

        const result = await this.generate(template, {
          name,
          description,
          author,
          version,
          triggers,
          tags,
        });

        res.status(201).json({
          message: `Skill "${name}" generated successfully`,
          skill: {
            name: result.name,
            directory: result.directory,
            filePath: result.filePath,
            template: result.template,
          },
          content: result.content,
        });
      } catch (err) {
        const message = (err as Error).message;
        logger.error(`[AstraOS] SkillGenerator API error: ${message}`);

        if (message.includes("Unknown template")) {
          res.status(400).json({ error: message });
        } else {
          res.status(500).json({ error: "Failed to generate skill" });
        }
      }
    });

    // POST /api/skills/generate/ai — AI-assisted generation
    router.post("/generate/ai", async (req: Request, res: Response) => {
      try {
        const { prompt, author } = req.body;

        if (!prompt) {
          res.status(400).json({ error: "Missing required field: prompt" });
          return;
        }

        if (typeof prompt !== "string" || prompt.trim().length < 5) {
          res.status(400).json({
            error: "Prompt must be a string with at least 5 characters describing the skill you want.",
          });
          return;
        }

        const result = await this.generateFromPrompt(prompt, { author });

        res.status(201).json({
          message: `Skill "${result.name}" generated from AI prompt`,
          skill: {
            name: result.name,
            directory: result.directory,
            filePath: result.filePath,
            template: result.template,
          },
          content: result.content,
        });
      } catch (err) {
        logger.error(`[AstraOS] SkillGenerator AI API error: ${(err as Error).message}`);
        res.status(500).json({ error: "Failed to generate skill from prompt" });
      }
    });

    // POST /api/skills/validate — validate a generated skill
    router.post("/validate", async (req: Request, res: Response) => {
      try {
        const { directory } = req.body;

        if (!directory) {
          res.status(400).json({ error: "Missing required field: directory" });
          return;
        }

        const result = await this.validateGenerated(directory);
        res.json(result);
      } catch (err) {
        logger.error(`[AstraOS] SkillGenerator validate API error: ${(err as Error).message}`);
        res.status(500).json({ error: "Failed to validate skill" });
      }
    });

    return router;
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Extract a reasonable skill name from a natural language prompt.
   * Falls back to a sanitized version of the first ~40 characters.
   */
  private extractSkillName(prompt: string): string {
    // Try to find explicit naming patterns
    const namePatterns = [
      /(?:called?|named?)\s+["']([^"']+)["']/i,
      /(?:called?|named?)\s+(\S+(?:\s+\S+){0,3})/i,
      /(?:create|build|make)\s+(?:a\s+)?["']([^"']+)["']/i,
      /(?:create|build|make)\s+(?:a\s+)?(\S+(?:\s+\S+){0,2})\s+(?:skill|bot|assistant|tool)/i,
    ];

    for (const pattern of namePatterns) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (extracted.length > 2 && extracted.length < 60) {
          return this.titleCase(extracted);
        }
      }
    }

    // Fallback: use the first meaningful chunk of the prompt
    const cleaned = prompt
      .replace(/^(I want|I need|please|can you|create|build|make)\s+(a\s+|an\s+|me\s+)?/i, "")
      .replace(/\s+skill\s*$/i, "")
      .trim();

    const words = cleaned.split(/\s+/).slice(0, 4).join(" ");
    const name = words.length > 3 ? words : "Custom Skill";

    return this.titleCase(name);
  }

  /**
   * Extract potential trigger keywords from a natural language prompt.
   */
  private extractTriggers(prompt: string): string[] {
    const triggers: string[] = [];
    const lower = prompt.toLowerCase();

    // Look for explicit trigger mentions
    const triggerMatch = prompt.match(/triggers?\s*(?::|are|include|like)\s*(.+?)(?:\.|$)/i);
    if (triggerMatch) {
      const parts = triggerMatch[1].split(/[,;]+/).map((t) => t.trim().replace(/^["']|["']$/g, ""));
      for (const part of parts) {
        if (part.length > 1 && part.length < 50) {
          triggers.push(part.toLowerCase());
        }
      }
    }

    // Look for "when I say/type" patterns
    const whenMatch = prompt.match(/when\s+(?:I|user|someone)\s+(?:say|type|write|ask)s?\s+["']([^"']+)["']/gi);
    if (whenMatch) {
      for (const m of whenMatch) {
        const inner = m.match(/["']([^"']+)["']/);
        if (inner) {
          triggers.push(inner[1].toLowerCase());
        }
      }
    }

    // Extract action verbs as potential triggers
    const actionVerbs = lower.match(
      /\b(track|monitor|analyze|send|create|review|translate|summarize|scrape|notify|check|search|query|fetch|schedule|manage|control)\b/g
    );
    if (actionVerbs && triggers.length === 0) {
      const uniqueVerbs = [...new Set(actionVerbs)];
      for (const verb of uniqueVerbs.slice(0, 5)) {
        triggers.push(verb);
      }
    }

    return triggers;
  }

  /**
   * Convert a string to Title Case.
   */
  private titleCase(str: string): string {
    return str.replace(
      /\w\S*/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );
  }
}
