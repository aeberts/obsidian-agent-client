import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import type AgentClientPlugin from "../plugin";
import { getLogger } from "../utils/logger";
import type {
	AgentCapabilities,
	InitializeResult,
	ListSessionsResult,
	SessionConfigOption,
	SessionInfo,
	SessionResult,
	SessionUpdate,
} from "../types/session";
import type { PromptContent } from "../types/chat";
import type { AgentConfig, IAgentTransport, TerminalOutputResult } from "../types/transport";
import type { SlashCommand } from "../types/session";

/**
 * Messaging-platform slash commands built into the Hermes gateway.
 * These are drawn from the central COMMAND_REGISTRY (hermes_cli/commands.py)
 * and are available to every messaging adapter (Discord, Telegram, Slack, OAC, etc.).
 * Used as fallback when the gateway does not yet expose GET /v1/commands.
 */
const HERMES_MESSAGING_COMMANDS: SlashCommand[] = [
	{ name: "background", description: "Run a prompt in an independent background session", hint: "prompt" },
	{ name: "queue", description: "Queue a prompt for background execution", hint: "prompt" },
	{ name: "plan", description: "Load the planning skill for markdown planning", hint: "request" },
	{ name: "new", description: "Start a fresh session with a new ID" },
	{ name: "reset", description: "Alias for /new — start fresh session" },
	{ name: "status", description: "Display current session information" },
	{ name: "stop", description: "Terminate background processes" },
	{ name: "retry", description: "Resend the last message to the agent" },
	{ name: "undo", description: "Remove the last user/assistant exchange" },
	{ name: "title", description: "Name the current session", hint: "name" },
	{ name: "resume", description: "Restore a previously named session", hint: "name" },
	{ name: "compress", description: "Summarise context with optional focus", hint: "focus" },
	{ name: "model", description: "Switch or display the active model", hint: "provider:model" },
	{ name: "provider", description: "List providers and current selection" },
	{ name: "fast", description: "Toggle fast processing mode", hint: "normal|fast|status" },
	{ name: "reasoning", description: "Manage reasoning effort and display", hint: "level|show|hide" },
	{ name: "usage", description: "Show token consumption and cost breakdown" },
	{ name: "insights", description: "Display analytics", hint: "days" },
	{ name: "rollback", description: "List or restore filesystem checkpoints", hint: "number" },
	{ name: "snapshot", description: "Manage state snapshots", hint: "create|restore|prune" },
	{ name: "yolo", description: "Skip dangerous command approval prompts" },
	{ name: "reload-mcp", description: "Refresh MCP server configuration" },
	{ name: "reload", description: "Refresh environment variables without restart" },
	{ name: "approve", description: "Approve a pending dangerous command", hint: "session|always" },
	{ name: "deny", description: "Deny a pending dangerous command" },
	{ name: "debug", description: "Upload a diagnostic report" },
	{ name: "help", description: "Display command reference" },
	{ name: "personality", description: "Apply a predefined personality overlay", hint: "name" },
	{ name: "voice", description: "Control voice recording and playback", hint: "on|off|tts|status" },
];

/**
 * Structured transport error with an actionable recovery suggestion.
 * Caught by useAgentMessages to populate ErrorInfo.suggestion in the UI.
 */
export class HermesError extends Error {
	suggestion: string;
	constructor(message: string, suggestion: string) {
		super(message);
		this.name = "HermesError";
		this.suggestion = suggestion;
	}
}

/** Map HTTP status / error message to a user-actionable HermesError. */
function classifyError(status: number | undefined, message: string): HermesError {
	if (!status) {
		// Network-level failure — gateway not reachable
		return new HermesError(
			"Cannot reach the Hermes gateway.",
			"Ensure the gateway is running: hermes gateway start",
		);
	}
	if (status === 401) {
		return new HermesError(
			"Authentication failed (401).",
			"Check your Hermes API key in Settings → Agent Client.",
		);
	}
	if (status === 403) {
		return new HermesError(
			"Access denied (403).",
			"Your API key may not have permission for this operation.",
		);
	}
	if (status === 408 || message.toLowerCase().includes("timeout")) {
		return new HermesError(
			"Request timed out.",
			"The gateway may be overloaded. Try again or restart: hermes gateway restart",
		);
	}
	if (status >= 500) {
		return new HermesError(
			`Hermes gateway error (${status}).`,
			"Check the Hermes gateway logs for details.",
		);
	}
	return new HermesError(
		message || `Hermes API error (${status})`,
		"Check the Hermes gateway status and your plugin settings.",
	);
}

