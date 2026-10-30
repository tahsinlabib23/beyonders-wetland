# Forest context and radar-change method

## What this module shows

`/forest/global` distinguishes historical land cover, NASA NISAR imagery,
acquired-scene footprints and published candidates. `/forest/rondonia` reads one
immutable publication. Neither page is a worldwide forest-loss classifier.

ESA WorldCover 2021 v200 class 10 supplies historical tree-cover eligibility.
Its other map colors describe other land-cover classes. The public Terrascope
WMTS serves this rendered context from zoom 6; the page explains the minimum
zoom. Analysis reads the categorical COG subset, not tile colors. WorldCover
2020 and 2021 must not be used as a change pair because their methods differ.
Source: <https://esa-worldcover.org/en/data-access>. Historical tree cover does
not establish that the pixel still contained trees in 2026.

## Fixed first study

The Rondônia box is `[west, south, east, north] = [-62.75, -10.4, -62.55, -10.2]`
in WGS84 decimal degrees. It is an analyst-defined rectangle, not an official
forest boundary. The actual geographic rectangle masks the projected native
grid. Catalog search confirmed PROVISIONAL GCOV HH/HV acquisitions on June 25,
July 7, July 19, August 24, September 5, September 17 and September 29, 2026.
The configured series is track 161, ascending, frame 172, frequency A, release
P05023. The workflow refuses an incomplete/replaced series.

Input IDs and maturity are retained. Compatible track, direction, frame,
frequency, bandwidth, polarizations and release are required. Native grids must
match; disagreement fails explicitly instead of silently resampling radar.
The shared GCOV extractor validates coordinate spacing, shape, EPSG, finite
positive diagonal power and declared fill values. Power converts to dB with
`10 log10(power)`. Quality requires usable `numberOfLooks` and non-fill ensemble
metadata. The GCOV ensemble mask is not guessed to be a water/quality class.
Product reference: <https://nisar-docs.asf.alaska.edu/products-overview/>.

## forest-hv-persistence-1.0.0

1. Require valid HH/HV and quality on all three baseline dates.
2. Compute the per-pixel median HV dB baseline and unscaled temporal median
   absolute deviation (MAD). Also retain the median HH baseline.
3. Eligibility is baseline validity, historical tree-cover class 10 and the
   actual geographic study box. Missing WorldCover is unassessed.
4. Compare each later HV image with this fixed baseline. A candidate requires
   a decrease of at least 3 dB on **two consecutive scheduled later dates**, with
   both dates valid. An invalid intervening date breaks persistence. The first
   later date cannot establish persistence by itself.
5. Use eight-connected patches; retain patches at least 1 hectare. Calculate
   area from the actual projected grid and CRS units, not preview pixels.

Classification is `1=candidate`, `0=assessed/no persistent candidate`,
`255=unassessed`. Zero does not mean unchanged forest. Continuous NoData is NaN.
There is no spatial despeckling in this version; temporal persistence and the
minimum patch size are exploratory screens, not a calibrated accuracy claim.
HH is explanatory evidence, not a second classification condition.

## Independent optical protocol

NASA HLS L30/S30 v2.0 is queried within 30 days of the middle baseline date and
each comparison date. Before images must not follow the final baseline date;
after images must follow it. Rank same-tile, same-sensor pairs by footprint
overlap and temporal offsets. Screen at most 12 pairs, then select by greatest
common clear QA coverage, never by agreement with radar.

Read red, NIR, SWIR2, RGB and Fmask subsets. L30 uses B04/B05/B07 for
red/NIR/SWIR2; S30 uses B04/B8A/B12. Exclude cloud, cloud adjacency, shadow,
snow/ice, high aerosol, water, fill and unusable reflectance. Calculate
`NDVI=(NIR-red)/(NIR+red)` and `NBR=(NIR-SWIR2)/(NIR+SWIR2)` on valid native
30 m cells. Preserve valid zeros and exclude invalid denominators.

Area-average radar candidate and study fractions onto the native HLS grid.
Common clear fraction uses the entire study area as denominator. A **20%** floor
makes a comparison assessable, not scientifically validated. Under the floor,
the status is inconclusive and overlap fraction is suppressed. The exploratory
support signature requires both NDVI and NBR to decrease; magnitudes, imagery,
assessed support and temporal offsets remain visible. No labelled negatives
exist, so precision, recall and F1 remain null. Direction-only support can be
caused by noise, seasonality, moisture or other disturbance.

GLAD-S2 official exports can supply additional **positive event evidence**.
The original categorical raster, date encoding, alert interval, confidence
encoding, source and retrieval date must accompany an import. Absent alerts or
NoData are not assessed negatives. The exporter must decode the explicit
positive categories in metadata; an unclassified date-coded raster must not be
treated as an ordinary boolean map. GLAD cautions against deriving forest-loss
area estimates from alert pixels: <https://glad.umd.edu/dataset/glad-forest-alerts>.

The public Rondônia case offers an optional live tile overlay from the Global
Forest Watch tile cache (`umd_glad_sentinel2_alerts/latest`). The UI sends
`start_date` and `end_date` filters covering the first baseline date through
the selected NISAR date, plus an optional confirmed-only filter. This narrows
the live alert display to a relevant time window, but does not turn it into a
reproducible reference package: the project has not computed candidate-to-alert
pixel overlap, and the source-rendered tile snapshot can change as GLAD updates.
Treat a visible match as positive event context only. Check the alert dates and
confidence in the official GLAD viewer; missing alerts remain unassessed and
are not reference negatives. Use the operator import workflow for a dated,
archived raster and record its version/checksum. GLAD-S2 maps alerts within its
primary-forest mask in the Amazon basin, not all forest or all land.

## Claim gate and limitations

Automated runs always retain `UNVERIFIED_RADAR_CHANGE_CANDIDATES`. Independent
reference availability and workflow completion are separate states. Neither
successful processing nor the optical screen approves a clearing claim.
An analyst must inspect actual before/after imagery, timing, masks, spatial
agreement and alternative explanations before documenting a supported
interpretation in a new method/publication. This release has no automated
promotion to confirmed clearing.

Backscatter depends on moisture, vegetation structure, season, acquisition
geometry and speckle. A summer baseline may already include earlier clearing.
Historical eligibility can omit recent forest or include already-cleared land.
Thirty-day optical offsets introduce temporal ambiguity. No biomass, carbon,
permanent forest-loss, illegal-logging or prediction claim is made.
