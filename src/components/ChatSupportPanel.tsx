import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Loader2,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ApprovalRequest, ChatMessage, RagRuleCitation } from '../shared/types';
import { MarkdownMessage } from './MarkdownMessage';
import { Button } from './DesignSystem';

interface ChatSupportPanelProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  pendingApprovals: ApprovalRequest[];
  pendingQuestion: string | null;
  sending: boolean;
  onSendQuestion: (question: string) => Promise<void>;
  onResolveApproval: (
    approvalId: string,
    action: 'approve' | 'reject' | 'cancel'
  ) => Promise<void>;
}

const QUICK_PROMPTS = [
  'Why is one tax regime better for me right now?',
  'How are savings interest and FD interest taxed?',
  'What items still need my review before submitting?',
];

export const ChatSupportPanel: React.FC<ChatSupportPanelProps> = ({
  open,
  onClose,
  messages,
  pendingApprovals,
  pendingQuestion,
  sending,
  onSendQuestion,
  onResolveApproval,
}) => {
  const [draft, setDraft] = useState('');
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, messages.length, pendingQuestion, sending]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setDraft('');
    await onSendQuestion(trimmed);
  };

  const toggleCitations = (msgId: string) => {
    setExpandedCitations((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const renderCitations = (msgId: string, citations: RagRuleCitation[]) => {
    if (!citations || citations.length === 0) return null;
    const expanded = Boolean(expandedCitations[msgId]);
    return (
      <div className="mt-2 pt-2 border-t border-[#E2E8F0]">
        <button
          type="button"
          onClick={() => toggleCitations(msgId)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#64748B] hover:text-[#172B4D] cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <span>Rule reference ({citations.length})</span>
        </button>
        {expanded && (
          <div className="mt-2 space-y-2">
            {citations.map((c) => (
              <div
                key={c.id}
                className="p-2.5 rounded-lg bg-white border border-[#E2E8F0] text-[11px] space-y-1"
              >
                <div className="font-semibold text-[#172B4D]">
                  {c.section} · {c.title}
                </div>
                <div className="text-[#64748B] leading-relaxed">{c.summary}</div>
                <div className="text-[10px] font-mono text-[#64748B]">
                  Limit: {c.statutoryLimit} · {c.assessmentYear}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const panelBody = (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-[#2563EB] shrink-0" />
            <h2 className="text-sm font-semibold text-[#172B4D] truncate">
              Tax Support
            </h2>
          </div>
          <p className="text-[11px] text-[#64748B] truncate mt-0.5">
            Plain-English answers from your return &amp; AY 2026-27 rules
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Tax Support"
          className="p-1.5 text-[#64748B] hover:text-[#172B4D] hover:bg-[#F8FAFC] rounded-lg cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !pendingQuestion && (
          <div className="space-y-4 py-2">
            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5">
              <div className="text-xs font-semibold text-[#172B4D]">
                Need clarity on any number?
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Click any <span className="font-semibold text-[#172B4D]">?</span> button next to an income, deduction, or regime option, or ask a question below.
              </p>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-[#64748B]">
                Common questions
              </div>
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => onSendQuestion(prompt)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] hover:border-blue-300 text-xs text-[#172B4D] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const linkedPending = (msg.pendingApprovalIds ?? [])
            .map((id) => pendingApprovals.find((a) => a.id === id))
            .filter((a): a is ApprovalRequest => Boolean(a));

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[92%] rounded-xl px-3.5 py-2.5 text-xs ${
                  isUser
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-[#F8FAFC] border border-[#E2E8F0] text-[#172B4D]'
                }`}
              >
                {isUser ? (
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <>
                    <MarkdownMessage content={msg.content} />
                    {msg.citations && msg.citations.length > 0 && renderCitations(msg.id, msg.citations)}
                  </>
                )}
              </div>

              {linkedPending.length > 0 && (
                <div className="mt-2 w-full max-w-[92%] p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                  {linkedPending.map((approval) => (
                    <div key={approval.id} className="space-y-2">
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                        <div className="text-[11px] text-[#172B4D] leading-snug">
                          <span className="font-semibold">Confirmation required: </span>
                          {approval.summary}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          loading={resolvingId === approval.id}
                          onClick={async () => {
                            setResolvingId(approval.id);
                            try {
                              await onResolveApproval(approval.id, 'approve');
                            } finally {
                              setResolvingId(null);
                            }
                          }}
                        >
                          Approve &amp; Apply
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resolvingId === approval.id}
                          onClick={async () => {
                            setResolvingId(approval.id);
                            try {
                              await onResolveApproval(approval.id, 'reject');
                            } finally {
                              setResolvingId(null);
                            }
                          }}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {pendingQuestion && (
          <div className="flex flex-col items-end">
            <div className="max-w-[92%] rounded-xl px-3.5 py-2.5 text-xs bg-[#2563EB] text-white">
              <p className="leading-relaxed whitespace-pre-wrap">{pendingQuestion}</p>
            </div>
          </div>
        )}

        {sending && (
          <div className="flex items-start">
            <div className="rounded-xl px-3.5 py-2.5 text-xs bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B] flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2563EB]" />
              <span>Checking your numbers and tax rules...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-[#E2E8F0] bg-white shrink-0"
      >
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit(e);
              }
            }}
            placeholder="Ask why a deduction applies or which regime saves more..."
            className="flex-1 resize-none rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs text-[#172B4D] placeholder:text-[#64748B] focus:bg-white focus:outline-none focus:border-[#2563EB]"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={sending}
            disabled={!draft.trim()}
            aria-label="Send question"
            icon={<Send className="w-3.5 h-3.5" />}
            className="h-9 px-3"
          >
            Ask
          </Button>
        </div>
      </form>
    </div>
  );

  return (
    <>
      {/* Desktop Collapsible Side Panel */}
      <aside
        aria-label="Tax Support Chat"
        className="hidden lg:flex lg:flex-col w-[360px] xl:w-[390px] shrink-0 border-l border-[#E2E8F0] bg-white h-[calc(100vh-4rem)] sticky top-16"
      >
        {panelBody}
      </aside>

      {/* Mobile / Tablet Floating Drawer */}
      <div className="fixed inset-0 z-50 lg:hidden flex justify-end">
        <div
          className="fixed inset-0 bg-[#172B4D]/25"
          onClick={onClose}
        />
        <aside
          aria-label="Tax Support Chat"
          className="relative z-10 w-full max-w-sm bg-white border-l border-[#E2E8F0] shadow-xl h-full flex flex-col"
        >
          {panelBody}
        </aside>
      </div>
    </>
  );
};
