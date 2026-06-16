import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  INotebookTracker,
  NotebookActions,
  NotebookPanel
} from '@jupyterlab/notebook';
import { Cell } from '@jupyterlab/cells';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import {
  freezeCellModel,
  isFrozen,
  moveDisplacesFrozenCell,
  pathMatchesAny,
  thawCellModel
} from './freeze';

/**
 * The plugin id. Also the key under which the settings schema
 * (`schema/plugin.json`) is registered.
 */
const PLUGIN_ID = 'jupyter-notebook-auto-cell-freeze:plugin';

/**
 * CSS class added to a frozen (read-only) cell so it can be visually dimmed.
 * The matching rule lives in `style/base.css`.
 */
const FROZEN_CLASS = 'jp-mod-frozen';

/**
 * A JupyterLab extension that automatically turns a notebook cell read-only
 * once it has been executed.
 *
 * Four behaviours:
 *
 *  1. When a cell finishes executing, it is frozen (`editable: false`,
 *     `deletable: false`). This persists in the notebook.
 *
 *  2. A copy/duplicate of a frozen cell must paste as an *editable* cell so
 *     the user can tweak and re-run it. JupyterLab's copy keeps the
 *     `editable` metadata, so any cell inserted after the notebook has
 *     loaded gets thawed.
 *
 *  3. Frozen cells are dimmed via the `jp-mod-frozen` class, kept in sync with
 *     the `editable` metadata (the single source of truth).
 *
 *  4. Frozen cells are pinned in place: any reorder (move command or
 *     drag-and-drop) that would displace a frozen cell is blocked.
 *
 * All four behaviours are gated on two settings, read live so changes from the
 * JupyterLab settings editor take effect immediately:
 *
 *  - `enabled` — master switch. When off, the extension does nothing.
 *  - `paths` — glob patterns scoping which notebooks the extension acts on
 *    (matched against `panel.context.path`). An empty list means every notebook.
 *
 * The per-notebook gate is `appliesTo(path)`. When a notebook is excluded the
 * extension is fully inert for it. Cells already frozen in a saved notebook stay
 * read-only either way, because that lives in their own metadata.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description:
    'Automatically make notebook cells read-only after they are executed.',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry],
  activate: (
    _app: JupyterFrontEnd,
    tracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null
  ) => {
    // Live settings state, read by every behaviour below so changes apply
    // without a reload. Defaults are corrected once the settings load resolves.
    let enabled = true;
    let patterns: string[] = [];

    // Whether the extension should act on the notebook at `path`. The master
    // `enabled` switch gates everything; an empty `patterns` list means "every
    // notebook", otherwise the path must match one of the globs.
    const appliesTo = (path: string | undefined): boolean =>
      enabled &&
      (patterns.length === 0 ||
        (path !== undefined && pathMatchesAny(path, patterns)));

    // Dimming (behaviour 3, hoisted here so the settings handler can re-apply
    // it across open notebooks when the settings change). Reflect the `editable`
    // metadata onto each cell as the `jp-mod-frozen` class while the extension
    // applies to the cell's notebook. Wire each cell once so the class tracks
    // later metadata changes; deriving it from `appliesTo && isFrozen` keeps it
    // correct on load, freeze, thaw, settings toggle, and rename. The cell's
    // panel never changes, so capturing it in the listener is safe.
    const wired = new WeakSet<Cell>();
    const syncCell = (panel: NotebookPanel, cell: Cell): void => {
      const dim = (): void => {
        cell.toggleClass(
          FROZEN_CLASS,
          appliesTo(panel.context.path) && isFrozen(cell.model)
        );
      };
      dim();
      if (!wired.has(cell)) {
        wired.add(cell);
        cell.model.metadataChanged.connect(dim);
      }
    };
    const syncPanel = (panel: NotebookPanel): void =>
      panel.content.widgets.forEach(cell => syncCell(panel, cell));

    // 1. Freeze a cell once it has been executed, whether the execution
    //    succeeded or failed. This is a global signal, so map the executed
    //    notebook back to its panel to read its path for the `appliesTo` gate.
    NotebookActions.executed.connect((_sender, args) => {
      const panel = tracker.find(p => p.content === args.notebook);
      if (appliesTo(panel?.context.path)) {
        freezeCellModel(args.cell.model);
      }
    });

    tracker.widgetAdded.connect((_sender, panel: NotebookPanel) => {
      void panel.context.ready.then(() => {
        const model = panel.model;
        if (!model) {
          return;
        }

        // 2. Keep copies of frozen cells editable. Copy/cut keeps the
        //    `editable` metadata on the clipboard, so a pasted (or duplicated)
        //    frozen cell would otherwise stay read-only. Thaw any cell
        //    inserted *after* the notebook has loaded — the post-load gate
        //    (`context.ready`) leaves the persisted freeze state of an opened
        //    notebook untouched. Freshly created empty cells carry no freeze
        //    metadata, so thawing them is a harmless no-op.
        model.cells.changed.connect((_cells, change) => {
          if (!appliesTo(panel.context.path) || change.type !== 'add') {
            return;
          }
          for (const cellModel of change.newValues) {
            thawCellModel(cellModel);
          }
        });

        // 3. Dim frozen cells via `syncPanel` (see above). Re-run on every
        //    model content change so cells added or reloaded pick up the class,
        //    and on rename since a path change can move the notebook in or out
        //    of `paths` (the other behaviours read the path live when they fire,
        //    so only this persistent visual state needs an explicit re-sync).
        const notebook = panel.content;
        syncPanel(panel);
        notebook.modelContentChanged.connect(() => syncPanel(panel));
        panel.context.pathChanged.connect(() => syncPanel(panel));

        // 4. Pin frozen cells in place. All reordering (move commands and
        //    drag-and-drop) funnels through `Notebook.moveCell`, which has no
        //    metadata gate. Override it to no-op when the move would displace a
        //    frozen cell, otherwise delegate to the original (which keeps the
        //    selection/active-cell bookkeeping and performs the actual move).
        const originalMoveCell = notebook.moveCell.bind(notebook);
        notebook.moveCell = (from: number, to: number, n = 1): void => {
          const cells = notebook.model?.cells;
          if (
            appliesTo(panel.context.path) &&
            cells &&
            moveDisplacesFrozenCell(cells.length, from, to, n, i =>
              isFrozen(cells.get(i))
            )
          ) {
            return;
          }
          originalMoveCell(from, to, n);
        };
      });
    });

    // Track the `enabled` and `paths` settings. When they change, re-apply the
    // dim hint across every open notebook so the change is reflected
    // immediately. The event-driven behaviours (freeze, thaw, pin) read the
    // settings when they fire, so they need no extra wiring here. If settings
    // are unavailable the extension stays enabled everywhere (the defaults).
    if (settingRegistry) {
      const reflectSettings = (settings: ISettingRegistry.ISettings): void => {
        enabled = settings.get('enabled').composite !== false;
        const rawPaths = settings.get('paths').composite;
        patterns = Array.isArray(rawPaths) ? (rawPaths as string[]) : [];
        tracker.forEach(syncPanel);
      };

      void settingRegistry
        .load(PLUGIN_ID)
        .then(settings => {
          reflectSettings(settings);
          settings.changed.connect(reflectSettings);
        })
        .catch(reason => {
          console.error(
            `Failed to load settings for ${PLUGIN_ID}; auto cell freeze stays enabled.`,
            reason
          );
        });
    }
  }
};

export default plugin;
