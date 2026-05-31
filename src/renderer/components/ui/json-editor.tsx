import { useEffect, useRef, useState } from 'react';
import Editor, { loader, type OnMount, type OnValidate } from '@monaco-editor/react';
// 从主包导入（类型安全）；实际运行时由 vite.config.ts 的 alias 指向核心 editor.api，
// 避免打包全部语言。JSON 语言能力通过下方 contribution 单独注册。
import * as monaco from 'monaco-editor';
// 注意：alias 把 monaco 主入口指向精简的 editor.api，不含 languages.json 命名空间挂载
//（该挂载只在 editor.main 里完成）。因此直接从 contribution 具名导入 jsonDefaults，
// 而不是访问 monaco.languages.json.jsonDefaults（后者在精简包里为 undefined）。
// contribution 的 .d.ts 只有 `export {}`，没有具名类型，故下方忽略类型解析、运行时取值有效。
// @ts-expect-error 子路径模块无具名类型声明，但运行时确实导出 jsonDefaults
import { jsonDefaults } from 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// 在 Vite 下用本地 worker，避免运行时从 CDN 下载（Tauri 离线环境必需）
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new jsonWorker();
    return new editorWorker();
  },
};

// 绑定本地 monaco bundle
loader.config({ monaco });

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 校验结果回调：errorCount > 0 表示存在 JSON 语法/结构错误 */
  onValidate?: (errorCount: number) => void;
  height?: number | string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  ariaLabel?: string;
}

function getEffectiveTheme(): 'vs' | 'vs-dark' {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'vs-dark' : 'vs';
}

export function JsonEditor({
  value,
  onChange,
  onValidate,
  height = 280,
  placeholder,
  readOnly = false,
  className,
  ariaLabel,
}: JsonEditorProps) {
  const [theme, setTheme] = useState<'vs' | 'vs-dark'>(() => getEffectiveTheme());
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // 跟随应用主题切换（data-theme 变化）
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getEffectiveTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    // 开启 JSON 诊断与格式校验（jsonDefaults 来自具名导入，避免依赖 languages.json 命名空间）
    jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemaValidation: 'error',
      trailingCommas: 'error',
    });
  };

  const handleValidate: OnValidate = (markers) => {
    const errors = markers.filter(
      (marker) => marker.severity === monaco.MarkerSeverity.Error,
    ).length;
    onValidate?.(errors);
  };

  const showPlaceholder = !value && placeholder;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[8px] border border-input bg-background',
        className,
      )}
      style={{ height }}
    >
      <Editor
        language="json"
        theme={theme}
        value={value}
        onChange={(next) => onChange(next ?? '')}
        onMount={handleMount}
        onValidate={handleValidate}
        loading={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
          </div>
        }
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: 'on',
          lineNumbersMinChars: 3,
          folding: true,
          fontSize: 12,
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          renderLineHighlight: 'line',
          padding: { top: 10, bottom: 10 },
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            useShadows: false,
          },
          overviewRulerLanes: 0,
          guides: { indentation: false },
          formatOnPaste: true,
          fixedOverflowWidgets: true,
        }}
        aria-label={ariaLabel}
      />
      {showPlaceholder ? (
        <div className="pointer-events-none absolute left-[52px] top-[10px] select-none whitespace-pre font-mono text-[12px] leading-relaxed text-muted-foreground/50">
          {placeholder}
        </div>
      ) : null}
    </div>
  );
}
