let transitionQueue = Promise.resolve();

function afterPaint() {
  return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * Keep native window bounds and React content in the same visual transaction.
 * Calls are serialized so rapid navigation cannot reveal an intermediate view.
 */
export function transitionWindow(layout: string, render: () => void) {
  const run = async () => {
    let rendered = false;
    try {
      await window.desktop.stageLayout(layout);
      render(); rendered = true;
      await afterPaint();
    } catch (error) {
      if (!rendered) render();
      console.error('Window transition:', error);
    } finally {
      await window.desktop.revealLayout().catch(error => console.error('Window reveal:', error));
    }
  };
  const current = transitionQueue.then(run, run);
  transitionQueue = current.then(() => undefined, () => undefined);
  return current;
}
