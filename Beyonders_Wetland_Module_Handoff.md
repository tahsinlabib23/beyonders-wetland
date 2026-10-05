# Beyonders — Wetland Module
## Complete Technical Handoff for the NISAR Wetland / Inundation Workstream

**Project:** Beyonders — Dancing with the SARs  
**Module:** Wetland Inundation Dynamics + Flooded Vegetation  
**Status:** Preparation / engineering handoff  
**Primary NISAR product:** `NISAR_L2_GCOV_PROVISIONAL_V1`

---

# 0. What you are building

This is **not** a generic flood map.

The wetland module should answer:

> **How does a wetland fill, expand, peak, recede, and change through time, including areas where vegetation makes inundation difficult to observe?**

The module must use real NISAR observations and produce reproducible, interactive results.

### Core workflow

```text
Real NISAR GCOV products
        ↓
Product inspection / validation
        ↓
Extract compatible polarization layers
        ↓
Quality + mask filtering
        ↓
Before/after + multi-date analysis
        ↓
Candidate inundation detection
        ↓
Spatial cleanup
        ↓
Temporal aggregation
        ↓
Wetland Pulse metrics
        ↓
Validation / evidence tests
        ↓
Maps + charts + Evidence Card
```

---

# 1. Why GCOV

NASA/ASF describes GCOV (Geocoded Polarimetric Covariance) as a Level-2 product containing calibrated backscatter measurements corrected for radiometric and terrain distortions and provided as gamma-0 power. GCOV products are geocoded and normally have 10 m or 20 m pixel spacing, depending on acquisition location, and can be used directly in geospatial workflows.

GCOV is the primary NISAR measurement for this module. Its grid spacing is **10 m, 20 m, or 80 m**, depending on acquisition bandwidth and frequency; do not assume every scene is 10–20 m. Always read the scene's actual grid and CRS before calculating area or comparing pixels.

Official documentation:

- https://nisar-docs.asf.alaska.edu/gcov/
- https://nisar-docs.asf.alaska.edu/products-overview/
- https://nisar-docs.asf.alaska.edu/data-format/

For this module, **GCOV is the primary NISAR measurement**.

We are deliberately starting with a Level-2 geocoded product rather than raw SAR processing.

---

# 2. Data access

## Earthdata + Earthaccess

Create a NASA Earthdata Login first.

Install:

```bash
pip install earthaccess
```

Example search:

```python
import earthaccess

earthaccess.login()

results = earthaccess.search_data(
    short_name="NISAR_L2_GCOV_PROVISIONAL_V1",
    count=10
)

for result in results:
    print(result)
```

Earthaccess can refine the search by temporal bounds and geographic geometry.

Official guide:

https://nisar-docs.asf.alaska.edu/earthaccess/

### Alternative: Vertex

GCOV products can also be found in ASF Vertex by selecting:

```text
Dataset: NISAR
Science Product: GCOV
```

Official guide:

https://nisar-docs.asf.alaska.edu/vertex/

### Data maturity

As of **October 3, 2026**, public L-band NISAR products include both earlier **BETA** data and **PROVISIONAL** data. PROVISIONAL acquisitions currently start on June 17, 2026; ASF documents a data gap from July 27 through August 10, 2026. BETA and PROVISIONAL products have different processing maturity and should not be combined in one time series without an explicit compatibility analysis. Every project result must identify the maturity level and scene provenance.

Official availability page:

https://nisar-docs.asf.alaska.edu/availability-overview/

---

# 3. HDF5 structure

NISAR standard products are HDF5 files.

Typical GCOV datasets look like:

```text
/science/LSAR/GCOV/grids/frequencyA/HHHH
/science/LSAR/GCOV/grids/frequencyA/HVHV
/science/LSAR/GCOV/grids/frequencyA/numberOfLooks
/science/LSAR/GCOV/grids/frequencyA/mask
```

The exact layers depend on the acquisition mode.

### First task after downloading a file

Inspect it instead of guessing.

```python
import h5py

with h5py.File("product.h5", "r") as f:
    def show(name, obj):
        if isinstance(obj, h5py.Dataset):
            print(name, obj.shape, obj.dtype)

    f.visititems(show)
```

Create a scene inventory containing:

- filename
- acquisition start/end time
- track / relative orbit where available
- frame where available
- orbit direction (ascending/descending)
- frequency
- available polarization datasets
- array dimensions
- units
- fill values
- mask
- projection
- coordinate arrays / geotransform metadata
- number of looks
- relevant quality metadata

Official references:

- https://nisar-docs.asf.alaska.edu/data-format/
- https://nisar-docs.asf.alaska.edu/gcov/

---

# 4. Never assume HH/HV exist

GCOV can contain several covariance terms depending on acquisition mode.

Common diagonal terms include:

```text
HHHH
HVHV
VVVV
VHVH
```

Off-diagonal terms may be complex-valued and are not available in all acquisition modes.

### Preferred first configuration

For a wetland study, **HH + HV** is a strong starting point when the actual scene provides those channels.

### Hard rule

If a selected scene does not contain HH/HV:

1. inspect what it actually provides;
2. adapt the scientific method to that configuration;
3. document the change.

**Never fabricate or synthetically infer a missing channel just to make the UI fit the plan.**

---

# 5. Scientific basis

There are two important wetland radar cases.

## A. Open-water inundation

Smooth open water often returns relatively little energy to a side-looking SAR sensor, producing comparatively low backscatter in many conditions.

## B. Inundated vegetation

Water beneath vegetation can alter the scattering mechanism. In appropriate vegetation/geometry conditions, water + trunks/stems can produce enhanced co-polarized returns through double-bounce behavior.

Therefore a wetland change workflow can investigate both:

```text
open-water candidate
vegetated-inundation candidate
uncertain
```

### Scientific caution

Radar response is affected by vegetation structure, soil moisture, surface roughness, viewing geometry, acquisition mode and other factors.

Therefore:

> **A radar backscatter change is evidence of a change in radar scattering, not automatic proof of flooding.**

For this reason, all thresholds and interpretations must be calibrated and validated for the selected study area.

Relevant research includes recent work on L-band radar for flooded vegetation and wetland inundation dynamics.

---

# 6. First MVP

Do not start with machine learning.

The first successful pipeline is:

```text
NISAR GCOV date A
        +
NISAR GCOV date B
        ↓
same wetland
        ↓
compatible acquisition setup
        ↓
co-registered / common geographic grid
        ↓
backscatter change
        ↓
candidate inundation map
```

Then calculate:

- candidate inundated area
- wetland affected fraction
- spatial distribution
- valid-data fraction
- before/after statistics

### Success criterion

> **From real NISAR data, produce a believable wetland-change map with reproducible processing and explainable statistics.**

Everything else comes after this.

---

# 7. Selecting the study area

The final site must be chosen after checking actual NISAR availability.

Good candidate categories include:

### Bangladesh

- Hakaluki Haor
- Tanguar Haor
- Sundarbans / adjacent tidal wetlands
- coastal tidal wetlands
- major floodplain wetlands

### Outside Bangladesh

- tropical wetland/floodplain with known inundation dynamics
- a site with several compatible NISAR acquisitions

## Selection checklist

Choose a site only when you have:

1. multiple NISAR GCOV observations;
2. compatible acquisition geometry;
3. useful polarization data;
4. a meaningful wet/dry or changing-inundation contrast;
5. an independent context/validation source.

**Do not choose a site because it simply looks good on a map.**

---

# 8. Date selection

## Minimum

```text
Date A = baseline / dry / pre-event
Date B = changed / inundated
```

## Preferred

```text
Date 1
Date 2
Date 3
Date 4
...
```

The ideal story is:

```text
onset → expansion → peak → recession
```

This is what allows the Wetland Pulse feature to become more than a before/after flood map. Check actual archive coverage first: the current PROVISIONAL record begins June 17, 2026, and the documented July 27–August 10, 2026 data gap interrupts the expected cadence. Do not fill missing dates with simulated values.

---

# 9. Keep acquisition conditions comparable

When possible, keep these consistent:

- orbit direction
- track
- frame
- frequency
- polarization
- acquisition mode
- processing type

Randomly comparing two scenes can introduce radiometric or geometric differences that look like environmental change.

### Rule

Before comparing scenes, create a **comparison compatibility record**:

```text
scene_A
scene_B

orbit compatible?       YES/NO
track compatible?       YES/NO
mode compatible?        YES/NO
frequency compatible?   YES/NO
polarization compatible? YES/NO
projection compatible? YES/NO
```

If something differs, either correct for it appropriately or downgrade the confidence of the comparison.

---

# 10. Backscatter representation

GCOV diagonal terms are radar backscatter power values.

You may work in linear power or convert to dB.

For positive power:

```text
dB = 10 * log10(power)
```

Two common temporal features are:

```text
ΔdB = dB_after - dB_before
```

and

```text
ratio = P_after / P_before
```

Pick one primary convention for the module and document it.

### Important

Do not silently mix gamma-0 and sigma-0 conventions. GCOV includes a documented `rtcGammaToSigmaFactor`; if you perform a conversion, record the exact method.

For a first MVP, same-product, like-for-like comparisons in the native GCOV convention are simpler.

---

# 11. Initial inundation detector

Start with a transparent, interpretable rule.

Conceptually:

```text
candidate_inundation =
    temporal_change_condition
    AND valid_quality
    AND wetland_mask
```

For vegetated inundation, investigate a multi-feature rule such as:

