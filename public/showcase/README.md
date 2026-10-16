# Featured Case (public showcase assets)

Put compact, **derived** assets of ONE completed real NISAR run here so the deployed site works with no Python, no Earthdata login and no local `pipeline/output/runs/`.

```bash
# from the repo root, inside the pipeline virtualenv, with your saved real run id
python pipeline/export_showcase.py --run-id <32-hex-run-id>      # writes public/showcase/featured/
git add public/showcase && git commit -m "Add featured NISAR showcase"
```

The exporter refuses simulated/incomplete runs, strips absolute paths, never copies raw HDF5/GeoTIFF or credentials, rounds coordinates, and respects an 8 MB budget (`--max-mb`).
Until `public/showcase/featured/manifest.json` exists the app opens the clearly labelled INTERACTIVE SANDBOX (deterministic simulation).

## Legacy runs (loose `last_attempt.json` layout)
`export_showcase.py` detects them automatically (or pass `--legacy-dir`). Only artifacts that verify against the run manifest are exported; anything else is skipped and the reason is stored in `manifest.json` under `legacy.skipped`. Nothing is reconstructed, interpolated or copied from raw rasters.
