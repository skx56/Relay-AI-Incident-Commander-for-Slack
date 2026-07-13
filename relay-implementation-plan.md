# Relay — Slack-Native Project Control Tower
### Implementation Plan for Slack Agent Builder Challenge (2026)

**Track:** New Slack Agent (primary) / Slack Agent for Organizations (stretch, if you reach 5 workspace installs + Marketplace submission)
**Required tech used:** MCP server integration, Real-Time Search (RTS) API, Slack AI
**Timeline:** 11 days
**Purpose of this document:** Hand this directly to Antigravity as the task brief. It's structured so an agent can work through it section by section, generating an Implementation Plan and Task Plan artifact from it.

---

## 1. One-line pitch

`@Relay` is a Slack agent that stands up a new project inside Slack: it pulls relevant history for context, breaks a kickoff brief into real tasks routed to an external tool via MCP, and posts a living status digest back to the channel — a small, real multi-agent orchestrator, not a single-turn bot.

---

## 2. System architecture

```
                         ┌─────────────────────────┐
        Slack message ─▶│   Orchestrator Agent     │  (primary Slack app / bot)
        "@Relay start   │   - parses intent        │
         project X"     │   - dispatches to sub-   │
                         │     agents in sequence   │
                         └────────────┬─────────────┘
                                      │
             ┌────────────────────────┼─────────────────────────┐
             ▼                        ▼                          ▼
  ┌─────────────────────┐  ┌──────────────────────┐  ┌───────────────────────┐
  │  Context Agent       │  │  Router Agent         │  │  Digest Agent          │
  │  - RTS API search    │  │  - LLM task breakdown │  │  - polls MCP tool      │
  │  - summarizes past   │  │  - MCP: create tasks  │  │  - Slack AI summarize  │
  │    related threads   │  │    in external tool   │  │  - posts Block Kit     │
  └─────────────────────┘  └──────────────────────┘  └───────────────────────┘
                                      │                          ▲
                                      ▼                          │
                         ┌─────────────────────────┐            │
                         │  External MCP Server      │───────────┘
                         │  (task/calendar tool)     │
                         └─────────────────────────┘
```

**Design principle:** every arrow in this diagram must correspond to a real API call in the demo. Do not build a fourth "agent" unless it does something the other three can't — judges reward depth over headcount.

---

## 3. Tech stack decisions (lock these on Day 1)

| Decision | Recommendation | Why |
|---|---|---|
| External MCP-connected tool | **Google Calendar** or **Linear** (pick whichever you can get API/OAuth access to fastest — Calendar is usually faster to provision) | Needs to be something with a clean, well-documented MCP server or one you can wrap in a thin MCP shim |
| LLM for task decomposition | Claude via Anthropic API | Structured JSON output, good at following schemas |
| Slack framework | Slack Agent Builder + Bolt SDK | Matches hackathon's intended on-ramp |
| Hosting | Any always-on box (Render/Fly.io free tier, or a VM) — must be reachable for Slack event subscriptions | Dev sandbox alone won't handle scheduled digests reliably |

If you don't have MCP server access to a task tool, build a **minimal custom MCP server** (a small Node/Python service exposing `create_task`, `list_tasks`, `update_task` as MCP tools backed by a simple database). This is actually a strong technical-implementation point to highlight in the demo — you can say you built a real MCP server, not just consumed one.

---

## 4. Data contract (define this before writing any agent code)

This is the single most important artifact — every agent reads/writes it.

```json
{
  "project_id": "string",
  "name": "string",
  "channel_id": "string",
  "kickoff_brief": "string (raw text from user)",
  "context": {
    "related_threads": [
      { "channel": "string", "ts": "string", "summary": "string" }
    ]
  },
  "tasks": [
    {
      "task_id": "string",
      "title": "string",
      "assignee_slack_id": "string | null",
      "external_ref_id": "string (id in MCP-connected tool)",
      "status": "todo | in_progress | done",
      "due_date": "ISO 8601 | null"
    }
  ],
  "last_digest_ts": "string | null"
}
```

