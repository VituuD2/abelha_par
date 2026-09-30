/** Clipboard restrictions are a UI safeguard, not proof of a physical scan. */
export function isPasteShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v")
    || (event.shiftKey && event.key === "Insert");
}

export function isTransferredInput(inputType: string) {
  return inputType === "insertFromPaste" || inputType === "insertFromPasteAsQuotation" || inputType === "insertFromDrop";
}

export function preventTrackingTransfer(event: { preventDefault(): void }) {
  event.preventDefault();
}