```text
ΔHH
+
ΔHV
+
HH/HV relationship
+
vegetation context
```

A starting hypothesis may be:

```text
strong co-pol change
+
limited cross-pol change
+
vegetated wetland context
=
possible vegetated inundation
```

This is a **hypothesis**, not a universal physical law or universal threshold.

### Thresholds

Start with a range, not one magic value.

For example, explore several candidate change thresholds and tune them against known wet/dry areas.

Do not publish a threshold as final until it has been tested.

---

# 12. Wetland and vegetation masks

Create an explicit study-area mask.

Possible context layers:

- ESA WorldCover
- JRC Global Surface Water
- local wetland polygons
- manually defined wetland AOI

Recommended conceptual masks:

```text
study wetland boundary
        +
vegetation / tree mask
        +
built-up exclusion
        +
permanent-water exclusion where appropriate
```

### Why

Buildings, roads, permanent water and vegetation can produce radar signatures that confuse a naive change detector.

NISAR remains the primary scientific measurement; auxiliary layers should provide context or validation.

---

# 13. Quality filtering

Before any change calculation, filter invalid measurements.

At minimum consider:

```text
finite value?
valid product mask?
not fill value?
acceptable number of looks?
acceptable geometry / quality flags?
```

Use the actual GCOV documentation and metadata to interpret the mask; do not invent your own meaning for a mask value.

Create an explicit quality output:

```text
valid_mask.tif
```

and compute:

```text
valid_fraction = valid_pixels / total_pixels
```

This should appear in the Evidence Card.

---

# 14. Spatial cleanup

Thresholding may create isolated speckles:

```text
██  ███
  █
████████
    ██
 █
```

Use connected-component analysis to remove tiny regions **only when scientifically justified**.

Store the minimum-region rule in configuration and metadata.

Do not remove pixels merely because the final map looks nicer.

---

# 15. Temporal consistency

This is a core Beyonders feature.

Compare the same region through time.

Example:

```text
Region #12

Jun   LOW
Jul   MEDIUM
Aug   HIGH
Sep   HIGH
Oct   MEDIUM
Nov   LOW
```

This becomes the **Wetland Pulse**.

A recurring spatial signal is generally more informative than a single isolated observation, although persistence still must be interpreted in the context of the acquisition and phenomenon.

---

# 16. Wetland Pulse metrics

For each wetland or region, calculate:

## 16.1 Inundated area

```text
A(t) = number_of_candidate_pixels × pixel_area
```

## 16.2 Inundation fraction

```text
fraction(t) = inundated_area(t) / wetland_area
```

## 16.3 Onset date

First date at which a defined inundation condition is reached.

## 16.4 Peak

Date and magnitude of maximum inundation.

## 16.5 Recession duration

Time from peak until the selected return condition is reached.

## 16.6 Expansion rate

```text
(A2 - A1) / (t2 - t1)
```

## 16.7 Recession rate

Same idea during drying/recession.

## 16.8 Spatial persistence

How much of the same region remains flagged across multiple observations.

---

# 17. Vegetated-inundation layer

Separate the outputs:

```text
OPEN WATER CANDIDATE
VEGETATED INUNDATION CANDIDATE
UNCERTAIN
```

Do not automatically label a forested pixel as flooded.

Use careful wording:

> **Radar signature is consistent with potential vegetated inundation under the calibrated detection criteria.**

This is much safer than claiming that the satellite has directly proven water beneath every tree.

---

# 18. Validation

A high-quality module needs an independent comparison.

Potential sources:

### OPERA / Sentinel-1 products
Useful as an independent C-band comparison.

### Optical imagery
Useful where clouds and timing allow.

### JRC Global Surface Water
Useful for longer-term water context.

### Local flood reports / event records
Useful as event context.

### Field measurements
Best when available, but not required for a hackathon prototype.

## Validation concept

```text
NISAR-derived result
        vs
independent reference
        ↓
agreement metrics
```

Possible metrics:

- IoU
- precision
- recall
- F1
- area difference
- temporal correlation

Choose a metric that actually matches the reference data.

### Do not call an external model "ground truth" unless it really represents ground truth.

For example, agreement with a C-band flood map should be described as **agreement with that C-band product**, not as proof that the NISAR result is correct.

---

# 19. SAR confounders you must understand

Before interpreting a signal, consider:

1. vegetation structure
2. vegetation moisture
3. soil moisture
4. surface roughness
5. incidence angle
6. orbit direction
7. acquisition mode
8. polarization
9. speckle/statistical variability
10. permanent water
11. buildings and infrastructure
12. shadow / layover / geometry
13. seasonal land-cover changes

This is the scientific reason the Beyonders forensics layer exists.

---

# 20. Beyonders forensic tests

Every interesting wetland candidate should eventually pass through:

## Test A — Quality

Are the pixels valid?

## Test B — Spatial consistency

Does the change form a meaningful contiguous region?

## Test C — Threshold sensitivity

Does the result remain reasonably stable when the threshold changes within a justified range?

## Test D — Temporal consistency

Does the signal behave plausibly across multiple observations?

## Test E — Alternative explanations

Could soil moisture, seasonal vegetation, permanent water, acquisition geometry or another factor plausibly explain the signal?

The output is not simply "true/false". Use states such as:

```text
SUPPORTED
MODERATE
UNCERTAIN
REJECTED
```

until your final wording is defined from the actual validation results.

---

# 21. Counterfactual Lab

This is one of the signature Beyonders interactions.

The user can change a detection assumption and immediately see the effect.

Example:

```text
Change threshold
0.5 dB ───────●─────── 5 dB
```

Display a table:

```text
Threshold       Area
0.5 dB          21.3 km²
1.0 dB          18.4 km²
1.5 dB          17.9 km²
2.0 dB          17.4 km²
2.5 dB          17.2 km²
```

Then a derived status such as:

```text
RESULT STABLE
```

or

```text
RESULT SENSITIVE
```

The status should come from an explicitly defined rule, not a hand-written visual label.

---

# 22. Region-based analysis

The final product should focus on **candidate patches**, not only individual pixels.

For each patch store:

```text
Patch ID
Area
Mean change
Median change
Valid-pixel fraction
Vegetated fraction
Temporal persistence
Threshold stability
Quality status
Evidence status
```

This will make the web UI much easier to understand.

---

# 23. Suggested JSON data model

A candidate region could look like:

```json
{
  "id": "wetland_patch_012",
  "date": "2026-07-18",
  "area_km2": 3.42,
  "mean_delta_db": 2.18,
  "median_delta_db": 1.94,
  "valid_fraction": 0.91,
  "vegetated_fraction": 0.67,
  "quality_status": "PASS",
  "spatial_status": "PASS",
  "temporal_status": "PARTIAL",
  "threshold_stability": "STABLE",
  "evidence_state": "MODERATE"
}
```

The values above are examples only.

---

# 24. Recommended processing repository structure

```text
wetland/
├── raw/
│   ├── scene_A.h5
│   └── scene_B.h5
│
├── metadata/
│   ├── scene_inventory.json
│   └── processing_metadata.json
│
├── rasters/
│   ├── before_hh.tif
│   ├── before_hv.tif
│   ├── after_hh.tif
│   ├── after_hv.tif
│   ├── delta_hh.tif
│   ├── delta_hv.tif
│   ├── wetland_mask.tif
│   ├── vegetation_mask.tif
│   ├── valid_mask.tif
│   └── inundation_candidates.tif
│
├── regions/
│   ├── patches.geojson
│   └── patch_statistics.csv
│
├── timeseries/
│   └── wetland_pulse.json
│
├── validation/
│   ├── reference_layer.tif
│   └── validation_metrics.json
│
└── figures/
    ├── before.png
    ├── after.png
    ├── change.png
    └── wetland_pulse.png
```

Raw NISAR files can be kept locally and excluded from Git when appropriate; document their public source, filename and access method instead of duplicating large archives in the repository.

---

# 25. Frontend structure

The wetland page should eventually look roughly like:

```text
┌──────────────────────────────────────────────────────┐
│ BEYONDERS — WETLAND PULSE                           │
├──────────────────────────────────────────────────────┤
│                  INTERACTIVE MAP                    │
│                                                      │
│             NISAR change layer                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│ TIME                                                 │
│ Jun ────────●────────────── Nov                     │
├───────────────────────┬──────────────────────────────┤
│ WETLAND PULSE         │ EVIDENCE                    │
│                       │                             │
│ Area(t) chart         │ Quality       ✓             │
│                       │ Spatial       ✓             │
│                       │ Temporal      ?             │
│                       │ Threshold     ✓             │
├───────────────────────┴──────────────────────────────┤
│             [ INVESTIGATE THIS REGION ]              │
└──────────────────────────────────────────────────────┘
```

---

# 26. Core interactions

## 26.1 Date scrubber

Drag through observations and update the map/chart together.

## 26.2 Before / After / Difference

Provide:

```text
BEFORE
AFTER
DIFFERENCE
```

A draggable split-view is useful, but don't copy NASA Worldview feature-for-feature.

## 26.3 SAR Probe

Click a point and show:

```text
latitude
longitude
HH
HV
ΔHH
ΔHV
validity
acquisition date
```

## 26.4 Wetland Pulse

Show area or affected fraction through time.

## 26.5 Vegetated-inundation toggle

```text
Open water
Vegetated candidate
Uncertain
```

## 26.6 Try to Break This Result

