import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  children: ReactNode;
  small?: boolean;
}

export function IconButton({ label, children, small, className = '', type = 'button', ...rest }: Props) {
  return (
    <button type={type} aria-label={label} title={label} className={`icon-btn${small ? ' is-small' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}
