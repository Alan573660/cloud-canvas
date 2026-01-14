import { useTranslation } from 'react-i18next';
import { ShieldX, Lock, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

interface PermissionDeniedProps {
  /** Custom message to display */
  message?: string;
  /** Show back button */
  showBack?: boolean;
  /** Custom back path */
  backPath?: string;
  /** Variant: 'page' for full page, 'inline' for component */
  variant?: 'page' | 'inline';
}

export function PermissionDenied({
  message,
  showBack = true,
  backPath,
  variant = 'page',
}: PermissionDeniedProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleBack = () => {
    if (backPath) {
      navigate(backPath);
    } else {
      navigate(-1);
    }
  };

  const content = (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div className="rounded-full bg-destructive/10 p-4 mb-4">
        <ShieldX className="h-12 w-12 text-destructive" />
      </div>
      <h2 className="text-xl font-semibold mb-2">
        {t('errors.forbidden', 'Доступ запрещён')}
      </h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        {message || t('common.noPermission', 'У вас недостаточно прав для просмотра этой страницы')}
      </p>
      {showBack && (
        <Button variant="outline" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back', 'Назад')}
        </Button>
      )}
    </div>
  );

  if (variant === 'inline') {
    return (
      <Card className="border-destructive/20">
        <CardContent className="pt-6">{content}</CardContent>
      </Card>
    );
  }

  return <div className="min-h-[50vh] flex items-center justify-center">{content}</div>;
}

interface NotFoundProps {
  /** Type of resource not found */
  resourceType?: string;
  /** Show back button */
  showBack?: boolean;
  /** Custom back path */
  backPath?: string;
}

export function NotFound({
  resourceType,
  showBack = true,
  backPath,
}: NotFoundProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleBack = () => {
    if (backPath) {
      navigate(backPath);
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="flex flex-col items-center justify-center text-center py-12 px-4">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Lock className="h-12 w-12 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">
          {t('errors.notFound', 'Не найдено')}
        </h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          {resourceType 
            ? t('errors.resourceNotFound', { resource: resourceType, defaultValue: `${resourceType} не найден или был удалён` })
            : t('errors.pageNotFound', 'Запрашиваемая страница не найдена')}
        </p>
        {showBack && (
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('common.back', 'Назад')}
          </Button>
        )}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  /** Icon to display */
  icon?: React.ReactNode;
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
  /** Action button */
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      {icon && (
        <div className="rounded-full bg-muted p-4 mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      {description && (
        <p className="text-muted-foreground mb-4 max-w-md">{description}</p>
      )}
      {action}
    </div>
  );
}
