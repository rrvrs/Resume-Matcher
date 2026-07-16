import { describe, expect, it } from 'vitest';

import type { ResumeData } from '@/components/dashboard/resume-component';
import { normalizeResumeForRender, normalizeResumeForSave } from '@/lib/utils/resume-normalization';

const baseResume = {
  personalInfo: {
    name: 'Ada Lovelace',
    title: 'Software Engineer',
    email: 'ada@example.com',
  },
  summary: '',
  workExperience: [],
  education: [],
  personalProjects: [],
  additional: {},
} satisfies ResumeData;

describe('resume normalization', () => {
  it('drops empty description placeholders from the canonical save payload', () => {
    const editorState: ResumeData = {
      ...baseResume,
      workExperience: [
        {
          id: 1,
          title: 'Engineer',
          company: 'Analytical Engines Inc',
          years: '2024 - Present',
          description: ['', 'Built reliable systems', '   '],
        },
      ],
    };

    expect(normalizeResumeForSave(editorState).workExperience?.[0]).toMatchObject({
      description: ['Built reliable systems'],
    });
    expect(editorState.workExperience?.[0].description).toEqual([
      '',
      'Built reliable systems',
      '   ',
    ]);
  });

  it('drops entirely empty editor-only experience entries from the save payload', () => {
    const editorState: ResumeData = {
      ...baseResume,
      workExperience: [
        {
          id: 1,
          title: '',
          company: '',
          location: '',
          years: '',
          description: [''],
        },
      ],
    };

    expect(normalizeResumeForSave(editorState).workExperience).toEqual([]);
  });

  it('normalizes custom item-list sections for rendering and saving', () => {
    const editorState: ResumeData = {
      ...baseResume,
      customSections: {
        custom_1: {
          sectionType: 'itemList',
          items: [
            {
              id: 1,
              title: 'Publication',
              description: ['', 'Accepted at a systems workshop'],
            },
          ],
        },
      },
    };

    const normalized = normalizeResumeForRender(editorState);

    expect(normalized.customSections?.custom_1.items?.[0].description).toEqual([
      'Accepted at a systems workshop',
    ]);
  });
});
