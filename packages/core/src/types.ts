export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'country'
  | 'date'
  | 'enum'
  | 'boolean'
  | 'longtext';

export interface ProfileKeyDef {
  key: string;
  label: string;
  /** Embedding anchor (used from Phase 2). */
  description: string;
  type: FieldType;
  synonyms: string[];
  negativeHints?: string[];
  /** HTML autocomplete tokens that map to this key. */
  autocomplete?: string[];
  /** Sensitive keys are never auto-filled. */
  sensitive?: boolean;
  perAuthor?: boolean;
}

export type ControlType =
  | 'input'
  | 'textarea'
  | 'select'
  | 'radio-group'
  | 'checkbox'
  | 'contenteditable'
  | 'custom';

export interface SelectOption {
  text: string;
  value: string;
}

export interface FieldContext {
  label?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  autocomplete?: string;
  nearbyText?: string;
  sectionHeading?: string;
  pageTitle: string;
  authorIndex?: number;
}

/** DOM-free description of a form control; the pipeline's input currency. */
export interface FieldInfo {
  fieldId: string;
  controlType: ControlType;
  inputType?: string;
  maxLength?: number;
  pattern?: string;
  disabled: boolean;
  readOnly: boolean;
  hidden: boolean;
  /** The user (or the page) already put a value in. */
  hasValue: boolean;
  options?: SelectOption[];
  context: FieldContext;
}

export type Decision = 'auto' | 'review' | 'ask' | 'skip' | 'blocked';
export type MatchLayer = 'site' | 'autocomplete' | 'rule' | 'embedding' | 'llm';

export interface MatchResult {
  fieldId: string;
  /** null = UNKNOWN */
  key: string | null;
  confidence: number;
  layer: MatchLayer;
  candidates: { key: string; score: number }[];
  decision: Decision;
  reason: string;
  /** Value to write (select: the option value). Only set when it can be filled. */
  value?: string;
  /** Human-readable preview of what will be written. */
  preview?: string;
}

export type ProfileValues = Record<string, string>;
