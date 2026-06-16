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
 * All four behaviours are gated on the `enabled` setting. Toggling it from the
 * JupyterLab settings editor takes effect immediately: when turned off the
 * extension stops freezing, thawing, dimming, and pinning. Cells already frozen
 * in a saved notebook stay read-only because that lives in their own metadata.
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
    // Whether the extension is active. Driven by the `enabled` setting and read
    // live by every behaviour below, so the settings toggle applies without a
    // reload. Defaults to on; corrected once the settings load resolves.
    let enabled = true;

    // Dimming (behaviour 3, hoisted here so the settings handler can re-apply
    // it across open notebooks when `enabled` changes). Reflect the `editable`
    // metadata onto each cell as the `jp-mod-frozen` class while enabled. Wire
    // each cell once so the class tracks later metadata changes; deriving it
    // from `enabled && isFrozen` keeps it correct on load, freeze, thaw, and
    // toggle.
    const wired = new WeakSet<Cell>();
    const syncCell = (cell: Cell): void => {
      cell.toggleClass(FROZEN_CLASS, enabled && isFrozen(cell.model));
      if (!wired.has(cell)) {
        wired.add(cell);
        cell.model.metadataChanged.connect(() => {
          cell.toggleClass(FROZEN_CLASS, enabled && isFrozen(cell.model));
        });
      }
    };
    const syncPanel = (panel: NotebookPanel): void =>
      panel.content.widgets.forEach(syncCell);

    // 1. Freeze a cell once it has been executed, whether the execution
    //    succeeded or failed.
    NotebookActions.executed.connect((_sender, args) => {
      if (enabled) {
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
          if (!enabled || change.type !== 'add') {
            return;
          }
          for (const cellModel of change.newValues) {
            thawCellModel(cellModel);
          }
        });

        // 3. Dim frozen cells via `syncPanel` (see above). Re-run on every
        //    model content change so cells added or reloaded pick up the class.
        const notebook = panel.content;
        syncPanel(panel);
        notebook.modelContentChanged.connect(() => syncPanel(panel));

        // 4. Pin frozen cells in place. All reordering (move commands and
        //    drag-and-drop) funnels through `Notebook.moveCell`, which has no
        //    metadata gate. Override it to no-op when the move would displace a
        //    frozen cell, otherwise delegate to the original (which keeps the
        //    selection/active-cell bookkeeping and performs the actual move).
        const originalMoveCell = notebook.moveCell.bind(notebook);
        notebook.moveCell = (from: number, to: number, n = 1): void => {
          const cells = notebook.model?.cells;
          if (
            enabled &&
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

    // Track the `enabled` setting. When it changes, re-apply the dim hint
    // across every open notebook so the toggle is reflected immediately. The
    // event-driven behaviours (freeze, thaw, pin) read `enabled` when they
    // fire, so they need no extra wiring here. If settings are unavailable the
    // extension stays enabled (the default).
    if (settingRegistry) {
      const reflectSettings = (settings: ISettingRegistry.ISettings): void => {
        enabled = settings.get('enabled').composite !== false;
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
