export interface Apod {
  date: string;
  explanation: string;
  hdurl?: string;
  media_type: 'image' | 'video' | string;
  service_version: string;
  title: string;
  url: string;
}

export interface NeoObject {
  id: string;
  name: string;
}

export interface NeoBrowsePage {
  size: number;
  total_elements: number;
  total_pages: number;
  number: number;
}

export interface NeoBrowse {
  links: Record<string, string>;
  page: NeoBrowsePage;
  near_earth_objects: NeoObject[];
}
