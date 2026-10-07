import { ChevronLeft } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';

interface Props {
  title: string;
  backLabel?: string;
  backTo?: string;
  children?: ReactNode;
}

/** Sticky iOS-style navigation bar; the small centered title fades in once the large title scrolls away. */
export function NavBar({ title, backLabel = 'Map', backTo = '/', children }: Props) {
  const [, navigate] = useLocation();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 36);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`nav-bar${scrolled ? ' is-scrolled' : ''}`}>
      <button type="button" className="btn-link nav-back" onClick={() => navigate(backTo)}>
        <ChevronLeft size={26} strokeWidth={2.4} aria-hidden="true" />
        {backLabel}
      </button>
      <span className="nav-title" aria-hidden="true">
        {title}
      </span>
      <span className="nav-spacer" />
      {children}
    </header>
  );
}
