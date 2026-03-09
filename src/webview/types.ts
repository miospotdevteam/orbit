import { ParsedArtifact, CommentSidecar, ReviewState } from '../common/types';

// ─── Host → Webview messages ────────────────────────────────────────────

export interface StateUpdateMessage {
    type: 'stateUpdate';
    artifact: ParsedArtifact | null;
    sidecar: CommentSidecar | null;
    reviewState: ReviewState;
    isStale: boolean;
    changedBlockIds: string[];
}

export type HostToWebviewMessage = StateUpdateMessage;

// ─── Webview → Host messages ────────────────────────────────────────────

export interface AddCommentMessage {
    type: 'addComment';
    blockId: string;
    body: string;
}

export interface ReplyMessage {
    type: 'reply';
    threadId: string;
    body: string;
}

export interface ResolveThreadMessage {
    type: 'resolveThread';
    threadId: string;
}

export interface SelectBlockMessage {
    type: 'selectBlock';
    blockId: string;
}

export interface ApproveMessage {
    type: 'approve';
}

export interface RequestChangesMessage {
    type: 'requestChanges';
}

export interface RegenerateMessage {
    type: 'regenerate';
}

export type WebviewToHostMessage =
    | AddCommentMessage
    | ReplyMessage
    | ResolveThreadMessage
    | SelectBlockMessage
    | ApproveMessage
    | RequestChangesMessage
    | RegenerateMessage;
