/**
 * Small presentational building blocks shared across pages.
 */

import { useCallback, useState } from 'react';
import { shorten } from '../zk/field.js';

/* ── Hash chip with copy-to-clipboard ─────────────────────────────────────── */

export function Hash({ value, label = 'value', href, lead = 8, tail = 6 }) {
  const [copied, setCopied] = useState(false);
  const text = String(value ?? '');

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API needs a secure context; http://192.168.x.x during a
      // phone demo is not one. Fall back to the old selection trick.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* nothing more we can do */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  const display = shorten(text, lead, tail);

  return (
    <span className="hash">
      {href ? (
        <a className="mono" href={href} target="_blank" rel="noopener noreferrer" title={text}>
          {display} ↗
        </a>
      ) : (
        <span className="mono" title={text}>
          {display}
        </span>
      )}
      <button
        type="button"
        className="copy-btn"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy full ${label}`}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
}

/* ── Key/value rows ───────────────────────────────────────────────────────── */

export const DataRow = ({ label, children }) => (
  <div className="proof-dl-row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

/* ── Panels ───────────────────────────────────────────────────────────────── */

export const Panel = ({ title, children, className = '' }) => (
  <div className={`panel ${className}`}>
    {title && <h3 className="panel-title">{title}</h3>}
    {children}
  </div>
);

/** Renders a decoded error from contracts/errors.js. */
export function ErrorPanel({ error, onAction }) {
  if (!error) return null;
  const tone = error.tone === 'info' ? 'info' : 'error';

  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <strong className="notice-title">{error.title}</strong>
      <p className="notice-message">{error.message}</p>
      {error.hint && <p className="notice-hint">{error.hint}</p>}
      {error.action && onAction && (
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onAction(error)}>
          {ACTION_LABELS[error.action] ?? 'Retry'}
        </button>
      )}
      {error.raw && (
        <details className="notice-details">
          <summary>Technical detail</summary>
          <code className="mono">{String(error.raw)}</code>
        </details>
      )}
    </div>
  );
}

const ACTION_LABELS = {
  'switch-chain': 'Switch network',
  faucet: 'Get test ETH ↗',
  regenerate: 'Generate a new proof',
  retry: 'Try again',
  'goto-issuer': 'Go to the Issuer console',
  'goto-prove': 'Go to Prove',
  etherscan: 'View on the explorer ↗',
};

/* ── Empty state ──────────────────────────────────────────────────────────── */

export const EmptyState = ({ icon = '—', title, children }) => (
  <div className="empty-state">
    <span className="empty-icon" aria-hidden="true">
      {icon}
    </span>
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>
);

/* ── Skeleton loader ──────────────────────────────────────────────────────── */

export const Skeleton = ({ lines = 3 }) => (
  <div className="skeleton-group" aria-busy="true">
    <span className="sr-only">Loading…</span>
    {Array.from({ length: lines }, (_, i) => (
      <div key={i} className="skeleton" style={{ width: `${100 - i * 12}%` }} />
    ))}
  </div>
);

/* ── Stepper ──────────────────────────────────────────────────────────────── */

export function Stepper({ steps, current }) {
  return (
    <ol className="stepper">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <li key={label} className={`step step-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <span className="step-dot" aria-hidden="true">
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className="step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Progress bar ─────────────────────────────────────────────────────────── */

export function ProgressBar({ ratio, label, detail }) {
  const pct = ratio == null ? null : Math.round(ratio * 100);
  return (
    <div className="progress-wrap">
      <div className="progress-meta">
        <span>{label}</span>
        {pct != null && <span className="mono">{pct}%</span>}
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-valuetext={detail ?? label}
      >
        <div
          className={`progress-bar${pct == null ? ' is-indeterminate' : ''}`}
          style={pct == null ? undefined : { width: `${pct}%` }}
        />
      </div>
      {detail && <p className="progress-detail mono">{detail}</p>}
    </div>
  );
}
