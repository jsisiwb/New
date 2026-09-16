/**
 * Shared accessible primitives for the operator application (Checkpoint 7, UI plan §4).
 *
 * Accessibility is centralized here rather than repeated per screen, because the failure mode is uniform:
 * every screen that hand-rolls its own status badge or error summary eventually ships one that a screen
 * reader cannot read. Each primitive below encodes one rule from the UI plan:
 *
 *  * STATUS IS NEVER COLOUR ALONE. `StatusBadge` always renders text, and its colour is decoration on top
 *    of a word. An operator with a colour-vision deficiency, or reading a monochrome screenshot, gets the
 *    same information.
 *  * ERRORS ARE SUMMARIZED AND FOCUSABLE. `ErrorSummary` is a labelled region that takes focus when it
 *    appears and links to the offending fields, which is what makes a failed submission recoverable
 *    without a mouse.
 *  * LIVE REGIONS ARE RESTRAINED. `LiveRegion` is polite and is used for state that an operator needs to
 *    know about (a job finished, a save succeeded) — never for progress ticks or heartbeats, which would
 *    make the page unusable with assistive technology.
 *  * DESTRUCTIVE ACTIONS CONFIRM WITH THEIR IMPACT. `ConfirmDialog` is a real modal: labelled, focus is
 *    moved into it, Escape cancels, and focus returns to the control that opened it. It refuses to render
 *    without an impact summary, because "are you sure?" without consequences is not informed consent.
 */
'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

// ---------------------------------------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------------------------------------

export type StatusTone = 'neutral' | 'progress' | 'attention' | 'good' | 'bad';

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'badge badge-neutral',
  progress: 'badge badge-progress',
  attention: 'badge badge-attention',
  good: 'badge badge-good',
  bad: 'badge badge-bad',
};

/**
 * A status chip whose meaning is carried by its TEXT.
 *
 * `tone` only changes colour. The visible label, and the `data-tone` attribute tests assert on, always
 * state the status in words.
 */
