"""Separate experimental eligibility screen; does not modify the v1 detector.

The supplied baseline-water mask must be independent of held-out evaluation data.
Unknown mask cells remain unassessed, never interpreted as previously dry.
"""
import numpy as np

METHOD_VERSION = "baseline-water-screen-experiment-v1"


def screen_candidates(candidates, baseline_water, baseline_known):
    if candidates.shape != baseline_water.shape or candidates.shape != baseline_known.shape:
        raise ValueError("Baseline mask and candidates must share the exact grid.")
    water = np.asarray(baseline_water, dtype=bool)
    known = np.asarray(baseline_known, dtype=bool)
    candidates = np.asarray(candidates, dtype=bool)
    return {"eligible_new_water_candidates": candidates & known & ~water,
            "change_over_baseline_water": candidates & known & water,
            "unassessed_baseline": candidates & ~known,
            "method_version": METHOD_VERSION}
