import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
}

/**
 * Sanitizes href URLs so only safe external/mailto links render.
 * Blocks javascript:, data:, vbscript:, and file: protocols.
 */
function sanitizeSafeUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'mailto:'
    ) {
      return trimmed;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Strips accidental trailing plain-text pseudo-button lines (e.g. `[Confirm & Include All] [Update Information]`)
 * if a language model ever appends them, since real interactive buttons are rendered separately.
 */
function normalizeAssistantMarkdown(raw: string): string {
  if (!raw) return '';
  const cleanedPrefix = raw.replace(/^\[Deterministic Non-LLM Fallback Mode\]\s*/i, '');
  const lines = cleanedPrefix.split('\n');
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    const isBracketButtonsLine =
      /^(\[[^\]]{3,45}\]\s*[|·•-]?\s*){2,}$/.test(trimmed) &&
      /(confirm|include|update|compare|approve|reject)/i.test(trimmed);
    return !isBracketButtonsLine;
  });
  return filtered.join('\n').trim();
}

/**
 * Safe, sanitized white/light-theme financial Markdown renderer using `react-markdown` + `remark-gfm`.
 * - Never enables `rehype-raw` or `dangerouslySetInnerHTML`.
 * - Renders clean headings, GFM financial tables, lists, dividers, and light-themed code blocks.
 */
export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  const normalized = normalizeAssistantMarkdown(content);

  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-[#172B4D] break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={sanitizeSafeUrl}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base font-bold tracking-tight text-[#172B4D] pt-1 pb-1.5 border-b border-[#E2E8F0]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[15px] font-semibold tracking-tight text-[#172B4D] pt-1.5">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-[#172B4D] pt-1">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-[13px] leading-relaxed text-[#334155]">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-[#172B4D]">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-[#64748B]">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-1.5 text-[13px] text-[#334155]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-[#334155]">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          hr: () => <hr className="border-[#E2E8F0] my-3" />,
          blockquote: ({ children }) => (
            <blockquote className="px-3.5 py-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-[#334155] text-xs">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-[#E2E8F0] bg-white">
              <table className="w-full text-left border-collapse text-xs font-sans tabular-nums">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B]">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-[#E2E8F0]">{children}</tbody>
          ),
          tr: ({ children }) => <tr className="hover:bg-[#F8FAFC]/80">{children}</tr>,
          th: ({ children }) => (
            <th className="py-2.5 px-3 font-semibold text-[#172B4D] whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="py-2.5 px-3 text-[#334155] align-top tabular-nums">
              {children}
            </td>
          ),
          pre: ({ children }) => (
            <pre className="p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-[#172B4D] font-mono text-xs overflow-x-auto leading-relaxed my-2">
              {children}
            </pre>
          ),
          code: ({ className, children }) => {
            const isBlock = Boolean(className && className.includes('language-'));
            if (isBlock) {
              return <code className="font-mono text-xs text-[#172B4D]">{children}</code>;
            }
            return (
              <code className="px-1.5 py-0.5 rounded bg-[#F8FAFC] border border-[#E2E8F0] font-mono text-[11.5px] text-[#2563EB]">
                {children}
              </code>
            );
          },
          a: ({ href, children }) => {
            if (!href) {
              return <span className="text-[#334155]">{children}</span>;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#2563EB] underline underline-offset-2 hover:text-[#1D4ED8]"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
};
