Beyonders volcanic phase evidence package
Method: gunw-relative-los-1.0.1
Read study.json for dates, original products, masks, reference, conventions and limitations.
Native cropped source layers and relative LOS GeoTIFFs are included. Source-subset.npz contains actual spatially cropped official phase/coherence/component data, not full SLC scenes.
Published grids are nearest-neighbor WGS84 views; null means unassessed. No atmospheric/ionospheric/tide correction is applied.
No volcanic prediction or attribution of every phase feature to eruption.
Reproduce in a Beyonders checkout: install pipeline/requirements.txt, copy each pair source-subset.npz to pipeline/output/volcano-inputs/kilauea-episode-36-2025/PAIR_ID.npz and source.json to PAIR_ID.json; run python pipeline/volcano_pipeline.py --offline --config method-config.json --version NEW_VERSION. See docs/operator-guide.md and docs/volcano-method.md in the repository.
