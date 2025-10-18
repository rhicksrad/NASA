// src/api/mars.ts
import { getTextOrJSON, HttpError } from './base';

export { HttpError };

export type RoverName = 'curiosity' | 'perseverance' | 'opportunity' | 'spirit';

export interface MarsPhoto {
  id: number;
  src: string;
  earthDate: string;
  sol: number | null;
  camera: { name: string; full_name?: string };
  rover: { name: string; landing_date?: string; status?: string };
}

export interface MarsQuery {
  rover: RoverName;
  earthDate?: string; // YYYY-MM-DD
  sol?: number;
  camera?: string;
  page?: number;
}

export async function getMarsPhotos(q: MarsQuery): Promise<{ photos: MarsPhoto[]; cameras: string[] }> {
  const { rover, earthDate, sol, camera, page } = q;
  const params = new URLSearchParams();
  if (earthDate) params.set('earth_date', earthDate);
  if (typeof sol === 'number') params.set('sol', String(sol));
  if (camera) params.set('camera', camera);
  if (typeof page === 'number') params.set('page', String(page));

  const path = `/mars/${encodeURIComponent(rover)}/photos?${params.toString()}`;
  const json = await getTextOrJSON(path); // throws HttpError on non-2xx

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

  const toStringValue = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  };

  const toNumberValue = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const photosRaw = Array.isArray((json as { photos?: unknown })?.photos)
    ? ((json as { photos: unknown[] }).photos)
    : [];

  const photos: MarsPhoto[] = photosRaw
    .map(raw => {
      if (!isRecord(raw)) return null;

      const id = Number(raw.id);
      const src = toStringValue(raw.img_src);
      const earthDateValue = toStringValue(raw.earth_date);
      const solValue = toNumberValue(raw.sol);

      const cameraRaw = isRecord(raw.camera) ? raw.camera : {};
      const roverRaw = isRecord(raw.rover) ? raw.rover : {};

      const cameraName = toStringValue(cameraRaw.name);
      const cameraFull = toStringValue(cameraRaw.full_name);
      const roverName = toStringValue(roverRaw.name);
      const landingDate = toStringValue(roverRaw.landing_date);
      const roverStatus = toStringValue(roverRaw.status);

      const idNumber = Number.isFinite(id) ? id : Number.NaN;
      if (!Number.isFinite(idNumber) || !src) return null;

      return {
        id: idNumber,
        src,
        earthDate: earthDateValue,
        sol: solValue,
        camera: { name: cameraName, full_name: cameraFull || undefined },
        rover: {
          name: roverName,
          landing_date: landingDate || undefined,
          status: roverStatus || undefined,
        },
      } satisfies MarsPhoto;
    })
    .filter((p): p is MarsPhoto => Boolean(p && p.id && p.src));

  // Build camera list (unique)
  const cameras = Array.from(
    new Set(
      photos
        .map(p => p.camera.name)
        .filter((name): name is string => Boolean(name && name.trim()))
    )
  ).sort();

  return { photos, cameras };
}
