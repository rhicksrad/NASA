export interface Apod {
  date: string;
  explanation: string;
  hdurl?: string;
  media_type: 'image' | 'video' | string;
  service_version: string;
  title: string;
  url: string;
}

export interface NeoEstimatedDiameterRange {
  estimated_diameter_min: number;
  estimated_diameter_max: number;
}

export interface NeoEstimatedDiameter {
  kilometers: NeoEstimatedDiameterRange;
  meters: NeoEstimatedDiameterRange;
  miles: NeoEstimatedDiameterRange;
  feet: NeoEstimatedDiameterRange;
}

export interface NeoRelativeVelocity {
  kilometers_per_second: string;
  kilometers_per_hour: string;
  miles_per_hour: string;
}

export interface NeoMissDistance {
  astronomical: string;
  lunar: string;
  kilometers: string;
  miles: string;
}

export interface NeoCloseApproachData {
  close_approach_date: string;
  close_approach_date_full?: string;
  epoch_date_close_approach?: number;
  relative_velocity: NeoRelativeVelocity;
  miss_distance: NeoMissDistance;
  orbiting_body: string;
}

export interface NeoObject {
  id: string;
  neo_reference_id: string;
  name: string;
  nasa_jpl_url: string;
  absolute_magnitude_h: number;
  estimated_diameter: NeoEstimatedDiameter;
  is_potentially_hazardous_asteroid: boolean;
  close_approach_data: NeoCloseApproachData[];
  is_sentry_object: boolean;
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
