import { useTranslation } from 'react-i18next';

export default function Analytics() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">{t('nav:analytics')}</h1>
      <p className="text-sm text-muted-foreground">
        {t('analytics.placeholder', '数据统计功能即将上线')}
      </p>
    </div>
  );
}
