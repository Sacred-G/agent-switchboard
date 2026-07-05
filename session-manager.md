Session Manager — Product Requirements Document (PRD / Markdown)


Goal: Provide visual management of local session records from Codex / Claude Code, plus "one-click copy / one-click terminal resume" capabilities.
Scope: v1 is macOS only, but the architecture must leave room for multi-platform expansion.




1. Background & Problem

When developers use Codex CLI and Claude Code simultaneously, common pain points include:


Session records are scattered across different local locations, making them hard to discover/search
Once a session is found, the resume command must be remembered or dug out of history — high resume cost
The working directory at the time is often forgotten when resuming, causing commands to run in the wrong directory
Users want to resume directly in their preferred terminal (macOS Terminal, kitty, etc.) for greater efficiency



2. Goals & Non-Goals

2.1 Goals (must-have for v1)


Scan and display all Codex / Claude Code sessions on the machine: list + detail (session content)
Support resuming sessions:

Copy resume command (button)
Copy session directory (button, if it can be obtained/inferred)
Optional: execute the resume directly in the terminal (macOS Terminal, kitty; extensible)



macOS-only support, but the code structure must support future Windows/Linux expansion


2.2 Non-Goals (out of scope for v1)


No new/dependent cloud APIs; by default nothing is uploaded
No commitment to parse every internal format of every provider (aim for compatibility, make it configurable, allow graceful degradation)
No complex team collaboration/sharing/sync (to be considered in later versions)



3. User Personas & Use Scenarios

3.1 Typical Users


Engineers / tech leads / PMs who frequently use multiple AI coding tools
Working across many projects and branches in parallel, frequently "interrupt — resume — keep going"


3.2 Core Scenarios (Top)


Recover a session: I remember a session discussed a certain piece of logic → search by keyword → open the detail
Quick resume: I want to continue yesterday's session → copy the resume command / one-click resume in terminal
Return to the right directory: before resuming, copy the directory first or automatically cd into it



4. Product Form & Information Architecture

4.1 Information Architecture


Session Manager

Session List (List)
Session Detail (Detail)
Settings

Provider configuration (paths / enable-disable)
Terminal integration (default terminal, permission prompts, degradation strategy)
Indexing & privacy options (whether to cache, cache size, sensitive-info masking)









5. Functional Requirements

5.1 Discovery & Indexing

FR-1 Scan local session data sources and generate a unified Session list


Supported providers: Codex, Claude Code (extensible)
Support full scan + incremental update
Tolerate missing/corrupt files (do not interrupt the UI)


FR-2 Local index (Cache/DB)


Used to speed up list loading and search
Index fields should include at minimum: sessionId, provider, lastActiveAt, projectDir (nullable), summary (nullable), filePath (nullable)


FR-3 Data-source path detection (configurable + multiple candidates)


Use common paths by default; allow the user to override in Settings
If a provider's installation/data directory cannot be detected: show a not-enabled/unavailable state in the UI, but do not error out or crash



5.2 Session List (List)

FR-4 List display fields (suggested minimum set)


Provider (Codex / Claude)
Session identifier (id / short id)
Last active time (lastActiveAt)
Directory (projectDir; show "Unknown" if not known)
Summary (summary: truncated last/first message, or rule-generated)


FR-5 List interactions


Search (across sessions, keyword match on transcript / summary / directory)
Filter: provider, has-directory-or-not, time range
Sort: most recently active (default), oldest, by directory


FR-6 Empty / error states


No sessions found: provide guidance on "how to enable / set paths"
Sessions found but content cannot be parsed: the list still shows basic info, and the detail page indicates "parse failed"



5.3 Session Detail (Detail)

FR-7 Session content display


Timeline view of messages (role: user / assistant / tool, etc.)
Support in-session search + highlighting
Display metadata:

provider, sessionId, created / last-active time
projectDir (nullable)
original file path (optional display, useful for debugging)





FR-8 Performance strategy


Load on demand by default (load full text only when the detail is opened)
Support pagination / virtualized lists for very long transcripts (prevent lag)



5.4 Resume / Restore

5.4.1 Copy Resume Command (must-have)

FR-9 "Copy resume command" button


Generate the resume command based on the provider (template configurable)
On click, write to clipboard and show a success toast



Note: Resume commands may differ slightly across CLI versions. It is recommended to make the command template a configurable item (Settings), with a recommended template provided by default.



5.4.2 Copy Session Directory (do if possible)

FR-10 "Copy session directory" button


