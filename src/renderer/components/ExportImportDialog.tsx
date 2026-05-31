import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccountStore, usePlatformStore } from '../stores';
import { accountService } from '../services/tauri';
import type { Account, PlatformId, ImportResultResponse } from '../types';

interface ExportImportDialogProps {
  onClose: () => void;
  accounts: Account[];
}

type TabType = 'export' | 'import';
type ConflictStrategy = 'skip' | 'overwrite' | 'keep_both';

export default function ExportImportDialog({ onClose, accounts }: ExportImportDialogProps) {
  const { t } = useTranslation();
  const { fetchAccounts } = useAccountStore();
  const { getDisplayName } = usePlatformStore();

  const [activeTab, setActiveTab] = useState<TabType>('export');

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="font-bold text-lg mb-4">{t('exportImport.title')}</h3>

        {/* Tab switcher */}
        <div className="tabs tabs-boxed mb-4">
          <button
            className={`tab ${activeTab === 'export' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('export')}
          >
            {t('exportImport.exportTab')}
          </button>
          <button
            className={`tab ${activeTab === 'import' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            {t('exportImport.importTab')}
          </button>
        </div>

        {activeTab === 'export' ? (
          <ExportPanel accounts={accounts} onClose={onClose} getDisplayName={getDisplayName} />
        ) : (
          <ImportPanel onClose={onClose} fetchAccounts={fetchAccounts} />
        )}
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

// ============================================================================
// Export Panel
// ============================================================================

interface ExportPanelProps {
  accounts: Account[];
  onClose: () => void;
  getDisplayName: (platform: PlatformId) => string;
}

function ExportPanel({ accounts, onClose, getDisplayName }: ExportPanelProps) {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAccount = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const selectAll = () => {
    setSelectedIds(new Set(accounts.map((a) => a.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleExport = async () => {
    if (selectedIds.size === 0) return;

    setExporting(true);
    setError(null);

    try {
      const jsonStr = await accountService.exportAccounts({
        accountIds: Array.from(selectedIds),
        includeCredentials,
      });

      // Trigger file download
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `haoxiaoguan-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setExporting(false);
    }
  };

  if (accounts.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/60">
        {t('exportImport.export.noAccounts')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Select accounts */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t('exportImport.export.selectAccounts')}</span>
        <div className="flex gap-2">
          <button className="btn btn-xs btn-ghost" onClick={selectAll}>
            {t('exportImport.export.selectAll')}
          </button>
          <button className="btn btn-xs btn-ghost" onClick={deselectAll}>
            {t('exportImport.export.deselectAll')}
          </button>
        </div>
      </div>

      {/* Account list */}
      <div className="max-h-60 overflow-y-auto border rounded-lg p-2 space-y-1">
        {accounts.map((account) => (
          <label
            key={account.id}
            className="flex items-center gap-3 p-2 rounded hover:bg-base-200 cursor-pointer"
          >
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={selectedIds.has(account.id)}
              onChange={() => toggleAccount(account.id)}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {account.name || account.displayIdentifier || account.email}
              </div>
              <div className="text-xs text-base-content/60">
                {getDisplayName(account.platform)} · {account.displayIdentifier || account.email}
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="text-sm text-base-content/60">
        {t('exportImport.export.selectedCount', { count: selectedIds.size })}
      </div>

      {/* Include credentials toggle */}
      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-warning"
            checked={includeCredentials}
            onChange={(e) => setIncludeCredentials(e.target.checked)}
          />
          <span className="label-text">{t('exportImport.export.includeCredentials')}</span>
        </label>
        {includeCredentials && (
          <div className="alert alert-warning text-sm mt-2">
            {t('exportImport.export.includeCredentialsWarning')}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={exporting}>
          {t('common.cancel')}
        </button>
        <button
          className={`btn btn-primary ${exporting ? 'loading' : ''}`}
          onClick={handleExport}
          disabled={exporting || selectedIds.size === 0}
        >
          {exporting ? t('exportImport.export.exporting') : t('exportImport.export.exportButton')}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Import Panel
// ============================================================================

interface ImportPanelProps {
  onClose: () => void;
  fetchAccounts: (platform: PlatformId) => Promise<void>;
}

function ImportPanel({ onClose, fetchAccounts }: ImportPanelProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('skip');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResultResponse | null>(null);

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      setError(t('exportImport.import.fileTooLarge'));
      return;
    }

    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      try {
        // Validate it's valid JSON
        JSON.parse(content);
        setFileContent(content);
      } catch {
        setError(t('exportImport.import.invalidFormat'));
        setFileContent(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!fileContent) return;

    setImporting(true);
    setError(null);

    try {
      const importResult = await accountService.importAccounts({
        data: fileContent,
        conflictStrategy,
      });
      setResult(importResult);

      // Refresh account lists
      const platforms = ['cursor', 'windsurf', 'kiro', 'github-copilot', 'codex',
        'gemini-cli', 'codebuddy', 'codebuddy-cn', 'qoder', 'trae', 'zed'];
      for (const p of platforms) {
        await fetchAccounts(p as PlatformId).catch(() => {});
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  // Show results if import completed
  if (result) {
    return (
      <div className="space-y-4">
        <h4 className="font-medium">{t('exportImport.import.resultTitle')}</h4>

        <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
          <div className="stat">
            <div className="stat-title">{t('exportImport.import.imported')}</div>
            <div className="stat-value text-success">{result.imported}</div>
            <div className="stat-desc">{t('exportImport.import.accounts')}</div>
          </div>
          <div className="stat">
            <div className="stat-title">{t('exportImport.import.skipped')}</div>
            <div className="stat-value text-warning">{result.skipped}</div>
            <div className="stat-desc">{t('exportImport.import.accounts')}</div>
          </div>
          <div className="stat">
            <div className="stat-title">{t('exportImport.import.errors')}</div>
            <div className="stat-value text-error">{result.errors.length}</div>
            <div className="stat-desc">{t('exportImport.import.accounts')}</div>
          </div>
        </div>

        {result.errors.length > 0 && (
          <div className="max-h-32 overflow-y-auto border rounded-lg p-3">
            {result.errors.map((err: string, idx: number) => (
              <div key={idx} className="text-sm text-error mb-1">
                {err}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button className="btn btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* File upload area */}
      <div
        className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileSelect}
        />
        {fileName ? (
          <div>
            <div className="text-sm font-medium">{fileName}</div>
            <div className="text-xs text-base-content/60 mt-1">
              {t('exportImport.import.selectFile')}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm text-base-content/60">
              {t('exportImport.import.dragDrop')}
            </div>
            <div className="text-xs text-base-content/40 mt-1">
              {t('exportImport.import.maxSize')}
            </div>
          </div>
        )}
      </div>

      {/* Conflict strategy */}
      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">
            {t('exportImport.import.conflictStrategy')}
          </span>
        </label>
        <div className="space-y-2">
          {(['skip', 'overwrite', 'keep_both'] as ConflictStrategy[]).map((strategy) => {
            const keyMap: Record<ConflictStrategy, string> = {
              skip: 'Skip',
              overwrite: 'Overwrite',
              keep_both: 'KeepBoth',
            };
            const keySuffix = keyMap[strategy];
            return (
            <label
              key={strategy}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                conflictStrategy === strategy
                  ? 'border-primary bg-primary/5'
                  : 'border-base-300 hover:border-base-content/30'
              }`}
            >
              <input
                type="radio"
                className="radio radio-sm radio-primary mt-0.5"
                name="conflictStrategy"
                checked={conflictStrategy === strategy}
                onChange={() => setConflictStrategy(strategy)}
              />
              <div>
                <div className="text-sm font-medium">
                  {t(`exportImport.import.strategy${keySuffix}`)}
                </div>
                <div className="text-xs text-base-content/60">
                  {t(`exportImport.import.strategy${keySuffix}Desc`)}
                </div>
              </div>
            </label>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={importing}>
          {t('common.cancel')}
        </button>
        <button
          className={`btn btn-primary ${importing ? 'loading' : ''}`}
          onClick={handleImport}
          disabled={importing || !fileContent}
        >
          {importing
            ? t('exportImport.import.importing')
            : t('exportImport.import.importButton')}
        </button>
      </div>
    </div>
  );
}
