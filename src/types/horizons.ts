export interface HorizonsElementValue {
  value?: number | string;
  units?: string;
  name?: string;
  label?: string;
  [key: string]: unknown;
}

export interface HorizonsElementRecord {
  [key: string]: number | string | HorizonsElementValue | undefined;
}

export interface HorizonsJson {
  signature: { version: string; source: string };
  result?: string | { elements?: HorizonsElementRecord[] };
  elements?: HorizonsElementRecord[];
  error?: string;
}
