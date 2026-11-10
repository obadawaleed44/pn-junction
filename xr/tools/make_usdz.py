"""Build the iPhone AR models (USDZ files for Apple's AR Quick Look).

    python xr/tools/make_usdz.py

iPhone Safari has no WebXR, but every iPhone opens .usdz files from a web link in
"AR Quick Look": it finds the table and places the model, with no app and no card.
This script writes two models into xr/assets/:

    junction-trio.usdz       three junctions side by side at 0 V, 10 V and 50 V
    junction-breathing.usdz  one junction whose depletion region opens and closes
                             (0 → 50 V → 0) on an 8-second loop

Everything is computed from the same depletion-approximation physics as js/physics.js
(abrupt silicon junction, N_A = N_D = 1e16 cm^-3, 300 K) and written as plain USD text
(.usda) using only meshes, UsdPreviewSurface materials and transform animation, the
subset AR Quick Look supports. Sizes are in metres: the slab is 20 cm long.
Needs only the standard library plus OpenCV + NumPy for the text labels.
"""

import math
import os
import random
import struct
import zipfile

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")

# ------------------------------------------------------------------ physics (as js/physics.js)
Q = 1.602176634e-19
KT_Q = 1.380649e-23 * 300 / Q
EPS = 11.7 * 8.8541878128e-14  # F/cm
NI, NA, ND = 1e10, 1e16, 1e16
VBI = KT_Q * math.log(NA * ND / NI**2)  # 0.714 V


def width(vr):
    """Depletion width W [cm]."""
    return math.sqrt(2 * EPS * (VBI + vr) / Q * (1 / NA + 1 / ND))


def field_ratio(vr):
    """E_max / E_crit (4e5 V/cm)."""
    return 2 * (VBI + vr) / width(vr) / 4e5


assert abs(width(10) * 1e4 - 1.665) < 0.002, "physics check: W(10 V) = 1.665 µm"

# ------------------------------------------------------------------ model geometry (metres)
L, H, D, C = 0.20, 0.04, 0.07, 0.009  # slab length, height, depth, contact thickness
INNER = L / 2 - C                       # semiconductor half-length
HALF_WINDOW = 2.4e-4                    # the slab shows ±2.4 µm (W at 50 V = 3.6 µm fits)
SCALE = INNER / HALF_WINDOW             # metres per cm of real device

COL = {
    "p": (0.99, 0.90, 0.92), "n": (0.88, 0.93, 0.99), "metal": (0.82, 0.82, 0.84), "base": (0.95, 0.95, 0.95),
    "hole": (0.85, 0.28, 0.37), "electron": (0.18, 0.44, 0.84), "ion": (0.79, 0.54, 0.07), "ion_dim": (0.80, 0.80, 0.80),
    "depletion": (0.98, 0.86, 0.55), "field": (0.07, 0.54, 0.44), "ink": (0.07, 0.07, 0.07),
}


