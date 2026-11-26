/**
 * Moves focus to the first invalid control in `form`, so a failed submit takes
 * keyboard and screen-reader users straight to the problem. Relies on the
 * `ng-invalid` class Angular forms keep on every invalid control.
 */
export function focusFirstInvalid(form: HTMLFormElement): void {
  form
    .querySelector<HTMLElement>('input.ng-invalid, select.ng-invalid, textarea.ng-invalid')
    ?.focus();
}
