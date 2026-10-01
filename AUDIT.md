# Sticker Press audit, 1 October 2026

Checked against the clone at `Projects/RM-Sticker-Press` (one commit, 13 June 2026) and against my Paper Pro on OS 3.28.0.169 over SSH. The writer still works on this firmware: a block drawing built with `rm_writer.js` tonight loaded on the tablet as a version 6 page (`tools/block_to_rmdoc.js` in the quilting folder).

## What is sound

- `test_diff.js` prints BYTE-IDENTICAL. The writer matches the rmscene reference byte for byte.
- Device matrix, layers, stress document and PDF hybrid tests all pass.
- The zip packer, UUID handling and CRDT id layout are clean and commented.

## Fix first

1. **Two tests fail on the current build.** `test_e2e.js` and `test_solid.js` stop at `pageDims is not defined`: `stickerStrokes` gained a `dims` argument for the PDF hybrid work and the test stubs were never updated. Fix is a one-line stub (`const pageDims = () => dev();`) in each test. Six of eight pass.
2. **The "→ Tablet" button cannot work on the Paper Pro.** It posts to `http://10.11.99.1/upload`, the USB web interface. On this tablet there is no web service: `/usr/share/remarkable/webui` holds five files, no `webui.service` exists, and nothing listens on port 80. The README should say the button is for the reMarkable 2 only, or the button should go. The route that works on the Paper Pro is SSH: unzip the `.rmdoc` into `/home/root/.local/share/remarkable/xochitl/` and `systemctl restart xochitl`, which is what I did tonight.
3. **Test artefacts are not ignored.** Every test run leaves `.rmdoc` files, `candidate.rm` and `__pycache__` in `tests/`, and there is no `.gitignore`.
4. **The test setup step is Linux only.** `DEVELOPMENT.md` extracts the inline scripts with a `python3 -c` one-liner writing to `/tmp`. On Windows that needs a small script (I used one in the session). Worth shipping as `tests/extract.py`.

## Small improvements

- **Pale colours vanish.** Nearest-colour mapping sends cream and other pale fills to White, which is invisible on the page. Map White to Gray unless the user chose it on purpose. The quilt script already does this.
- **The page template is hardcoded to Blank.** `buildRmdoc` writes `template: "Blank"` and the matching `.pagedata`. A `template` option per page would let a sticker sheet sit on a grid, which is what the quilt blocks needed, and I had to build the zip by hand to get it.
- **Documents always land at the root.** `metadata.parent` is `""`. A `parent` option (a folder uuid) would file exports into a tablet folder.
- **The firmware note is stale.** The README mentions image insert arriving in 3.27. The tablet is on 3.28 and the format is unchanged, so say "tested on 3.28" and date it.

## Features worth adding, best first

1. **A Node command line.** `rm_writer.js` already runs in Node. What is missing is the SVG sampling, which leans on browser geometry (`getTotalLength`, `getPointAtLength`, `getCTM`). `svg-path-properties` plus `svgpath` would cover the same ground without a browser, and then a folder of SVGs becomes an `.rmdoc` in one command, scriptable from n8n or the quilt tools.
2. **SSH sideload.** A script that unzips the `.rmdoc` straight into the tablet's xochitl folder over `ssh remarkable` or `ssh remarkable-wifi` and restarts the UI. Works with no cable now that WiFi SSH is on. This replaces the dead "→ Tablet" button on the Paper Pro.
3. **Text as ink.** Labels, headings and planner captions rendered through a font's glyph outlines (`opentype.js`) so they become strokes. This is the biggest gap for planner stickers, since every label currently has to be flattened to curves in a drawing app first.
4. **Read an existing `.rmdoc` back in.** rmscene already parses; a reader would let a sheet be reopened, edited and re-exported, and would let the quilt tools pull a tablet sketch back out.
5. **Tags and a cover page.** Cheap metadata fields (`tags`, `coverPageNumber`) that make sheets easier to find on the tablet.

## Not worth doing

- PNG tracing. The README rules it out on purpose and the native image insert covers raster pictures.
- Per-point pen dynamics from recorded strokes. The uniform ink is a feature for stickers.
