import { describe, expect, it } from 'vitest';

import type { ResumeData } from '@/components/dashboard/resume-component';
import {
  buildResumeDraft,
  getResumeDraftStorageKey,
  parseResumeDraft,
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
    const envelope = buildResumeDraft('abc-123', baseResume, 1770000000000);
    expect(parseResumeDraft(JSON.stringify(envelope), 'abc-123')).toEqual(envelope);

    expect(parseResumeDraft(JSON.stringify(baseResume), 'abc-123', 1770000000100)).toEqual({
      resumeId: 'abc-123',
      updatedAt: 1770000000100,
      data: baseResume,
    });
  });

  it('rejects valid JSON that does not look like resume data', () => {
    expect(parseResumeDraft('"not a resume"', 'abc-123')).toBeNull();
    expect(parseResumeDraft(JSON.stringify({ data: 42, updatedAt: 1 }), 'abc-123')).toBeNull();
  });

  it('rejects an envelope for a different resume id', () => {
    const otherResumeDraft = buildResumeDraft('other-resume', baseResume, 1770000000000);

    expect(parseResumeDraft(JSON.stringify(otherResumeDraft), 'abc-123')).toBeNull();
  });

  it('only prompts restore when the draft differs from the server copy', () => {
    expect(shouldPromptForDraftRestore(buildResumeDraft('abc-123', baseResume), baseResume)).toBe(
      false
    );

    const changedDraft = buildResumeDraft('abc-123', {
      ...baseResume,
      education: [
        {
          institution: 'MIT',
          degree: 'BS',
          startDate: '2020',
          endDate: '2024',
          location: '',
          gpa: '',
          honors: [],
          relevantCoursework: [],
        },
      ],
    });

    expect(shouldPromptForDraftRestore(changedDraft, baseResume)).toBe(true);
  });
});
