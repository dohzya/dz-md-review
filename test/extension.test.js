const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function offsetAt(text, position) {
  const lines = text.split("\n");
  return lines.slice(0, position.line).join("\n").length
    + (position.line === 0 ? 0 : 1)
    + position.character;
}

function positionAt(text, offset) {
  let remaining = offset;
  const lines = text.split("\n");

  for (let line = 0; line < lines.length; line += 1) {
    if (remaining <= lines[line].length) {
      return { line, character: remaining };
    }

    remaining -= lines[line].length + 1;
  }

  return { line: lines.length - 1, character: lines.at(-1).length };
}

function createHarness() {
  let commentSyntax = "html";
  const executedCommands = [];
  const mockVscode = {
    window: {
      activeTextEditor: undefined,
      createTextEditorDecorationType() {
        return {};
      },
      onDidChangeActiveTextEditor() {
        return {};
      },
      showInformationMessage() {},
    },
    workspace: {
      getConfiguration() {
        return {
          get() {
            return commentSyntax;
          },
        };
      },
      onDidChangeTextDocument() {
        return {};
      },
    },
    commands: {
      registerCommand() {
        return {};
      },
      executeCommand(command) {
        executedCommands.push(command);
        return Promise.resolve();
      },
    },
    Uri: {
      joinPath() {
        return "icon";
      },
    },
    OverviewRulerLane: {
      Right: 1,
    },
    Range: class Range {
      constructor(start, endOrStartCharacter, endLine, endCharacter) {
        if (typeof endOrStartCharacter === "number") {
          this.start = { line: start, character: endOrStartCharacter };
          this.end = { line: endLine, character: endCharacter };
        } else {
          this.start = start;
          this.end = endOrStartCharacter;
        }
      }
    },
    Selection: class Selection {
      constructor(start, end) {
        this.start = start;
        this.end = end;
        this.active = end;
        this.isEmpty = start.line === end.line && start.character === end.character;
      }
    },
    TextEditorRevealType: {
      InCenterIfOutsideViewport: 1,
    },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "..", "out", "extension.js"), "utf8")
    + "\nmodule.exports.__test = { addHumanComment, addHumanOk, applyCriticMarkupAnnotation, approveAgentMessage, cancelCriticMarkupAnnotation, collectConversations, createCompactCriticMarkupReviewNote, createCompactReviewNote, createReviewConversation, fillReviewLineAfterNativeNewline, getConversationContentRanges, getConversationMarkerRanges, getConversationOkRanges, getConversationRoleRanges, moveToReviewBlock, removeHumanOk, wrapCriticMarkupAnnotation };";

  vm.runInNewContext(source, {
    require(name) {
      return name === "vscode" ? mockVscode : require(name);
    },
    module,
    exports: module.exports,
  });

  function createEditor(text, start, end = start) {
    const editor = {
      selection: new mockVscode.Selection(start, end),
      document: {
        languageId: "markdown",
        text,
        get lineCount() {
          return this.text.split("\n").length;
        },
        getText(range) {
          if (!range) {
            return this.text;
          }

          return this.text.slice(offsetAt(this.text, range.start), offsetAt(this.text, range.end));
        },
        lineAt(line) {
          const lines = this.text.split("\n");
          return {
            text: lines[line],
            range: {
              start: { line, character: 0 },
              end: { line, character: lines[line].length },
            },
          };
        },
        offsetAt(position) {
          return offsetAt(this.text, position);
        },
        positionAt(offset) {
          return positionAt(this.text, offset);
        },
      },
      async edit(callback) {
        const edits = [];
        callback({
          insert: (position, value) => edits.push({ type: "insert", position, value }),
          replace: (range, value) => edits.push({ type: "replace", range, value }),
          delete: (range) => edits.push({ type: "replace", range, value: "" }),
        });

        for (const edit of edits.reverse()) {
          if (edit.type === "insert") {
            const offset = offsetAt(this.document.text, edit.position);
            this.document.text = this.document.text.slice(0, offset)
              + edit.value
              + this.document.text.slice(offset);
          } else {
            const startOffset = offsetAt(this.document.text, edit.range.start);
            const endOffset = offsetAt(this.document.text, edit.range.end);
            this.document.text = this.document.text.slice(0, startOffset)
              + edit.value
              + this.document.text.slice(endOffset);
          }
        }
      },
      revealRange() {},
      setDecorations() {},
    };

    mockVscode.window.activeTextEditor = editor;
    return editor;
  }

  return {
    api: module.exports.__test,
    createEditor,
    executedCommands,
    setCommentSyntax(value) {
      commentSyntax = value;
    },
  };
}

