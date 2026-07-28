import type { ResumeData } from '@/components/dashboard/resume-component';

export const LEGACY_RESUME_DRAFT_STORAGE_KEY = 'resume_builder_draft';
export const RESUME_DRAFT_STORAGE_PREFIX = `${LEGACY_RESUME_DRAFT_STORAGE_KEY}:`;
const NEW_RESUME_DRAFT_ID = 'new';

/**
 * How long a local draft stays eligible for recovery. Beyond this the user has
 * almost certainly moved on, and offering it risks resurrecting stale content
 * over a server copy that has since changed elsewhere.
 */
export const RESUME_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface ResumeDraftEnvelope {
  resumeId: string | null;
  updatedAt: number;
  data: ResumeData;
}

interface ParseResumeDraftOptions {
  allowLegacyPlainData?: boolean;
}

export function getResumeDraftStorageKey(resumeId: string | null | undefined): string {
  return `${RESUME_DRAFT_STORAGE_PREFIX}${resumeId || NEW_RESUME_DRAFT_ID}`;
}

export function buildResumeDraft(
  resumeId: string | null | undefined,
  data: ResumeData,
  updatedAt = Date.now()
): ResumeDraftEnvelope {
  return {
    resumeId: resumeId || null,
    updatedAt,
    data,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return !Array.isArray(value);
}

function isResumeDataShape(value: unknown): value is ResumeData {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    isObjectRecord(value.personalInfo) &&
    Array.isArray(value.workExperience) &&
    Array.isArray(value.education) &&
    Array.isArray(value.personalProjects) &&
    isObjectRecord(value.additional)
  );
}

function isResumeDraftEnvelope(value: unknown): value is ResumeDraftEnvelope {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    'data' in value &&
    'updatedAt' in value &&
    typeof value.updatedAt === 'number' &&
    isResumeDataShape(value.data)
  );
}

export function parseResumeDraft(
  rawDraft: string | null,
  resumeId: string | null | undefined,
  fallbackUpdatedAt = Date.now(),
  options: ParseResumeDraftOptions = {}
): ResumeDraftEnvelope | null {
  if (!rawDraft) return null;

  try {
    const parsed = JSON.parse(rawDraft) as unknown;
    if (isResumeDraftEnvelope(parsed)) {
      if ((parsed.resumeId || null) !== (resumeId || null)) {
        return null;
      }

      // T-04: `updatedAt` was written and validated but never read, so a draft
      // from a one-off tailor session survived forever and would be offered as
      // "unsaved work" months later. Expire it instead.
      if (Date.now() - parsed.updatedAt > RESUME_DRAFT_MAX_AGE_MS) {
        return null;
      }

      return parsed;
    }

    if (options.allowLegacyPlainData === false || !isResumeDataShape(parsed)) {
      return null;
    }

    return buildResumeDraft(resumeId, parsed as ResumeData, fallbackUpdatedAt);
  } catch {
    return null;
  }
}

export function isSameResumeData(left: ResumeData, right: ResumeData): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function shouldPromptForDraftRestore(
  draft: ResumeDraftEnvelope | null,
  serverData: ResumeData
): boolean {
  return Boolean(draft && !isSameResumeData(draft.data, serverData));
}

/**
 * localStorage wrapper that never throws (H-08).
 *
 * `localStorage` raises `SecurityError` when storage is blocked (enterprise
 * policy, some embedded/iframe contexts) and `QuotaExceededError` on write.
 * Unguarded access in the builder meant a blocked-storage user got a blank
 * editor (throw during an effect -> error boundary), a resume that never
 * loaded (rejected promise inside the loader, no error UI), or a silently
 * dropped keystroke.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable — nothing to clean up */
    }
  },
  /** True when storage is readable and writable in this context. */
  isAvailable(): boolean {
    try {
      const probe = '__rm_storage_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  },
};
