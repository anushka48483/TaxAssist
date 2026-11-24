import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Lock,
  RefreshCw,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import {
  DocumentCategory,
  DOCUMENT_CATEGORY_LABELS,
  UploadedDocument,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatBytes, formatDateTime } from '../utils/format';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  LightCodeBlock,
  PageHeader,
  SegmentedControl,
  SemanticTone,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface DocumentCenterViewProps {
  snapshot: WorkspaceSnapshot;
  onUploadBatch: (
    files: File[],
    explicitCategory?: DocumentCategory
  ) => Promise<UploadedDocument[]>;
  onReextractDocument: (docId: string) => Promise<void>;
  onUploadSyntheticDemoPack: () => Promise<void>;
  onDownloadSyntheticFiles: () => Promise<void>;
  onToggleAcl: (docId: string, allowed: boolean) => Promise<void>;
  onDeleteDocument: (docId: string) => Promise<void>;
  onNavigateToAssistant: () => void;
}

const ALL_CATEGORIES: DocumentCategory[] = [
  'form_16',
  'salary_slips',
  'bank_statements',
  'interest_certificates',
  'investment_proofs',
  'form_26as',
  'ais',
  'tis',
  'other_tax_doc',
];

function getExtractionBadge(doc: UploadedDocument): {
  tone: SemanticTone;
  label: string;
} {
  if (doc.processingStatus === 'error') {
    return { tone: 'error', label: 'Failed' };
  }
  if (
    doc.processingStatus === 'validating' ||
    doc.processingStatus === 'parsing' ||
    doc.processingStatus === 'ocr_running'
  ) {
    return { tone: 'info', label: 'Processing' };
  }
  if (doc.processingStatus === 'uploaded') {
    return { tone: 'neutral', label: 'Uploaded' };
  }
  if (doc.needsUserReview || doc.validationErrors.length > 0) {
    return { tone: 'warning', label: 'Needs Review' };
  }
  return { tone: 'success', label: 'Extracted' };
}

function getVerificationBadge(doc: UploadedDocument): {
  tone: SemanticTone;
  label: string;
} {
  if (doc.validationErrors.length > 0) {
    return { tone: 'error', label: 'Validation Issue' };
  }
  if (doc.needsUserReview) {
    return { tone: 'warning', label: 'Review Required' };
  }
  const allVerified =
    doc.extractedFacts.length > 0 &&
    doc.extractedFacts.every((f) => f.validationStatus === 'verified');
  if (allVerified) {
    return { tone: 'success', label: 'Verified' };
  }
  return { tone: 'neutral', label: 'Pending Review' };
}

function getAverageConfidencePct(doc: UploadedDocument): number | null {
  if (!doc.extractedFacts || doc.extractedFacts.length === 0) return null;
  const sum = doc.extractedFacts.reduce((acc, f) => acc + f.confidence, 0);
  return Math.round((sum / doc.extractedFacts.length) * 100);
}