class Usda:
    """Collects prims and writes a .usda layer."""

    def __init__(self, name, frames=0, fps=24):
        self.name, self.frames, self.fps = name, frames, fps
        self.prims, self.materials, self.textures = [], {}, []

    def material(self, key, rgb, opacity=1.0, roughness=0.7, texture=None):
        if key in self.materials:
            return key
        r, g, b = rgb
        tex = ""
        if texture:
            tex = f'''
            def Shader "Tex"
            {{
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @{texture}@
                float2 inputs:st.connect = </{self.name}/Materials/{key}/St.outputs:result>
                token inputs:wrapS = "clamp"
                token inputs:wrapT = "clamp"
                float3 outputs:rgb
                float outputs:a
            }}
            def Shader "St"
            {{
                uniform token info:id = "UsdPrimvarReader_float2"
                string inputs:varname = "st"
                float2 outputs:result
            }}'''
        diffuse = (f"color3f inputs:diffuseColor.connect = </{self.name}/Materials/{key}/Tex.outputs:rgb>\n"
                   f"                float inputs:opacity.connect = </{self.name}/Materials/{key}/Tex.outputs:a>") if texture else \
            f"color3f inputs:diffuseColor = ({r:.3f}, {g:.3f}, {b:.3f})\n                float inputs:opacity = {opacity}"
        self.materials[key] = f'''
        def Material "{key}"
        {{
            token outputs:surface.connect = </{self.name}/Materials/{key}/Surface.outputs:surface>
            def Shader "Surface"
            {{
                uniform token info:id = "UsdPreviewSurface"
                {diffuse}
                float inputs:roughness = {roughness}
                float inputs:metallic = 0
                token outputs:surface
            }}{tex}
        }}'''
        return key

    def mesh(self, name, points, faces, mat, translate=(0, 0, 0), scale=None, st=None):
        """faces: list of index lists. translate/scale: a tuple, or {frame: tuple} to animate."""
        pts = ", ".join(f"({x:.5f}, {y:.5f}, {z:.5f})" for x, y, z in points)
        counts = ", ".join(str(len(f)) for f in faces)
        idx = ", ".join(str(i) for f in faces for i in f)

        def op(kind, value, typ):
            if isinstance(value, dict):
                samples = ", ".join(f"{t}: ({v[0]:.5f}, {v[1]:.5f}, {v[2]:.5f})" for t, v in sorted(value.items()))
                return f"{typ} xformOp:{kind}.timeSamples = {{ {samples} }}"
            return f"{typ} xformOp:{kind} = ({value[0]:.5f}, {value[1]:.5f}, {value[2]:.5f})"

        ops = [op("translate", translate, "double3")]
        order = ['"xformOp:translate"']
        if scale is not None:
            ops.append(op("scale", scale, "float3"))
            order.append('"xformOp:scale"')
        uv = ""
        if st:
            uv = "\n            texCoord2f[] primvars:st = [" + ", ".join(f"({u}, {v})" for u, v in st) + '] (\n                interpolation = "vertex"\n            )'
        self.prims.append(f'''
        def Mesh "{name}"
        {{
            int[] faceVertexCounts = [{counts}]
            int[] faceVertexIndices = [{idx}]
            point3f[] points = [{pts}]{uv}
            uniform token subdivisionScheme = "none"
            uniform bool doubleSided = 1
            rel material:binding = </{self.name}/Materials/{mat}>
            {chr(10).join("            " + o if i else o for i, o in enumerate(ops))}
            uniform token[] xformOpOrder = [{", ".join(order)}]
        }}''')

    def text(self):
        timing = (f"\n    startTimeCode = 0\n    endTimeCode = {self.frames}\n    timeCodesPerSecond = {self.fps}"
                  if self.frames else "")
        return f'''#usda 1.0
(
    defaultPrim = "{self.name}"
    metersPerUnit = 1
    upAxis = "Y"{timing}
)

def Xform "{self.name}" (
    kind = "component"
)
{{
    def Scope "Materials"
    {{{"".join(self.materials.values())}
    }}
{"".join(self.prims)}
}}
'''


def box(cx, cy, cz, sx, sy, sz):
    """Points and faces of an axis-aligned box centred at (cx, cy, cz)."""
    x0, x1, y0, y1, z0, z1 = cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2
    pts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]
    return pts, faces


def ball(r, seg=6):
    """A small low-poly sphere centred at the origin."""
    pts, faces = [(0, r, 0)], []
    for i in range(1, seg):
        phi = math.pi * i / seg
        for j in range(seg * 2):
            th = math.pi * j / seg
            pts.append((r * math.sin(phi) * math.cos(th), r * math.cos(phi), r * math.sin(phi) * math.sin(th)))
    pts.append((0, -r, 0))
    ring = seg * 2
    for j in range(ring):
        faces.append([0, 1 + (j + 1) % ring, 1 + j])
    for i in range(seg - 2):
        a, b = 1 + i * ring, 1 + (i + 1) * ring
        for j in range(ring):
            faces.append([a + j, a + (j + 1) % ring, b + (j + 1) % ring, b + j])
    last = len(pts) - 1
    base = 1 + (seg - 2) * ring
    for j in range(ring):
        faces.append([base + j, base + (j + 1) % ring, last])
    return pts, faces


