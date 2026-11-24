export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '—';
  }
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}₹${Math.abs(rounded).toLocaleString('en-IN')}`;
}

export function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function maskPan(pan: string | null | undefined): string {
  if (!pan) return '—';
  const trimmed = pan.trim().toUpperCase();
  if (trimmed.length === 10) {
    return `${trimmed.slice(0, 5)}****${trimmed.slice(9)}`;
  }
  return redactSensitiveText(trimmed);
}

export function maskAccountNumber(account: string | null | undefined): string {
  if (!account) return '—';
  const trimmed = account.trim();
  if (trimmed.length >= 6) {
    return `XXXXXXXX${trimmed.slice(-4)}`;
  }
  return 'XXXX';
}

/**
 * Redacts raw PAN, TAN, bank accounts, phone numbers, emails, and API-key patterns
 * before rendering arguments, responses, or previews in inspector UI components.
 */
export function redactSensitiveText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\b([A-Z]{5})([0-9]{4})([A-Z])\b/g, '$1****$3')
    .replace(/\b([A-Z]{4}[0-9])([0-9]{4})([A-Z])\b/g, '$1****$3')
    .replace(/\b([0-9]{6,12})([0-9]{4})\b/g, (m, _p1, last4) =>
      m.length >= 10 ? `XXXXXXXX${last4}` : m
    )
    .replace(/\+91-[0-9]{5}-([0-9]{5})/g, '+91-XXXXX-$1')
    .replace(
      /\b([a-zA-Z0-9._%+-]{2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
      '$1***@$2'
    )
    .replace(/\b(AIza[0-9A-Za-z_-]{12,}|sk-[0-9A-Za-z_-]{16,})\b/g, '[REDACTED_API_KEY]');
}
