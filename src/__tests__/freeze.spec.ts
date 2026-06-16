import type { ICellModel } from '@jupyterlab/cells';

import {
  DELETABLE,
  EDITABLE,
  freezeCellModel,
  globToRegExp,
  isFrozen,
  moveDisplacesFrozenCell,
  pathMatchesAny,
  thawCellModel
} from '../freeze';

/**
 * A minimal in-memory stand-in for the slice of `ICellModel` that the freeze
 * helpers touch. Importing the real cell models pulls the entire JupyterLab
 * UI stack into jest; the helpers only ever call the metadata accessors, so a
 * Map-backed fake exercises them faithfully. The end-to-end behaviour (that
 * JupyterLab honours `editable: false`) is covered by the Galata UI test.
 */
let model: ICellModel;

beforeEach(() => {
  const metadata = new Map<string, unknown>();
  model = {
    getMetadata: (key: string) => metadata.get(key),
    setMetadata: (key: string, value: unknown) => {
      metadata.set(key, value);
    },
    deleteMetadata: (key: string) => {
      metadata.delete(key);
    }
  } as unknown as ICellModel;
});

describe('freezeCellModel', () => {
  it('marks a cell read-only and non-deletable', () => {
    freezeCellModel(model);

    expect(model.getMetadata(EDITABLE)).toBe(false);
    expect(model.getMetadata(DELETABLE)).toBe(false);
  });
});

describe('thawCellModel', () => {
  it('removes the freeze metadata so the cell is editable again', () => {
    freezeCellModel(model);

    thawCellModel(model);

    expect(model.getMetadata(EDITABLE)).toBeUndefined();
    expect(model.getMetadata(DELETABLE)).toBeUndefined();
  });

  it('is a no-op for a cell that was never frozen', () => {
    expect(() => thawCellModel(model)).not.toThrow();
    expect(model.getMetadata(EDITABLE)).toBeUndefined();
    expect(model.getMetadata(DELETABLE)).toBeUndefined();
  });
});

describe('isFrozen', () => {
  it('is true only when the cell is frozen', () => {
    expect(isFrozen(model)).toBe(false);

    freezeCellModel(model);
    expect(isFrozen(model)).toBe(true);

    thawCellModel(model);
    expect(isFrozen(model)).toBe(false);
  });

  it('is false when the cell is explicitly editable', () => {
    model.setMetadata(EDITABLE, true);

    expect(isFrozen(model)).toBe(false);
  });
});

describe('moveDisplacesFrozenCell', () => {
  // Cells: [0, 1, 2(frozen), 3, 4]
  const frozenAt2 = (i: number): boolean => i === 2;

  it('blocks moving the frozen cell itself', () => {
    // Move cell 2 down one (to=3).
    expect(moveDisplacesFrozenCell(5, 2, 3, 1, frozenAt2)).toBe(true);
    // Move cell 2 up one (to=1).
    expect(moveDisplacesFrozenCell(5, 2, 1, 1, frozenAt2)).toBe(true);
  });

  it('blocks an editable move that crosses the frozen cell', () => {
    // Move editable cell 4 up to index 0 — sweeps across cell 2.
    expect(moveDisplacesFrozenCell(5, 4, 0, 1, frozenAt2)).toBe(true);
    // Move editable cell 1 down past cell 2 (to=3).
    expect(moveDisplacesFrozenCell(5, 1, 3, 1, frozenAt2)).toBe(true);
  });

  it('allows editable moves that do not cross the frozen cell', () => {
    // Swap cells 0 and 1 — entirely above the frozen cell.
    expect(moveDisplacesFrozenCell(5, 0, 1, 1, frozenAt2)).toBe(false);
    // Swap cells 3 and 4 — entirely below the frozen cell.
    expect(moveDisplacesFrozenCell(5, 4, 3, 1, frozenAt2)).toBe(false);
  });

  it('allows any move when no cell is frozen', () => {
    expect(moveDisplacesFrozenCell(5, 4, 0, 1, () => false)).toBe(false);
  });
});

describe('globToRegExp', () => {
  const matches = (pattern: string, path: string): boolean =>
    globToRegExp(pattern).test(path);

  it('treats `*` as within-segment (does not cross `/`)', () => {
    expect(matches('*.ipynb', 'Untitled.ipynb')).toBe(true);
    expect(matches('*.ipynb', 'dir/Untitled.ipynb')).toBe(false);
    expect(matches('data/*.csv', 'data/a.csv')).toBe(true);
    expect(matches('data/*.csv', 'data/sub/a.csv')).toBe(false);
  });

  it('treats `**` as crossing `/`, including zero segments', () => {
    expect(matches('**/*.ipynb', 'Untitled.ipynb')).toBe(true);
    expect(matches('**/*.ipynb', 'a/b.ipynb')).toBe(true);
    expect(matches('**/*.ipynb', 'a/b/c.ipynb')).toBe(true);

    expect(matches('a/**/b', 'a/b')).toBe(true);
    expect(matches('a/**/b', 'a/x/b')).toBe(true);
    expect(matches('a/**/b', 'a/x/y/b')).toBe(true);
    expect(matches('a/**/b', 'a/b/c')).toBe(false);
    expect(matches('a/**/b', 'x/a/b')).toBe(false);
  });

  it('matches a trailing `/**` against the directory itself and descendants', () => {
    expect(matches('a/**', 'a')).toBe(true);
    expect(matches('a/**', 'a/x')).toBe(true);
    expect(matches('a/**', 'a/x/y')).toBe(true);
    expect(matches('a/**', 'b/x')).toBe(false);
  });

  it('matches everything for a bare `**`', () => {
    expect(matches('**', 'x')).toBe(true);
    expect(matches('**', 'a/b/c')).toBe(true);
  });

  it('treats `?` as a single non-`/` character', () => {
    expect(matches('notebook?.ipynb', 'notebook1.ipynb')).toBe(true);
    expect(matches('notebook?.ipynb', 'notebook12.ipynb')).toBe(false);
    expect(matches('notebook?.ipynb', 'notebook/.ipynb')).toBe(false);
  });

  it('escapes regex metacharacters so they match literally', () => {
    expect(matches('report.ipynb', 'report.ipynb')).toBe(true);
    expect(matches('report.ipynb', 'reportXipynb')).toBe(false);
    expect(matches('a+b/c.ipynb', 'a+b/c.ipynb')).toBe(true);
    expect(matches('a+b/c.ipynb', 'aaab/c.ipynb')).toBe(false);
    expect(matches('(x)[y].ipynb', '(x)[y].ipynb')).toBe(true);
  });

  it('anchors the whole path', () => {
    expect(matches('*.ipynb', 'x.ipynb.bak')).toBe(false);
    expect(matches('data/*', 'xdata/y')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(matches('*.IPYNB', 'x.ipynb')).toBe(false);
    expect(matches('*.ipynb', 'x.ipynb')).toBe(true);
  });
});

describe('pathMatchesAny', () => {
  it('returns false for an empty pattern list', () => {
    expect(pathMatchesAny('a/b.ipynb', [])).toBe(false);
  });

  it('matches when any single pattern matches (OR semantics)', () => {
    const patterns = ['a/**', 'b/**'];
    expect(pathMatchesAny('a/x', patterns)).toBe(true);
    expect(pathMatchesAny('b/y', patterns)).toBe(true);
    expect(pathMatchesAny('c/z', patterns)).toBe(false);
  });

  it('matches when a later pattern matches after an earlier miss', () => {
    expect(
      pathMatchesAny('reports/q1.ipynb', ['drafts/**', 'reports/*.ipynb'])
    ).toBe(true);
  });
});
