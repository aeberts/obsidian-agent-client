import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const outdir = await mkdtemp(path.join(tmpdir(), "hermes-prompt-path-context-"));
const outfile = path.join(outdir, "message-sender.mjs");
const stubDir = path.join(outdir, "stubs");
const obsidianStub = path.join(stubDir, "obsidian.js");

try {
	await mkdir(stubDir, { recursive: true });
	await writeFile(obsidianStub, "export class TFile {}\nexport const Platform = { isWin: false, isMacOS: false, isLinux: true };\n");

	await esbuild.build({
		entryPoints: [path.join(root, "src/services/message-sender.ts")],
		outfile,
		bundle: true,
		format: "esm",
		platform: "node",
		alias: {
			obsidian: obsidianStub,
		},
		logLevel: "silent",
	});

	const { preparePrompt } = await import(pathToFileURL(outfile));

	const noteFile = {
		path: "TaskNotes/Tasks/T58-session-scoped-skill-loading-cache.md",
		basename: "T58-session-scoped-skill-loading-cache",
		stat: { mtime: Date.parse("2026-05-05T16:00:00Z") },
	};
	const vaultAccess = {
		async readNote(notePath) {
			assert.equal(notePath, noteFile.path);
			return "# T58\nProgress body";
		},
	};
	const mentionService = {
		getAllFiles() {
			return [noteFile];
		},
	};

	const commonInput = {
		message: "@[[T58-session-scoped-skill-loading-cache]] Hey!",
		activeNote: {
			path: noteFile.path,
			name: "T58-session-scoped-skill-loading-cache",
			extension: "md",
			created: Date.now(),
			modified: Date.parse("2026-05-05T16:00:00Z"),
		},
		vaultBasePath: "/home/zand/vault",
		convertToWsl: false,
		maxNoteLength: 10000,
		maxSelectionLength: 10000,
	};

	const textResult = await preparePrompt(
		{ ...commonInput, supportsEmbeddedContext: false },
		vaultAccess,
		mentionService,
	);
	const textPayload = textResult.agentContent.map((block) => block.text ?? block.resource?.uri ?? "").join("\n");
	assert.match(textPayload, /\/home\/zand\/vault\/TaskNotes\/Tasks\/T58-session-scoped-skill-loading-cache\.md/);
	assert.doesNotMatch(textPayload, /\/Users\/zand\/Dropbox\/Hermes/);

	const resourceResult = await preparePrompt(
		{ ...commonInput, supportsEmbeddedContext: true },
		vaultAccess,
		mentionService,
	);
	const resourceUris = resourceResult.agentContent
		.map((block) => block.resource?.uri ?? block.text ?? "")
		.join("\n");
	assert.match(resourceUris, /file:\/\/\/home\/zand\/vault\/TaskNotes\/Tasks\/T58-session-scoped-skill-loading-cache\.md/);
	assert.doesNotMatch(resourceUris, /\/Users\/zand\/Dropbox\/Hermes/);
} finally {
	await rm(outdir, { recursive: true, force: true });
}