function toolEmoji(name: string): string {
	if (name.startsWith("read_")) return "📖";
	if (name.startsWith("search_") || name === "viking_search") return "🔍";
	if (name.startsWith("write_") || name.startsWith("create_")) return "✏️";
	if (name === "delegate_task") return "⚙️";
	if (name === "skill_view") return "📋";
	return "🔧";
}

function toolDetail(name: string, argsJson: string): string {
	let args: Record<string, unknown>;
	try { args = JSON.parse(argsJson) as Record<string, unknown>; } catch { return ""; }
	const str = (v: unknown, max = 60): string => {
		const s = String(v ?? "");
		return s.length > max ? s.slice(0, max - 1) + "…" : s;
	};
	if (name === "delegate_task" && args.goal) return str(args.goal, 50);
	if (args.path) return str(args.path);
	if (args.query) return str(args.query);
	if (args.pattern) return str(args.pattern);
	return "";
}

interface HermesSessionState {
	sessionId: string;
	cwd: string;
	updatedAt: string;
	title?: string;
	configOptions?: SessionConfigOption[];
	/** Skill context to prepend on the first sendPrompt of this session, then cleared. */
	pendingSkillContext?: string;
	/** ID of the last completed response; used for direct-ID state lookup on subsequent turns. */
	lastResponseId?: string;
}

export class HermesApiTransport implements IAgentTransport {
	private plugin: AgentClientPlugin;
	private logger = getLogger();
	private initialized = false;
	private currentAgentId: string | null = null;
	private apiBase = "http://127.0.0.1:8642";
	private apiKey = "";
	private defaultModel = "gpt-5.3-codex";
	private sessionStates = new Map<string, HermesSessionState>();
	private callbacks = new Set<(update: SessionUpdate) => void>();
	private cancelledSessions = new Set<string>();
	private sessionAbortControllers = new Map<string, AbortController>();

	constructor(plugin: AgentClientPlugin) {
		this.plugin = plugin;
	}

	async initialize(config: AgentConfig): Promise<InitializeResult> {
		this.apiBase = (config.env?.HERMES_API_BASE || "http://127.0.0.1:8642").replace(/\/$/, "");
		this.apiKey =
			config.env?.HERMES_API_KEY ||
			config.env?.API_SERVER_KEY ||
			config.env?.OPENAI_API_KEY ||
			"";
		this.defaultModel = config.env?.HERMES_MODEL || "gpt-5.3-codex";
		this.currentAgentId = config.id;
		this.initialized = true;

		const agentCapabilities: AgentCapabilities = {
			loadSession: true,
			sessionCapabilities: {
				resume: {},
				fork: {},
				list: {},
			},
			promptCapabilities: {
				embeddedContext: false,
				image: false,
			},
		};

		return {
			authMethods: [],
			protocolVersion: 1,
			promptCapabilities: agentCapabilities.promptCapabilities,
			agentCapabilities,
			agentInfo: {
				name: "hermes-api",
				title: "Hermes API",
				version: "0.1",
			},
		};
	}

	async newSession(workingDirectory: string): Promise<SessionResult> {
		this.ensureInitialized();
		const sessionId = `hermes-${crypto.randomUUID()}`;
		const state: HermesSessionState = {
			sessionId,
			cwd: workingDirectory,
			updatedAt: new Date().toISOString(),
			configOptions: [
				{
					id: "model",
					name: "Model",
					category: "model",
					type: "select",
					currentValue: this.defaultModel,
					options: [{ value: this.defaultModel, name: this.defaultModel }],
				},
			],
		};
		state.pendingSkillContext = this.buildSkillContext();
		this.sessionStates.set(sessionId, state);
		void this.fetchAndEmitGatewayCommands(sessionId);
		return {
			sessionId,
			configOptions: state.configOptions,
		};
	}

