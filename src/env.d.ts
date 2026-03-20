/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import('./lib/auth').SessionUser | null;
    workspace: import('./lib/rbac').WorkspaceContext | null;
    nonce: string;
    csrfToken: string;
  }
}
