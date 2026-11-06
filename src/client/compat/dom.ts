import type { DomPort } from '../contracts/ports.ts';
import { PLUGIN_ID, ROOT_ATTRIBUTE } from '../../shared/identity.ts';
import { aliasHostSelectors, detectHostBuild } from './host-builds.ts';

interface RootLease { count: number; readonly previous: string | null }
const leases = new WeakMap<Element, RootLease>();

export function createDomPort(document: Document): DomPort {
  return {
    activate() {
      const root = document.documentElement;
      let lease = leases.get(root);
      if (lease === undefined) {
        lease = { count: 0, previous: root.getAttribute(ROOT_ATTRIBUTE) };
        leases.set(root, lease);
        root.setAttribute(ROOT_ATTRIBUTE, 'true');
      }
      lease.count++;
      const owned = lease;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        owned.count--;
        if (owned.count > 0) return;
        leases.delete(root);
        if (root.getAttribute(ROOT_ATTRIBUTE) !== 'true') return;
        if (owned.previous === null) root.removeAttribute(ROOT_ATTRIBUTE);
        else root.setAttribute(ROOT_ATTRIBUTE, owned.previous);
      };
    },
    mountStyles(css) {
      const style = document.createElement('style');
      style.dataset.plugin = PLUGIN_ID;
      /* Stylesheets are authored with the pinned build's class names; the
         document on screen may run another build of the same DSH version. */
      style.textContent = aliasHostSelectors(css, detectHostBuild(document));
      document.head.appendChild(style);
      return () => style.remove();
    },
  };
}