Store this per-project (simple key-value or SQLite is fine — don't over-engineer persistence).

---

## 5. Agent prompts

### 5.1 Orchestrator (primary agent, receives the Slack event)

```
You are Relay, an orchestrator agent operating inside Slack. When a user
invokes you with "@Relay initiate project <name>: <brief>", you must:

1. Create a new project record.
2. Call the Context Agent with the brief and channel_id to retrieve related history.
3. Call the Router Agent with the enriched brief to produce a task list and
   create those tasks in the connected external tool via MCP.
4. Post a confirmation message in the channel summarizing what was created,
   using Block Kit (not plain text).
5. Schedule/enable the Digest Agent for this project.

Never fabricate task creation confirmations — only report success after the
MCP tool call returns a real ID. If any step fails, report exactly which step
failed and do not proceed to the next step.
```

### 5.2 Context Agent

```
You are the Context Agent. Given a project brief and a Slack channel_id,
use the Real-Time Search API to find related discussions across accessible
channels (e.g. prior projects with similar names/topics, past vendor or
budget discussions referenced in the brief).

Return a JSON array of { channel, ts, summary } for the top 5 most relevant
results. Summaries must be 1-2 sentences, grounded only in the retrieved
text — do not infer facts not present in the search results.
```

### 5.3 Router Agent

```
You are the Router Agent. Given an enriched project brief (original brief +
context summaries), decompose it into a task list.

Output strictly the JSON schema below, nothing else:
[{ "title": string, "suggested_assignee": string | null, "due_date": string | null }]

Rules:
- 3-8 tasks. Do not over-fragment.
- Titles must be concrete and actionable ("Draft sponsor outreach email"
  not "Handle sponsors").
- After generating the list, call the MCP tool `create_task` once per task
  and attach the returned external_ref_id to each task record.
```

### 5.4 Digest Agent

```
You are the Digest Agent. On trigger (manual command or schedule), call the
MCP tool `list_tasks` for the project's external_ref_ids, then use Slack AI
to summarize current status into a short, skimmable digest.

Output Block Kit JSON: a header, one section per task showing title, status
emoji, and assignee, and a context block with the timestamp of the digest.
Do not editorialize beyond the retrieved status values.
```

---

## 6. Day-by-day execution plan

| Day | Deliverable |
|---|---|
| 1 | Track locked. Slack app created via `slack create agent`. Sandbox workspace live. MCP tool access provisioned (or shim scaffolded). RTS API credentials confirmed working with a test query. |
| 2 | Data contract finalized (Section 4). Orchestrator skeleton receives `@Relay` mentions and logs parsed intent. |
| 3-4 | Router Agent built end-to-end: brief → task JSON → real `create_task` MCP calls succeed against the connected tool. Test with 3 different sample briefs. |
| 5 | Context Agent built: RTS query → top-5 relevant threads → summarized. Wire into Orchestrator before Router call. |
| 6-7 | Digest Agent built: `list_tasks` → Slack AI summary → Block Kit post. Add a manual `@Relay digest` trigger first; add scheduling only if time allows. |
| 8 | Full integration test: single `@Relay initiate project X: <brief>` message produces context retrieval → task creation → confirmation → at least one successful digest cycle, no manual intervention. |
| 9 | Architecture diagram finalized (use the Section 2 diagram as the base, tidy it up). Error handling pass — every MCP/RTS call wrapped, failures surfaced clearly in Slack rather than silent. |
| 10 | Record 3-minute demo video: live kickoff message → visible task creation in the external tool (screen-recorded side by side) → digest posting live in Slack. Write submission text mapped to judging criteria (technological implementation, design, impact, idea quality). |
| 11 | Buffer day. Fix whatever broke on Day 10. Confirm sandbox URL access is granted to `slackhack@salesforce.com` and `testing@devpost.com`. |

---

## 7. Submission checklist

- [ ] Project track selected and consistent across all submission fields
- [ ] Text description of features/functionality
- [ ] ~3-minute demo video showing the real working flow (no staged/fake steps)
- [ ] Architecture diagram (Section 2, refined)
- [ ] Slack developer sandbox URL, with access granted to `slackhack@salesforce.com` and `testing@devpost.com`
- [ ] If pursuing Organizations track: Slack App ID, installed in 5+ active workspaces, submitted to Marketplace during the submission window

---

## 8. Guardrails to keep scope from creeping

- Do not add a 4th sub-agent unless the Orchestrator, Context, Router, and Digest agents are already fully working end-to-end.
- Do not attempt multi-tool MCP integrations (e.g., calendar *and* task tracker *and* email) — one external MCP-connected tool is enough to demonstrate the pattern.
- If the scheduled/cron digest proves unreliable by Day 8, fall back to a manual `@Relay digest` command — a working manual trigger beats a flaky automated one in a live demo.