test("creates an HTML review conversation for selected text and places the cursor after @me", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("html");
  const editor = harness.createEditor("foo bar baz", { line: 0, character: 4 }, { line: 0, character: 7 });

  await harness.api.createReviewConversation(editor, "");

  assert.equal(editor.document.text, "foo {==bar==}<!--\n@me \n--> baz");
  assert.deepEqual(editor.selection.active, { line: 1, character: 4 });
});

test("creates a custom review conversation for selected text", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("custom");
  const editor = harness.createEditor("foo bar baz", { line: 0, character: 4 }, { line: 0, character: 7 });

  await harness.api.createReviewConversation(editor, "");

  assert.equal(editor.document.text, "foo {==bar==}{??\n@me \n??} baz");
  assert.deepEqual(editor.selection.active, { line: 1, character: 4 });
});

test("cmd+enter expands a compact inline note and adds @me", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo {?? @agent note inline ??} baz", { line: 0, character: 8 });

  await harness.api.addHumanComment();

  assert.equal(editor.document.text, "foo {??\n@agent note inline\n@me \n??} baz");
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 2, character: 4 });
});

test("cmd+enter expands a compact HTML note and adds @me", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo <!-- @agent note inline --> baz", { line: 0, character: 9 });

  await harness.api.addHumanComment();

  assert.equal(editor.document.text, "foo <!--\n@agent note inline\n@me \n--> baz");
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 2, character: 4 });
});

test("cmd+alt+enter appends a quick reply inline in a compact inline note", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo {?? @agent note inline ??} baz", { line: 0, character: 8 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "foo {?? @agent note inline @  ??} baz");
  assert.deepEqual(editor.selection.active, { line: 0, character: 29 });
});

test("cmd+alt+enter appends a quick reply inline in a compact HTML note", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo <!-- @agent note inline --> baz", { line: 0, character: 9 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "foo <!-- @agent note inline @  --> baz");
  assert.deepEqual(editor.selection.active, { line: 0, character: 30 });
});

test("cmd+alt+enter reuses a trailing inline quick reply", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note @  ??}", { line: 0, character: 5 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "{?? @agent note @  ??}");
  assert.deepEqual(editor.selection.active, { line: 0, character: 19 });
});

test("addHumanOk only adds ok and removeHumanOk only removes ok", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note ??}", { line: 0, character: 5 });

  await harness.api.addHumanOk();
  assert.equal(editor.document.text, "{?? @agent note @me ok ??}");

  await harness.api.addHumanOk();
  assert.equal(editor.document.text, "{?? @agent note @me ok ??}");

  await harness.api.removeHumanOk();
  assert.equal(editor.document.text, "{?? @agent note ??}");

  await harness.api.removeHumanOk();
  assert.equal(editor.document.text, "{?? @agent note ??}");
});

test("compact inline notes in list items keep inline quick replies", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("- B {?? @agent note ??}", { line: 0, character: 8 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "- B {?? @agent note @  ??}");
  assert.deepEqual(editor.selection.active, { line: 0, character: 22 });
});

test("cmd+alt+enter appends a quick reply after a trailing @me ok line", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n@me ok\n-->", { line: 3, character: 0 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "<!--\n@agent note\n@me ok\n@ \n-->");
  assert.deepEqual(editor.selection.active, { line: 3, character: 2 });
});

test("cmd+alt+enter preserves colonless @me ok lines and appends a quick reply", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n@me ok\n-->", { line: 3, character: 0 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "<!--\n@agent note\n@me ok\n@ \n-->");
  assert.deepEqual(editor.selection.active, { line: 3, character: 2 });
});

test("cmd+alt+enter adds a quick reply when the conversation does not end with ok", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n@me question\n-->", { line: 3, character: 0 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "<!--\n@agent note\n@me question\n@ \n-->");
  assert.deepEqual(editor.selection.active, { line: 3, character: 2 });
});

test("cmd+alt+enter reuses a trailing multiline quick reply", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n@ \n-->", { line: 3, character: 0 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "<!--\n@agent note\n@ \n-->");
  assert.deepEqual(editor.selection.active, { line: 2, character: 2 });
});

test("cmd+enter delegates to native newline away from the end of a conversation", async () => {
  const harness = createHarness();
  harness.createEditor("<!--\n@agent note\n@me question\n-->", { line: 1, character: 0 });

  await harness.api.addHumanComment();

  assert.deepEqual(harness.executedCommands, ["editor.action.insertLineAfter"]);
});

test("cmd+enter inserts @me on the close marker line", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note\n-->", { line: 2, character: 0 });

  await harness.api.addHumanComment();

  assert.equal(editor.document.text, "<!--\n@agent note\n@me \n-->");
  assert.deepEqual(harness.executedCommands, []);
});

