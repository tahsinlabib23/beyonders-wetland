# Evidence report (saved local runs)

Generated inventory: [`evidence-inventory.json`](evidence-inventory.json). Regenerate offline with `python pipeline/audit_saved_evidence.py --output docs/evidence-inventory.json`. The script inventories saved outputs and never alters the detector or fetches data.

| Case/check | Reference coverage | Agreement | Interpretation |
|---|---:|---:|---|
| Hakaluki, 2026-09-27 | 50.7% of study area; 93.3% of candidate area in footprint assessed | TP 0.0115 km², FP 0.0778 km², FN 0.2088 km²; precision 12.9%, recall 5.2%, F1 7.4% | Weak agreement; radar-only detections are mostly water on both optical dates. Not confirmed new flooding. |
| Tanguar mapped haor, 2026-08-29 | 0.34% of mapped boundary; 0.0095% of candidate-in-footprint area assessed | Suppressed; nominal tiny-overlap score is not reportable | Inconclusive due to clouds/coverage. |
| Chókwè, 2026-01-05 → 2026-01-17 | NASA reports these NISAR event dates; local HLS verification not run | Not measured by this app yet | NASA event context only. Separate beta scenes were found in CMR; process and independently check before claiming the local detector reproduced it. |

The Hakaluki check compares the median of preceding NISAR acquisitions (median date June 29) to HLS July 4 and NISAR September 27 to HLS September 24. Temporal mismatch limits interpretation. The evaluated class is open water; vegetated inundation was not checked.

For Tanguar, NISAR's baseline median spans June 18–August 17 and is dated July 12; HLS comparison dates July 16 and August 30. The 0.34% common-clear fraction is far below the 20% scoring gate. Its few nominal TP/FP/FN values are not accuracy evidence.

Sources: [NASA NISAR Mozambique flood visualization](https://svs.gsfc.nasa.gov/5661/), [ASF NISAR availability and maturity](https://nisar-docs.asf.alaska.edu/availability-overview/). NASA describes the Jan 5 and Jan 17 scenes over the Limpopo/Incomati basins and specifically shows Chókwè. This event supports a case to investigate, not independent validation of this project's detector.
