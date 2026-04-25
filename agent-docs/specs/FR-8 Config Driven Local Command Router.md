# FR-8 Development Spec: Config-Driven Local Command Router

## Background

The local command router (`src/transport/local-command-router.ts`) currently has 5 hardcoded commands (capture, move, done, status, process-inbox) matched by compiled regex patterns in the OAC chat input. FR-8 adds a second, complementary surface: **Obsidian command palette entries** loaded dynamically from a `commands.json` config file, with no rebuild required to add new commands.

> **Feedback:** The goal is to provide the ability to trigger deterministic commands from the OAC interface without having to go through the gateway → LLM → OAC pathway. Initial use cases:
> - `move` — moves the line under the cursor to the `## Inbox` section of the target note
> - `done` `<note reference>` (or auto-mentioned note) — updates the note's `TaskNote` frontmatter property to `done`

The Obsidian command palette is the right home for these because both operate on **editor context** (cursor position, active file, frontmatter) that is available natively via Obsidian's `editorCallback` API — no text argument needed from the user. The chat input command router is unchanged and continues to serve text-based commands.

---

## Design Decisions

### Where does config live?

`commands.json` stored in the plugin data directory (`.obsidian/plugins/agent-client/commands.json`), read at plugin load via `app.vault.adapter`. The Settings tab exposes a JSON textarea to edit it. Reload plugin (or press "Apply") to register updated commands.

> **Feedback:** Agree — use filename `commands.json`.

### Why Obsidian command palette instead of a `%%` chat picker?

| | Command palette | `%%` chat picker |
|---|---|---|
| Cursor-aware ops | ✓ `editorCallback` gives editor + file | ✗ chat panel has no editor cursor |
| Frontmatter access | ✓ active file is in context | ✗ would need to specify file explicitly |
| Hotkey support | ✓ free from Obsidian | ✗ would need to build |
| Dynamic registration from config | ✓ OAC already does this for agents | ✓ but more UI to build |
| Script support (future) | ✓ `callback` can run anything | ✓ but sandboxing needed |
| Build cost | Low — follows existing pattern | Medium — new UI component |

OAC already dynamically registers commands from config in `registerAgentCommands()` — FR-8 follows the exact same pattern. TaskNotes confirms that `editorCallback`, `getCursor`, `getLine`, and `processFrontMatter` are the right Obsidian APIs for the target use cases.

### What action types are supported?

Four action types cover the initial use cases and likely near-term needs:

- **`append`** — append a templated line to a vault file (generalises `capture`)
- **`move-line`** — move the line under the editor cursor to a target file, optionally under a named heading
- **`frontmatter`** — set a frontmatter field on the active or auto-mentioned note
- **`response`** — inject markdown text into the OAC chat panel without triggering an LLM call

Template strings support substitution tokens: `{cursor-line}` (current editor line), `{active-file}` (current file name without extension), `{active-file-path}` (full vault path).

> **Feedback:** As long as the actions support the above example use cases, this is fine. Python/JS script support is deferred to a follow-on FR once there is more working experience with Polaris and Obsidian to know if it's needed.

### Schema

```typescript
interface CustomCommandDef {
  id: string;           // unique slug — used as Obsidian command ID suffix
  name: string;         // display name in command palette (e.g. "Move line to inbox")
  description?: string; // optional 3-5 word hint shown in palette
  action: "append" | "move-line" | "frontmatter" | "response";
  params: AppendParams | MoveLineParams | FrontmatterParams | ResponseParams;
}

interface AppendParams {
  file: string;              // vault-relative path
  template: string;          // supports {cursor-line}, {active-file}, {active-file-path}
  section?: string;          // heading to append under (e.g. "## Inbox")
  createIfMissing?: boolean; // default: true
}

interface MoveLineParams {
  targetFile: string;        // vault-relative path
  targetSection?: string;    // heading to insert under (e.g. "## Inbox")
  createIfMissing?: boolean; // default: true
}

interface FrontmatterParams {
  field: string;                       // frontmatter key
  value: string;                       // value to set
  target: "active" | "auto-mention";  // which file to update; falls back to active if no mention
}

interface ResponseParams {
  template: string;          // markdown text injected into OAC chat; no LLM call made
}
```

### Example `commands.json` covering the initial use cases

