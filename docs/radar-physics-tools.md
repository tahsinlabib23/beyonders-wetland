# Interactive radar physics tools

The case pages provide compact, public sample grids for teaching and inspection.
They do not replace the source rasters, detector inputs, or native-grid area
statistics.

## Coverage comparison

The optical comparison shows NASA HLS **common-clear coverage after cloud and
quality masking**, not a pure cloud percentage. Rondônia's selected 8 July–28
September 2026 pair has 97.45% common-clear study coverage. Its small candidate
area is fully assessed; 71.1% has exploratory NDVI/NBR-decrease support. This
does not establish forest loss. Chókwè's 7–22 January pair has 1.26% common-clear
coverage and assessed none of its radar candidates. The later UNOSAT map provides
positive, delayed spatial support but no accuracy score. Cloud, cloud shadow,
missing observations and other quality masks may contribute to uncovered area.

## Pixel physics inspectors

### Chókwè wetland/flood case

Click the published HH event preview or enter decimal coordinates. The browser
loads a 128 × 128 nearest-native-pixel sample grid from the January 5/17 NISAR
L2 GCOV BETA pair and displays HH/HV dB, their ratio in dB, and before-to-after
backscatter changes. This is descriptive polarization evidence. It does not
uniquely separate open water from flooded vegetation. This case has no matched
C-band raster, so the inspector does not calculate an L/C difference.

### Rondônia forest case

Click either case map or enter coordinates. The inspector displays the selected
published date's HH/HV values, HH/HV ratio, RFDI, baseline HV and HV change.
RFDI is computed from linearized power:

```text
HH_power = 10 ** (HH_dB / 10)
HV_power = 10 ** (HV_dB / 10)
RFDI = (HH_power - HV_power) / (HH_power + HV_power)
```

It is a polarization/scattering ratio, not a biomass, carbon, or confirmed
clearing estimate.

### Hayli Gubbi volcano case

The existing pixel inspector displays unwrapped phase, coherence, component,
and apparent LOS change. Phase converts to LOS displacement using the sign
convention declared by the selected product:

```text
LOS_m = phase_radians * wavelength_m * phase_sign / (4 * pi)
```

One full phase cycle represents half a wavelength in LOS displacement. It is
not automatically vertical uplift. Coherence is a screening measure, not a
probability of correctness.

The selected NISAR L-band and Sentinel-1 C-band products have different
observation windows. The page shows their actual coherence and screened coverage
but explicitly does not interpret them as a matched experiment. It does not
claim C-band decorrelation or L-band recovery based on these data. NASA describes
the L-band half-cycle scale and phase interpretation in its
[NISAR interferometry guide](https://science.nasa.gov/mission/nisar/interferometry/);
ASF documents Sentinel-1 C-band wavelength and decorrelation considerations in
the [HyP3 InSAR guide](https://hyp3-docs.asf.alaska.edu/guides/burst_insar_product_guide/).

## Sonification

The user starts audio manually. A short sweep follows the sample row at the
selected latitude. Forest pitch follows RFDI and loudness follows HV backscatter;
wetland pitch follows HH/HV contrast and loudness follows HH backscatter.
Volcano pitch follows phase, loudness follows coherence, and lower coherence adds
a restrained noise layer. Missing samples stay silent. Audio is an accessibility
and explanation aid, not a decision threshold or forecast.

## Evidence triage brief

Each case can download a JSON summary with selected inputs, method, available
metrics, interpretation, and limitations. Missing population/road exposure,
biomass or carbon estimates, and volcano alert levels are reported unavailable;
they are not inferred from radar-only candidates.

## Rebuild the sample supplements

The public sample grids were generated from the saved local Chókwè and Rondônia
rasters. The reproducible publisher is:

```powershell
.\pipeline\venv\Scripts\python.exe .\pipeline\publish_physics_grids.py --version 2026.10.29-v1
```

The publisher refuses to overwrite a version. Use a new version string for a
new supplement, then update the Chókwè data URL in
`src/components/global/MozambiqueFloodCase.tsx` to that version. It updates the
Rondônia supplement URL in `public/forests/rondonia/index.json`. Each supplement
includes a manifest and SHA-256 checksum. Only the 128 × 128 sampled previews
are public; the full native rasters remain operator-managed.
