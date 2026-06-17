/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import('./lib/auth').SessionUser | null;
    workspace: null; // No multi-tenancy in self-hosted mode
    nonce: string;
    csrfToken: string;
  }
}