test("cmd+enter inserts @me from the @agent line of a simple HTML conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!--\n@agent note isolée\n-->", { line: 1, character: 0 });

  await harness.api.addHumanComment();

  assert.equal(editor.document.text, "<!--\n@agent note isolée\n@me \n-->");
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 2, character: 4 });
});

test("cmd+enter inserts @me after the last message before the close marker", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "- B {??\n  @agent note custom sur un élément d'une liste\n  @me réponse humaine\n  ??}",
    { line: 2, character: 2 },
  );

  await harness.api.addHumanComment();

  assert.equal(
    editor.document.text,
    "- B {??\n  @agent note custom sur un élément d'une liste\n  @me réponse humaine\n  @me \n  ??}",
  );
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 3, character: 6 });
});

test("cmd+enter inserts @me after a colonless last message at line end", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "<!--\n@agent note sans deux-points\n-->",
    { line: 1, character: "@agent note sans deux-points".length },
  );

  await harness.api.addHumanComment();

  assert.equal(editor.document.text, "<!--\n@agent note sans deux-points\n@me \n-->");
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 2, character: 4 });
});

test("cmd+enter inserts @me after the last content line of a multiline message", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "<!--\n@agent note sur plusieurs lignes\nsuite de la note\n-->",
    { line: 2, character: "suite de la note".length },
  );

  await harness.api.addHumanComment();

  assert.equal(editor.document.text, "<!--\n@agent note sur plusieurs lignes\nsuite de la note\n@me \n-->");
  assert.deepEqual(harness.executedCommands, []);
  assert.deepEqual(editor.selection.active, { line: 3, character: 4 });
});

test("native-newline fallback leaves a blank line after the last message untouched", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "- B {??\n  @agent note custom sur un élément d'une liste\n  @me réponse humaine\n    \n  ??}",
    { line: 3, character: 4 },
  );

  await harness.api.fillReviewLineAfterNativeNewline(
    {
      document: editor.document,
      contentChanges: [{
        text: "\n    ",
        range: {
          start: { line: 2, character: 21 },
          end: { line: 2, character: 21 },
        },
      }],
    },
    editor,
  );

  assert.equal(
    editor.document.text,
    "- B {??\n  @agent note custom sur un élément d'une liste\n  @me réponse humaine\n    \n  ??}",
  );
});

test("cmd+alt+enter creates a compact HTML quick note at the end of the line", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("foo", { line: 0, character: 1 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "foo <!-- @  -->");
  assert.deepEqual(editor.selection.active, { line: 0, character: 11 });
});

test("cmd+alt+shift+enter creates a multiline HTML quick note at the end of the line", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("custom");
  const editor = harness.createEditor("foo", { line: 0, character: 1 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "foo <!--\n@ \n-->");
  assert.deepEqual(editor.selection.active, { line: 1, character: 2 });
});

test("cmd+alt+shift+enter creates a multiline HTML quick note for selected text", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("custom");
  const editor = harness.createEditor("foo bar baz", { line: 0, character: 4 }, { line: 0, character: 7 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "foo {==bar==}<!--\n@ \n--> baz");
  assert.deepEqual(editor.selection.active, { line: 1, character: 2 });
});

test("cmd+alt+shift+enter creates an indented multiline quick note in list items", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("- item", { line: 0, character: 6 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "- item <!--\n  @ \n  -->");
  assert.deepEqual(editor.selection.active, { line: 1, character: 4 });
});

test("cmd+alt+k o compact custom ok notes are inserted without a leading space", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("custom");
  const editor = harness.createEditor("{++foo++}", { line: 0, character: 5 });

  await harness.api.addHumanOk();

  assert.equal(editor.document.text, "{++foo++}{?? @me ok ??}");
});

test("discussion shortcut always creates a custom note", async () => {
  const harness = createHarness();
  harness.setCommentSyntax("html");
  const editor = harness.createEditor("{++foo++}", { line: 0, character: 5 });

  await harness.api.createCompactCriticMarkupReviewNote();

  assert.equal(editor.document.text, "{++foo++}{?? @me  ??}");
});

test("wraps selections with custom review annotations", async () => {
  const cases = [
    ["addition", "{++foo++}", { line: 0, character: 6 }],
    ["deletion", "{--foo--}", { line: 0, character: 6 }],
    ["highlight", "{==foo==}", { line: 0, character: 6 }],
    ["comment", "{>>foo<<}", { line: 0, character: 6 }],
    ["substitution", "{~~foo~>~~}", { line: 0, character: 8 }],
  ];

  for (const [kind, expectedText, expectedCursor] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor("foo", { line: 0, character: 0 }, { line: 0, character: 3 });

    await harness.api.wrapCriticMarkupAnnotation(kind);

    assert.equal(editor.document.text, expectedText);
    assert.deepEqual(editor.selection.active, expectedCursor);
  }
});

