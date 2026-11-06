import base64
import io
import tempfile
import unittest
from PIL import Image
from tolik.vision import validate_capture,save_capture

class VisionTests(unittest.TestCase):
    def test_missing_texture_evidence_is_bounded_and_distinct_from_unloaded_pixels(self):
        packet={**self.capture(),'unknown_pixels':4,'missing_texture_pixels':100,
                'missing_texture_material_count':1,'missing_texture_materials':[{'name':'stone','pixels':100}]}
        snapshot=dict(session_id='s',world_id='w',dimension='overworld')
        frame=validate_capture(packet,snapshot,101)
        self.assertEqual(frame['metadata']['missing_texture_materials'],packet['missing_texture_materials'])
        for patch in ({'missing_texture_pixels':-1},{'missing_texture_pixels':True},
                      {'unknown_pixels':200},{'missing_texture_material_count':0},
                      {'missing_texture_materials':[{'name':'/command','pixels':100}]},
                      {'missing_texture_materials':[{'name':'stone','pixels':101}]},
                      {'missing_texture_material_count':2,'missing_texture_materials':[{'name':'stone','pixels':50},{'name':'stone','pixels':50}]}):
            with self.subTest(patch=patch),self.assertRaises(ValueError):validate_capture({**packet,**patch},snapshot,101)
        with self.assertRaises(ValueError):validate_capture({**self.capture(),'missing_texture_pixels':1},snapshot,101)
        truncated={**packet,'missing_texture_material_count':9,'missing_texture_materials':[{'name':f'material_{i}','pixels':10} for i in range(8)]}
        validate_capture(truncated,snapshot,101)
        with self.assertRaises(ValueError):validate_capture({**truncated,'missing_texture_pixels':80},snapshot,101)

    def capture(self):
        output=io.BytesIO();Image.new('RGB',(16,16)).save(output,format='PNG')
        return dict(capture_id='c',session_id='s',world_id='w',observed_at=100,captured_at=100.1,active_goal_id=None,dimension='overworld',
            position={'x':1,'y':64,'z':2},eye_position={'x':1,'y':65.62,'z':2},yaw=0,pitch=0,width=16,height=16,
            mime_type='image/png',image_base64=base64.b64encode(output.getvalue()).decode(),renderer='cpu_textured_collision_geometry_v1',limitations=[],fov=60,fov_axis='vertical',range=24)
    def test_capture_checks_scope_timestamp_dimensions_and_saves_bounded_actual_bytes(self):
        packet=self.capture();snapshot=dict(session_id='s',world_id='w',dimension='overworld')
        frame=validate_capture(packet,snapshot,101)
        for patch in ({'session_id':'other'},{'world_id':'other'},{'observed_at':90},{'width':100},{'image_base64':'bad'}):
            with self.assertRaises(ValueError):validate_capture({**packet,**patch},snapshot,101)
        with tempfile.TemporaryDirectory() as directory:
            for n in range(6):save_capture({**frame,'metadata':{**frame['metadata'],'capture_id':str(n)}},directory)
            from pathlib import Path
            self.assertLessEqual(len(list(Path(directory).glob('*.png'))),4)

    def test_pose_future_time_goal_hash_and_metadata_are_fenced(self):
        packet=self.capture();snapshot=dict(session_id='s',world_id='w',dimension='overworld',position={'z':2,'x':1,'y':64},active_goal_id=None)
        validate_capture(packet,snapshot,101)
        for patch in ({'observed_at':103,'captured_at':103},{'active_goal_id':'other'},{'position':{'x':10,'y':64,'z':2}},{'image_sha256':'wrong'},{'renderer':'unknown'},{'capture_id':'../../escape'},{'range':float('nan')},{'extra':'x'*17000}):
            with self.assertRaises(ValueError):validate_capture({**packet,**patch},snapshot,101)

    def test_corrupt_or_forged_png_is_rejected_and_archive_paths_are_generated(self):
        packet=self.capture();snapshot=dict(session_id='s',world_id='w',dimension='overworld')
        data=bytearray(base64.b64decode(packet['image_base64']));data[-1]^=1
        with self.assertRaises(ValueError):validate_capture({**packet,'image_base64':base64.b64encode(data).decode()},snapshot,101)
        frame=validate_capture(packet,snapshot,101)
        with tempfile.TemporaryDirectory() as directory:
            from pathlib import Path
            frame['metadata']['capture_id']='../../escape'
            path=Path(save_capture(frame,directory));self.assertEqual(path.parent,Path(directory).resolve());self.assertTrue(path.name.startswith('capture-'))
            self.assertEqual(path.read_bytes(),frame['image'])
