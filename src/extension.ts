import * as vscode from "vscode";

type ReviewRole = "agent" | "me" | "quick-me";
type CriticMarkupAnnotationKind = "addition" | "deletion" | "substitution" | "highlight" | "comment";
type CriticMarkupResolution = "cancel" | "apply";

interface Conversation {
  start: number;
  end: number;
  raw: string;
  roles: ReviewRole[];
}

interface ReviewLine {
  start: number;
  end: number;
  indent: string;
  marker: "@" | "@me" | "@agent";
  body: string;
  bodyStart: number;
}

interface RoleRange {
  role: ReviewRole;
  range: vscode.Range;
}

interface ReviewBlock {
  start: number;
  end: number;
}

let conversationDecorationType: vscode.TextEditorDecorationType | undefined;
let conversationGutterDecorationType: vscode.TextEditorDecorationType | undefined;
let markerDecorationType: vscode.TextEditorDecorationType | undefined;
let agentDecorationType: vscode.TextEditorDecorationType | undefined;
let humanDecorationType: vscode.TextEditorDecorationType | undefined;
let quickHumanDecorationType: vscode.TextEditorDecorationType | undefined;
let okDecorationType: vscode.TextEditorDecorationType | undefined;
let reviewModeEnabled = false;
let reviewModeStatusBarItem: vscode.StatusBarItem | undefined;

const REVIEW_BLOCK_RE =
  /<!--[\s\S]*?-->|\{\?\?[\s\S]*?\?\?\}/g;
const CRITICMARKUP_ANNOTATION_RE =
  /\{\+\+[\s\S]*?\+\+\}|\{--[\s\S]*?--\}|\{==[\s\S]*?==\}|\{>>[\s\S]*?<<\}|\{\?\?[\s\S]*?\?\?\}|\{~~[\s\S]*?~>[\s\S]*?~~\}/g;
const REVIEW_RESOLUTION_RE =
  /<!--[\s\S]*?-->|\{\+\+[\s\S]*?\+\+\}|\{--[\s\S]*?--\}|\{==[\s\S]*?==\}|\{>>[\s\S]*?<<\}|\{\?\?[\s\S]*?\?\?\}|\{~~[\s\S]*?~>[\s\S]*?~~\}/g;

const REVIEW_MARKER_RE = /(^|[ \t\r\n])(@agent|@me|@)(?=[ \t]*:|[ \t\r\n]|$)/g;
const HTML_REVIEW_OPEN = "<!--";
const HTML_REVIEW_CLOSE = "-->";
const CRITICMARKUP_REVIEW_OPEN = "{??";
const CRITICMARKUP_REVIEW_CLOSE = "??}";
const REVIEW_MODE_CONTEXT = "dzMdReview.inReviewMode";
const CATPPUCCIN_LATTE_BLUE = "#1E66F5";
const CATPPUCCIN_LATTE_PEACH = "#FE640B";
const CATPPUCCIN_LATTE_OVERLAY1 = "#8C8FA1";

export function activate(context: vscode.ExtensionContext): void {
  conversationDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(30, 102, 245, 0.07)",
    overviewRulerColor: CATPPUCCIN_LATTE_BLUE,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  conversationGutterDecorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, "assets", "review-comment-gutter.svg"),
    gutterIconSize: "contain",
  });
  markerDecorationType = vscode.window.createTextEditorDecorationType({
    color: CATPPUCCIN_LATTE_OVERLAY1,
    fontStyle: "normal",
    fontWeight: "normal",
  });
  agentDecorationType = vscode.window.createTextEditorDecorationType({
    color: CATPPUCCIN_LATTE_BLUE,
    fontWeight: "bold",
  });
  humanDecorationType = vscode.window.createTextEditorDecorationType({
    color: CATPPUCCIN_LATTE_PEACH,
    fontWeight: "bold",
  });
  quickHumanDecorationType = vscode.window.createTextEditorDecorationType({
    color: CATPPUCCIN_LATTE_PEACH,
    fontWeight: "bold",
  });
  okDecorationType = vscode.window.createTextEditorDecorationType({
    fontWeight: "bold",
  });
  reviewModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  reviewModeStatusBarItem.text = "$(comment-discussion) Review";
  reviewModeStatusBarItem.tooltip = "Markdown Review Mode";
  reviewModeStatusBarItem.command = "dzMdReview.toggleReviewMode";

  context.subscriptions.push(
    conversationDecorationType,
    conversationGutterDecorationType,
    markerDecorationType,
    agentDecorationType,
    humanDecorationType,
    quickHumanDecorationType,
    okDecorationType,
    reviewModeStatusBarItem,
    vscode.commands.registerCommand("dzMdReview.toggleReviewMode", toggleReviewMode),
    vscode.commands.registerCommand("dzMdReview.enterReviewMode", enterReviewMode),
    vscode.commands.registerCommand("dzMdReview.exitReviewMode", exitReviewMode),
    vscode.commands.registerCommand("dzMdReview.approveAgentMessage", approveAgentMessage),
    vscode.commands.registerCommand("dzMdReview.addHumanComment", addHumanComment),
    vscode.commands.registerCommand("dzMdReview.addHumanOk", addHumanOk),
    vscode.commands.registerCommand("dzMdReview.removeHumanOk", removeHumanOk),
    vscode.commands.registerCommand("dzMdReview.createCompactReviewNote", createCompactReviewNote),
    vscode.commands.registerCommand("dzMdReview.createCriticMarkupDiscussion", createCompactCriticMarkupReviewNote),
    vscode.commands.registerCommand("dzMdReview.addCriticMarkupAddition", () => wrapCriticMarkupAnnotation("addition")),
    vscode.commands.registerCommand("dzMdReview.addCriticMarkupDeletion", () => wrapCriticMarkupAnnotation("deletion")),
    vscode.commands.registerCommand("dzMdReview.addCriticMarkupSubstitution", () => wrapCriticMarkupAnnotation("substitution")),
    vscode.commands.registerCommand("dzMdReview.addCriticMarkupHighlight", () => wrapCriticMarkupAnnotation("highlight")),
    vscode.commands.registerCommand("dzMdReview.addCriticMarkupComment", () => wrapCriticMarkupAnnotation("comment")),
    vscode.commands.registerCommand("dzMdReview.cancelCriticMarkupAnnotation", cancelCriticMarkupAnnotation),
    vscode.commands.registerCommand("dzMdReview.applyCriticMarkupAnnotation", applyCriticMarkupAnnotation),
    vscode.commands.registerCommand("dzMdReview.nextReviewBlock", () => moveToReviewBlock("next")),
    vscode.commands.registerCommand("dzMdReview.previousReviewBlock", () => moveToReviewBlock("previous")),
    vscode.commands.registerCommand("dzMdReview.deleteConversation", deleteConversation),
    vscode.commands.registerCommand(
      "dzMdReview.nextConversation",
      () => moveToConversation("next"),
    ),
    vscode.commands.registerCommand(
      "dzMdReview.previousConversation",
      () => moveToConversation("previous"),
    ),
    vscode.window.onDidChangeActiveTextEditor((editor) => updateConversationDecorations(editor)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (event.document === editor?.document) {
        void fillReviewLineAfterNativeNewline(event, editor);
        updateConversationDecorations(editor);
      }
    }),
  );

  void setReviewMode(false);
  updateConversationDecorations(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  // Nothing to dispose manually; subscriptions are owned by VS Code.
}

