"""Scientific invariants for the official-GUNW publication workflow."""
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import h5py
import numpy as np

from volcano_pipeline import geographic_grid, publish, read_dataset, reference_and_screen


class VolcanoChecks(unittest.TestCase):
    def setUp(self):
        local = Path(__file__).with_name('output')/'volcano-dev'/'test-tmp'
        local.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=local)
        self.root = Path(self.temp.name)
        self.info = {'sensor':'NISAR','start':'2025-11-22','end':'2025-12-04','label':'Event interval',
                     'phase_to_toward_sign':-1,'wavelength_m':.24,'native_crs':'EPSG:4326',
                     'transform':[.001,0,40.60,0,-.001,13.70],'granule_id':'TEST_ONLY_NOT_REAL_DATA'}
        self.config = {'id':'test-case','title':'Test only','event_date':'2025-11-23',
                       'bbox':[40.60,13.67,40.63,13.70], 'reference_bbox':[40.60,13.692,40.608,13.70],
                       'coherence_floor':.3,'display_spacing_degrees':.001,'display_limit_cm':60,
                       'regions':[], 'reference_note':'Test patch', 'boundary_source':'Test grid'}
        self.arrays = {'phase':np.ones((30,30),dtype='float32'),
                       'coherence':np.full((30,30),.9,dtype='float32'),
                       'components':np.ones((30,30),dtype='float32'),
                       'source_mask':np.full((30,30),11,dtype='float32')}

    def tearDown(self):
        self.temp.cleanup()

    def test_coherent_zero_phase_is_not_lost_to_aria_fill_zero(self):
        path=self.root/'phase.h5'
        with h5py.File(path,'w') as handle:
            ds=handle.create_dataset('phase',data=np.array([[0.,1.]],dtype='float32'))
            ds.attrs['_FillValue']=np.array([0.],dtype='float32')
            output=read_dataset(ds,(slice(None),slice(None)))
        self.assertEqual(float(output[0,0]),0.)
        self.arrays['phase'][20,20]=0
        los,valid,_=reference_and_screen(self.arrays,self.info,self.config)
        self.assertTrue(valid[20,20])
        self.assertTrue(np.isfinite(los[20,20]))

    def test_low_coherence_water_invalid_and_disconnected_pixels_are_unassessed(self):
        self.arrays['coherence'][20,20]=.1
        self.arrays['components'][20,21]=2
        self.arrays['source_mask'][20,22]=101
        self.arrays['source_mask'][20,23]=10
        self.arrays['source_mask'][20,24]=255
        los,valid,_=reference_and_screen(self.arrays,self.info,self.config)
        for column in range(20,25):
            self.assertFalse(valid[20,column])
            self.assertTrue(np.isnan(los[20,column]))

    def test_missing_reference_fails_instead_of_fabricating_a_zero(self):
        self.arrays['coherence'][:8,:8]=.1
        with self.assertRaisesRegex(ValueError,'Reference patch'):
            reference_and_screen(self.arrays,self.info,self.config)

    def test_reference_offset_and_opposite_sensor_phase_signs(self):
        self.arrays['phase'][20,20]+=2*np.pi
        nisar,_,_=reference_and_screen(self.arrays,self.info,self.config)
        aria,_,_=reference_and_screen(self.arrays,{**self.info,'phase_to_toward_sign':1},self.config)
        self.assertAlmostEqual(float(nisar[20,20]),-12.,places=4)
        self.assertAlmostEqual(float(aria[20,20]),12.,places=4)
        self.assertAlmostEqual(float(nisar[0,0]),0.,places=5)

    def test_warp_preserves_valid_zero_and_unknown_samples(self):
        data=np.zeros((30,30),dtype='float32')
        data[12:16,12:16]=np.nan
        result=geographic_grid(data,self.info,self.config)
        self.assertEqual(float(result[0,0]),0.)
        self.assertTrue(np.isnan(result[14,14]))

    def test_native_envelope_outside_analysis_box_is_unassessed(self):
        self.config['bbox'][2] = 40.625
        los, valid, stats = reference_and_screen(self.arrays,self.info,self.config)
        self.assertFalse(np.any(valid[:,25:]))
        self.assertTrue(np.all(np.isnan(los[:,25:])))
        self.assertEqual(stats['total_pixels'], 750)
        self.assertEqual(stats['valid_fraction'], 1.)

    def test_same_inputs_reproduce_classification_statistics_and_los(self):
        first = reference_and_screen(self.arrays,self.info,self.config)
        second = reference_and_screen(self.arrays,self.info,self.config)
        np.testing.assert_array_equal(first[0],second[0])
        np.testing.assert_array_equal(first[1],second[1])
        self.assertEqual(first[2],second[2])

    def test_failed_publication_preserves_previous_pointer(self):
        npz = self.root/'subset.npz'
        np.savez_compressed(npz,**self.arrays)
        publish([(self.arrays,self.info,npz)],self.config,self.root/'public','v1')
        pointer = self.root/'public/test-case/index.json'
        original = pointer.read_bytes()
        self.arrays['coherence'][:] = .1
        with self.assertRaises(ValueError):
            publish([(self.arrays,self.info,npz)],self.config,self.root/'public','failed-v2')
        self.assertEqual(pointer.read_bytes(),original)
        self.assertFalse((self.root/'public/test-case/failed-v2').exists())

    def test_publication_is_complete_checksummed_private_path_free_and_immutable(self):
        npz=self.root/'subset.npz'
        np.savez_compressed(npz,**self.arrays)
        study=publish([(self.arrays,self.info,npz)],self.config,self.root/'public','v1')
        folder=self.root/'public/test-case/v1'
        self.assertEqual(study['scientific_interpretation'],'PHASE_DERIVED_LOS_CANDIDATES')
        self.assertTrue((folder/'checksums.json').exists())
        with zipfile.ZipFile(folder/'evidence.zip') as archive:
            self.assertIn('study.json',archive.namelist())
            self.assertIn('network_retry.py',archive.namelist())
            self.assertIn('requirements.txt',archive.namelist())
            self.assertIn('evidence-card.json',archive.namelist())
            text=archive.read('study.json').decode()
            self.assertNotIn(str(self.root),text)
            self.assertNotIn('Authorization',text)
            json.loads(text)
        with self.assertRaises(FileExistsError):
            publish([(self.arrays,self.info,npz)],self.config,self.root/'public','v1')


if __name__=='__main__':
    unittest.main()
