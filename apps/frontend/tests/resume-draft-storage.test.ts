import { describe, expect, it } from 'vitest';

import type { ResumeData } from '@/components/dashboard/resume-component';
import {
  buildResumeDraft,
  getResumeDraftStorageKey,
  parseResumeDraft,
  RESUME_DRAFT_MAX_AGE_MS,
  shouldPromptForDraftRestore,
} from '@/lib/utils/resume-draft-storage';

const baseResume = {
  personalInfo: {
    name: 'Ada Lovelace',
    title: 'Software Engineer',
    email: 'ada@example.com',
    phone: '',
    location: '',
    website: '',
    linkedin: '',
    github: '',
  },
  summary: '',
  workExperience: [],
  education: [],
  personalProjects: [],
  additional: {
    technicalSkills: [],
    languages: [],
    certificationsTraining: [],
    awards: [],
  },
} satisfies ResumeData;

describe('resume draft storage helpers', () => {
  it('scopes saved drafts by resume id', () => {
    expect(getResumeDraftStorageKey('abc-123')).toBe('resume_builder_draft:abc-123');
    expect(getResumeDraftStorageKey(null)).toBe('resume_builder_draft:new');
  });

  it('wraps draft data with identity and timestamp metadata', () => {
    expect(buildResumeDraft('abc-123', baseResume, 1770000000000)).toEqual({
      resumeId: 'abc-123',
      updatedAt: 1770000000000,
      data: baseResume,
    });
  });

  it('parses both the new draft envelope and the legacy plain data shape', () => {
    // Timestamp must be recent: drafts past RESUME_DRAFT_MAX_AGE_MS are expired
    // by design (see the "draft expiry" suite below). This case is about the
    // round-trip shape, not the TTL.
    const envelope = buildResumeDraft('abc-123', baseResume, Date.now() - 1000);
    expect(parseResumeDraft(JSON.stringify(envelope), 'abc-123')).toEqual(envelope);

    expect(parseResumeDraft(JSON.stringify(baseResume), 'abc-123', 1770000000100)).toEqual({
      resumeId: 'abc-123',
      updatedAt: 1770000000100,
      data: baseResume,
    });
  });

  it('rejects malformed JSON without throwing', () => {
    // T-02: every input in the "valid JSON" case below parses cleanly, so the
    // try/catch in parseResumeDraft was never exercised — it could be deleted
    // outright and this suite stayed green. These hit the catch.
    expect(parseResumeDraft('{oops', 'abc-123')).toBeNull();
    expect(parseResumeDraft('{"data": {', 'abc-123')).toBeNull();
    expect(parseResumeDraft('undefined', 'abc-123')).toBeNull();
  });

  it('rejects valid JSON that does not look like resume data', () => {
    expect(parseResumeDraft('"not a resume"', 'abc-123')).toBeNull();
    expect(parseResumeDraft(JSON.stringify({ data: 42, updatedAt: 1 }), 'abc-123')).toBeNull();
    expect(
      parseResumeDraft(
        JSON.stringify({
          ...baseResume,
          workExperience: {},
        }),
        'abc-123'
      )
    ).toBeNull();
  });

  it('rejects an envelope for a different resume id', () => {
    const otherResumeDraft = buildResumeDraft('other-resume', baseResume, 1770000000000);

    expect(parseResumeDraft(JSON.stringify(otherResumeDraft), 'abc-123')).toBeNull();
  });

  it('can reject legacy plain drafts when they cannot be safely scoped', () => {
    expect(
      parseResumeDraft(JSON.stringify(baseResume), 'abc-123', 1770000000100, {
        allowLegacyPlainData: false,
      })
    ).toBeNull();
  });

  it('only prompts restore when the draft differs from the server copy', () => {
    expect(shouldPromptForDraftRestore(buildResumeDraft('abc-123', baseResume), baseResume)).toBe(
      false
    );

    const changedDraft = buildResumeDraft('abc-123', {
      ...baseResume,
      education: [
        {
          id: 1,
          institution: 'MIT',
          degree: 'BS',
          years: '2020 - 2024',
        },
      ],
    });

    expect(shouldPromptForDraftRestore(changedDraft, baseResume)).toBe(true);
  });
});

describe('draft expiry', () => {
  it('rejects a draft older than the max age', () => {
    const stale = JSON.stringify({
      resumeId: 'abc-123',
      updatedAt: Date.now() - (RESUME_DRAFT_MAX_AGE_MS + 60_000),
      data: baseResume,
    });

    expect(parseResumeDraft(stale, 'abc-123')).toBeNull();
  });

  it('keeps a draft inside the max age', () => {
    const fresh = JSON.stringify({
      resumeId: 'abc-123',
      updatedAt: Date.now() - (RESUME_DRAFT_MAX_AGE_MS - 60_000),
      data: baseResume,
    });

    expect(parseResumeDraft(fresh, 'abc-123')).not.toBeNull();
  });
});