	async authenticate(_methodId: string): Promise<boolean> {
		return true;
	}

	async sendPrompt(sessionId: string, content: PromptContent[]): Promise<void> {
		this.ensureInitialized();
		const state = this.getSessionState(sessionId);
		if (!this.liveApiKey) {
			throw new HermesError(
				"Hermes API key is not configured.",
				"Add your API key in Settings → Agent Client → Hermes API Key.",
			);
		}

		this.cancelledSessions.delete(sessionId);

		let input = this.flattenPromptContent(content);
		if (state.pendingSkillContext) {
			input = state.pendingSkillContext + "\n\n" + input;
			state.pendingSkillContext = undefined;
		}
		const model = this.getSessionModel(state) || this.defaultModel;
		this.logger.log(
			`[HermesApiTransport] sendPrompt start session=${sessionId} model=${model} inputChars=${input.length}`,
		);

		const streamed = await this.trySendViaResponsesStream(sessionId, input, model);
		if (streamed) {
			state.updatedAt = new Date().toISOString();
			return;
		}

		// Fallback: blocking /v1/responses path
		await this.sendViaResponses(sessionId, input, model, state);
	}

	async cancel(sessionId: string): Promise<void> {
		this.cancelledSessions.add(sessionId);
		const ctrl = this.sessionAbortControllers.get(sessionId);
		if (ctrl) {
			ctrl.abort();
			this.sessionAbortControllers.delete(sessionId);
		}
	}

	/**
	 * Try to send via POST /v1/responses with stream:true.
	 * Returns true if the stream was handled (including cancelled), false if
	 * streaming is unavailable and the caller should fall back to blocking mode.
	 */
	private async trySendViaResponsesStream(
		sessionId: string,
		input: string,
		model: string,
	): Promise<boolean> {
		const abortCtrl = new AbortController();
		this.sessionAbortControllers.set(sessionId, abortCtrl);
		const state = this.getSessionState(sessionId);
		const t0 = performance.now();
		try {
			const body: Record<string, unknown> = { model, conversation: sessionId, input, stream: true };
			if (state.lastResponseId) body.previous_response_id = state.lastResponseId;
			const response = await fetch(`${this.apiBase}/v1/responses`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.liveApiKey}`,
				},
				body: JSON.stringify(body),
				signal: abortCtrl.signal,
			});
			const t1 = performance.now();
			if (!response.ok || !response.body) return false;

			let t2 = -1;
			await this.consumeSseStream(response.body, sessionId, () => {
				if (t2 < 0) t2 = performance.now();
			});
			const t3 = performance.now();

			this.logger.log(
				`[HermesApiTransport] TTFT: connection=${Math.round(t1 - t0)}ms` +
				` first-token=${t2 > 0 ? Math.round(t2 - t1) : "n/a"}ms` +
				` stream=${t2 > 0 ? Math.round(t3 - t2) : Math.round(t3 - t1)}ms` +
				` total=${Math.round(t3 - t0)}ms`,
			);
			return true;
		} catch (err) {
			if ((err as Error).name === "AbortError") return true; // cancelled — handled
			this.logger.warn(`[HermesApiTransport] streaming /v1/responses failed, falling back: ${String(err)}`);
			return false;
		} finally {
			this.sessionAbortControllers.delete(sessionId);
		}
	}

	/** Read an SSE stream and emit agent_message_chunk / usage_update events. */
	private async consumeSseStream(
		body: ReadableStream<Uint8Array>,
		sessionId: string,
		onFirstChunk?: () => void,
	): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		// Tracks the SSE `event:` field for the current event block; Hermes custom
		// events (e.g. hermes.tool.progress) set their type here rather than inside
		// the JSON payload.
		let sseEventType: string | undefined;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith("event: ")) {
						sseEventType = line.slice(7).trim();
						continue;
					}
					// Blank line marks end of an SSE event block
					if (line === "") {
						sseEventType = undefined;
						continue;
					}
					if (!line.startsWith("data: ")) continue;
					const data = line.slice(6).trim();
					if (data === "[DONE]") return;

					let event: Record<string, unknown>;
					try {
						event = JSON.parse(data) as Record<string, unknown>;
					} catch {
						sseEventType = undefined;
						continue;
					}

					// Resolve event type from JSON body first, then SSE event field.
					const type = (event.type as string | undefined) ?? sseEventType;
					sseEventType = undefined;

					// hermes.tool.progress — real-time tool execution progress (v0.7.0+).
					// Payload uses SSE `event:` field (no `type` in JSON); fields: tool, emoji, label.
					if (type === "hermes.tool.progress") {
						const emoji = typeof event.emoji === "string" ? event.emoji : "⚙️";
						const label = typeof event.label === "string" ? event.label
							: typeof event.tool === "string" ? event.tool : "";
						if (label) {
							onFirstChunk?.();
							this.emit({ type: "agent_message_chunk", sessionId, text: `_${emoji} ${label}_\n` });
						}
						continue;
					}

					// Emit a visible status line for each tool call so the user sees
					// activity during the (potentially long) tool-execution phase.
					if (type === "response.output_item.added") {
						const item = event.item as Record<string, unknown> | undefined;
						if (item?.type === "function_call" && typeof item.name === "string") {
							const emoji = toolEmoji(item.name);
							const detail = toolDetail(item.name, typeof item.arguments === "string" ? item.arguments : "");
							const label = detail ? `${item.name} \`${detail}\`` : item.name;
							onFirstChunk?.();
							this.emit({ type: "agent_message_chunk", sessionId, text: `_${emoji} ${label}_\n` });
						}
					}

