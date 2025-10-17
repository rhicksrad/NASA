export interface Apod {
  date: string;
  explanation: string;
  hdurl?: string;
  media_type: 'image' | 'video' | string;
  service_version: string;
  title: string;
  url: string;
}

export interface NeoCloseApproach {
  close_approach_date: string;
  close_approach_date_full?: string;
  epoch_date_close_approach?: number;
  relative_velocity: {
    kilometers_per_second: string;
    kilometers_per_hour: string;
    miles_per_hour: string;
  };
  miss_distance: {
    astronomical: string;
    lunar: string;
    kilometers: string;
    miles: string;
  };
  orbiting_body: string;
}

export interface NeoDiameter {
  estimated_diameter_min: number;
  estimated_diameter_max: number;
}

export interface NeoEstimatedDiameter {
  kilometers: NeoDiameter;
  meters: NeoDiameter;
  miles: NeoDiameter;
  feet: NeoDiameter;
}

export interface NeoItem {
  id: string;
  neo_reference_id?: string;
  name: string;
  absolute_magnitude_h: number;
  estimated_diameter: NeoEstimatedDiameter;
  is_potentially_hazardous_asteroid: boolean;
  close_approach_data: NeoCloseApproach[];
  nasa_jpl_url?: string;
}

export interface NeoFeed {
  element_count: number;
  near_earth_objects: Record<string, NeoItem[]>;
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
  near_earth_objects: NeoItem[];
}
