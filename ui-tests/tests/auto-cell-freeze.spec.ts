import { expect, galata, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

/**
 * Read the `editable` metadata of a cell in the active notebook by reaching
 * into the running JupyterLab application (exposed by galata as
 * `window.jupyterapp`). Returns `undefined` when the cell is not frozen.
 */
async function getCellEditable(
  page: Page,
  index: number
): Promise<boolean | undefined> {
  return page.evaluate(i => {
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    const model = panel.content.widgets[i].model;
    return model.getMetadata('editable');
  }, index);
}

/**
 * Whether a cell widget carries the `jp-mod-frozen` class (the visual dim hint).
 */
async function isCellDimmed(page: Page, index: number): Promise<boolean> {
  return page.evaluate(i => {
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    return panel.content.widgets[i].node.classList.contains('jp-mod-frozen');
  }, index);
}

/**
 * The source of every cell in the active notebook, in order — used to assert
 * whether a reorder happened.
 */
async function getCellSources(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    return panel.content.widgets.map((w: any) =>
      w.model.sharedModel.getSource()
    );
  });
}

/**
 * Attempt a reorder through the same method that the move commands and
 * drag-and-drop use (`Notebook.moveCell`), which the extension overrides.
 */
async function attemptMove(
  page: Page,
  from: number,
  to: number,
  n: number
): Promise<void> {
  await page.evaluate(
    ({ from, to, n }) => {
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;
      panel.content.moveCell(from, to, n);
    },
    { from, to, n }
  );
}

test.describe('auto cell freeze', () => {
  test.beforeEach(async ({ page }) => {
    await page.notebook.createNew();
  });

  test('freezes a code cell after it is executed', async ({ page }) => {
    await page.notebook.setCell(0, 'code', '1 + 1');
    await page.notebook.runCell(0);

    expect(await getCellEditable(page, 0)).toBe(false);
    expect(await isCellDimmed(page, 0)).toBe(true);
  });

  test('a pasted copy of a frozen cell is editable', async ({ page }) => {
    await page.notebook.setCell(0, 'code', '1 + 1');
    await page.notebook.runCell(0);
    expect(await getCellEditable(page, 0)).toBe(false);

    // Copy the frozen cell and paste it (the way a user would: command mode,
    // `c` to copy, `v` to paste below).
    await page.notebook.selectCells(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await page.keyboard.press('v');

    // The paste created a second cell that must NOT be read-only or dimmed.
    expect(await page.notebook.getCellCount()).toBe(2);
    expect(await getCellEditable(page, 1)).not.toBe(false);
    expect(await isCellDimmed(page, 1)).toBe(false);
    // The original stays frozen and dimmed.
    expect(await isCellDimmed(page, 0)).toBe(true);
  });

  test('frozen cells cannot be re-ordered', async ({ page }) => {
    await page.notebook.setCell(0, 'code', '# a');
    await page.notebook.runCell(0);
    expect(await getCellEditable(page, 0)).toBe(false);

    await page.notebook.addCell('code', '# b');
    await page.notebook.addCell('code', '# c');
    expect(await getCellSources(page)).toEqual(['# a', '# b', '# c']);

    // Moving the frozen cell itself is blocked.
    await attemptMove(page, 0, 1, 1);
    expect(await getCellSources(page)).toEqual(['# a', '# b', '# c']);

    // Moving an editable cell across the frozen cell is blocked.
    await attemptMove(page, 2, 0, 1);
    expect(await getCellSources(page)).toEqual(['# a', '# b', '# c']);

    // Reordering editable cells that don't cross the frozen cell still works.
    await attemptMove(page, 2, 1, 1);
    expect(await getCellSources(page)).toEqual(['# a', '# c', '# b']);
  });
});

test.describe('auto cell freeze disabled via settings', () => {
  // Start JupyterLab with the extension turned off through its setting.
  test.use({
    mockSettings: {
      ...galata.DEFAULT_SETTINGS,
      'jupyter-notebook-auto-cell-freeze:plugin': { enabled: false }
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.notebook.createNew();
  });

  test('does nothing when disabled', async ({ page }) => {
    await page.notebook.setCell(0, 'code', '# a');
    await page.notebook.runCell(0);

    // Executing a cell leaves it editable and undimmed.
    expect(await getCellEditable(page, 0)).not.toBe(false);
    expect(await isCellDimmed(page, 0)).toBe(false);

    // Reordering is not blocked either.
    await page.notebook.addCell('code', '# b');
    expect(await getCellSources(page)).toEqual(['# a', '# b']);
    await attemptMove(page, 1, 0, 1);
    expect(await getCellSources(page)).toEqual(['# b', '# a']);
  });
});
