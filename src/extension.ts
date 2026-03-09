import * as vscode from 'vscode';
import { ArtifactReviewEditorProvider } from './editor-provider';
import { artifactPaths } from './node/artifact-file-service';

export function activate(context: vscode.ExtensionContext): void {
    // Register the custom editor provider for *.md.resolved files
    const provider = new ArtifactReviewEditorProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            ArtifactReviewEditorProvider.viewType,
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true },
            },
        ),
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('artifact-review.addComment', () => {
            vscode.window.showInformationMessage('Use the Comment button on a block in the artifact editor.');
        }),
        vscode.commands.registerCommand('artifact-review.approve', () => {
            vscode.window.showInformationMessage('Use the Approve button in the artifact editor toolbar.');
        }),
        vscode.commands.registerCommand('artifact-review.requestChanges', () => {
            vscode.window.showInformationMessage('Use the Request Changes button in the artifact editor toolbar.');
        }),
        vscode.commands.registerCommand('artifact-review.regenerate', () => {
            vscode.window.showInformationMessage('Use the Regenerate button in the artifact editor toolbar.');
        }),
        vscode.commands.registerCommand('artifact-review.markResolved', () => {
            vscode.window.showInformationMessage('Use the Resolve button on a thread in the artifact editor.');
        }),
        vscode.commands.registerCommand('artifact-review.openSource', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                // Try to find a .md.resolved file in the active tab
                const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
                if (activeTab?.input && 'uri' in (activeTab.input as { uri?: vscode.Uri })) {
                    const uri = (activeTab.input as { uri: vscode.Uri }).uri;
                    if (uri.fsPath.endsWith('.md.resolved')) {
                        const sourcePath = uri.fsPath.slice(0, -'.resolved'.length);
                        await vscode.window.showTextDocument(vscode.Uri.file(sourcePath));
                        return;
                    }
                }
                vscode.window.showWarningMessage('No artifact editor is active.');
                return;
            }
            const fsPath = editor.document.uri.fsPath;
            if (fsPath.endsWith('.md.resolved')) {
                const sourcePath = fsPath.slice(0, -'.resolved'.length);
                await vscode.window.showTextDocument(vscode.Uri.file(sourcePath));
            }
        }),
        vscode.commands.registerCommand('artifact-review.openSidecar', async () => {
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (activeTab?.input && 'uri' in (activeTab.input as { uri?: vscode.Uri })) {
                const uri = (activeTab.input as { uri: vscode.Uri }).uri;
                if (uri.fsPath.endsWith('.md.resolved')) {
                    const sourcePath = uri.fsPath.slice(0, -'.resolved'.length);
                    const paths = artifactPaths(sourcePath);
                    try {
                        await vscode.window.showTextDocument(vscode.Uri.file(paths.comments));
                    } catch {
                        vscode.window.showWarningMessage('No comment sidecar file found.');
                    }
                    return;
                }
            }
            vscode.window.showWarningMessage('No artifact editor is active.');
        }),
    );
}

export function deactivate(): void {
    // Cleanup handled by disposables
}
