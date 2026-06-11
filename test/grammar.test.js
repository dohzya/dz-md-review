const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readGrammar(filename) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "syntaxes", filename), "utf8"));
}

function readPackage() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
}

test("global list fallback starts HTML and custom conversations", () => {
  const grammar = readGrammar("md-review-list-injection.tmLanguage.json");

  assert.equal(grammar.injectionSelector, "L:text.html.markdown");
  assert.deepEqual(grammar.patterns, [
    { include: "#md-review-conversation" },
    { include: "#md-review-custom-conversation" },
  ]);
  assert.equal(
    grammar.repository["md-review-conversation"].begin,
    "<!--(?=(?:(?!-->)[\\s\\S])*\\s*@(agent|me)?(?=\\s*:|\\s|$))",
  );
  assert.equal(
    grammar.repository["md-review-custom-conversation"].begin,
    "\\{\\?\\?(?=(?:(?!\\?\\?\\})[\\s\\S])*\\s*@(agent|me)?(?=\\s*:|\\s|$))",
  );
  assert.equal(grammar.repository["md-review-custom-conversation"].end, "\\?\\?\\}");
});

test("all conversation grammars include inline role scopes", () => {
  for (const filename of [
    "md-review-injection.tmLanguage.json",
    "md-review-list-injection.tmLanguage.json",
  ]) {
    const grammar = readGrammar(filename);

    for (const key of ["md-review-conversation", "md-review-custom-conversation"]) {
      const includes = grammar.repository[key].patterns.map((pattern) => pattern.include);

      assert(includes.includes("#md-review-agent-inline"), `${filename}:${key} lacks @agent inline`);
      assert(includes.includes("#md-review-human-inline"), `${filename}:${key} lacks @me inline`);
      assert(includes.includes("#md-review-human-quick-inline"), `${filename}:${key} lacks @ inline`);
    }
  }
});

test("HTML comment injection supports inline role scopes", () => {
  const grammar = readGrammar("md-review-html-comment-injection.tmLanguage.json");
  const includes = grammar.patterns.map((pattern) => pattern.include);

  assert(includes.includes("#md-review-agent-inline"));
  assert(includes.includes("#md-review-human-inline"));
  assert(includes.includes("#md-review-human-quick-inline"));
});

test("comment marker colors target review and native HTML punctuation scopes", () => {
  const pkg = readPackage();
  const rules = pkg.contributes.configurationDefaults["editor.tokenColorCustomizations"].textMateRules;
  const markerRule = rules.find((rule) => rule.settings.foreground === "#8C8FA1");

  assert.deepEqual(markerRule.scope, [
    "punctuation.definition.comment.begin.md-review.markdown",
    "punctuation.definition.comment.end.md-review.markdown",
    "punctuation.definition.comment.begin.html",
    "punctuation.definition.comment.end.html",
  ]);
});

test("Obsidian Markdown grammar includes Obsidian and custom review annotation scopes", () => {
  const grammar = readGrammar("obsidian-markdown-injection.tmLanguage.json");

  assert.equal(
    grammar.injectionSelector,
    "L:text.html.markdown",
  );
  assert(grammar.patterns.some((pattern) => pattern.include === "#obsidian-wikilinks"));
  assert(grammar.patterns.some((pattern) => pattern.include === "#criticmarkup-substitution"));
  assert.equal(grammar.repository["obsidian-wikilinks"].name, "markup.underline.link.obsidian.markdown");
  assert.equal(grammar.repository["obsidian-callouts"].captures["1"].name, "storage.type.callout.obsidian.markdown");
  assert.equal(grammar.repository["criticmarkup-addition"].name, "markup.inserted.critic.markdown");
  assert.equal(
    grammar.repository["criticmarkup-substitution"].beginCaptures["3"].name,
    "punctuation.separator.substitution.critic.markdown",
  );
  assert.equal(grammar.repository["obsidian-comments"].patterns[1].begin, "^\\s*%%\\s*$");
  assert.equal(grammar.repository["criticmarkup-substitution"].begin, "(\\{~~)(.*?)(~>)");
  assert.equal(grammar.repository["criticmarkup-substitution"].end, "~~\\}");
});
