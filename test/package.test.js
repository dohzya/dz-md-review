const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readPackage() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
}

test("cmd+enter is left to VS Code", () => {
  const pkg = readPackage();
  const keybindings = pkg.contributes.keybindings.filter((binding) =>
    binding.key === "cmd+enter" || binding.mac === "cmd+enter"
  );

  assert.deepEqual(keybindings, []);
});

test("Obsidian Markdown support injects into Markdown without a test language", () => {
  const pkg = readPackage();
  const obsidianGrammar = pkg.contributes.grammars.find(
    (grammar) => grammar.scopeName === "source.obsidian.markdown.injection",
  );

  assert.equal(obsidianGrammar.path, "./syntaxes/obsidian-markdown-injection.tmLanguage.json");
  assert.deepEqual(obsidianGrammar.injectTo, ["text.html.markdown"]);
  assert.equal(pkg.contributes.languages, undefined);
});

test("Catppuccin Latte defaults color Obsidian and custom review annotation scopes", () => {
  const pkg = readPackage();
  const customizations = pkg.contributes.configurationDefaults["editor.tokenColorCustomizations"];
  const globalRules = customizations.textMateRules;
  const latteRules = customizations["[Catppuccin Latte]"].textMateRules;

  assert(globalRules.some((rule) =>
    rule.scope.includes("comment.block.obsidian.markdown")
      && rule.settings.foreground === "#8C8FA1"
  ));
  assert(globalRules.some((rule) =>
    rule.scope.includes("markup.inserted.critic.substitution.markdown")
      && rule.settings.fontStyle === "bold"
  ));
  assert.deepEqual(latteRules[0], {
    scope: ["markup.inserted.critic.markdown", "markup.inserted.critic.substitution.markdown"],
    settings: {
      foreground: "#40a02b",
      fontStyle: "bold",
    },
  });
  assert(latteRules.some((rule) => rule.scope.includes("markup.marked.obsidian.markdown")));
  assert(latteRules.some((rule) => rule.scope.includes("comment.block.obsidian.markdown")));
});

test("custom review annotation commands are available through cmd+alt+k chords", () => {
  const pkg = readPackage();
  const commands = new Set(pkg.contributes.commands.map((command) => command.command));
  const keybindings = new Map(pkg.contributes.keybindings.map((binding) => [binding.command, binding.mac]));

  assert(commands.has("dzMdReview.addCriticMarkupAddition"));
  assert(commands.has("dzMdReview.addCriticMarkupDeletion"));
  assert(commands.has("dzMdReview.addCriticMarkupSubstitution"));
  assert(commands.has("dzMdReview.addCriticMarkupHighlight"));
  assert(commands.has("dzMdReview.addCriticMarkupComment"));
  assert(commands.has("dzMdReview.createCriticMarkupDiscussion"));
  assert(commands.has("dzMdReview.cancelCriticMarkupAnnotation"));
  assert(commands.has("dzMdReview.applyCriticMarkupAnnotation"));
  assert(commands.has("dzMdReview.addHumanOk"));
  assert(commands.has("dzMdReview.removeHumanOk"));
  assert(commands.has("dzMdReview.nextReviewBlock"));
  assert(commands.has("dzMdReview.previousReviewBlock"));

  assert.equal(keybindings.get("dzMdReview.addCriticMarkupAddition"), "cmd+alt+k a");
  assert.equal(keybindings.get("dzMdReview.addCriticMarkupDeletion"), "cmd+alt+k s");
  assert.equal(keybindings.get("dzMdReview.addCriticMarkupSubstitution"), "cmd+alt+k r");
  assert.equal(keybindings.get("dzMdReview.addCriticMarkupHighlight"), "cmd+alt+k h");
  assert.equal(keybindings.get("dzMdReview.addCriticMarkupComment"), "cmd+alt+k c");
  assert.equal(keybindings.get("dzMdReview.createCriticMarkupDiscussion"), "cmd+alt+k d");
  assert.equal(keybindings.get("dzMdReview.cancelCriticMarkupAnnotation"), "cmd+alt+k x");
  assert.equal(keybindings.get("dzMdReview.applyCriticMarkupAnnotation"), "cmd+alt+k shift+x");
  assert.equal(keybindings.get("dzMdReview.addHumanOk"), "cmd+alt+k o");
  assert.equal(keybindings.get("dzMdReview.removeHumanOk"), "cmd+alt+k shift+o");
  assert.equal(keybindings.get("dzMdReview.nextReviewBlock"), "cmd+alt+k n");
  assert.equal(keybindings.get("dzMdReview.previousReviewBlock"), "cmd+alt+k shift+n");
});