					const text = this.extractSseText(event);
					if (text) {
						onFirstChunk?.();
						this.emit({ type: "agent_message_chunk", sessionId, text });
					}

					// response.completed is the terminal event — emit usage and stop
					if (type === "response.completed") {
						const resp = event.response as Record<string, unknown> | undefined;
						if (typeof resp?.id === "string") {
							this.getSessionState(sessionId).lastResponseId = resp.id;
						}
						const usage = resp?.usage as
							| { input_tokens?: number; output_tokens?: number; total_tokens?: number }
							| undefined;
						if (usage?.total_tokens) {
							this.emit({ type: "usage_update", sessionId, size: usage.total_tokens, used: usage.total_tokens });
						}
						return;
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	/** Extract text from an SSE event, handling multiple known formats. */
	private extractSseText(event: Record<string, unknown>): string | null {
		const type = event.type as string | undefined;

		// OpenAI Responses API streaming — only delta events carry new text;
		// done/completed events carry the full accumulated text in other fields
		// which must NOT be re-emitted as chunks.
		if (type?.startsWith("response.")) {
			if (type === "response.output_text.delta" && typeof event.delta === "string") {
				return event.delta;
			}
			return null;
		}
		// OpenAI Chat Completions streaming
		const choices = event.choices as Array<Record<string, unknown>> | undefined;
		if (Array.isArray(choices) && choices.length > 0) {
			const delta = choices[0].delta as Record<string, unknown> | undefined;
			if (typeof delta?.content === "string") return delta.content;
		}
		// Generic token/text event
		if (typeof event.text === "string" && event.text.length > 0) return event.text;
		// Nested delta.text
		const delta = event.delta as Record<string, unknown> | undefined;
		if (typeof delta?.text === "string") return delta.text;

		// Log unrecognised non-response events so we can identify new formats.
		// hermes.tool.progress is handled upstream before extractSseText is called.
		if (type && type !== "hermes.tool.progress") {
			this.logger.log(`[HermesApiTransport] unhandled SSE event type="${type}"`);
		}
		return null;
	}

	/** Blocking /v1/responses fallback path (used when Runs API is unavailable). */
	private async sendViaResponses(
		sessionId: string,
		input: string,
		model: string,
		state: HermesSessionState,
	): Promise<void> {
		let payload: Record<string, unknown>;
		try {
			const reqBody: Record<string, unknown> = { model, conversation: sessionId, input };
			if (state.lastResponseId) reqBody.previous_response_id = state.lastResponseId;
			payload = await this.requestJson("/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.liveApiKey}`,
				},
				body: JSON.stringify(reqBody),
			});
		} catch (err) {
			if (this.cancelledSessions.has(sessionId)) {
				this.cancelledSessions.delete(sessionId);
				return;
			}
			throw err;
		}