async function toggleReviewMode(): Promise<void> {
  await setReviewMode(!reviewModeEnabled);
}

async function enterReviewMode(): Promise<void> {
  await setReviewMode(true);
}

async function exitReviewMode(): Promise<void> {
  await setReviewMode(false);
}

async function setReviewMode(enabled: boolean): Promise<void> {
  reviewModeEnabled = enabled;
  updateReviewModeStatus(enabled);
  await vscode.commands.executeCommand("setContext", REVIEW_MODE_CONTEXT, enabled);
}

function updateReviewModeStatus(enabled: boolean): void {
  if (!reviewModeStatusBarItem) {
    return;
  }

  if (enabled) {
    reviewModeStatusBarItem.show();
    return;
  }

  reviewModeStatusBarItem.hide();
}

async function approveAgentMessage(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createCompactQuickHumanNote(editor);
    return;
  }

  const trailingQuickReply = getTrailingQuickHumanReply(conversation);
  if (trailingQuickReply) {
    const position = editor.document.positionAt(conversation.start + trailingQuickReply.bodyStart);
    editor.selection = new vscode.Selection(position, position);
    return;
  }

  if (isInlineConversation(conversation.raw)) {
    await appendInlineQuickHumanReply(editor, conversation);
    return;
  }

  await insertQuickHumanComment();
}

async function addHumanOk(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createCompactHumanNote(editor, "ok");
    return;
  }

  if (getTrailingHumanOkRemoval(conversation)) {
    return;
  }

  const trailingEmptyHumanReply = getTrailingEmptyHumanReply(conversation);
  if (trailingEmptyHumanReply) {
    await fillTrailingEmptyHumanReply(editor, conversation, trailingEmptyHumanReply, "ok");
    return;
  }

  if (isInlineConversation(conversation.raw)) {
    await appendInlineHumanOk(editor, conversation);
    return;
  }

  await insertHumanComment("ok");
}

async function removeHumanOk(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);
  const removal = conversation ? getTrailingHumanOkRemoval(conversation) : undefined;

  if (!conversation || !removal) {
    return;
  }

  await editor.edit((edit) => {
    edit.delete(new vscode.Range(
      editor.document.positionAt(conversation.start + removal.start),
      editor.document.positionAt(conversation.start + removal.end),
    ));
  });
}

async function addHumanComment(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (conversation && isInlineConversation(conversation.raw)) {
    await expandInlineConversation(editor, conversation, "");
    return;
  }

  if (!conversation || !isAtConversationReplyTarget(editor.document, conversation, editor.selection.active)) {
    await vscode.commands.executeCommand("editor.action.insertLineAfter");
    return;
  }

  await insertHumanComment("");
}

async function createCompactReviewNote(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createMultilineQuickHumanConversation(editor);
    return;
  }

  if (isInlineConversation(conversation.raw)) {
    await expandInlineConversation(editor, conversation, undefined);
    return;
  }

  await compactConversation(editor, conversation);
}

async function createCompactCriticMarkupReviewNote(): Promise<void> {
  await createCompactReviewNoteWithMarkers({
    open: CRITICMARKUP_REVIEW_OPEN,
    close: CRITICMARKUP_REVIEW_CLOSE,
  });
}

async function createCompactReviewNoteWithMarkers(markers: { open: string; close: string }): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createCompactHumanNote(editor, "", markers);
    return;
  }

  if (isInlineConversation(conversation.raw)) {
    await expandInlineConversation(editor, conversation, undefined);
    return;
  }

  await compactConversation(editor, conversation);
}

async function wrapCriticMarkupAnnotation(kind: CriticMarkupAnnotationKind): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const annotation = buildCriticMarkupAnnotation(kind, selectedText);

  await editor.edit((edit) => {
    edit.replace(selection, annotation.text);
  });

  const cursor = editor.document.positionAt(editor.document.offsetAt(selection.start) + annotation.cursorOffset);
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function cancelCriticMarkupAnnotation(): Promise<void> {
  await resolveCriticMarkupAnnotation("cancel");
}

