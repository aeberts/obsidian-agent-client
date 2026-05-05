import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const entry = path.join(root, "src/transport/hermes-skill-context.ts");
const outdir = await mkdtemp(path.join(tmpdir(), "hermes-skill-context-"));
const outfile = path.join(outdir, "hermes-skill-context.mjs");

try {
	await esbuild.build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		format: "esm",
		platform: "node",
		logLevel: "silent",
	});

	const { buildHermesSkillContext, shouldPrependHermesSkillContext } = await import(pathToFileURL(outfile));

	const raw = [
		"/home/zand/.hermes/skills/obsidian/obsidian",
		"/home/zand/.hermes/skills/obsidian/obsidian/",
		"/home/zand/.hermes/skills/polaris/polaris-core/SKILL.md",
		"/home/zand/.hermes/skills/polaris/polaris-core/SKILL.md",
		"  ",
	].join("\n");

	const context = buildHermesSkillContext(raw);
	assert.equal(
		context,
		[
			"[Load these skills into context before responding — use read_file on each:]",
			"/home/zand/.hermes/skills/obsidian/obsidian/SKILL.md",
			"/home/zand/.hermes/skills/polaris/polaris-core/SKILL.md",
		].join("\n"),
	);

	assert.equal(buildHermesSkillContext("\n  \n"), undefined);
	assert.equal(shouldPrependHermesSkillContext("User request", context), true);
	assert.equal(
		shouldPrependHermesSkillContext(`${context}\n\nUser request`, context),
		false,
		"do not prepend when the outgoing prompt already contains the same skill-load banner",
	);
} finally {
	await rm(outdir, { recursive: true, force: true });
}
