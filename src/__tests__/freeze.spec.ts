import type { ICellModel } from '@jupyterlab/cells';

import {
  DELETABLE,
  EDITABLE,
  freezeCellModel,
  isFrozen,
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
