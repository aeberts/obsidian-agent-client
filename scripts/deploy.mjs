#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

const ARTIFACTS = ["main.js", "styles.css", "manifest.json"];
const dryRun = process.argv.includes("--dry-run");

function isWsl() {
	if (process.platform !== "linux") return false;
	try {
		return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
	} catch {
		return false;
	}
}

function targetsForPlatform() {
	if (process.platform === "darwin") {
		return [
			{
				name: "MBP Hermes vault",
				path: "/Users/zand/Dropbox/Hermes/Hermes/.obsidian/plugins/agent-client",
				artifacts: ARTIFACTS,
			},
		];
	}

	if (isWsl()) {
		return [
			{
				name: "Windows OACTest vault",
				path: "/mnt/c/Users/alexe/Dropbox/Hermes/OACTest/.obsidian/plugins/agent-client",
				artifacts: ["main.js"],
			},
			{
				name: "WSL Hermes vault",
				path: "/home/zand/vault/.obsidian/plugins/agent-client",
				artifacts: ARTIFACTS,
			},
		];
	}

	throw new Error(
		`No deploy target configured for platform=${process.platform}. Use --dry-run on WSL/macOS or add a target in scripts/deploy.mjs.`,
	);
}

function verifyArtifacts() {
	for (const artifact of ARTIFACTS) {
		if (!existsSync(artifact)) {
			throw new Error(`Missing build artifact: ${artifact}. Run npm run build first.`);
		}
	}
}

function main() {
	verifyArtifacts();
	const targets = targetsForPlatform();

	console.log(`${dryRun ? "Dry run:" : "Deploying:"} ${targets.length} target(s)`);
	for (const target of targets) {
		console.log(`\n${target.name}`);
		console.log(`  ${target.path}`);

		if (!dryRun && !existsSync(target.path)) {
			mkdirSync(target.path, { recursive: true });
		}

		for (const artifact of target.artifacts) {
			const destination = join(target.path, artifact);
			console.log(`  ${artifact} -> ${destination}`);
			if (!dryRun) {
				mkdirSync(dirname(destination), { recursive: true });
				copyFileSync(artifact, destination);
			}
		}
	}
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