```json
[
  {
    "id": "move-line-to-inbox",
    "name": "Move line to inbox",
    "description": "Move cursor line to Inbox",
    "action": "move-line",
    "params": {
      "targetFile": "Inbox.md",
      "targetSection": "## Inbox",
      "createIfMissing": true
    }
  },
  {
    "id": "done-active-note",
    "name": "Mark note as done",
    "description": "Set TaskNote status done",
    "action": "frontmatter",
    "params": {
      "field": "TaskNote",
      "value": "done",
      "target": "active"
    }
  }
]
```

---

## Injecting Markdown into the OAC Chat Window

> **Feedback:** Can we inject markdown text into the OAC chat window from a command without triggering an LLM call? E.g. `list agent-client commands` injects the full list of available commands without going through Hermes.

**Yes — this is already how local commands work**, and FR-8 formalises it as the `response` action type.

### How it works

The existing local command router returns a plain string from `executeLocalCommand`. `useChatActions` catches that return value and calls `addMessage({ role: "assistant", content: result })` — no Hermes call, no LLM involved. The string is rendered as markdown in the chat panel.

For command palette commands (which run outside the chat input flow), the same result is achieved via a workspace event. The plugin fires:

```typescript
this.app.workspace.trigger(
  "agent-client:inject-message" as "quit",
  this.lastActiveChatViewId,
  markdownText,
);
```

The active chat view handles that event by calling `addMessage`. This is the same pattern OAC already uses for `approve-active-permission`, `cancel-message`, and other plugin→view communication.

### Built-in `list commands` command

FR-8 includes one built-in command registered unconditionally (not from `commands.json`) that demonstrates and validates the injection mechanism:

**`Agent Client: List local commands`** — fires from the command palette, injects a markdown table of all currently registered custom commands (id, name, action, key params) into the active OAC chat panel. No LLM call. Useful for discoverability and confirming that `commands.json` was loaded correctly.

Example output injected into chat:

```markdown
**Local commands** (Agent Client: List local commands to refresh)

| Command | Action | Key param |
|---|---|---|
| Move line to inbox | move-line | → Inbox.md ## Inbox |
| Mark note as done | frontmatter | TaskNote = done |
```

### Using `response` in `commands.json`

Any custom command can inject markdown by using `action: "response"`:

```json
{
  "id": "show-help",
  "name": "Show Polaris help",
  "description": "Inject help text into chat",
  "action": "response",
  "params": {
    "template": "## Polaris commands\n- **Move line to inbox** — place cursor on a line, run from palette\n- **Mark note as done** — sets TaskNote frontmatter on active note"
  }
}
```

Tokens `{active-file}` and `{active-file-path}` are substituted at runtime, so the injected text can reference the current note context.

---

## Scope

### Files changed

| File | Change |
|---|---|
| `src/plugin.ts` | Add `loadCustomCommands()` to read `commands.json`; add `registerCustomCommands()` called from `onload`; add built-in `list commands` command; handle `agent-client:inject-message` workspace event |
| `src/transport/local-command-router.ts` | Export `CustomCommandDef` and param types; add `executeCustomCommand(def, editor?, file?, vault?)` handling all four action types |
| `src/ui/SettingsTab.ts` | Add "Custom commands (JSON)" textarea under Hermes section; validate JSON on change; save to `commands.json` on valid input; show inline error on invalid JSON |

**Not changed:** `useChatActions.ts`, `HermesApiTransport`, `useAgentMessages`, chat input command router (built-in commands are a separate surface and remain unchanged).

---

## Registration Pattern

Follows the existing `registerAgentCommands()` pattern in `plugin.ts`:

```typescript
private async registerCustomCommands(): Promise<void> {
  const defs = await this.loadCustomCommands(); // reads commands.json, skips invalid entries
  for (const def of defs) {
    if (def.action === "move-line" || def.action === "frontmatter" || def.action === "append") {
      this.addCommand({
        id: `custom-${def.id}`,
        name: def.name,
        editorCallback: (editor, ctx) => {
          void executeCustomCommand(def, editor, ctx.file ?? undefined, this.app.vault);
        },
      });
    } else {
      // response action — no editor context needed
      this.addCommand({
        id: `custom-${def.id}`,
        name: def.name,
        callback: () => {
          void executeCustomCommand(def, undefined, undefined, this.app.vault);
        },
      });
    }
  }
}
```

---

## Routing Priority

FR-8 commands live in the **Obsidian command palette** — a completely separate surface from the chat input router. There is no routing conflict. Built-in chat commands (capture, move, done, status, process-inbox) are unchanged.

---

## Error Handling / Graceful Degradation

