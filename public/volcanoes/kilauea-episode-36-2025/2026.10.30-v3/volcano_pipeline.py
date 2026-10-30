"""Publish cropped official NISAR/ARIA GUNWs as relative phase-derived LOS evidence.

This is post-processing of official interferograms, not an SLC interferometry engine.
Run locally; Earthdata credentials and remote handles never enter public artifacts.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

import h5py
import matplotlib
matplotlib.use('Agg')
from matplotlib import colormaps
import numpy as np
from PIL import Image
from pyproj import Geod, Transformer
import rasterio
from rasterio.transform import Affine, from_bounds
from rasterio.warp import reproject, Resampling, transform_bounds

from network_retry import remote_call

ROOT = Path(__file__).resolve().parent.parent
METHOD = 'gunw-relative-los-1.0.1'
C = 299792458.0


def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=2, allow_nan=False), encoding='utf-8')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def text_value(value):
    return value.decode() if isinstance(value, bytes) else str(value)


def source_info(result, sensor, selection):
    umm = result['umm']
    attrs = {a['Name']: a['Values'][0] for a in umm.get('AdditionalAttributes', []) if a.get('Values')}
    return {
        'granule_id': umm['GranuleUR'], 'cmr_concept_id': result.get('meta', {}).get('concept-id'),
        'sensor': sensor, 'start': selection['start'], 'end': selection['end'],
        'label': selection['label'], 'collection': umm['CollectionReference']['ShortName'],
        'maturity': 'BETA' if sensor == 'NISAR' else 'ARIA v3.0.1',
        'data_url': next((u['URL'] for u in umm.get('RelatedUrls', []) if u.get('Type') == 'GET DATA' and u['URL'].startswith('https:')), None),
        'track': attrs.get('TRACK_NUMBER', '014' if '-A-' in umm['GranuleUR'] else '079'),
        'direction': attrs.get('ASCENDING_DESCENDING', 'ASCENDING' if '-A-' in umm['GranuleUR'] else 'DESCENDING'),
        'look_direction': 'Left' if sensor == 'NISAR' else 'Right',
        'polarization': 'HH' if sensor == 'NISAR' else 'VV',
        'product_version': attrs.get('PRODUCT_VERSION', '3.0.1'),
        'upstream_processor_version': umm.get('PGEVersionClass', {}).get('PGEVersion'),
    }


def crop_indices(x, y, crs, bbox):
    if len(x) < 2 or len(y) < 2 or not np.allclose(np.diff(x), np.diff(x)[0]) or not np.allclose(np.diff(y), np.diff(y)[0]):
        raise ValueError('Coordinates must describe a regular grid.')
    dx, dy = float(x[1] - x[0]), float(y[1] - y[0])
    if dx <= 0 or dy >= 0:
        raise ValueError('Only north-up/east-right grids are supported.')
    west, south, east, north = transform_bounds('EPSG:4326', crs, *bbox, densify_pts=21)
    cols = np.flatnonzero((x >= west - dx / 2) & (x <= east + dx / 2))
    rows = np.flatnonzero((y >= south + dy / 2) & (y <= north - dy / 2))
    if not len(rows) or not len(cols):
        raise ValueError('The input does not cover the requested study box.')
    rs, cs = slice(int(rows[0]), int(rows[-1]) + 1), slice(int(cols[0]), int(cols[-1]) + 1)
    transform = Affine(dx, 0, float(x[cs.start]) - dx / 2, 0, dy, float(y[rs.start]) - dy / 2)
    return rs, cs, transform


def read_dataset(ds, selection):
    values = np.asarray(ds[selection], dtype='float32')
    fill = ds.attrs.get('_FillValue')
    if fill is not None:
        fill = float(np.asarray(fill).ravel()[0])
        # ARIA marks phase zero as fill, but coherent connected zero samples can
        # be legitimate. Preserve zero and rely on coherence/components there.
        if np.isfinite(fill) and fill != 0:
            values[values == fill] = np.nan
    return values


def extract_nisar(handle, info, bbox):
    root = handle['science/LSAR/GUNW/grids/frequencyA']
    group = root['unwrappedInterferogram/HH']
    phase = group['unwrappedPhase']
    if text_value(phase.attrs.get('units', '')) not in ('radians', 'rad'):
        raise ValueError('NISAR phase units must be radians.')
    crs = rasterio.crs.CRS.from_epsg(int(group['projection'][()]))
    rs, cs, transform = crop_indices(group['xCoordinates'][:], group['yCoordinates'][:], crs, bbox)
    arrays = {key: read_dataset(group[name], (rs, cs)) for key, name in {
        'phase': 'unwrappedPhase', 'coherence': 'coherenceMagnitude', 'components': 'connectedComponents'}.items()}
    arrays['source_mask'] = read_dataset(root['unwrappedInterferogram/mask'], (rs, cs))
    for key in ('ionospherePhaseScreen', 'ionospherePhaseScreenUncertainty'):
        if key in group:
            arrays[key] = read_dataset(group[key], (rs, cs))
    for arr in arrays.values():
        if arr.shape != arrays['phase'].shape:
            raise ValueError('Input raster grids are not aligned.')
    identification = handle['science/LSAR/identification']
    start = text_value(identification['referenceZeroDopplerStartTime'][()])[:10]
    end = text_value(identification['secondaryZeroDopplerStartTime'][()])[:10]
    if (start, end) != (info['start'], info['end']):
        raise ValueError('Catalog dates do not match original GUNW identification metadata.')
    info.update(wavelength_m=C / float(root['centerFrequency'][()]),
                native_crs=crs.to_string(), transform=list(transform)[:6],
                native_spacing=[abs(transform.a), abs(transform.e)],
                phase_sign='Earlier reference; positive phase is increasing range. LOS = -phase * wavelength / (4 pi), positive toward sensor.',
                phase_to_toward_sign=-1, original_dates_verified=True)
    return arrays, info


def extract_aria(handle, info, bbox):
    group = handle['science/grids/data']
    # ARIA v3 has coordinates in the data group, named latitude/longitude.
    x = np.asarray(group['longitude'][:], dtype=float)
    y = np.asarray(group['latitude'][:], dtype=float)
    rs, cs, transform = crop_indices(x, y, 'EPSG:4326', bbox)
    arrays = {key: read_dataset(group[name], (rs, cs)) for key, name in {
        'phase': 'unwrappedPhase', 'coherence': 'coherence', 'components': 'connectedComponents'}.items()}
    units = text_value(group['unwrappedPhase'].attrs.get('units', ''))
    if units not in ('rad', 'radians', 'radian'):
        raise ValueError('ARIA phase units must be radians.')
    wavelength = handle['science/radarMetaData/wavelength'][()]
    info.update(wavelength_m=float(np.asarray(wavelength).ravel()[0]), native_crs='EPSG:4326',
                transform=list(transform)[:6], native_spacing=[abs(transform.a), abs(transform.e)],
                phase_sign='ARIA later reference; positive phase is toward sensor. LOS = phase * wavelength / (4 pi).',
                phase_to_toward_sign=1, original_dates_verified=False)
    return arrays, info


def acquire(config, cache, offline=False):
    import earthaccess
    sources = []
    authenticated = False
    for sensor, key, collection in [('NISAR', 'nisar_pairs', 'NISAR_L2_GUNW_BETA_V1'),
                                     ('Sentinel-1', 'sentinel_pairs', 'ARIA_S1_GUNW')]:
        for selection in config[key]:
            cache_id = f"{sensor.lower()}-{selection['start']}-{selection['end']}"
            npz, metadata = cache / f'{cache_id}.npz', cache / f'{cache_id}.json'
            if npz.exists() and metadata.exists():
                print('Reusing cropped input:', cache_id, flush=True)
                with np.load(npz) as saved:
                    arrays = {name: saved[name] for name in saved.files}
                info = json.loads(metadata.read_text(encoding='utf-8'))
                if info.get('crop_bbox') != config['bbox']:
                    raise ValueError('Cached subset uses a different study box. Use a fresh cache directory.')
                if digest(npz) != info['subset_sha256']:
                    raise ValueError('Cached subset checksum mismatch.')
                sources.append((arrays, info, npz))
                continue
            if offline:
                raise FileNotFoundError(f'Missing cached input {cache_id}; run once without --offline.')
            results = remote_call(lambda: earthaccess.search_data(short_name=collection, bounding_box=tuple(config['bbox']),
                temporal=(selection['start'], selection['end']), count=200))
            if sensor == 'NISAR':
                direction = selection.get('direction', 'A')
                matches = [r for r in results if f"_{selection['track']}_{direction}_{selection['frame']}_" in r['umm']['GranuleUR']
                    and f"_{selection['start'].replace('-', '')}T" in r['umm']['GranuleUR']
                    and f"_{selection['end'].replace('-', '')}T" in r['umm']['GranuleUR']
                    and f"_{selection['release']}_" in r['umm']['GranuleUR']]
            else:
                matches = [r for r in results if r['umm']['GranuleUR'] == selection['name']]
            if len(matches) != 1:
                raise ValueError(f'Expected one exact {cache_id} product, got {len(matches)}.')
            if not authenticated:
                auth = earthaccess.login(strategy='netrc')
                if not auth.authenticated:
                    raise RuntimeError('Authenticate privately with earthaccess.login(persist=True) first.')
                authenticated = True
            selected = matches[0]
            info = source_info(selected, sensor, selection)
            print('Reading spatial subset:', info['granule_id'], flush=True)
            def read():
                stream = earthaccess.open([selected], show_progress=False)[0]
                try:
                    with h5py.File(stream, 'r') as h:
                        return (extract_nisar if sensor == 'NISAR' else extract_aria)(h, dict(info), config['bbox'])
                finally:
                    stream.close()
            arrays, info = remote_call(read)
            info['crop_bbox'] = config['bbox']
            np.savez_compressed(npz, **arrays)
            info['subset_sha256'] = digest(npz)
            write_json(metadata, info)
            sources.append((arrays, info, npz))
    return sources


def reference_and_screen(arrays, info, config):
    phase, coherence, components = (arrays[k] for k in ('phase', 'coherence', 'components'))
    if phase.shape != coherence.shape or phase.shape != components.shape:
        raise ValueError('Phase and quality grids must match.')
    transform = Affine(*info['transform'])
    yy, xx = np.indices(phase.shape)
    east = transform.c + (xx + .5) * transform.a
    north = transform.f + (yy + .5) * transform.e
    to_geo = Transformer.from_crs(info['native_crs'], 'EPSG:4326', always_xy=True)
    lon, lat = to_geo.transform(east, north)
    west, south, east_bound, north_bound = config['bbox']
    analysis = (lon >= west) & (lon <= east_bound) & (lat >= south) & (lat <= north_bound)
    valid = np.isfinite(phase) & np.isfinite(coherence) & (coherence >= config['coherence_floor']) & (coherence <= 1)
    valid &= analysis
    valid &= np.isfinite(components) & (components > 0)
    if 'source_mask' in arrays:
        mask = np.nan_to_num(arrays['source_mask'], nan=255).astype('int32')
        valid &= (mask != 255) & (mask < 100) & ((mask // 10) % 10 > 0) & (mask % 10 > 0)
    west, south, east_bound, north_bound = config['reference_bbox']
    ref_box = (lon >= west) & (lon <= east_bound) & (lat >= south) & (lat <= north_bound)
    ref = valid & ref_box
    if np.count_nonzero(ref) < 25:
        raise ValueError('Reference patch has fewer than 25 usable native pixels; do not invent a zero reference.')
    ids, counts = np.unique(components[ref], return_counts=True)
    component = float(ids[np.argmax(counts)])
    valid &= components == component
    ref &= valid
    if np.count_nonzero(ref) < 25:
        raise ValueError('Reference connected component has fewer than 25 usable pixels.')
    offset = float(np.median(phase[ref]))
    factor = info['phase_to_toward_sign'] * info['wavelength_m'] / (4 * math.pi) * 100
    los = np.where(valid, (phase - offset) * factor, np.nan).astype('float32')
    ref_spread = float(1.4826 * np.median(np.abs(los[ref] - np.median(los[ref]))))
    regions = []
    geod = Geod(ellps='WGS84')
    for region in config['regions']:
        _, _, distance = geod.inv(np.full(lon.shape, region['lon']), np.full(lat.shape, region['lat']), lon, lat)
        roi = distance <= region['radius_km'] * 1000
        rv = los[roi & valid]
        regions.append({'name': region['name'], 'valid_fraction': float(np.mean(valid[roi])) if np.any(roi) else 0,
            'pixels': int(rv.size), 'p05_cm': float(np.percentile(rv, 5)) if rv.size else None,
            'median_cm': float(np.median(rv)) if rv.size else None,
            'p95_cm': float(np.percentile(rv, 95)) if rv.size else None})
    if rasterio.crs.CRS.from_user_input(info['native_crs']).is_projected:
        areas = np.full(phase.shape, abs(transform.a * transform.e) / 1e6)
    else:
        row_areas = []
        for row in range(phase.shape[0]):
            x0, y0 = transform.c, transform.f + row * transform.e
            area, _ = geod.polygon_area_perimeter([x0,x0+transform.a,x0+transform.a,x0], [y0,y0,y0+transform.e,y0+transform.e])
            row_areas.append(abs(area)/1e6)
        areas = np.broadcast_to(np.array(row_areas)[:,None], phase.shape)
    stats = {'valid_fraction': float(np.sum(valid)/np.sum(analysis)), 'valid_pixels': int(np.sum(valid)), 'total_pixels': int(np.sum(analysis)),
             'native_envelope_pixels': int(valid.size), 'analysis_area_km2': float(np.sum(areas[analysis])),
             'assessed_area_km2': float(np.sum(areas[valid])), 'cropped_area_km2': float(np.sum(areas)),
             'median_coherence': float(np.median(coherence[valid])), 'p05_cm': float(np.percentile(los[valid], 5)),
             'p95_cm': float(np.percentile(los[valid], 95)), 'reference_pixels': int(np.sum(ref)),
             'reference_phase_radians': offset, 'reference_component': int(component), 'reference_mad_cm': ref_spread,
             'regions': regions, 'uncertainty_status': 'NOT_QUANTIFIED',
             'uncertainty_note': 'Reference MAD is spatial reference-patch dispersion, not displacement accuracy. Atmosphere, ionosphere, tides, unwrap errors and reference motion may contribute.'}
    return los, valid, stats


def geographic_grid(array, info, config):
    west, south, east, north = config['bbox']
    spacing = config['display_spacing_degrees']
    width, height = math.ceil((east-west) / spacing), math.ceil((north-south) / spacing)
    transform = from_bounds(west, south, east, north, width, height)
    dest = np.full((height, width), np.nan, dtype='float32')
    reproject(array.astype('float32'), dest, src_transform=Affine(*info['transform']), src_crs=info['native_crs'],
              src_nodata=np.nan, dst_transform=transform, dst_crs='EPSG:4326', dst_nodata=np.nan,
              resampling=Resampling.nearest)
    return dest


def json_array(array, digits=3):
    values = np.round(array.astype(float), digits).ravel()
    return [float(v) if np.isfinite(v) else None for v in values]


def save_tiff(path, array, info):
    with rasterio.open(path, 'w', driver='GTiff', width=array.shape[1], height=array.shape[0], count=1,
                       dtype='float32', crs=info['native_crs'], transform=Affine(*info['transform']),
                       nodata=np.nan, compress='deflate', predictor=3) as dst:
        dst.write(array.astype('float32'), 1)


def save_overlay(path, array, kind, limit):
    normalized = np.clip((array + limit) / (2 * limit), 0, 1) if kind == 'los' else np.clip(array, 0, 1)
    colors = colormaps['RdBu' if kind == 'los' else 'gray'](np.nan_to_num(normalized, nan=0), bytes=True)
    # Keep the basemap legible below near-zero LOS values while retaining a visible,
    # distinct mask: transparent pixels remain strictly unassessed.
    alpha = 180 if kind == 'los' else 220
    colors[:, :, 3] = np.where(np.isfinite(array), alpha, 0).astype('uint8')
    Image.fromarray(colors).save(path)


def publish(sources, config, output, version):
    target = output / config['id'] / version
    if target.exists():
        raise FileExistsError(f'Publication {version} exists. Choose a new --version; publications are immutable.')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='volcano-', dir=target.parent) as temporary:
        folder = Path(temporary)
        pairs, grids = [], {}
        for arrays, info, subset_path in sources:
            pair_id = f"{info['sensor'].lower()}-{info['start']}-{info['end']}"
            pair_folder = folder / pair_id
            pair_folder.mkdir()
            los, valid, stats = reference_and_screen(arrays, info, config)
            geo_los = geographic_grid(los, info, config)
            geo_coherence = geographic_grid(arrays['coherence'], info, config)
            geo_phase = geographic_grid(np.where(valid, arrays['phase'], np.nan), info, config)
            geo_components = geographic_grid(np.where(valid, arrays['components'], np.nan), info, config)
            geo_valid = np.isfinite(geo_los)
            grid = {'schema_version': 1, 'width': geo_los.shape[1], 'height': geo_los.shape[0],
                    'bbox': config['bbox'], 'sampling': 'EPSG:4326 nearest-neighbor view of native raster; probe is a published display sample',
                    'los_cm': json_array(geo_los), 'coherence': json_array(geo_coherence),
                    'phase_radians': json_array(geo_phase), 'component': json_array(geo_components, 0)}
            (pair_folder / 'grid.json').write_text(json.dumps(grid, separators=(',', ':'), allow_nan=False), encoding='utf-8')
            save_overlay(pair_folder / 'los.png', geo_los, 'los', config['display_limit_cm'])
            save_overlay(pair_folder / 'coherence.png', geo_coherence, 'coherence', config['display_limit_cm'])
            save_overlay(pair_folder / 'assessed.png', np.where(geo_valid, 1., np.nan), 'coherence', 1)
            for key, values in {**arrays, 'los_cm': los, 'assessed': valid.astype('float32')}.items():
                save_tiff(pair_folder / f'{key}.tif', values, info)
            shutil.copy2(subset_path, pair_folder / 'source-subset.npz')
            write_json(pair_folder / 'source.json', info)
            pairs.append({'id': pair_id, **info, 'statistics': stats, 'grid': f'{pair_id}/grid.json',
                          'los_image': f'{pair_id}/los.png', 'coherence_image': f'{pair_id}/coherence.png',
                          'assessed_image': f'{pair_id}/assessed.png', 'los_download': f'{pair_id}/los_cm.tif'})
            grids[pair_id] = (geo_los, geo_valid)
        event = next(pair for pair in pairs if pair['sensor']=='NISAR' and pair['start']<=config['event_date']<=pair['end'])
        comparisons = []
        for pair in pairs:
            if pair['sensor'] != 'Sentinel-1':
                continue
            valid_n = grids[event['id']][1]
            valid_s = grids[pair['id']][1]
            common = valid_n & valid_s
            common_fraction = float(np.mean(common))
            comparisons.append({'nisar_id': event['id'], 'sentinel_id': pair['id'],
                'status': 'CROSS_SENSOR_CONTEXT' if common_fraction >= .2 else 'INCONCLUSIVE_COVERAGE',
                'common_valid_fraction': common_fraction, 'common_valid_pixels': int(np.sum(common)),
                'start_offset_days': (datetime.fromisoformat(pair['start'])-datetime.fromisoformat(event['start'])).days,
                'end_offset_days': (datetime.fromisoformat(pair['end'])-datetime.fromisoformat(event['end'])).days,
                'interpretation': 'Different time intervals and left/right viewing geometry. Compare spatial patterns and regional ranges; do not use LOS differences as accuracy, uplift, or eruption causation.'})
        study = {'schema_version': 1, 'id': config['id'], 'hazard_type': 'volcanic_deformation', 'title': config['title'],
                 'publication_version': version, 'method_version': METHOD, 'created_at': datetime.now(timezone.utc).isoformat(),
                 'run_completion': 'COMPLETE', 'scientific_interpretation': 'PHASE_DERIVED_LOS_CANDIDATES',
                 'event_date': config['event_date'], 'event_context': config.get('event_context'),
                 'reference_availability': config.get('reference_availability', 'AVAILABLE'),
                 'bbox': config['bbox'], 'boundary_source': config['boundary_source'],
                 'reference_bbox': config['reference_bbox'], 'reference_note': config['reference_note'],
                 'coherence_floor': config['coherence_floor'], 'display_limit_cm': config['display_limit_cm'],
                 'display_scale_note': f"LOS preview PNGs use one fixed symmetric ±{config['display_limit_cm']} cm color stretch for all pairs. Preview colors saturate outside that range; native GeoTIFF values and statistics are unchanged. Light center colors indicate values near zero; transparent pixels are unassessed.",
                 'regions': config['regions'], 'pairs': pairs, 'comparisons': comparisons,
                 'default_pair_id': event['id'], 'corrections': {'ionosphere': 'NOT_APPLIED', 'troposphere': 'NOT_APPLIED', 'solid_earth_tides': 'NOT_APPLIED'},
                 'limitations': ['Apparent LOS change includes deformation and remaining propagation/orbit/DEM/unwrapping errors.',
                    'Each pair is separately referenced, not a cumulative time series. Positive cm points toward the sensor.',
                    'Only the component connected to the assumed-stable reference patch is interpreted.',
                    'Coherence is a quality indicator, not a confidence percentage. No per-pixel accuracy estimate is available.',
                    'Sentinel-1 comparisons are complementary views with different intervals, not deformation ground truth.'],
                 'method_source_sha256': digest(Path(__file__)), 'config_sha256': hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()}
        write_json(folder/'study.json', study)
        write_json(folder/'method-config.json', config)
        shutil.copy2(Path(__file__), folder/'volcano_pipeline.py')
        for name in ('network_retry.py', 'requirements.txt'):
            shutil.copy2(Path(__file__).with_name(name), folder/name)
        write_json(folder/'evidence-card.json', {
            'hazard_type': 'volcanic_deformation', 'study_id': config['id'],
            'publication_version': version, 'method_version': METHOD,
            'run_completion': 'COMPLETE', 'reference_availability': config.get('reference_availability', 'AVAILABLE'),
            'scientific_interpretation': 'PHASE_DERIVED_LOS_CANDIDATES',
            'boundary_source': config['boundary_source'], 'observations': 'study.json',
            'comparison': 'study.json#comparisons', 'method': 'volcano_pipeline.py',
            'configuration': 'method-config.json', 'downloads': 'evidence.zip',
            'context_sources': config.get('context_sources', [
                'https://nisar-docs.asf.alaska.edu/gunw/',
                'https://hyp3-docs.asf.alaska.edu/guides/gunw_product_guide/',
                'https://volcano.si.edu/showreport.cfm?wvar=GVP.WVAR20251126-221091']),
            'interpretation_note': 'Different sensor geometry and date windows prevent direct accuracy scoring or a vertical/3D inversion. Event reports are context only.'})
        (folder/'README.txt').write_text('Beyonders volcanic phase evidence package\nMethod: '+METHOD+'\nRead study.json for dates, original products, masks, reference, conventions and limitations.\nNative cropped source layers and relative LOS GeoTIFFs are included. Source-subset.npz contains actual spatially cropped official phase/coherence/component data, not full SLC scenes.\nPublished grids are nearest-neighbor WGS84 views; null means unassessed. No atmospheric/ionospheric/tide correction is applied.\nNo volcanic prediction or attribution of every phase feature to eruption.\nReproduce in a Beyonders checkout: install pipeline/requirements.txt, copy each pair source-subset.npz to pipeline/output/volcano-inputs/'+config['id']+'/PAIR_ID.npz and source.json to PAIR_ID.json; run python pipeline/volcano_pipeline.py --offline --config method-config.json --version NEW_VERSION. See docs/operator-guide.md and docs/volcano-method.md in the repository.\n', encoding='utf-8')
        files = sorted(p for p in folder.rglob('*') if p.is_file())
        write_json(folder/'checksums.json', {p.relative_to(folder).as_posix(): digest(p) for p in files})
        with zipfile.ZipFile(folder/'evidence.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for p in sorted(folder.rglob('*')):
                if p.is_file() and p.name != 'evidence.zip':
                    archive.write(p, p.relative_to(folder))
        shutil.move(str(folder), str(target))
    write_json(target.parent/'index.json', {'schema_version':1, 'id':config['id'], 'version':version,
                'study_url': f'/volcanoes/{config["id"]}/{version}/study.json',
                'evidence_url': f'/volcanoes/{config["id"]}/{version}/evidence.zip', 'sha256':digest(target/'study.json')})
    print('Published:', target, flush=True)
    print('Reference patch dispersion and cross-sensor context:', json.dumps([{'id':p['id'],'coverage':p['statistics']['valid_fraction'],'reference_mad_cm':p['statistics']['reference_mad_cm']} for p in pairs]), flush=True)
    return study


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('volcano_hayli_gubbi.json'))
    parser.add_argument('--version', required=True)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}', args.version) or args.version in ('.', '..'):
        parser.error('Invalid publication version.')
    config = json.loads(args.config.read_text(encoding='utf-8'))
    cache = ROOT/'pipeline/output/volcano-inputs'/config['id']
    cache.mkdir(parents=True, exist_ok=True)
    sources = acquire(config, cache, args.offline)
    publish(sources, config, ROOT/'public/volcanoes', args.version)


if __name__ == '__main__':
    main()
