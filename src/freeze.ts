import { ICellModel } from '@jupyterlab/cells';

/**
 * Cell metadata keys that control whether a cell can be edited or deleted.
 * Setting `editable: false` makes JupyterLab flip the cell editor to
 * read-only; `deletable: false` prevents the cell from being deleted.
 */
export const EDITABLE = 'editable';
export const DELETABLE = 'deletable';

/**
 * Make a cell read-only and non-deletable ("frozen").
 */
export function freezeCellModel(model: ICellModel): void {
  model.setMetadata(EDITABLE, false);
  model.setMetadata(DELETABLE, false);
}

/**
 * Remove the freeze metadata so a cell becomes editable and deletable again.
 *
 * This is a no-op for cells that were never frozen.
 */
export function thawCellModel(model: ICellModel): void {
  model.deleteMetadata(EDITABLE);
  model.deleteMetadata(DELETABLE);
}
