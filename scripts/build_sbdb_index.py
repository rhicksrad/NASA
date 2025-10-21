#!/usr/bin/env python3
"""Build a compact SBDB index for the top 30,000 asteroids plus all comets."""
from __future__ import annotations

import codecs
import json
import gzip
from pathlib import Path
from typing import Iterator

import encodings.cp1252 as cp1252

PARTS = [
    Path('public/mpcorb_extended.json_1[1].gz'),
    Path('public/mpcorb_extended.json_2[1].gz'),
    Path('public/mpcorb_extended.json_3.gz'),
    Path('public/mpcorb_extended.json_4[1].gz'),
    Path('public/mpcorb_extended.json_5.gz'),
    Path('public/mpcorb_extended.json_6.gz'),
    Path('public/mpcorb_extended.json_7.gz'),
    Path('public/mpcorb_extended.json_8.gz'),
    Path('public/mpcorb_extended.json_9.gz'),
    Path('public/mpcorb_extended.json_10.gz'),
    Path('public/mpcorb_extended.json_11.gz'),
    Path('public/mpcorb_extended.json_12.gz'),
]

CP1252_REVERSE = {ord(ch): i for i, ch in enumerate(cp1252.decoding_table) if ch != '\ufffe'}

ASTEROID_LIMIT = 30_000
INDEX_TARGET = Path('public/sbdb-index.json')
COMET_SOURCE = Path('public/allcometels.json.gz')
RECOVERED_GZ = Path('mpcorb_extended_recovered.json.gz')


def _convert_cp1252(text: str) -> bytes:
    """Convert a UTF-8 decoded text chunk back into the original binary bytes."""
    buf = bytearray()
    for char in text:
        code = ord(char)
        if code <= 0xFF:
            buf.append(code)
        else:
            buf.append(CP1252_REVERSE[code])
    return bytes(buf)


def rebuild_gzip(target: Path) -> None:
    """Reassemble the split MPCORB archive into a valid gzip file."""
    with target.open('wb') as out:
        for part in PARTS:
            decoder = codecs.getincrementaldecoder('utf-8')()
            with part.open('rb') as stream:
                while chunk := stream.read(1_000_000):
                    out.write(_convert_cp1252(decoder.decode(chunk)))
                tail = decoder.decode(b'', final=True)
                if tail:
                    out.write(_convert_cp1252(tail))


def iter_json_array(path: Path) -> Iterator[dict]:
    """Stream JSON objects from a large array without loading the entire file."""
    decoder = json.JSONDecoder()
    with gzip.open(path, 'rt', encoding='utf-8') as stream:
        buffer = ''
        eof = False
        while not eof:
            chunk = stream.read(65536)
            if not chunk:
                eof = True
            buffer += chunk
            pos = 0
            while True:
                while pos < len(buffer) and buffer[pos].isspace():
                    pos += 1
                if pos >= len(buffer):
                    break
                char = buffer[pos]
                if char in '[,':
                    pos += 1
                    continue
                if char == ']':
                    return
                try:
                    obj, end = decoder.raw_decode(buffer, pos)
                except json.JSONDecodeError:
                    break
                yield obj
                pos = end
            buffer = buffer[pos:]


def _normalize_number(value: str | None) -> str | None:
    if not value:
        return None
    stripped = value.strip()
    if stripped.startswith('(') and stripped.endswith(')'):
        stripped = stripped[1:-1]
    return stripped or None


def _normalize_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return [str(value)]


def _normalize_neo(value) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {'y', 'yes', 'true'}:
            return True
        if lowered in {'n', 'no', 'false'}:
            return False
    return None


def build_index() -> None:
    rebuild_gzip(RECOVERED_GZ)

    asteroids: list[dict] = []
    for row in iter_json_array(RECOVERED_GZ):
        asteroids.append(
            {
                'type': 'ast',
                'number': _normalize_number(row.get('Number')),
                'name': row.get('Name') or None,
                'principal': row.get('Principal_desig') or None,
                'other': _normalize_list(row.get('Other_desigs')),
                'h': row.get('H'),
                'g': row.get('G'),
                'epoch': row.get('Epoch'),
                'orbit': row.get('Orbit_type') or None,
                'neo': _normalize_neo(row.get('Neo')),
            }
        )
        if len(asteroids) >= ASTEROID_LIMIT:
            break

    comets: list[dict] = []
    for row in iter_json_array(COMET_SOURCE):
        designation = row.get('Designation_and_name') or ''
        name = None
        if '(' in designation and designation.endswith(')'):
            _, tail = designation.rsplit('(', 1)
            name = tail[:-1].strip() or None
        comets.append(
            {
                'type': 'com',
                'designation': designation,
                'name': name,
                'packed': row.get('Provisional_packed_desig') or None,
                'orbit': row.get('Orbit_type') or None,
                'h': row.get('H'),
                'g': row.get('G'),
            }
        )

    payload = {
        'metadata': {
            'asteroidCount': len(asteroids),
            'cometCount': len(comets),
            'source': 'JPL SBDB mpcorb_extended + comet els',
        },
        'entries': asteroids + comets,
    }

    with INDEX_TARGET.open('w', encoding='utf-8') as fh:
        json.dump(payload, fh, separators=(',', ':'), ensure_ascii=False)

    RECOVERED_GZ.unlink(missing_ok=True)


if __name__ == '__main__':
    build_index()
