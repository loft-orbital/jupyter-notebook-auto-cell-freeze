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

/**
 * Whether a cell is frozen (read-only). The `editable` metadata is the single
 * source of truth, so this stays correct across freeze, thaw, and notebook
 * load.
 */
export function isFrozen(model: ICellModel): boolean {
  return model.getMetadata(EDITABLE) === false;
}

/**
 * Whether moving `n` cells from index `from` to `to` would change the position
 * of a frozen cell — either the moved block itself or a cell shifted to make
 * room. Used to pin frozen cells in place.
 *
 * The move shifts every cell between the source block and the destination, so
 * the touched span is `[min(from, boundedTo), max(from + n - 1, boundedTo)]`
 * where `boundedTo` mirrors the clamping done by `Notebook.moveCell`.
 */
export function moveDisplacesFrozenCell(
  cellCount: number,
  from: number,
  to: number,
  n: number,
  isFrozenAt: (index: number) => boolean
): boolean {
  const boundedTo = Math.min(cellCount - 1, Math.max(0, to));
  const lo = Math.min(from, boundedTo);
  const hi = Math.max(from + n - 1, boundedTo);
  for (let i = lo; i <= hi; i++) {
    if (isFrozenAt(i)) {
      return true;
    }
  }
  return false;
}