Open the Counterfactual Lab from a selected region.

---

# 27. Wetland hero visualization

The main visual should be an animated inundation boundary / change layer driven by real observations.

Concept:

```text
DRY
██████████████████

ONSET
██████████████████
~~~~

PEAK
██████████████████
~~~~~~~~~~~~

RECESSION
██████████████████
~~~~~~
```

The animation must represent actual data changes, not decorative motion.

---

# 28. Evidence Card

A selected region should eventually produce something like:

```text
╔════════════════════════════════════╗
║       WETLAND EVIDENCE CARD        ║
╠════════════════════════════════════╣
║ Region: Patch 12                   ║
║ Date: 18 Jul 2026                  ║
║                                    ║
║ Candidate inundation:  3.42 km²    ║
║ Valid data:             91%        ║
║                                    ║
║ Quality:                PASS       ║
║ Spatial consistency:   PASS       ║
║ Threshold stability:   PASS       ║
║ Temporal evidence:     PARTIAL    ║
║                                    ║
║ Vegetated-inundation signal:      ║
║ POTENTIAL                          ║
║                                    ║
║ Evidence strength: MODERATE       ║
╚════════════════════════════════════╝
```

Again, example values only.

---

# 29. Observed / Derived / Contextual / Potential labels

Use four categories throughout the project.

## OBSERVED

Directly measured/read from NISAR.

Examples:

```text
HH backscatter
HV backscatter
acquisition date
product metadata
```

## DERIVED

Calculated by your code.

Examples:

```text
ΔHH
inundated area
expansion rate
persistence
```

## CONTEXTUAL

External information used to interpret the NISAR measurement.

Examples:

```text
wetland boundary
rainfall
population
land cover
```

## POTENTIAL

An interpretation or hypothesis that requires evidence.

Examples:

```text
potential vegetated inundation
potential flood-related radar change
```

Never blur these categories.

---

# 30. AI policy for the module

Do not make AI the main scientific detector.

Avoid:

```text
NISAR → black-box AI → "FLOOD"
```

For the first version, transparent rules + statistics are preferable because the method can be inspected and tested.

AI can later help with:

- natural-language explanations of computed metrics
- summarizing an Evidence Card
- answering questions using already validated project data
- clustering candidate regions, if validated

If AI is used, document:

- model/tool
- purpose
- prompt
- input data
- output
- how the team checked the output

---

# 31. Validation experiment

Use a simple controlled evaluation.

Possible design:

```text
known wet areas
known dry areas
ambiguous areas
```

Run the detector.

Build a confusion matrix where the reference actually supports one.

Then report suitable metrics such as:

```text
precision
recall
F1
IoU
```

For area-overlap validation:

```text
IoU = intersection / union
```

For binary classification against a suitable reference:

```text
precision = TP / (TP + FP)
recall    = TP / (TP + FN)
F1        = 2PR / (P + R)
```

Only report metrics that match the reference data and the unit of analysis.

---

# 32. Recommended Python stack

Start with:

```text
Python
├── earthaccess
├── h5py
├── numpy
├── scipy
├── pandas
├── matplotlib
├── rasterio
├── geopandas
├── shapely
└── pyproj
```

Optional later:

```text
xarray
dask
scikit-learn
```

Do not add large dependencies until a real need appears.

---

# 33. Suggested code modules

```text
wetland/
├── config.py
├── search_nisar.py
├── inspect_gcov.py
├── extract_gcov.py
├── preprocess.py
├── detect_inundation.py
├── detect_vegetated_inundation.py
├── spatial_analysis.py
├── temporal_analysis.py
├── threshold_sensitivity.py
├── validation.py
├── generate_outputs.py
└── main.py
```

---

# 34. Configuration instead of hardcoding

Example:

```yaml
site:
  name: "YOUR_WETLAND"
  bbox:
    min_lon: 0
    min_lat: 0
    max_lon: 0
    max_lat: 0

nisar:
  product: "NISAR_L2_GCOV_PROVISIONAL_V1"
  frequency: "frequencyA"
  preferred_polarizations:
    - "HHHH"
    - "HVHV"

processing:
  minimum_valid_fraction: 0.70
  minimum_region_pixels: 25
  starting_delta_db: 2.0

validation:
  use_reference: true
```

All threshold values here are examples, not universal scientific constants.

---

# 35. Recommended Week 1 objective

The first week is **data feasibility + first map**.

### Day 1–2

- Earthdata login
- install environment
- search GCOV
- download one real scene
- inspect HDF5

### Day 3

- identify valid polarization layers
- inspect metadata
- open in QGIS
- verify geographic footprint

### Day 4

- find a second compatible observation
- confirm temporal and acquisition compatibility

### Day 5

- extract a small AOI
- generate before/after rasters
- calculate a difference

### Day 6

- apply a preliminary wetland mask
- run a simple candidate detector

### Day 7

Produce:

```text
before.png

after.png

difference.png

candidate_inundation.png
```

If this works, the wetland module has a viable scientific foundation.

---

# 36. Week 2 objective

Add:

- multiple dates
- Wetland Pulse
- region statistics
- threshold sensitivity
- spatial cleanup
- validation

Target data output:

```text
Date       Area km²   Mean change
----------------------------------
Jun 18       ...         ...
Jun 30       ...         ...
Jul 12       ...         ...
Jul 24       ...         ...
Aug 05       ...         ...
Aug 17       ...         ...
```

Use actual computed values in the project.

---

# 37. Week 3 objective

Connect the wetland science output to the common Beyonders engine:

```text
wetland result
      ↓
quality
      ↓
spatial consistency
      ↓
temporal consistency
      ↓
threshold sensitivity
      ↓
Evidence Card
```

---

# 38. Week 4 objective

Build the polished product layer:

- interactive map
- time scrubber
- before/after comparison
- difference mode
- SAR Probe
- Wetland Pulse chart
- vegetated-inundation layer
- Counterfactual Lab
- Evidence Card
- provenance panel
- validation panel

---

# 39. Definition of DONE

The wetland module is done when a judge can:

1. Select a real wetland.
2. See real NISAR observations.
3. Move through multiple acquisition dates.
4. See a NISAR-derived inundation/change layer.
5. See affected area.
6. See the Wetland Pulse.
7. Inspect potential vegetated-inundation areas.
8. Click a region and inspect the underlying values.
9. Change a detection assumption.
10. Watch the result update.
11. See whether the detection is robust or sensitive.
12. See validation information.
13. See what came directly from NISAR versus what was derived/contextual.
14. Read the Evidence Card.
15. Understand the method's limitations.

---

# 40. What NOT to build first

## Do not start with deep learning

You will spend too much time on data labeling, training and tuning.

## Do not try to monitor every wetland on Earth

One or a few strong case studies are better.

## Do not start with real-time flood alerts

They add operational complexity and validation burden that the challenge does not require.

## Do not build a generic NISAR dashboard

NASA already has large-scale Earth-data visualization tools.

## Do not start with a chatbot

The scientific wetland engine must work first.

## Do not polish animations before the science works

The correct order is:

```text
real data → processing → validation → UI polish
```

---

# 41. What NOT to claim

Never write:

> "NISAR proves this location is flooded."

Prefer:

> "NISAR-derived radar change is consistent with candidate inundation under the stated detection criteria."

Never write:

> "This definitely means water is under trees."

Prefer:

> "The radar signature is consistent with potential vegetated inundation under the calibrated criteria."

Never write:

> "Our threshold proves the method is correct."

Prefer:

> "The result remained stable across the tested threshold range."

Never call another satellite product ground truth unless it actually is an appropriate ground-truth reference.

---

# 42. Practical technical traps

### Trap 1 — Random scene pairing

**Fix:** Keep acquisition geometry and configuration comparable.

### Trap 2 — Ignoring units

**Fix:** Read metadata and preserve units in every output.

### Trap 3 — Ignoring masks

**Fix:** Filter invalid pixels before statistics.

### Trap 4 — One unexplained threshold

**Fix:** Calibrate and perform sensitivity analysis.

### Trap 5 — Treating bright vegetation as flood automatically

**Fix:** Combine multiple features and validate.

### Trap 6 — Forgetting permanent water

**Fix:** Use a suitable permanent-water/context mask.

### Trap 7 — Overinterpreting one observation

**Fix:** Prefer multiple dates.

### Trap 8 — Letting the frontend hide scientific uncertainty

**Fix:** Make quality/evidence visible in the UI.

---

# 43. First command sequence to work toward

The target is eventually something like:

```bash
python main.py \
  --site YOUR_WETLAND \
  --before before.h5 \
  --after after.h5
```

and:

```text
output/
├── before.tif
├── after.tif
├── difference.tif
├── candidate_inundation.tif
├── patches.geojson
├── statistics.json
└── validation.json
```

Do not force this exact CLI if another design is cleaner; the important thing is reproducible input/output structure.

---

# 44. How this plugs into Beyonders

The wetland module will later be one specialized analyzer in the overall project:

```text
                         BEYONDERS
                            │
                     COMMON SAR ENGINE
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
    WETLAND              FOREST              VOLCANO
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                     FORENSICS ENGINE
                            │
                 ┌──────────┼──────────┐
                 ↓          ↓          ↓
              Quality   Counterfactual Temporal
                 │          │          │
                 └──────────┼──────────┘
                            ↓
                       Change DNA
                            ↓
                      Evidence Card
```

