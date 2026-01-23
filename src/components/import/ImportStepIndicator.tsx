import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  key: string;
  label: string;
}

interface ImportStepIndicatorProps {
  steps: Step[];
  currentStep: string;
  className?: string;
}

export function ImportStepIndicator({ steps, currentStep, className }: ImportStepIndicatorProps) {
  const currentIdx = steps.findIndex(s => s.key === currentStep);
  const isFailed = currentStep === 'FAILED';

  return (
    <div className={cn('flex items-center justify-between', className)}>
      {steps.map((step, idx) => {
        const isCompleted = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isPending = idx > currentIdx;

        return (
          <div key={step.key} className="flex items-center flex-1">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <div 
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all',
                  isCompleted && 'bg-primary text-primary-foreground',
                  isCurrent && !isFailed && 'bg-primary/20 text-primary border-2 border-primary',
                  isCurrent && isFailed && 'bg-destructive/20 text-destructive border-2 border-destructive',
                  isPending && 'bg-muted text-muted-foreground'
                )}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : isCurrent && !isFailed ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  idx + 1
                )}
              </div>
              <span 
                className={cn(
                  'text-xs mt-1 text-center max-w-[80px]',
                  (isCompleted || isCurrent) ? 'text-foreground font-medium' : 'text-muted-foreground'
                )}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {idx < steps.length - 1 && (
              <div 
                className={cn(
                  'flex-1 h-0.5 mx-2 transition-all',
                  isCompleted ? 'bg-primary' : 'bg-muted'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
