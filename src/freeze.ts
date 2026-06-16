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

/** Regex metacharacters escaped to literals when translating a glob. `*` and
 * `?` are handled by the glob translation itself, so they are absent here; `/`
 * is not special in a `RegExp` and is left as-is. */
const REGEX_METACHARS = new Set([
  '.',
  '+',
  '^',
  '$',
  '{',
  '}',
  '(',
  ')',
  '|',
  '[',
  ']',
  '\\'
]);

/**
 * Translate a glob pattern into an anchored, case-sensitive `RegExp` for
 * matching `/`-separated paths with no leading slash (the shape of a notebook's
 * `context.path`).
 *
 * Supported syntax:
 *  - a single star matches any run of characters except `/` (stays within one
 *    path segment).
 *  - a question mark matches a single character except `/`.
 *  - a globstar (two adjacent stars) crosses `/` boundaries. Its slash-bearing
 *    forms are recognised as whole tokens (see the `startsWith` cases below) so
 *    the slash can be made optional and the globstar can collapse to zero
 *    segments. A globstar bounded by slashes matches both "a/b" and "a/x/y/b"; a
 *    trailing globstar matches the directory itself ("a") and its descendants
 *    ("a/x"); a leading globstar matches with zero or more leading segments
 *    ("x" or "a/b/x"). Any other globstar becomes a cross-segment wildcard.
 *  - every other character is matched literally (regex metacharacters escaped).
 */
export function globToRegExp(pattern: string): RegExp {
  const n = pattern.length;
  let source = '^';
  let i = 0;
  while (i < n) {
    if (pattern.startsWith('/**/', i)) {
      source += '/(?:.*/)?';
      i += 4;
    } else if (pattern.startsWith('/**', i) && i + 3 === n) {
      source += '(?:/.*)?';
      i += 3;
    } else if (pattern.startsWith('**/', i)) {
      source += '(?:.*/)?';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      source += '.*';
      i += 2;
    } else {
      const c = pattern[i];
      if (c === '*') {
        source += '[^/]*';
      } else if (c === '?') {
        source += '[^/]';
      } else {
        source += REGEX_METACHARS.has(c) ? `\\${c}` : c;
      }
      i += 1;
    }
  }
  source += '$';
  return new RegExp(source);
}

/**
 * Whether `path` matches at least one of the glob `patterns`. An empty list
 * matches nothing; callers that treat "no patterns" as "everything" must handle
 * that case themselves.
 */
export function pathMatchesAny(path: string, patterns: string[]): boolean {
  return patterns.some(pattern => globToRegExp(pattern).test(path));
}
