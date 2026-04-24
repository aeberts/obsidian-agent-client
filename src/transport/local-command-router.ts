/**
 * Local Command Router — FR-3/FR-5
 *
 * Provides a deterministic fast-path for simple task operations that do not
 * require an LLM roundtrip. Commands that are ambiguous or complex are
 * explicitly escalated to the Hermes transport by returning { kind: "escalate" }.
 *
 * Recognized local commands:
 *   capture <text>           — append task to inbox file
 *   move <task> to <dest>    — move task line between notes
 *   done <task>              — mark task as done
 *   status <task> <s>        — set task status (done | todo | in-progress)
 *   process inbox            — process all unchecked tasks in inbox (process-all)
 *   process inbox 1,3,5      — process selected tasks by 1-based index (process-selected)
 *
 * Everything else → { kind: "escalate" }
 */

import { App, TFile, type Editor, type Vault } from "obsidian";

// ============================================================================
// Command Types
// ============================================================================

export interface CaptureCommand {
	type: "capture";
	text: string;
}

export interface MoveCommand {
	type: "move";
	task: string;
	destination: string;
}

export interface StatusCommand {
	type: "status";
	task: string;
	newStatus: "done" | "todo" | "in-progress";
}

export interface BatchInboxCommand {
	type: "batch-inbox";
	policy: "all" | "selected";
	indices?: number[]; // 1-based, only meaningful when policy === "selected"
}

export type ParsedCommand =
	| CaptureCommand
	| MoveCommand
	| StatusCommand
	| BatchInboxCommand;

export type RouteDecision =
	| { kind: "local"; command: ParsedCommand }
	| { kind: "escalate" };

// ============================================================================
// Custom Command Types (FR-8)
// ============================================================================

export interface AppendParams {
	file: string;
	template: string;
	section?: string;
	createIfMissing?: boolean;
}

export interface MoveLineParams {
	targetFile: string;
	targetSection?: string;
	createIfMissing?: boolean;
}

export interface FrontmatterParams {
	field: string;
	value: string;
	target: "active" | "auto-mention";
}

export interface ResponseParams {
	template: string;
}

export interface CustomCommandDef {
	id: string;
	name: string;
	description?: string;
	action: "append" | "move-line" | "frontmatter" | "response";
	params: AppendParams | MoveLineParams | FrontmatterParams | ResponseParams;
}

// ============================================================================
// Patterns
// ============================================================================

const CAPTURE_RE = /^(?:\/capture|capture:?)\s+(.+)/i;
const MOVE_RE = /^(?:\/move|move)\s+(.+?)\s+\bto\b\s+(.+)/i;
const DONE_RE = /^(?:\/done|done)\s+(.+)/i;
const STATUS_RE =
	/^(?:\/task-status|task-status|\/status|status)\s+(.+?)\s+(done|todo|in[\s-]?progress)\s*$/i;
const BATCH_INBOX_RE =
	/^(?:\/process-inbox|process\s+inbox)(?:\s+(all|[\d,\s]+))?$/i;

// ============================================================================
// Router
// ============================================================================

/**
 * Decide whether to execute locally or escalate to Hermes transport.
 *
 * Pure function — no side effects. Returns escalate for anything not
 * matching a known deterministic pattern.
 */
export function routeCommand(input: string): RouteDecision {
	const trimmed = input.trim();

	let m: RegExpMatchArray | null;

	m = trimmed.match(CAPTURE_RE);
	if (m) {
		return {
			kind: "local",
			command: { type: "capture", text: m[1].trim() },
		};
	}

	m = trimmed.match(MOVE_RE);
	if (m) {
		return {
			kind: "local",
			command: {
				type: "move",
				task: m[1].trim(),
				destination: m[2].trim(),
			},
		};
	}

	m = trimmed.match(DONE_RE);
	if (m) {
		return {
			kind: "local",
			command: { type: "status", task: m[1].trim(), newStatus: "done" },
		};
	}

	m = trimmed.match(STATUS_RE);
	if (m) {
		const raw = m[2].toLowerCase().replace(/\s/, "-");
		const newStatus: StatusCommand["newStatus"] =
			raw.startsWith("in") ? "in-progress" : raw === "todo" ? "todo" : "done";
		return {
			kind: "local",
			command: { type: "status", task: m[1].trim(), newStatus },
		};
	}

	m = trimmed.match(BATCH_INBOX_RE);
	if (m) {
		const arg = m[1]?.trim();
		if (!arg || arg.toLowerCase() === "all") {
			return {
				kind: "local",
				command: { type: "batch-inbox", policy: "all" },
			};
		}
		const indices = arg
			.split(/[\s,]+/)
			.map(Number)
			.filter((n) => n > 0 && Number.isInteger(n));
		return {
			kind: "local",
			command: { type: "batch-inbox", policy: "selected", indices },
		};
	}

	return { kind: "escalate" };
}

