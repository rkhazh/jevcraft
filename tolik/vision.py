"""Validate authenticated body frames and retain a small operator-owned archive."""
from __future__ import annotations
import base64
import binascii
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import struct
import uuid
import warnings
import zlib
from PIL import Image

MAX_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 4_000_000
RENDERER = 'cpu_textured_collision_geometry_v1'

def _number(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)

def _point(value):
    return isinstance(value,dict) and set(value)=={'x','y','z'} and all(_number(v) and abs(v)<=30_000_000 for v in value.values())

def _quality(packet,width,height):
    pixels=width*height
    unknown=packet.get('unknown_pixels',0)
    if type(unknown) is not int or not 0<=unknown<=pixels:raise ValueError('Invalid unloaded-pixel count')
    fields={'missing_texture_pixels','missing_texture_material_count','missing_texture_materials'}
    if not fields.intersection(packet):return  # Older authenticated renderer metadata.
    if not fields.issubset(packet):raise ValueError('Incomplete texture evidence')
    missing,count,materials=(packet[k] for k in ('missing_texture_pixels','missing_texture_material_count','missing_texture_materials'))
    if type(missing) is not int or not 0<=missing<=pixels-unknown or type(count) is not int or not 0<=count<=min(4096,missing):raise ValueError('Invalid missing-texture counts')
    if not isinstance(materials,list) or len(materials)!=min(count,8):raise ValueError('Invalid missing-texture materials')
    names=set();shown=0
    for entry in materials:
        if (not isinstance(entry,dict) or set(entry)!={'name','pixels'}
                or not isinstance(entry['name'],str) or not re.fullmatch(r'(?:minecraft:)?[a-z0-9_]{1,128}',entry['name'])
                or entry['name'] in names or type(entry['pixels']) is not int or not 1<=entry['pixels']<=missing):raise ValueError('Invalid missing-texture material')
        names.add(entry['name']);shown+=entry['pixels']
    if (count<=8 and shown!=missing) or (count>8 and shown>=missing):raise ValueError('Inconsistent missing-texture evidence')

def _png(image):
    if not isinstance(image,bytes) or not 8<len(image)<=MAX_BYTES or image[:8]!=b'\x89PNG\r\n\x1a\n':
        raise ValueError('Invalid PNG size or signature')
    offset=8; ended=False
    while offset<len(image):
        if offset+12>len(image):raise ValueError('Truncated PNG')
        length=struct.unpack('>I',image[offset:offset+4])[0]
        end=offset+12+length
        if end>len(image):raise ValueError('Truncated PNG chunk')
        kind=image[offset+4:offset+8]
        if zlib.crc32(image[offset+4:end-4]) & 0xffffffff != struct.unpack('>I',image[end-4:end])[0]:raise ValueError('Invalid PNG checksum')
        if kind==b'IEND':
            if length or end!=len(image):raise ValueError('Invalid PNG ending')
            ended=True
        offset=end
    if not ended:raise ValueError('Missing PNG ending')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image)) as picture:
                width,height=picture.size
                if picture.format!='PNG' or width*height>MAX_PIXELS or getattr(picture,'n_frames',1)!=1:raise ValueError('Unsupported image')
                picture.verify()
            with Image.open(io.BytesIO(image)) as picture:picture.load()
    except Exception as exc:
        raise ValueError('Invalid PNG contents') from exc
    return width,height

