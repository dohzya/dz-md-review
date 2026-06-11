# DZ Markdown Review Syntax Reference

This reference describes the Markdown review syntax used by the
`dz-md-review-syntax` VS Code extension. Use it when an agent or human reviewer
needs to annotate Markdown, reply to inline discussions, apply or cancel
custom review annotations, or clean resolved review threads.

## Active Conversations

HTML review comments are the default portable form:

```markdown
The generated text stays normal Markdown.
<!--
@agent I chose this wording because it matches the glossary.
@me Can we make this less categorical?
@agent Done. I softened the wording and kept the glossary term.
-->
```

Custom `{?? ??}` discussions are the compact Obsidian-friendly form:

```markdown
The generated text stays normal Markdown.
{??
@agent I chose this wording because it matches the glossary.
@me Can we make this less categorical?
@agent Done. I softened the wording and kept the glossary term.
??}
```

Compact inline discussions are valid for short notes:

```markdown
The generated text {?? @agent Please validate this claim. ??} continues.
```

When adding `{??` next to an existing custom review annotation, do not insert
a space:

```markdown
{++new wording++}{?? @agent Please validate this addition. ??}
```

## Roles

Use only these durable roles in active conversations:

- `@agent` for the agent's rationale, change summary, or response.
- `@me` for the human's review comment.

If a human wrote a quick bare note, normalize it:

```markdown
{??
@ This seems too strong.
??}
```

becomes:

```markdown
{??
@me This seems too strong.
??}
```

Do not alter the meaning while normalizing.

## Replying To A Thread

Append new messages to the existing block:

```markdown
{??
@agent I added the sentence because it follows the A3 decision.
@me It should mention the data constraint too.
@agent Done. I added the data constraint and kept the A3 reference.
??}
```

Do not collapse, reorder, or rewrite previous messages while the thread is
unresolved. The history matters because it replaces an external review system.

## Changing Text From A Comment

When a human comment asks for a text change:

1. Make the document change.
2. Add a new `@agent` message in the same thread explaining the change.
3. Leave the thread active until the human validates it.

Example:

```markdown
The service stores generated summaries with trace metadata.
{??
@me Please say whether source documents are stored too.
@agent Done. I clarified that source documents remain in the existing system
and only generated summaries plus trace metadata are stored here.
??}
```

## Custom Review Annotations

Use custom review annotations when the proposed change is local and concrete:

```markdown
Addition: {++new text++}
Deletion: {--old text--}
Replacement: {~~old text~>new text~~}
Highlight: {==text to review==}
Comment: {>>review note<<}
Discussion: {?? @agent Please validate this sentence. ??}
```

Cancelling an annotation means preserving the pre-review text:

- `{++new++}` -> remove the annotation entirely.
- `{--old--}` -> `old`.
- `{==text==}` -> `text`.
- `{>>comment<<}` -> remove the annotation entirely.
- `{~~old~>new~~}` -> `old`.
- `{?? discussion ??}` -> remove the discussion.

Applying an annotation means accepting the proposed result:

- `{++new++}` -> `new`.
- `{--old--}` -> remove the annotation entirely.
- `{==text==}` -> `text`.
- `{>>comment<<}` -> remove the annotation entirely.
- `{~~old~>new~~}` -> `new`.
- `{?? discussion ??}` -> remove the discussion.

## Validation And Cleanup

Treat a trailing human `ok`, `OK`, `@me ok`, or explicit "resolved" message as
validation. After validation:

1. Apply or cancel any custom review annotation according to the requested
   outcome.
2. Remove the active conversation block.
3. Keep a durable comment only when it documents useful rationale,
   uncertainty, or provenance.

Durable Markdown comment:

```markdown
<!-- Justification: The wording follows the validated glossary term. -->
```

Durable Obsidian comment:

```markdown
%% Justification : The wording follows the validated glossary term. %%
```

Delete review chatter that no longer has documentary value.

## Final Answer Checklist

After working with review syntax, report:

- which files changed;
- which discussions received an `@agent` reply;
- which discussions were cleaned after validation;
- which unresolved discussions remain for the human.
