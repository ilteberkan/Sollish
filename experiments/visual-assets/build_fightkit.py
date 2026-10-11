#!/usr/bin/env python3
"""Offline candidate only. Keep the shipped character/rig/clips immutable.

Reuse Quaternius anatomy and its skin weights; author new ring clothing and
rigidly skinned protective equipment. This is not a new anatomical model,
cloth simulation, motion capture or an assertion of AA production quality.
"""
from copy import deepcopy
from pathlib import Path
import hashlib
import json
import math
import struct

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ORIGINAL = ROOT / 'apps/web/public/models/boxing/athlete.glb'
PIN = '4f6408ef9aa249ef7043f36b2de15e60069cd656d0fc9abd6a1f5028002b66aa'


def load_glb(path):
    data = path.read_bytes()
    assert struct.unpack_from('<III', data) == (0x46546c67, 2, len(data))
    n, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4e4f534a
    d = json.loads(data[20:20+n])
    size, kind = struct.unpack_from('<II', data, 20+n)
    assert kind == 0x004e4942
    return d, bytearray(data[28+n:28+n+size])


def rows(d, blob, index):
    a = d['accessors'][index]
    v = d['bufferViews'][a['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    fmt = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}[a['componentType']]
    size = struct.calcsize(fmt) * width
    return [struct.unpack_from('<'+fmt*width, blob, v.get('byteOffset', 0)+a.get('byteOffset', 0)+i*v.get('byteStride', size)) for i in range(a['count'])]


def normalize(v):
    length = math.sqrt(sum(x*x for x in v))
    return [x/length for x in v]


def build():
    assert hashlib.sha256(ORIGINAL.read_bytes()).hexdigest() == PIN
    d, blob = load_glb(ORIGINAL)
    original = deepcopy(d)
    sources = json.loads((HERE/'sources/manifest.json').read_text())

    def append(data):
        blob.extend(b'\0'*(-len(blob) % 4))
        view = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
        blob.extend(data)
        d['bufferViews'].append(view)
        return len(d['bufferViews'])-1

    def accessor(values, kind, integer=False):
        flat = [x for v in values for x in v]
        a = {'bufferView': append(struct.pack('<'+('B' if integer else 'f')*len(flat), *flat)), 'componentType': 5121 if integer else 5126, 'count': len(values), 'type': kind}
        if kind == 'VEC3':
            a.update(min=[min(x[i] for x in values) for i in range(3)], max=[max(x[i] for x in values) for i in range(3)])
        d['accessors'].append(a)
        return len(d['accessors'])-1

    textures = []
    for record in sources['files']:
        data = (HERE/'sources'/record['file']).read_bytes()
        assert len(data) == record['bytes'] and hashlib.sha256(data).hexdigest() == record['sha256']
        d['images'].append({'name': record['file'], 'mimeType': 'image/jpeg', 'bufferView': append(data)})
        d['textures'].append({'source': len(d['images'])-1, 'sampler': 0})
        textures.append(len(d['textures'])-1)

    def material(name, color, leather=False, roughness=.75):
        m = {'name': name, 'pbrMetallicRoughness': {'baseColorFactor': [*color, 1], 'metallicFactor': 0, 'roughnessFactor': roughness}, 'doubleSided': True}
        if leather:
            m['pbrMetallicRoughness'].update(baseColorTexture={'index': textures[0]}, metallicRoughnessTexture={'index': textures[2]})
            m['normalTexture'] = {'index': textures[1], 'scale': .4}
        d['materials'].append(m)
        return len(d['materials'])-1

    team = material('FightKitTeamFabric', [.58, .09, .065])
    dark = material('FightKitDarkFabric', [.045, .048, .06])
    trim = material('FightKitIvoryTrim', [.83, .80, .69])
    leather = material('FightKitTeamLeather', [.65, .11, .08], True, .7)
    black_leather = material('FightKitBlackLeather', [.06, .065, .075], True, .85)
    laces = material('FightKitLaces', [.72, .69, .60])
    bone_names = [d['nodes'][i]['name'] for i in d['skins'][0]['joints']]
    parent = next(i for i, n in enumerate(d['nodes']) if n.get('name') == 'Armature')
    # Retain classic/referee meshes for the renderer's explicit cast visibility.
    added = []
    groups = {}

    def mesh(name, vertices, mat):
        assert vertices and len(vertices) % 3 == 0
        groups.setdefault(mat, []).extend(vertices)
        added.append({'name': name, 'vertices': len(vertices), 'triangles': len(vertices)//3, 'material': d['materials'][mat]['name']})

    def emit(name, vertices, mat):
        # Vertex tuple: position, normal, UV, joint indices, normalized weights.
        attrs = {k: accessor([v[i] for v in vertices], kind, k == 'JOINTS_0') for i, (k, kind) in enumerate([('POSITION', 'VEC3'), ('NORMAL', 'VEC3'), ('TEXCOORD_0', 'VEC2'), ('JOINTS_0', 'VEC4'), ('WEIGHTS_0', 'VEC4')])}
        d['meshes'].append({'name': name, 'primitives': [{'attributes': attrs, 'material': mat}]})
        d['nodes'].append({'name': name, 'mesh': len(d['meshes'])-1, 'skin': 0})
        d['nodes'][parent]['children'].append(len(d['nodes'])-1)

    body = next(m for m in d['meshes'] if m['name'].startswith('Sphere.005'))['primitives'][0]
    pos, norm, joints, weights = [rows(d, blob, body['attributes'][key]) for key in ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']]
    indices = [v[0] for v in rows(d, blob, body['indices'])]

    def vertex(i):
        return {'p': list(pos[i]), 'n': list(norm[i]), 'w': {j: w for j, w in zip(joints[i], weights[i]) if w > 0}}

    def interpolate(a, b, t):
        return {'p': [x+(y-x)*t for x, y in zip(a['p'], b['p'])], 'n': [x+(y-x)*t for x, y in zip(a['n'], b['n'])], 'w': {j: a['w'].get(j, 0)*(1-t)+b['w'].get(j, 0)*t for j in a['w'].keys() | b['w'].keys()}}

    def clip(poly, axis, boundary, above):
        result = []
        for a, b in zip(poly, poly[1:]+poly[:1]):
            ia, ib = [(v['p'][axis] >= boundary if above else v['p'][axis] <= boundary) for v in [a, b]]
            if ia:
                result.append(a)
            if ia != ib:
                result.append(interpolate(a, b, (boundary-a['p'][axis])/(b['p'][axis]-a['p'][axis])))
        return result

    def garment(name, boxes, offset, mat, flare=False):
        out = []
        for xmin, xmax, ymin, ymax in boxes:
            for start in range(0, len(indices), 3):
                poly = [vertex(v) for v in indices[start:start+3]]
                for axis, value, above in [(0, xmin, True), (0, xmax, False), (1, ymin, True), (1, ymax, False)]:
                    if poly:
                        poly = clip(poly, axis, value, above)
                for j in range(1, len(poly)-1):
                    for v in [poly[0], poly[j], poly[j+1]]:
                        n = normalize(v['n'])
                        x, y, z = v['p']
                        # Modest loose hem; still uses the original anatomical skin weights.
                        extra = .025*max(0, min(1, (.90-y)/.24)) if flare else 0
                        position = [x+n[0]*(offset+extra), y, z+n[2]*(offset+extra)]
                        influence = sorted(v['w'].items(), key=lambda x: x[1], reverse=True)[:4]
                        total = sum(w for _, w in influence)
                        influence += [(0, 0)]*(4-len(influence))
                        out.append((position, n, [x*4+z*2, y*4], [j for j, _ in influence], [w/total for _, w in influence]))
        mesh(name, out, mat)

    # Three adjoining sections make a lowered neckline and wide shoulder straps.
    garment('FightKitSinglet', [(-.23, -.105, 1.03, 1.50), (-.105, .105, 1.03, 1.365), (.105, .23, 1.03, 1.50)], .022, team)
    garment('FightKitNeckPiping', [(-.11, .11, 1.353, 1.365), (-.115, -.105, 1.365, 1.49), (.105, .115, 1.365, 1.49)], .026, trim)
    garment('FightKitShorts', [(-.5, .5, .655, 1.04)], .025, dark, True)
    garment('FightKitWaistband', [(-.5, .5, .995, 1.055)], .037, trim)
    garment('FightKitShortSidePanels', [(-.5, -.165, .655, .995), (.165, .5, .655, .995)], .03, team, True)
    garment('FightKitShortHem', [(-.5, .5, .655, .676)], .034, trim, True)
    garment('FightKitBoots', [(-.5, .5, -.02, .35)], .019, black_leather)
    garment('FightKitBootCuffs', [(-.5, .5, .315, .355)], .025, trim)

    def rigid(p, n, uv, bone):
        return (p, n, uv, [bone_names.index(bone), 0, 0, 0], [1, 0, 0, 0])

    def surface(name, fn, nu, nv, bone, mat):
        vertices = []
        for i in range(nu):
            for j in range(nv):
                for a, b in [(i, j), (i+1, j), (i+1, j+1), (i, j), (i+1, j+1), (i, j+1)]:
                    u, v = a/nu, b/nv
                    p, n = fn(u, v)
                    vertices.append(rigid(p, normalize(n), [u*2, v], bone))
        mesh(name, vertices, mat)

    def ellipsoid(name, center, radii, bone, mat):
        def fn(u, v):
            theta, phi = u*math.tau, (.001+v*.998)*math.pi
            n = [math.sin(phi)*math.cos(theta), math.cos(phi), math.sin(phi)*math.sin(theta)]
            return [c+r*t for c, r, t in zip(center, radii, n)], [t/r for t, r in zip(n, radii)]
        surface(name, fn, 24, 14, bone, mat)

    garment('FightKitHeadguardBrow', [(-.3, .3, 1.725, 1.78)], .014, leather)

    def head_back(u, v):
        a = math.pi*.32+u*math.pi*1.36
        return [.11*math.sin(a), 1.637+v*.13, .009+.12*math.cos(a)], [math.sin(a), 0, math.cos(a)]
    surface('FightKitHeadguardRear', head_back, 40, 5, 'Head', leather)
    for sign, side in [(1, 'L'), (-1, 'R')]:
        ellipsoid('FightKitEarPad'+side, [sign*.101, 1.688, .002], [.025, .071, .066], 'Head', leather)
        ellipsoid('FightKitEarInset'+side, [sign*.124, 1.69, .014], [.004, .03, .024], 'Head', dark)
        ellipsoid('FightKitGlove'+side, [sign*.845, 1.444, -.055], [.126, .081, .084], 'hand_l' if sign == 1 else 'hand_r', leather)
        ellipsoid('FightKitGloveThumb'+side, [sign*.796, 1.401, .010], [.06, .038, .043], 'hand_l' if sign == 1 else 'hand_r', leather)
        ellipsoid('FightKitGloveCuff'+side, [sign*.735, 1.445, -.055], [.025, .062, .070], 'hand_l' if sign == 1 else 'hand_r', trim)

    # Short tubes form physical lace crossings instead of painted-on boot details.
    def tube(name, a, b, radius, bone, mat):
        axis = normalize([y-x for x, y in zip(a, b)])
        ref = [0, 0, 1] if abs(axis[2]) < .9 else [1, 0, 0]
        tangent = normalize([axis[1]*ref[2]-axis[2]*ref[1], axis[2]*ref[0]-axis[0]*ref[2], axis[0]*ref[1]-axis[1]*ref[0]])
        bi = [axis[1]*tangent[2]-axis[2]*tangent[1], axis[2]*tangent[0]-axis[0]*tangent[2], axis[0]*tangent[1]-axis[1]*tangent[0]]
        def fn(u, v):
            n = [math.cos(u*math.tau)*t+math.sin(u*math.tau)*q for t, q in zip(tangent, bi)]
            return [x+(y-x)*v+radius*n[k] for k, (x, y) in enumerate(zip(a, b))], n
        vertices = []
        for i in range(6):
            for u, v in [(i/6, 0), ((i+1)/6, 0), ((i+1)/6, 1), (i/6, 0), ((i+1)/6, 1), (i/6, 1)]:
                p, n = fn(u, v)
                # Transfer weights from the actual nearby authored boot/body surface.
                nearest = min(range(len(pos)), key=lambda k: sum((x-y)**2 for x, y in zip(pos[k], p)))
                vertices.append((p, n, [u, v], list(joints[nearest]), list(weights[nearest])))
        mesh(name, vertices, mat)

    for sign, side in [(1, 'L'), (-1, 'R')]:
        # Front is +Z, confirmed with actual GLTF render; bind to calf/foot.
        for j in range(6):
            y = .13+j*.032
            tube(f'FightKitLace{side}{j}A', [sign*.133-.025, y, -.015], [sign*.133+.025, y+.025, -.015], .003, 'calf_l' if sign == 1 else 'calf_r', laces)
            tube(f'FightKitLace{side}{j}B', [sign*.133+.025, y, -.013], [sign*.133-.025, y+.025, -.013], .003, 'calf_l' if sign == 1 else 'calf_r', laces)

    for sign, side in [(1, 'L'), (-1, 'R')]:
        ellipsoid('FightKitToeCap'+side, [sign*.133, .028, .074], [.062, .035, .085], 'foot_l' if sign == 1 else 'foot_r', black_leather)
    # One skinned draw group per material; preserve mixed bone assignments.
    for mat, vertices in groups.items():
        emit(d['materials'][mat]['name'], vertices, mat)

    d.setdefault('extras', {}).update(fightKitVersion='fightkit-v1', fightKitTeamMaterials=['FightKitTeamFabric', 'FightKitTeamLeather'], requiresLegacyGlovesDisabled=True, geometryProvenance='Quaternius anatomical body, Sollish authored fitted apparel/protection; not scanned cloth or new anatomy.')
    d['asset']['copyright'] = 'Quaternius CC0 anatomy/clips; Poly Haven Rob Tuytel CC0 leather; Sollish fight-kit adaptation. See manifest.json.'
    d['buffers'] = [{'byteLength': len(blob)}]
    payload = json.dumps(d, separators=(',', ':')).encode()
    payload += b' '*(-len(payload) % 4)
    blob.extend(b'\0'*(-len(blob) % 4))
    data = struct.pack('<III', 0x46546c67, 2, 28+len(payload)+len(blob))+struct.pack('<II', len(payload), 0x4e4f534a)+payload+struct.pack('<II', len(blob), 0x004e4942)+blob
    path = HERE/'output/athlete-fightkit-v1.glb'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    manifest = {'candidate': 'fightkit-v1', 'status': 'EXPERIMENTAL_NOT_PROMOTED', 'file': path.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'base': {'file': str(ORIGINAL.relative_to(ROOT)), 'sha256': PIN, 'author': 'Quaternius', 'license': 'CC0-1.0'}, 'textureSource': sources, 'addedParts': added, 'addedDrawGroups': len(groups), 'skeletonJoints': len(d['skins'][0]['joints']), 'authoredClips': [x['name'] for x in d['animations']], 'motionCapture': False, 'newAnatomy': False, 'rigCompatible': d['skins'] == original['skins'] and d['animations'] == original['animations'], 'limitations': ['Artist-authored parametric equipment and body-fitted cloth, not simulated fabric.', 'Requires disabling the runtime legacy gloves and choosing team materials explicitly.', 'No automatic production substitution; camera, pose and mobile budget review required.']}
    (HERE/'output/manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({k: manifest[k] for k in ['file', 'bytes', 'sha256', 'rigCompatible']}, indent=2))


if __name__ == '__main__':
    build()