async function applyCriticMarkupAnnotation(): Promise<void> {
  await resolveCriticMarkupAnnotation("apply");
}

async function resolveCriticMarkupAnnotation(resolution: CriticMarkupResolution): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const text = editor.document.getText();
  const offset = editor.document.offsetAt(editor.selection.active);
  const annotation = findCurrentCriticMarkupAnnotation(text, offset);

  if (!annotation) {
    void vscode.window.showInformationMessage("No review annotation at cursor.");
    return;
  }

  const replacement = resolution === "apply" ? annotation.apply : annotation.cancel;

  await editor.edit((edit) => {
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(annotation.start),
        editor.document.positionAt(annotation.end),
      ),
      replacement,
    );
  });

  const cursor = editor.document.positionAt(annotation.start + replacement.length);
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function createReviewConversation(editor: vscode.TextEditor, body: string): Promise<void> {
  if (!editor.selection.isEmpty) {
    await createMarkedConversation(editor, body);
    return;
  }

  const line = editor.document.lineAt(editor.selection.active.line);
  await createHumanConversation(editor, body, line.range.end);
}

async function insertHumanComment(body: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createHumanConversation(editor, body);
    return;
  }

  const insertion = buildHumanCommentInsertion(conversation, body);
  const insertOffset = conversation.start + insertion.offset;
  const insertPosition = editor.document.positionAt(insertOffset);

  await editor.edit((edit) => {
    edit.insert(insertPosition, insertion.text);
  });

  if (body === "") {
    const position = editor.document.positionAt(insertOffset + insertion.cursorOffset);
    editor.selection = new vscode.Selection(position, position);
  }
}

async function insertQuickHumanComment(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    await createMultilineQuickHumanConversation(editor);
    return;
  }

  const insertion = buildQuickHumanCommentInsertion(conversation);
  const insertOffset = conversation.start + insertion.offset;
  const insertPosition = editor.document.positionAt(insertOffset);

  await editor.edit((edit) => {
    edit.insert(insertPosition, insertion.text);
  });

  const position = editor.document.positionAt(insertOffset + insertion.cursorOffset);
  editor.selection = new vscode.Selection(position, position);
}

async function createMarkedConversation(editor: vscode.TextEditor, body: string): Promise<void> {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (selectedText.length === 0) {
    await createHumanConversation(editor, body);
    return;
  }

  const endLine = editor.document.lineAt(selection.end.line);
  const bodyIndent = getReviewBodyIndent(endLine.text);
  const messageLine = body === "" ? `${bodyIndent}@me ` : `${bodyIndent}@me ${body}`;
  const markers = getPreferredReviewMarkers();
  const block = `{==${selectedText}==}${markers.open}\n${messageLine}\n${bodyIndent}${markers.close}`;
  const cursorOffset = `{==${selectedText}==}${markers.open}\n${bodyIndent}@me `.length;

  await editor.edit((edit) => {
    edit.replace(selection, block);
  });

  if (body === "") {
    const cursor = editor.document.positionAt(editor.document.offsetAt(selection.start) + cursorOffset);
    editor.selection = new vscode.Selection(cursor, cursor);
  }
}

