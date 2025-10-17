export interface SbdbOrbitElement {
  name: string;
  value: string | number | null;
  label?: string;
  title?: string;
  units?: string | null;
  sigma?: string | null;
}

export interface SbdbOrbit {
  epoch?: string;
  cov_epoch?: string;
  elements?: SbdbOrbitElement[];
  e?: string;
  a?: string;
  q?: string;
  i?: string;
  om?: string;
  w?: string;
  ma?: string;
  M?: string;
  [key: string]: unknown;
}

export interface SbdbObject {
  object_name?: string;
  fullname?: string;
  des?: string;
  prefix?: string;
  [key: string]: unknown;
}

export interface SbdbResponse {
  object?: SbdbObject;
  orbit?: SbdbOrbit;
}
