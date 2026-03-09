import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile } from 'child_process';
import { loadArtifactBundle, artifactPaths } from '../node/artifact-file-service';
import { generateResolvedArtifact } from '../node/artifact-resolution-service';
import {
    getOrCreateCommentSidecar,
    addThread,
    addReply,
    updateThreadStatus,
    persistCommentSidecar,
} from '../node/artifact-comment-service';
import {
    transitionReviewState,
    getReviewStateSummary,
} from '../node/artifact-review-service';
import { parseArtifact, getBlockIds } from '../common/block-parser';

const server = new McpServer({
    name: 'orbit',
    version: '0.1.0',
});

// --- Read-only tools ---

server.registerTool(
    'orbit_load_artifact',
    {
        description: 'Load the full artifact bundle (source, resolved, comments, review state) for a given source markdown file path.',
        inputSchema: { sourcePath: z.string().describe('Absolute path to the source .md file') },
    },
    async ({ sourcePath }) => {
        const bundle = await loadArtifactBundle(sourcePath);
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    sourcePath: bundle.sourcePath,
                    hasSource: bundle.sourceContent !== null,
                    hasResolved: bundle.resolvedContent !== null,
                    hasComments: bundle.comments !== null,
                    hasReview: bundle.review !== null,
                    blockCount: bundle.parsedArtifact?.blocks.length ?? 0,
                    threadCount: bundle.comments?.threads.length ?? 0,
                    reviewState: bundle.review?.reviewState ?? 'draft',
                }, null, 2),
            }],
        };
    },
);

server.registerTool(
    'orbit_list_blocks',
    {
        description: 'List all reviewable blocks (sections) in a resolved artifact. Returns block IDs, types, and headings.',
        inputSchema: { sourcePath: z.string().describe('Absolute path to the source .md file') },
    },
    async ({ sourcePath }) => {
        const bundle = await loadArtifactBundle(sourcePath);
        if (!bundle.resolvedContent) {
            return { content: [{ type: 'text' as const, text: 'No resolved artifact found. Run orbit_generate_resolved first.' }], isError: true };
        }
        const parsed = parseArtifact(bundle.resolvedContent);
        const blocks = parsed.blocks.map(b => ({
            id: b.id,
            type: b.type,
            heading: b.heading,
        }));
        return { content: [{ type: 'text' as const, text: JSON.stringify(blocks, null, 2) }] };
    },
);

server.registerTool(
    'orbit_list_threads',
    {
        description: 'List comment threads on an artifact. Optionally filter by status or blockId.',
        inputSchema: {
            sourcePath: z.string().describe('Absolute path to the source .md file'),
            status: z.enum(['open', 'resolved', 'agent_applied', 'outdated']).optional().describe('Filter by thread status'),
            blockId: z.string().optional().describe('Filter by block ID'),
        },
    },
    async ({ sourcePath, status, blockId }) => {
        const sidecar = await getOrCreateCommentSidecar(sourcePath);
        let threads = sidecar.threads;
        if (status) {
            threads = threads.filter(t => t.status === status);
        }
        if (blockId) {
            threads = threads.filter(t => t.blockId === blockId);
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(threads, null, 2) }] };
    },
);

server.registerTool(
    'orbit_get_review_state',
    {
        description: 'Get the current review state summary for an artifact, including staleness and open thread count.',
        inputSchema: { sourcePath: z.string().describe('Absolute path to the source .md file') },
    },
    async ({ sourcePath }) => {
        const bundle = await loadArtifactBundle(sourcePath);
        const summary = getReviewStateSummary(bundle);
        return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    },
);

// --- Mutation tools ---

server.registerTool(
    'orbit_generate_resolved',
    {
        description: 'Generate a .md.resolved artifact from a source markdown file. The resolved file is auto-opened in VS Code.',
        inputSchema: { sourcePath: z.string().describe('Absolute path to the source .md file') },
    },
    async ({ sourcePath }) => {
        await generateResolvedArtifact(sourcePath);
        const paths = artifactPaths(sourcePath);

        // Auto-open in VS Code (best-effort, don't fail if code CLI unavailable)
        execFile('code', [paths.resolved], () => {});

        return { content: [{ type: 'text' as const, text: `Generated resolved artifact: ${paths.resolved}` }] };
    },
);

