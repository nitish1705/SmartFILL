import type { ProfileKeyDef } from '../types';

export const REGISTRY: ProfileKeyDef[] = [
  // ───────── personal ─────────
  {
    key: 'personal.first_name', label: 'First name', type: 'text',
    description: 'given name or first name of the person',
    synonyms: ['first name', 'given name', 'forename', 'christian name'],
    autocomplete: ['given-name'],
    negativeHints: ['father', 'mother', 'guardian', 'parent'],
  },
  {
    key: 'personal.middle_name', label: 'Middle name', type: 'text',
    description: 'middle name or middle initial',
    synonyms: ['middle name', 'middle initial'],
    autocomplete: ['additional-name'],
  },
  {
    key: 'personal.last_name', label: 'Last name', type: 'text',
    description: 'surname, family name or last name',
    synonyms: ['last name', 'surname', 'family name'],
    autocomplete: ['family-name'],
    negativeHints: ['father', 'mother', 'guardian', 'parent'],
  },
  {
    key: 'personal.full_name', label: 'Full name', type: 'text',
    description: 'full name of the person, first and last name together',
    synonyms: ['full name', 'name', 'complete name', 'applicant name', 'candidate name', 'participant name', 'author name', 'attendee name', 'your name'],
    autocomplete: ['name'],
    negativeHints: ['user', 'username', 'company', 'institution', 'organization', 'department', 'father', 'mother', 'guardian', 'project', 'paper', 'file', 'course', 'event', 'card', 'holder', 'cardholder', 'team', 'school', 'college', 'university'],
  },
  {
    key: 'personal.salutation', label: 'Salutation', type: 'enum',
    description: 'salutation or honorific such as Mr, Ms, Dr',
    synonyms: ['salutation', 'honorific', 'name prefix', 'courtesy title'],
    autocomplete: ['honorific-prefix'],
  },
  {
    key: 'personal.email', label: 'Email', type: 'email',
    description: 'primary personal email address',
    synonyms: ['email', 'email address', 'email id', 'mail id', 'contact email', 'primary email', 'confirm email', 'reenter email', 'retype email', 'verify email', 'author email', 'attendee email'],
    autocomplete: ['email'],
    negativeHints: ['alternate', 'alternative', 'secondary', 'alt', 'parent', 'guardian', 'supervisor', 'advisor', 'work', 'office', 'official', 'business', 'corporate'],
  },
  {
    key: 'personal.alt_email', label: 'Alternate email', type: 'email',
    description: 'secondary or alternate email address',
    synonyms: ['alternate email', 'alternative email', 'secondary email', 'alt email', 'other email', 'backup email'],
  },
  {
    key: 'personal.phone', label: 'Phone', type: 'tel',
    description: 'phone or mobile number',
    synonyms: ['phone', 'phone number', 'telephone', 'telephone number', 'mobile', 'mobile number', 'mobile no', 'contact number', 'contact no', 'cell', 'cell phone', 'cellphone'],
    autocomplete: ['tel', 'tel-national'],
    negativeHints: ['fax', 'emergency', 'parent', 'guardian', 'code'],
  },
  {
    key: 'personal.country', label: 'Country', type: 'country',
    description: 'country of residence',
    synonyms: ['country', 'nation', 'country of residence', 'country region'],
    autocomplete: ['country', 'country-name'],
    negativeHints: ['code', 'calling', 'dial'],
  },
  {
    key: 'personal.state', label: 'State', type: 'text',
    description: 'state, province or region',
    synonyms: ['state', 'province', 'state province', 'state region'],
    autocomplete: ['address-level1'],
  },
  {
    key: 'personal.city', label: 'City', type: 'text',
    description: 'city or town',
    synonyms: ['city', 'town', 'city town', 'locality', 'city name'],
    autocomplete: ['address-level2'],
  },
  {
    key: 'personal.address_line1', label: 'Address line 1', type: 'text',
    description: 'street address',
    synonyms: ['address', 'address line 1', 'address 1', 'street address', 'street', 'residential address', 'mailing address', 'current address', 'permanent address'],
    autocomplete: ['address-line1', 'street-address'],
    negativeHints: ['email', 'web', 'ip', 'billing', 'shipping', 'company', 'office', 'mac'],
  },
  {
    key: 'personal.address_line2', label: 'Address line 2', type: 'text',
    description: 'apartment, suite or second address line',
    synonyms: ['address line 2', 'address 2', 'apartment', 'suite', 'flat', 'landmark'],
    autocomplete: ['address-line2'],
  },
  {
    key: 'personal.postal_code', label: 'Postal code', type: 'text',
    description: 'postal code, zip code or pin code',
    synonyms: ['postal code', 'zip', 'zip code', 'pin code', 'pincode', 'postcode', 'post code'],
    autocomplete: ['postal-code'],
  },
  {
    key: 'personal.gender', label: 'Gender', type: 'enum',
    description: 'gender',
    synonyms: ['gender', 'sex'],
    autocomplete: ['sex'],
  },

  // ───────── academic ─────────
  {
    key: 'academic.institution', label: 'Institution', type: 'text',
    description: 'academic institution, university, college or school affiliation',
    synonyms: ['institution', 'institute', 'affiliation', 'university', 'college', 'school', 'organization', 'organisation', 'institution name', 'university name', 'college name', 'institute name', 'affiliated institution', 'affiliation institution', 'institution affiliation'],
    negativeHints: ['company', 'employer', 'publisher', 'previous', 'former', 'high', 'email', 'address'],
  },
  {
    key: 'academic.department', label: 'Department', type: 'text',
    description: 'academic department or division',
    synonyms: ['department', 'division', 'faculty', 'department name'],
  },
  {
    key: 'academic.degree', label: 'Degree', type: 'text',
    description: 'degree or highest qualification',
    synonyms: ['degree', 'qualification', 'highest qualification', 'education level', 'degree program'],
  },
  {
    key: 'academic.field', label: 'Field of study', type: 'text',
    description: 'field of study, major or specialization',
    synonyms: ['field of study', 'major', 'specialization', 'specialisation', 'discipline', 'area of study', 'stream'],
  },
  {
    key: 'academic.year_of_study', label: 'Year of study', type: 'text',
    description: 'current year of study',
    synonyms: ['year of study', 'current year of study', 'study year', 'class year', 'year in college'],
  },
  {
    key: 'academic.student_id', label: 'Student ID', type: 'text', sensitive: true,
    description: 'student identification or roll number',
    synonyms: ['student id', 'student number', 'roll number', 'roll no', 'registration number', 'enrollment number', 'usn'],
  },
  {
    key: 'academic.supervisor', label: 'Supervisor', type: 'text',
    description: 'research supervisor or advisor',
    synonyms: ['supervisor', 'advisor', 'adviser', 'mentor', 'research supervisor', 'thesis supervisor'],
  },

  // ───────── professional ─────────
  {
    key: 'professional.designation', label: 'Designation', type: 'text',
    description: 'job title or designation',
    synonyms: ['designation', 'job title', 'position', 'current position', 'occupation', 'role', 'job role', 'profession'],
    autocomplete: ['organization-title'],
    negativeHints: ['author', 'reviewer'],
  },
  {
    key: 'professional.organization', label: 'Organization', type: 'text',
    description: 'company or employer organization',
    synonyms: ['organization', 'organisation', 'company', 'employer', 'company name', 'organization name', 'workplace', 'current employer', 'current company'],
    autocomplete: ['organization'],
    negativeHints: ['university', 'college', 'institute', 'academic'],
  },
  {
    key: 'professional.employer_email', label: 'Work email', type: 'email',
    description: 'work or official email address',
    synonyms: ['work email', 'office email', 'official email', 'employer email', 'business email', 'corporate email', 'company email'],
  },

  // ───────── research ─────────
  {
    key: 'research.orcid', label: 'ORCID iD', type: 'text',
    description: 'ORCID researcher identifier',
    synonyms: ['orcid', 'orcid id', 'orcid identifier', 'orcid number'],
  },
  {
    key: 'research.google_scholar', label: 'Google Scholar', type: 'url',
    description: 'Google Scholar profile link',
    synonyms: ['google scholar', 'scholar profile', 'google scholar profile', 'google scholar id', 'scholar url'],
  },
  {
    key: 'research.research_interests', label: 'Research interests', type: 'longtext',
    description: 'research interests or areas',
    synonyms: ['research interests', 'research interest', 'research area', 'research areas', 'areas of interest', 'area of interest'],
  },
  {
    key: 'research.ieee_member_id', label: 'IEEE member ID', type: 'text',
    description: 'IEEE membership number',
    synonyms: ['ieee member id', 'ieee membership number', 'ieee member number', 'ieee number', 'ieee membership id'],
  },
  {
    key: 'research.default_author_role', label: 'Default author role', type: 'text',
    description: 'role of the author in a paper',
    synonyms: ['author role', 'author type', 'role in paper', 'contribution role'],
  },
];

const BY_KEY = new Map(REGISTRY.map((d) => [d.key, d]));

export function getKeyDef(key: string): ProfileKeyDef | undefined {
  return BY_KEY.get(key);
}
