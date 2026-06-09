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

import {
  freezeCellModel,
  isFrozen,
  moveDisplacesFrozenCell,
  thawCellModel
} from './freeze';

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
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-auto-cell-freeze:plugin',
  description:
    'Automatically make notebook cells read-only after they are executed.',
  autoStart: true,
  requires: [INotebookTracker],
  activate: (_app: JupyterFrontEnd, tracker: INotebookTracker) => {
    // 1. Freeze a cell once it has been executed, whether the execution
    //    succeeded or failed.
    NotebookActions.executed.connect((_sender, args) => {
      freezeCellModel(args.cell.model);
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
          if (change.type !== 'add') {
            return;
          }
          for (const cellModel of change.newValues) {
            thawCellModel(cellModel);
          }
        });

        // 3. Dim frozen cells. Reflect the `editable` metadata onto each cell
        //    widget as the `jp-mod-frozen` class. Deriving the class from
        //    metadata keeps it correct on load (persisted frozen cells), on
        //    freeze (execute), and on thaw (paste/duplicate).
        const notebook = panel.content;
        const wired = new WeakSet<Cell>();
        const syncCell = (cell: Cell): void => {
          cell.toggleClass(FROZEN_CLASS, isFrozen(cell.model));
          if (!wired.has(cell)) {
            wired.add(cell);
            cell.model.metadataChanged.connect(() => {
              cell.toggleClass(FROZEN_CLASS, isFrozen(cell.model));
            });
          }
        };
        const syncAllCells = (): void => notebook.widgets.forEach(syncCell);

        syncAllCells();
        notebook.modelContentChanged.connect(syncAllCells);

        // 4. Pin frozen cells in place. All reordering (move commands and
        //    drag-and-drop) funnels through `Notebook.moveCell`, which has no
        //    metadata gate. Override it to no-op when the move would displace a
        //    frozen cell, otherwise delegate to the original (which keeps the
        //    selection/active-cell bookkeeping and performs the actual move).
        const originalMoveCell = notebook.moveCell.bind(notebook);
        notebook.moveCell = (from: number, to: number, n = 1): void => {
          const cells = notebook.model?.cells;
          if (
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
  }
};

export default plugin;