// ============================================================================
// Executor
// ============================================================================

/**
 * Execute a locally-routed command against the Obsidian vault.
 *
 * @param onProgress - Optional callback for live status updates (batch commands only).
 * @returns Human-readable result string shown as an assistant message.
 */
export async function executeLocalCommand(
	command: ParsedCommand,
	vault: Vault,
	inboxPath = "Inbox.md",
	onProgress?: (msg: string) => void,
): Promise<string> {
	switch (command.type) {
		case "capture":
			return captureTask(command, vault, inboxPath);
		case "move":
			return moveTask(command, vault);
		case "status":
			return updateStatus(command, vault);
		case "batch-inbox":
			return executeBatchInbox(command, vault, inboxPath, onProgress);
	}
}

// ============================================================================
// Vault Operations
// ============================================================================

async function captureTask(
	command: CaptureCommand,
	vault: Vault,
	inboxPath: string,
): Promise<string> {
	const taskLine = `- [ ] ${command.text}`;
	const existing = vault.getAbstractFileByPath(inboxPath);
	if (existing instanceof TFile) {
		await vault.append(existing, `\n${taskLine}`);
	} else {
		await vault.create(inboxPath, `${taskLine}\n`);
	}
	return `Captured to ${inboxPath}: ${command.text}`;
}

async function moveTask(command: MoveCommand, vault: Vault): Promise<string> {
	const files = vault.getMarkdownFiles();
	const needle = command.task.toLowerCase();

	for (const file of files) {
		const content = await vault.read(file);
		const lines = content.split("\n");
		const idx = lines.findIndex(
			(l) => /^- \[.\]/.test(l) && l.toLowerCase().includes(needle),
		);
		if (idx < 0) continue;

		const taskLine = lines[idx];
		const newSource = [
			...lines.slice(0, idx),
			...lines.slice(idx + 1),
		].join("\n");
		await vault.modify(file, newSource);

		const destPath = command.destination.endsWith(".md")
			? command.destination
			: `${command.destination}.md`;
		const destFile = vault.getAbstractFileByPath(destPath);
		if (destFile instanceof TFile) {
			await vault.append(destFile, `\n${taskLine}`);
		} else {
			await vault.create(destPath, `${taskLine}\n`);
		}

		return `Moved task to ${command.destination}`;
	}

	return `Task not found: "${command.task}"`;
}

async function updateStatus(
	command: StatusCommand,
	vault: Vault,
): Promise<string> {
	const files = vault.getMarkdownFiles();
	const needle = command.task.toLowerCase();
	const mark =
		command.newStatus === "done"
			? "x"
			: command.newStatus === "in-progress"
				? "/"
				: " ";

	for (const file of files) {
		const content = await vault.read(file);
		const lines = content.split("\n");
		const idx = lines.findIndex(
			(l) => /^- \[.\]/.test(l) && l.toLowerCase().includes(needle),
		);
		if (idx < 0) continue;

		lines[idx] = lines[idx].replace(/^(- \[).\]/, `$1${mark}]`);
		await vault.modify(file, lines.join("\n"));
		return `Status set to "${command.newStatus}": ${command.task}`;
	}

	return `Task not found: "${command.task}"`;
}

