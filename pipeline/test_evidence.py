"""Regression checks for coverage-driven reference selection and exact scene processing."""
import copy
import unittest
from unittest.mock import patch, MagicMock
import numpy as np

from hls_reference import _best_clear_pair, ReferenceUnavailable
from main import _real_inputs, load_config, ROOT


class EvidenceChecks(unittest.TestCase):
    def test_reference_selection_uses_clear_coverage_and_not_water_agreement(self):
        scenes = [{"granule_id": str(i), "granule": i, "date": str(i)} for i in range(4)]
        pairs = [(scenes[0], scenes[1]), (scenes[2], scenes[3])]
        def loader(granule, *args):
            # The closer pair contains clouds. The clearer pair's spectral
            # values need not resemble the detector to be selected.
            index = np.full((3, 3), -0.8 if granule == 3 else 0.8)
            clear = np.ones((3, 3), dtype=bool) if granule >= 2 else np.zeros((3, 3), dtype=bool)
            return index, clear
        selected, attempts = _best_clear_pair(pairs, {}, (0, 0, 1, 1), np.ones((3, 3), dtype=bool), loader=loader)
        self.assertEqual(selected[0]["granule_id"], "2")
        self.assertEqual([item["common_clear_pixels"] for item in attempts], [0, 9])

    def test_reference_failure_does_not_invent_a_clear_pair(self):
        scene = {"granule_id": "missing", "granule": None}
        with self.assertRaises(ReferenceUnavailable):
            _best_clear_pair([(scene, scene)], {}, (), np.ones((2, 2), bool),
                             loader=MagicMock(side_effect=OSError("unavailable")))

    def test_only_selected_radar_scenes_are_opened(self):
        config = copy.deepcopy(load_config())
        names = [f"NISAR_L2_PR_GCOV_023_141_A_014_4005_DHDH_A_{day}T231316_{day}T231350_P05023_N_F_J_001"
                 for day in ("20260623", "20260705", "20260717")]
        config["nisar"]["selected_scene_names"] = [names[0], names[2]]
        results = [{"umm": {"GranuleUR": name}} for name in names]
        with patch("search_nisar.search_scenes", return_value=results), patch("earthaccess.login"), \
             patch("earthaccess.open", side_effect=lambda items: [MagicMock()]) as opened:
            inputs = _real_inputs(config, ROOT)
        self.assertEqual(opened.call_count, 2)
        self.assertEqual(inputs["baseline_date"], "2026-06-23")
        self.assertEqual(inputs["observations"][0]["date"], "2026-07-17")


if __name__ == "__main__":
    unittest.main()