The wetland-specific analysis remains specialized; the quality/forensics workflow can be shared later.

---

# 45. Key references

## Official NISAR GCOV documentation

https://nisar-docs.asf.alaska.edu/gcov/

## NISAR product overview

https://nisar-docs.asf.alaska.edu/products-overview/

## NISAR HDF5 format

https://nisar-docs.asf.alaska.edu/data-format/

## Earthaccess / NISAR search

https://nisar-docs.asf.alaska.edu/earthaccess/

## QGIS / NISAR

https://nisar-docs.asf.alaska.edu/using-qgis/

## NISAR availability

https://nisar-docs.asf.alaska.edu/availability-overview/

## NISAR Worldview / data visualization context

https://worldview.earthdata.nasa.gov/

## Research: L-band wetland methods (context, not NISAR validation)

- Hübinger, C., Fluet-Chouinard, E., Escobar, D., & Jaramillo, F. (2026). “Exploring the potential of using L-band InSAR for mapping flooded vegetation in tropical wetlands.” *Remote Sensing of Environment*, 332, 115086. https://doi.org/10.1016/j.rse.2025.115086. This evaluates an InSAR fringe/coherence method with historical ALOS PALSAR-1 data; it does not calibrate NISAR GCOV backscatter thresholds.
- Lamb, B. T., McDonald, K. C., Tzortziou, M. A., & Steiner, N. C. (2026). “Tidal Wetland Inundated Volume Estimates Using L-Band Radar Imagery and Synthetic Tide Gauging.” *Remote Sensing*, 18(8), 1172. https://doi.org/10.3390/rs18081172. The study uses PALSAR-1/2-derived inundation products with DEMs and synthetic gauges; it is methodological context, not NISAR validation.
- Liao, T.-H., Simard, M., Denbina, M., & Lamb, M. P. (2020). “Monitoring Water Level Change and Seasonal Vegetation Change in the Coastal Wetlands of Louisiana Using L-Band Time-Series.” *Remote Sensing*, 12(15), 2351. https://doi.org/10.3390/rs12152351. This studies historical ALOS/PALSAR InSAR phase and coherence.

These papers support wetland radar method development. Their results must not be presented as direct validation of the NISAR GCOV workflow.

---

# 46. Final instruction to the wetland teammate

## Your immediate job is NOT to make the app.

Your immediate job is to prove:

> **A real NISAR GCOV observation can be turned into a scientifically defensible wetland-change signal.**

Do this first:

```text
1. Get Earthdata access.
2. Search for a wetland with multiple GCOV observations.
3. Download one scene.
4. Inspect its HDF5 structure.
5. Identify valid polarizations.
6. Open it in Python/QGIS.
7. Find a second compatible scene.
8. Produce before/after/change layers.
9. Apply a preliminary quality mask.
10. Produce a first candidate inundation map.
```

Once that works, move to Wetland Pulse, validation, Counterfactual testing and the Evidence Card.

**The science comes first. The polished visualization comes after the science is working.**

---

# 47. Original code-folder audit — October 3, 2026

This records the original findings before the repairs in section 49. The code remains a prototype: displayed simulated results must not be described as verified NISAR measurements.

1. The checked-in `pipeline/output/before_hh.tif` inspected during this review is a 100 × 100 EPSG:4326 raster, consistent with the pipeline's synthetic fixture. `pipeline/temporal_analysis.py` also writes a hard-coded simulated time series, and `pipeline/probe_pixel.py` returns simulated pixel values. Label these as demo data.
2. `pipeline/main.py` takes the first two Earthaccess search results without checking orbit, track, acquisition mode, polarization availability, CRS, or grid alignment. A valid comparison must select compatible scenes and reproject/resample to a common grid.
3. `pipeline/extract_gcov.py` falls back to a made-up geographic transform when product georeferencing metadata is missing. It must fail closed instead of exporting a plausible-looking but incorrectly located raster. `main.py` also ignores the extractor's `False` return value, so an extraction failure can leave stale output files in place.
4. `pipeline/main.py` writes a masked HH raster, but `detect_inundation.py` uses the unmasked inputs. The quality and wetland masks are not applied to the detector.
5. `pipeline/detect_inundation.py` estimates area as if all coordinates were degrees. Real GCOV scenes are projected; calculate area in the source CRS with its units, then export map coordinates as WGS84 for the web UI.
6. `pipeline/threshold_sensitivity.py` assumes every pixel is 0.01 km², which is wrong for 20 m and 80 m grids (and for geographic grids). Derive pixel area from the raster transform and CRS. Its patch count is also an estimate from pixel count, not connected-component analysis.
7. The detector and validator currently write fixed/example values for change statistics, valid fraction, quality, spatial status, temporal status, and evidence strength. Compute these from each candidate region and its valid input pixels; do not use the demo values as evidence.
8. The original date scrubber reused a single patch layer and the threshold control only highlighted a row. Section 48 now resolves these interactions for an explicitly simulated demo. Recomputing date-specific detections and threshold sensitivity from real rasters remains outstanding.

The TypeScript build and lint errors found in the web UI were corrected during this review. Current checks pass: `npx tsc --noEmit`, `npm run lint`, and Python syntax compilation. These checks do not validate NISAR scientific correctness or Earthdata access.

---

# 48. Features that run without real data — October 3, 2026

The `/wetland` dashboard now opens a deterministic simulation directly in the browser. It does not automatically load pipeline output files. Existing API routes remain available for later integration. Every displayed measurement and evidence verdict is labeled simulated; the fictional 2025 timeline is separate from NISAR archive availability and does not fill real acquisition gaps.

Implemented:

- One simulation engine drives date-specific regions, signed HH/HV signal changes, candidate area, the full pulse, and threshold sensitivity. Each region contains 20 equal-area fictional response bands. The cutoff removes weak bands; map geometry scales with retained area.
- Before and Split compare the first fictional date with the selected date at the same cutoff. Difference shows current classified candidates, not a real radar difference raster.
- A four-step guided presentation covers baseline, peak, threshold challenge, and uncertainty. A reset button restores the initial settings.
- Region selection updates the evidence card and scopes the Counterfactual Lab. Selection and probe results are cleared or refreshed when controls change.
- An offline schematic basemap is the default. Optional Esri imagery requires internet and remains contextual imagery, never the source of demo measurements.
- A client-side region probe returns synthetic region-average signals only inside demo polygons and reports unavailable signals outside them.
- CSV and GeoJSON export current-date regions in the selected class filter; the JSON evidence snapshot also includes settings, the full pulse, selected evidence, sensitivity, baseline regions for comparisons, source notice, and limitations. Exported geometry matches the illustrated regions and is approximate.
- Shareable URL parameters restore date, cutoff, class filter, map mode, and selected region. Localhost links only work on the computer running the app.
- The region table supports search and sorting. Keyboard controls, focus outlines, responsive scrolling, reduced-motion CSS and a method glossary improve presentation usability.

These features demonstrate the interface and reasoning workflow. They do not establish satellite accuracy, real hydrologic conditions, or real-world evidence strength. Section 49 repairs the pipeline implementation; real-data integration and scientific validation remain outstanding.

Checks passed: production build, lint, 80 date/cutoff combinations, signed signal arithmetic, deterministic outputs, non-overlapping demo geometry, GeoJSON ring orientation, probe containment, selection refresh, and generated CSV/GeoJSON/JSON examples. Desktop and 375px browser checks covered the tour, probe, URL restoration and responsive controls with no console errors observed. The in-app browser did not report a download event; browser file-save completion remains unconfirmed even though the export action and serialized examples were checked.

# 49. Pipeline repairs with fake data retained — October 3, 2026

The default Python run now generates deterministic, explicitly labeled `SIMULATED_DEMO` inputs: eight fictional 2025 observations, a baseline, and binary quality/wetland masks. Demo mode never searches Earthdata or requests credentials. The dashboard continues to use its separate browser simulation; Python outputs are available through the API.

Repaired:

- GCOV extraction reads coordinate vectors, spacing and scalar EPSG metadata, preserves signed pixel spacing, optionally crops the requested AOI, converts valid positive diagonal powers to dB, and rejects missing metadata or polarizations. Failed extraction cannot overwrite an existing raster with a partial file.
- All four HH/HV inputs must have matching CRS, shape and transform. Both masks are validated and applied before detection and probing. Mismatched grids fail explicitly; automatic reprojection is not implemented.
- Detection and sensitivity share classification rules and minimum connected-region filtering. Region area comes from source CRS units or geodesic area; map polygons and centroids are exported in WGS84.
- Region signal statistics, quality, threshold stability and temporal consistency are calculated from the generated observations. Missing land-cover/distance context stays unavailable. Evidence is method consistency only, with `reference_validated=false`.
- Pulse dates, areas, peak, onset and recession come from actual run outputs. Sensitivity uses actual connected components and polygon areas. Empty detections cannot produce a reassuring stability verdict.
- Each run writes into a unique directory. Readers use the last completed run; failed or running attempts are recorded separately and do not replace its pointer. Generated classification rasters keep probes consistent with region filtering.
- API routes validate request coordinates/dates and return a shared run identifier and provenance. The store retains its current data on loading failure instead of replacing it with empty results.
- Real discovery groups scenes by compatible filename metadata and selects the longest chronological series. Real mode rasterizes the configured study boundary onto each acquisition grid; an external QA mask remains optional. Source provenance is identified as NISAR while product maturity and validation limits are reported separately.

Run from the code folder:

