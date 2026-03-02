import { useEffect, useState } from 'react';

interface RelativeTimeProps {
  timestamp: string;
  className?: string;
}

export function RelativeTime({ timestamp, className }: RelativeTimeProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    // Update every minute to keep relative time fresh
    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const formatRelativeTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    
    // Validate date is valid
    if (Number.isNaN(date.getTime())) {
      return 'Invalid date';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' });

    // Less than 1 minute
    if (diffSecs < 60) {
      return rtf.format(-diffSecs, 'second');
    }

    // Less than 1 hour
    if (diffMins < 60) {
      return rtf.format(-diffMins, 'minute');
    }

    // Less than 24 hours
    if (diffHours < 24) {
      return rtf.format(-diffHours, 'hour');
    }

    // Less than 7 days
    if (diffDays < 7) {
      return rtf.format(-diffDays, 'day');
    }

    // Less than 30 days
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return rtf.format(-weeks, 'week');
    }

    // Less than 365 days
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return rtf.format(-months, 'month');
    }

    // Years
    const years = Math.floor(diffDays / 365);
    return rtf.format(-years, 'year');
  };

  return <span className={className}>{formatRelativeTime(timestamp)}</span>;
}
