import { cn } from './cn';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent', className)}>
      <span className="sr-only">{label}</span>
    </span>
  );
}
