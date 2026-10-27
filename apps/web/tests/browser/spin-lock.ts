import type { Page } from '@playwright/test';

/**
 * Tries every way to start a round (click, synthetic click, Space, Enter) — but only while the spin button is still
 * locked, checked in the same page task as the inputs. A slow browser can end the round between a Playwright-side check
 * and a key press, and an input after that legitimately starts the next round; doing both in one task removes that race.
 * Returns false (and sends nothing) once the button is enabled again.
 */
export async function pokeWhileLocked(page: Page, spinTestId: string): Promise<boolean> {
  return page.evaluate(id => {
    const button = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
    if (!button || !button.disabled) return false;
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const target = document.querySelector('h1') ?? document.body;
    for (const [key, code] of [[' ', 'Space'], ['Enter', 'Enter']] as const) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
    }
    return true;
  }, spinTestId);
}
