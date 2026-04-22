/**
 * Local Command Router — FR-3
 *
 * Provides a deterministic fast-path for simple task operations that do not
 * require an LLM roundtrip. Commands that are ambiguous or complex are
 * explicitly escalated to the Hermes transport by returning { kind: "escalate" }.
 *
 * Recognized local commands:
 *   capture <text>        — append task to inbox file
 *   move <task> to <dest> — move task line between notes
 *   done <task>           — mark task as done
 *   status <task> <s>     — set task status (done | todo | in-progress)
 *
 * Everything else → { kind: "escalate" }
 */

import { TFile, type Vault } from "obsidian";

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

export type ParsedCommand = CaptureCommand | MoveCommand | StatusCommand;

export type RouteDecision =
	| { kind: "local"; command: ParsedCommand }
	| { kind: "escalate" };

// ============================================================================
// Patterns
// ============================================================================

const CAPTURE_RE = /^(?:\/capture|capture:?)\s+(.+)/i;
const MOVE_RE = /^(?:\/move|move)\s+(.+?)\s+\bto\b\s+(.+)/i;
const DONE_RE = /^(?:\/done|done)\s+(.+)/i;
const STATUS_RE =
	/^(?:\/status|status)\s+(.+?)\s+(done|todo|in[\s-]?progress)\s*$/i;

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

	return { kind: "escalate" };
}

// ============================================================================
// Executor
// ============================================================================

/**
 * Execute a locally-routed command against the Obsidian vault.
 *
 * @returns Human-readable result string shown as an assistant message.
 */
export async function executeLocalCommand(
	command: ParsedCommand,
	vault: Vault,
	inboxPath = "Inbox.md",
): Promise<string> {
	switch (command.type) {
		case "capture":
			return captureTask(command, vault, inboxPath);
		case "move":
			return moveTask(command, vault);
		case "status":
			return updateStatus(command, vault);
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