async function createCompactHumanNote(
  editor: vscode.TextEditor,
  body: string,
  markers = getPreferredReviewMarkers(),
): Promise<void> {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const message = body === "" ? "@me " : `@me ${body}`;
  const compactNote = `${markers.open} ${message} ${markers.close}`;
  const anchor = selectedText.length > 0 ? `{==${selectedText}==}` : "";
  const text = `${anchor}${compactNote}`;
  const cursorOffset = `${anchor}${markers.open} ${message}`.length;

  if (selectedText.length > 0) {
    await editor.edit((edit) => {
      edit.replace(selection, text);
    });
    const cursor = editor.document.positionAt(editor.document.offsetAt(selection.start) + cursorOffset);
    editor.selection = new vscode.Selection(cursor, cursor);
    return;
  }

  const line = editor.document.lineAt(selection.active.line);
  const position = line.range.end;
  const prefix = markers.open === CRITICMARKUP_REVIEW_OPEN
    ? ""
    : line.text.length > 0 && !/[ \t]$/.test(line.text) ? " " : "";

  await editor.edit((edit) => {
    edit.insert(position, `${prefix}${compactNote}`);
  });

  const cursor = editor.document.positionAt(editor.document.offsetAt(position) + prefix.length + cursorOffset);
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function createCompactQuickHumanNote(editor: vscode.TextEditor): Promise<void> {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const markers = { open: HTML_REVIEW_OPEN, close: HTML_REVIEW_CLOSE };
  const message = "@ ";
  const compactNote = `${markers.open} ${message} ${markers.close}`;
  const anchor = selectedText.length > 0 ? `{==${selectedText}==}` : "";
  const text = `${anchor}${compactNote}`;
  const cursorOffset = `${anchor}${markers.open} ${message}`.length;

  if (selectedText.length > 0) {
    await editor.edit((edit) => {
      edit.replace(selection, text);
    });
    const cursor = editor.document.positionAt(editor.document.offsetAt(selection.start) + cursorOffset);
    editor.selection = new vscode.Selection(cursor, cursor);
    return;
  }

  const line = editor.document.lineAt(selection.active.line);
  const position = line.range.end;
  const prefix = line.text.length > 0 && !/[ \t]$/.test(line.text) ? " " : "";

  await editor.edit((edit) => {
    edit.insert(position, `${prefix}${compactNote}`);
  });

  const cursor = editor.document.positionAt(editor.document.offsetAt(position) + prefix.length + cursorOffset);
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function createMultilineQuickHumanConversation(editor: vscode.TextEditor): Promise<void> {
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const markers = { open: HTML_REVIEW_OPEN, close: HTML_REVIEW_CLOSE };

  if (selectedText.length > 0) {
    const endLine = editor.document.lineAt(selection.end.line);
    const bodyIndent = getReviewBodyIndent(endLine.text);
    const block = `{==${selectedText}==}${markers.open}\n${bodyIndent}@ \n${bodyIndent}${markers.close}`;
    const cursorOffset = `{==${selectedText}==}${markers.open}\n${bodyIndent}@ `.length;

    await editor.edit((edit) => {
      edit.replace(selection, block);
    });
    const cursor = editor.document.positionAt(editor.document.offsetAt(selection.start) + cursorOffset);
    editor.selection = new vscode.Selection(cursor, cursor);
    return;
  }

  const line = editor.document.lineAt(selection.active.line);
  const lineText = line.text;
  const baseIndent = lineText.match(/^[ \t]*/)?.[0] ?? "";
  const bodyIndent = getReviewBodyIndent(lineText);
  const block = `${markers.open}\n${bodyIndent}@ \n${bodyIndent}${markers.close}`;
  let cursorOffset = `${markers.open}\n${bodyIndent}@ `.length;

  if (/^[ \t]*$/.test(lineText)) {
    const text = `${baseIndent}${block}`;
    cursorOffset += baseIndent.length;

    await editor.edit((edit) => {
      edit.replace(line.range, text);
    });
    const cursor = editor.document.positionAt(editor.document.offsetAt(line.range.start) + cursorOffset);
    editor.selection = new vscode.Selection(cursor, cursor);
    return;
  }

  const position = line.range.end;
  const prefix = lineText.length > 0 && !/[ \t]$/.test(lineText) ? " " : "";
  const text = `${prefix}${block}`;
  cursorOffset += prefix.length;

  await editor.edit((edit) => {
    edit.insert(position, text);
  });

  const cursor = editor.document.positionAt(editor.document.offsetAt(position) + cursorOffset);
  editor.selection = new vscode.Selection(cursor, cursor);
}

function buildCriticMarkupAnnotation(
  kind: CriticMarkupAnnotationKind,
  selectedText: string,
): { text: string; cursorOffset: number } {
  switch (kind) {
    case "addition":
      return {
        text: `{++${selectedText}++}`,
        cursorOffset: `{++${selectedText}`.length,
      };
    case "deletion":
      return {
        text: `{--${selectedText}--}`,
        cursorOffset: `{--${selectedText}`.length,
      };
    case "substitution":
      return {
        text: `{~~${selectedText}~>~~}`,
        cursorOffset: selectedText.length > 0 ? `{~~${selectedText}~>`.length : "{~~".length,
      };
    case "highlight":
      return {
        text: `{==${selectedText}==}`,
        cursorOffset: `{==${selectedText}`.length,
      };
    case "comment":
      return {
        text: `{>>${selectedText}<<}`,
        cursorOffset: `{>>${selectedText}`.length,
      };
  }
}

function findCurrentCriticMarkupAnnotation(
  text: string,
  offset: number,
): { start: number; end: number; cancel: string; apply: string } | undefined {
  const candidates = [...text.matchAll(REVIEW_RESOLUTION_RE)]
    .map((match) => {
      const raw = match[0];
      const start = match.index ?? 0;
      return {
        start,
        end: start + raw.length,
        raw,
      };
    })
    .filter((annotation) => annotation.start <= offset && offset <= annotation.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start));

  for (const candidate of candidates) {
    const replacement = getCriticMarkupReplacement(candidate.raw);
    if (replacement) {
      return {
        start: candidate.start,
        end: candidate.end,
        ...replacement,
      };
    }
  }

  return undefined;
}

function getCriticMarkupReplacement(raw: string): { cancel: string; apply: string } | undefined {
  if (raw.startsWith("<!--") && raw.endsWith("-->")) {
    return collectReviewRoles(raw).length > 0 ? { cancel: "", apply: "" } : undefined;
  }

  if (raw.startsWith("{++") && raw.endsWith("++}")) {
    return { cancel: "", apply: raw.slice(3, -3) };
  }

  if (raw.startsWith("{--") && raw.endsWith("--}")) {
    return { cancel: raw.slice(3, -3), apply: "" };
  }

  if (raw.startsWith("{==") && raw.endsWith("==}")) {
    const content = raw.slice(3, -3);
    return { cancel: content, apply: content };
  }

  if (raw.startsWith("{>>") && raw.endsWith("<<}")) {
    return { cancel: "", apply: "" };
  }

  if (raw.startsWith("{??") && raw.endsWith("??}")) {
    return { cancel: "", apply: "" };
  }

  if (raw.startsWith("{~~") && raw.endsWith("~~}")) {
    const separator = raw.indexOf("~>", 3);
    if (separator < 0) {
      return undefined;
    }

    return {
      cancel: raw.slice(3, separator),
      apply: raw.slice(separator + 2, -3),
    };
  }

  return undefined;
}

async function createHumanConversation(
  editor: vscode.TextEditor,
  body: string,
  position = editor.selection.active,
): Promise<void> {
  const line = editor.document.lineAt(position.line);
  const lineText = line.text;
  const baseIndent = lineText.match(/^[ \t]*/)?.[0] ?? "";
  const bodyIndent = getReviewBodyIndent(lineText);
  const messageLine = body === "" ? `${bodyIndent}@me ` : `${bodyIndent}@me ${body}`;
  const markers = getPreferredReviewMarkers();
  const block = `${markers.open}\n${messageLine}\n${bodyIndent}${markers.close}`;
  let cursorOffset = `${markers.open}\n${bodyIndent}@me `.length;

  if (/^[ \t]*$/.test(lineText)) {
    const text = `${baseIndent}${block}`;
    cursorOffset += baseIndent.length;

    await editor.edit((edit) => {
      edit.replace(line.range, text);
    });

    if (body === "") {
      const cursor = editor.document.positionAt(editor.document.offsetAt(line.range.start) + cursorOffset);
      editor.selection = new vscode.Selection(cursor, cursor);
    }

    return;
  }

  const beforeCursor = lineText.slice(0, position.character);
  const prefix = beforeCursor.length > 0 && !/[ \t]$/.test(beforeCursor) ? " " : "";
  const text = `${prefix}${block}`;
  cursorOffset += prefix.length;

  await editor.edit((edit) => {
    edit.insert(position, text);
  });

  if (body === "") {
    const cursor = editor.document.positionAt(editor.document.offsetAt(position) + cursorOffset);
    editor.selection = new vscode.Selection(cursor, cursor);
  }
}

async function deleteConversation(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const conversation = findCurrentConversation(conversations, offset);

  if (!conversation) {
    void vscode.window.showInformationMessage("No Markdown review conversation at cursor.");
    return;
  }

  await editor.edit((edit) => {
    edit.delete(
      new vscode.Range(
        editor.document.positionAt(conversation.start),
        editor.document.positionAt(trimTrailingBlankLine(editor.document.getText(), conversation.end)),
      ),
    );
  });
}

function moveToConversation(direction: "next" | "previous"): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const target = direction === "next"
    ? conversations.find((conversation) => conversation.start > offset)
    : [...conversations]
      .reverse()
      .find((conversation) => conversation.end < offset);

  if (!target) {
    void vscode.window.showInformationMessage(`No ${direction} Markdown review conversation.`);
    return;
  }

  const position = editor.document.positionAt(target.start);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

function moveToReviewBlock(direction: "next" | "previous"): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const blocks = collectReviewBlocks(editor.document.getText());
  const offset = editor.document.offsetAt(editor.selection.active);
  const target = direction === "next"
    ? blocks.find((block) => block.start > offset)
    : [...blocks]
      .reverse()
      .find((block) => block.end < offset);

  if (!target) {
    void vscode.window.showInformationMessage(`No ${direction} Markdown review block.`);
    return;
  }

  const position = editor.document.positionAt(target.start);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

function collectConversations(text: string): Conversation[] {
  const conversations: Conversation[] = [];

  for (const match of text.matchAll(REVIEW_BLOCK_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const roles = collectReviewRoles(raw);

    if (roles.length > 0) {
      conversations.push({
        start,
        end: start + raw.length,
        raw,
        roles,
      });
    }
  }

  return conversations;
}

function collectReviewBlocks(text: string): ReviewBlock[] {
  const blocks = [
    ...collectConversations(text).map(({ start, end }) => ({ start, end })),
    ...[...text.matchAll(CRITICMARKUP_ANNOTATION_RE)].map((match) => {
      const start = match.index ?? 0;
      return {
        start,
        end: start + match[0].length,
      };
    }),
  ];
  const seen = new Set<string>();

  return blocks
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((block) => {
      const key = `${block.start}:${block.end}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function collectReviewRoles(raw: string): ReviewRole[] {
  const roles = new Set<ReviewRole>();

  for (const line of getReviewLines(raw)) {
    roles.add(line.marker === "@agent" ? "agent" : line.marker === "@me" ? "me" : "quick-me");
  }

  return [...roles];
}

function findLastReviewLine(raw: string): ReviewLine | undefined {
  const reviewLines = getReviewLines(raw);
  return reviewLines[reviewLines.length - 1];
}

function buildHumanCommentInsertion(
  conversation: Conversation,
  body: string,
): { offset: number; text: string; cursorOffset: number } {
  const closeMarker = getConversationCloseMarker(conversation.raw);
  const closeIndex = conversation.raw.lastIndexOf(closeMarker);
  const beforeClose = conversation.raw.slice(0, closeIndex);
  const lastReviewLine = [...beforeClose.matchAll(/^([ \t]*)@(agent|me)?(?=\s*:|\s|$).*$/gm)].pop();
  const indent = lastReviewLine?.[1] ?? "";
  const closeLineStart = beforeClose.lastIndexOf("\n") + 1;
  const beforeCloseLine = conversation.raw.slice(closeLineStart, closeIndex);
  const line = body === "" ? `${indent}@me \n` : `${indent}@me ${body}\n`;
  const cursorInLine = `${indent}@me `.length;

  if (/^[ \t]*$/.test(beforeCloseLine)) {
    return {
      offset: closeLineStart,
      text: line,
      cursorOffset: cursorInLine,
    };
  }

  const prefix = beforeClose.endsWith("\n") ? "" : "\n";
  return {
    offset: closeIndex,
    text: `${prefix}${line}`,
    cursorOffset: prefix.length + cursorInLine,
  };
}

function buildQuickHumanCommentInsertion(
  conversation: Conversation,
): { offset: number; text: string; cursorOffset: number } {
  const closeMarker = getConversationCloseMarker(conversation.raw);
  const closeIndex = conversation.raw.lastIndexOf(closeMarker);
  const beforeClose = conversation.raw.slice(0, closeIndex);
  const lastReviewLine = [...beforeClose.matchAll(/^([ \t]*)@(agent|me)?(?=\s*:|\s|$).*$/gm)].pop();
  const indent = lastReviewLine?.[1] ?? "";
  const closeLineStart = beforeClose.lastIndexOf("\n") + 1;
  const beforeCloseLine = conversation.raw.slice(closeLineStart, closeIndex);
  const line = `${indent}@ \n`;
  const cursorInLine = `${indent}@ `.length;

  if (/^[ \t]*$/.test(beforeCloseLine)) {
    return {
      offset: closeLineStart,
      text: line,
      cursorOffset: cursorInLine,
    };
  }

  const prefix = beforeClose.endsWith("\n") ? "" : "\n";
  return {
    offset: closeIndex,
    text: `${prefix}${line}`,
    cursorOffset: prefix.length + cursorInLine,
  };
}

async function fillReviewLineAfterNativeNewline(
  event: vscode.TextDocumentChangeEvent,
  editor: vscode.TextEditor,
): Promise<void> {
  void event;
  void editor;
}

async function expandInlineConversation(
  editor: vscode.TextEditor,
  conversation: Conversation,
  humanBody: string | undefined,
): Promise<void> {
  const markers = getConversationMarkers(conversation.raw);
  const line = editor.document.lineAt(editor.document.positionAt(conversation.start).line);
  const indent = getReviewBodyIndent(line.text);
  const reviewLines = getReviewLines(conversation.raw);
  const contentLines = reviewLines.length > 0
    ? reviewLines.map((reviewLine) => `${indent}${formatReviewLine(conversation.raw, reviewLine)}`)
    : [`${indent}${getConversationContent(conversation.raw).trim()}`];
  const lines = [
    markers.open,
    ...contentLines,
  ];
  let cursorOffset: number | undefined = lines.join("\n").length;

  if (humanBody !== undefined) {
    const humanLine = humanBody === "" ? `${indent}@me ` : `${indent}@me ${humanBody}`;
    lines.push(humanLine);
    cursorOffset = lines.join("\n").length;
  }

  lines.push(`${indent}${markers.close}`);
  const replacement = lines.join("\n");

  await editor.edit((edit) => {
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(conversation.start),
        editor.document.positionAt(conversation.end),
      ),
      replacement,
    );
  });

  const cursor = editor.document.positionAt(conversation.start + cursorOffset);
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function appendInlineHumanOk(
  editor: vscode.TextEditor,
  conversation: Conversation,
): Promise<void> {
  const closeStart = getConversationCloseStart(conversation.raw);
  const beforeClose = conversation.raw.slice(0, closeStart);
  const prefix = /[ \t\r\n]$/.test(beforeClose) ? "" : " ";
  const insertOffset = conversation.start + closeStart;

  await editor.edit((edit) => {
    edit.insert(editor.document.positionAt(insertOffset), `${prefix}@me ok `);
  });
}

async function fillTrailingEmptyHumanReply(
  editor: vscode.TextEditor,
  conversation: Conversation,
  line: ReviewLine,
  body: string,
): Promise<void> {
  const markerStart = getReviewLineMarkerStart(line);
  const lineStart = conversation.start + markerStart;
  const lineEnd = conversation.start + line.end;
  const prefix = conversation.raw.slice(markerStart, line.bodyStart).trimEnd();
  const replacement = isInlineConversation(conversation.raw) ? `${prefix} ${body} ` : `${prefix} ${body}`;
  const cursorOffset = lineStart + replacement.length;

  await editor.edit((edit) => {
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(lineStart),
        editor.document.positionAt(lineEnd),
      ),
      replacement,
    );
  });

  const cursor = editor.document.positionAt(cursorOffset);
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function appendInlineQuickHumanReply(
  editor: vscode.TextEditor,
  conversation: Conversation,
): Promise<void> {
  const closeStart = getConversationCloseStart(conversation.raw);
  const beforeClose = conversation.raw.slice(0, closeStart);
  const prefix = /[ \t\r\n]$/.test(beforeClose) ? "" : " ";
  const insertOffset = conversation.start + closeStart;
  const insertion = `${prefix}@  `;

  await editor.edit((edit) => {
    edit.insert(editor.document.positionAt(insertOffset), insertion);
  });

  const cursor = editor.document.positionAt(insertOffset + prefix.length + "@ ".length);
  editor.selection = new vscode.Selection(cursor, cursor);
}

async function compactConversation(
  editor: vscode.TextEditor,
  conversation: Conversation,
): Promise<void> {
  const markers = getConversationMarkers(conversation.raw);
  const messages = getReviewLines(conversation.raw)
    .map((line) => formatReviewLine(conversation.raw, line))
    .join(" ");
  const compact = `${markers.open} ${messages} ${markers.close}`;

  await editor.edit((edit) => {
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(conversation.start),
        editor.document.positionAt(conversation.end),
      ),
      compact,
    );
  });
}

function updateConversationDecorations(editor: vscode.TextEditor | undefined): void {
  if (!editor || editor.document.languageId !== "markdown") {
    return;
  }

  const conversations = collectConversations(editor.document.getText());
  const contentDecorations = conversations.flatMap((conversation) =>
    getConversationContentRanges(editor.document, conversation)
  );
  const markerDecorations = conversations.flatMap((conversation) =>
    getConversationMarkerRanges(editor.document, conversation)
  );
  const roleDecorations = conversations.flatMap((conversation) =>
    getConversationRoleRanges(editor.document, conversation)
  );
  const okDecorations = conversations.flatMap((conversation) =>
    getConversationOkRanges(editor.document, conversation)
  );
  const gutterDecorations = conversations.map((conversation) => {
    const line = editor.document.positionAt(conversation.start).line;
    return new vscode.Range(line, 0, line, 0);
  });

  conversationDecorationType && editor.setDecorations(conversationDecorationType, contentDecorations);
  markerDecorationType && editor.setDecorations(markerDecorationType, markerDecorations);
  agentDecorationType && editor.setDecorations(
    agentDecorationType,
    roleDecorations.filter((decoration) => decoration.role === "agent").map((decoration) => decoration.range),
  );
  humanDecorationType && editor.setDecorations(
    humanDecorationType,
    roleDecorations.filter((decoration) => decoration.role === "me").map((decoration) => decoration.range),
  );
  quickHumanDecorationType && editor.setDecorations(
    quickHumanDecorationType,
    roleDecorations.filter((decoration) => decoration.role === "quick-me").map((decoration) => decoration.range),
  );
  okDecorationType && editor.setDecorations(okDecorationType, okDecorations);
  conversationGutterDecorationType && editor.setDecorations(conversationGutterDecorationType, gutterDecorations);
}

function getConversationContentRanges(
  document: vscode.TextDocument,
  conversation: Conversation,
): vscode.Range[] {
  const { open: openMarker, close: closeMarker } = getConversationMarkers(conversation.raw);
  const openEnd = openMarker.length;
  const closeStart = conversation.raw.lastIndexOf(closeMarker);

  if (closeStart < openEnd) {
    return [];
  }

  let contentStart = openEnd;
  const afterOpen = conversation.raw.slice(contentStart, closeStart);
  const markerOnlyOpeningLine = afterOpen.match(/^[ \t]*(?:\r?\n)/);
  const inlinePadding = afterOpen.match(/^[ \t]+/);
  if (markerOnlyOpeningLine) {
    contentStart += markerOnlyOpeningLine[0].length;
  } else if (inlinePadding) {
    contentStart += inlinePadding[0].length;
  }

  let contentEnd = closeStart;
  const closeLineStart = conversation.raw.lastIndexOf("\n", closeStart) + 1;
  if (/^[ \t]*$/.test(conversation.raw.slice(closeLineStart, closeStart))) {
    contentEnd = closeLineStart;
  }

  if (contentStart >= contentEnd) {
    return [];
  }

  return [new vscode.Range(
    document.positionAt(conversation.start + contentStart),
    document.positionAt(conversation.start + contentEnd),
  )];
}

function getConversationMarkerRanges(
  document: vscode.TextDocument,
  conversation: Conversation,
): vscode.Range[] {
  const { open: openMarker, close: closeMarker } = getConversationMarkers(conversation.raw);
  const closeStart = conversation.raw.lastIndexOf(closeMarker);

  if (closeStart < openMarker.length) {
    return [];
  }

  return [
    new vscode.Range(
      document.positionAt(conversation.start),
      document.positionAt(conversation.start + openMarker.length),
    ),
    new vscode.Range(
      document.positionAt(conversation.start + closeStart),
      document.positionAt(conversation.start + closeStart + closeMarker.length),
    ),
  ];
}

function getConversationRoleRanges(
  document: vscode.TextDocument,
  conversation: Conversation,
): RoleRange[] {
  return getReviewLines(conversation.raw).map((line) => {
    const role = line.marker === "@agent"
      ? "agent"
      : line.marker === "@me" ? "me" : "quick-me";
    const start = conversation.start + getReviewLineMarkerStart(line);
    const end = conversation.start + getReviewLineMarkerEnd(conversation.raw, line);

    return {
      role,
      range: new vscode.Range(document.positionAt(start), document.positionAt(end)),
    };
  });
}

function getConversationOkRanges(
  document: vscode.TextDocument,
  conversation: Conversation,
): vscode.Range[] {
  return getReviewLines(conversation.raw)
    .filter((line) => line.marker === "@me" && line.body.trim().toLowerCase() === "ok")
    .map((line) => {
      const leadingWhitespaceLength = line.body.match(/^[ \t]*/)?.[0].length ?? 0;
      const okStart = conversation.start + line.bodyStart + leadingWhitespaceLength;
      const okEnd = okStart + line.body.trim().length;

      return new vscode.Range(document.positionAt(okStart), document.positionAt(okEnd));
    });
}

function findCurrentConversation(conversations: Conversation[], offset: number): Conversation | undefined {
  return conversations.find((conversation) => conversation.start <= offset && offset <= conversation.end);
}

function isAtConversationReplyTarget(
  document: vscode.TextDocument,
  conversation: Conversation,
  position: vscode.Position,
): boolean {
  const closeStart = getConversationCloseStart(conversation.raw);
  if (closeStart < 0) {
    return false;
  }

  const closeLine = document.positionAt(conversation.start + closeStart).line;
  if (position.line === closeLine) {
    return true;
  }

  const lastReviewLine = findLastReviewLine(conversation.raw);
  if (!lastReviewLine) {
    return false;
  }

  const lastReviewLineNumber = document.positionAt(conversation.start + lastReviewLine.start).line;
  if (position.line === lastReviewLineNumber) {
    return true;
  }

  const lastContentLineStart = getLastNonBlankContentLineStart(conversation.raw);
  if (lastContentLineStart === undefined) {
    return false;
  }

  const lastContentLineNumber = document.positionAt(conversation.start + lastContentLineStart).line;
  return position.line === lastContentLineNumber;
}

function trimTrailingBlankLine(text: string, offset: number): number {
  const trailingBlankLine = text.slice(offset).match(/^(?:[ \t]*\r?\n){1,2}/);
  return trailingBlankLine ? offset + trailingBlankLine[0].length : offset;
}

function isListItemLine(line: string): boolean {
  return /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(line);
}

function getReviewBodyIndent(line: string): string {
  const baseIndent = line.match(/^[ \t]*/)?.[0] ?? "";
  return isListItemLine(line) ? `${baseIndent}  ` : baseIndent;
}

function getConversationCloseMarker(raw: string): string {
  return getConversationMarkers(raw).close;
}

function getConversationCloseStart(raw: string): number {
  return raw.lastIndexOf(getConversationCloseMarker(raw));
}

function getReviewLines(raw: string): ReviewLine[] {
  const markers = getConversationMarkers(raw);
  const content = getConversationContent(raw);
  const baseOffset = markers.open.length;
  const markerMatches = [...content.matchAll(REVIEW_MARKER_RE)]
    .map((match) => {
      const markerStart = (match.index ?? 0) + match[1].length;
      return {
        markerStart,
        marker: match[2] as ReviewLine["marker"],
      };
    });

  return markerMatches.map((match, index) => {
    const nextMarkerStart = markerMatches[index + 1]?.markerStart ?? content.length;
    const lineStart = content.lastIndexOf("\n", match.markerStart - 1) + 1;
    const leadingText = content.slice(lineStart, match.markerStart);
    const indent = /^[ \t]*$/.test(leadingText) ? leadingText : "";
    const start = indent.length > 0 ? lineStart : match.markerStart;
    const bodyStart = getReviewBodyStart(content, match.markerStart + match.marker.length);
    const bodyEnd = trimReviewBodyEnd(content, bodyStart, nextMarkerStart);

    return {
      start: baseOffset + start,
      end: baseOffset + bodyEnd,
      indent,
      marker: match.marker,
      body: content.slice(bodyStart, bodyEnd),
      bodyStart: baseOffset + bodyStart,
    };
  });
}

function getReviewBodyStart(content: string, offset: number): number {
  let cursor = offset;

  while (content[cursor] === " " || content[cursor] === "\t") {
    cursor += 1;
  }

  if (content[cursor] === ":") {
    cursor += 1;
    while (content[cursor] === " " || content[cursor] === "\t") {
      cursor += 1;
    }
  }

  return cursor;
}

function trimReviewBodyEnd(content: string, bodyStart: number, bodyEnd: number): number {
  let cursor = bodyEnd;

  while (cursor > bodyStart && /[ \t\r\n]/.test(content[cursor - 1])) {
    cursor -= 1;
  }

  return cursor;
}

function getReviewLineMarkerStart(line: ReviewLine): number {
  return line.start + line.indent.length;
}

function getReviewLineMarkerEnd(raw: string, line: ReviewLine): number {
  if (line.marker === "@") {
    return getReviewLineMarkerStart(line) + line.marker.length;
  }

  let end = getReviewLineMarkerStart(line) + line.marker.length;
  while (raw[end] === " " || raw[end] === "\t") {
    end += 1;
  }

  return raw[end] === ":" ? end + 1 : getReviewLineMarkerStart(line) + line.marker.length;
}

function getLastNonBlankContentLineStart(raw: string): number | undefined {
  const closeStart = getConversationCloseStart(raw);
  if (closeStart < 0) {
    return undefined;
  }

  let end = closeStart;
  while (end > 0 && /[ \t\r\n]/.test(raw[end - 1])) {
    end -= 1;
  }

  if (end <= getConversationMarkers(raw).open.length) {
    return undefined;
  }

  return raw.lastIndexOf("\n", end - 1) + 1;
}

function getTrailingHumanOkRemoval(conversation: Conversation): { start: number; end: number } | undefined {
  const lastLine = findLastReviewLine(conversation.raw);
  if (!lastLine || lastLine.marker !== "@me" || lastLine.body.trim().toLowerCase() !== "ok") {
    return undefined;
  }

  let start = lastLine.start;
  let end = lastLine.end;

  if (isInlineConversation(conversation.raw) && start > 0 && /[ \t]/.test(conversation.raw[start - 1])) {
    start -= 1;
  }

  if (conversation.raw[end] === "\r" && conversation.raw[end + 1] === "\n") {
    end += 2;
  } else if (conversation.raw[end] === "\n") {
    end += 1;
  } else if (start > 0 && conversation.raw[start - 1] === "\n") {
    start -= conversation.raw[start - 2] === "\r" ? 2 : 1;
  }

  return { start, end };
}

function getTrailingQuickHumanReply(conversation: Conversation): ReviewLine | undefined {
  const lastLine = findLastReviewLine(conversation.raw);
  return lastLine?.marker === "@" && lastLine.body.trim() === "" ? lastLine : undefined;
}

function getTrailingEmptyHumanReply(conversation: Conversation): ReviewLine | undefined {
  const lastLine = findLastReviewLine(conversation.raw);
  return lastLine && (lastLine.marker === "@" || lastLine.marker === "@me") && lastLine.body.trim() === ""
    ? lastLine
    : undefined;
}

function formatReviewLine(raw: string, line: ReviewLine): string {
  const markerStart = getReviewLineMarkerStart(line);
  const prefix = raw.slice(markerStart, line.bodyStart).trimEnd();
  const body = line.body.trimEnd();
  return body.length > 0 ? `${prefix} ${body}` : `${prefix} `;
}

function getPreferredCommentSyntax(): "html" | "custom" {
  const value = vscode.workspace.getConfiguration("dzMdReview").get<string>("commentSyntax");
  return value === "custom" || value === "criticmarkup-like" ? "custom" : "html";
}

function getPreferredReviewMarkers(): { open: string; close: string } {
  return getPreferredCommentSyntax() === "custom"
    ? { open: CRITICMARKUP_REVIEW_OPEN, close: CRITICMARKUP_REVIEW_CLOSE }
    : { open: HTML_REVIEW_OPEN, close: HTML_REVIEW_CLOSE };
}

function getConversationMarkers(raw: string): { open: string; close: string } {
  if (raw.startsWith(CRITICMARKUP_REVIEW_OPEN)) {
    return { open: CRITICMARKUP_REVIEW_OPEN, close: CRITICMARKUP_REVIEW_CLOSE };
  }

  return { open: HTML_REVIEW_OPEN, close: HTML_REVIEW_CLOSE };
}

function getConversationContent(raw: string): string {
  const markers = getConversationMarkers(raw);
  const closeStart = raw.lastIndexOf(markers.close);
  return closeStart > markers.open.length
    ? raw.slice(markers.open.length, closeStart)
    : "";
}

function isInlineConversation(raw: string): boolean {
  return !isMultilineConversation(raw);
}

function isMultilineConversation(raw: string): boolean {
  return /^(?:<!--|\{\?\?)[ \t]*\r?\n/.test(raw);
}
