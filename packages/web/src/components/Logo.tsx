import './Logo.css';

interface LogoProps {
  readonly size?: number;
  readonly className?: string;
}

export function Logo({ size = 64, className = '' }: LogoProps) {
  return (
    <svg
      className={`logo ${className}`}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" className="logo-gradient-start" />
          <stop offset="100%" className="logo-gradient-end" />
        </linearGradient>
      </defs>
      
      {/* Central node (manager) */}
      <circle cx="64" cy="40" r="16" fill="url(#logo-grad)" stroke="currentColor" strokeWidth="2"/>
      
      {/* Team members */}
      <circle cx="32" cy="88" r="12" fill="url(#logo-grad)" stroke="currentColor" strokeWidth="2"/>
      <circle cx="64" cy="88" r="12" fill="url(#logo-grad)" stroke="currentColor" strokeWidth="2"/>
      <circle cx="96" cy="88" r="12" fill="url(#logo-grad)" stroke="currentColor" strokeWidth="2"/>
      
      {/* Connections */}
      <line x1="64" y1="56" x2="32" y2="76" className="logo-connection" strokeWidth="2"/>
      <line x1="64" y1="56" x2="64" y2="76" className="logo-connection" strokeWidth="2"/>
      <line x1="64" y1="56" x2="96" y2="76" className="logo-connection" strokeWidth="2"/>
    </svg>
  );
}
