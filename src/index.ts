import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  INotebookTracker,
  NotebookActions,
  NotebookPanel
} from '@jupyterlab/notebook';

import { freezeCellModel, thawCellModel } from './freeze';

/**
 * A JupyterLab extension that automatically turns a notebook cell read-only
 * once it has been executed.
 *
 * Two independent behaviours:
 *
 *  1. When a cell finishes executing successfully, it is frozen
 *     (`editable: false`, `deletable: false`). This persists in the notebook.
 *
 *  2. A copy/duplicate of a frozen cell must paste as an *editable* cell so
 *     the user can tweak and re-run it. JupyterLab's copy keeps the
 *     `editable` metadata, so any cell inserted after the notebook has
 *     loaded gets thawed.
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

    // 2. Keep copies of frozen cells editable. Copy/cut keeps the `editable`
    //    metadata on the clipboard, so a pasted (or duplicated) frozen cell
    //    would otherwise stay read-only. Thaw any cell inserted *after* the
    //    notebook has loaded — the post-load gate (`context.ready`) leaves
    //    the persisted freeze state of an opened notebook untouched. Freshly
    //    created empty cells carry no freeze metadata, so thawing them is a
    //    harmless no-op.
    tracker.widgetAdded.connect((_sender, panel: NotebookPanel) => {
      void panel.context.ready.then(() => {
        const model = panel.model;
        if (!model) {
          return;
        }
        model.cells.changed.connect((_cells, change) => {
          if (change.type !== 'add') {
            return;
          }
          for (const cellModel of change.newValues) {
            thawCellModel(cellModel);
          }
        });
      });
    });
  }
};

export default plugin;
