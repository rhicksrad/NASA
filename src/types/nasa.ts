export interface Apod {
  date: string;
  title: string;
  explanation: string;
  hdurl?: string;
  media_type: 'image' | 'video' | string;
  url: string;
  service_version: string;
  thumbnail_url?: string; // present when thumbs=true
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

export interface NeoOrbitClass {
  orbit_class_type: string;
  orbit_class_description: string;
  orbit_class_range: string;
}

export interface NeoOrbitalData {
  orbit_id?: string;
  orbit_determination_date?: string;
  first_observation_date?: string;
  last_observation_date?: string;
  data_arc_in_days?: string;
  observations_used?: string;
  orbit_uncertainty?: string;
  minimum_orbit_intersection?: string;
  jupiter_tisserand_invariant?: string;
  epoch_osculation: string;
  eccentricity: string;
  semi_major_axis: string;
  inclination: string;
  ascending_node_longitude: string;
  orbital_period?: string;
  perihelion_distance?: string;
  perihelion_argument: string;
  aphelion_distance?: string;
  perihelion_time?: string;
  mean_anomaly: string;
  mean_motion?: string;
  equinox?: string;
  orbit_class?: NeoOrbitClass;
}

export interface NeoItem {
  id: string;
  neo_reference_id?: string;
  name: string;
  links?: Record<string, string>;
  absolute_magnitude_h: number;
  estimated_diameter: NeoEstimatedDiameter;
  is_potentially_hazardous_asteroid: boolean;
  close_approach_data: NeoCloseApproach[];
  nasa_jpl_url?: string;
  orbital_data?: NeoOrbitalData;
  is_sentry_object?: boolean;
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
