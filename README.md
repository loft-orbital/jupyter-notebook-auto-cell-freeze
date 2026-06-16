# jupyter-notebook-auto-cell-freeze

A JupyterLab extension that automatically makes a notebook cell **read-only**
once it has been executed, so you don't accidentally edit, delete, or re-run a
cell you have already run.

## What it does

- When a cell is **executed**, it is frozen by setting the `editable: false`
  and `deletable: false` cell metadata. JupyterLab natively turns the cell
  editor read-only and prevents the cell from being deleted. This happens
  whether the execution **succeeds or fails**, and applies to both **code**
  and **markdown** cells (running a markdown cell renders it).
- The frozen state is stored in the notebook metadata, so it **persists** when
  the notebook is saved and reopened.
- **Copying a frozen cell yields an editable copy.** You can copy (or duplicate)
  a read-only cell, paste it, tweak it, and run it again without touching the
  original. Newly pasted/duplicated cells always come back editable.
- **Frozen cells are dimmed** (~70% opacity) as a subtle hint that they are
  read-only.
- **Frozen cells are pinned in place.** You can't move or drag a frozen cell,
  and you can't move another cell across one (which would shift its position).
  Editable cells that don't cross a frozen cell still reorder freely.
- **Frozen cells can't be re-executed.** `editable: false` only locks the
  editor — JupyterLab will still run the cell — so the plugin also blocks
  execution of a frozen cell. Copy it to an editable cell if you want to run it
  again.

## Configuration

The extension exposes two settings in the JupyterLab **Settings Editor**
(_Settings → Settings Editor → Auto Cell Freeze_):

- **Enabled** (`enabled`, default `true`) — master switch. Turn the extension on
  or off.
- **Paths** (`paths`, default `[]`) — a list of glob patterns scoping which
  notebooks the extension acts on, matched against each notebook's
  server-relative path. An empty list (the default) means **every** notebook;
  otherwise the extension is active only on notebooks whose path matches one of
  the patterns. `Enabled` still applies on top — when off, nothing happens
  anywhere regardless of `paths`.

  Pattern syntax (case-sensitive, anchored to the full path):
  - `*` matches within a single path segment (does not cross `/`).
  - `**` matches across `/`, including zero segments — so `a/**/b` matches both
    `a/b` and `a/x/y/b`.
  - `?` matches a single non-`/` character.

  Examples: `**/*.ipynb` (every notebook), `experiments/**` (everything under
  `experiments/`), `reports/*.ipynb` (notebooks directly in `reports/`).

When the extension is inactive for a notebook (disabled, or its path is not
matched), executed cells are no longer frozen, frozen cells are not dimmed,
pinned, or blocked from re-executing, and pasted cells are left untouched. Setting changes take effect
immediately, without reloading. Cells already frozen in a saved notebook stay
read-only, because that is stored in their own `editable` metadata.

To configure this for everyone (e.g. in a shared deployment), ship the override
in the system settings overrides file
(`{sys.prefix}/share/jupyter/lab/settings/overrides.json`). For example, disable
it entirely:

```json
{
  "jupyter-notebook-auto-cell-freeze:plugin": { "enabled": false }
}
```

…or enable it only for notebooks under a `graded/` folder:

```json
{
  "jupyter-notebook-auto-cell-freeze:plugin": { "paths": ["graded/**"] }
}
```

## How it works

The plugin (`src/index.ts`) wires up five things:

1. It connects to the global `NotebookActions.executed` signal and freezes the
   executed cell — on success or failure (`src/freeze.ts` → `freezeCellModel`).
2. JupyterLab's copy keeps the `editable` metadata on the clipboard, which would
   otherwise make a pasted copy read-only. To prevent that, the plugin watches
   each notebook (via `INotebookTracker`) and thaws any cell **inserted after
   the notebook has loaded** (`thawCellModel`). Gating on `context.ready` means
   an already-frozen notebook keeps its frozen cells on open, while pastes,
   duplicates, and cross-notebook pastes come back editable. This is independent
   of the clipboard backend (internal or system clipboard) and of command IDs.
3. It reflects the `editable` metadata onto each cell as the `jp-mod-frozen`
   class (styled in `style/base.css`), so frozen cells are dimmed. Deriving the
   class from metadata keeps the hint correct on load, freeze, and thaw.
4. All reordering (move commands and drag-and-drop) funnels through
   `Notebook.moveCell`, which has no metadata gate. The plugin overrides it per
   notebook to block any move that would displace a frozen cell, otherwise it
   delegates to the original (`moveDisplacesFrozenCell` in `src/freeze.ts`).
5. All code-cell execution funnels through the static `CodeCell.execute`, which
   has no metadata gate (`editable: false` only locks the editor). The plugin
   wraps it to no-op for frozen cells, otherwise it delegates to the original.

- JupyterLab >= 4.0.0

## Install (development)

You will need NodeJS to build the extension package.

```bash
# Install the package in development mode
pip install -e .
# Link the development version of the extension with JupyterLab
jupyter labextension develop . --overwrite
# Rebuild the extension's TypeScript source after making changes
jlpm build
```

> `jlpm` is JupyterLab's pinned version of [yarn](https://yarnpkg.com/),
> installed with JupyterLab. You may use `yarn` or `npm` instead.

To rebuild automatically on every change, run `jlpm watch` in one terminal and
`jupyter lab` in another, then refresh the browser after each rebuild.

`jupyter labextension list` should then show:

```
   local extensions:
        jupyter-notebook-auto-cell-freeze: [...]
```

## Uninstall

```bash
pip uninstall jupyter_notebook_auto_cell_freeze
```

## Testing

Unit tests (Jest):

```bash
jlpm test
```

Integration tests (Playwright + Galata), from `ui-tests/`:

```bash
jlpm install
jlpm playwright install chromium
jlpm playwright test
```

## Try it

1. `jupyter lab`, open a notebook.
2. Run a code cell — it becomes read-only, undeletable, and dims slightly.
   Render a markdown cell — it locks too. A cell that errors is frozen as well.
   Try to run the frozen cell again — nothing happens; its output is untouched.
3. Copy a frozen cell and paste it — the paste is editable (full opacity); edit
   and re-run it without affecting the original.
4. Try to move/drag the frozen cell, or drag another cell across it — blocked.
   Cells that don't cross a frozen one still reorder.
5. Save, close, and reopen — previously frozen cells stay frozen and dimmed.