```powershell
.\pipeline\venv\Scripts\python.exe pipeline/main.py --mode demo
.\pipeline\venv\Scripts\python.exe pipeline/test_pipeline.py -v
```

The default fixture currently computes a 12.96 km² mask and a 2.4984 km² peak candidate area. Those values describe fake pixels, not measured wetland conditions. Regenerate ignored run outputs after a fresh checkout. See the README for environment setup and API usage.

Verification covers 13 regression cases: deterministic repeat runs; masks, signal arithmetic, area and GeoJSON orientation; pulse/sensitivity agreement; date-specific pixel probes; missing metadata and polarization; signed grids and AOI extraction; grid/mask rejection; minimum region filtering and empty results; failed-run publication; atomic writes; compatible scene selection; and geographic/projected area units. Production build and lint also pass. HTTP checks confirm matching run provenance across outputs, date filtering, agreement between pulse/regions/sensitivity, raster-backed probes, rejection of invalid inputs and a successful dashboard response.

At the time this section was written, actual NISAR files and authenticated access remained unverified. The follow-up integration status is in section 51.

# 50. Generated raster data in the dashboard — October 3, 2026

The wetland toolbar switches between the existing browser simulation and the most recently completed Python raster run. Select **Load pipeline run** or open `/wetland?source=raster`. **Interactive demo** returns to the browser experience.

The raster view loads pulse and sensitivity summaries plus peak-date regions from the API. Selecting another observation date fetches that date's regions. The map draws the GeoJSON polygonized from the classification raster and fits the map to the whole haor boundary for real runs; class filtering, region details, exports and pixel probes use the selected run/date. `Before` and `Split` are unavailable because the pipeline does not create a baseline classification layer. The threshold sweep is displayed as precomputed sensitivity results; its controls are disabled because changing the map threshold requires rerunning detection.

Build and lint passed after integration. Browser simulation data remains separate from pipeline data.

# 51. Real NISAR data integration — October 3, 2026

The real path now uses the correctly located Hakaluki Haor study area (91.95–92.15°E, 24.55–24.75°N), a reference boundary feature from the Bangladesh Haor Boundary ArcGIS layer 147, and the NISAR L2 GCOV provisional collection. The boundary attributes report 173.02 km²; treat it as an approximate study mask, not a legal wetland extent. The pipeline rasterizes this polygon onto each scene grid, derives an eight-scene compatible series, uses the first scene as baseline, and computes seven subsequent observations.

Live NASA CMR metadata search returned 25 granules in the configured date window. The current selector finds eight matching dual-polarization scenes on ascending track 141: baseline June 23, then July 5, 17, August 10, 22, September 3, 15, and 27, 2026. This yields seven post-baseline pulse observations. The science file URL was confirmed in each record; the pipeline opens each selected granule's science HDF5 and does not request ancillary files. The dashboard identifies these as NISAR provisional data, outlines and fits to the whole boundary, and carries source and limitation metadata into exports. The pulse x-axis follows actual acquisition dates and calls out any gap longer than 14 days without interpolation. Failed runs no longer replace the last completed run, and real outputs do not overwrite the fake sample exports.

No Earthdata credentials are configured in this workspace, so the HDF5 science files have not yet been opened and no real raster run has been generated. From the code folder, run `python pipeline/main.py --mode real` in a terminal after configuring or entering a NASA Earthdata Login. The current QA rule only excludes nonfinite or nonpositive HHHH/HVHV samples; no external QA mask is configured. NISAR GCOV data are provisional, and these detector results still need independent reference/field validation and accuracy assessment.

