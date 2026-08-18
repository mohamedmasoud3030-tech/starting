/**
 * Opens the browser print dialog scoped to the document element(s) carrying
 * `[data-document]`. The print stylesheet (index.css `@media print`) isolates
 * those elements on paper; the browser's "Save as PDF" then yields a real PDF
 * with correct Arabic RTL layout — no server or heavy client library required.
 */
export function printDocument() {
  window.print();
}
