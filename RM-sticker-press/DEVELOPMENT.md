# Development

## Layout

```
index.html        ← the shipped app (generated — do not edit directly)
src/
  app_shell.html  ← UI + app logic; contains the //__INLINE_RM_WRITER__ marker
  rm_writer.js    ← v6 .rm binary writer + .rmdoc zip packer (UMD: Node + browser)
  build.py        ← inlines the writer into the shell → ../index.html
tests/
  rmscene/        ← vendored copy of rmscene (MIT, Rick Lupton) used as validation oracle
  reference.rm    ← rmscene-generated reference bytes
  test_*.js       ← Node test suite
samples/          ← pre-exported .rmdoc files for device testing
```

## Build

```sh
python3 src/build.py
```

## Tests

Requires Node ≥ 18 and Python ≥ 3.10 (with the `packaging` module, usually preinstalled).

```sh
cd tests
# extract the app's inline scripts (some tests exercise app functions directly)
python3 -c "import re; html=open('../index.html').read(); [open(f'/tmp/script{i}.js','w').write(s) for i,s in enumerate(re.findall(r'<script>(.*?)</script>', html, re.S))]"

node test_diff.js      # writer must be BYTE-IDENTICAL to the rmscene reference
node test_e2e.js       # test-star pipeline: hatch → strokes → .rmdoc → coordinates
node test_solid.js     # solid-fill mode parameters
node test_devices.js   # 4-device paper-size matrix (then verify with python/rmscene)
node test_layers.js    # two-layer export
node test_rmdoc.js     # 600-stroke stress document
```

Each `.rmdoc`-producing test can be cross-checked by parsing the output with the vendored
rmscene (`python3 -c "from rmscene.scene_stream import read_tree; ..."`); see the inline
assertions in the test files for examples.

The invariant that matters most: **`test_diff.js` must print `BYTE-IDENTICAL`.** The
single-layer block layout is the configuration confirmed working on physical hardware;
any writer change that breaks byte-identity needs a fresh device test before merging.

## Format notes

reMarkable `.lines` v6 in one paragraph: a 43-byte ASCII header, then length-prefixed blocks
(`u32 len, u8 0, u8 minVer, u8 curVer, u8 type`). Inside blocks, values are tagged
(`varuint(index<<4|type)`); CRDT ids are `u8 part1 + varuint part2`. A page is: AuthorIds,
MigrationInfo, PageInfo, a SceneTree/TreeNode/GroupItem trio per layer hung off root (0,1),
one SceneLineItem block per stroke (v2 points: f32 x, f32 y, u16 speed, u16 width, u8 dir,
u8 pressure = 14 bytes), and SceneInfo (current layer + paper size) last. The `.rmdoc` is a
plain zip: `{uuid}.content` (JSON), `{uuid}.metadata`, `{uuid}.pagedata`, `{uuid}/{page}.rm`.

Solid fills replicate parameters observed in commercial sticker packs: horizontal rows 2 page
units apart, `thickness_scale ≈ 7.07`, point `width 18 / pressure 255 / speed 0`, interior
points every ~18 units. Rows overlap ~9× and render as flat colour.