- `commands.json` missing → skip silently, no built-in commands affected
- Invalid JSON → log warning, skip file, no commands registered from config
- Individual entry with invalid `action` or missing required param → skip that entry, log warning, continue with rest
- `move-line` with no active editor → Obsidian won't show `editorCallback` commands when no editor is open (handled by the platform)
- `frontmatter` with `target: "auto-mention"` and no mentioned note → falls back to active file
- All failures are local — no impact on Hermes transport path

---

## Settings UI

Textarea in the Settings tab labeled **"Custom commands (JSON)"**, under the Hermes API section. Shows current `commands.json` content. Validates on change — inline error if JSON is invalid, saves to file if valid. Note beneath: "Reload the plugin or press Apply to register updated commands."

---

## Obsidian API Reference for Future Commands

> **Feedback:** List available Obsidian plugin API commands for use in future command implementations.

### Editor API (available via `editorCallback`)

| API | What it does |
|---|---|
| `editor.getCursor()` | Cursor position `{line, ch}` |
| `editor.getLine(n)` | Content of line n |
| `editor.setLine(n, text)` | Replace entire line n |
| `editor.getSelection()` | Currently selected text |
| `editor.replaceSelection(text)` | Replace selection with text |
| `editor.replaceRange(text, from, to)` | Replace arbitrary range |
| `editor.lineCount()` | Total line count |
| `editor.getValue()` | Entire document content |
| `editor.setValue(text)` | Replace entire document |

### Vault API (via `this.app.vault`)

| API | What it does |
|---|---|
| `vault.read(file)` | Read file content as string |
| `vault.modify(file, content)` | Overwrite file content |
| `vault.append(file, content)` | Append to file |
| `vault.create(path, content)` | Create new file |
| `vault.rename(file, newPath)` | Move or rename file |
| `vault.delete(file)` | Delete file |
| `vault.getMarkdownFiles()` | All markdown files in vault |
| `vault.getAbstractFileByPath(path)` | Get `TFile` by vault-relative path |
| `vault.adapter.read/write/exists` | Lower-level file ops (used for `commands.json` itself) |

### Metadata & Frontmatter API (via `this.app`)

| API | What it does |
|---|---|
| `app.fileManager.processFrontMatter(file, fn)` | Safe atomic read/write of frontmatter — TaskNotes uses this 19× |
| `app.metadataCache.getFileCache(file)` | Parsed cache: frontmatter, headings, links, tags, blocks |
| `app.metadataCache.getFirstLinkpathDest(link, source)` | Resolve `[[wikilinks]]` to `TFile` |
| `app.metadataCache.on("changed", handler)` | React to file metadata updates |

The `metadataCache` is particularly powerful for future "query vault" commands — e.g. find all files where `TaskNote: active`, list all files with a given tag — without any LLM involvement.

### Workspace API (via `this.app.workspace`)

| API | What it does |
|---|---|
| `workspace.getActiveFile()` | Currently focused file |
| `workspace.getActiveViewOfType(View)` | Active view of a given type |
| `workspace.trigger(event, ...args)` | Fire events to views — how OAC injects messages into the chat panel |
| `workspace.on(event, handler)` | Subscribe to workspace events |

### Notifications

| API | What it does |
|---|---|
| `new Notice(text, duration?)` | Toast notification — useful for silent commands that don't need chat output |

---

## What This Does NOT Include

- Python or JavaScript script execution (deferred — not enough working experience with Polaris/Obsidian yet to know if needed)
- `%%` type-ahead picker in the OAC chat panel (command palette + hotkeys serve the initial use cases better)
- Live file-watching for `commands.json` (reload plugin to pick up changes — can be added later)
- Replacing or modifying the existing chat input command router

---

## Acceptance Criteria Mapping

| Criterion | How it's met |
|---|---|
| Config file defines custom commands with pattern, action type, params | `commands.json` loaded at plugin init; four action types cover initial use cases |
| Custom commands execute without LLM roundtrip | `editorCallback`/`callback` runs local vault ops; Hermes is never called |
| Built-in commands remain as defaults and can be overridden | Chat input router unchanged; command palette is an additive surface |
| Invalid/missing config degrades gracefully to built-in defaults | Missing file and invalid entries skipped with warnings |
| Markdown can be injected into OAC chat without LLM call | `response` action + `agent-client:inject-message` workspace event; built-in `list commands` command validates the mechanism |

---

## Gates

- `npm run build`
- `npm run test:gateway-smoke`
- `npm run test:ui-smoke:wsl-win`
