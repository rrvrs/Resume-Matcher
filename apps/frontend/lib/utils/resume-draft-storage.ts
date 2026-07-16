import type { ResumeData } from '@/components/dashboard/resume-component';

export const LEGACY_RESUME_DRAFT_STORAGE_KEY = 'resume_builder_draft';
export const RESUME_DRAFT_STORAGE_PREFIX = `${LEGACY_RESUME_DRAFT_STORAGE_KEY}:`;
const NEW_RESUME_DRAFT_ID = 'new';

export interface ResumeDraftEnvelope {
  resumeId: string | null;
  updatedAt: number;
  data: ResumeData;
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
    'workExperience' in value &&
    'education' in value &&
    'personalProjects' in value &&
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
  fallbackUpdatedAt = Date.now()
): ResumeDraftEnvelope | null {
  if (!rawDraft) return null;

  try {
    const parsed = JSON.parse(rawDraft) as unknown;
    if (isResumeDraftEnvelope(parsed)) {
      if ((parsed.resumeId || null) !== (resumeId || null)) {
        return null;
      }

      return parsed;
    }

    if (!isResumeDataShape(parsed)) {
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
