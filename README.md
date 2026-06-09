# jupyterlab-auto-cell-freeze

A JupyterLab extension that automatically makes a notebook cell **read-only**
once it has been executed, so you don't accidentally edit or delete a cell you
have already run.

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

## How it works

The plugin (`src/index.ts`) wires up two things:

1. It connects to the global `NotebookActions.executed` signal and freezes the
   executed cell on success (`src/freeze.ts` → `freezeCellModel`).
2. JupyterLab's copy keeps the `editable` metadata on the clipboard, which would
   otherwise make a pasted copy read-only. To prevent that, the plugin watches
   each notebook (via `INotebookTracker`) and thaws any cell **inserted after
   the notebook has loaded** (`thawCellModel`). Gating on `context.ready` means
   an already-frozen notebook keeps its frozen cells on open, while pastes,
   duplicates, and cross-notebook pastes come back editable. This is independent
   of the clipboard backend (internal or system clipboard) and of command IDs.

## Requirements

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
        jupyterlab-auto-cell-freeze: [...]
```

## Uninstall

```bash
pip uninstall jupyterlab_auto_cell_freeze
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
2. Run a code cell — it becomes read-only and undeletable. Render a markdown
   cell — it locks too. A cell that errors is frozen as well.
3. Copy a frozen cell and paste it — the paste is editable; edit and re-run it
   without affecting the original.
4. Save, close, and reopen — previously frozen cells stay frozen.
