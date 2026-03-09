/** Review state for an artifact. */
export type ReviewState =
    | 'draft'
    | 'in_review'
    | 'changes_requested'
    | 'approved'
    | 'stale';

/** Status of a comment thread. */
export type ThreadStatus =
    | 'open'
    | 'resolved'
    | 'agent_applied'
    | 'outdated';

/** Block type in a resolved artifact. */
export type BlockType =
    | 'section'
    | 'step'
    | 'list'
    | 'note'
    | 'verification';

/** Frontmatter metadata from a resolved artifact. */
export interface ArtifactMetadata {
    source: string;
    sourceHash: string;
    artifactVersion: number;
    generator: string;
    generatedAt: string;
}

/** A single reviewable block in the resolved artifact. */
export interface ArtifactBlock {
    id: string;
    type: BlockType;
    heading: string;
    content: string;
    /** Raw markdown lines for this block (including heading). */
    rawLines: string[];
    /** Zero-based start line in the resolved file. */
    startLine: number;
    /** Zero-based end line (exclusive) in the resolved file. */
    endLine: number;
}

/** A parsed resolved artifact. */
export interface ParsedArtifact {
    metadata: ArtifactMetadata | null;
    blocks: ArtifactBlock[];
    /** Raw source text. */
    raw: string;
}

/** A single comment within a thread. */
export interface Comment {
    id: string;
    author: 'user' | 'agent';
    body: string;
    createdAt: string;
}

/** A comment thread anchored to a block. */
export interface CommentThread {
    id: string;
    blockId: string;
    status: ThreadStatus;
    createdAt: string;
    updatedAt: string;
    comments: Comment[];
}

/** Sidecar file: comment threads for an artifact. */
export interface CommentSidecar {
    version: 1;
    artifactPath: string;
    sourcePath: string;
    artifactVersion: number;
    threads: CommentThread[];
}

/** Sidecar file: review metadata for an artifact. */
export interface ReviewMetadata {
    version: 1;
    sourcePath: string;
    artifactPath: string;
    sourceHash: string;
    artifactHash: string;
    artifactVersion: number;
    reviewState: ReviewState;
    generatorVersion: string;
    generatedAt: string;
    approvedAt: string | null;
}

/** Structured payload sent to the agent when requesting changes. */
export interface ReviewPayload {
    action: 'request_changes' | 'approve' | 'regenerate';
    sourcePath: string;
    artifactPath: string;
    artifactVersion: number;
    threads: ReviewPayloadThread[];
}

/** A thread summary within a review payload. */
export interface ReviewPayloadThread {
    blockId: string;
    summary: string;
    fullThread: string[];
}
