import type {
	InitializeResult,
	ListSessionsResult,
	SessionConfigOption,
	SessionResult,
	SessionUpdate,
} from "./session";
import type { PromptContent } from "./chat";

/**
 * Runtime configuration for launching an AI agent process.
 *
 * For ACP-based transports this maps to command/args/env process execution.
 * Future transports may interpret these fields differently.
 */
export interface AgentConfig {
	id: string;
	displayName: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	workingDirectory: string;
}

/**
 * Supported transport modes for routing agent communication.
 */
export type TransportMode = "acp" | "hermes-api";

/**
 * Result of polling terminal output.
 */
export interface TerminalOutputResult {
	output: string;
	truncated: boolean;
	exitStatus: {
		exitCode: number | null;
		signal: string | null;
	} | null;
}

/**
 * Transport-agnostic event envelope for streaming and lifecycle updates.
 */
export interface TransportEvent<TPayload = unknown> {
	transport: TransportMode;
	sessionId: string;
	requestId?: string;
	timestamp: string;
	eventType:
		| "request.started"
		| "message.delta"
		| "message.completed"
		| "tool.started"
		| "tool.completed"
		| "request.completed"
		| "request.failed"
		| "request.cancelled";
	payload: TPayload;
	isTerminal: boolean;
}

/**
 * Common transport contract consumed by hooks/services.
 *
 * This is intentionally broad to preserve current ACP capabilities while
 * adding a seam for Hermes API transport.
 */
export interface IAgentTransport {
	initialize(config: AgentConfig): Promise<InitializeResult>;
	newSession(workingDirectory: string): Promise<SessionResult>;
	authenticate(methodId: string): Promise<boolean>;
	sendPrompt(sessionId: string, content: PromptContent[]): Promise<void>;
	cancel(sessionId: string): Promise<void>;
	disconnect(): Promise<void>;
	isInitialized(): boolean;
	getCurrentAgentId(): string | null;
	setSessionMode(sessionId: string, modeId: string): Promise<void>;
	setSessionModel(sessionId: string, modelId: string): Promise<void>;
	setSessionConfigOption(
		sessionId: string,
		configId: string,
		value: string,
	): Promise<SessionConfigOption[]>;
	onSessionUpdate(callback: (update: SessionUpdate) => void): () => void;
	respondToPermission(requestId: string, optionId: string): Promise<void>;
	getTerminalOutput(terminalId: string): Promise<TerminalOutputResult>;
	listSessions(cwd?: string, cursor?: string): Promise<ListSessionsResult>;
	loadSession(sessionId: string, cwd: string): Promise<SessionResult>;
	resumeSession(sessionId: string, cwd: string): Promise<SessionResult>;
	forkSession(sessionId: string, cwd: string): Promise<SessionResult>;
}