async function executeBatchInbox(
	command: BatchInboxCommand,
	vault: Vault,
	inboxPath: string,
	onProgress?: (msg: string) => void,
): Promise<string> {
	const inboxFile = vault.getAbstractFileByPath(inboxPath);
	if (!(inboxFile instanceof TFile)) {
		return `Inbox not found: ${inboxPath}`;
	}

	const content = await vault.read(inboxFile);
	const lines = content.split("\n");

	// Collect all unchecked task lines with their original indices
	const unchecked = lines
		.map((line, i) => ({ line, i }))
		.filter(({ line }) => /^- \[ \]/.test(line));

	if (unchecked.length === 0) {
		return "Inbox is empty — nothing to process.";
	}

	// Apply policy: all or selected by 1-based index
	const toProcess =
		command.policy === "selected" && command.indices
			? command.indices
					.map((n) => unchecked[n - 1])
					.filter((t): t is (typeof unchecked)[number] => t !== undefined)
			: unchecked;

	if (toProcess.length === 0) {
		return "No matching tasks selected.";
	}

	onProgress?.(`⟳ Processing 0/${toProcess.length} tasks…`);

	const processedSet = new Set(toProcess.map((t) => t.i));
	const archiveLines: string[] = [];

	// Mark done and collect for archive, preserving other lines
	const newLines: string[] = [];
	for (const [i, line] of lines.entries()) {
		if (processedSet.has(i)) {
			archiveLines.push(line.replace(/^(- \[) \]/, "$1x]"));
		} else {
			newLines.push(line);
		}
	}

	await vault.modify(inboxFile, newLines.join("\n"));

	// Append processed tasks to Archive.md
	const archivePath = "Archive.md";
	const archiveFile = vault.getAbstractFileByPath(archivePath);
	if (archiveFile instanceof TFile) {
		await vault.append(archiveFile, `\n${archiveLines.join("\n")}`);
	} else {
		await vault.create(archivePath, `${archiveLines.join("\n")}\n`);
	}

	const n = toProcess.length;
	return `Processed ${n} task${n === 1 ? "" : "s"} — moved to ${archivePath}.`;
}

// ============================================================================
// Custom Command Executor (FR-8)
// ============================================================================

/**
 * Execute a custom command defined in commands.json.
 * Returns a human-readable result string injected into the OAC chat panel.
 */
export async function executeCustomCommand(
	def: CustomCommandDef,
	app: App,
	editor?: Editor,
	file?: TFile,
): Promise<string> {
	switch (def.action) {
		case "response": {
			const p = def.params as ResponseParams;
			return applyTokens(p.template, editor, file);
		}
		case "append": {
			const p = def.params as AppendParams;
			if (!p.file) return "Command misconfigured: missing file param";
			const text = applyTokens(p.template, editor, file);
			await appendToSection(
				app.vault,
				p.file,
				text,
				p.section,
				p.createIfMissing ?? true,
			);
			return `Appended to ${p.file}: ${text}`;
		}
		case "move-line": {
			const p = def.params as MoveLineParams;
			if (!editor) return "No active editor for move-line command";
			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);
			if (!line.trim()) return "Current line is empty — nothing to move";
			// Delete the line (including its trailing newline where possible)
			const lineCount = editor.lineCount();
			const from = { line: cursor.line, ch: 0 };
			const to =
				cursor.line < lineCount - 1
					? { line: cursor.line + 1, ch: 0 }
					: { line: cursor.line, ch: line.length };
			editor.replaceRange("", from, to);
			await appendToSection(
				app.vault,
				p.targetFile,
				line.trim(),
				p.targetSection,
				p.createIfMissing ?? true,
			);
			return `Moved to ${p.targetFile}`;
		}
		case "frontmatter": {
			const p = def.params as FrontmatterParams;
			// Both "active" and "auto-mention" use the active editor file;
			// auto-mention fallback to active file per spec.
			if (!file) return "No active file for frontmatter command";
			await app.fileManager.processFrontMatter(file, (fm) => {
				fm[p.field] = p.value;
			});
			return `Set ${p.field} = ${p.value} on ${file.basename}`;
		}
	}
}

function applyTokens(template: string, editor?: Editor, file?: TFile): string {
	let result = template;
	const cursorLine = editor
		? editor.getLine(editor.getCursor().line)
		: "";
	result = result.replace(/\{cursor-line\}/g, cursorLine);
	result = result.replace(/\{active-file\}/g, file?.basename ?? "");
	result = result.replace(/\{active-file-path\}/g, file?.path ?? "");
	return result;
}

async function appendToSection(
	vault: Vault,
	filePath: string,
	text: string,
	section?: string,
	createIfMissing = true,
): Promise<void> {
	const existing = vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile) {
		if (section) {
			const content = await vault.read(existing);
			const lines = content.split("\n");
			const sectionIdx = lines.findIndex(
				(l) => l.trim() === section.trim(),
			);
			if (sectionIdx >= 0) {
				lines.splice(sectionIdx + 1, 0, text);
				await vault.modify(existing, lines.join("\n"));
				return;
			}
		}
		await vault.append(existing, `\n${text}`);
	} else if (createIfMissing) {
		const content = section ? `${section}\n${text}\n` : `${text}\n`;
		await vault.create(filePath, content);
	}
}