Sources: [NISAR availability](https://nisar-docs.asf.alaska.edu/availability-overview/), [Earthdata Search guide](https://nisar-docs.asf.alaska.edu/earthdata-search/), [GCOV product guide](https://nisar-docs.asf.alaska.edu/gcov/), [Bangladesh Haor Boundary layer 147](https://www.arcgisbd.com/server/rest/services/ADB005/CRIIPS/MapServer/147).

# 52. Worldwide NISAR catalog explorer — October 3, 2026

The app includes a worldwide NISAR scene-coverage view at `/wetland/global/scenes`, linked from the detection page. It queries the public NASA CMR granule catalog for `NISAR_L2_GCOV_PROVISIONAL_V1` on a selected UTC day across the globe, converts available UMM polygon footprints to GeoJSON, and colors those footprints by orbit direction. The user can select a scene on the map or from an accessible scene-ID picker, inspect its acquisition time/track and browse thumbnail, open the CMR-provided HDF5 link, and download that day's catalog metadata as CSV. Catalog responses are limited to three pages of 2,000 records to protect browser performance; the UI reports if the result has been capped.

This is global **scene coverage**. It does not process all scene rasters, classify inundation across the planet, or claim global wetland detections. The Hakaluki pipeline remains a site-bounded detector. Global wetland mapping would need an explicit mask/definition, broad compute and storage, suitable multi-temporal scenes, and validation. Browse images may be publicly viewable; downloading science HDF5 data can require Earthdata Login. No Earthdata credentials are stored in the app.

The default date targets a recent archive day because NASA catalog ingest may lag acquisition. A compact October 1, 2026 CMR snapshot with 859 footprints (retrieved October 3) is bundled for the network-restricted local preview. Other dates use live CMR. Choose another date to inspect the archive; an empty date means no matching footprints were returned by CMR for that query. The global coverage API is `/api/wetland/global-coverage?date=YYYY-MM-DD`; it fetches metadata only and uses a short server-side response cache.

Sources: [NASA CMR Search API](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html), [NISAR availability](https://nisar-docs.asf.alaska.edu/availability-overview/), [NISAR GCOV guide](https://nisar-docs.asf.alaska.edu/gcov/).

# 53. NISAR candidate detections map — October 3, 2026

The primary map at `/wetland/global` reads the completed run's date-specific candidate polygons and study boundary through `/api/wetland/nisar-detections`, offers the processed observation dates, and labels the areas as algorithmic candidates requiring independent validation. It never plots browser or raster demo polygons as real detections. MODIS/VIIRS flood layers and the ESA land-cover switch were removed from this page.

The map is not a worldwide NISAR detections product. It only displays areas processed by the local NISAR pipeline; the worldwide scene page above still shows acquisition footprints, not classifications. At this implementation, the current pipeline run is `SIMULATED_DEMO`, so the map correctly shows no real NISAR candidates until an authenticated `python pipeline/main.py --mode real` run completes. Real-data access status and validation limits are unchanged from section 51.

The map also displays NASA GIBS's global NISAR GCOV false-color backscatter mosaic, with daily and rolling 12-day views. This provides worldwide NISAR observation imagery, not inundation detections. The page labels the distinction and leaves the map at worldwide extent by default; a real pipeline run can be focused separately. The detector still only computes candidates for its processed Hakaluki study area. The mosaic's WMS layers are `NISAR_L2_Geocoded_Polarimetric_Covariance` and `NISAR_L2_Geocoded_Polarimetric_Covariance_12Day`.

At this implementation, the current pipeline run is `SIMULATED_DEMO`, so the local candidate overlay is empty. Real-data access status and validation limits are unchanged from section 51. Checks for the candidate-map changes: `npm run lint`, `npx tsc --noEmit`, production build, HTTP route and API checks. The API returns an empty detection FeatureCollection for the simulated run; the rendered page labels this state and hides simulated polygons.

# 54. Worldwide acquisition footprints on the NISAR map — October 4, 2026

The `/wetland/global` map now overlays NASA CMR NISAR L2 GCOV acquisition footprints for a selectable UTC day on top of the worldwide false-color mosaic. Cyan outlines mark ascending scenes and amber outlines descending scenes. The picker defaults to October 1, 2026; a bundled CMR snapshot for that date (859 footprints) supports offline preview if live CMR is unreachable. Other dates use live CMR. The scene picker remains available at `/wetland/global/scenes`. The initial zoom fits global coverage better on smaller viewports.

Scene outlines mean an acquisition footprint exists; they are not inundation candidates. Real candidate polygons still only come from a completed raster pipeline run, and the current detector is configured for Hakaluki Haor. A truly worldwide classification still requires processing compatible multi-date NISAR science rasters over the globe and an explicit inundation/wetland analysis mask. The GCOV global mosaic is backscatter imagery, not a classification product.

Verification: `npm run lint`, `npx tsc --noEmit`, `npm run build`; HTTP page/API check returned 200 and the October 1 fallback returned 859 catalog footprints.

Sources: [NISAR GCOV in NASA Worldview](https://hyp3-docs.asf.alaska.edu/nisar-docs/worldview/), [GCOV product guide](https://nisar-docs.asf.alaska.edu/gcov/).

In the restricted Codex in-app browser, direct GIBS WMS requests returned `ERR_BLOCKED_BY_CLIENT`, so tile delivery could not be visually confirmed there. The page reports tile failures and links to the official Worldview layer as a fallback; recheck the embedded mosaic from a network/browser that allows `gibs.earthdata.nasa.gov`.

# 55. Evidence-led NISAR case and HLS cross-sensor check — October 4, 2026

The global candidate page now has a featured-case panel for a completed real run. It reports the Hakaluki baseline and event dates, NISAR scene identifiers and HH/HV layers, the change rules and threshold sensitivity, candidate area/classes, the HLS comparison, and explicit uncertainty and impact context. The worldwide map distinguishes actual processed detector coverage from catalog scene footprints and backscatter imagery; an unprocessed blank is shown as “no result available,” never as “no change.” The Hakaluki study boundary is the detector's current scope, not a worldwide classification.

Real mode now searches the NASA HLS S30 archive for same-tile Sentinel-2 scenes near the NISAR before/after dates. It calculates green/SWIR MNDWI change and compares it with NISAR open-water candidates on co-registered pixels that are clear in both HLS dates, inside the wetland mask, and valid in the NISAR layers. It excludes HLS cloud, cloud adjacency, shadow, snow/ice, saturated/nodata, and high-aerosol pixels. It reports common-pixel coverage, offsets between NISAR and HLS dates, confusion counts and precision/recall/F1/IoU when enough shared pixels and positive classes exist. Too little overlap or no comparable open-water class is `INCONCLUSIVE`; inaccessible or unprocessable HLS data are `UNAVAILABLE` and do not discard a completed NISAR run.

The HLS output calls a computable comparison `CROSS_SENSOR_CHECK`, but leaves `reference_validated` false. Agreement between two satellite methods is not field truth, a formal accuracy estimate, or validation of the vegetated-inundation class. HLS's 30 m resolution and acquisition offsets can miss short-lived water changes; MNDWI is an open-water proxy and can miss flooded vegetation, turbid water, and mixed shore pixels. NISAR provisional measurements can also be affected by wind/roughness and the configured HH/HV rules. The case panel states these limits and treats candidates as leads for investigation.

The configured archive metadata has a compatible ascending NISAR track-141 series over Hakaluki and nearby-date HLS tile acquisitions, based on public NASA CMR search results. That confirms catalog availability only. No NISAR HDF5 or HLS band/QA pixel data were processed in this environment because Earthdata Login credentials are not configured. Consequently, the current published run remains the simulated demo; this implementation must not be described as a real detection or as a completed independent comparison until an authenticated real run finishes. Run `python pipeline/main.py --mode real` from the code folder after configuring NASA Earthdata Login locally. Do not put credentials in source control or send them in chat. A failed attempt is recorded separately and does not replace the last completed run.

Verification during this continuation: the 13-test offline pipeline regression suite, Python syntax compilation, TypeScript type-check, ESLint, and production build passed. Regression checks exposed and fixed the demo case-story's missing baseline fallback and a no-completed-run error that leaked `FileNotFoundError`; two geographic/output-pointer assertions were updated to match the current fixture and atomic-publication behavior. The local `/wetland/global` page returned HTTP 200; `/api/wetland/nisar-detections` correctly returned `no-real-nisar-run`, `SIMULATED_DEMO`, and an empty feature list. The real CLI found 25 public CMR NISAR metadata records, then a non-interactive netrc-only authentication check stopped with `LoginStrategyUnavailable` because `C:\Users\LENOVO\_netrc` is absent; no NISAR/HLS pixels were downloaded, and `current_run.json` remains the completed demo. The NASA GIBS NISAR mosaic tiles still fail to load in this browser environment; the page shows a fallback map and the tile error notice while the bundled 859-footprint scene snapshot loads. NASA HLS V2 QA bits 1–5 encode cloud, adjacency, shadow, snow/ice, and water; bits 6–7 encode aerosol levels. High-aerosol pixels are excluded. See the [NASA HLS algorithms and QA description](https://hls.gsfc.nasa.gov/algorithms/) and [HLS S30 band/product description](https://hls.gsfc.nasa.gov/products-description/s30/).

## 56. Repair GIBS NISAR mosaic tiles — October 4, 2026

The global map had been requesting `NISAR_L2_Geocoded_Polarimetric_Covariance_12Day`, which is not advertised by NASA GIBS's current EPSG:3857 WMS/WMTS capabilities. That invalid layer name returned a `LayerNotDefined` service exception inside an HTTP 200 response, so Leaflet reported tile errors while the CMR footprint snapshot continued to load. The visible failure was therefore independent of the footprint catalog.

The map now requests GIBS's advertised `NISAR_L2_Geocoded_Polarimetric_Covariance` layer through the EPSG:3857 WMTS REST tile template. It uses the service's default-time URL when no date is selected, and inserts the selected UTC date when one is selected. The unsupported 12-day choice was removed. These are global false-color GCOV backscatter imagery tiles, not a global change-detection layer; detector candidates and coverage semantics remain as described above.

Verification: the selected daily WMTS endpoint returned `200 image/png` for the latest advertised date, and a WMTS request using the service default date also returned `200 image/png`; a WMS GetMap request for the daily layer/date likewise returned an image. ESLint, TypeScript, and the production build pass. After restarting the dev server at the same time as the production build, its `.next` artifacts collided and the client map stayed on its loading placeholder; restarting the dev server resolved that separate local-preview issue. The browser then showed the `NASA GIBS · daily` ready state and 859 CMR snapshot footprints. The page was initially opened at `127.0.0.1`; `allowedDevOrigins` now permits that exact local development origin to avoid Next.js blocking its HMR/font resources.

Sources: [NASA GIBS Access Basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/), [NASA GIBS map library usage](https://nasa-gibs.github.io/gibs-api-docs/map-library-usage/).

## 57. Website study-area label for the next real run — October 4, 2026

The worldwide NISAR page now lets the user save a 2–80-character study-area label for real pipeline runs. The same-origin local API validates the label and atomically writes `pipeline/output/site_name_override.json`; the CLI reads it for subsequent default-config real runs until changed. An explicit `--site-name` takes precedence. The override is ignored by Git. The manifest, case story, and spatial-scope text use the selected name.

This control changes the run label only. The configured study polygon and CMR query bounding box remain unchanged in `pipeline/config.yaml`; the UI explains this next to the field. To analyze a different location, its valid boundary GeoJSON and matching search bounds must also be configured. The web page does not launch a long-running authenticated download; after saving the label, the user runs the displayed real pipeline command in a terminal.

Verification: lint, TypeScript check, production build, API GET/POST round trip with a temporary test label, real-mode CLI help, and Python syntax compilation. No authenticated NISAR pipeline was run; the saved label alone does not produce detections or change geography.

## 58. Browser processing, saved runs, and measured radar evidence — October 4, 2026

The global page now provides a complete local workflow: name an area, draw a two-corner box or enter WGS84 coordinates/upload a polygon GeoJSON, search the public NISAR catalog, select a compatible chronological pair, and launch processing. The chosen boundary and dates are copied into a per-job configuration. Browser jobs require the local Windows pipeline virtual environment and a network-enabled Node development server. A one-time persisted Earthdata Login is needed for science files; the page shows a full-path PowerShell command so setup works from any folder. Passwords are entered in the terminal, not the website.

Jobs have persistent JSON status/progress and private logs under ignored `pipeline/output/jobs/`, with one active local job at a time. Refresh restores an active search and its area, or a completed search's scene choices. Saved completed real runs can be reopened independently; failures preserve the last completed scientific output. Browser area processing is limited to 2° across and excludes date-line crossing. A rectangular selection is clearly identified as a study mask, not a surveyed wetland.

The actual HH/HV inputs now have matched-extent before, after and after−before scientific previews for every processed date pair. Before and after share channel-specific percentile brightness scales. Change uses a fixed −10 to +10 dB scale. Display images are bilinearly resampled to Web Mercator; detector statistics keep their native grids. The user can download the underlying cropped GeoTIFFs, selected-date polygons/classification, and case evidence. All seven date pairs of existing real run `49f40700785144a7969c15b1cfc516b4` have been rendered. This run's featured June 23–July 17 case contains 318 candidates covering approximately 3.23 km². Only one completed real study area is currently saved; worldwide scene imagery/footprints are not worldwide detections.

HLS selection now evaluates up to 16 same-tile, nearby-date pairs and chooses maximum shared clear coverage inside valid NISAR study pixels. It does not choose by agreement with the detector or loosen the cloud/coverage criteria. Reference retries use saved radar/classification rasters, archive the previous reference result, and publish new dates, coverage, pair attempts and outcome. A completed satellite comparison remains separate from field validation; `reference_validated` stays false. After persisted Earthdata Login became available, browser job `2ecefeae7c0848a3bac54057209e11de` successfully read all six compatible nearby-date HLS pairs and completed in approximately 2 minutes 44 seconds. Each pair had zero common clear study pixels, so the featured June 23–July 17 case remains `INCONCLUSIVE`. The result, pair attempts and previous reference snapshot are saved in the real run folder. Completing this access/coverage check does not verify the flood candidates.

Checks completed: 13 existing offline pipeline regression cases and 3 focused scene-selection/reference-selection cases passed; TypeScript, targeted ESLint and Python source syntax checks passed. In the browser, public catalog search succeeded with 25 records and eight compatible Hakaluki dates after restarting the development server outside its network-restricted sandbox. Saved-run selection, search recovery after refresh, HH/HV switching, another observation date, and all three preview image loads were confirmed. A Leaflet error during development hot reload cleared after a full page reload; normal saved-run/date interactions then worked. The authenticated HLS retry completed and published its inconclusive coverage result. No additional study area was processed in this continuation. Future local jobs report each reference pair being read; an F1 calculation now correctly returns zero for nonempty, disjoint positive change classes.

## 59. Clear-reference date screening and September comparison (2026-10-04)

The HLS checker now searches both Sentinel-2 `HLSS30` and Landsat `HLSL30` v2.0. Green/SWIR1 bands are S30 B03/B11 and L30 B03/B06. Fmask exclusions, ±5-day matching, MNDWI > 0, and the minimum 20% common clear coverage remain unchanged. Reference selection evaluates up to 32 same-tile pairs and records collections, acquisition offsets, individual clear counts, pair attempts and limitations. The original June 23–July 17 run `49f40700785144a7969c15b1cfc516b4` was retried with both collections: all 21 available pairs had zero common clear coverage, so its result remains `INCONCLUSIVE`.

`pipeline/find_reference_case.py` screens QA masks for other dates already saved in a real run. It screened 71 real HLS scenes across 11 NISAR pairs spanning at most 24 days, with no unavailable QA scenes. Date pairs are ranked by shared clear coverage, then shorter radar interval; detector agreement is not consulted. The September 15–27 pair had the highest QA-clear fraction, 44.8307%. The QA masks are cached in ignored `pipeline/output/reference_qa_cache/`; the ranked screening evidence is in the original run's `reference_case_candidates.json`.

`pipeline/process_reference_case.py` processes the highest-ranked eligible pair into a separate real run, using saved measured HH/HV dB subsets only for the identical polygon/product/frequency and compatible chronological scenes. It does not log-transform saved dB values again. Source-run and date-selection provenance are included in the new case; the original run remains available. An authentication omission in the initial saved-subset path was corrected, and the initial unavailable reference result was archived before an authenticated retry.

New latest run: `ab8c780a3e204035a34cbb0c09d886a4`, Hakaluki Haor, real NISAR September 15–27. It contains 33 open-water candidate regions covering 0.2962 km² (display 0.30 km²). All four saved HH/HV layers match their original measured rasters pixel for pixel, including excluded samples. Its authenticated reference retry read 32 of the available date-matched optical pairs and selected Sentinel-2 HLS September 14 and September 22. Offsets are −1 and −5 days. Common usable area is 77.5181 km², 775,181 native radar pixels, or 44.8307% of the study mask. This resolves the zero-coverage problem for the new date pair; it does not resolve cloud coverage for the original June–July case.

The September comparison is computable (`CROSS_SENSOR_CHECK`) but has **zero overlapping new-water pixels**: TP 0, FP 1,088, FN 57; precision, recall, F1 and IoU are all 0. These are cross-sensor agreement counts, not field truth. The reference does not corroborate these radar candidates. The remaining 55.2% of the mask is unassessed by this reference; the later HLS acquisition precedes the later radar date by five days. Threshold sensitivity remains `SENSITIVE`, the GCOV product is provisional, no external radar QA mask is configured, and `reference_validated` remains false.

The website now explains date selection and saved subset provenance, comparable/unassessed area and what precision means. A zero-overlap comparison gets an amber “HLS check complete · no change overlap” label. Restored reference jobs name their run, so an earlier job is not mistaken for the newly loaded case. Next Fast Refresh reset directives remount the Leaflet map when its containing components are edited during development, addressing the destroyed-map-pane error seen during UI changes.

Python source syntax, TypeScript and targeted ESLint checks passed during this continuation. Actual NASA reference reads and saved-raster equivalence were checked. Generated outputs remain local and ignored by Git. The screening/processing commands and their limitations are documented in README.

## 60. Detector disagreement audit and optical evidence viewer (2026-10-04)

`pipeline/reference_evidence.py` reconstructs the exact recorded HLS comparison from measured B03/SWIR1/Fmask bands and reads B04/B02 for true-colour images. It verifies the reconstructed common clear count and TP/FP/FN counts against `reference_validation.json` before publishing. Cropped native source bands are cached in each run's ignored `reference_source_cache/` with internal validity masks. The reader can return additional RGB, nearest-neighbour MNDWI and Fmask arrays without changing the default reference algorithm.

The September run `ab8c780a3e204035a34cbb0c09d886a4` reproduced its published counts: 775,181 common clear radar-grid pixels, TP 0, FP 1,088, FN 57. Of 2,962 open-water candidate pixels, 1,088 (36.7319%) are assessed by the primary reference and 1,874 remain unassessed. **All 1,088 assessed candidates are optical water on both September 14 and September 22**, covering 0.1088 km². No assessed radar-only pixels are optical non-water on both dates or optical water recession. Assessed candidate median HH is −15.2270 dB before and −19.6929 dB after, with median pixel change −4.1674 dB. These medians are descriptive signals, not calibrated water thresholds.

The closest total date-offset alternative among previously evaluated pairs satisfying the unchanged 20% coverage floor uses Sentinel-2 September 14 and Landsat September 24. It has 41.4425% common clear study coverage and assesses 1,773 candidate pixels (59.8582% of all candidate pixels); **all 1,773 are already optical water on both dates**. Its TP 0, FP 1,773, FN 185 also produce zero precision/recall/F1. Selection is based on date offset and coverage, never agreement. The published primary comparison remains September 14–22. A nearest-neighbour MNDWI resampling diagnostic still produces zero matched pixels; no primary radar-only pixels lie within 30 m of optical new-water change. These checks do not prove registration accuracy or isolate the physical cause of radar change.

The detector audit identifies a method limitation: `classify()` tests HH decrease alone for `OPEN_WATER`; it does not require a previously dry pixel to become water. This can flag radar darkening over existing water. The independent context supports that interpretation for the assessed subset, not the unassessed subset. Water observed on two dates is not proof of permanent water. No detector cutoffs or original candidate results were changed to obtain better agreement, and no physical cause (wind, roughness, calibration or other scattering changes) is asserted. GCOV quality flags and number-of-looks information remain unused by this saved detector run; further SAR classifier development and independent event verification remain necessary for confirmed flood claims.

The `/wetland/global` section **Does the change agree?** provides true-colour/water-mask toggles, primary/closer-date selection, categorical agreement and clear coverage maps, and radar-on-optical overlay with opacity control. All visual artifacts share an exact geographic extent. RGB brightness uses the same 0–0.30 reflectance scale/gamma 2.2 for both dates. Categories use nearest-neighbour display resampling; continuous imagery uses bilinear. Legends, summaries, candidate context table, source dates, method limitations and downloads provide text equivalents. GeoTIFF/JSON artifacts preserve quantitative evidence. HLS's 30 m source resolution is explicit; upsampled native radar-grid pixel counts are not independent optical samples.

Added a local `evidence` worker action and **Prepare optical evidence** control. New real runs and reference retries attempt evidence rendering; failures preserve completed radar/reference statistics. `/api/wetland/reference-evidence` and artifact downloads check the evidence's run ID, comparison metadata and counts against the active saved reference before serving; stale evidence requires rebuilding. Source-band caches are not public download artifacts. The original June–July saved run remains available and its reference remains inconclusive.

The evidence action was rerun from the live website after integration. It completed for `ab8c780a3e204035a34cbb0c09d886a4`, reported that the saved comparison counts were reproduced, and returned 0 matching new-water pixels and 1,088 radar-only pixels. The report includes 33 candidate context rows and seven primary plus seven closer-date visual artifacts. TypeScript, targeted ESLint and Python syntax checks passed. Browser verification showed the primary true-colour/agreement images and the closer-date water-mask/radar overlay rendering at 933 × 1024 with no browser console errors. The completed comparison is open in the browser; a review screenshot is saved at `artifacts/nisar-optical-evidence.png`.

## Source notes

## 61. Detector naming, GCOV quality screening and native-resolution reference scores (2026-10-04)

The app now labels the class previously named `OPEN_WATER` in its detector schema as an **HH-darkening candidate** in the interface. The HH rule is a backscatter-decrease heuristic; it does not establish that a pixel transitioned from dry land to water. The stable internal enum remains unchanged for saved run compatibility. Candidate properties now preserve an interpretation label and the baseline provenance.

Raw-GCOV processing now extracts `numberOfLooks` and the GCOV `mask` layer alongside HH/HV. Non-finite/non-positive looks and HDF5-declared fill samples are excluded from the detector inputs. The mask layer is retained with its attributes and per-code counts, but its categorical values are not guessed to mean valid/invalid: ASF's GCOV guide describes it as the averaging-ensemble information. The method records look summaries and does not impose an arbitrary minimum-look cutoff. The saved September run `ab8c780a3e204035a34cbb0c09d886a4` was made from measured dB subsets that lack these original sidecars; it remains explicitly unscreened and its historic detection counts are not recomputed or presented as newly quality-screened.

For real time series, each later event now compares against the per-pixel median of all preceding valid HH/HV observations. Patch and run metadata record contributing dates, scene names, observation count, and the median HH temporal MAD. The first event has a single-observation baseline. HLS searches around the midpoint/median date of the baseline series and records the full radar-date series; this is a date-matched optical diagnostic, not a validation of every radar observation in the median composite. The saved September two-scene case still has one preceding observation, so it remains the original date-pair result.

HLS comparison now additionally projects valid radar and candidate fractions onto native HLS 30 m cells using area averaging and reports area-weighted TP/FP/FN, coverage, precision, recall, F1, and IoU. Earlier radar-grid pixel counts are retained and explicitly marked legacy for reproducibility; they are not treated as independent optical samples. The evidence builder adds these metrics to the saved reference/case files after reconstructing the exact recorded HLS pair. It preserves the original cross-sensor status and never marks the result field-validated.

The worldwide page and radar/reference panels identify the exploratory class, show the median baseline dates/scenes, and distinguish native-30 m area scores from legacy radar-grid counts. The new quality and median-baseline behavior applies to future raw multi-observation pipeline runs. Existing saved cases are not retroactively recalculated from missing input data. No second study area is present in the saved real runs; the two actual cases are both Hakaluki. A second independent case still requires a distinct boundary and a compatible acquired NISAR pair, and no extra multi-GB radar observations were fetched for this code change.

Verification: Python syntax compilation, TypeScript `--noEmit`, and targeted ESLint passed. No test suite was run. The browser-triggered evidence rebuild completed for `ab8c780a3e204035a34cbb0c09d886a4` and reproduced the saved legacy counts. Its native-HLS comparison reports 77.5181 km² (47.59%) comparable support, 0.1088 km² radar-only, 0.0072 km² optical-only, and effectively zero overlap after a floating-point noise floor was added. Precision, recall and F1 display as 0.0%; the candidates are not corroborated by this HLS pair. The saved detector still lacks original GCOV QA sidecars. The live `/wetland/global` page visibly shows the area-weighted score and corrected “no change overlap” status.

## Source notes

This handoff is based on the current NASA/ASF NISAR Data User Guide, current public NISAR data-access documentation, recent L-band wetland research, and the team-side Space Apps preparation plan. Exact scene availability, acquisition configuration, thresholds and final challenge resources must be verified against the live NISAR archive and the final 2026 challenge materials before implementation is locked.

## 62. Completed raw series and date-specific follow-up commands (2026-10-05)

The user's full Hakaluki rerun completed as `d6e65a58802e4cf4907ddefa42a435d6` and is the published current run. It processed eight real GCOV scenes, retained per-scene numberOfLooks/mask sidecars, and created seven post-baseline observations. The selected July 17 observation uses a per-pixel median of June 23 and July 5; it has 213 candidate patches covering 2.5702 km². Its HLS check is inconclusive because only nine common clear pixels were available. The September 27 observation is also in this same run, with seven contributing baseline dates and 18 candidates covering 0.1159 km².

Added `pipeline/check_saved_date.py RUN_ID YYYY-MM-DD` to compare any saved observation against HLS using its already-computed radar median and classification. It writes `date_checks/<date>/reference_validation.json` and, when a pair is readable, `evidence.json` plus aligned optical/coverage/agreement images. It does not alter the current-run pointer or the run's featured July case. The HLS baseline search centers on the median date of the preceding radar series, so a September 15–27 optical score from the earlier two-scene run must not be carried over to this different baseline.

Added `pipeline/discover_study_area.py --site-name NAME --bbox WEST SOUTH EAST NORTH --start-date YYYY-MM-DD --end-date YYYY-MM-DD` for public catalog preflight before processing a second box. It reports compatible scenes and catalog file sizes without opening their science HDF5 files. A sample Tanguar Haor rectangle can be drawn from the Ramsar information sheet's approximate coordinate range; it is not the official Ramsar boundary. Scene availability for that box remains unverified: this Codex sandbox's public CMR request was blocked locally with WinError 10013. Run preflight from the user's normal PowerShell terminal before starting another real pipeline run.

Python compilation and both CLI help commands passed. The new date-specific HLS check and second-site catalog preflight have not completed against live NASA services in this sandbox.

## 63. September 27 median-baseline reference result and Rasterio warning (2026-10-05)

The user completed `check_saved_date.py d6e65a58802e4cf4907ddefa42a435d6 2026-09-27` in a normal terminal. The result is `CROSS_SENSOR_CHECK`, with HLS L30 scenes from August 7 and September 24. The radar event is September 27; its seven-date median baseline spans June 23–September 15 and is represented for HLS search by August 10. Native HLS comparable area is 82.6123 km², or 50.71696% of the study area. Area-weighted overlap is 0.0115 km², radar-only area 0.0778 km², optical-only new-water area 0.2088 km²; precision 12.88%, recall 5.22%, F1 7.43%. Of 773 aligned radar-grid radar-only pixels, 637 were water on both optical dates, 122 non-water on both, and 14 optical recession. This is weak corroboration of new inundation and supports keeping the HH-darkening candidate claim. Full interpretation is saved beside the date check in `interpretation.md`.

The date-check terminal emitted GDAL/Rasterio warnings about zero source values being changed to the smallest positive float. `area_supported_metrics` had passed `dst_nodata=0` when resampling meaningful zero area fractions. It now leaves zero valid with no destination NoData assignment and retains the zero-initialized destination. A local recomputation from the cached HLS source bands emitted no warning and reproduced the saved common-clear fraction, TP/FP/FN areas, and F1 exactly. The saved date-check figures were not altered. Python syntax compilation passed after this edit.

## 64. Second real study area completed (2026-10-05)

The user's Tanguar Haor **study box** run `f6e80781dbbc43bc895f80d8236520cf` completed successfully and is the current published run. It covers the user-supplied rectangle 91.0167–91.1167°E, 25.0833–25.2°N; this rectangle must not be called the official Ramsar wetland boundary. Eight compatible NISAR L2 GCOV scenes were processed, giving seven post-baseline observations, with GCOV numberOfLooks and mask sidecars saved for each scene. The selected September 10 result compares against the median of six earlier radar dates. It has 434 HH-darkening candidate regions covering 24.309 km². This is an unusually large exploratory signal, not a confirmed flood area.

The automatic HLS check for the September 10 peak is `INCONCLUSIVE`: only 2 native HLS cells, or 0.0018 km², were common clear support. Its numerical precision/F1 must not be presented as a meaningful validation score. The seven saved event dates are June 30, July 12, July 24, August 17, August 29, September 10, and September 22. August 29 and September 22 are candidate dates for separate reference checks; no such check has yet completed. The local website API returned this run as ready and listed it first among saved study areas. The pipeline lock is absent and the previous Hakaluki runs remain available.

## 65. Tanguar September check, mapped boundary, and date evidence in the site (2026-10-05)

The user ran `check_saved_date.py f6e80781dbbc43bc895f80d8236520cf 2026-09-22`. It evaluated 32 of 33 HLS optical pairs and selected S30 July 24/September 22 on tile T45RZH. Only two native HLS cells (0.0018 km²) were common clear in the saved rectangular mask. The result is `INCONCLUSIVE`, with no meaningful precision, recall or F1. This does not verify Tanguar flooding; its September 22 HH-darkening candidates remain exploratory. The Hakaluki September 27 median-baseline check has usable coverage but weak change agreement (50.7% native HLS area, F1 7.4%; 637 of 773 aligned radar-only cells were water on both optical dates). Neither result supports a confirmed flood claim. Thresholds were not tuned to these optical checks.

The date-specific checks are now read by `/api/wetland/date-check` and displayed on `/wetland/global` when their observation is selected. The endpoint only serves images from a completed, matching `evidence.json`; stale or absent evidence cannot be shown as if it belonged to the active check. The global page also reports the saved study-mask source. Its observation details now use that observation's own median-baseline dates and scenes, instead of incorrectly displaying the featured peak's baseline for a different selected date. The featured case remains the peak observation, separate from the selected-date check.

The former Tanguar rectangle is preserved as its own run. A new `pipeline/data/tanguar_haor_adb_boundary.geojson` contains the exact WGS84 polygon for Bangladesh CRIIPS Haor Boundary layer 147, feature 202, labeled “Tanguar Haor.” Its source reports 116.5 km² and its geodesic geometry measures 116.59 km². This is an established mapped haor extent, **not** the Ramsar 1031 site polygon; RSIS lists the latter at 9,500 ha. Another CRIIPS feature named “Tangua Haor” has a different area, so the source feature ID is recorded explicitly. `prepare_tanguar_boundary.py` can regenerate and validate the polygon. `main.py` now carries a GeoJSON `boundary_source` property into the run manifest when present. The old rectangular science subsets cannot cover the entire mapped polygon, which extends from 90.960080 to 91.128588°E. A fresh real pipeline run on this polygon is required before the website can display polygon-scoped candidates. Exact preflight and run commands are in README. Shell network restrictions prevented launching that larger live NASA run here; no polygon-scoped NISAR result is claimed.

## 66. Completed mapped-boundary NISAR run and optical coverage safeguard (2026-10-05)

The user's fresh real NISAR run completed as `3b01cdb5674a44ea9c6c3d17ec8c07b8`, replacing the old rectangle as `current_run`. It uses the CRIIPS feature 202 polygon, processes eight compatible GCOV scenes, and saves seven comparison dates. The selected August 29 result has 295 HH-darkening candidate regions covering 24.4765 km². September 10 has 20.98 km² and September 22 has 8.42 km². The API on port 3015 returned the new run, site name, source attribution, 295 regions, and mapped area correctly; the pipeline lock is absent.

The automatic August 29 HLS comparison evaluated all 15 available nearby optical pairs but found only 0.388 km² of common clear native HLS support, about 0.34% of the mapped area. Its status is `INCONCLUSIVE`, and it does not validate the 24.48 km² candidate result. The evidence renderer produced RGB/coverage/agreement files and reproduced its counts; previously the website displayed an apparent 0% F1 for that tiny comparison. `ReferenceEvidence.tsx` now gates both legacy and native scores, the already-water interpretation, and disagreement audit on `CROSS_SENSOR_CHECK`. For an inconclusive reference it displays the coverage gap and diagnostic imagery, with no interpreted agreement score. TypeScript and targeted ESLint passed after the change. A date-specific independent check or other reference with materially better coverage is still needed, and the large candidate extent should be inspected against independent event evidence before any flood claim.
