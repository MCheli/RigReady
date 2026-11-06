// Types of site/lib/manual.mjs for the unit tests (tests/unit/siteManual.test.ts). The module
// itself stays plain JavaScript so that the site build needs no npm install.

export const MANUAL_DIR: string;
export const MANUAL_URL: string;
export const DESCRIPTION_LENGTH: { min: number; max: number };

export interface FrontMatter {
  data: Record<string, string>;
  body: string;
}

export interface ManualPage {
  file: string;
  url: string;
  slug: string;
  section: string | null;
  isIndex: boolean;
  title: string;
  description: string;
  order: number;
  body: string;
}

export interface ManualSection extends ManualPage {
  pages: ManualPage[];
}

export interface Manual {
  landing: ManualPage;
  sections: ManualSection[];
  pages: ManualPage[];
  byFile: Map<string, ManualPage>;
}

export interface Crumb {
  title: string;
  url: string;
}

export function parseFrontMatter(text: string, file?: string): FrontMatter;
export function manualUrl(file: string): string;
export function pageOf(file: string, text: string): ManualPage;
export function buildManual(files: Map<string, string> | [string, string][]): Manual;
export function breadcrumbs(manual: Manual, page: ManualPage, rootTitle?: string): Crumb[];
export function repoPath(fromFile: string, href: string): string;
export function siteLink(
  fromFile: string,
  manual: Manual,
  repoUrl: string
): (href: string) => string;
export function tidiedName(repoFile: string, ext?: string): string;
