import { useEffect, useState, type RefObject } from 'react';

/** True once the element is (near) the viewport; flips back when it scrolls away. */
export function useInView(ref: RefObject<Element | null>, rootMargin = '200px'): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      // No observer support: treat as visible so content still loads.
      const id = setTimeout(() => setInView(true), 0);
      return () => clearTimeout(id);
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setInView(e.isIntersecting);
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return inView;
}
