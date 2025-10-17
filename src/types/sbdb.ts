export interface SbdbOrbit {
  e: string;
  a?: string;
  q?: string;
  i: string;
  om: string;
  w: string;
  ma?: string;
  M?: string;
  epoch: string;
}

export interface SbdbObject {
  object_name?: string;
  orbit?: SbdbOrbit;
}

export interface SbdbResponse {
  object?: SbdbObject;
}