def label_png(path, text, color=(17, 17, 17)):
    """Text on a transparent background, for a label plane. Returns width / height."""
    (w, h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, 2.2, 3)
    width_px = w + 48
    img = np.zeros((128, width_px, 4), np.uint8)
    cv2.putText(img, text, (24, (128 + h) // 2), cv2.FONT_HERSHEY_DUPLEX, 2.2, (*color[::-1], 255), 3, cv2.LINE_AA)
    cv2.imwrite(path, img)
    return width_px / 128


# ------------------------------------------------------------------ one junction
def sites(seed=7):
    """Ion lattice and carrier positions (metres, junction-local)."""
    rnd = random.Random(seed)
    ions = []
    cols = 12
    for side in (-1, 1):
        for c in range(cols):
            x = side * (c + 0.5) * INNER / cols
            for y in (H * 0.33, H * 0.7):
                for z in (-D * 0.3, 0, D * 0.3):
                    ions.append((x, y, z, side))
    carriers = []
    for side in (-1, 1):
        for _ in range(55):
            carriers.append((side * (0.002 + rnd.random() * (INNER - 0.004)), H * (0.15 + 0.7 * rnd.random()), D * (rnd.random() - 0.5) * 0.85, side))
    return ions, carriers


def add_junction(u, tag, ox, vr_at, frames_keys=None):
    """Add a junction at x-offset ox. vr_at(frame) gives V_R; frames_keys=None → static."""
    keys = frames_keys or [0]
    edges = {t: (width(vr_at(t)) / 2 * SCALE) for t in keys}  # symmetric doping: x_p = x_n = W/2
    static = frames_keys is None
    for name, x0, x1, col in (("p", -L / 2 + C, 0, "p"), ("n", 0, L / 2 - C, "n")):
        p, f = box((x0 + x1) / 2, H / 2, 0, x1 - x0, H, D)
        u.mesh(f"{tag}_{name}", p, f, u.material(col, COL[col], opacity=0.45, roughness=0.3), (ox, 0, 0))
    for s in (-1, 1):
        p, f = box(s * (L / 2 - C / 2), H * 0.55, 0, C, H * 1.1, D * 1.06)
        u.mesh(f"{tag}_contact{'pn'[s > 0]}", p, f, u.material("metal", COL["metal"], roughness=0.4), (ox, 0, 0))
    p, f = box(0, -0.002, 0, L + 0.01, 0.004, D + 0.02)
    u.mesh(f"{tag}_base", p, f, u.material("base", COL["base"]), (ox, 0, 0))

    # depletion region: unit box from x = 0 to 1, moved to −x_p and stretched to W
    p, f = box(0.5, H / 2, 0, 1, H * 1.01, D * 1.01)
    tr = {t: (ox - e, 0, 0) for t, e in edges.items()}
    sc = {t: (max(2 * e, 1e-4), 1, 1) for t, e in edges.items()}
    u.mesh(f"{tag}_depletion", p, f, u.material("depletion", COL["depletion"], opacity=0.4),
           tr[0] if static else tr, sc[0] if static else sc)

    # ions: a dim grey one always, a bright amber one on top while uncovered
    ions, carriers = sites()
    for i, (x, y, z, side) in enumerate(ions):
        bar = box(0, 0, 0, 0.0045, 0.0022, 0.0022) if side < 0 else box(0, 0, 0, 0.0045, 0.0045, 0.0022)
        u.mesh(f"{tag}_iond{i}", *bar, u.material("ion_dim", COL["ion_dim"]), (ox + x, y, z))
        on = {t: (1.4, 1.4, 1.4) if abs(x) < e else (TINY, TINY, TINY) for t, e in edges.items()}
        if static and on[0][0] == TINY:
            continue
        u.mesh(f"{tag}_ion{i}", *bar, u.material("ion", COL["ion"], roughness=0.4), (ox + x, y, z),
               None if static else hold(on))
    # carriers: shrink away (and step back towards their contact) inside the depletion region
    sphere = ball(0.0022)
    for i, (x, y, z, side) in enumerate(carriers):
        mat = u.material("hole" if side < 0 else "electron", COL["hole" if side < 0 else "electron"], roughness=0.5)
        sc = {t: (1, 1, 1) if abs(x) > e + 0.001 else (TINY, TINY, TINY) for t, e in edges.items()}
        if static and sc[0][0] == TINY:
            continue
        u.mesh(f"{tag}_c{i}", *sphere, mat, (ox + x, y, z), None if static else hold(sc))

    # field arrows on top of the depletion region (pointing n → p), stretched with it
    for k, z in enumerate((-D * 0.22, D * 0.22)):
        shaft = box(0.5, 0, 0, 0.8, 0.0012, 0.0016)
        tr = {t: (ox - 0.8 * e, H + 0.002, z) for t, e in edges.items()}
        scl = {t: (max(1.6 * e, 1e-4), 1, 1) for t, e in edges.items()}
        u.mesh(f"{tag}_arrow{k}", *shaft, u.material("field", COL["field"], roughness=0.5),
               tr[0] if static else tr, scl[0] if static else scl)
        head = ([(0, 0, 0), (0.006, 0, -0.003), (0.006, 0, 0.003)], [[0, 1, 2]])
        trh = {t: (ox - 0.8 * e, H + 0.002, z) for t, e in edges.items()}
        u.mesh(f"{tag}_head{k}", *head, "field", trh[0] if static else trh)


TINY = 0.001  # "hidden" in an animation: scale exactly 0 can upset some renderers


def hold(samples):
    """Make on/off changes snap: repeat the old value just before each change."""
    out, keys = {}, sorted(samples)
    for a, b in zip(keys, keys[1:]):
        out[a] = samples[a]
        if samples[a] != samples[b]:
            out[b - 1] = samples[a]
    out[keys[-1]] = samples[keys[-1]]
    return out


def add_label(u, name, text, x, y, z, h=0.016, color=(17, 17, 17)):
    """A text plane `h` metres tall, as wide as the text needs."""
    png = f"{name}.png"
    w = h * label_png(os.path.join(ASSETS, "_usdz", png), text, color)
    pts = [(x - w / 2, y, z), (x + w / 2, y, z), (x + w / 2, y + h, z), (x - w / 2, y + h, z)]
    u.mesh(name, pts, [[0, 1, 2, 3]], u.material(f"mat_{name}", (1, 1, 1), texture=png), (0, 0, 0), st=[(0, 0), (1, 0), (1, 1), (0, 1)])
    u.textures.append(png)


# ------------------------------------------------------------------ packaging
def write_usdz(path, usda_name, usda_text, textures):
    """USDZ = an uncompressed zip whose files start on 64-byte boundaries, .usda first."""
    files = [(usda_name, usda_text.encode("utf-8"))]
    for t in textures:
        with open(os.path.join(ASSETS, "_usdz", t), "rb") as fh:
            files.append((t, fh.read()))
    with open(path, "wb") as raw, zipfile.ZipFile(raw, "w", zipfile.ZIP_STORED) as z:
        for name, data in files:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            offset = raw.tell()
            base = offset + 30 + len(name.encode()) + 4
            pad = (-base) % 64
            info.extra = struct.pack("<HH", 0x1986, pad) + b"\0" * pad
            z.writestr(info, data)
    print(f"wrote {os.path.relpath(path)}  ({os.path.getsize(path) / 1024:.0f} kB)")


def main():
    os.makedirs(os.path.join(ASSETS, "_usdz"), exist_ok=True)

    # three junctions side by side: 0, 10, 50 V
    trio = Usda("Trio")
    for k, vr in enumerate((0, 10, 50)):
        ox = (k - 1) * (L + 0.06)
        add_junction(trio, f"j{k}", ox, lambda t, v=vr: v)
        add_label(trio, f"lab{k}", f"V_R = {vr} V", ox, H + 0.035, 0, h=0.018)
        add_label(trio, f"wlab{k}", f"W = {width(vr) * 1e4:.2f} um", ox, -0.001, D / 2 + 0.012, h=0.014, color=(201, 138, 18))
    add_label(trio, "title", "Reverse bias widens the depletion region", 0, H + 0.08, 0, h=0.024)
    write_usdz(os.path.join(ASSETS, "junction-trio.usdz"), "trio.usda", trio.text(), trio.textures)

    # one junction breathing: V_R = 0 → 50 V → 0 every 8 s
    fps, period = 24, 8
    frames = fps * period
    keys = list(range(0, frames + 1, 3))
    breathe = Usda("Breathing", frames=frames, fps=fps)
    add_junction(breathe, "j", 0, lambda t: 25 * (1 - math.cos(2 * math.pi * t / frames)), keys)
    add_label(breathe, "title", "Reverse bias: 0 to 50 V and back", 0, H + 0.05, 0, h=0.02)
    write_usdz(os.path.join(ASSETS, "junction-breathing.usdz"), "breathing.usda", breathe.text(), breathe.textures)


if __name__ == "__main__":
    main()