		if (this.cancelledSessions.has(sessionId)) {
			this.cancelledSessions.delete(sessionId);
			return;
		}

		if (typeof payload.id === "string") {
			state.lastResponseId = payload.id;
		}
		const outputText = this.extractOutputText(payload);
		this.logger.log(
			`[HermesApiTransport] /v1/responses outputChars=${outputText.length}`,
		);
		if (outputText.length > 0) {
			for (const chunk of this.chunkText(outputText, 140)) {
				this.emit({ type: "agent_message_chunk", sessionId, text: chunk });
			}
		} else {
			this.logger.warn(
				`[HermesApiTransport] empty output_text; payload keys=${Object.keys(payload).join(",")}`,
			);
		}

		const usage = payload.usage as
			| { input_tokens?: number; output_tokens?: number; total_tokens?: number }
			| undefined;
		if (usage?.total_tokens) {
			this.emit({ type: "usage_update", sessionId, size: usage.total_tokens, used: usage.total_tokens });
		}

		state.updatedAt = new Date().toISOString();
	}

	async disconnect(): Promise<void> {
		this.initialized = false;
		this.currentAgentId = null;
	}

	isInitialized(): boolean {
		return this.initialized;
	}

	getCurrentAgentId(): string | null {
		return this.currentAgentId;
	}

	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		this.emit({ type: "current_mode_update", sessionId, currentModeId: modeId });
	}

	async setSessionModel(sessionId: string, modelId: string): Promise<void> {
		const state = this.getSessionState(sessionId);
		state.configOptions = this.upsertModelConfigOption(state.configOptions, modelId);
		this.emit({
			type: "config_option_update",
			sessionId,
			configOptions: state.configOptions,
		});
	}

	async setSessionConfigOption(
		sessionId: string,
		configId: string,
		value: string,
	): Promise<SessionConfigOption[]> {
		const state = this.getSessionState(sessionId);
		if (configId === "model") {
			state.configOptions = this.upsertModelConfigOption(state.configOptions, value);
		} else {
			state.configOptions = this.upsertGenericConfigOption(
				state.configOptions,
				configId,
				value,
			);
		}
		this.emit({
			type: "config_option_update",
			sessionId,
			configOptions: state.configOptions,
		});
		return state.configOptions;
	}

	onSessionUpdate(callback: (update: SessionUpdate) => void): () => void {
		this.callbacks.add(callback);
		return () => this.callbacks.delete(callback);
	}

	async respondToPermission(_requestId: string, _optionId: string): Promise<void> {
		// Hermes API transport currently does not expose ACP-style permission flows.
	}

	async getTerminalOutput(_terminalId: string): Promise<TerminalOutputResult> {
		return {
			output: "",
			truncated: false,
			exitStatus: null,
		};
	}

	async listSessions(cwd?: string, _cursor?: string): Promise<ListSessionsResult> {
		const sessions = Array.from(this.sessionStates.values())
			.filter((s) => !cwd || s.cwd === cwd)
			.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
			.map(
				(s): SessionInfo => ({
					sessionId: s.sessionId,
					cwd: s.cwd,
					title: s.title,
					updatedAt: s.updatedAt,
				}),
			);
		return { sessions };
	}

	async loadSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const state = this.getSessionState(sessionId, cwd);
		void this.fetchAndEmitGatewayCommands(state.sessionId);
		return { sessionId: state.sessionId, configOptions: state.configOptions };
	}

	async resumeSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const state = this.getSessionState(sessionId, cwd);
		void this.fetchAndEmitGatewayCommands(state.sessionId);
		return { sessionId: state.sessionId, configOptions: state.configOptions };
	}

	async forkSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const parent = this.getSessionState(sessionId, cwd);
		const newSessionId = `hermes-${crypto.randomUUID()}`;
		const forked: HermesSessionState = {
			sessionId: newSessionId,
			cwd,
			title: parent.title,
			updatedAt: new Date().toISOString(),
			configOptions: parent.configOptions,
		};
		this.sessionStates.set(newSessionId, forked);
		return { sessionId: newSessionId, configOptions: forked.configOptions };
	}

	private flattenPromptContent(content: PromptContent[]): string {
		return content
			.map((block) => {
				if (block.type === "text") return block.text;
				if (block.type === "resource") {
					return block.resource?.text || "";
				}
				if (block.type === "resource_link") {
					return `[resource:${block.name || block.uri}] ${block.uri}`;
				}
				if (block.type === "image") {
					return "[image omitted]";
				}
				return "";
			})
			.filter((x) => x.length > 0)
			.join("\n\n");
	}

	private extractOutputText(payload: Record<string, unknown>): string {
		const output = payload.output as Array<Record<string, unknown>> | undefined;
		if (!Array.isArray(output)) return "";
		const textParts: string[] = [];
		for (const item of output) {
			if (item.type !== "message") continue;
			const content = item.content as Array<Record<string, unknown>> | undefined;
			if (!Array.isArray(content)) continue;
			for (const c of content) {
				if (c.type === "output_text" && typeof c.text === "string") {
					textParts.push(c.text);
				}
			}
		}
		return textParts.join("\n").trim();
	}

	private chunkText(text: string, chunkSize: number): string[] {
		if (text.length <= chunkSize) return [text];
		const chunks: string[] = [];
		for (let i = 0; i < text.length; i += chunkSize) {
			chunks.push(text.slice(i, i + chunkSize));
		}
		return chunks;
	}

	private getSessionState(sessionId: string, cwd?: string): HermesSessionState {
		const existing = this.sessionStates.get(sessionId);
		if (existing) return existing;
		if (cwd) {
			const state: HermesSessionState = {
				sessionId,
				cwd,
				updatedAt: new Date().toISOString(),
				configOptions: [
					{
						id: "model",
						name: "Model",
						category: "model",
						type: "select",
						currentValue: this.defaultModel,
						options: [{ value: this.defaultModel, name: this.defaultModel }],
					},
				],
			};
			this.sessionStates.set(sessionId, state);
			return state;
		}
		throw new Error(`Unknown Hermes session: ${sessionId}`);
	}

	private getSessionModel(state: HermesSessionState): string | null {
		const modelOpt = state.configOptions?.find((o) => o.id === "model");
		return modelOpt?.currentValue || null;
	}

	private upsertModelConfigOption(
		options: SessionConfigOption[] | undefined,
		modelId: string,
	): SessionConfigOption[] {
		const existing = options || [];
		const withoutModel = existing.filter((o) => o.id !== "model");
		return [
			...withoutModel,
			{
				id: "model",
				name: "Model",
				category: "model",
				type: "select",
				currentValue: modelId,
				options: [{ value: modelId, name: modelId }],
			},
		];
	}

	private upsertGenericConfigOption(
		options: SessionConfigOption[] | undefined,
		configId: string,
		value: string,
	): SessionConfigOption[] {
		const existing = options || [];
		const without = existing.filter((o) => o.id !== configId);
		return [
			...without,
			{
				id: configId,
				name: configId,
				type: "select",
				currentValue: value,
				options: [{ value, name: value }],
			},
		];
	}

	/** Build a skill-load instruction to prepend on the first message of a new session. */
	private buildSkillContext(): string | undefined {
		const raw = this.plugin.settings.hermesApi?.autoLoadSkills ?? "";
		const paths = raw.split("\n").map((p) => p.trim()).filter(Boolean);
		if (paths.length === 0) return undefined;
		// Normalise directory paths to SKILL.md — Hermes will read the file itself
		const filePaths = paths.map((p) => (p.endsWith(".md") ? p : `${p}/SKILL.md`));
		return (
			`[Load these skills into context before responding — use read_file on each:]\n` +
			filePaths.join("\n")
		);
	}

	/**
	 * Fetch slash commands advertised by the Hermes gateway and emit an
	 * available_commands_update so the dropdown reflects gateway-sourced commands.
	 *
	 * Command discovery contract:
	 *   - Local deterministic commands (capture/move/done/status/process-inbox)
	 *     are registered statically in ChatPanel and never come from this call.
	 *   - Hermes-roundtrip commands are advertised by the gateway via GET /v1/commands
	 *     and flow through this method → session.availableCommands → dropdown.
	 *   - Background-only operations are not slash commands and are not advertised here.
	 *
	 * Degrades silently if the gateway does not implement the endpoint yet (404).
	 */
	private async fetchAndEmitGatewayCommands(sessionId: string): Promise<void> {
		try {
			const payload = await this.requestJson("/v1/commands", {
				method: "GET",
				headers: { Authorization: `Bearer ${this.liveApiKey}` },
			});
			const raw = payload.commands;
			if (!Array.isArray(raw)) {
				// Endpoint exists but returned no commands — emit built-in list.
				this.emit({ type: "available_commands_update", sessionId, commands: HERMES_MESSAGING_COMMANDS });
				return;
			}
			const commands: SlashCommand[] = raw
				.filter(
					(c): c is Record<string, unknown> =>
						c !== null && typeof c === "object" && typeof c.name === "string",
				)
				.map((c) => ({
					name: c.name as string,
					description: typeof c.description === "string" ? c.description : "",
					hint:
						typeof c.hint === "string" || c.hint == null
							? (c.hint as string | null | undefined)
							: undefined,
				}));
			this.emit({
				type: "available_commands_update",
				sessionId,
				commands: commands.length > 0 ? commands : HERMES_MESSAGING_COMMANDS,
			});
		} catch {
			// Gateway does not implement /v1/commands yet — fall back to built-in
			// messaging-platform command list (same set Discord/Telegram/Slack get).
			this.emit({ type: "available_commands_update", sessionId, commands: HERMES_MESSAGING_COMMANDS });
		}
	}

	private emit(update: SessionUpdate): void {
		for (const callback of this.callbacks) {
			callback(update);
		}
	}

	private async requestJson(
		path: string,
		options: Omit<RequestUrlParam, "url">,
	): Promise<Record<string, unknown>> {
		let response: RequestUrlResponse;
		try {
			this.logger.log(
				`[HermesApiTransport] request ${options.method ?? "GET"} ${this.apiBase}${path}`,
			);
			response = await requestUrl({
				url: `${this.apiBase}${path}`,
				...options,
			});
			this.logger.log(
				`[HermesApiTransport] response status=${response.status} path=${path}`,
			);
		} catch (error) {
			const maybeResponse = error as RequestUrlResponse & {
				json?: unknown;
				text?: string;
				status?: number;
			};
			const errorPayload =
				maybeResponse?.json && typeof maybeResponse.json === "object"
					? (maybeResponse.json as Record<string, unknown>)
					: {};
			const status = maybeResponse?.status;
			const message =
				((errorPayload.error as Record<string, unknown> | undefined)?.message as string | undefined) ||
				(status ? `Hermes API error (${status})` : (error as Error).message || "Hermes API request failed");
			// 404 on optional endpoints (e.g. /v1/commands) is expected — log at debug level
			if (status === 404) {
				this.logger.log(
					`[HermesApiTransport] 404 path=${path} (endpoint not implemented yet)`,
				);
			} else {
				this.logger.error(
					`[HermesApiTransport] request failed path=${path} status=${status ?? "n/a"} message=${message}`,
				);
			}
			throw classifyError(status, message);
		}

		const payload =
			response.json && typeof response.json === "object"
				? (response.json as Record<string, unknown>)
				: {};

		if (response.status >= 400) {
			const message =
				((payload.error as Record<string, unknown> | undefined)?.message as string | undefined) ||
				`Hermes API error (${response.status})`;
			throw classifyError(response.status, message);
		}

		return payload;
	}

	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error("HermesApiTransport is not initialized");
		}
	}

	/** Always reads the current API key from live plugin settings. */
	private get liveApiKey(): string {
		return this.plugin.settings.hermesApi?.apiKey || this.apiKey;
	}
}
