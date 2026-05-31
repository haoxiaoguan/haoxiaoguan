import { useTranslation } from 'react-i18next';

export function ZipInstallDialog() {
  const { t } = useTranslation();

  // TODO: 实现从 zip 安装 skills 的对话框
  return (
    <div className="p-4 text-sm text-muted-foreground">
      {t('skills.zipInstall', '从 ZIP 安装 Skills')}
    </div>
  );
}
