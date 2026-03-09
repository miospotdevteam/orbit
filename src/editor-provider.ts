import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { loadArtifactBundle } from './node/artifact-file-service';
import { getOrCreateCommentSidecar, addThread, addReply, updateThreadStatus, persistCommentSidecar } from './node/artifact-comment-service';
import { transitionReviewState, getReviewStateSummary } from './node/artifact-review-service';
import { executeRegenerationCycle } from './node/artifact-resolution-service';
import { StubAgentBridge } from './node/artifact-agent-bridge';
import { getBlockIds } from './common/block-parser';
import { HostToWebviewMessage, WebviewToHostMessage } from './webview/types';

/**
 * Derive the source plan path from a resolved artifact path.
 * `plan.md.resolved` → `plan.md`
 */
function sourcePathFromResolved(resolvedPath: string): string {
    if (resolvedPath.endsWith('.md.resolved')) {
        return resolvedPath.slice(0, -'.resolved'.length);
    }
    return resolvedPath;
}

export class ArtifactReviewEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'artifact-review-editor';

    private readonly _extensionUri: vscode.Uri;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._extensionUri = context.extensionUri;
    }

    public async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'out'),
            ],
        };

        webviewPanel.webview.html = this._getWebviewHtml(webviewPanel.webview);

        const resolvedPath = document.uri.fsPath;
        const sourcePath = sourcePathFromResolved(resolvedPath);

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(
            (message: WebviewToHostMessage) => this._handleMessage(message, sourcePath, webviewPanel),
            undefined,
            this.context.subscriptions,
        );

        // Send initial state once the webview is ready
        webviewPanel.webview.onDidReceiveMessage(
            async (message: { type: string }) => {
                if (message.type === 'ready') {
                    await this._pushState(sourcePath, webviewPanel);
                }
            },
            undefined,
            this.context.subscriptions,
        );

        // Watch for file changes
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(sourcePath), '*'),
        );
        watcher.onDidChange(async () => {
            await this._pushState(sourcePath, webviewPanel);
        });
        webviewPanel.onDidDispose(() => watcher.dispose());
    }

    private async _pushState(sourcePath: string, panel: vscode.WebviewPanel): Promise<void> {
        try {
            const bundle = await loadArtifactBundle(sourcePath);
            const summary = getReviewStateSummary(bundle);

            const message: HostToWebviewMessage = {
                type: 'stateUpdate',
                artifact: bundle.parsedArtifact,
                sidecar: bundle.comments,
                reviewState: summary.state,
                isStale: summary.isStale,
                changedBlockIds: [],
            };

            await panel.webview.postMessage(message);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to load artifact: ${err}`);
        }
    }

    private async _handleMessage(
        message: WebviewToHostMessage,
        sourcePath: string,
        panel: vscode.WebviewPanel,
    ): Promise<void> {
        try {
            switch (message.type) {
                case 'addComment': {
                    const sidecar = await getOrCreateCommentSidecar(sourcePath);
                    addThread(sidecar, message.blockId, message.body, 'user');
                    await persistCommentSidecar(sourcePath, sidecar);
                    break;
                }
                case 'reply': {
                    const sidecar = await getOrCreateCommentSidecar(sourcePath);
                    addReply(sidecar, message.threadId, message.body, 'user');
                    await persistCommentSidecar(sourcePath, sidecar);
                    break;
                }
                case 'resolveThread': {
                    const sidecar = await getOrCreateCommentSidecar(sourcePath);
                    updateThreadStatus(sidecar, message.threadId, 'resolved');
                    await persistCommentSidecar(sourcePath, sidecar);
                    break;
                }
                case 'approve': {
                    await transitionReviewState(sourcePath, 'in_review');
                    await transitionReviewState(sourcePath, 'approved');
                    break;
                }
                case 'requestChanges': {
                    await transitionReviewState(sourcePath, 'in_review');
                    await transitionReviewState(sourcePath, 'changes_requested');
                    break;
                }
                case 'regenerate': {
                    const readSource = async (p: string) => {
                        try { return await fs.readFile(p, 'utf8'); } catch { return null; }
                    };
                    const bridge = new StubAgentBridge(readSource);
                    const result = await executeRegenerationCycle(sourcePath, bridge);

                    if (result.success) {
                        // Load the new resolved to find changed block IDs
                        const bundle = await loadArtifactBundle(sourcePath);
                        const summary = getReviewStateSummary(bundle);
                        const changedBlockIds = bundle.parsedArtifact
                            ? getBlockIds(bundle.parsedArtifact)
                            : [];

                        const stateMsg: HostToWebviewMessage = {
                            type: 'stateUpdate',
                            artifact: bundle.parsedArtifact,
                            sidecar: bundle.comments,
                            reviewState: summary.state,
                            isStale: summary.isStale,
                            changedBlockIds,
                        };
                        await panel.webview.postMessage(stateMsg);
                        return; // Skip the default pushState below
                    } else {
                        vscode.window.showErrorMessage(`Regeneration failed: ${result.error}`);
                    }
                    break;
                }
                case 'selectBlock': {
                    // No-op on host side — selection is webview-local state
                    return;
                }
            }

            // Push updated state after mutation
            await this._pushState(sourcePath, panel);
        } catch (err) {
            vscode.window.showErrorMessage(`Error handling action: ${err}`);
        }
    }

    private _getWebviewHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'),
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
    <title>Artifact Review</title>
    <style>
        /* === Base === */
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 0;
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground, #ccc);
            background: var(--vscode-editor-background, #1e1e1e);
            line-height: 1.6;
        }
        #root {
            height: 100vh;
            overflow: auto;
        }
        .artifact-review-container {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        .artifact-review-layout {
            flex: 1;
            overflow-y: auto;
        }
        .artifact-review-main {
            max-width: 860px;
            margin: 0 auto;
            padding: 24px 40px 80px;
        }

        /* === Toolbar === */
        .review-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            border-bottom: 1px solid var(--vscode-panel-border, #333);
            background: var(--vscode-editor-background, #1e1e1e);
            min-height: 40px;
            flex-shrink: 0;
        }
        .review-toolbar-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .review-toolbar-title {
            font-weight: 600;
            font-size: 0.92em;
            color: var(--vscode-foreground, #ccc);
        }
        .review-toolbar-timestamp {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground, #888);
        }
        .review-toolbar-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .review-toolbar-icon-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground, #ccc);
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 4px;
            font-size: 1em;
            display: flex;
            align-items: center;
        }
        .review-toolbar-icon-btn:hover {
            background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08));
        }
        .review-dropdown {
            position: relative;
            display: inline-block;
        }
        .review-dropdown-btn {
            background: var(--vscode-button-secondaryBackground, #313131);
            color: var(--vscode-button-secondaryForeground, #ccc);
            border: 1px solid var(--vscode-panel-border, #444);
            padding: 4px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .review-dropdown-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground, #3c3c3c);
        }
        .review-dropdown-menu {
            position: absolute;
            right: 0;
            top: 100%;
            margin-top: 4px;
            background: var(--vscode-editorWidget-background, #252526);
            border: 1px solid var(--vscode-panel-border, #444);
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            z-index: 200;
            min-width: 180px;
            padding: 4px 0;
        }
        .review-dropdown-item {
            display: block;
            width: 100%;
            padding: 6px 14px;
            background: none;
            border: none;
            color: var(--vscode-foreground, #ccc);
            font-size: 0.85em;
            text-align: left;
            cursor: pointer;
        }
        .review-dropdown-item:hover {
            background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
        }
        .review-dropdown-item:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .review-dropdown-divider {
            border-top: 1px solid var(--vscode-panel-border, #333);
            margin: 4px 0;
        }
        .review-proceed-btn {
            background: #388a34;
            color: #fff;
            border: none;
            padding: 4px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            font-weight: 600;
        }
        .review-proceed-btn:hover {
            background: #2e7d2e;
        }
        .review-proceed-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .review-state-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 4px;
        }
        .review-state-dot-draft { background: #888; }
        .review-state-dot-in_review { background: #0e639c; }
        .review-state-dot-changes_requested { background: #c9811a; }
        .review-state-dot-approved { background: #388a34; }
        .review-state-dot-stale { background: #a1260d; }
        .review-stale-banner {
            background: var(--vscode-inputValidation-warningBackground, #352a05);
            border: 1px solid var(--vscode-inputValidation-warningBorder, #9b8400);
            padding: 8px 16px;
            margin: 0 0 16px 0;
            border-radius: 6px;
            font-size: 0.85em;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .review-stale-regenerate {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #fff);
            border: none;
            padding: 3px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }

        /* === Block regions (invisible, hoverable) === */
        .artifact-block {
            position: relative;
            border-radius: 6px;
            padding: 2px 8px;
            margin: 0 -8px;
            transition: background 0.12s ease;
        }
        .artifact-block:hover {
            background: rgba(255,255,255,0.025);
        }
        .artifact-block-selected {
            background: rgba(90, 130, 180, 0.08);
        }
        .artifact-block-composing {
            background: rgba(200, 170, 80, 0.08);
        }
        .artifact-block-has-open {
            border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
            padding-left: 12px;
        }
        .artifact-block-changed {
            background: rgba(156, 204, 44, 0.06);
        }

        /* Comment button — appears on hover */
        .artifact-block-actions {
            position: absolute;
            right: 8px;
            top: 8px;
            opacity: 0;
            transition: opacity 0.15s ease;
            display: flex;
            gap: 4px;
        }
        .artifact-block:hover .artifact-block-actions {
            opacity: 1;
        }
        .artifact-block-comment-btn {
            background: var(--vscode-button-secondaryBackground, #313131);
            color: var(--vscode-button-secondaryForeground, #ccc);
            border: 1px solid var(--vscode-panel-border, #444);
            padding: 2px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.78em;
        }
        .artifact-block-comment-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground, #3c3c3c);
        }
        .block-comment-count {
            font-size: 0.72em;
            background: var(--vscode-badge-background, #4d4d4d);
            color: var(--vscode-badge-foreground, #fff);
            padding: 1px 7px;
            border-radius: 10px;
            cursor: pointer;
            line-height: 1.5;
        }
        .block-comment-count-open {
            background: var(--vscode-textLink-foreground, #3794ff);
        }
        .block-diff-indicator {
            font-size: 0.7em;
            color: var(--vscode-editorInfo-foreground, #3794ff);
            background: var(--vscode-badge-background, #4d4d4d);
            padding: 1px 6px;
            border-radius: 3px;
        }

        /* === Markdown content === */
        .artifact-block-content h1 {
            font-size: 1.8em;
            font-weight: 600;
            margin: 0 0 16px 0;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border, #333);
            line-height: 1.3;
        }
        .artifact-block-content h2 {
            font-size: 1.35em;
            font-weight: 600;
            margin: 28px 0 12px 0;
            line-height: 1.3;
        }
        .artifact-block-content h3 {
            font-size: 1.1em;
            font-weight: 600;
            margin: 24px 0 8px 0;
            line-height: 1.3;
        }
        .artifact-block-content h4,
        .artifact-block-content h5,
        .artifact-block-content h6 {
            font-size: 1em;
            font-weight: 600;
            margin: 20px 0 6px 0;
        }
        /* First heading in first block */
        .artifact-block:first-child .artifact-block-content h1,
        .artifact-block:first-child .artifact-block-content h2 {
            margin-top: 0;
        }
        .artifact-block-content p {
            margin: 0 0 10px 0;
            line-height: 1.65;
        }
        .artifact-block-content strong {
            font-weight: 600;
            color: var(--vscode-foreground, #e0e0e0);
        }
        .artifact-block-content em {
            font-style: italic;
        }
        .artifact-block-content a {
            color: var(--vscode-textLink-foreground, #3794ff);
            text-decoration: none;
        }
        .artifact-block-content a:hover {
            text-decoration: underline;
        }

        /* Inline code */
        .artifact-block-content code {
            font-family: var(--vscode-editor-font-family, 'Menlo', 'Monaco', 'Courier New', monospace);
            font-size: 0.88em;
            background: rgba(255,255,255,0.08);
            padding: 1px 5px;
            border-radius: 3px;
        }
        /* Code blocks */
        .artifact-block-content pre {
            background: rgba(0,0,0,0.25);
            border: 1px solid var(--vscode-panel-border, #333);
            border-radius: 6px;
            padding: 12px 16px;
            overflow-x: auto;
            margin: 12px 0;
        }
        .artifact-block-content pre code {
            background: none;
            padding: 0;
            font-size: 0.88em;
            line-height: 1.5;
        }

        /* Blockquotes */
        .artifact-block-content blockquote {
            margin: 12px 0;
            padding: 10px 16px;
            border-left: 3px solid var(--vscode-textLink-foreground, #5c7cfa);
            background: rgba(92, 124, 250, 0.04);
            border-radius: 0 6px 6px 0;
        }
        .artifact-block-content blockquote p {
            margin: 0 0 6px 0;
        }
        .artifact-block-content blockquote p:last-child {
            margin-bottom: 0;
        }

        /* Lists */
        .artifact-block-content ul,
        .artifact-block-content ol {
            margin: 8px 0;
            padding-left: 24px;
        }
        .artifact-block-content li {
            margin: 4px 0;
            line-height: 1.6;
        }
        .artifact-block-content li > ul,
        .artifact-block-content li > ol {
            margin: 4px 0;
        }

        /* Tables */
        .artifact-block-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 12px 0;
        }
        .artifact-block-content th,
        .artifact-block-content td {
            border: 1px solid var(--vscode-panel-border, #444);
            padding: 6px 12px;
            text-align: left;
        }
        .artifact-block-content th {
            background: rgba(255,255,255,0.04);
            font-weight: 600;
        }

        /* Horizontal rule */
        .artifact-block-content hr {
            border: none;
            border-top: 1px solid var(--vscode-panel-border, #333);
            margin: 24px 0;
        }

        /* === Inline threads === */
        .block-inline-threads {
            margin: 8px 0 4px 0;
            padding: 0;
        }
        .block-inline-thread {
            padding: 8px 12px;
            margin-bottom: 6px;
            border-radius: 6px;
            background: var(--vscode-editorWidget-background, #252526);
            border: 1px solid var(--vscode-panel-border, #333);
        }
        .block-inline-thread-resolved {
            opacity: 0.45;
        }
        .block-inline-comment {
            margin: 3px 0;
            font-size: 0.9em;
            line-height: 1.45;
        }
        .block-inline-comment-author {
            font-weight: 600;
            font-size: 0.82em;
            margin-right: 6px;
            color: var(--vscode-foreground, #ccc);
        }
        .block-inline-comment-agent .block-inline-comment-author {
            color: var(--vscode-textLink-foreground, #3794ff);
        }
        .block-inline-thread-actions {
            display: flex;
            gap: 8px;
            margin-top: 6px;
        }
        .block-inline-thread-actions button {
            background: none;
            border: none;
            color: var(--vscode-textLink-foreground, #3794ff);
            cursor: pointer;
            font-size: 0.8em;
            padding: 0;
        }
        .block-inline-thread-actions button:hover {
            text-decoration: underline;
        }

        /* === Comment popover === */
        .comment-popover-anchor {
            position: relative;
        }
        .comment-popover {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            top: 4px;
            z-index: 50;
            min-width: 280px;
            max-width: 400px;
            background: var(--vscode-editorWidget-background, #252526);
            border: 1px solid var(--vscode-panel-border, #444);
            border-radius: 8px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.5);
            padding: 10px;
        }
        .comment-composer {
            padding: 0;
        }
        .comment-composer-input {
            width: 100%;
            min-height: 48px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #ccc);
            border: 1px solid var(--vscode-input-border, #555);
            border-radius: 4px;
            padding: 8px 10px;
            font-family: inherit;
            font-size: inherit;
            resize: vertical;
            box-sizing: border-box;
        }
        .comment-composer-input::placeholder {
            color: var(--vscode-input-placeholderForeground, #888);
        }
        .comment-composer-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 8px;
        }
        .comment-composer-cancel {
            background: none;
            color: var(--vscode-foreground, #ccc);
            border: none;
            padding: 4px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .comment-composer-cancel:hover {
            background: rgba(255,255,255,0.06);
        }
        .comment-composer-submit {
            background: var(--vscode-button-secondaryBackground, #313131);
            color: var(--vscode-button-secondaryForeground, #ccc);
            border: 1px solid var(--vscode-panel-border, #555);
            padding: 4px 14px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .comment-composer-submit:hover {
            background: var(--vscode-button-secondaryHoverBackground, #3c3c3c);
        }
        .comment-composer-submit:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        /* === Misc === */
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .artifact-review-empty {
            padding: 48px 32px;
            text-align: center;
            color: var(--vscode-descriptionForeground, #888);
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
