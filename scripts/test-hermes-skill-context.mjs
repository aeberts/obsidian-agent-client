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
const banner = "[Load these skills into context before responding — use read_file on each:]";

try {
	await esbuild.build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		format: "esm",
		platform: "node",
		logLevel: "silent",
	});

	const {
		buildHermesSkillContext,
		createHermesSkillLoadState,
		prepareHermesSkillContextInput,
		shouldPrependHermesSkillContext,
	} = await import(pathToFileURL(outfile));

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
			banner,
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

	const state = createHermesSkillLoadState();
	const configured = [
		"/home/zand/.hermes/skills/obsidian/obsidian",
		"/home/zand/.hermes/skills/polaris/polaris-core/SKILL.md",
	].join("\n");

	const turn1 = prepareHermesSkillContextInput("First request", configured, state);
	assert.equal(
		turn1.input,
		[
			banner,
			"/home/zand/.hermes/skills/obsidian/obsidian/SKILL.md",
			"/home/zand/.hermes/skills/polaris/polaris-core/SKILL.md",
			"",
			"First request",
		].join("\n"),
		"first turn prepends all configured skills",
	);
	assert.equal(turn1.loadedCount, 2);
	assert.equal(turn1.skippedCount, 0);

	const turn2 = prepareHermesSkillContextInput("Second request", configured, state);
	assert.equal(turn2.input, "Second request", "second turn skips already-loaded skills");
	assert.equal(turn2.loadedCount, 0);
	assert.equal(turn2.skippedCount, 2);

	const turn3 = prepareHermesSkillContextInput(
		"Third request",
		`${configured}\n/home/zand/.hermes/skills/github/github-pr-workflow/SKILL.md`,
		state,
	);
	assert.equal(
		turn3.input,
		[
			banner,
			"/home/zand/.hermes/skills/github/github-pr-workflow/SKILL.md",
			"",
			"Third request",
		].join("\n"),
		"adding one new skill mid-session emits only the new skill",
	);
	assert.equal(turn3.loadedCount, 1);
	assert.equal(turn3.skippedCount, 2);

	const freshSession = createHermesSkillLoadState();
	const freshTurn = prepareHermesSkillContextInput("Fresh request", configured, freshSession);
	assert.ok(
		freshTurn.input.includes("/home/zand/.hermes/skills/obsidian/obsidian/SKILL.md"),
		"new session starts with a clean skill-loaded state",
	);
	assert.equal(freshTurn.loadedCount, 2);

	const aliasState = createHermesSkillLoadState();
	const aliasTurn = prepareHermesSkillContextInput(
		"Alias request",
		[
			"obsidian",
			"/home/zand/.hermes/skills/obsidian/obsidian",
			"./skills/obsidian/obsidian/SKILL.md",
		].join("\n"),
		aliasState,
	);
	assert.equal(aliasTurn.loadedCount, 1, "duplicate path/name variants collapse to one loaded skill");
	assert.equal(
		aliasTurn.input.split("\n").filter((line) => line === "obsidian" || line.includes("/obsidian/")).length,
		1,
		"collapsed duplicate skill variants emit one banner entry",
	);

	const externalBannerState = createHermesSkillLoadState();
	const externalTurn1 = prepareHermesSkillContextInput(
		[
			banner,
			"/home/zand/.hermes/skills/polaris/polaris-core/SKILL.md",
			"",
			"Question using a context-provided skill banner",
		].join("\n"),
		"",
		externalBannerState,
	);
	assert.equal(externalTurn1.loadedCount, 1, "context-provided skill banners mark skills loaded");
	assert.ok(externalTurn1.input.startsWith(`${banner}\n/home/zand/.hermes/skills/polaris/polaris-core/SKILL.md`));

	const externalTurn2 = prepareHermesSkillContextInput(
		[
			banner,
			"/home/zand/.hermes/skills/polaris/polaris-core/SKILL.md",
			"",
			"Follow-up with the same context-provided skill banner",
		].join("\n"),
		"",
		externalBannerState,
	);
	assert.equal(
		externalTurn2.input,
		"Follow-up with the same context-provided skill banner",
		"already-loaded context-provided skill banners are removed on later turns",
	);
	assert.equal(externalTurn2.loadedCount, 0);
	assert.equal(externalTurn2.skippedCount, 1);
} finally {
	await rm(outdir, { recursive: true, force: true });
}
