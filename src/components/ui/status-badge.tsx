import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusType = 'success' | 'warning' | 'error' | 'info' | 'default';

interface StatusBadgeProps {
  status: string;
  type?: StatusType;
  className?: string;
}

const statusColors: Record<StatusType, string> = {
  success: 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400',
  error: 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
  default: 'bg-gray-100 text-gray-800 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400',
};

export function StatusBadge({ status, type = 'default', className }: StatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(statusColors[type], className)}
    >
      {status}
    </Badge>
  );
}

// Helper function to get status type from common status values
export function getStatusType(status: string): StatusType {
  const normalizedStatus = status.toLowerCase();
  
  if (['paid', 'delivered', 'completed', 'active', 'sent', 'converted', 'success'].includes(normalizedStatus)) {
    return 'success';
  }
  
  if (['pending', 'in_progress', 'processing', 'queued', 'warning', 'new'].includes(normalizedStatus)) {
    return 'warning';
  }
  
  if (['failed', 'cancelled', 'overdue', 'error', 'lost', 'rejected'].includes(normalizedStatus)) {
    return 'error';
  }
  
  if (['draft', 'info', 'qualified'].includes(normalizedStatus)) {
    return 'info';
  }
  
  return 'default';
}