export function StatusBadge({
  label,
  tone = 'neutral',
  detail,
}: {
  label: string;
  tone?: StatusTone;
  detail?: string;
}): ReactNode {
  return (
    <span className={TONE_CLASS[tone]} data-tone={tone}>
      <span className="badge-label">{label}</span>
      {detail ? <span className="badge-detail"> — {detail}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------------------------------------

export interface FieldError {
  readonly path: string;
  readonly message: string;
}

/**
 * An error summary that takes focus when it appears.
 *
 * Moving focus here is the difference between a keyboard operator discovering the failure and silently
 * re-submitting the same broken form. `role="alert"` announces it; `tabIndex={-1}` makes it focusable
 * programmatically without adding it to the tab order afterwards.
 */
export function ErrorSummary({
  title,
  message,
  fields = [],
}: {
  title?: string;
  message: string;
  fields?: readonly FieldError[];
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [message]);
  return (
    <div className="error-summary" role="alert" tabIndex={-1} ref={ref}>
      <h2 className="error-summary-title">{title ?? 'There is a problem'}</h2>
      <p>{message}</p>
      {fields.length > 0 ? (
        <ul>
          {fields.map((field) => (
            <li key={`${field.path}:${field.message}`}>
              <a href={`#${fieldId(field.path)}`}>
                {field.path}: {field.message}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A stable DOM id for a field path, so an error summary can link to the control that failed. */
export function fieldId(path: string): string {
  return `field-${path.replace(/[^A-Za-z0-9]+/g, '-')}`;
}

// ---------------------------------------------------------------------------------------------------------
// live region
// ---------------------------------------------------------------------------------------------------------

/**
 * A polite live region for meaningful state changes only.
 *
 * `aria-live="polite"` waits for a pause rather than interrupting. Nothing high-frequency belongs here:
 * SSE heartbeats and per-token progress are deliberately excluded at the call sites.
 */
export function LiveRegion({ message }: { message: string }): ReactNode {
  return (
    <div className="live-region" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// loading / empty states
// ---------------------------------------------------------------------------------------------------------

/**
 * The three states every asynchronous region has, rendered accessibly instead of as a bare spinner.
 *
 * A spinner with no text is invisible to a screen reader; an empty list with no explanation is
 * indistinguishable from a broken one.
 */
export function AsyncRegion({
  loading,
  error,
  empty,
  emptyMessage,
  label,
  children,
}: {
  loading: boolean;
  error?: string | undefined;
  empty?: boolean;
  emptyMessage?: string;
  label: string;
  children: ReactNode;
}): ReactNode {
  if (loading)
    return (
      <p className="async-state" role="status">
        Loading {label}…
      </p>
    );
  if (error) return <ErrorSummary message={error} />;
  if (empty) return <p className="async-state async-empty">{emptyMessage ?? `No ${label} yet.`}</p>;
  return <>{children}</>;
}

// ---------------------------------------------------------------------------------------------------------
// confirmation dialog for destructive / high-impact actions
// ---------------------------------------------------------------------------------------------------------

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** What will happen. Required: a confirmation without consequences is not informed consent. */
  readonly impact: ReactNode;
  readonly confirmLabel: string;
  /**
   * When set, the operator must type this exact word to enable the confirm button. Reserved for the
   * genuinely irreversible operations (retcon, rollback), so muscle memory cannot commit one.
   */
  readonly requirePhrase?: string | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  impact,
  confirmLabel,
  requirePhrase,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactNode {
  const titleId = useId();
  const descriptionId = useId();
  const phraseId = useId();
  const [phrase, setPhrase] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const phraseRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPhrase('');
      return;
    }
    // Focus goes INTO the dialog when it opens: a modal a keyboard operator has to hunt for is not modal.
    // When a phrase is required the field is the first thing needed, so it takes focus instead.
    if (requirePhrase) phraseRef.current?.focus();
    else confirmRef.current?.focus();
  }, [open, requirePhrase]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  if (!open) return null;
  const confirmable = !requirePhrase || phrase.trim() === requirePhrase;

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <div id={descriptionId} className="dialog-impact">
          {impact}
        </div>
        {requirePhrase ? (
          <p className="dialog-phrase">
            <label htmlFor={phraseId}>
              Type <strong>{requirePhrase}</strong> to confirm
            </label>
            <input
              id={phraseId}
              ref={phraseRef}
              type="text"
              value={phrase}
              autoComplete="off"
              onChange={(e) => {
                setPhrase(e.target.value);
              }}
            />
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            className="danger"
            disabled={!confirmable}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Wire a destructive action to a confirmation dialog, returning focus to the trigger afterwards.
 *
 * Returning focus matters: after a dialog closes, a keyboard operator whose focus was dropped to `<body>`
 * has to tab from the top of the page to get back to where they were.
 */
export function useConfirm(): {
  open: boolean;
  request: (trigger: HTMLElement | null) => void;
  resolve: (confirmed: boolean, run?: () => void) => void;
} {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  return {
    open,
    request: (trigger) => {
      triggerRef.current = trigger;
      setOpen(true);
    },
    resolve: (confirmed, run) => {
      setOpen(false);
      if (confirmed) run?.();
      triggerRef.current?.focus();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// forms
// ---------------------------------------------------------------------------------------------------------

/**
 * A labelled field with a programmatic description.
 *
 * `aria-describedby` carries the hint and `aria-invalid` marks failure, so the control announces its own
 * problem rather than relying on a colour change next to it.
 */
export function Field({
  path,
  label,
  hint,
  error,
  children,
}: {
  path: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => ReactNode;
}): ReactNode {
  const id = fieldId(path);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <p className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {error ? (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      ) : null}
    </p>
  );
}

/** A form that prevents the default submit and hands the event to an async handler. */
export function Form({
  onSubmit,
  children,
  label,
}: {
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
  label: string;
}): ReactNode {
  return (
    <form
      aria-label={label}
      onSubmit={(event: SyntheticEvent) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      {children}
    </form>
  );
}
