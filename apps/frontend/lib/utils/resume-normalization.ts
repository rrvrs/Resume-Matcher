import type {
  CustomSection,
  CustomSectionItem,
  Experience,
  Project,
  ResumeData,
} from '@/components/dashboard/resume-component';

type DescribedItem = {
  description?: unknown;
  descriptionStyles?: unknown;
};

const isMeaningfulText = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const normalizeStringList = (items?: string[]): string[] | undefined => {
  // Only `undefined` means "field absent" — preserve it so the key stays out
  // of the payload. Every other non-array (notably `null` from malformed
  // persisted data) is coerced to []; the old `if (!items) return items`
  // returned null unchanged, leaking it into a value typed `string[] |
  // undefined` and crashing callers that assume an array.
  if (items === undefined) return undefined;
  if (!Array.isArray(items)) return [];
  return items.filter(isMeaningfulText).map((item) => item.trim());
};

const normalizeDescriptionFields = <T extends DescribedItem>(item: T): T => {
  const descriptions = Array.isArray(item.description) ? item.description : [];
  // descriptionStyles is positional — styles[i] belongs to description[i]. It
  // must be filtered in lockstep, or dropping a blank description silently
  // shifts every later point's bullet/plain setting onto its neighbour.
  const styles = Array.isArray(item.descriptionStyles) ? item.descriptionStyles : undefined;
  const nextDescriptions: string[] = [];
  const nextStyles: unknown[] = [];

  descriptions.forEach((description, index) => {
    if (!isMeaningfulText(description)) {
      return;
    }

    nextDescriptions.push(description.trim());
    if (styles) {
      nextStyles.push(styles[index] === 'plain' ? 'plain' : 'bullet');
    }
  });

  return {
    ...item,
    description: nextDescriptions,
    ...(styles ? { descriptionStyles: nextStyles } : {}),
  };
};

// Optional chaining guards null/undefined but NOT a non-string: a numeric
// `title` from malformed persisted data makes `.trim` undefined and throws
// "item.title?.trim is not a function". isMeaningfulText type-checks first.
const hasExperienceContent = (item: Experience): boolean => {
  return Boolean(
    isMeaningfulText(item.title) ||
    isMeaningfulText(item.company) ||
    isMeaningfulText(item.location) ||
    isMeaningfulText(item.years) ||
    (Array.isArray(item.description) && item.description.length)
  );
};

const hasProjectContent = (item: Project): boolean => {
  return Boolean(
    isMeaningfulText(item.name) ||
    isMeaningfulText(item.role) ||
    isMeaningfulText(item.years) ||
    isMeaningfulText(item.github) ||
    isMeaningfulText(item.website) ||
    (Array.isArray(item.description) && item.description.length)
  );
};

const hasCustomItemContent = (item: CustomSectionItem): boolean => {
  return Boolean(
    isMeaningfulText(item.title) ||
    isMeaningfulText(item.subtitle) ||
    isMeaningfulText(item.location) ||
    isMeaningfulText(item.years) ||
    (Array.isArray(item.description) && item.description.length)
  );
};

const normalizeCustomSection = (section: CustomSection): CustomSection => {
  if (section.sectionType === 'itemList') {
    return {
      ...section,
      // Array.isArray, not `|| []` — a malformed truthy non-array (an object
      // from hand-edited storage) reaches .map and throws.
      items: (Array.isArray(section.items) ? section.items : [])
        .map(normalizeDescriptionFields)
        .filter(hasCustomItemContent),
    };
  }

  if (section.sectionType === 'stringList') {
    return {
      ...section,
      strings: normalizeStringList(section.strings),
    };
  }

  return section;
};

export const normalizeResumeForSave = (resume: ResumeData): ResumeData => {
  const customSections = resume.customSections
    ? Object.fromEntries(
        Object.entries(resume.customSections).map(([key, section]) => [
          key,
          normalizeCustomSection(section),
        ])
      )
    : resume.customSections;

  return {
    ...resume,
    workExperience: (Array.isArray(resume.workExperience) ? resume.workExperience : [])
      .map(normalizeDescriptionFields)
      .filter(hasExperienceContent),
    personalProjects: (Array.isArray(resume.personalProjects) ? resume.personalProjects : [])
      .map(normalizeDescriptionFields)
      .filter(hasProjectContent),
    additional: resume.additional
      ? {
          ...resume.additional,
          technicalSkills: normalizeStringList(resume.additional.technicalSkills),
          languages: normalizeStringList(resume.additional.languages),
          certificationsTraining: normalizeStringList(resume.additional.certificationsTraining),
          awards: normalizeStringList(resume.additional.awards),
        }
      : resume.additional,
    customSections,
  };
};

export const normalizeResumeForRender = (resume: ResumeData): ResumeData => {
  return normalizeResumeForSave(resume);
};
