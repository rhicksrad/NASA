export interface NasaImageItemLink {
  href: string; // thumbnail or related
  rel?: string;
  render?: string; // "image"
}

export interface NasaImageItemData {
  nasa_id: string;
  title: string;
  description?: string;
  keywords?: string[];
  center?: string;
  date_created?: string;
  media_type: 'image' | string;
}

export interface NasaImageItem {
  href?: string; // collection URL for all assets (not always present here)
  links?: NasaImageItemLink[];
  data: NasaImageItemData[];
}

export interface NasaImageCollection {
  items: NasaImageItem[];
  href?: string;
  metadata?: { total_hits?: number };
  links?: Array<{ href: string; prompt?: string; rel?: string }>;
}

export interface NasaImageSearch {
  collection: NasaImageCollection;
}

export interface ImagePick {
  thumbUrl: string;
  title: string;
  assetPage?: string;
}