test("wraps empty selections with custom review annotations and places the cursor inside", async () => {
  const cases = [
    ["addition", "{++++}", { line: 0, character: 3 }],
    ["deletion", "{----}", { line: 0, character: 3 }],
    ["highlight", "{====}", { line: 0, character: 3 }],
    ["comment", "{>><<}", { line: 0, character: 3 }],
    ["substitution", "{~~~>~~}", { line: 0, character: 3 }],
  ];

  for (const [kind, expectedText, expectedCursor] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor("", { line: 0, character: 0 });

    await harness.api.wrapCriticMarkupAnnotation(kind);

    assert.equal(editor.document.text, expectedText);
    assert.deepEqual(editor.selection.active, expectedCursor);
  }
});

test("cancels custom review annotations", async () => {
  const cases = [
    ["{++bla++}", ""],
    ["{--bla--}", "bla"],
    ["{==bla==}", "bla"],
    ["{>>bla<<}", ""],
    ["{~~foo~>bar~~}", "foo"],
    ["{??bla??}", ""],
  ];

  for (const [text, expected] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor(text, { line: 0, character: 4 });

    await harness.api.cancelCriticMarkupAnnotation();

    assert.equal(editor.document.text, expected);
  }
});

test("applies custom review annotations", async () => {
  const cases = [
    ["{++bla++}", "bla"],
    ["{--bla--}", ""],
    ["{==bla==}", "bla"],
    ["{>>bla<<}", ""],
    ["{~~foo~>bar~~}", "bar"],
    ["{??bla??}", ""],
  ];

  for (const [text, expected] of cases) {
    const harness = createHarness();
    const editor = harness.createEditor(text, { line: 0, character: 4 });

    await harness.api.applyCriticMarkupAnnotation();

    assert.equal(editor.document.text, expected);
  }
});

test("cmd+alt+shift+enter compacts a one-message multiline conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{??\n@agent note\n??}", { line: 1, character: 0 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "{?? @agent note ??}");
});

test("cmd+alt+shift+enter expands a one-message compact conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note ??}", { line: 0, character: 5 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "{??\n@agent note\n??}");
  assert.deepEqual(editor.selection.active, { line: 1, character: 11 });
});

test("cmd+alt+shift+enter preserves inline continuation lines while toggling", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("<!-- @ Bla\n  - Bla -->", { line: 0, character: 5 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "<!--\n@ Bla\n  - Bla\n-->");

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "<!-- @ Bla\n  - Bla -->");
});

test("cmd+alt+shift+enter expands a multi-message compact conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note @me question ??}", { line: 0, character: 5 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "{??\n@agent note\n@me question\n??}");
  assert.deepEqual(editor.selection.active, { line: 2, character: 12 });
});

test("cmd+alt+shift+enter compacts a multi-message multiline conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{??\n@agent note\n@me question\n??}", { line: 1, character: 0 });

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "{?? @agent note @me question ??}");
});

test("cmd+alt+shift+enter compacts continuation lines without flattening them", async () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "{??\n@agent note\nsuite de la note\n@me question\n??}",
    { line: 1, character: 0 },
  );

  await harness.api.createCompactReviewNote();

  assert.equal(editor.document.text, "{?? @agent note\nsuite de la note @me question ??}");
});

test("cmd+alt+enter appends a quick reply inline in a compact conversation", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note ??}", { line: 0, character: 5 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "{?? @agent note @  ??}");
  assert.deepEqual(editor.selection.active, { line: 0, character: 18 });
});

test("cmd+alt+enter preserves a trailing inline ok reply and appends a quick reply", async () => {
  const harness = createHarness();
  const editor = harness.createEditor("{?? @agent note @me ok ??}", { line: 0, character: 5 });

  await harness.api.approveAgentMessage();

  assert.equal(editor.document.text, "{?? @agent note @me ok @  ??}");
  assert.deepEqual(editor.selection.active, { line: 0, character: 25 });
});

