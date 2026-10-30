import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Info,
  Loader2,
  X,
} from 'lucide-react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'teal'
  | 'danger'
  | 'ghost';

export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[#2563EB] text-white border border-[#2563EB] hover:bg-[#1D4ED8] hover:border-[#1D4ED8] shadow-[0_1px_2px_rgba(37,99,235,0.18)]',
  secondary:
    'bg-[#F8FAFC] text-[#172B4D] border border-[#E2E8F0] hover:bg-slate-100 hover:border-slate-300',
  outline:
    'bg-white text-[#172B4D] border border-[#E2E8F0] hover:bg-[#F8FAFC] hover:border-slate-300',
  teal:
    'bg-teal-50/70 text-[#0D9488] border border-teal-200 hover:bg-teal-50 hover:border-teal-300',
  danger:
    'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 hover:border-rose-300',
  ghost:
    'bg-transparent text-[#64748B] border border-transparent hover:bg-[#F8FAFC] hover:text-[#172B4D]',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg gap-1.5',
  md: 'px-4 py-2 text-xs rounded-lg gap-2',
  lg: 'px-5 py-2.5 text-sm rounded-lg gap-2',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'outline',
  size = 'md',
  loading = false,
  icon,
  rightIcon,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}) => {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : icon}
      {children}
      {!loading && rightIcon}
    </button>
  );
};

export type SemanticTone =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'teal'
  | 'neutral';

const TONE_STYLES: Record<
  SemanticTone,
  {
    box: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  success: {
    box: 'bg-emerald-50/80 text-emerald-800 border-emerald-200',
    Icon: CheckCircle2,
  },
  warning: {
    box: 'bg-amber-50/80 text-amber-800 border-amber-200',
    Icon: AlertTriangle,
  },
  error: {
    box: 'bg-rose-50/80 text-rose-800 border-rose-200',
    Icon: AlertOctagon,
  },
  info: {
    box: 'bg-blue-50/90 text-[#2563EB] border-blue-200',
    Icon: Info,
  },
  teal: {
    box: 'bg-teal-50/80 text-[#0D9488] border-teal-200',
    Icon: CheckCircle2,
  },
  neutral: {
    box: 'bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0]',
    Icon: Clock,
  },
};

export const StatusIndicator: React.FC<{
  tone: SemanticTone;
  label: string;
  hideIcon?: boolean;
  mono?: boolean;
  className?: string;
}> = ({ tone, label, hideIcon = false, mono = false, className = '' }) => {
  const { box, Icon } = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium whitespace-nowrap ${
        mono ? 'font-mono tabular-nums' : ''
      } ${box} ${className}`}
    >
      {!hideIcon && <Icon className="w-3 h-3 shrink-0" />}
      <span>{label}</span>
    </span>
  );
};

export const SurfaceCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}> = ({ children, className = '', noPadding = false }) => (
  <div
    className={`bg-white border border-[#E2E8F0] rounded-xl shadow-[0_1px_2px_rgba(23,43,77,0.04)] ${
      noPadding ? '' : 'p-6'
    } ${className}`}
  >
    {children}
  </div>
);

export const PageHeader: React.FC<{
  eyebrow?: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ eyebrow, title, description, actions, footer }) => (
  <SurfaceCard>
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
      <div className="space-y-1 max-w-3xl">
        {eyebrow && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B] font-mono tabular-nums">
            {eyebrow}
          </div>
        )}
        <h1 className="text-xl font-bold tracking-tight text-[#172B4D]">
          {title}
        </h1>
        {description && (
          <p className="text-xs sm:text-[13px] text-[#64748B] leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {actions}
        </div>
      )}
    </div>
    {footer && (
      <div className="mt-5 pt-5 border-t border-[#E2E8F0]">{footer}</div>
    )}
  </SurfaceCard>
);

export const MetricCard: React.FC<{
  label: string;
  value: string;
  subtext?: React.ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'blue';
  onClick?: () => void;
}> = ({ label, value, subtext, tone = 'default', onClick }) => {
  const valueTone =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-rose-700'
        : tone === 'blue'
          ? 'text-[#2563EB]'
          : 'text-[#172B4D]';

  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      {...(onClick ? { type: 'button', onClick } : {})}
      className={`text-left bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-[0_1px_2px_rgba(23,43,77,0.03)] transition-colors ${
        onClick ? 'hover:border-blue-300 hover:bg-[#F8FAFC]/60 cursor-pointer' : ''
      }`}
    >
      <div className="text-xs font-medium text-[#64748B] truncate">{label}</div>
      <div
        className={`text-xl font-bold font-mono tabular-nums tracking-tight mt-1.5 ${valueTone}`}
      >
        {value}
      </div>
      {subtext && (
        <div className="text-[11px] text-[#64748B] mt-1 font-mono tabular-nums truncate">
          {subtext}
        </div>
      )}
    </Wrapper>
  );
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 p-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg overflow-x-auto max-w-full"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              active
                ? 'bg-white text-[#2563EB] font-semibold border border-[#E2E8F0] shadow-[0_1px_2px_rgba(23,43,77,0.05)]'
                : 'text-[#64748B] hover:text-[#172B4D] border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="py-12 px-6 text-center max-w-md mx-auto space-y-3">
    {icon && (
      <div className="w-10 h-10 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-[#2563EB] flex items-center justify-center mx-auto">
        {icon}
      </div>
    )}
    <h3 className="text-sm font-semibold text-[#172B4D]">{title}</h3>
    <p className="text-xs text-[#64748B] leading-relaxed">{description}</p>
    {action && <div className="pt-2 flex justify-center gap-2.5 flex-wrap">{action}</div>}
  </div>
);

export const LightCodeBlock: React.FC<{
  code: string;
  title?: string;
  maxHeightClass?: string;
  allowCopy?: boolean;
}> = ({ code, title, maxHeightClass = 'max-h-[460px]', allowCopy = true }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard permission restrictions in sandboxed environments
    }
  };

  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] overflow-hidden">
      {(title || allowCopy) && (
        <div className="px-3.5 py-2 bg-white border-b border-[#E2E8F0] flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono font-medium text-[#64748B]">
            {title || 'Structured Output'}
          </span>
          {allowCopy && (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#64748B] hover:text-[#172B4D] bg-[#F8FAFC] border border-[#E2E8F0] rounded cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-700" />
                  <span className="text-emerald-700">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
      <pre
        className={`p-4 font-mono text-xs text-[#172B4D] overflow-x-auto overflow-y-auto leading-relaxed whitespace-pre ${maxHeightClass}`}
      >
        {code}
      </pre>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  description: string;
  details?: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}> = ({
  open,
  title,
  description,
  details,
  confirmLabel,
  confirmVariant = 'primary',
  loading = false,
  onConfirm,
  onClose,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#172B4D]/25"
    >
      <div className="bg-white border border-[#E2E8F0] rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E2E8F0]">
          <h3
            id="confirm-dialog-title"
            className="text-base font-semibold text-[#172B4D]"
          >
            {title}
          </h3>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            aria-label="Close confirmation dialog"
            className="p-1 text-[#64748B] hover:text-[#172B4D] rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#64748B] leading-relaxed">{description}</p>

        {details && (
          <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#172B4D]">
            {details}
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#E2E8F0]">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Keep Pending
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