server.registerTool(
    'orbit_add_comment',
    {
        description: 'Add a new comment thread on a specific block of an artifact.',
        inputSchema: {
            sourcePath: z.string().describe('Absolute path to the source .md file'),
            blockId: z.string().describe('Block ID to comment on'),
            body: z.string().describe('Comment text'),
            author: z.enum(['user', 'agent']).optional().describe('Comment author (defaults to "user")'),
        },
    },
    async ({ sourcePath, blockId, body, author }) => {
        const sidecar = await getOrCreateCommentSidecar(sourcePath);

        // Validate blockId exists in the artifact
        const bundle = await loadArtifactBundle(sourcePath);
        if (bundle.parsedArtifact) {
            const blockIds = getBlockIds(bundle.parsedArtifact);
            if (!blockIds.includes(blockId)) {
                return {
                    content: [{ type: 'text' as const, text: `Block ID "${blockId}" not found. Available blocks: ${blockIds.join(', ')}` }],
                    isError: true,
                };
            }
        }

        const thread = addThread(sidecar, blockId, body, author ?? 'user');
        await persistCommentSidecar(sourcePath, sidecar);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ threadId: thread.id, status: thread.status }, null, 2) }] };
    },
);

server.registerTool(
    'orbit_reply',
    {
        description: 'Reply to an existing comment thread.',
        inputSchema: {
            sourcePath: z.string().describe('Absolute path to the source .md file'),
            threadId: z.string().describe('Thread ID to reply to'),
            body: z.string().describe('Reply text'),
            author: z.enum(['user', 'agent']).optional().describe('Reply author (defaults to "user")'),
        },
    },
    async ({ sourcePath, threadId, body, author }) => {
        const sidecar = await getOrCreateCommentSidecar(sourcePath);
        const comment = addReply(sidecar, threadId, body, author ?? 'user');
        if (!comment) {
            return { content: [{ type: 'text' as const, text: `Thread "${threadId}" not found.` }], isError: true };
        }
        await persistCommentSidecar(sourcePath, sidecar);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ commentId: comment.id }, null, 2) }] };
    },
);

server.registerTool(
    'orbit_resolve_thread',
    {
        description: 'Mark a comment thread as resolved.',
        inputSchema: {
            sourcePath: z.string().describe('Absolute path to the source .md file'),
            threadId: z.string().describe('Thread ID to resolve'),
        },
    },
    async ({ sourcePath, threadId }) => {
        const sidecar = await getOrCreateCommentSidecar(sourcePath);
        const updated = updateThreadStatus(sidecar, threadId, 'resolved');
        if (!updated) {
            return { content: [{ type: 'text' as const, text: `Thread "${threadId}" not found.` }], isError: true };
        }
        await persistCommentSidecar(sourcePath, sidecar);
        return { content: [{ type: 'text' as const, text: `Thread "${threadId}" resolved.` }] };
    },
);

server.registerTool(
    'orbit_approve',
    {
        description: 'Approve the artifact. Transitions review state to "approved". Only valid from "in_review" or "changes_requested" states.',
        inputSchema: { sourcePath: z.string().describe('Absolute path to the source .md file') },
    },
    async ({ sourcePath }) => {
        const result = await transitionReviewState(sourcePath, 'approved');
        if (!result.success) {
            return { content: [{ type: 'text' as const, text: result.error ?? 'Failed to approve.' }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: `Artifact approved. State: ${result.metadata.reviewState}` }] };
    },
);

server.registerTool(
    'orbit_request_changes',
    {
        description: 'Request changes on the artifact. Transitions review state to "changes_requested". Only valid from "in_review" state.',
        inputSchema: { sourcePath: z.string().describe('Absolute path to the source .md file') },
    },
    async ({ sourcePath }) => {
        const result = await transitionReviewState(sourcePath, 'changes_requested');
        if (!result.success) {
            return { content: [{ type: 'text' as const, text: result.error ?? 'Failed to request changes.' }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: `Changes requested. State: ${result.metadata.reviewState}` }] };
    },
);

// --- Start server ---

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Orbit MCP server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