test("moves between custom review annotations and review conversations", () => {
  const harness = createHarness();
  const editor = harness.createEditor(
    "intro\n{++add++}\ntext\n{?? @me discuss ??}\ntext\n{~~old~>new~~}\ntext\n<!-- @me html -->",
    { line: 0, character: 0 },
  );

  harness.api.moveToReviewBlock("next");
  assert.deepEqual(editor.selection.active, { line: 1, character: 0 });

  harness.api.moveToReviewBlock("next");
  assert.deepEqual(editor.selection.active, { line: 3, character: 0 });

  harness.api.moveToReviewBlock("next");
  assert.deepEqual(editor.selection.active, { line: 5, character: 0 });

  harness.api.moveToReviewBlock("next");
  assert.deepEqual(editor.selection.active, { line: 7, character: 0 });

  harness.api.moveToReviewBlock("previous");
  assert.deepEqual(editor.selection.active, { line: 5, character: 0 });
});

test("brace-percent blocks are not treated as review conversations", () => {
  const harness = createHarness();

  assert.equal(harness.api.collectConversations("{%% @agent note %%}").length, 0);
});

test("conversation content decorations exclude marker-only delimiter lines", () => {
  const harness = createHarness();
  const text = "foo {==bar==}{??\n@me note\n??} baz";
  const conversation = harness.api.collectConversations(text)[0];
  const document = { positionAt: (offset) => positionAt(text, offset) };

  const [range] = harness.api.getConversationContentRanges(document, conversation);

  assert.deepEqual(range.start, { line: 1, character: 0 });
  assert.deepEqual(range.end, { line: 2, character: 0 });
});

test("compact conversation decorations exclude markers after highlighted selections", () => {
  const harness = createHarness();

  for (const text of [
    "foo {==bar==}<!-- @me note --> baz",
    "foo {==bar==}{?? @me note ??} baz",
  ]) {
    const conversation = harness.api.collectConversations(text)[0];
    const document = { positionAt: (offset) => positionAt(text, offset) };

    const [range] = harness.api.getConversationContentRanges(document, conversation);
    const decoratedText = text.slice(offsetAt(text, range.start), offsetAt(text, range.end));

    assert.equal(decoratedText, "@me note ");
  }
});

test("marker decorations target only review delimiters", () => {
  const harness = createHarness();

  for (const text of [
    "foo {==bar==}<!-- @me note --> baz",
    "- Bla {??\n  @agent note\n  ??}",
  ]) {
    const conversation = harness.api.collectConversations(text)[0];
    const document = { positionAt: (offset) => positionAt(text, offset) };

    const ranges = harness.api.getConversationMarkerRanges(document, conversation);
    const decoratedText = ranges.map((range) =>
      text.slice(offsetAt(text, range.start), offsetAt(text, range.end))
    );

    assert.deepEqual(
      [...decoratedText],
      text.includes("<!--") ? ["<!--", "-->"] : ["{??", "??}"],
    );
  }
});

test("role decorations only cover role markers in multiline and compact list conversations", () => {
  const harness = createHarness();

  for (const [text, expected] of [
    ["- Bla <!--\n  @agent Bla\n  @ Bla\n  -->", ["@agent", "@"]],
    ["- Bla <!-- @agent Bla -->", ["@agent"]],
    ["- Bla <!-- @agent Bla -->", ["@agent"]],
    ["- Bla {??\n  @agent Bla\n  @me Bla\n  ??}", ["@agent", "@me"]],
    ["- Bla {??\n  @agent Bla\n  @me Bla\n  ??}", ["@agent", "@me"]],
    ["- Bla {?? @agent Bla ??}", ["@agent"]],
    ["- Bla {?? @agent Bla ??}", ["@agent"]],
    ["- Bla {?? @agent Bla @me Bla ??}", ["@agent", "@me"]],
  ]) {
    const conversation = harness.api.collectConversations(text)[0];
    const document = { positionAt: (offset) => positionAt(text, offset) };

    const roleRanges = harness.api.getConversationRoleRanges(document, conversation);
    const decoratedText = roleRanges.map(({ range }) =>
      text.slice(offsetAt(text, range.start), offsetAt(text, range.end))
    );

    assert.deepEqual([...decoratedText], expected);
  }
});

test("ok decorations only cover ok replies", () => {
  const harness = createHarness();

  for (const [text, expected] of [
    ["<!--\n@me ok\n@me OK\n@me not ok\n@agent ok\n-->", ["ok", "OK"]],
    ["{?? @agent note @me ok ??}", ["ok"]],
  ]) {
    const conversation = harness.api.collectConversations(text)[0];
    const document = { positionAt: (offset) => positionAt(text, offset) };

    const okRanges = harness.api.getConversationOkRanges(document, conversation);
    const decoratedText = okRanges.map((range) =>
      text.slice(offsetAt(text, range.start), offsetAt(text, range.end))
    );

    assert.deepEqual([...decoratedText], expected);
  }
});