Enabled when projectDir is available; greyed out when unavailable, with a reason shown (cannot infer directory)
The copied content is an absolute path that can be cd-ed into directly (or as-is)


5.4.3 One-Click Terminal Resume (optional but strongly recommended)

FR-11 "Resume in terminal" button (or dropdown menu)


Default target: macOS Terminal
Support kitty (required for v1)
Execution strategy:

cd "<projectDir>" && <resumeCommand> (if projectDir is empty, run only resumeCommand)



Failure degradation:

No permission / terminal unavailable → automatically degrade to "copy command only," and tell the user how to fix it (e.g., enable Automation permission, kitty remote control)





FR-12 Terminal target selection & memory


Dropdown selection: Terminal / kitty / (reserved: iTerm2) / copy only
Remember the last selection as the default



6. Platform & Extensibility Design (macOS v1 + future-proof)

6.1 Provider Adapter abstraction (required)

Unified interface (example):


detect(): boolean
scanSessions(): SessionMeta[]
loadTranscript(sessionId): Message[]
getResumeCommand(sessionId): string
getProjectDir(sessionId): string | null


6.2 Terminal Launcher abstraction (required)


launch(command: string, cwd?: string, targetTerminal: TerminalKind): Result
macOS v1 implementation: TerminalLauncherMac
Future: TerminalLauncherWindows / TerminalLauncherLinux


6.3 Path Resolver (required)


resolveProviderDataPaths(providerId): string[]
v1 returns macOS default candidates; allow Settings to override



7. Privacy & Security

Default principle: fully local, read-only, no uploads.


Transcripts do not leave the network by default
The local index stores only the necessary fields by default (optional: whether to cache full-text content)
Provide "sensitive-info masking" (optional):

Simple regex: token / key / password, etc.



Warn the user: session content may contain sensitive information; be careful when exporting/copying



8. Non-Functional Requirements

8.1 Performance


First open: the list should appear within 1s (allowed to show cache first, then refresh incrementally in the background)
Search: usable at the 1k-session scale (build an index or incremental cache)
Detail page: render a skeleton screen within 300ms of opening; content loads streamed / in segments


8.2 Stability


Corruption of any single provider's data source must not affect the whole (isolate failures)
The scan process can be interrupted / retried


8.3 Observability (optional)


Local logs: scan duration, parse-failure reasons, terminal-launch-failure reasons (for debugging)



9. Key Data Structures (suggested)

9.1 SessionMeta


providerId: "codex" | "claude" | string
sessionId: string
title?: string
summary?: string
projectDir?: string | null
createdAt?: number
lastActiveAt?: number
sourcePath?: string


9.2 Message


role: "user" | "assistant" | "tool" | "system" | string
content: string
ts?: number
raw?: any (preserve original fields for future-format compatibility)



10. Interaction Flows (UX Flows)

10.1 Flow A: Search and View


Open Session Manager → see the list
Type a keyword to search → matching session appears
Click the session → enter detail → browse content / search within the session


10.2 Flow B: Copy Resume Command


Click "Copy resume command" in the list or detail page
Success toast → user pastes into terminal and runs it


10.3 Flow C: One-Click Terminal Resume


Click "Resume in terminal" on the detail page (default Terminal)
The system opens a new terminal window/tab
Auto-executes: cd projectDir && resumeCommand
On failure → toast prompt, with a "copy command" degradation path provided



11. Edge Cases & Degradation Strategy


Cannot obtain projectDir: resume still works (run resume only); the directory button is greyed out
Cannot parse transcript: the list still displays it, the detail indicates "cannot parse," and can offer "open original file path"
CLI command template doesn't match: allow a custom template in Settings; the default template can be updated
Terminal permission issue (Automation): prompt the user to enable the corresponding permission in System Settings, and allow degradation to copying the command
kitty remote control not enabled: explain how to configure it, degrade to copying the command



12. Milestones & Delivery (suggested)

M1 (core usable)


Provider scanning: Codex / Claude
List + detail (readable)
Copy resume command
Copy directory (if available)


M2 (efficiency gains)


Cross-session search, filter/sort
Incremental indexing and file watching (optional)
"Resume in macOS Terminal"


M3 (terminal coverage & extensibility)


"Resume in kitty"
Terminal-target dropdown with memory
Pluggable interface / extension-point documentation



13. Future Feature Candidates (Backlog / Ideas)


Favorite / pin sessions
Session tags (project / theme / status)
Session summary (locally generated)
Fork a session to continue (avoid polluting the original session)
Export to Markdown / JSONL
Aggregate by project (Repo view)
Session cleanup / archiving (disk management)