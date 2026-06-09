import { expect, test } from '@jupyterlab/galata';
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
});
