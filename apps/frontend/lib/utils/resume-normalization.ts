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
  if (!items) return items;
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

const hasExperienceContent = (item: Experience): boolean => {
  return Boolean(
    item.title?.trim() ||
    item.company?.trim() ||
    item.location?.trim() ||
    item.years?.trim() ||
    item.description?.length
  );
};

const hasProjectContent = (item: Project): boolean => {
  return Boolean(
    item.name?.trim() ||
    item.role?.trim() ||
    item.years?.trim() ||
    item.github?.trim() ||
    item.website?.trim() ||
    item.description?.length
  );
};

const hasCustomItemContent = (item: CustomSectionItem): boolean => {
  return Boolean(
    item.title?.trim() ||
    item.subtitle?.trim() ||
    item.location?.trim() ||
    item.years?.trim() ||
    item.description?.length
  );
};

const normalizeCustomSection = (section: CustomSection): CustomSection => {
  if (section.sectionType === 'itemList') {
    return {
      ...section,
      items: (section.items || []).map(normalizeDescriptionFields).filter(hasCustomItemContent),
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
    workExperience: (resume.workExperience || [])
      .map(normalizeDescriptionFields)
      .filter(hasExperienceContent),
    personalProjects: (resume.personalProjects || [])
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