export const DocumentCenterView: React.FC<DocumentCenterViewProps> = ({
  snapshot,
  onUploadBatch,
  onReextractDocument,
  onUploadSyntheticDemoPack,
  onDownloadSyntheticFiles,
  onToggleAcl,
  onDeleteDocument,
  onNavigateToAssistant,
}) => {
  const { documents } = snapshot;
  const [selectedDocId, setSelectedDocId] = useState<string>(
    documents[0]?.id ?? ''
  );
  const [categoryFilter, setCategoryFilter] = useState<'all' | DocumentCategory>(
    'all'
  );
  const [explicitUploadCategory, setExplicitUploadCategory] = useState<
    '' | DocumentCategory
  >('');
  const [inspectorTab, setInspectorTab] = useState<'facts' | 'json' | 'ocr'>(
    'facts'
  );
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressLabel, setUploadProgressLabel] = useState<string | null>(
    null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadingSynthetic, setLoadingSynthetic] = useState(false);
  const [reextractingDocId, setReextractingDocId] = useState<string | null>(
    null
  );
  const [docPendingDelete, setDocPendingDelete] =
    useState<UploadedDocument | null>(null);
  const [deletingDoc, setDeletingDoc] = useState(false);

  const batchInputRef = useRef<HTMLInputElement | null>(null);

  const filteredDocs = useMemo(() => {
    if (categoryFilter === 'all') return documents;
    return documents.filter((d) => d.category === categoryFilter);
  }, [documents, categoryFilter]);

  const activeDoc =
    documents.find((d) => d.id === selectedDocId) ||
    filteredDocs[0] ||
    documents[0] ||
    null;

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgressLabel(
      `Extracting & validating ${files.length} document${
        files.length > 1 ? 's' : ''
      } (PDF parser + OCR confidence gate)...`
    );
    try {
      const uploaded = await onUploadBatch(
        files,
        explicitUploadCategory || undefined
      );
      if (uploaded[0]) {
        setSelectedDocId(uploaded[0].id);
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Document processing failed.'
      );
    } finally {
      setUploading(false);
      setUploadProgressLabel(null);
      if (batchInputRef.current) batchInputRef.current.value = '';
    }
  };

  const handleBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    await processFiles(files);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (uploading) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    await processFiles(files);
  };

  const handleIngestSynthetic = async () => {
    setLoadingSynthetic(true);
    setUploadError(null);
    try {
      await onUploadSyntheticDemoPack();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Synthetic upload failed.'
      );
    } finally {
      setLoadingSynthetic(false);
    }
  };

  const handleRetryExtraction = async (docId: string) => {
    setReextractingDocId(docId);
    setUploadError(null);
    try {
      await onReextractDocument(docId);
      setSelectedDocId(docId);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Re-extraction failed.'
      );
    } finally {
      setReextractingDocId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!docPendingDelete) return;
    setDeletingDoc(true);
    setUploadError(null);
    try {
      await onDeleteDocument(docPendingDelete.id);
      setDocPendingDelete(null);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Document removal failed.'
      );
    } finally {
      setDeletingDoc(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        eyebrow={
          <>
            <span>DOCUMENT VAULT &amp; OCR EVIDENCE</span>
            <span aria-hidden="true">·</span>
            <span>{documents.length} LOADED</span>
            <span aria-hidden="true">·</span>
            <span>PER-DOCUMENT ACL ENFORCED</span>
          </>
        }
        title="Tax Document Vault & Extraction Inspector"
        description="Upload Form 16, Salary Slips, Bank Statements, FD Interest Certificates, Investment Proofs, Form 26AS, AIS, or TIS. Every extracted value records page provenance, OCR confidence, and validation status."
        actions={
          <>
            <Button
              variant="teal"
              loading={loadingSynthetic}
              onClick={handleIngestSynthetic}
              icon={<FileCheck2 className="w-3.5 h-3.5" />}
            >
              Load Synthetic 4-Doc Demo
            </Button>
            <Button
              variant="outline"
              onClick={onDownloadSyntheticFiles}
              icon={<Download className="w-3.5 h-3.5" />}
            >
              Download Sample Files
            </Button>
            <Button
              variant="primary"
              onClick={onNavigateToAssistant}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Analyze in AI Assistant
            </Button>
          </>
        }
      />

      {/* Drag-and-Drop Upload Area */}
      <SurfaceCard>
        <input
          ref={batchInputRef}
          type="file"
          multiple
          accept=".pdf,image/png,image/jpeg,image/webp,.txt,.json"
          onChange={handleBatchUpload}
          className="hidden"
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!uploading) setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={`rounded-xl border-2 border-dashed p-6 transition-colors ${
            isDragging
              ? 'border-[#2563EB] bg-blue-50/70'
              : 'border-blue-300 bg-blue-50/30 hover:bg-blue-50/50'
          }`}
        >
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-lg bg-white border border-blue-200 text-[#2563EB] flex items-center justify-center shrink-0">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  Drag and drop tax documents here, or browse local files
                </h2>
                <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                  Supports multi-file upload (PDF, PNG, JPG, WEBP, TXT, JSON up
                  to 12 MB per file). Digital PDFs are parsed with{' '}
                  <code className="font-mono text-[#172B4D]">unpdf</code>;
                  scanned images run Tesseract OCR with low-confidence review
                  gates.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <label className="sr-only" htmlFor="doc-category-override">
                Document Category Override
              </label>
              <select
                id="doc-category-override"
                value={explicitUploadCategory}
                onChange={(e) =>
                  setExplicitUploadCategory(
                    e.target.value as '' | DocumentCategory
                  )
                }
                disabled={uploading}
                className="px-3 py-2 text-xs font-medium text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
              >
                <option value="">Auto-detect Category</option>
                {ALL_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {DOCUMENT_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>

              <Button
                variant="primary"
                loading={uploading}
                onClick={() => batchInputRef.current?.click()}
                icon={<Upload className="w-3.5 h-3.5" />}
              >
                {uploading ? 'Processing Documents...' : 'Select Files to Upload'}
              </Button>
            </div>
          </div>

          {uploadProgressLabel && (
            <div className="mt-4 pt-4 border-t border-blue-200/70 space-y-2">
              <div className="flex items-center justify-between text-xs text-[#2563EB] font-medium">
                <span>{uploadProgressLabel}</span>
                <span className="font-mono tabular-nums">ACTIVE</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-blue-100 overflow-hidden">
                <div className="h-full w-2/3 bg-[#2563EB] rounded-full animate-pulse" />
              </div>
            </div>
          )}
        </div>

        {uploadError && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-rose-50/90 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            <span>{uploadError}</span>
          </div>
        )}
      </SurfaceCard>

      {/* Supported Categories Filter Strip */}
      <SurfaceCard noPadding>
        <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2 bg-[#F8FAFC]">
          <span className="text-xs font-semibold text-[#172B4D]">
            Filter by Tax Document Category
          </span>
          {categoryFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className="text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
            >
              Show All ({documents.length})
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 divide-y sm:divide-y-0 sm:divide-x divide-[#E2E8F0]">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`p-3 text-left transition-colors cursor-pointer ${
              categoryFilter === 'all'
                ? 'bg-blue-50/70'
                : 'bg-white hover:bg-[#F8FAFC]'
            }`}
          >
            <div
              className={`text-[11px] font-semibold truncate ${
                categoryFilter === 'all' ? 'text-[#2563EB]' : 'text-[#172B4D]'
              }`}
            >
              All Categories
            </div>
            <div className="text-[11px] mt-0.5 text-[#64748B] font-mono tabular-nums">
              {documents.length} total
            </div>
          </button>

          {ALL_CATEGORIES.map((cat) => {
            const matches = documents.filter((d) => d.category === cat);
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setCategoryFilter(cat);
                  if (matches[0]) setSelectedDocId(matches[0].id);
                }}
                className={`p-3 text-left transition-colors cursor-pointer ${
                  active ? 'bg-blue-50/70' : 'bg-white hover:bg-[#F8FAFC]'
                }`}
              >
                <div
                  className={`text-[11px] font-semibold truncate ${
                    active ? 'text-[#2563EB]' : 'text-[#172B4D]'
                  }`}
                >
                  {DOCUMENT_CATEGORY_LABELS[cat].split(' (')[0]}
                </div>
                <div className="text-[11px] mt-0.5 font-mono tabular-nums">
                  {matches.length > 0 ? (
                    <span className="text-emerald-700 font-medium">
                      {matches.length} loaded
                    </span>
                  ) : (
                    <span className="text-[#64748B]">0</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </SurfaceCard>

      {/* Clean Structured Document Table */}
      <SurfaceCard noPadding>
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#172B4D]">
              Uploaded Documents ({filteredDocs.length})
            </h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              Select any row to inspect extracted facts, normalized JSON, or raw
              OCR text below. Toggle ACL to restrict AI agent access per file.
            </p>
          </div>
          <StatusIndicator
            tone="info"
            label="SecurityGateway Document ACL Active"
          />
        </div>

        {filteredDocs.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-5 h-5" />}
            title="No documents in this view"
            description="Upload PDFs or scanned statements above, or load the 4-document synthetic AY 2026-27 demo pack to inspect live extraction."
            action={
              <Button
                variant="primary"
                loading={loadingSynthetic}
                onClick={handleIngestSynthetic}
              >
                Load Synthetic 4-Doc Demo
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                  <th className="py-3 px-4">Document Name</th>
                  <th className="py-3 px-4">Document Category</th>
                  <th className="py-3 px-4">Upload Date</th>
                  <th className="py-3 px-4">Extraction Status</th>
                  <th className="py-3 px-4">Extracted Facts</th>
                  <th className="py-3 px-4">Confidence</th>
                  <th className="py-3 px-4">Verification Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {filteredDocs.map((doc) => {
                  const isSelected = activeDoc?.id === doc.id;
                  const extractionBadge = getExtractionBadge(doc);
                  const verificationBadge = getVerificationBadge(doc);
                  const avgConfidence = getAverageConfidencePct(doc);
                  const isRetrying = reextractingDocId === doc.id;

                  return (
                    <tr
                      key={doc.id}
                      onClick={() => setSelectedDocId(doc.id)}
                      className={`transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/50'
                          : 'bg-white hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-2.5 min-w-[200px]">
                          <FileText
                            className={`w-4 h-4 shrink-0 mt-0.5 ${
                              isSelected ? 'text-[#2563EB]' : 'text-[#64748B]'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-[#172B4D] truncate max-w-[240px]">
                              {doc.fileName}
                            </div>
                            <div className="text-[11px] text-[#64748B] font-mono tabular-nums mt-0.5">
                              {doc.pageCount}p · {formatBytes(doc.fileSize)}
                              {doc.isSynthetic ? ' · Synthetic' : ''}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-[#172B4D] whitespace-nowrap">
                        {DOCUMENT_CATEGORY_LABELS[doc.category]}
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-nums text-[11px] text-[#64748B] whitespace-nowrap">
                        {formatDateTime(doc.uploadedAt)}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <StatusIndicator
                          tone={extractionBadge.tone}
                          label={extractionBadge.label}
                        />
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-nums text-[#172B4D] whitespace-nowrap">
                        {doc.extractedFacts.length}{' '}
                        <span className="text-[#64748B] font-sans">
                          {doc.extractedFacts.length === 1 ? 'fact' : 'facts'}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-mono tabular-nums whitespace-nowrap">
                        {avgConfidence !== null ? (
                          <span
                            className={`font-semibold ${
                              avgConfidence >= 85
                                ? 'text-emerald-700'
                                : avgConfidence >= 70
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {avgConfidence}%
                          </span>
                        ) : (
                          <span className="text-[#64748B]">—</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <StatusIndicator
                            tone={verificationBadge.tone}
                            label={verificationBadge.label}
                          />
                          {!doc.agentAccessAllowed && (
                            <StatusIndicator
                              tone="error"
                              label="ACL Blocked"
                              hideIcon
                            />
                          )}
                        </div>
                      </td>

                      <td
                        className="py-3.5 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant={isSelected ? 'primary' : 'outline'}
                            onClick={() => setSelectedDocId(doc.id)}
                            icon={<Eye className="w-3 h-3" />}
                          >
                            Inspect
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            loading={isRetrying}
                            onClick={() => handleRetryExtraction(doc.id)}
                            title="Re-run document parser and extraction validation"
                            icon={<RefreshCw className="w-3 h-3" />}
                          >
                            Retry
                          </Button>

                          <Button
                            size="sm"
                            variant={doc.agentAccessAllowed ? 'outline' : 'danger'}
                            onClick={() =>
                              onToggleAcl(doc.id, !doc.agentAccessAllowed)
                            }
                            title="Toggle AI agent read permission for this document"
                            icon={
                              doc.agentAccessAllowed ? (
                                <Unlock className="w-3 h-3" />
                              ) : (
                                <Lock className="w-3 h-3" />
                              )
                            }
                          >
                            {doc.agentAccessAllowed ? 'ACL Open' : 'Blocked'}
                          </Button>

                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDocPendingDelete(doc)}
                            aria-label={`Remove ${doc.fileName}`}
                            icon={<Trash2 className="w-3 h-3" />}
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {/* Document Preview & Extraction Details Panel */}
      {activeDoc && (
        <SurfaceCard noPadding>
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-[#F8FAFC]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-[#172B4D] truncate">
                  {activeDoc.fileName}
                </h2>
                <StatusIndicator
                  tone={getExtractionBadge(activeDoc).tone}
                  label={getExtractionBadge(activeDoc).label}
                />
                {activeDoc.isSynthetic && (
                  <StatusIndicator tone="teal" label="Synthetic Demo File" />
                )}
              </div>
              <div className="text-xs text-[#64748B] mt-1 font-mono tabular-nums">
                Method: {activeDoc.extractionMethod} · Category:{' '}
                {DOCUMENT_CATEGORY_LABELS[activeDoc.category]} · Uploaded{' '}
                {formatDateTime(activeDoc.uploadedAt)}
              </div>
            </div>

            <SegmentedControl
              ariaLabel="Document extraction view selector"
              value={inspectorTab}
              onChange={setInspectorTab}
              options={[
                {
                  value: 'facts',
                  label: `Extracted Evidence (${activeDoc.extractedFacts.length})`,
                },
                { value: 'json', label: 'Normalized JSON' },
                { value: 'ocr', label: 'Document / OCR Text Preview' },
              ]}
            />
          </div>

          {/* Explicit Validation / OCR Error & Missing Field Banner (Never Hidden) */}
          {(activeDoc.errorMessage ||
            activeDoc.needsUserReview ||
            activeDoc.validationErrors.length > 0 ||
            (activeDoc.missingExpectedFields &&
              activeDoc.missingExpectedFields.length > 0)) && (
            <div className="px-6 py-3.5 bg-amber-50/90 border-b border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                {activeDoc.errorMessage && (
                  <div className="font-semibold text-rose-800">
                    Extraction Error: {activeDoc.errorMessage}
                  </div>
                )}
                {activeDoc.needsUserReview && (
                  <div className="font-semibold">
                    Low-Confidence OCR Review Gate Active: Extracted figures will
                    not overwrite verified return values without explicit human
                    confirmation.
                  </div>
                )}
                {activeDoc.missingExpectedFields &&
                  activeDoc.missingExpectedFields.length > 0 && (
                    <div>
                      Missing expected fields:{' '}
                      <span className="font-mono font-medium">
                        {activeDoc.missingExpectedFields.join(', ')}
                      </span>
                    </div>
                  )}
                {activeDoc.validationErrors.map((ve) => (
                  <div key={ve}>{ve}</div>
                ))}
              </div>
            </div>
          )}

          {inspectorTab === 'facts' && (
            <div>
              {activeDoc.extractedFacts.length === 0 ? (
                <EmptyState
                  icon={<FileText className="w-5 h-5" />}
                  title="No structured financial facts extracted"
                  description="Inspect the Document / OCR Text Preview tab or click Retry in the table above to re-run extraction."
                />
              ) : (
                <div className="divide-y divide-[#E2E8F0]">
                  {activeDoc.extractedFacts.map((fact) => (
                    <div
                      key={fact.id}
                      className="px-6 py-4 bg-white hover:bg-[#F8FAFC]/60 transition-colors"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-[#172B4D]">
                            {fact.label}
                          </span>
                          <span className="text-[11px] font-mono text-[#64748B]">
                            ({fact.field})
                          </span>
                        </div>
                        <span className="text-sm font-bold text-[#172B4D] font-mono tabular-nums">
                          {fact.formattedValue}
                        </span>
                      </div>

                      <div className="mt-2 text-xs text-[#172B4D] font-mono bg-[#F8FAFC] px-3.5 py-2 rounded-lg border border-[#E2E8F0]">
                        “{fact.sourceSnippet}”
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[#64748B] font-mono tabular-nums">
                        <span>
                          Source: {fact.documentName || activeDoc.fileName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Page {fact.pageNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Confidence {Math.round(fact.confidence * 100)}%
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          {fact.validationStatus === 'verified' ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                          ) : (
                            <AlertTriangle className="w-3 h-3 text-amber-700" />
                          )}
                          <span
                            className={
                              fact.validationStatus === 'verified'
                                ? 'text-emerald-700 font-semibold'
                                : 'text-amber-700 font-semibold'
                            }
                          >
                            {fact.validationStatus}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {inspectorTab === 'json' && (
            <div className="p-6 bg-white">
              <LightCodeBlock
                title={`${activeDoc.fileName} — Normalized Financial Schema`}
                code={JSON.stringify(activeDoc.structuredData, null, 2)}
              />
            </div>
          )}

          {inspectorTab === 'ocr' && (
            <div className="p-6 bg-white">
              <LightCodeBlock
                title={`${activeDoc.fileName} — Extracted Document / OCR Text`}
                code={
                  activeDoc.rawTextPreview ||
                  'No raw text preview available for this document.'
                }
              />
            </div>
          )}
        </SurfaceCard>
      )}

      {/* Accessible Confirmation Dialog for Removing a Document */}
      <ConfirmDialog
        open={Boolean(docPendingDelete)}
        title="Remove Document from Session?"
        description="Removing this document recalculates cross-document reconciliation and provenance entries for the active filing session."
        details={
          docPendingDelete ? (
            <div className="space-y-1 font-mono text-[11px]">
              <div className="font-semibold text-[#172B4D]">
                {docPendingDelete.fileName}
              </div>
              <div className="text-[#64748B]">
                Category: {DOCUMENT_CATEGORY_LABELS[docPendingDelete.category]} ·{' '}
                {docPendingDelete.extractedFacts.length} extracted facts
              </div>
            </div>
          ) : undefined
        }
        confirmLabel="Remove Document"
        confirmVariant="danger"
        loading={deletingDoc}
        onConfirm={handleConfirmDelete}
        onClose={() => setDocPendingDelete(null)}
      />
    </div>
  );
};
