# Test DZ Markdown Review Syntax

## Conversation

<!--
@agent note isolée
-->

Une ligne de texte <!--
@agent note ou justificatif
@me remarque ou question
@agent réponse de l'agent
@ message rapide qui sera converti en `@me ` par l'agent
-->

Les rôles durables acceptés sont `@agent` et `@me`.

- A
- B <!--
  @agent note sur un élément d'une liste
  -->

- A
  <!--
  @agent Note sur un élément, à la ligne
  -->

### Entête <!--
@agent note sur une entête
@ remarque
-->

## Conversation sur sélection

Le passage {==sélectionné pour revue==}<!--
@me commentaire lié à la sélection en syntaxe HTML par défaut
-->

### Entête avec {==sélection==}<!--
@me commentaire lié à une sélection dans une entête
-->

- Item avec {==sélection==}<!--
  @me commentaire lié à une sélection dans une liste
  -->

## Syntaxe custom

{??
@agent note isolée avec la syntaxe alternative
@me remarque ou question
@agent réponse de l'agent
??}

Une ligne de texte {??
@agent note inline avec la syntaxe alternative
@me remarque ou question
??}

Une note compacte {?? @agent note inline compacte ??} à déplier avec une commande.

Le passage {==sélectionné pour revue==}{??
@me commentaire lié à la sélection en syntaxe alternative
??} reste lisible dans la ligne.

- A
- B {??
  @agent note custom sur un élément d'une liste
  @me réponse humaine
  ??}

- Item avec {==sélection==}{??
  @me commentaire lié à une sélection dans une liste
  ??}

## Conversation résolue

Une fois validé, le commentaire devient une note hors workflow actif.

Version html <!-- J'utilise un commentaire HTML pour rester compatible Markdown. -->

Version obsidian %% J'utilise un commentaire Obsidian pour rester compatible avec Obsidian. %%

%%
Note Obsidian résolue
sur plusieurs lignes.
%%

## Obsidian Markdown

Un [[wikilink]] simple.

Un [[wikilink|avec alias]].

Un ![[embed-note]].

Un ![[image.png]].

Un lien vers une entête : [[Note#Section importante]].

Un lien vers un bloc : [[Note#^abc123]].

Un tag #projet/test et #idée.

Un identifiant de bloc autonome. ^block-123

==Highlight Obsidian==

%% commentaire Obsidian inline %%

Du texte %%commentaire Obsidian au milieu%% puis la suite.

%%
Commentaire Obsidian
sur plusieurs lignes.
%%

> [!note] Titre du callout
> Contenu du callout.

> [!warning]- Callout plié
> Contenu du callout.

> [!tip]+ Callout ouvert
> Contenu du callout.

## Custom Review Annotations

Addition : {++texte ajouté++}

Suppression : {--texte supprimé--}

Substitution : {~~ancien texte~>nouveau texte~~}

Highlight : {==passage à vérifier==}

Commentaire : {>>note de relecture<<}

Mix : {++ajout avec [[wikilink|alias]], #tag et ==highlight Obsidian==++}