def validate_capture(packet,snapshot,now):
    if not isinstance(packet,dict) or not isinstance(snapshot,dict) or not _number(now):raise ValueError('Invalid capture envelope')
    for key in ('session_id','world_id','dimension'):
        if not isinstance(packet.get(key),str) or not packet[key] or len(packet[key])>128 or packet[key]!=snapshot.get(key):raise ValueError('Frame scope mismatch')
    if packet.get('active_goal_id')!=snapshot.get('active_goal_id'):raise ValueError('Frame goal changed')
    if not isinstance(packet.get('capture_id'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',packet['capture_id']):raise ValueError('Invalid capture identity')
    observed=packet.get('observed_at');captured=packet.get('captured_at')
    if not _number(observed) or not -1<=now-observed<=5 or not _number(captured) or not observed<=captured<=now+1:raise ValueError('Frame timestamp invalid or stale')
    if packet.get('renderer')!=RENDERER or packet.get('mime_type')!='image/png':raise ValueError('Unsupported renderer or encoding')
    if not _number(packet.get('fov')) or not 10<=packet['fov']<=120 or packet.get('fov_axis')!='vertical' or not _number(packet.get('range')) or not 1<=packet['range']<=24:raise ValueError('Invalid optics')
    position=packet.get('position');eye=packet.get('eye_position')
    if not _point(position) or not _point(eye) or abs(eye['x']-position['x'])>.01 or abs(eye['z']-position['z'])>.01 or not .1<=eye['y']-position['y']<=2.5:raise ValueError('Invalid camera position')
    for key,limit in [('yaw',2*math.pi+.01),('pitch',math.pi/2+.01)]:
        if not _number(packet.get(key)) or abs(packet[key])>limit:raise ValueError('Invalid camera angle')
        if key in snapshot and (not _number(snapshot[key]) or abs(math.atan2(math.sin(packet[key]-snapshot[key]),math.cos(packet[key]-snapshot[key])))>.03):raise ValueError('Camera angle changed')
    if 'position' in snapshot and (not _point(snapshot['position']) or math.dist([position[k] for k in ('x','y','z')],[snapshot['position'][k] for k in ('x','y','z')])>.25):raise ValueError('Camera position changed')
    limits=packet.get('limitations')
    if not isinstance(limits,list) or len(limits)>16 or any(not isinstance(v,str) or len(v)>256 for v in limits):raise ValueError('Invalid renderer limitations')
    encoded=packet.get('image_base64')
    if not isinstance(encoded,str) or len(encoded)>4*((MAX_BYTES+2)//3):raise ValueError('Image payload too large')
    try:image=base64.b64decode(encoded,validate=True)
    except (ValueError,binascii.Error) as exc:raise ValueError('Invalid image encoding') from exc
    width,height=_png(image)
    if type(packet.get('width')) is not int or type(packet.get('height')) is not int or (width,height)!=(packet['width'],packet['height']):raise ValueError('Image dimensions mismatch')
    _quality(packet,width,height)
    digest=hashlib.sha256(image).hexdigest()
    if 'image_sha256' in packet and packet['image_sha256']!=digest:raise ValueError('Image hash mismatch')
    metadata={k:v for k,v in packet.items() if k!='image_base64'}
    metadata['image_sha256']=digest
    try:serialized=json.dumps(metadata,ensure_ascii=False,allow_nan=False)
    except (TypeError,ValueError,RecursionError) as exc:raise ValueError('Invalid metadata') from exc
    if len(serialized.encode('utf-8'))>16384:raise ValueError('Metadata too large')
    return {'image':image,'metadata':json.loads(serialized)}

def save_capture(frame,directory):
    image=frame['image'];metadata=frame['metadata'];_png(image)
    digest=hashlib.sha256(image).hexdigest()
    if metadata.get('image_sha256')!=digest:raise ValueError('Archive hash mismatch')
    encoded=json.dumps(metadata,ensure_ascii=False,allow_nan=False).encode('utf-8')
    if len(encoded)>16384:raise ValueError('Metadata too large')
    root=Path(directory);root.mkdir(parents=True,exist_ok=True,mode=0o700)
    # Capture IDs and any body-supplied paths never participate in filenames.
    stem='capture-'+uuid.uuid4().hex;image_path=root/(stem+'.png');meta_path=root/(stem+'.json')
    for destination,payload in ((image_path,image),(meta_path,encoded)):
        with os.fdopen(os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as handle:handle.write(payload)
    owned=sorted((p for p in root.glob('capture-*.png') if re.fullmatch(r'capture-[a-f0-9]{32}\.png',p.name)),key=lambda p:p.stat().st_mtime_ns,reverse=True)
    for old in owned[4:]:
        old.unlink(missing_ok=True);old.with_suffix('.json').unlink(missing_ok=True)
    return str(image_path.resolve())
