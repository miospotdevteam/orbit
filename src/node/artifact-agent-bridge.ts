import { ReviewPayload, CommentSidecar } from '../common/types';

/**
 * Result from the agent after processing a review payload.
 * The agent rewrites plan.md; the resolution service then regenerates plan.md.resolved.
 */
export interface AgentResult {
    /** Whether the agent successfully processed the request. */
    success: boolean;
    /** Updated source plan content (new plan.md). */
    updatedSource: string | null;
    /** Error message if the agent failed. */
    error?: string;
}

/**
 * Interface for the agent bridge.
 * Implementations may call a local CLI tool, an API, or return stub data.
 */
export interface AgentBridge {
    /**
     * Send a structured review payload to the agent and get back
     * an updated source plan.
     */
    processReviewPayload(payload: ReviewPayload): Promise<AgentResult>;
}

/**
 * Build a ReviewPayload from comment sidecar and metadata.
 */
export function buildReviewPayload(
    sourcePath: string,
    artifactPath: string,
    artifactVersion: number,
    sidecar: CommentSidecar,
    action: ReviewPayload['action'] = 'request_changes',
): ReviewPayload {
    const openThreads = sidecar.threads.filter(t => t.status === 'open');

    return {
        action,
        sourcePath,
        artifactPath,
        artifactVersion,
        threads: openThreads.map(thread => ({
            blockId: thread.blockId,
            summary: thread.comments[0]?.body ?? '',
            fullThread: thread.comments.map(c => c.body),
        })),
    };
}

/**
 * Stub agent bridge for MVP development.
 * Returns the original source with a comment indicating changes were requested.
 */
export class StubAgentBridge implements AgentBridge {
    constructor(private readonly readSource: (path: string) => Promise<string | null>) {}

    async processReviewPayload(payload: ReviewPayload): Promise<AgentResult> {
        const source = await this.readSource(payload.sourcePath);
        if (!source) {
            return { success: false, updatedSource: null, error: 'Source file not found' };
        }

        // Stub: append a comment block indicating what changes were requested
        const threadSummaries = payload.threads
            .map(t => `- [${t.blockId}]: ${t.summary}`)
            .join('\n');

        const updatedSource = source + '\n\n<!-- Agent: Changes requested -->\n' +
            '<!-- Threads:\n' + threadSummaries + '\n-->\n';

        return { success: true, updatedSource };
    }
}
